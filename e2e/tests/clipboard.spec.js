import { waitForAppReady } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForTerminalReady, getTerminalText, waitForTerminalOutput, writeToTerminal, clearCapturedOutput } from '../helpers/terminal-helpers.js';

/**
 * Select all text in the terminal using xterm.js API.
 * On WebView2 with WebGL rendering, triple-click via WebDriver doesn't work.
 */
async function selectAllTerminalText(paneIndex = 0) {
  await browser.execute((idx) => {
    const hosts = document.querySelectorAll('.terminal-host');
    if (!hosts[idx]) return;
    const term = hosts[idx]._xterm;
    if (term && term.selectAll) {
      term.selectAll();
    }
  }, paneIndex);
  await browser.pause(200);
}

/**
 * Get the clipboard text content by reading it via browser.execute.
 * Use Tauri's clipboard plugin instead of navigator.clipboard so WebView2
 * does not show a system clipboard permission dialog during E2E runs.
 */
async function readClipboardTextViaApp() {
  const result = await browser.execute(async () => {
    const clipboard = window.__TAURI__?.clipboardManager;
    if (!clipboard?.readText) {
      return { ok: false, error: 'Tauri clipboard manager is unavailable' };
    }

    try {
      return { ok: true, text: await clipboard.readText() ?? '' };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.text;
}

async function writeClipboardTextViaApp(text) {
  const result = await browser.execute(async (value) => {
    const clipboard = window.__TAURI__?.clipboardManager;
    if (!clipboard?.writeText) {
      return { ok: false, error: 'Tauri clipboard manager is unavailable' };
    }

    try {
      await clipboard.writeText(value);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }, text);

  if (!result.ok) {
    throw new Error(result.error);
  }
}

async function waitForClipboardTextContaining(expectedText, timeout = 5000) {
  let clipboardText = '';
  await waitForCondition(
    async () => {
      clipboardText = await readClipboardTextViaApp();
      return clipboardText.includes(expectedText);
    },
    timeout,
    200,
  );
  return clipboardText;
}

async function executeCommand(command, paneIndex = 0) {
  await writeToTerminal(paneIndex, command + '\n');
  await waitForTerminalOutput(command, paneIndex, 5000);
}

describe('Clipboard', () => {
  describe('Copy functionality', () => {
    it('should copy selected text to clipboard with Ctrl+Shift+C', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await executeCommand('echo "TEST COPY TEXT"');
      await browser.pause(1000);

      const textBefore = await getTerminalText(0);
      expect(textBefore).toContain('TEST COPY TEXT');

      await selectAllTerminalText(0);
      await browser.pause(200);

      // Dispatch Ctrl+Shift+C via JS
      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'C',
          code: 'KeyC',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(500);

      const clipboardText = await waitForClipboardTextContaining('TEST COPY TEXT');
      expect(clipboardText).toContain('TEST COPY TEXT');
    });

    it('should auto-copy selection to clipboard (select to copy)', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await executeCommand('echo "AUTO COPY TEST"');
      await browser.pause(1000);

      await selectAllTerminalText(0);
      await browser.pause(500);

      const clipboardText = await waitForClipboardTextContaining('AUTO COPY TEST');
      expect(clipboardText).toContain('AUTO COPY TEST');
    });
  });

  describe('Paste functionality', () => {
    it('should paste text from clipboard with Ctrl+Shift+V', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await writeClipboardTextViaApp('PASTE_TEST_12345');
      await browser.pause(200);

      const clipboardBefore = await readClipboardTextViaApp();
      expect(clipboardBefore).toBe('PASTE_TEST_12345');

      // Dispatch Ctrl+Shift+V via JS
      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(1000);

      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('PASTE_TEST_12345');
    });

    it('should paste multi-line text correctly', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      const multiLineText = 'line1\nline2\nline3';
      await writeClipboardTextViaApp(multiLineText);
      await browser.pause(200);

      const clipboardBefore = await readClipboardTextViaApp();
      expect(clipboardBefore).toBe(multiLineText);

      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(1000);

      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('line1');
    });

    it('should paste special characters correctly', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      const specialText = 'test@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
      await writeClipboardTextViaApp(specialText);
      await browser.pause(200);

      const clipboardBefore = await readClipboardTextViaApp();
      expect(clipboardBefore).toBe(specialText);

      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(1000);

      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('test');
    });
  });

  describe('Copy and Paste workflow', () => {
    it('should copy from one location and paste to another', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      const uniqueId = 'COPY_PASTE_ID_' + Date.now();
      await executeCommand(`echo "${uniqueId}"`);
      await browser.pause(1000);

      await selectAllTerminalText(0);
      await browser.pause(200);

      // Copy via Ctrl+Shift+C
      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'C',
          code: 'KeyC',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(500);

      const clipboardText = await waitForClipboardTextContaining(uniqueId);
      expect(clipboardText).toContain(uniqueId);

      await executeCommand('clear');
      await clearCapturedOutput(0);
      await browser.pause(500);

      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(1000);

      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain(uniqueId);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should respect Ctrl+Shift+C for copy', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await executeCommand('echo "SHORTCUT_COPY"');
      await browser.pause(1000);

      await selectAllTerminalText(0);
      await browser.pause(200);

      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'C',
          code: 'KeyC',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(500);

      const clipboardText = await waitForClipboardTextContaining('SHORTCUT_COPY');
      expect(clipboardText).toContain('SHORTCUT_COPY');
    });

    it('should respect Ctrl+Shift+V for paste', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await writeClipboardTextViaApp('SHORTCUT_PASTE');
      await browser.pause(200);

      const clipboardBefore = await readClipboardTextViaApp();
      expect(clipboardBefore).toBe('SHORTCUT_PASTE');

      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(1000);

      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('SHORTCUT_PASTE');
    });
  });

  describe('Empty clipboard handling', () => {
    it('should handle empty clipboard gracefully', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await writeClipboardTextViaApp('');
      await browser.pause(200);

      await browser.execute(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await browser.pause(500);

      const terminalExists = await browser.execute(() => Boolean(document.querySelector('.terminal-host')));
      expect(terminalExists).toBe(true);
    });
  });

  afterEach(async () => {
    await clearCapturedOutput(0);
  });

  after(async () => {
    await cleanupApp();
  });
});
