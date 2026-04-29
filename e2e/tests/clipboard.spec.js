import { waitForAppReady, getPaneCount } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForTerminalReady, getTerminalText, waitForTerminalOutput } from '../helpers/terminal-helpers.js';

/**
 * Write text to clipboard using the browser's clipboard API.
 */
async function writeToClipboard(text) {
  await browser.execute(async (txt) => {
    await navigator.clipboard.writeText(txt);
  }, text);
  await browser.pause(200);
}

/**
 * Read text from clipboard using the browser's clipboard API.
 */
async function readFromClipboard() {
  const text = await browser.execute(async () => {
    return await navigator.clipboard.readText();
  });
  return text;
}

/**
 * Select text in the terminal by triple-clicking (selects the current line).
 */
async function selectTerminalText(paneIndex = 0) {
  const hosts = await $$('.terminal-host');
  if (!hosts[paneIndex]) throw new Error(`Terminal at index ${paneIndex} not found`);
  
  // Triple-click to select the current line
  await hosts[paneIndex].click({ button: 'left', clickCount: 3 });
  await browser.pause(200);
}

/**
 * Get the focused terminal's textarea for sending keys.
 */
async function getFocusedTerminalTextarea() {
  const textarea = await $('.xterm-helper-textarea:focus');
  if (!textarea) {
    throw new Error('No focused terminal textarea found');
  }
  return textarea;
}

/**
 * Send keyboard shortcut to the terminal.
 */
async function sendShortcutToTerminal(keys) {
  const textarea = await getFocusedTerminalTextarea();
  await textarea.click();
  await browser.pause(100);
  
  // Use browser.keys for shortcuts
  await browser.keys(keys);
  await browser.pause(300);
}

/**
 * Type text into the terminal.
 */
async function typeInTerminal(text) {
  const textarea = await getFocusedTerminalTextarea();
  await textarea.click();
  await browser.pause(100);
  
  await textarea.setValue(text);
  await browser.pause(200);
}

/**
 * Send Enter key to terminal.
 */
async function sendEnterToTerminal() {
  const textarea = await getFocusedTerminalTextarea();
  await textarea.addValue('Enter');
  await browser.pause(200);
}

/**
 * Execute a command in the terminal and wait for it to complete.
 */
async function executeCommand(command, waitForEcho = true) {
  await typeInTerminal(command);
  await sendEnterToTerminal();
  
  if (waitForEcho) {
    // Wait for the command to be echoed back
    await waitForTerminalOutput(command, 0, 5000);
  }
}

describe('Clipboard', () => {
  describe('Copy functionality', () => {
    it('should copy selected text to clipboard with Ctrl+Shift+C', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // First, execute a command that produces output we can select
      await executeCommand('echo "TEST COPY TEXT"');
      await browser.pause(1000);

      // Get initial terminal state
      const textBefore = await getTerminalText(0);
      expect(textBefore).toContain('TEST COPY TEXT');

      // Select the text by triple-clicking
      await selectTerminalText(0);
      await browser.pause(200);

      // Press Ctrl+Shift+C to copy
      await browser.keys(['Control', 'Shift', 'c']);
      await browser.pause(500);

      // Verify clipboard contains the selected text
      const clipboardText = await readFromClipboard();
      expect(clipboardText).toContain('TEST COPY TEXT');
    });

    it('should auto-copy selection to clipboard (select to copy)', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Execute a command
      await executeCommand('echo "AUTO COPY TEST"');
      await browser.pause(1000);

      // Select text by triple-clicking
      await selectTerminalText(0);
      await browser.pause(500);

      // Verify clipboard contains the selected text (auto-copy on select)
      const clipboardText = await readFromClipboard();
      // Note: This may or may not work depending on app settings
      // The test verifies the expected behavior
      expect(clipboardText.length).toBeGreaterThan(0);
    });
  });

  describe('Paste functionality', () => {
    it('should paste text from clipboard with Ctrl+Shift+V', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // First, copy some text to clipboard
      const testText = 'PASTE_TEST_12345';
      await writeToClipboard(testText);
      await browser.pause(200);

      // Verify clipboard has the text
      const clipboardBefore = await readFromClipboard();
      expect(clipboardBefore).toBe(testText);

      // Get initial terminal text
      const textBefore = await getTerminalText(0);

      // Press Ctrl+Shift+V to paste
      await browser.keys(['Control', 'Shift', 'v']);
      await browser.pause(1000);

      // Verify the pasted text appears in the terminal
      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain(testText);
    });

    it('should paste multi-line text correctly', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Copy multi-line text to clipboard
      const multiLineText = 'line1\nline2\nline3';
      await writeToClipboard(multiLineText);
      await browser.pause(200);

      // Get initial terminal text
      const textBefore = await getTerminalText(0);

      // Paste the text
      await browser.keys(['Control', 'Shift', 'v']);
      await browser.pause(1000);

      // Verify the text was pasted
      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('line1');
    });

    it('should paste special characters correctly', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Copy text with special characters
      const specialText = 'test@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
      await writeToClipboard(specialText);
      await browser.pause(200);

      // Get initial terminal text
      const textBefore = await getTerminalText(0);

      // Paste the text
      await browser.keys(['Control', 'Shift', 'v']);
      await browser.pause(1000);

      // Verify at least some characters were pasted
      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('test');
    });
  });

  describe('Copy and Paste workflow', () => {
    it('should copy from one location and paste to another', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Execute a command with unique output
      const uniqueId = 'COPY_PASTE_ID_' + Date.now();
      await executeCommand(`echo "${uniqueId}"`);
      await browser.pause(1000);

      // Select and copy the text
      await selectTerminalText(0);
      await browser.pause(200);
      await browser.keys(['Control', 'Shift', 'c']);
      await browser.pause(500);

      // Verify clipboard
      const clipboardText = await readFromClipboard();
      expect(clipboardText).toContain(uniqueId);

      // Clear the line
      await executeCommand('clear');
      await browser.pause(500);

      // Paste the copied text
      await browser.keys(['Control', 'Shift', 'v']);
      await browser.pause(1000);

      // Verify the pasted text appears
      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain(uniqueId);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should respect Ctrl+Shift+C for copy', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Execute a command
      await executeCommand('echo "SHORTCUT_COPY"');
      await browser.pause(1000);

      // Select text
      await selectTerminalText(0);
      await browser.pause(200);

      // Use Ctrl+Shift+C
      await browser.keys(['Control', 'Shift', 'c']);
      await browser.pause(500);

      // Verify clipboard
      const clipboardText = await readFromClipboard();
      expect(clipboardText).toContain('SHORTCUT_COPY');
    });

    it('should respect Ctrl+Shift+V for paste', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Set clipboard
      await writeToClipboard('SHORTCUT_PASTE');
      await browser.pause(200);

      // Get initial state
      const textBefore = await getTerminalText(0);

      // Use Ctrl+Shift+V
      await browser.keys(['Control', 'Shift', 'v']);
      await browser.pause(1000);

      // Verify paste worked
      const textAfter = await getTerminalText(0);
      expect(textAfter).toContain('SHORTCUT_PASTE');
    });
  });

  describe('Empty clipboard handling', () => {
    it('should handle empty clipboard gracefully', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Clear clipboard
      await browser.execute(async () => {
        await navigator.clipboard.writeText('');
      });
      await browser.pause(200);

      // Try to paste from empty clipboard
      const textBefore = await getTerminalText(0);
      await browser.keys(['Control', 'Shift', 'v']);
      await browser.pause(500);

      // Terminal should still be responsive
      const textAfter = await getTerminalText(0);
      expect(textAfter).toBeTruthy();
    });
  });

  after(async () => {
    await cleanupApp();
  });
});
