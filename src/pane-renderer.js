import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

function getRuntimePlatform() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) {
    return 'win32';
  }
  if (platform.includes('mac')) {
    return 'darwin';
  }
  return 'linux';
}

export function getDefaultFontFamily(platform = getRuntimePlatform()) {
  if (platform === 'win32' || platform === 'windows') {
    return 'Consolas, "Cascadia Mono", "Courier New", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", monospace';
}

// OSC 7 format: \x1b]7;file://hostname/path\x07
// Extracts the path from the OSC 7 sequence and URL-decodes it.
function extractPathFromOsc7(data) {
  const prefix = 'file://';
  if (!data.startsWith(prefix)) {
    return null;
  }
  const afterPrefix = data.slice(prefix.length);
  // Skip hostname part until the next slash
  const slashIndex = afterPrefix.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  let encodedPath = afterPrefix.slice(slashIndex);
  // Windows OSC 7 paths look like /C:/Users/... — strip the leading slash
  // so the result is a valid Windows path (C:/Users/...).
  if (/^\/[A-Za-z]:\//.test(encodedPath)) {
    encodedPath = encodedPath.slice(1);
  }
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

function createTerminalTheme(accent) {
  return {
    background: '#11111100',
    foreground: '#d9d4c7',
    cursor: accent,
    cursorAccent: '#111111',
    selectionBackground: `${accent}44`,
    black: '#111111',
    red: '#ff6b57',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#d9d4c7',
    brightBlack: '#5a6374',
    brightRed: '#ff8578',
    brightGreen: '#b0d98b',
    brightYellow: '#f0d58a',
    brightBlue: '#7eb7ff',
    brightMagenta: '#d9a5e8',
    brightCyan: '#7fd8e6',
    brightWhite: '#ffffff',
  };
}

function isWindowsCtrlVPasteHotkey(event, platform) {
  return (
    platform === 'win32' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'v'
  );
}

/**
 * Creates a pane renderer that owns terminal creation, DOM management,
 * and pane rendering.
 *
 * @param {Object} deps
 * @param {Object} deps.bridge — IPC bridge
 * @param {Object} deps.state — pane-state-like object
 * @param {() => Object} deps.settings — returns current settings
 * @param {() => string} deps.getMode — returns current mode ('terminal' | 'nav')
 * @param {Object} deps.paneAlert — breathing mask alert instance
 * @param {Object} deps.paneActivityWatcher — activity watcher instance
 * @param {(paneId: string) => void} [deps.onTerminalData] — called after data is written to terminal
 * @param {(paneId: string, title: string) => void} deps.onTerminalTitleChange
 * @param {(delay?: number) => void} [deps.scheduleLayoutSave]
 * @param {(error: Error) => void} deps.reportError
 */
export function createPaneRenderer(deps) {
  const {
    bridge,
    state,
    settings,
    getMode,
    paneAlert,
    paneActivityWatcher,
    onTerminalData,
    onTerminalTitleChange,
    scheduleLayoutSave,
    reportError,
  } = deps;

  const paneNodeMap = new Map();

  function isLinkOpenModifierPressed(event) {
    return event.ctrlKey || (bridge.platform === 'darwin' && event.metaKey);
  }

  function handleTerminalLinkActivation(event, uri) {
    if (!isLinkOpenModifierPressed(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void bridge.openExternalUrl(uri).catch(reportError);
  }

  function getPreviewWidth(stageWidth, count) {
    const s = settings();
    if (count <= 1) {
      return 0;
    }
    if (stageWidth >= s.paneWidth * count) {
      return s.paneWidth;
    }
    return (stageWidth - s.paneWidth) / (count - 1);
  }

  function getPaneLeft(index, previewWidth, focusedIndex) {
    const s = settings();
    if (previewWidth >= s.paneWidth) {
      return index * s.paneWidth;
    }
    const focusedLeft = focusedIndex * previewWidth;
    if (index < focusedIndex) {
      return index * previewWidth;
    }
    if (index === focusedIndex) {
      return focusedLeft;
    }
    return focusedLeft + s.paneWidth + (index - focusedIndex - 1) * previewWidth;
  }

  function createPane(pane) {
    const paneEl = document.createElement('article');
    paneEl.className = 'pane';
    paneEl.dataset.paneId = pane.id;
    const accentColor = pane.customColor || pane.accent;
    paneEl.style.setProperty('--pane-accent', accentColor);

    const shell = document.createElement('div');
    shell.className = 'pane-shell';

    const body = document.createElement('div');
    body.className = 'pane-body';

    const surface = document.createElement('div');
    surface.className = 'pane-surface';

    const terminalHost = document.createElement('div');
    terminalHost.className = 'terminal-host';
    surface.append(terminalHost);
    body.append(surface);
    paneAlert.attach(paneEl, body);
    shell.append(body);
    paneEl.append(shell);

    const s = settings();
    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      convertEol: false,
      customGlyphs: true,
      cursorBlink: true,
      disableStdin: false,
      drawBoldTextInBrightColors: false,
      fontFamily: s.fontFamily || getDefaultFontFamily(bridge.platform),
      fontSize: s.fontSize,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: createTerminalTheme(accentColor),
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon(handleTerminalLinkActivation);
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    // Unicode 11 width tables align xterm.js's wcwidth with what modern CLI
    // apps (Node.js / Ink-based UIs like Claude Code) assume, so CJK
    // characters reliably consume two cells instead of drifting between one
    // and two when an app redraws after IME input.
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(terminalHost);
    terminalHost._xterm = terminal;
    try { terminal.loadAddon(new WebglAddon()); } catch {}
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+Tab is reserved for pane MRU cycling — never let xterm forward
      // the literal Tab keystroke to the PTY.
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === 'Tab'
      ) {
        return false;
      }
      // Ctrl+Shift+C/V are reserved for copy/paste — handled by the
      // window-level shortcut handler. Returning false here prevents xterm
      // from consuming the event so it can bubble up and preventDefault()
      // runs before the WebView intercepts it for DevTools/Carets.
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === 'C' || event.key === 'c' || event.key === 'V' || event.key === 'v')
      ) {
        return false;
      }
      // Ctrl+ArrowLeft/Right are reserved for spatial pane navigation (VIB-71).
      // In WSL+zsh these send CSI sequences that xterm would forward to the PTY
      // as literal characters (e.g. 5D). Returning false stops xterm from
      // consuming the event so it reaches the window-level dispatcher.
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.code === 'ArrowLeft' || event.code === 'ArrowRight')
      ) {
        return false;
      }
      if (!isWindowsCtrlVPasteHotkey(event, bridge.platform)) {
        return true;
      }
      return false;
    });

    const node = {
      paneId: pane.id,
      cwd: pane.cwd,
      root: paneEl,
      terminalHost,
      terminal,
      fitAddon,
      sessionReady: false,
      sizeKey: '',
      needsFit: true,
      accent: pane.accent,
    };

    terminal.onData((data) => {
      if (node.sessionReady) {
        bridge.writeTerminal({ paneId: node.paneId, data });
      }
    });

    terminal.onTitleChange((nextTitle) => {
      const trimmedTitle = nextTitle.trim();
      if (!trimmedTitle) {
        return;
      }
      state.setPaneTerminalTitle?.(pane.id, trimmedTitle);
      onTerminalTitleChange?.(pane.id, trimmedTitle);
    });

    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        bridge.writeClipboardText(selection);
      }
    });

    terminal.parser.registerOscHandler(52, (data) => {
      const semicolon = data.indexOf(';');
      if (semicolon === -1) {
        return true;
      }
      const base64Text = data.slice(semicolon + 1);
      if (!base64Text || base64Text === '?') {
        return true;
      }
      try {
        const bytes = atob(base64Text);
        const text = new TextDecoder().decode(
          Uint8Array.from(bytes, (c) => c.charCodeAt(0))
        );
        bridge.writeClipboardText(text);
      } catch {}
      return true;
    });

    // OSC 7 handler for cwd tracking. Shells that support OSC 7 emit the
    // current working directory in the format \x1b]7;file://hostname/path\x07.
    // This allows us to track directory changes and persist them for session restore.
    terminal.parser.registerOscHandler(7, (data) => {
      const newCwd = extractPathFromOsc7(data);
      if (newCwd) {
        const existing = state.getPaneById?.(pane.id);
        if (existing && existing.cwd !== newCwd) {
          state.setPaneCwd?.(pane.id, newCwd);
          scheduleLayoutSave?.(5000);
        }
      }
      return true;
    });

    return node;
  }

  function fitTerminal(paneId, force = false) {
    const node = paneNodeMap.get(paneId);
    if (!node) return;
    const s = settings();
    node.terminal.options.fontSize = s.fontSize;
    node.terminal.options.fontFamily = s.fontFamily || getDefaultFontFamily(bridge.platform);
    node.fitAddon.fit();

    const cols = Math.max(20, node.terminal.cols || 80);
    const rows = Math.max(8, node.terminal.rows || 24);
    const nextSizeKey = `${cols}x${rows}`;

    if (node.sessionReady && (force || nextSizeKey !== node.sizeKey)) {
      bridge.resizeTerminal({
        paneId: node.paneId,
        cols,
        rows,
      });
      // SIGWINCH on the PTY usually triggers a screen redraw — those bytes
      // would otherwise look like background activity and trip the alert.
      paneActivityWatcher?.noteResize(node.paneId);
    }

    node.sizeKey = nextSizeKey;
    node.needsFit = false;
  }

  async function initializePaneTerminal(node) {
    fitTerminal(node.paneId, true);
    const pane = state.getPaneById?.(node.paneId);
    const profileId = pane?.shellProfileId ?? null;
    try {
      await bridge.createTerminal({
        paneId: node.paneId,
        cols: node.terminal.cols,
        rows: node.terminal.rows,
        cwd: node.cwd,
        shellProfileId: profileId,
      });
      node.sessionReady = true;
      fitTerminal(node.paneId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      node.terminal.writeln(`\x1b[38;5;204mFailed to start shell${profileId ? ` "${profileId}"` : ''}: ${message}\x1b[0m`);
    }
  }

  function ensurePaneNodes(containerEl) {
    const activeIds = new Set(state.getPanes().map((pane) => pane.id));

    for (const [paneId, node] of paneNodeMap.entries()) {
      if (!activeIds.has(paneId)) {
        paneActivityWatcher?.forget(paneId);
        bridge.destroyTerminal({ paneId });
        node.terminal.dispose();
        node.root.remove();
        paneNodeMap.delete(paneId);
      }
    }

    for (const pane of state.getPanes()) {
      if (!paneNodeMap.has(pane.id)) {
        const node = createPane(pane);
        paneNodeMap.set(pane.id, node);
        containerEl.append(node.root);
        paneActivityWatcher?.setPaneEnabled(pane.id, pane.breathingMonitor !== false);
        requestAnimationFrame(() => {
          initializePaneTerminal(node);
        });
      }
    }
  }

  function renderPanes(refit = false, stageEl) {
    const s = settings();
    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;
    const panes = state.getPanes();
    const previewWidth = getPreviewWidth(stageWidth, panes.length);
    const focusedIndex = state.getFocusedIndex();

    ensurePaneNodes(stageEl);
    paneActivityWatcher?.setFocus(state.getFocusedPaneId());

    panes.forEach((pane, index) => {
      const node = paneNodeMap.get(pane.id);
      if (!node) return;
      const left = getPaneLeft(index, previewWidth, focusedIndex);
      const isFocused = index === focusedIndex;
      const accentColor = pane.customColor || pane.accent;

      node.root.classList.toggle('is-focused', isFocused);
      node.root.classList.toggle('is-navigation-target', isFocused && getMode() === 'nav');
      node.root.style.setProperty('--pane-accent', accentColor);
      node.root.style.left = `${left}px`;
      node.root.style.zIndex = String(index + 1);
      node.root.style.height = `${stageHeight}px`;

      if (node.accent !== accentColor) {
        node.terminal.options.theme = createTerminalTheme(accentColor);
        node.accent = accentColor;
      }

      if (refit || node.needsFit) {
        fitTerminal(pane.id, true);
      }
    });
  }

  function getNode(paneId) {
    return paneNodeMap.get(paneId) ?? null;
  }

  function writeTerminal(paneId, data) {
    const node = paneNodeMap.get(paneId);
    if (!node) return;
    node.terminal.write(data);
    if (onTerminalData) {
      onTerminalData(paneId);
    }
  }

  function copySelection(paneId) {
    const node = paneNodeMap.get(paneId);
    if (!node) {
      return false;
    }
    const selection = node.terminal.getSelection();
    if (!selection) {
      return false;
    }
    bridge.writeClipboardText(selection);
    return true;
  }

  async function pasteInto(paneId, options = {}) {
    const node = paneNodeMap.get(paneId);
    if (!node?.sessionReady) {
      return false;
    }
    const text = options.clipboardSnapshot?.text ?? (await bridge.readClipboardText());
    if (!text) {
      return false;
    }
    if (bridge.platform === 'win32') {
      node.terminal.paste(text);
    } else {
      bridge.writeTerminal({ paneId: node.paneId, data: text });
    }
    return true;
  }

  function selectAll(paneId) {
    const node = paneNodeMap.get(paneId);
    if (!node) {
      return false;
    }
    node.terminal.selectAll();
    return true;
  }

  function focusTerminal(paneId) {
    const node = paneNodeMap.get(paneId);
    if (node) {
      requestAnimationFrame(() => {
        node.terminal.focus();
      });
    }
  }

  function blurTerminal(paneId) {
    const node = paneNodeMap.get(paneId);
    if (node) {
      node.terminal.blur();
    }
  }

  function destroyTerminal(paneId) {
    const node = paneNodeMap.get(paneId);
    if (!node) return;
    bridge.destroyTerminal({ paneId });
    node.terminal.dispose();
    node.root.remove();
    paneNodeMap.delete(paneId);
  }

  function changePaneShell(paneId, profileId) {
    const node = paneNodeMap.get(paneId);
    if (!node) return;

    const pane = state.getPaneById?.(paneId);
    const previousProfileId = pane?.shellProfileId ?? null;

    state.setPaneShellProfile?.(paneId, profileId);
    scheduleLayoutSave?.();

    // Suppress the exit handler — the old PTY is about to be replaced.
    // spawn() on the backend already destroys any previous session.
    node._shellChanging = true;
    node._shellChangeTime = Date.now();
    node.sessionReady = false;
    node.terminal.clear();
    initializePaneTerminal(node).finally(() => {
      node._shellChanging = false;
      // Revert profile on failure so the session doesn't persist a broken profile.
      if (!node.sessionReady) {
        state.setPaneShellProfile?.(paneId, previousProfileId);
        scheduleLayoutSave?.();
      }
    });
  }

  return {
    ensurePaneNodes,
    renderPanes,
    fitTerminal,
    getNode,
    writeTerminal,
    copySelection,
    pasteInto,
    selectAll,
    focusTerminal,
    blurTerminal,
    destroyTerminal,
    changePaneShell,
  };
}
