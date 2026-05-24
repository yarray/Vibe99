import type { PaneState } from './pane-state';
import type { PaneAlertStrategy } from './pane-alert-breathing-mask';
import type { SettingsManager } from './settings';
import type { Workbench } from './runtime/workbench';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface PaneRendererDeps {
  paneState: PaneState;
  settingsManager: SettingsManager;
  paneAlert: PaneAlertStrategy;
  paneActivityWatcher: {
    setFocus: (paneId: string | null) => void;
  };
  stageEl: HTMLElement;
  getMode: () => string;
  workbench: Workbench;
}

export interface PaneRenderer {
  /** Ensure sessions are synchronized with Layout's pane collection. */
  ensureSessions: () => void;
  renderPanes: (refit?: boolean) => void;
  fitTerminal: (paneId: string, force?: boolean) => void;
  write: (paneId: string, data: string) => void;
  clearTerminal: (paneId: string) => void;
  writeln: (paneId: string, text: string) => void;
  /** Refresh all activity fingerprint snapshots to current buffer state. */
  refreshActivitySnapshots: () => void;
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
  getWorkbench: () => Workbench;
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
  paneState,
  settingsManager,
  paneAlert,
  paneActivityWatcher,
  stageEl,
  getMode,
  workbench,
}: PaneRendererDeps): PaneRenderer {

  // -- Layout helpers -----------------------------------------------------------

  function getPreviewWidth(stageWidth: number, count: number): number {
    if (count <= 1) {
      return 0;
    }

    const resolvedPaneWidth = settingsManager.getResolvedSettings().paneWidth;
    if (stageWidth >= resolvedPaneWidth * count) {
      return resolvedPaneWidth;
    }

    return (stageWidth - resolvedPaneWidth) / (count - 1);
  }

  function getPaneLeft(index: number, previewWidth: number, focusedIndex: number): number {
    const resolvedPaneWidth = settingsManager.getResolvedSettings().paneWidth;
    if (previewWidth >= resolvedPaneWidth) {
      return index * resolvedPaneWidth;
    }

    const focusedLeft = focusedIndex * previewWidth;

    if (index < focusedIndex) {
      return index * previewWidth;
    }

    if (index === focusedIndex) {
      return focusedLeft;
    }

    return focusedLeft + resolvedPaneWidth + (index - focusedIndex - 1) * previewWidth;
  }

  // -- Tab refresh check --------------------------------------------------------

  function entryNeedsTabRefresh(paneId: string): boolean {
    const pane = paneState.getPaneById(paneId);
    return Boolean(pane && pane.title === null);
  }

  // -- Rendering ----------------------------------------------------------------

  function renderPanes(refit = false): void {
    const currentPanes = paneState.getPanes();
    const stageWidth = stageEl.clientWidth;
    const stageHeight = stageEl.clientHeight;
    const previewWidth = getPreviewWidth(stageWidth, currentPanes.length);
    const focusedIndex = paneState.getFocusedIndex();

    workbench.ensureSessions();
    paneActivityWatcher.setFocus(paneState.getFocusedPaneId());

    currentPanes.forEach((pane, index) => {
      const session = workbench.session(pane.id);
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
      session.setTheme(pane.themeId);
      session.setCursorBlink(isFocused && document.visibilityState === 'visible');

      if (refit || session.needsFit()) {
        session.fit({ force: true });
      }
    });
  }

  // -- Public API ---------------------------------------------------------------

  return {
    ensureSessions: () => workbench.ensureSessions(),
    renderPanes,
    fitTerminal: (paneId, force = false) => {
      const session = workbench.session(paneId);
      if (!session) return;
      session.fit({ force });
    },
    write: (paneId, data) => {
      const session = workbench.session(paneId);
      if (!session) return;
      session.write(data);
    },
    clearTerminal: (paneId) => {
      const session = workbench.session(paneId);
      if (!session) return;
      session.clear();
    },
    writeln: (paneId, text) => {
      const session = workbench.session(paneId);
      if (!session) return;
      session.writeLine(text);
    },
    refreshActivitySnapshots: () => {
      for (const pane of paneState.getPanes()) {
        const session = workbench.session(pane.id);
        if (session) session.refreshActivitySnapshot();
      }
    },
    entryNeedsTabRefresh,
    setAlerted: (paneId, alerted) => {
      const session = workbench.session(paneId);
      if (!session) return;
      paneAlert.setAlerted(session.root, alerted);
    },
    hasAlertClass: (paneId) => {
      const session = workbench.session(paneId);
      if (!session) return false;
      return session.root.classList.contains('has-pending-activity');
    },
    rootContains: (paneId, el) => {
      const session = workbench.session(paneId);
      if (!session) return false;
      return session.contains(el);
    },
    hasSelection: (paneId) => {
      const session = workbench.session(paneId);
      if (!session) return false;
      return session.hasSelection();
    },
    isSessionReady: (paneId) => {
      const session = workbench.session(paneId);
      if (!session) return false;
      return session.isReady();
    },
    closeSession: (paneId, options) => workbench.closeSession(paneId, options),
    getRecentOutput: (paneId, maxLines = 20) => {
      const session = workbench.session(paneId);
      if (!session) return '';
      return session.getRecentOutput(maxLines);
    },
    getWorkbench: () => workbench,
  };
}
