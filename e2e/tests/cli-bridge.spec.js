import { execFile, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForAppReady, getTabCount } from '../helpers/app-launch.js';
import { waitForTerminalReady, waitForTerminalOutput, getTerminalText } from '../helpers/terminal-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForCondition } from '../helpers/wait-for.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const isWindows = os.platform() === 'win32';
const binaryExt = isWindows ? '.exe' : '';
const ctlBinary = path.join(projectRoot, 'src-tauri', 'target', 'debug', `vibe99ctl${binaryExt}`);

// Unique marker produced by evaluating `echo $((9173*7))`; the echoed input
// never contains it, so a hit proves the shell executed the command.
const ARITH_MARKER = '64211';

// Shared across tests (run sequentially in one session).
let domPaneIds = [];
let uiCreatedPaneId = null;

function getDomPaneIds() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('#tabs-list .tab')).map((t) => t.dataset.paneId),
  );
}

/** Run vibe99ctl and parse its JSON stdout. Rejects on non-zero exit. */
function runCtl(args) {
  return new Promise((resolve, reject) => {
    execFile(
      ctlBinary,
      args,
      { timeout: 30000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`vibe99ctl ${args.join(' ')} failed: ${(stderr || err.message).trim()}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error(`vibe99ctl ${args.join(' ')} printed invalid JSON: ${stdout}`));
          }
        }
      },
    );
  });
}

/** Wait until the CLI server is up and `pane list` answers. */
async function waitUntilCtlResponds() {
  await waitForCondition(async () => {
    try {
      await runCtl(['pane', 'list']);
      return true;
    } catch {
      return false;
    }
  }, 30000, 1000);
}

async function addPaneViaUi() {
  const btn = await $('#tabs-add');
  await btn.waitForClickable({ timeout: 5000 });
  await btn.click();
  await browser.pause(400);
}

describe('vibe99ctl CLI bridge', () => {
  before(async () => {
    await waitForAppReady();
    if (!fs.existsSync(ctlBinary)) {
      // Docker builds always provide the binary; this is a safety net for
      // bare-metal runs where only the app binary was built.
      execSync('cargo build', { cwd: path.join(projectRoot, 'src-tauri'), stdio: 'inherit' });
    }
    await waitUntilCtlResponds();
  });

  it('pane list returns runtime panes, including ones created after launch', async () => {
    const list = await runCtl(['pane', 'list']);
    expect(list.panes.length).toBe(3);
    expect(list.focusedPaneId).toBe(list.panes[0].id);

    // A pane created at runtime is invisible to the persisted layout
    // snapshot but must be listed immediately.
    await addPaneViaUi();
    expect(await getTabCount()).toBe(4);

    domPaneIds = await getDomPaneIds();
    const after = await runCtl(['pane', 'list']);
    expect(after.panes.map((p) => p.id)).toEqual(domPaneIds);
    uiCreatedPaneId = domPaneIds[3];
    expect(list.panes.map((p) => p.id)).not.toContain(uiCreatedPaneId);
    // Adding a pane moves focus to it — the runtime view must track that.
    expect(after.focusedPaneId).toBe(uiCreatedPaneId);
  });

  it('pane info returns live metadata and focus state', async () => {
    const background = await runCtl(['pane', 'info', domPaneIds[0]]);
    expect(background.id).toBe(domPaneIds[0]);
    expect(background.focused).toBe(false);
    expect(typeof background.cwd).toBe('string');
    expect(background.cwd.length).toBeGreaterThan(0);

    const created = await runCtl(['pane', 'info', uiCreatedPaneId]);
    expect(created.id).toBe(uiCreatedPaneId);
    expect(created.focused).toBe(true);
  });

  it('layout active names the layout this window is running', async () => {
    const active = await runCtl(['layout', 'active']);
    expect(typeof active.layoutId).toBe('string');
    expect(active.layoutId.length).toBeGreaterThan(0);
    expect(typeof active.name).toBe('string');
    expect(active.paneCount).toBe(4);
    expect(active.focusedPaneId).toBe(uiCreatedPaneId);
  });

  it('send-keys reaches the PTY and the shell executes the input', async () => {
    await waitForTerminalReady(0);
    const before = await getTerminalText(0);
    expect(before.includes(ARITH_MARKER)).toBe(false);

    const sent = await runCtl(['terminal', 'send-keys', domPaneIds[0], `echo $((9173*7))\n`]);
    expect(sent.ok).toBe(true);
    await waitForTerminalOutput(ARITH_MARKER, 0, 15000);
  });

  it('resize resolves the pane PTY without error', async () => {
    const resized = await runCtl(['terminal', 'resize', domPaneIds[0], '120', '30']);
    expect(resized.ok).toBe(true);
  });

  it('create, focus and close round-trip through the bridge', async () => {
    const createdId = await runCtl(['pane', 'create']);
    expect(typeof createdId).toBe('string');
    await waitForCondition(async () => (await getTabCount()) === 5, 10000, 300);

    await runCtl(['pane', 'focus', createdId]);
    const info = await runCtl(['pane', 'info', createdId]);
    expect(info.focused).toBe(true);

    await runCtl(['pane', 'close', createdId]);
    await waitForCondition(async () => (await getTabCount()) === 4, 10000, 300);
  });

  it('settings get/set/schema round-trip in Rust', async () => {
    const set = await runCtl(['settings', 'set', 'ui.fontSize', '15']);
    expect(set.changed.fontSize).toBe(15);
    const after = await runCtl(['settings', 'get', 'ui.fontSize']);
    expect(after).toBe(15);

    const schema = await runCtl(['settings', 'schema']);
    expect(schema.fields.fontSize.default).toBe(13);
  });

  it('shell list and layout list return profiles and layouts', async () => {
    const shells = await runCtl(['shell', 'list']);
    expect(Array.isArray(shells.profiles)).toBe(true);
    expect(typeof shells.defaultProfile).toBe('string');

    const layouts = await runCtl(['layout', 'list']);
    expect(Array.isArray(layouts.layouts)).toBe(true);
    expect(layouts.layouts.length).toBeGreaterThan(0);
  });

  it('layout save acknowledges the command', async () => {
    const saved = await runCtl(['layout', 'save']);
    expect(saved.ok).toBe(true);
  });

  after(async () => {
    await cleanupApp();
  });
});
