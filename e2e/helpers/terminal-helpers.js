import { waitForCondition } from './wait-for.js';

export async function waitForTerminalReady(paneIndex = 0, timeout = 10000) {
  await waitForCondition(
    async () => {
      const hosts = await $$('.terminal-host .xterm');
      return hosts.length > paneIndex;
    },
    timeout,
    500,
  );
}

export async function getTerminalHosts() {
  return await $$('.terminal-host');
}

export async function typeInTerminal(text) {
  const focusedTextarea = await $('.xterm-helper-textarea');
  if (!focusedTextarea) {
    throw new Error('No focused xterm textarea found');
  }
  await focusedTextarea.setValue(text);
}

export async function sendKeyToTerminal(key) {
  const focusedTextarea = await $('.xterm-helper-textarea');
  if (!focusedTextarea) {
    throw new Error('No focused xterm textarea found');
  }
  await focusedTextarea.addValue(key);
}

export async function getTerminalText(paneIndex = 0) {
  const hosts = await $$('.terminal-host');
  if (!hosts[paneIndex]) return '';
  const rows = await hosts[paneIndex].$$('.xterm-rows > div');
  const texts = [];
  for (const row of rows) {
    const text = await row.getText();
    texts.push(text);
  }
  return texts.join('\n').trim();
}

export async function waitForTerminalOutput(expectedText, paneIndex = 0, timeout = 10000) {
  await waitForCondition(
    async () => {
      const text = await getTerminalText(paneIndex);
      return text.includes(expectedText);
    },
    timeout,
    500,
  );
}
