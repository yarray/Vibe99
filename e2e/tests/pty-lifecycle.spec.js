import { waitForAppReady, getPaneCount } from '../helpers/app-launch.js';
import {
  waitForTerminalReady,
  typeInTerminal,
  getTerminalText,
  waitForTerminalOutput,
} from '../helpers/terminal-helpers.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

/**
 * Execute a command in the currently focused terminal and wait for the
 * output to appear.  Sends the text followed by Enter.
 */
async function executeCommand(command, paneIndex = 0, timeout = 10000) {
  const textarea = await $('.xterm-helper-textarea');
  await textarea.click();
  await browser.pause(100);

  await typeInTerminal(command);
  await browser.pause(100);
  await browser.keys('Enter');
  await browser.pause(500);
}

/**
 * Close a pane by clicking its tab close button identified by pane index.
 */
async function closePaneByIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const closeBtn = await tabs[index].$('.tab-close');
  if (!closeBtn) throw new Error(`Close button not found on tab ${index}`);
  await closeBtn.click();
  await browser.pause(500);
}

/**
 * Focus a pane by clicking its tab.
 */
async function focusPaneByIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const tabMain = await tabs[index].$('.tab-main');
  if (!tabMain) throw new Error(`Tab main button not found on tab ${index}`);
  await tabMain.click();
  await browser.pause(300);
}

/**
 * Get the label text of a tab by index.
 */
async function getTabLabel(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) return '';
  const label = await tabs[index].$('.tab-label');
  if (!label) return '';
  return await label.getText();
}

/**
 * Wait until a specific number of panes exist.
 */
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
  // Each test gets a fresh app instance via wdio's before/after hooks.

  it('creates PTY for each of the 3 default panes on startup', async () => {
    await waitForAppReady();

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    // Each pane should have an xterm terminal rendered
    await waitForTerminalReady(0);
    await waitForTerminalReady(1);
    await waitForTerminalReady(2);

    // Verify each terminal has a live PTY by checking terminal hosts contain xterm
    for (let i = 0; i < 3; i++) {
      const hosts = await $$('.terminal-host .xterm');
      expect(hosts.length).toBeGreaterThanOrEqual(i + 1);
    }
  });

  it('accepts terminal input and produces output', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);

    // Focus the first terminal
    const textarea = await $('.xterm-helper-textarea');
    await textarea.click();
    await browser.pause(200);

    // Execute a command
    await executeCommand('echo hello_from_test');

    // Wait for the output to appear
    await waitForTerminalOutput('hello_from_test', 0, 15000);
  });

  it('resizes terminal when window size changes', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);

    const initial = await getTerminalScreenSize(0);
    expect(initial.width).toBeGreaterThan(0);
    expect(initial.height).toBeGreaterThan(0);

    await browser.setWindowSize(800, 600);
    await browser.pause(1000);

    const afterResize = await getTerminalScreenSize(0);
    expect(afterResize.width).toBeGreaterThan(0);
    expect(afterResize.height).toBeGreaterThan(0);

    expect(afterResize.width).toBeLessThan(initial.width);

    await browser.setWindowSize(1280, 1024);
    await browser.pause(500);
  });

  it('destroys PTY when a pane is closed', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);
    await waitForTerminalReady(1);

    // Close the second pane (index 1)
    await closePaneByIndex(1);
    await browser.pause(500);

    // Pane count should decrease
    await waitForPaneCount(2);
    const paneCount = await getPaneCount();
    expect(paneCount).toBe(2);

    // Verify terminal hosts decreased
    const hosts = await $$('.terminal-host');
    expect(hosts.length).toBe(2);
  });

  it('shows exit message when process exits in a pane', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);

    // Focus and execute exit in the last pane (index 2) to avoid
    // accidentally closing the window
    await focusPaneByIndex(2);
    await browser.pause(300);

    const textarea = await $('.xterm-helper-textarea');
    await textarea.click();
    await browser.pause(100);

    await executeCommand('exit');

    // Wait for exit message to appear in the terminal
    await waitForCondition(
      async () => {
        const text = await getTerminalText(2);
        return text.includes('process exited with code');
      },
      10000,
      500,
    );

    // Pane should have been auto-closed (went from 3 to 2)
    await waitForPaneCount(2, 5000);
  });

  it('closes window when last pane exits', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);
    await waitForTerminalReady(1);
    await waitForTerminalReady(2);

    // Close two panes to leave only one
    await closePaneByIndex(2);
    await waitForPaneCount(2);
    await browser.pause(300);

    // After removing tab at index 2, indices shift. Close the new index 1.
    await closePaneByIndex(1);
    await waitForPaneCount(1);
    await browser.pause(300);

    // Verify only one pane remains
    const paneCount = await getPaneCount();
    expect(paneCount).toBe(1);

    // The remaining pane's close button should be disabled
    const tabs = await $$('#tabs-list .tab');
    const closeBtn = await tabs[0].$('.tab-close');
    const isDisabled = await closeBtn.getAttribute('disabled');
    expect(isDisabled).toBe('true');

    // Execute exit in the last pane — this should close the window.
    // In Tauri WebDriver mode the browser session will end, so we
    // can't assert afterwards. Instead, verify the exit message appears.
    await focusPaneByIndex(0);
    await browser.pause(300);

    const textarea = await $('.xterm-helper-textarea');
    await textarea.click();
    await browser.pause(100);

    await executeCommand('exit');

    // The exit message should appear in the terminal output
    await waitForCondition(
      async () => {
        const text = await getTerminalText(0);
        return text.includes('process exited with code');
      },
      10000,
      500,
    );
  });

  it('updates tab title when CWD changes via OSC 7', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);

    // Focus first pane and execute cd
    await focusPaneByIndex(0);
    await browser.pause(300);

    const textarea = await $('.xterm-helper-textarea');
    await textarea.click();
    await browser.pause(100);

    // cd to /tmp — most shells on Linux will emit OSC 7 on cd
    await executeCommand('cd /tmp');

    // Give the shell time to emit OSC 7 and the renderer to process it.
    // OSC 7 support depends on the shell (bash, zsh, fish support it).
    // We poll the tab label for up to 5 seconds.
    await waitForCondition(
      async () => {
        const label = await getTabLabel(0);
        // When OSC 7 is processed, terminalTitle is updated by onTitleChange
        // or the pane cwd changes. The tab label should contain 'tmp'.
        return label.toLowerCase().includes('tmp');
      },
      5000,
      500,
    );
  });

  after(async () => {
    await cleanupApp();
  });
});
