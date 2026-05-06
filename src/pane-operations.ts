// Pane operations — coordinates paneManager, tabBar, and layoutManager.

import type { PaneManager, PaneInitialState } from './manager/create-pane-manager.js';
import type { TerminalCapability } from './pane/capabilities/terminal-capability.js';
import type { DomCapabilityApi } from './pane/capabilities/dom-capability.js';
import type { ActivityCapability } from './pane/capabilities/activity-capability.js';
import type { PtyCapability } from './pane/capabilities/pty-capability.js';
import type { TabBar, TabBarLocalState } from './tab-bar';
import type { Backend, ClipboardSnapshot } from './backend';
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
  paneManager: PaneManager;
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
  getClipboardSnapshot: (backend: Backend) => Promise<ClipboardSnapshot>;
  getPaneLabel: (pane: { title: string | null; terminalTitle: string }) => string;
  handleTerminalExit: (event: { paneId: string; exitCode: number; reason: string }) => boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaneOperations({
  paneManager,
  tabBar,
  layoutManager,
  render,
  focusController,
  state,
}: PaneOperationsDeps): PaneOperations {
  function focusPane(paneId: string, options: { focusTerminal?: boolean } = {}): void {
    const { focusTerminal = true } = options;
    if (!focusController.focusPane(paneId)) return;
    const pane = paneManager.get(paneId);
    const domApi = pane?.capability<DomCapabilityApi>('dom');
    const activityApi = pane?.capability<ActivityCapability>('activity');
    if (domApi && activityApi) activityApi.setAlerted(domApi.root, false);
    if (focusTerminal) {
      pane?.capability<TerminalCapability>('terminal')?.focus();
    }
  }

  function refocusCurrentPaneTerminal(): void {
    const paneId = focusController.getActiveId();
    if (!paneId) return;
    focusController.setMode('terminal');
    paneManager.get(paneId)?.capability<TerminalCapability>('terminal')?.focus();
  }

  function blurFocusedTerminal(): void {
    const paneId = focusController.getActiveId();
    if (paneId) paneManager.get(paneId)?.capability<TerminalCapability>('terminal')?.blur();
  }

  function addPane(shellProfileId: string | null = null): string {
    const focusedPane = paneManager.getActive();
    const initialState: PaneInitialState = {
      title: null,
      cwd: focusedPane?.getState<string>('cwd') ?? '',
      accent: '',
      shellProfileId: shellProfileId ?? null,
    };
    const newPane = paneManager.create(initialState);
    const newPaneId = newPane.id;
    focusController.recordPaneVisit(newPaneId);
    focusController.setMode('terminal');
    document.body.classList.remove('is-navigation-mode');
    render(true);
    return newPaneId;
  }

  function closePane(index: number, options: { destroyTerminal?: boolean } = {}): void {
    const currentPanes = paneManager.getAll();
    if (currentPanes.length === 1) return;

    const closingPane = currentPanes[index];
    if (!closingPane) return;

    const closingId = closingPane.id;
    if (closingId === state.renamingPaneId) state.renamingPaneId = null;
    if (closingId === state.dragState?.paneId) {
      state.dragState = null;
      document.body.classList.remove('is-dragging-tabs');
    }
    if (closingId === state.pendingTabFocus?.paneId) {
      window.clearTimeout(state.pendingTabFocus.timerId);
      state.pendingTabFocus = null;
    }

    focusController.commitPaneCycle();
    const wasFocused = closingId === paneManager.getActiveId();

    paneManager.destroy(closingId);
    render(true);

    if (wasFocused) {
      const newFocusedPaneId = paneManager.getActiveId();
      focusController.recordPaneVisit(newFocusedPaneId);
      if (newFocusedPaneId) {
        requestAnimationFrame(() => {
          focusController.setMode('terminal');
          paneManager.get(newFocusedPaneId)?.capability<TerminalCapability>('terminal')?.focus();
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
    paneManager.get(targetId)?.capability<TerminalCapability>('terminal')?.focus();
  }

  function commitPaneCycle(): void {
    focusController.commitPaneCycle();
  }

  function cycleToNextLitPane(): void {
    const currentPanes = paneManager.getAll();
    const litIds = currentPanes
      .map((p) => p.id)
      .filter((id) => paneManager.get(id)?.capability<DomCapabilityApi>('dom')?.root.classList.contains('has-pending-activity'));
    if (litIds.length === 0) return;
    const focusedId = paneManager.getActiveId();
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
      const index = paneManager.getPaneIndex(paneId);
      if (index !== -1) {
        state.pendingClosePaneId = null;
        closePane(index);
        const currentPanes = paneManager.getAll();
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
    const index = paneManager.getPaneIndex(paneId);
    if (index !== -1) {
      if (focusController.getMode() === 'nav') focusController.setMode('terminal');
      tabBar.beginRenamePane(index);
    }
  }

  function togglePaneBreathingMonitor(paneId: string): boolean {
    const next = paneManager.togglePaneBreathingMonitor(paneId);
    layoutManager.scheduleWindowLayoutSave();
    return next;
  }

  function getFocusedPaneAccent(): string {
    const pane = paneManager.getActive();
    return pane?.getState<string>('customColor') || pane?.getState<string>('accent') || '#ffd166';
  }

  function isEditableTarget(): boolean {
    const active = document.activeElement;
    return (
      active?.tagName === 'INPUT' ||
      active?.classList.contains('xterm-helper-textarea') === true
    );
  }

  async function getClipboardSnapshot(backend: Backend): Promise<ClipboardSnapshot> {
    return await backend.clipboard.snapshot();
  }

  function getPaneLabel(pane: { title: string | null; terminalTitle: string }): string {
    return pane.title ?? pane.terminalTitle ?? '';
  }

  function handleTerminalExit({ paneId, exitCode, reason }: { paneId: string; exitCode: number; reason: string }): boolean {
    const pane = paneManager.get(paneId);
    if (!pane) return false;

    const pty = pane.capability<PtyCapability>('pty');
    const term = pane.capability<TerminalCapability>('terminal');

    if (reason === 'killed') {
      pty?.destroy();
      return true;
    }

    const graceMs = 3000;
    const shellChangeTime = pty?.recentShellChange ?? null;
    const recentShellChange = shellChangeTime !== null && (Date.now() - shellChangeTime < graceMs);
    if (pty?.isShellChanging || recentShellChange) {
      pty?.destroy();
      term?.writeln('');
      term?.writeln(`\x1b[38;5;204m[shell exited with code ${exitCode}]\x1b[0m`);
      return true;
    }

    pty?.destroy();
    term?.writeln('');
    term?.writeln(`\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`);

    const paneIndex = paneManager.getPaneIndex(paneId);
    if (paneIndex === -1) return true;

    if (paneManager.getAll().length === 1) {
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
