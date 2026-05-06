// Pane operations — coordinates paneState, paneRenderer, tabBar, and layoutManager.

import type { Pane, PaneState } from './pane-state';
import type { PaneRenderer } from './pane-renderer';
import type { TabBar, TabBarLocalState } from './tab-bar';
import type { Bridge, ClipboardSnapshot } from './bridge';
import type { FocusController } from './manager/create-focus-controller.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Minimal subset of the layout-manager API used by pane-operations. */
export interface LayoutManagerHandle {
  scheduleWindowLayoutSave: (delay?: number) => void;
}

/** Dependencies injected into `createPaneOperations`. */
export interface PaneOperationsDeps {
  paneState: PaneState;
  paneRenderer: PaneRenderer;
  tabBar: TabBar;
  layoutManager: LayoutManagerHandle;
  render: (refit?: boolean) => void;
  focusController: FocusController;
  state: TabBarLocalState;
}

/** The full public API surface returned by `createPaneOperations`. */
export interface PaneOperations {
  focusPane: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  refocusCurrentPaneTerminal: () => void;
  blurFocusedTerminal: () => void;
  addPane: (shellProfileId?: string | null) => string;
  closePane: (index: number, options?: { destroyTerminal?: boolean }) => void;
  moveFocus: (delta: number) => void;
  navigateLeft: () => void;
  navigateRight: () => void;
  cycleToRecentPane: (options?: { reverse?: boolean }) => void;
  commitPaneCycle: () => void;
  cycleToNextLitPane: () => void;
  focusPaneAt: (index: number) => void;
  getPaneCount: () => number;
  getPaneIdAt: (index: number) => string | null;
  requestClosePane: (paneId: string) => void;
  startInlineRename: (paneId: string) => void;
  togglePaneBreathingMonitor: (paneId: string) => boolean;
  getFocusedPaneAccent: () => string;
  isEditableTarget: () => boolean;
  getClipboardSnapshot: (bridge: Bridge) => Promise<ClipboardSnapshot>;
  getPaneLabel: (pane: Pane) => string;
  handleTerminalExit: (event: { paneId: string; exitCode: number; reason: string }) => boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaneOperations({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  render,
  focusController,
  state,
}: PaneOperationsDeps): PaneOperations {
  function focusPane(paneId: string, options: { focusTerminal?: boolean } = {}): void {
    const { focusTerminal = true } = options;
    if (!focusController.focusPane(paneId)) return;
    paneRenderer?.setAlerted(paneId, false);
    if (focusTerminal) {
      paneRenderer?.focusTerminal(paneId);
    }
  }

  function refocusCurrentPaneTerminal(): void {
    const paneId = focusController.getActiveId();
    if (!paneId) return;
    focusController.setMode('terminal');
    paneRenderer?.focusTerminal(paneId);
  }

  function blurFocusedTerminal(): void {
    const paneId = focusController.getActiveId();
    if (paneId) paneRenderer?.blurTerminal(paneId);
  }

  function addPane(shellProfileId: string | null = null): string {
    const newPaneId = paneState.addPane(shellProfileId);
    focusController.recordPaneVisit(newPaneId);
    focusController.setMode('terminal');
    document.body.classList.remove('is-navigation-mode');
    render(true);
    return newPaneId;
  }

  function closePane(index: number, options: { destroyTerminal?: boolean } = {}): void {
    const { destroyTerminal = true } = options;
    const currentPanes = paneState.getPanes();
    if (currentPanes.length === 1) return;

    const closingPane = currentPanes[index];
    if (!closingPane) return;

    if (closingPane.id === state.renamingPaneId) state.renamingPaneId = null;
    if (closingPane.id === state.dragState?.paneId) {
      state.dragState = null;
      document.body.classList.remove('is-dragging-tabs');
    }
    if (closingPane.id === state.pendingTabFocus?.paneId) {
      window.clearTimeout(state.pendingTabFocus.timerId);
      state.pendingTabFocus = null;
    }

    if (destroyTerminal) {
      paneRenderer?.destroyPane(closingPane.id);
    }

    focusController.commitPaneCycle();
    const wasFocused = closingPane.id === paneState.getFocusedPaneId();
    paneState.closePane(index);
    render(true);

    if (wasFocused) {
      const newFocusedPaneId = paneState.getFocusedPaneId();
      focusController.recordPaneVisit(newFocusedPaneId);
      if (newFocusedPaneId) {
        requestAnimationFrame(() => {
          focusController.setMode('terminal');
          paneRenderer?.focusTerminal(newFocusedPaneId);
        });
      }
    }
  }

  function moveFocus(delta: number): void {
    focusController.moveFocus(delta);
  }

  function navigateLeft(): void {
    focusController.navigateLeft();
  }

  function navigateRight(): void {
    focusController.navigateRight();
  }

  function cycleToRecentPane({ reverse = false }: { reverse?: boolean } = {}): void {
    if (focusController.getMode() !== 'terminal') {
      focusController.setMode('terminal');
    }
    const targetId = focusController.cycleToRecentPane({ reverse });
    if (!targetId) return;
    paneRenderer?.focusTerminal(targetId);
  }

  function commitPaneCycle(): void {
    focusController.commitPaneCycle();
  }

  function cycleToNextLitPane(): void {
    const currentPanes = paneState.getPanes();
    const litIds = currentPanes
      .map((p) => p.id)
      .filter((id) => paneRenderer?.getNode(id)?.root.classList.contains('has-pending-activity'));
    if (litIds.length === 0) return;
    const focusedId = paneState.getFocusedPaneId();
    const focusedIndex = focusedId !== null ? litIds.indexOf(focusedId) : -1;
    const nextIndex = focusedIndex >= 0 ? (focusedIndex + 1) % litIds.length : 0;
    focusPane(litIds[nextIndex]);
  }

  function focusPaneAt(index: number): void {
    focusController.focusPaneAt(index);
  }

  function getPaneCount(): number {
    return focusController.getPaneCount();
  }

  function getPaneIdAt(index: number): string | null {
    return focusController.getPaneIdAt(index);
  }

  function requestClosePane(paneId: string): void {
    if (state.pendingClosePaneId === paneId) {
      const index = paneState.getPaneIndex(paneId);
      if (index !== -1) {
        state.pendingClosePaneId = null;
        closePane(index);
        const currentPanes = paneState.getPanes();
        if (focusController.getMode() === 'nav' && currentPanes.length > 0) {
          const focusedId = focusController.getActiveId();
          if (focusedId) focusPane(focusedId, { focusTerminal: true });
        }
      }
    } else {
      state.pendingClosePaneId = paneId;
      render();
    }
  }

  function startInlineRename(paneId: string): void {
    const index = paneState.getPaneIndex(paneId);
    if (index !== -1) {
      if (focusController.getMode() === 'nav') focusController.setMode('terminal');
      tabBar.beginRenamePane(index);
    }
  }

  function togglePaneBreathingMonitor(paneId: string): boolean {
    const next = paneState.togglePaneBreathingMonitor(paneId);
    layoutManager.scheduleWindowLayoutSave();
    return next;
  }

  function getFocusedPaneAccent(): string {
    const pane = paneState.getPanes()[paneState.getFocusedIndex()];
    return pane?.customColor || pane?.accent || '#ffd166';
  }

  function isEditableTarget(): boolean {
    const active = document.activeElement;
    return (
      active?.tagName === 'INPUT' ||
      active?.classList.contains('xterm-helper-textarea') === true
    );
  }

  async function getClipboardSnapshot(bridge: Bridge): Promise<ClipboardSnapshot> {
    try {
      return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
    } catch {
      return { text: '', hasImage: false };
    }
  }

  function getPaneLabel(pane: Pane): string {
    return pane.title ?? pane.terminalTitle ?? '';
  }

  function handleTerminalExit({ paneId, exitCode, reason }: { paneId: string; exitCode: number; reason: string }): boolean {
    const node = paneRenderer?.getNode(paneId);
    if (!node) return false;

    if (reason === 'killed') {
      paneRenderer.setSessionReady(paneId, false);
      return true;
    }

    const graceMs = 3000;
    const recentShellChange = paneRenderer.getShellChangeTime(paneId) && (Date.now() - paneRenderer.getShellChangeTime(paneId)! < graceMs);
    if (paneRenderer.isShellChanging(paneId) || recentShellChange) {
      paneRenderer.setSessionReady(paneId, false);
      paneRenderer.writeln(paneId, '');
      paneRenderer.writeln(paneId, `\x1b[38;5;204m[shell exited with code ${exitCode}]\x1b[0m`);
      return true;
    }

    paneRenderer.setSessionReady(paneId, false);
    paneRenderer.writeln(paneId, '');
    paneRenderer.writeln(paneId, `\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`);

    const paneIndex = paneState.getPaneIndex(paneId);
    if (paneIndex === -1) return true;

    if (paneState.getPanes().length === 1) {
      return false; // signal caller to close window
    }

    closePane(paneIndex, { destroyTerminal: false });
    return true;
  }

  return {
    focusPane,
    refocusCurrentPaneTerminal,
    blurFocusedTerminal,
    addPane,
    closePane,
    moveFocus,
    navigateLeft,
    navigateRight,
    cycleToRecentPane,
    commitPaneCycle,
    cycleToNextLitPane,
    focusPaneAt,
    getPaneCount,
    getPaneIdAt,
    requestClosePane,
    startInlineRename,
    togglePaneBreathingMonitor,
    getFocusedPaneAccent,
    isEditableTarget,
    getClipboardSnapshot,
    getPaneLabel,
    handleTerminalExit,
  };
}
