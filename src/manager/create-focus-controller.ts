/**
 * Focus Controller — MRU order, pane cycling, and navigation mode.
 *
 * @module manager/create-focus-controller
 */

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Minimal PaneManager interface for focus operations. */
export interface PaneManager {
  getFocusedPaneId: () => string | null;
  getPanes: () => ReadonlyArray<{ id: string }>;
  getPaneIndex: (paneId: string) => number;
  focusPane: (paneId: string, opts?: { focusTerminal?: boolean }) => boolean;
}

/** Dependencies injected into createFocusController. */
export interface FocusControllerDeps {
  onStateChange?: () => void;
  onModeChange?: (mode: string) => void;
}

/** Public API returned by createFocusController. */
export interface FocusController {
  recordPaneVisit: (paneId: string | null) => void;
  cycleToRecentPane: (options?: { reverse?: boolean }) => string | null;
  commitPaneCycle: () => void;
  hasActivePaneCycle: () => boolean;
  enterNavigationMode: () => void;
  cancelNavigationMode: () => void;
  isInNavigationMode: () => boolean;
  getEnterNavSourcePaneId: () => string | null;
  navigateLeft: () => boolean;
  navigateRight: () => boolean;
  moveFocus: (delta: number) => boolean;
  jumpToPane: (index: number) => boolean;
  focusFirst: () => boolean;
  focusLast: () => boolean;
}

interface PaneCycleState {
  snapshot: string[];
  index: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFocusController(
  paneManager: PaneManager,
  deps: FocusControllerDeps = {}
): FocusController {
  let paneMruOrder: string[] = [];
  let isInNavMode = false;
  let enterNavSourcePaneId: string | null = null;
  let paneCycleState: PaneCycleState | null = null;

  const notifyChange = (): void => { deps.onStateChange?.(); };
  const notifyModeChange = (mode: string): void => { deps.onModeChange?.(mode); };

  const syncPaneMruOrder = (): void => {
    const panes = paneManager.getPanes();
    const known = new Set(panes.map((p) => p.id));
    paneMruOrder = paneMruOrder.filter((id) => known.has(id));
    for (const pane of panes) {
      if (!paneMruOrder.includes(pane.id)) paneMruOrder.push(pane.id);
    }
  };

  const recordPaneVisit = (paneId: string | null): void => {
    if (!paneId || paneMruOrder[0] === paneId) return;
    paneMruOrder = [paneId, ...paneMruOrder.filter((id) => id !== paneId)];
  };

  const cycleToRecentPane = ({ reverse = false }: { reverse?: boolean } = {}): string | null => {
    const panes = paneManager.getPanes();
    if (panes.length < 2) return null;
    syncPaneMruOrder();
    if (!paneCycleState) paneCycleState = { snapshot: [...paneMruOrder], index: 0 };
    const { snapshot } = paneCycleState;
    if (snapshot.length < 2) return null;
    const step = reverse ? -1 : 1;
    paneCycleState.index = (paneCycleState.index + step + snapshot.length) % snapshot.length;
    const targetId = snapshot[paneCycleState.index];
    if (!panes.some((pane) => pane.id === targetId)) { paneCycleState = null; return null; }
    paneManager.focusPane(targetId);
    notifyChange();
    return targetId;
  };

  const commitPaneCycle = (): void => {
    if (!paneCycleState) return;
    paneCycleState = null;
    recordPaneVisit(paneManager.getFocusedPaneId());
    notifyChange();
  };

  const hasActivePaneCycle = (): boolean => paneCycleState !== null;

  const enterNavigationMode = (): void => {
    const panes = paneManager.getPanes();
    if (panes.length === 0) return;
    enterNavSourcePaneId = paneManager.getFocusedPaneId();
    isInNavMode = true;
    notifyModeChange('nav');
    notifyChange();
  };

  const cancelNavigationMode = (): void => {
    if (enterNavSourcePaneId) {
      paneManager.focusPane(enterNavSourcePaneId, { focusTerminal: true });
      enterNavSourcePaneId = null;
    }
    isInNavMode = false;
    notifyModeChange('terminal');
    notifyChange();
  };

  const isInNavigationMode = (): boolean => isInNavMode;
  const getEnterNavSourcePaneId = (): string | null => enterNavSourcePaneId;

  const getFocusedIndex = (): number => {
    const focusedId = paneManager.getFocusedPaneId();
    return focusedId !== null ? paneManager.getPaneIndex(focusedId) : 0;
  };

  const navigateLeft = (): boolean => {
    const panes = paneManager.getPanes();
    if (panes.length === 0) return false;
    const nextIndex = getFocusedIndex() - 1;
    if (nextIndex >= 0) { paneManager.focusPane(panes[nextIndex].id); notifyChange(); return true; }
    return false;
  };

  const navigateRight = (): boolean => {
    const panes = paneManager.getPanes();
    if (panes.length === 0) return false;
    const nextIndex = getFocusedIndex() + 1;
    if (nextIndex < panes.length) { paneManager.focusPane(panes[nextIndex].id); notifyChange(); return true; }
    return false;
  };

  const moveFocus = (delta: number): boolean => {
    const panes = paneManager.getPanes();
    if (panes.length === 0) return false;
    const nextIndex = (getFocusedIndex() + delta + panes.length) % panes.length;
    paneManager.focusPane(panes[nextIndex].id);
    notifyChange();
    return true;
  };

  const jumpToPane = (index: number): boolean => {
    const panes = paneManager.getPanes();
    if (index < 0 || index >= panes.length) return false;
    paneManager.focusPane(panes[index].id);
    notifyChange();
    return true;
  };

  const focusFirst = (): boolean => jumpToPane(0);
  const focusLast = (): boolean => {
    const panes = paneManager.getPanes();
    return panes.length > 0 ? jumpToPane(panes.length - 1) : false;
  };

  return {
    recordPaneVisit,
    cycleToRecentPane,
    commitPaneCycle,
    hasActivePaneCycle,
    enterNavigationMode,
    cancelNavigationMode,
    isInNavigationMode,
    getEnterNavSourcePaneId,
    navigateLeft,
    navigateRight,
    moveFocus,
    jumpToPane,
    focusFirst,
    focusLast,
  };
}
