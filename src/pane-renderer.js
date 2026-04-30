import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { getDefaultFontFamily } from './settings.js';

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

export function getTextColorForBackground(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

export function createPaneRenderer({
  bridge,
  paneState,
  settingsManager,
  paneAlert,
  paneActivityWatcher,
  reportError,
  stageEl,
  getMode,
  onPaneClick,
  onTerminalTitleChange,
  onTerminalContextMenu,
  scheduleWindowLayoutSave,
  tabBar,
  getPaneLabel,
  onPaneCwdChanged,
}) {
  const paneNodeMap = new Map();

  function isWindowsCtrlVPasteHotkey(event) {
    return (
      bridge.platform === 'win32' &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'v'
    );
  }

  function getPreviewWidth(stageWidth, count) {
    if (count <= 1) {
      return 0;
    }

    if (stageWidth >= settingsManager.settings.paneWidth * count) {
      return settingsManager.settings.paneWidth;
    }

    return (stageWidth - settingsManager.settings.paneWidth) / (count - 1);
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

  function getPaneLeft(index, previewWidth, focusedIndex) {
    if (previewWidth >= settingsManager.settings.paneWidth) {
      return index * settingsManager.settings.paneWidth;
    }

    const focusedLeft = focusedIndex * previewWidth;

    if (index < focusedIndex) {
      return index * previewWidth;
    }

    if (index === focusedIndex) {
      return focusedLeft;
    }

    return focusedLeft + settingsManager.settings.paneWidth + (index - focusedIndex - 1) * previewWidth;
  }

  function createPane(pane) {
    const paneEl = document.createElement('article');
    paneEl.className = 'pane';
    const accentColor = pane.customColor || pane.accent;
    paneEl.style.setProperty('--pane-accent', accentColor);
    paneEl.addEventListener('click', () => {
      onPaneClick(pane.id);
    });

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

    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      convertEol: false,
      customGlyphs: true,
      cursorBlink: true,
      disableStdin: false,
      drawBoldTextInBrightColors: false,
      fontFamily: settingsManager.settings.fontFamily || getDefaultFontFamily(bridge.platform),
      fontSize: settingsManager.settings.fontSize,
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
      if (!isWindowsCtrlVPasteHotkey(event)) {
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

    terminalHost.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onPaneClick(node.paneId, { focusTerminal: false });
      void onTerminalContextMenu(node, event);
    });

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
      onTerminalTitleChange(pane.id, trimmedTitle);
      if (entryNeedsTabRefresh(pane.id)) {
        tabBar.renderTabs();
      }
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
        onPaneCwdChanged(pane.id, newCwd);
      }
      return true;
    });

    return node;
  }

  function entryNeedsTabRefresh(paneId) {
    const pane = paneState.getPaneById(paneId);
    return Boolean(pane && pane.title === null);
  }

  function fitTerminal(node, force = false) {
    node.terminal.options.fontSize = settingsManager.settings.fontSize;
    node.terminal.options.fontFamily = settingsManager.settings.fontFamily || getDefaultFontFamily(bridge.platform);
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
      paneActivityWatcher.noteResize(node.paneId);
    }

    node.sizeKey = nextSizeKey;
    node.needsFit = false;
  }

  async function initializePaneTerminal(node) {
    fitTerminal(node, true);
    const pane = paneState.getPaneById(node.paneId);
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
      fitTerminal(node, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      node.terminal.writeln(`\x1b[38;5;204mFailed to start shell${profileId ? ` "${profileId}"` : ''}: ${message}\x1b[0m`);
    }
  }

  function ensurePaneNodes() {
    const currentPanes = paneState.getPanes();
    const activeIds = new Set(currentPanes.map((pane) => pane.id));

    for (const [paneId, node] of paneNodeMap.entries()) {
      if (!activeIds.has(paneId)) {
        paneActivityWatcher.forget(paneId);
        bridge.destroyTerminal({ paneId });
        node.terminal.dispose();
        node.root.remove();
        paneNodeMap.delete(paneId);
      }
    }

    for (const pane of currentPanes) {
      if (!paneNodeMap.has(pane.id)) {
        const node = createPane(pane);
        paneNodeMap.set(pane.id, node);
        stageEl.append(node.root);
        paneActivityWatcher.setPaneEnabled(pane.id, pane.breathingMonitor !== false);
        requestAnimationFrame(() => {
          initializePaneTerminal(node);
        });
      }
    }
  }

  function renderPanes(refit = false) {
    const currentPanes = paneState.getPanes();
    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;
    const previewWidth = getPreviewWidth(stageWidth, currentPanes.length);
    const focusedIndex = paneState.getFocusedIndex();

    ensurePaneNodes();
    paneActivityWatcher.setFocus(paneState.getFocusedPaneId());

    currentPanes.forEach((pane, index) => {
      const node = paneNodeMap.get(pane.id);
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
        fitTerminal(node, true);
      }
    });
  }

  function getNode(paneId) {
    return paneNodeMap.get(paneId) ?? null;
  }

  async function getClipboardSnapshot() {
    try {
      return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
    } catch {
      return { text: '', hasImage: false };
    }
  }

  function copyTerminalSelection(paneId) {
    const node = getNode(paneId);
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

  async function pasteIntoTerminal(paneId, options = {}) {
    const node = getNode(paneId);
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

  function selectAllInTerminal(paneId) {
    const node = getNode(paneId);
    if (!node) {
      return false;
    }

    node.terminal.selectAll();
    return true;
  }

  async function pasteImageIntoTerminal(paneId, options = {}) {
    const node = getNode(paneId);
    if (!node?.sessionReady) {
      return false;
    }

    const clipboardSnapshot = options.clipboardSnapshot ?? (await getClipboardSnapshot());
    if (!clipboardSnapshot.hasImage) {
      return false;
    }

    bridge.writeTerminal({ paneId: node.paneId, data: '\u0016' });
    return true;
  }

  function changePaneShell(paneId, profileId, previousProfileId) {
    const node = getNode(paneId);
    if (!node) return;

    const prevProfileId = previousProfileId ?? paneState.getPaneById(paneId)?.shellProfileId ?? null;

    paneState.setPaneShellProfile(paneId, profileId);
    scheduleWindowLayoutSave();

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
        paneState.setPaneShellProfile(paneId, prevProfileId);
        scheduleWindowLayoutSave();
      }
    });
  }

  function destroyPane(paneId) {
    const node = getNode(paneId);
    if (!node) return;
    paneActivityWatcher.forget(paneId);
    bridge.destroyTerminal({ paneId });
    node.terminal.dispose();
    node.root.remove();
    paneNodeMap.delete(paneId);
  }

  return {
    ensurePaneNodes,
    renderPanes,
    fitTerminal: (paneId, force = false) => {
      const node = getNode(paneId);
      if (!node) return;
      fitTerminal(node, force);
    },
    getNode,
    write: (paneId, data) => {
      const node = getNode(paneId);
      if (!node) return;
      node.terminal.write(data);
      paneActivityWatcher.noteData(paneId);
    },
    copySelection: copyTerminalSelection,
    pasteInto: pasteIntoTerminal,
    selectAll: selectAllInTerminal,
    focusTerminal: (paneId) => {
      const node = getNode(paneId);
      if (!node) return;
      requestAnimationFrame(() => {
        node.terminal.focus();
      });
    },
    blurTerminal: (paneId) => {
      const node = getNode(paneId);
      if (!node) return;
      node.terminal.blur();
    },
    clearTerminal: (paneId) => {
      const node = getNode(paneId);
      if (!node) return;
      node.terminal.clear();
    },
    writeln: (paneId, text) => {
      const node = getNode(paneId);
      if (!node) return;
      node.terminal.writeln(text);
    },
    changePaneShell,
    entryNeedsTabRefresh,
    setAlerted: (paneId, alerted) => {
      const node = getNode(paneId);
      if (!node) return;
      paneAlert.setAlerted(node.root, alerted);
    },
    rootContains: (paneId, el) => {
      const node = getNode(paneId);
      if (!node) return false;
      return node.root.contains(el);
    },
    hasSelection: (paneId) => {
      const node = getNode(paneId);
      if (!node) return false;
      return node.terminal.hasSelection();
    },
    isSessionReady: (paneId) => {
      const node = getNode(paneId);
      if (!node) return false;
      return node.sessionReady;
    },
    setSessionReady: (paneId, ready) => {
      const node = getNode(paneId);
      if (!node) return;
      node.sessionReady = ready;
    },
    getShellChangeTime: (paneId) => {
      const node = getNode(paneId);
      if (!node) return null;
      return node._shellChangeTime;
    },
    isShellChanging: (paneId) => {
      const node = getNode(paneId);
      if (!node) return false;
      return node._shellChanging;
    },
    destroyPane,
  };
}
