import os from 'os';
import { waitForAppReady, getPaneCount } from '../helpers/app-launch.js';
import {
  waitForTerminalReady,
  waitForTerminalOutput,
  writeToTerminal,
  clearCapturedOutput,
} from '../helpers/terminal-helpers.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { getTextSafe } from '../helpers/webview2-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

const isWindows = os.platform() === 'win32';

async function executeCommand(command, paneIndex = 0) {
  await clearCapturedOutput(paneIndex);
  await writeToTerminal(paneIndex, command + '\n');
  await browser.pause(800);
}

async function closePaneByIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const closeBtn = await tabs[index].$('.tab-close');
  if (!closeBtn) throw new Error(`Close button not found on tab ${index}`);
  await closeBtn.click();
  await browser.pause(500);
}

async function focusPaneByIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const tabMain = await tabs[index].$('.tab-main');
  if (!tabMain) throw new Error(`Tab main button not found on tab ${index}`);
  await tabMain.click();
  await browser.pause(300);
}

async function getTabLabel(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) return '';
  const label = await tabs[index].$('.tab-label');
  if (!label) return '';
  return await getTextSafe(label);
}

async function waitForPaneCount(count, timeout = 10000) {
  await waitForCondition(
    async () => {
      const panes = await $$('.pane');
      return panes.length === count;
    },
    timeout,
    300,
  );
}

async function getTerminalScreenSize(paneIndex = 0) {
  return await browser.execute((idx) => {
    const hosts = document.querySelectorAll('.terminal-host');
    const host = hosts[idx];
    if (!host) return { width: 0, height: 0 };
    const screen = host.querySelector('.xterm-screen');
    if (!screen) return { width: 0, height: 0 };
    const rect = screen.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  }, paneIndex);
}

describe('Terminal/PTY lifecycle', () => {
  // Non-destructive tests — these run first and leave 3 panes intact
  it('creates PTY for each of the 3 default panes on startup', async () => {
    await waitForAppReady();

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    await waitForTerminalReady(0);
    await waitForTerminalReady(1);
    await waitForTerminalReady(2);

    for (let i = 0; i < 3; i++) {
      const hosts = await $$('.terminal-host .xterm');
      expect(hosts.length).toBeGreaterThanOrEqual(i + 1);
    }
  });

  it('accepts terminal input and produces output', async () => {
    await waitForTerminalReady(0);

    await executeCommand('echo hello_from_test');
    await waitForTerminalOutput('hello_from_test', 0, 15000);
  });

  it('resizes terminal when window size changes', async () => {
    await waitForTerminalReady(0);

    const initial = await getTerminalScreenSize(0);
    expect(initial.width).toBeGreaterThan(0);
    expect(initial.height).toBeGreaterThan(0);

    await browser.setWindowSize(800, 600);
    await browser.pause(1000);

    const afterResize = await getTerminalScreenSize(0);
    expect(afterResize.width).toBeGreaterThan(0);
    expect(afterResize.height).toBeGreaterThan(0);

    // On Windows, WebView2 may enforce a minimum width that prevents the
    // terminal from actually shrinking, so only assert strict shrink on Linux.
    if (!isWindows) {
      expect(afterResize.width).toBeLessThanOrEqual(initial.width);
    }

    await browser.setWindowSize(1280, 1024);
    await browser.pause(500);
  });

  it('updates tab title when CWD changes via OSC 7', async () => {
    // PowerShell on Windows does not emit OSC 7 by default,
    // so this test only runs on non-Windows platforms.
    if (isWindows) return;

    await waitForTerminalReady(0);
    await focusPaneByIndex(0);
    await browser.pause(300);

    await executeCommand('cd /tmp', 0);

    await waitForCondition(
      async () => {
        const label = await getTabLabel(0);
        return label.toLowerCase().includes('tmp');
      },
      5000,
      500,
    );
  });

  // Destructive tests — these modify pane count sequentially.
  // After this test: 2 panes remain.
  it('removes pane when shell process exits', async () => {
    await focusPaneByIndex(2);
    await browser.pause(300);

    // Verify pane 2 is responsive
    await executeCommand('echo BEFORE_EXIT', 2);
    await waitForTerminalOutput('BEFORE_EXIT', 2, 10000);

    // Send exit with leading newline to clear any pending shell state
    await clearCapturedOutput(2);
    await writeToTerminal(2, '\r\nexit\r\n');

    await waitForPaneCount(2, 15000);
    expect(await getPaneCount()).toBe(2);
  });

  // After this test: 1 pane remains.
  it('destroys PTY when a pane is closed', async () => {
    // Pane 2 was removed by previous test; now close pane 1 (index 1)
    await closePaneByIndex(1);
    await browser.pause(500);

    await waitForPaneCount(1);
    expect(await getPaneCount()).toBe(1);

    const hosts = await $$('.terminal-host');
    expect(hosts.length).toBe(1);
  });

  // After this test: 1 pane remains (window stays open).
  it('keeps window open when last pane exits', async () => {
    // Only 1 pane left (at index 0)
    const tabs = await $$('#tabs-list .tab');
    const closeBtn = await tabs[0].$('.tab-close');
    const isDisabled = await closeBtn.getAttribute('disabled');
    expect(isDisabled).toBe('true');

    await focusPaneByIndex(0);
    await browser.pause(300);

    await clearCapturedOutput(0);
    await writeToTerminal(0, '\r\nexit\r\n');

    // After shell exit, the window stays open with the exit message visible.
    // The pane count remains 1 — the terminal just shows the exit code.
    await waitForCondition(
      async () => {
        const captured = await getCapturedOutput(0);
        return captured.includes('process exited');
      },
      10000,
      500,
    );

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(1);
  });

  after(async () => {
    await cleanupApp();
  });
});
