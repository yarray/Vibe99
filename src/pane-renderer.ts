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
  /** When provided, session ownership is delegated to this Workbench. */
  workbench?: Workbench;
}

export interface PaneRenderer {
  /** Ensure sessions are synchronized with Layout's pane collection. */
  ensureSessions: () => void;
  renderPanes: (refit?: boolean) => void;
  fitTerminal: (paneId: string, force?: boolean) => void;
  write: (paneId: string, data: string) => void;
  clearTerminal: (paneId: string) => void;
  writeln: (paneId: string, text: string) => void;
  entryNeedsTabRefresh: (paneId: string) => boolean;
  setAlerted: (paneId: string, alerted: boolean) => void;
  /** Check whether the pane's root element has the alert CSS class. */
  hasAlertClass: (paneId: string) => boolean;
  rootContains: (paneId: string, el: Node) => boolean;
  hasSelection: (paneId: string) => boolean;
  isSessionReady: (paneId: string) => boolean;
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
  workbench,
}: PaneRendererDeps): PaneRenderer {
  const sessionMap = workbench ? null : new Map<string, TerminalSession>();

  function resolveSession(paneId: string): TerminalSession | undefined {
    if (workbench) return workbench.session(paneId) ?? undefined;
    return sessionMap!.get(paneId);
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

  function ensureSessions(): void {
    if (workbench) {
      workbench.ensureSessions();
      return;
    }
    const currentPanes = paneState.getPanes();
    const activeIds = new Set(currentPanes.map((pane) => pane.id));

    for (const [paneId, session] of sessionMap!.entries()) {
      if (!activeIds.has(paneId)) {
        session.close({ destroyPty: true });
        sessionMap!.delete(paneId);
      }
    }

    for (const pane of currentPanes) {
      if (!sessionMap!.has(pane.id)) {
        const session = createSession(pane);
        sessionMap!.set(pane.id, session);
        stageEl.append(session.root);
        paneActivityWatcher.setPaneEnabled(pane.id, pane.breathingMonitor !== false);
        requestAnimationFrame(() => {
          session.initializePty();
        });
      }
    }
  }

  // -- Rendering ----------------------------------------------------------------

  function renderPanes(refit = false): void {
    const currentPanes = paneState.getPanes();
    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;
    const previewWidth = getPreviewWidth(stageWidth, currentPanes.length);
    const focusedIndex = paneState.getFocusedIndex();

    ensureSessions();
    paneActivityWatcher.setFocus(paneState.getFocusedPaneId());

    currentPanes.forEach((pane, index) => {
      const session = resolveSession(pane.id);
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

  function closeSession(paneId: string, options: { destroyPty?: boolean } = {}): void {
    if (workbench) {
      workbench.closeSession(paneId, options);
      return;
    }
    const session = sessionMap!.get(paneId);
    if (!session) return;
    const { destroyPty = true } = options;
    session.close({ destroyPty });
    sessionMap!.delete(paneId);
  }

  // -- Public API ---------------------------------------------------------------

  return {
    ensureSessions,
    renderPanes,
    fitTerminal: (paneId, force = false) => {
      const session = resolveSession(paneId);
      if (!session) return;
      session.fit({ force });
    },
    write: (paneId, data) => {
      const session = resolveSession(paneId);
      if (!session) return;
      session.write(data);
    },
    clearTerminal: (paneId) => {
      const session = resolveSession(paneId);
      if (!session) return;
      session.clear();
    },
    writeln: (paneId, text) => {
      const session = resolveSession(paneId);
      if (!session) return;
      session.writeLine(text);
    },
    entryNeedsTabRefresh,
    setAlerted: (paneId, alerted) => {
      const session = resolveSession(paneId);
      if (!session) return;
      paneAlert.setAlerted(session.root, alerted);
    },
    hasAlertClass: (paneId) => {
      const session = resolveSession(paneId);
      if (!session) return false;
      return session.root.classList.contains('has-pending-activity');
    },
    rootContains: (paneId, el) => {
      const session = resolveSession(paneId);
      if (!session) return false;
      return session.contains(el);
    },
    hasSelection: (paneId) => {
      const session = resolveSession(paneId);
      if (!session) return false;
      return session.hasSelection();
    },
    isSessionReady: (paneId) => {
      const session = resolveSession(paneId);
      if (!session) return false;
      return session.isReady();
    },
    closeSession,
    getRecentOutput: (paneId, maxLines = 20) => {
      const session = resolveSession(paneId);
      if (!session) return '';
      return session.getRecentOutput(maxLines);
    },
    getWorkbench: () => workbench ?? null,
  };
}
