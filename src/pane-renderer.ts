import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { getDefaultFontFamily } from './settings';
import type { Bridge } from './bridge';
import type { Pane, PaneState } from './pane-state';
import type { PaneAlertStrategy } from './pane-alert-breathing-mask';
import type { SettingsManager } from './settings';
import type { TabBar } from './tab-bar';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface PaneNode {
  paneId: string;
  cwd: string;
  root: HTMLElement;
  terminalHost: HTMLElement & { _xterm?: Terminal };
  terminal: Terminal;
  fitAddon: FitAddon;
  sessionReady: boolean;
  sizeKey: string;
  needsFit: boolean;
  accent: string;
  _shellChanging?: boolean;
  _shellChangeTime?: number;
}

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  [colorName: string]: string;
}

export interface PaneRendererDeps {
  bridge: Bridge;
  paneState: PaneState;
  settingsManager: SettingsManager;
  paneAlert: PaneAlertStrategy;
  paneActivityWatcher: {
    noteResize: (paneId: string) => void;
    noteData: (paneId: string) => void;
    setFocus: (paneId: string | null) => void;
    forget: (paneId: string) => void;
    setPaneEnabled: (paneId: string, enabled: boolean) => void;
  };
  reportError: (error: unknown) => void;
  stageEl: HTMLElement;
  getMode: () => string;
  onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  onTerminalTitleChange: (paneId: string, title: string) => void;
  onTerminalContextMenu: (node: PaneNode, event: MouseEvent) => Promise<void> | void;
  scheduleWindowLayoutSave: () => void;
  tabBar: TabBar;
  getPaneLabel: (pane: Pane) => string;
  onPaneCwdChanged: (paneId: string, cwd: string) => void;
}

export interface PaneRenderer {
  ensurePaneNodes: () => void;
  renderPanes: (refit?: boolean) => void;
  fitTerminal: (paneId: string, force?: boolean) => void;
  getNode: (paneId: string) => PaneNode | null;
  write: (paneId: string, data: string) => void;
  copySelection: (paneId: string) => boolean;
  pasteInto: (paneId: string, options?: { clipboardSnapshot?: { text: string; hasImage: boolean } }) => Promise<boolean>;
  selectAll: (paneId: string) => boolean;
  focusTerminal: (paneId: string) => void;
  blurTerminal: (paneId: string) => void;
  clearTerminal: (paneId: string) => void;
  writeln: (paneId: string, text: string) => void;
  changePaneShell: (paneId: string, profileId: string, previousProfileId?: string | null) => void;
  entryNeedsTabRefresh: (paneId: string) => boolean;
  setAlerted: (paneId: string, alerted: boolean) => void;
  rootContains: (paneId: string, el: Node) => boolean;
  hasSelection: (paneId: string) => boolean;
  isSessionReady: (paneId: string) => boolean;
  setSessionReady: (paneId: string, ready: boolean) => void;
  getShellChangeTime: (paneId: string) => number | null;
  isShellChanging: (paneId: string) => boolean;
  initializePaneTerminal: (node: PaneNode) => Promise<void>;
  destroyPane: (paneId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPathFromOsc7(data: string): string | null {
  const prefix = 'file://';
  if (!data.startsWith(prefix)) {
    return null;
  }
  const afterPrefix = data.slice(prefix.length);
  const slashIndex = afterPrefix.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  let encodedPath = afterPrefix.slice(slashIndex);
  if (/^\/[A-Za-z]:\//.test(encodedPath)) {
    encodedPath = encodedPath.slice(1);
  }
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

export function getTextColorForBackground(hexColor: string): string {
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
}: PaneRendererDeps): PaneRenderer {
  const paneNodeMap = new Map<string, PaneNode>();

  function isWindowsCtrlVPasteHotkey(event: KeyboardEvent): boolean {
    return (
      bridge.platform === 'win32' &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'v'
    );
  }

  function getPreviewWidth(stageWidth: number, count: number): number {
    if (count <= 1) {
      return 0;
    }

    if (stageWidth >= settingsManager.settings.paneWidth * count) {
      return settingsManager.settings.paneWidth;
    }

    return (stageWidth - settingsManager.settings.paneWidth) / (count - 1);
  }

  function createTerminalTheme(accent: string): TerminalTheme {
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

  function isLinkOpenModifierPressed(event: MouseEvent | KeyboardEvent): boolean {
    return event.ctrlKey || (bridge.platform === 'darwin' && event.metaKey);
  }

  function handleTerminalLinkActivation(event: MouseEvent, uri: string): void {
    if (!isLinkOpenModifierPressed(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void Promise.resolve(bridge.openExternalUrl(uri)).catch(reportError);
  }

  function getPaneLeft(index: number, previewWidth: number, focusedIndex: number): number {
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

  function createPane(pane: Pane): PaneNode {
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
    paneAlert.attach();
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
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(terminalHost);
    (terminalHost as HTMLDivElement & { _xterm?: Terminal })._xterm = terminal;
    try { terminal.loadAddon(new WebglAddon()); } catch {}
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === 'Tab'
      ) {
        return false;
      }
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

    terminal.parser.registerOscHandler(7, (data) => {
      const newCwd = extractPathFromOsc7(data);
      if (newCwd) {
        onPaneCwdChanged(pane.id, newCwd);
      }
      return true;
    });

    return node;
  }

  function entryNeedsTabRefresh(paneId: string): boolean {
    const pane = paneState.getPaneById(paneId);
    return Boolean(pane && pane.title === null);
  }

  function fitTerminal(node: PaneNode, force = false): void {
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
      paneActivityWatcher.noteResize(node.paneId);
    }

    node.sizeKey = nextSizeKey;
    node.needsFit = false;
  }

  async function initializePaneTerminal(node: PaneNode): Promise<void> {
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

  function ensurePaneNodes(): void {
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

  function renderPanes(refit = false): void {
    const currentPanes = paneState.getPanes();
    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;
    const previewWidth = getPreviewWidth(stageWidth, currentPanes.length);
    const focusedIndex = paneState.getFocusedIndex();

    ensurePaneNodes();
    paneActivityWatcher.setFocus(paneState.getFocusedPaneId());

    currentPanes.forEach((pane, index) => {
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
        fitTerminal(node, true);
      }
    });
  }

  function getNode(paneId: string): PaneNode | null {
    return paneNodeMap.get(paneId) ?? null;
  }

  async function getClipboardSnapshot(): Promise<{ text: string; hasImage: boolean }> {
    try {
      return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
    } catch {
      return { text: '', hasImage: false };
    }
  }

  function copyTerminalSelection(paneId: string): boolean {
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

  async function pasteIntoTerminal(paneId: string, options: { clipboardSnapshot?: { text: string; hasImage: boolean } } = {}): Promise<boolean> {
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

  function selectAllInTerminal(paneId: string): boolean {
    const node = getNode(paneId);
    if (!node) {
      return false;
    }

    node.terminal.selectAll();
    return true;
  }

  async function pasteImageIntoTerminal(paneId: string, options: { clipboardSnapshot?: { text: string; hasImage: boolean } } = {}): Promise<boolean> {
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

  function changePaneShell(paneId: string, profileId: string, previousProfileId?: string | null): void {
    const node = getNode(paneId);
    if (!node) return;

    const prevProfileId = previousProfileId ?? paneState.getPaneById(paneId)?.shellProfileId ?? null;

    paneState.setPaneShellProfile(paneId, profileId);
    scheduleWindowLayoutSave();

    node._shellChanging = true;
    node._shellChangeTime = Date.now();
    node.sessionReady = false;
    node.terminal.clear();
    initializePaneTerminal(node).finally(() => {
      node._shellChanging = false;
      if (!node.sessionReady) {
        paneState.setPaneShellProfile(paneId, prevProfileId);
        scheduleWindowLayoutSave();
      }
    });
  }

  function destroyPane(paneId: string): void {
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
      return node._shellChangeTime ?? null;
    },
    isShellChanging: (paneId) => {
      const node = getNode(paneId);
      if (!node) return false;
      return node._shellChanging ?? false;
    },
    initializePaneTerminal: (node) => initializePaneTerminal(node),
    destroyPane,
  };
}
