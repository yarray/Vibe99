import fs from 'fs';
import path from 'path';
import { waitForAppReady } from '../helpers/app-launch.js';
import { waitForTerminalReady, writeToTerminal } from '../helpers/terminal-helpers.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

/**
 * VIB-373: clicking an OSC 8 hyperlink must follow the link (open it via the
 * opener plugin) instead of failing with "Command plugin:dialog|confirm not
 * allowed by ACL".
 *
 * Mechanism under test: xterm routes OSC 8 activation to the terminal's
 * linkHandler, which the app wires to bridge.openExternalUrl. The URL is
 * opened with the system opener, captured here through a fake xdg-open on
 * PATH that appends the URL to a marker file.
 */

const OPENED_URLS_MARKER = '/tmp/vibe99-opened-urls.txt';
const FAKE_XDG_OPEN = '/usr/local/bin/xdg-open';
const OSC8_URI = 'https://example.com/vib-373-osc8-target';
const PLAIN_URI = 'https://example.com/vib-373-plain-target';
const SCREENSHOT_DIR = process.env.VIBE99_SCREENSHOT_DIR || '/tmp/vibe99-screenshots';

function installFakeXdgOpen() {
  fs.mkdirSync(path.dirname(FAKE_XDG_OPEN), { recursive: true });
  fs.writeFileSync(
    FAKE_XDG_OPEN,
    '#!/bin/sh\necho "$1" >> ' + OPENED_URLS_MARKER + '\n',
    { mode: 0o755 },
  );
  try { fs.unlinkSync(OPENED_URLS_MARKER); } catch {}
}

function removeFakeXdgOpen() {
  try { fs.unlinkSync(FAKE_XDG_OPEN); } catch {}
}

function readOpenedUrls() {
  try { return fs.readFileSync(OPENED_URLS_MARKER, 'utf8'); } catch { return ''; }
}

/** Finds a link label in pane 0's xterm buffer. Returns 1-based buffer cell coords. */
async function findLabelInBuffer(label) {
  return browser.execute((needle) => {
    const host = document.querySelectorAll('.terminal-host')[0];
    const term = host && host._xterm;
    if (!term) return null;
    const buf = term.buffer.active;
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const col = line.translateToString(true).indexOf(needle);
      if (col !== -1) return { row: y + 1, col: col + 1 };
    }
    return null;
  }, label);
}

/**
 * Ctrl+clicks a buffer cell through xterm's real mousemove/mousedown/mouseup
 * path. Hover-to-link resolution in xterm is async, so the press waits after
 * the hover; the whole click retries until the expected URL shows up in the
 * opener marker. Each step is its own synchronous execute — WebKitWebDriver
 * does not keep async continuations of execute/sync scripts alive.
 */
async function ctrlClickUntilOpened(label, uri) {
  await waitForCondition(async () => {
    const pos = await findLabelInBuffer(label);
    if (!pos) return false;
    await dispatchCellMouseEvent('mousemove', pos.row, pos.col);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await dispatchCellMouseEvent('mousedown', pos.row, pos.col);
    await dispatchCellMouseEvent('mouseup', pos.row, pos.col);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return readOpenedUrls().includes(uri);
  }, 30000, 200);
}

async function dispatchCellMouseEvent(type, row, col) {
  await browser.execute(({ row, col, type }) => {
    const host = document.querySelectorAll('.terminal-host')[0];
    const term = host && host._xterm;
    if (!term) throw new Error('no xterm instance on terminal host');
    const screen = host.querySelector('.xterm-screen');
    if (!screen) throw new Error('no .xterm-screen element');
    const rect = screen.getBoundingClientRect();
    const cellDims = term._core._renderService?.dimensions?.css?.cell;
    const cellW = cellDims?.width ?? rect.width / term.cols;
    const cellH = cellDims?.height ?? rect.height / term.rows;
    screen.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + (col - 0.5) * cellW,
      clientY: rect.top + (row - 0.5) * cellH,
      button: 0, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
    }));
  }, { row, col, type });
}

async function printOsc8Link() {
  // clear; then emit an OSC 8 hyperlink as shell output
  // stty -echo keeps the command echo out of the buffer so the printed
  // label is the only occurrence the click can target.
  await writeToTerminal(0, `stty -echo; clear; printf '\\033]8;;${OSC8_URI}\\033\\\\VIB-373-LINK\\033]8;;\\033\\\\'; stty echo\n`);
}

async function printPlainUrl() {
  await writeToTerminal(0, `stty -echo; clear; printf '${PLAIN_URI}\\n'; stty echo\n`);
}

async function waitForLabel(label) {
  let pos = null;
  await waitForCondition(async () => {
    pos = await findLabelInBuffer(label);
    return pos !== null;
  }, 15000, 300);
  return pos;
}

async function statusLabelText() {
  const el = await $('#status-label');
  return el.getText();
}

describe('VIB-373 link follow (terminal hyperlinks)', () => {
  before(() => {
    installFakeXdgOpen();
  });

  it('follows an OSC 8 hyperlink on ctrl+click without an ACL error', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);

    await printOsc8Link();
    await ctrlClickUntilOpened('VIB-373-LINK', OSC8_URI);

    const status = await statusLabelText();
    expect(status).not.toContain('not allowed by ACL');
    // The pane must still be alive (no "Terminal exited" overlay).
    const overlays = await $$('.terminal-exit-overlay');
    expect(overlays.length).toBe(0);
  });

  it('still follows plain-text URLs on ctrl+click (WebLinksAddon)', async () => {
    await printPlainUrl();
    await ctrlClickUntilOpened(PLAIN_URI, PLAIN_URI);

    const status = await statusLabelText();
    expect(status).not.toContain('not allowed by ACL');
  });

  it('leaves a screenshot as the recovery evidence', async () => {
    await printOsc8Link();
    const pos = await waitForLabel('VIB-373-LINK');
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'opened-urls.txt'), readOpenedUrls());
    await browser.saveScreenshot(path.join(SCREENSHOT_DIR, 'vib-373-link-follow.png'));
    expect(pos).not.toBeNull();
  });

  after(async () => {
    removeFakeXdgOpen();
    await cleanupApp();
  });
});
