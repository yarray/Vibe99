/**
 * Focus Controller — MRU order, pane cycling, and navigation mode.
 *
 * Extracted from pane-state.ts and renderer.ts for Phase 2 refactor.
 * Layers on top of a pane collection; owns no pane collection state.
 *
 * @module manager/create-focus-controller
 */

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Minimal pane shape required by the focus controller. */
export interface PaneLike {
  id: string;
}

/** Minimal pane collection shape required by the focus controller. */
export interface PaneCollection {
  getAll(): PaneLike[];
  getActiveId(): string | null;
  setActive(paneId: string): boolean;
  size(): number;
}

export interface FocusController {
  // Mode
  getMode(): string;
  setMode(mode: string): void;
  enterNavigationMode(): void;
  cancelNavigationMode(): void;
  getEnterNavSourcePaneId(): string | null;

  // MRU
  recordPaneVisit(paneId: string | null): void;
  syncMru(): void;
  cycleToRecentPane(options?: { reverse?: boolean }): string | null;
  commitPaneCycle(): void;
  hasActivePaneCycle(): boolean;

  // Focus movement
  focusPane(paneId: string): boolean;
  moveFocus(delta: number): boolean;
  navigateLeft(): boolean;
  navigateRight(): boolean;
  focusPaneAt(index: number): boolean;

  // Queries
  getPaneCount(): number;
  getPaneIdAt(index: number): string | null;
  getActiveId(): string | null;
}

export interface FocusControllerDeps {
  onModeChange?: (mode: string) => void;
  onFocusChange?: (paneId: string | null) => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PaneCycleState {
  snapshot: string[];
  index: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFocusController(
  paneCollection: PaneCollection,
  deps: FocusControllerDeps = {},
): FocusController {
  let mode = 'terminal';
  let enterNavSourcePaneId: string | null = null;
  let paneMruOrder: string[] = [];
  let paneCycleState: PaneCycleState | null = null;

  const notifyMode = (): void => deps.onModeChange?.(mode);
  const notifyFocus = (paneId: string | null): void => deps.onFocusChange?.(paneId);

  const syncMru = (): void => {
    const known = new Set(paneCollection.getAll().map((p) => p.id));
    paneMruOrder = paneMruOrder.filter((id) => known.has(id));
    for (const pane of paneCollection.getAll()) {
      if (!paneMruOrder.includes(pane.id)) {
        paneMruOrder.push(pane.id);
      }
    }
  };

  const setMode = (next: string): void => {
    if (mode === next) return;
    mode = next;
    notifyMode();
  };

  const enterNavigationMode = (): void => {
    if (paneCollection.size() === 0) return;
    enterNavSourcePaneId = paneCollection.getActiveId();
    setMode('nav');
  };

  const cancelNavigationMode = (): void => {
    if (enterNavSourcePaneId) {
      const sourceId = enterNavSourcePaneId;
      enterNavSourcePaneId = null;
      paneCollection.setActive(sourceId);
      recordPaneVisit(sourceId);
      setMode('terminal');
      notifyFocus(sourceId);
    } else {
      setMode('terminal');
    }
  };

  const recordPaneVisit = (paneId: string | null): void => {
    if (!paneId) return;
    if (paneMruOrder[0] === paneId) return;
    paneMruOrder = [paneId, ...paneMruOrder.filter((id) => id !== paneId)];
  };

  const cycleToRecentPane = ({ reverse = false }: { reverse?: boolean } = {}): string | null => {
    if (paneCollection.size() < 2) return null;
    syncMru();
    if (!paneCycleState) {
      paneCycleState = { snapshot: [...paneMruOrder], index: 0 };
    }
    const { snapshot } = paneCycleState;
    if (snapshot.length < 2) return null;
    const step = reverse ? -1 : 1;
    paneCycleState.index = (paneCycleState.index + step + snapshot.length) % snapshot.length;
    const targetId = snapshot[paneCycleState.index];
    const known = new Set(paneCollection.getAll().map((p) => p.id));
    if (!known.has(targetId)) {
      paneCycleState = null;
      return null;
    }
    paneCollection.setActive(targetId);
    notifyFocus(targetId);
    return targetId;
  };

  const commitPaneCycle = (): void => {
    if (!paneCycleState) return;
    paneCycleState = null;
    recordPaneVisit(paneCollection.getActiveId());
    notifyFocus(paneCollection.getActiveId());
  };

  const focusPane = (paneId: string): boolean => {
    if (!paneCollection.setActive(paneId)) return false;
    recordPaneVisit(paneId);
    setMode('terminal');
    notifyFocus(paneId);
    return true;
  };

  const moveFocus = (delta: number): boolean => {
    const all = paneCollection.getAll();
    if (all.length === 0) return false;
    const activeId = paneCollection.getActiveId();
    const focusedIndex = activeId !== null ? all.findIndex((p) => p.id === activeId) : 0;
    const nextIndex = (focusedIndex + delta + all.length) % all.length;
    paneCollection.setActive(all[nextIndex].id);
    notifyFocus(all[nextIndex].id);
    return true;
  };

  const navigateLeft = (): boolean => {
    const all = paneCollection.getAll();
    if (all.length === 0) return false;
    const activeId = paneCollection.getActiveId();
    const focusedIndex = activeId !== null ? all.findIndex((p) => p.id === activeId) : 0;
    const nextIndex = focusedIndex - 1;
    if (nextIndex < 0) return false;
    return focusPane(all[nextIndex].id);
  };

  const navigateRight = (): boolean => {
    const all = paneCollection.getAll();
    if (all.length === 0) return false;
    const activeId = paneCollection.getActiveId();
    const focusedIndex = activeId !== null ? all.findIndex((p) => p.id === activeId) : 0;
    const nextIndex = focusedIndex + 1;
    if (nextIndex >= all.length) return false;
    return focusPane(all[nextIndex].id);
  };

  const focusPaneAt = (index: number): boolean => {
    const all = paneCollection.getAll();
    if (all.length === 0 || index < 0 || index >= all.length) return false;
    paneCollection.setActive(all[index].id);
    recordPaneVisit(all[index].id);
    notifyFocus(all[index].id);
    return true;
  };

  const getPaneCount = (): number => paneCollection.size();

  const getPaneIdAt = (index: number): string | null => {
    const all = paneCollection.getAll();
    if (all.length === 0 || index < 0 || index >= all.length) return null;
    return all[index].id;
  };

  return {
    getMode: () => mode,
    setMode,
    enterNavigationMode,
    cancelNavigationMode,
    getEnterNavSourcePaneId: () => enterNavSourcePaneId,
    recordPaneVisit,
    syncMru,
    cycleToRecentPane,
    commitPaneCycle,
    hasActivePaneCycle: () => paneCycleState !== null,
    focusPane,
    moveFocus,
    navigateLeft,
    navigateRight,
    focusPaneAt,
    getPaneCount,
    getPaneIdAt,
    getActiveId: () => paneCollection.getActiveId(),
  };
}
