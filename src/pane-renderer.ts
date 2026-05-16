import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Bridge } from './bridge';
import type { Pane, PaneState } from './pane-state';
import type { PaneAlertStrategy } from './pane-alert-breathing-mask';
import type { SettingsManager } from './settings';
import type { TabBar } from './tab-bar';
import {
  createTerminalSession,
  type TerminalSession,
  type ContextMenuCallback,
} from './runtime/terminal-session';
import type { Workbench } from './runtime/workbench';

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
  onTerminalContextMenu: (paneId: string, event: MouseEvent) => Promise<void> | void;
  scheduleWindowLayoutSave: () => void;
  tabBar: TabBar;
  getPaneLabel: (pane: Pane) => string;
  onPaneCwdChanged: (paneId: string, cwd: string) => void;
}

export interface PaneRenderer {
  /** @deprecated Use ensureSessions() instead. Will be removed in Step 5. */
  ensurePaneNodes: () => void;
  /** Ensure sessions are synchronized with Layout's pane collection. */
  ensureSessions: () => void;
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
  restartPaneTerminal: (paneId: string) => void;
  entryNeedsTabRefresh: (paneId: string) => boolean;
  setAlerted: (paneId: string, alerted: boolean) => void;
  rootContains: (paneId: string, el: Node) => boolean;
  hasSelection: (paneId: string) => boolean;
  isSessionReady: (paneId: string) => boolean;
  setSessionReady: (paneId: string, ready: boolean) => void;
  getShellChangeTime: (paneId: string) => number | null;
  isShellChanging: (paneId: string) => boolean;
  initializePaneTerminal: (node: PaneNode) => Promise<void>;
  /** @deprecated Use closeSession() instead. Will be removed in Step 5. */
  destroyPane: (paneId: string) => void;
  /** Close a session for a specific pane. */
  closeSession: (paneId: string, options?: { destroyPty?: boolean }) => void;
  getRecentOutput: (paneId: string, maxLines?: number) => string;
  /** Get the Workbench instance (for coordination layer). */
  getWorkbench: () => Workbench | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getTextColorForBackground(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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
  // Direct session map - this is the internal state that will be managed by Workbench
  // In Step 5, this will move entirely into Workbench
  const sessionMap = new Map<string, TerminalSession>();

  // -- PaneNode adapter ---------------------------------------------------------

  function sessionToNode(session: TerminalSession): PaneNode {
    return {
      paneId: session.paneId,
      cwd: session.cwd,
      root: session.root,
      terminalHost: session.terminalHost,
      terminal: session.terminal,
      fitAddon: session.fitAddon,
      sessionReady: session.isReady(),
      sizeKey: '',
      needsFit: session.needsFit(),
      accent: '',
      _shellChanging: session.isShellChanging(),
      _shellChangeTime: session.shellChangeTime() ?? undefined,
    };
  }

  function getNode(paneId: string): PaneNode | null {
    const session = sessionMap.get(paneId);
    return session ? sessionToNode(session) : null;
  }

  // -- Layout helpers -----------------------------------------------------------

  function getPreviewWidth(stageWidth: number, count: number): number {
    if (count <= 1) {
      return 0;
    }

    if (stageWidth >= settingsManager.settings.paneWidth * count) {
      return settingsManager.settings.paneWidth;
    }

    return (stageWidth - settingsManager.settings.paneWidth) / (count - 1);
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

  // -- Tab refresh check --------------------------------------------------------

  function entryNeedsTabRefresh(paneId: string): boolean {
    const pane = paneState.getPaneById(paneId);
    return Boolean(pane && pane.title === null);
  }

  // -- Session creation ---------------------------------------------------------

  function createSession(pane: Pane): TerminalSession {
    paneAlert.attach();

    const session = createTerminalSession({
      bridge,
      settingsManager,
      activityWatcher: paneActivityWatcher,
      reportError,
      getPaneSnapshot: () => paneState.getPaneById(pane.id),
      onPaneClick,
      onTitleChange: onTerminalTitleChange,
      onContextMenu: (session, event) => {
        return onTerminalContextMenu(session.paneId, event);
      },
      onCwdChanged: onPaneCwdChanged,
      onTabRefreshNeeded: (paneId: string) => {
        if (entryNeedsTabRefresh(paneId)) {
          tabBar.renderTabs();
        }
      },
    });

    return session;
  }

  // -- Pane lifecycle -----------------------------------------------------------

  function ensurePaneNodes(): void {
    // Synchronize sessions with current pane list
    const currentPanes = paneState.getPanes();
    const activeIds = new Set(currentPanes.map((pane) => pane.id));

    for (const [paneId, session] of sessionMap.entries()) {
      if (!activeIds.has(paneId)) {
        session.close({ destroyPty: true });
        sessionMap.delete(paneId);
      }
    }

    for (const pane of currentPanes) {
      if (!sessionMap.has(pane.id)) {
        const session = createSession(pane);
        sessionMap.set(pane.id, session);
        stageEl.append(session.root);
        paneActivityWatcher.setPaneEnabled(pane.id, pane.breathingMonitor !== false);
        requestAnimationFrame(() => {
          session.initializePty();
        });
      }
    }
  }

  function ensureSessions(): void {
    // New API name for the same operation
    ensurePaneNodes();
  }

  // -- Rendering ----------------------------------------------------------------

  function renderPanes(refit = false): void {
    const currentPanes = paneState.getPanes();
    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;
    const previewWidth = getPreviewWidth(stageWidth, currentPanes.length);
    const focusedIndex = paneState.getFocusedIndex();

    ensurePaneNodes();
    paneActivityWatcher.setFocus(paneState.getFocusedPaneId());

    currentPanes.forEach((pane, index) => {
      const session = sessionMap.get(pane.id);
      if (!session) return;
      const left = getPaneLeft(index, previewWidth, focusedIndex);
      const isFocused = index === focusedIndex;
      const accentColor = pane.customColor || pane.accent;

      session.root.classList.toggle('is-focused', isFocused);
      session.root.classList.toggle('is-navigation-target', isFocused && getMode() === 'nav');
      session.root.style.setProperty('--pane-accent', accentColor);
      session.root.style.left = `${left}px`;
      session.root.style.zIndex = String(index + 1);
      session.root.style.height = `${stageHeight}px`;

      session.setAccent(accentColor);

      if (refit || session.needsFit()) {
        session.fit({ force: true });
      }
    });
  }

  // -- Per-pane operations ------------------------------------------------------

  async function initializePaneTerminal(node: PaneNode): Promise<void> {
    const session = sessionMap.get(node.paneId);
    if (session) {
      await session.initializePty();
    }
  }

  function destroyPane(paneId: string): void {
    const session = sessionMap.get(paneId);
    if (!session) return;
    session.close({ destroyPty: true });
    sessionMap.delete(paneId);
  }

  function closeSession(paneId: string, options: { destroyPty?: boolean } = {}): void {
    const session = sessionMap.get(paneId);
    if (!session) return;
    const { destroyPty = true } = options;
    session.close({ destroyPty });
    sessionMap.delete(paneId);
  }

  function changePaneShell(paneId: string, profileId: string, previousProfileId?: string | null): void {
    const session = sessionMap.get(paneId);
    if (!session) return;

    const prevProfileId = previousProfileId ?? paneState.getPaneById(paneId)?.shellProfileId ?? null;

    paneState.setPaneShellProfile(paneId, profileId);
    scheduleWindowLayoutSave();

    session.changeShell(profileId, prevProfileId);

    // The revert-on-failure logic requires access to paneState and scheduleWindowLayoutSave,
    // which are owned by pane-renderer, not TerminalSession. So we wrap changeShell here.
    // TerminalSession.changeShell handles the PTY lifecycle; we handle state revert.
    // We need to observe when the shell change finishes and revert if needed.
    // Since changeShell is async internally, we poll for the result.
    const checkRevert = (): void => {
      requestAnimationFrame(() => {
        if (!session.isShellChanging()) {
          if (!session.isReady()) {
            paneState.setPaneShellProfile(paneId, prevProfileId);
            scheduleWindowLayoutSave();
          }
        } else {
          checkRevert();
        }
      });
    };
    checkRevert();
  }

  function restartPaneTerminal(paneId: string): void {
    const session = sessionMap.get(paneId);
    if (!session) return;
    session.restart();
  }

  // -- Public API ---------------------------------------------------------------

  return {
    ensurePaneNodes,
    ensureSessions,
    renderPanes,
    fitTerminal: (paneId, force = false) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.fit({ force });
    },
    getNode,
    write: (paneId, data) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.write(data);
    },
    copySelection: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return false;
      return session.copySelection();
    },
    pasteInto: (paneId, options?) => {
      const session = sessionMap.get(paneId);
      if (!session) return Promise.resolve(false);
      return session.paste(options);
    },
    selectAll: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return false;
      return session.selectAll();
    },
    focusTerminal: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.focus();
    },
    blurTerminal: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.blur();
    },
    clearTerminal: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.clear();
    },
    writeln: (paneId, text) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.writeLine(text);
    },
    changePaneShell,
    restartPaneTerminal,
    entryNeedsTabRefresh,
    setAlerted: (paneId, alerted) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      paneAlert.setAlerted(session.root, alerted);
    },
    rootContains: (paneId, el) => {
      const session = sessionMap.get(paneId);
      if (!session) return false;
      return session.contains(el);
    },
    hasSelection: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return false;
      return session.hasSelection();
    },
    isSessionReady: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return false;
      return session.isReady();
    },
    setSessionReady: (paneId, ready) => {
      const session = sessionMap.get(paneId);
      if (!session) return;
      session.setReady(ready);
    },
    getShellChangeTime: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return null;
      return session.shellChangeTime();
    },
    isShellChanging: (paneId) => {
      const session = sessionMap.get(paneId);
      if (!session) return false;
      return session.isShellChanging();
    },
    initializePaneTerminal,
    destroyPane,
    closeSession,
    getRecentOutput: (paneId, maxLines = 20) => {
      const session = sessionMap.get(paneId);
      if (!session) return '';
      return session.getRecentOutput(maxLines);
    },
    getWorkbench: () => null, // Will be implemented in Step 5
  };
}
