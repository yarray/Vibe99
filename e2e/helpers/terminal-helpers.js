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
  const textarea = await $('.xterm-helper-textarea');
  if (!textarea) {
    throw new Error('No focused xterm textarea found');
  }
  await textarea.setValue(text);
}

export async function sendKeyToTerminal(key) {
  const textarea = await $('.xterm-helper-textarea');
  if (!textarea) {
    throw new Error('No focused xterm textarea found');
  }
  await textarea.addValue(key);
}

export async function getTerminalText(paneIndex = 0) {
  const useBridge = await _needsBridge();
  if (useBridge) {
    return _getTerminalTextViaBridge(paneIndex);
  }
  return _getTerminalTextViaDom(paneIndex);
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

// --- Tauri bridge helpers for WebGL-rendered terminals ---

function _base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function _needsBridge() {
  const rows = await $$('.terminal-host .xterm-rows > div');
  return rows.length === 0;
}

async function _initBridgeCapture() {
  const alreadyInitialized = await browser.execute(() => !!window.__e2e_captured);
  if (alreadyInitialized) return;
  await browser.execute(() => {
    window.__e2e_captured = {};
    window.__TAURI__.event.listen('vibe99:terminal-data', (event) => {
      const { paneId, data } = event.payload;
      if (!window.__e2e_captured[paneId]) window.__e2e_captured[paneId] = '';
      window.__e2e_captured[paneId] += data;
    });
  });
}

async function _getPaneId(paneIndex) {
  return await browser.execute((idx) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    return tabs[idx]?.dataset?.paneId || null;
  }, paneIndex);
}

async function _getTerminalTextViaBridge(paneIndex) {
  await _initBridgeCapture();
  const text = await browser.execute((idx) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    const paneId = tabs[idx]?.dataset?.paneId;
    if (!paneId) return '';
    const raw = window.__e2e_captured?.[paneId] || '';
    return raw
      .replace(/\x1b\[[^@-~]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '')
      .trim();
  }, paneIndex);
  return text;
}

function _getTerminalTextViaDom(paneIndex) {
  return (async () => {
    const hosts = await $$('.terminal-host');
    if (!hosts[paneIndex]) return '';
    const rows = await hosts[paneIndex].$$('.xterm-rows > div');
    const texts = [];
    for (const row of rows) {
      const text = await row.getText();
      texts.push(text);
    }
    return texts.join('\n').trim();
  })();
}

export async function writeToTerminal(paneIndex, data) {
  await _initBridgeCapture();
  const paneId = await _getPaneId(paneIndex);
  if (!paneId) throw new Error(`No pane ID found for index ${paneIndex}`);
  const encoded = _base64Encode(data);
  await browser.execute((pid, enc) => {
    window.__TAURI__.core.invoke('terminal_write', { paneId: pid, data: enc });
  }, paneId, encoded);
}

export async function clearCapturedOutput(paneIndex) {
  await browser.execute((idx) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    const paneId = tabs[idx]?.dataset?.paneId;
    if (paneId && window.__e2e_captured) {
      window.__e2e_captured[paneId] = '';
    }
  }, paneIndex);
}
