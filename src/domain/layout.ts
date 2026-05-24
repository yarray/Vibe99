/**
 * Layout Aggregate Root
 *
 * Manages pane collection, focus, MRU order, and cycle state.
 * No knowledge of DOM, xterm, PTY, or rendering state.
 *
 * @module domain/layout
 */

import type { Pane, PaneSnapshot } from './pane.js';
import { createPane } from './pane.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of a layout's persistent state.
 * Used for serialization and session persistence.
 */
export interface LayoutSnapshot {
  id: string;
  name: string;
  panes: PaneSnapshot[];
  focusedPaneId: string | null;
  mruPaneIds: string[];
  activation?: string;
  themeId?: string;
  uiOverrides?: {
    fontSize?: number;
    fontFamily?: string;
    paneOpacity?: number;
    paneMaskOpacity?: number;
    paneWidth?: number;
    breathingIntensity?: 'none' | 'mild' | 'intense';
  };
}

/**
 * Layout aggregate root interface.
 * Owns pane collection order, focus, MRU, and cycle state.
 */
export interface Layout {
  // Identity
  id: string;
  name: string;
  rename(name: string): void;

  // Read accessors
  panes(): readonly Pane[];
  focusedPane(): Pane | null;
  focusedPaneId(): string | null;

  // Collection & focus operations
  addPane(pane: Pane): void;
  closePane(paneId: string): boolean;
  focusPane(paneId: string): boolean;
  setFocusedPaneId(paneId: string | null): boolean;
  moveFocus(delta: number): boolean;
  movePane(paneId: string, index: number): boolean;

  // Theme
  setThemeId(themeId: string | undefined): void;

  // UI Overrides
  setUiOverrides(uiOverrides: LayoutSnapshot['uiOverrides']): void;
  getUiOverrides(): LayoutSnapshot['uiOverrides'];

  // Pane property operations
  renamePane(paneId: string, title: string | null): boolean;
  updatePane(paneId: string, patch: Partial<Omit<PaneSnapshot, 'id'>>): boolean;

  // MRU / Cycle operations
  cycleRecent(options?: { reverse?: boolean }): string | null;
  commitCycle(): void;
  hasActiveCycle(): boolean;
  recordPaneVisit(paneId: string): void;

  // Snapshot
  snapshot(): LayoutSnapshot;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Internal cycle state while the user holds Ctrl+Tab. */
interface PaneCycleState {
  snapshot: string[];
  index: number;
}

/** Internal mutable state of a layout. */
interface LayoutState {
  id: string;
  name: string;
  activation?: string;
  themeId?: string;
  uiOverrides?: {
    fontSize?: number;
    fontFamily?: string;
    paneOpacity?: number;
    paneMaskOpacity?: number;
    paneWidth?: number;
    breathingIntensity?: 'none' | 'mild' | 'intense';
  };
  panes: Pane[];
  focusedPaneId: string | null;
  mruPaneIds: string[];
  cycleState: PaneCycleState | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensures MRU order contains exactly the current pane IDs,
 * with existing order preserved for known IDs and unknown IDs
 * appended in tab order.
 */
function syncMruOrder(state: LayoutState): void {
  const known = new Set(state.panes.map((p) => p.id));
  state.mruPaneIds = state.mruPaneIds.filter((id) => known.has(id));
  for (const pane of state.panes) {
    if (!state.mruPaneIds.includes(pane.id)) {
      state.mruPaneIds.push(pane.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Layout aggregate root from a snapshot.
 *
 * @param snapshot - The initial state snapshot
 * @returns A Layout instance
 */
export function createLayout(snapshot: LayoutSnapshot): Layout {
  const state: LayoutState = {
    id: snapshot.id,
    name: snapshot.name,
    activation: snapshot.activation,
    themeId: snapshot.themeId,
    uiOverrides: snapshot.uiOverrides,
    panes: snapshot.panes.map((p) => createPane(p)),
    focusedPaneId: snapshot.focusedPaneId,
    mruPaneIds: [...snapshot.mruPaneIds],
    cycleState: null,
  };

  syncMruOrder(state);

  return {
    id: state.id,
    get name(): string {
      return state.name;
    },
    rename(newName: string): void {
      state.name = newName;
    },

    setThemeId(themeId: string | undefined): void {
      state.themeId = themeId;
    },

    setUiOverrides(uiOverrides: LayoutSnapshot['uiOverrides']): void {
      state.uiOverrides = uiOverrides;
    },

    getUiOverrides(): LayoutSnapshot['uiOverrides'] {
      return state.uiOverrides;
    },

    panes(): readonly Pane[] {
      return [...state.panes];
    },

    focusedPane(): Pane | null {
      return state.panes.find((p) => p.id === state.focusedPaneId) ?? null;
    },

    focusedPaneId(): string | null {
      return state.focusedPaneId;
    },

    addPane(pane: Pane): void {
      state.cycleState = null;
      state.panes = [...state.panes, pane];
      state.focusedPaneId = pane.id;
      state.mruPaneIds = [pane.id, ...state.mruPaneIds.filter((id) => id !== pane.id)];
      syncMruOrder(state);
    },

    closePane(paneId: string): boolean {
      const index = state.panes.findIndex((p) => p.id === paneId);
      if (index === -1) return false;
      if (state.panes.length === 1) return false;

      const wasFocused = state.panes[index].id === state.focusedPaneId;
      const remainingPanes = state.panes.filter((_, i) => i !== index);

      if (wasFocused) {
        const fallbackIndex = Math.max(0, index - 1);
        state.focusedPaneId = remainingPanes[fallbackIndex]?.id ?? remainingPanes[0]?.id ?? null;
      }

      state.panes = remainingPanes;
      state.cycleState = null;
      state.mruPaneIds = state.mruPaneIds.filter((id) => id !== paneId);
      syncMruOrder(state);
      if (state.focusedPaneId) {
        state.mruPaneIds = [
          state.focusedPaneId,
          ...state.mruPaneIds.filter((id) => id !== state.focusedPaneId),
        ];
      }
      return true;
    },

    focusPane(paneId: string): boolean {
      if (!state.panes.some((p) => p.id === paneId)) return false;
      state.cycleState = null;
      state.focusedPaneId = paneId;
      state.mruPaneIds = [paneId, ...state.mruPaneIds.filter((id) => id !== paneId)];
      return true;
    },

    setFocusedPaneId(paneId: string | null): boolean {
      if (paneId !== null && !state.panes.some((p) => p.id === paneId)) return false;
      state.focusedPaneId = paneId;
      return true;
    },

    moveFocus(delta: number): boolean {
      if (state.panes.length === 0) return false;
      const focusedIndex = state.panes.findIndex((p) => p.id === state.focusedPaneId);
      const currentIndex = focusedIndex !== -1 ? focusedIndex : 0;
      const nextIndex = (currentIndex + delta + state.panes.length) % state.panes.length;
      state.focusedPaneId = state.panes[nextIndex].id;
      return true;
    },

    movePane(paneId: string, index: number): boolean {
      const paneIndex = state.panes.findIndex((p) => p.id === paneId);
      if (paneIndex === -1) return false;

      const pane = state.panes[paneIndex];
      const nextPanes = state.panes.filter((p) => p.id !== paneId);
      const insertionIndex = Math.max(0, Math.min(index, nextPanes.length));
      nextPanes.splice(insertionIndex, 0, pane);
      state.panes = nextPanes;
      return true;
    },

    renamePane(paneId: string, title: string | null): boolean {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return false;
      pane.rename(title);
      return true;
    },

    updatePane(paneId: string, patch: Partial<Omit<PaneSnapshot, 'id'>>): boolean {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return false;

      if (patch.title !== undefined) pane.rename(patch.title);
      if (patch.terminalTitle !== undefined) pane.setTerminalTitle(patch.terminalTitle);
      if (patch.cwd !== undefined) pane.setCwd(patch.cwd);
      if (patch.customColor !== undefined) pane.setCustomColor(patch.customColor);
      if (patch.customColor === undefined && 'customColor' in patch) pane.clearCustomColor();
      if (patch.shellProfileId !== undefined) pane.setShellProfile(patch.shellProfileId);
      if (patch.breathingMonitor !== undefined) pane.setBreathingMonitor(patch.breathingMonitor);

      return true;
    },

    cycleRecent({ reverse = false }: { reverse?: boolean } = {}): string | null {
      if (state.panes.length < 2) return null;

      syncMruOrder(state);

      if (!state.cycleState) {
        state.cycleState = { snapshot: [...state.mruPaneIds], index: 0 };
      }

      const { snapshot } = state.cycleState;
      if (snapshot.length < 2) return null;

      const step = reverse ? -1 : 1;
      state.cycleState.index = (state.cycleState.index + step + snapshot.length) % snapshot.length;
      const targetId = snapshot[state.cycleState.index];

      if (!state.panes.some((p) => p.id === targetId)) {
        state.cycleState = null;
        return null;
      }

      state.focusedPaneId = targetId;
      return targetId;
    },

    commitCycle(): void {
      if (!state.cycleState) return;
      state.cycleState = null;
      const focusedId = state.focusedPaneId;
      if (focusedId) {
        state.mruPaneIds = [focusedId, ...state.mruPaneIds.filter((id) => id !== focusedId)];
      }
    },

    hasActiveCycle(): boolean {
      return state.cycleState !== null;
    },

    recordPaneVisit(paneId: string): void {
      if (!paneId) return;
      if (state.mruPaneIds[0] === paneId) return;
      state.mruPaneIds = [paneId, ...state.mruPaneIds.filter((id) => id !== paneId)];
    },

    snapshot(): LayoutSnapshot {
      return {
        id: state.id,
        name: state.name,
        panes: state.panes.map((p) => p.snapshot()),
        focusedPaneId: state.focusedPaneId,
        mruPaneIds: [...state.mruPaneIds],
        activation: state.activation,
        themeId: state.themeId,
        uiOverrides: state.uiOverrides,
      };
    },
  };
}
