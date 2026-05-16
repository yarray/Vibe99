/**
 * Pane State Management Module
 *
 * Pure logic module for managing pane state, collection operations, and
 * session persistence. No DOM operations.
 *
 * @module pane-state
 */

import type { Pane as PaneEntity, PaneSnapshot } from './domain/pane.js';
import { createPane, createDefaultPane } from './domain/pane.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Shape of a single pane object.
 * @deprecated Use the Pane domain entity from './domain/pane.js' for new code.
 * This interface is kept for backward compatibility.
 */
export interface Pane {
  id: string;
  title: string | null;
  terminalTitle: string;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor?: boolean;
}

/** Serialized pane entry as stored in session / layout data. */
export interface SessionPaneEntry {
  paneId: string;
  title: string | null;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor: boolean;
}

/** Full session payload produced by `buildSessionData` and consumed by `restoreSession`. */
export interface SessionData {
  version: number;
  panes: SessionPaneEntry[];
  focusedPaneIndex: number;
}

/** Dependencies injected into `createPaneState`. */
export interface PaneStateDeps {
  defaultCwd: string;
  defaultTabTitle: string;
  getAccentPalette: () => string[];
  onStateChange?: () => void;
}

/** The full public API surface returned by `createPaneState`. */
export interface PaneState {
  // Read operations
  /** Get the default three-pane layout for creating new layouts. */
  getDefaultPanes: () => Pane[];
  // Read operations
  getPanes: () => Pane[];
  getFocusedPaneId: () => string | null;
  getPaneById: (paneId: string) => Pane | null;
  getPaneIndex: (paneId: string) => number;
  getFocusedIndex: () => number;

  // Write operations
  addPane: (shellProfileId?: string | null) => string;
  closePane: (index: number) => string | null;
  focusPane: (paneId: string) => boolean;
  moveFocus: (delta: number) => boolean;
  navigateLeft: () => boolean;
  navigateRight: () => boolean;
  reorderPane: (paneId: string, newIndex: number) => boolean;

  // MRU operations
  cycleToRecentPane: (options?: { reverse?: boolean }) => string | null;
  commitPaneCycle: () => void;
  hasActivePaneCycle: () => boolean;
  recordPaneVisit: (paneId: string | null) => void;

  // Property modification operations
  setPaneTitle: (paneId: string, title: string | null) => boolean;
  setPaneCwd: (paneId: string, cwd: string) => boolean;
  setPaneColor: (paneId: string, color: string) => boolean;
  clearPaneColor: (paneId: string) => boolean;
  setPaneShellProfile: (paneId: string, profileId: string | null) => boolean;
  setPaneTerminalTitle: (paneId: string, terminalTitle: string) => boolean;
  togglePaneBreathingMonitor: (paneId: string) => boolean;
  setDefaultCwd: (cwd: string, tabTitle: string) => void;

  // Session operations
  buildSessionData: () => SessionData;
  restoreSession: (session: { panes?: SessionPaneEntry[]; focusedPaneIndex?: number }) => boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Internal cycle state while the user holds Ctrl+Tab. */
interface PaneCycleState {
  snapshot: string[];
  index: number;
}

/**
 * Helper to convert a Pane entity to the legacy Pane interface.
 * Used for backward compatibility with the public API.
 */
function paneToLegacy(pane: PaneEntity): Pane {
  return {
    id: pane.id,
    title: pane.title(),
    terminalTitle: pane.terminalTitle(),
    cwd: pane.cwd(),
    accent: pane.accent(),
    customColor: pane.customColor(),
    shellProfileId: pane.shellProfileId(),
    breathingMonitor: pane.breathingMonitorEnabled(),
  };
}

/**
 * Helper to convert a PaneSnapshot to the legacy Pane interface.
 * Used for backward compatibility with the public API.
 */
function snapshotToLegacy(snapshot: PaneSnapshot): Pane {
  return {
    id: snapshot.id,
    title: snapshot.title,
    terminalTitle: snapshot.terminalTitle,
    cwd: snapshot.cwd,
    accent: snapshot.accent,
    customColor: snapshot.customColor,
    shellProfileId: snapshot.shellProfileId,
    breathingMonitor: snapshot.breathingMonitor,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a pane state manager.
 *
 * @param deps - Dependencies
 * @param deps.defaultCwd - Default working directory for new panes
 * @param deps.defaultTabTitle - Default title for new panes
 * @param deps.getAccentPalette - Function that returns the color palette for accents
 * @param deps.onStateChange - Callback called when state changes
 * @returns Pane state manager interface
 */
export function createPaneState({
  defaultCwd: initialDefaultCwd,
  defaultTabTitle: initialDefaultTabTitle,
  getAccentPalette,
  onStateChange,
}: PaneStateDeps): PaneState {
  let defaultCwd = initialDefaultCwd;
  let defaultTabTitle = initialDefaultTabTitle;
  const palette: string[] = getAccentPalette();

  // Helper function to get the default three-pane layout (internal, returns PaneEntity[])
  const createDefaultPanes = (): PaneEntity[] => [
    createDefaultPane('p1', { cwd: defaultCwd, terminalTitle: defaultTabTitle, accent: palette[0] }),
    createDefaultPane('p2', { cwd: defaultCwd, terminalTitle: defaultTabTitle, accent: palette[1] }),
    createDefaultPane('p3', { cwd: defaultCwd, terminalTitle: defaultTabTitle, accent: palette[2] }),
  ];

  // Core state - now uses Pane domain entity internally
  let panes: PaneEntity[] = createDefaultPanes();
  let focusedPaneId: string | null = panes[0].id;
  let nextPaneNumber: number = panes.length + 1;

  // Most-recently-used pane stack for Ctrl+Tab cycling. Index 0 is the most
  // recently visited pane (typically equals focusedPaneId when no cycle is in
  // progress). All current pane IDs always appear exactly once.
  let paneMruOrder: string[] = panes.map((pane: PaneEntity) => pane.id);

  // Transient state while the user is cycling with the modifier still held.
  // `snapshot` freezes the MRU order at the start of the cycle so repeated
  // presses step through a stable list. `index` points into that snapshot.
  // `null` means no cycle is in progress.
  let paneCycleState: PaneCycleState | null = null;

  // Internal helpers
  const notifyChange = (): void => {
    if (onStateChange) {
      onStateChange();
    }
  };

  const syncPaneMruOrder = (): void => {
    const known: Set<string> = new Set(panes.map((pane: PaneEntity) => pane.id));
    paneMruOrder = paneMruOrder.filter((id: string) => known.has(id));
    for (const pane of panes) {
      if (!paneMruOrder.includes(pane.id)) {
        paneMruOrder.push(pane.id);
      }
    }
  };

  // Read operations
  const getPanes = (): Pane[] => panes.map((pane: PaneEntity) => paneToLegacy(pane));

  const getFocusedPaneId = (): string | null => focusedPaneId;

  const getPaneById = (paneId: string): Pane | null => {
    const pane = panes.find((p: PaneEntity) => p.id === paneId);
    return pane ? paneToLegacy(pane) : null;
  };

  const getPaneIndex = (paneId: string): number =>
    panes.findIndex((pane: PaneEntity) => pane.id === paneId);

  const getFocusedIndex = (): number => {
    const focusedIndex: number = panes.findIndex((pane: PaneEntity) => pane.id === focusedPaneId);
    if (focusedIndex !== -1) {
      return focusedIndex;
    }

    focusedPaneId = panes[0]?.id ?? null;
    return panes.length > 0 ? 0 : -1;
  };

  // Write operations
  const addPane = (shellProfileId: string | null = null): string => {
    const usedAccents: Set<string> = new Set(
      panes.map((p: PaneEntity) => (p.customColor() || p.accent()).toLowerCase()),
    );
    const accent: string =
      getAccentPalette().find((c: string) => !usedAccents.has(c.toLowerCase()))
      || getAccentPalette()[(nextPaneNumber - 1) % getAccentPalette().length];
    const focusedPane: PaneEntity | undefined = panes[getFocusedIndex()];
    const newPane: PaneEntity = createDefaultPane(`p${nextPaneNumber}`, {
      cwd: focusedPane?.cwd() || defaultCwd,
      terminalTitle: defaultTabTitle,
      accent,
    });
    if (shellProfileId !== null && shellProfileId !== undefined) {
      newPane.setShellProfile(shellProfileId);
    }

    nextPaneNumber += 1;
    paneCycleState = null;
    panes = [...panes, newPane];
    focusedPaneId = newPane.id;
    recordPaneVisit(newPane.id);
    notifyChange();
    return newPane.id;
  };

  const closePane = (index: number): string | null => {
    if (panes.length === 1) {
      return null;
    }

    const closingPane: PaneEntity | undefined = panes[index];
    if (!closingPane) {
      return null;
    }

    const wasFocused: boolean = closingPane.id === focusedPaneId;
    const remainingPanes: PaneEntity[] = panes.filter(
      (_: PaneEntity, paneIndex: number) => paneIndex !== index,
    );
    if (wasFocused) {
      const fallbackIndex: number = Math.max(0, index - 1);
      focusedPaneId = remainingPanes[fallbackIndex]?.id ?? remainingPanes[0]?.id ?? null;
    }
    panes = remainingPanes;
    paneCycleState = null;
    paneMruOrder = paneMruOrder.filter((id: string) => id !== closingPane.id);
    recordPaneVisit(focusedPaneId);
    notifyChange();
    return closingPane.id;
  };

  const focusPane = (paneId: string): boolean => {
    const targetPane: PaneEntity | undefined = panes.find((p: PaneEntity) => p.id === paneId);
    if (!targetPane) {
      return false;
    }
    paneCycleState = null;
    focusedPaneId = paneId;
    recordPaneVisit(paneId);
    notifyChange();
    return true;
  };

  const moveFocus = (delta: number): boolean => {
    if (panes.length === 0) {
      return false;
    }

    const focusedIndex: number = getFocusedIndex();
    const nextIndex: number = (focusedIndex + delta + panes.length) % panes.length;
    focusedPaneId = panes[nextIndex].id;
    notifyChange();
    return true;
  };

  const navigateLeft = (): boolean => {
    if (panes.length === 0) {
      return false;
    }

    const focusedIndex: number = getFocusedIndex();
    const nextIndex: number = focusedIndex - 1;

    if (nextIndex >= 0) {
      focusedPaneId = panes[nextIndex].id;
      notifyChange();
      return true;
    }
    return false;
  };

  const navigateRight = (): boolean => {
    if (panes.length === 0) {
      return false;
    }

    const focusedIndex: number = getFocusedIndex();
    const nextIndex: number = focusedIndex + 1;

    if (nextIndex < panes.length) {
      focusedPaneId = panes[nextIndex].id;
      notifyChange();
      return true;
    }
    return false;
  };

  // MRU operations
  const recordPaneVisit = (paneId: string | null): void => {
    if (!paneId) {
      return;
    }
    if (paneMruOrder[0] === paneId) {
      return;
    }
    paneMruOrder = [paneId, ...paneMruOrder.filter((id: string) => id !== paneId)];
  };

  const cycleToRecentPane = ({ reverse = false }: { reverse?: boolean } = {}): string | null => {
    if (panes.length < 2) {
      return null;
    }

    syncPaneMruOrder();

    if (!paneCycleState) {
      paneCycleState = { snapshot: [...paneMruOrder], index: 0 };
    }

    const { snapshot }: PaneCycleState = paneCycleState;
    if (snapshot.length < 2) {
      return null;
    }

    const step: number = reverse ? -1 : 1;
    paneCycleState.index = (paneCycleState.index + step + snapshot.length) % snapshot.length;
    const targetId: string = snapshot[paneCycleState.index];

    if (!panes.some((pane: PaneEntity) => pane.id === targetId)) {
      // Target pane was closed mid-cycle — recover by aborting.
      paneCycleState = null;
      return null;
    }

    focusedPaneId = targetId;
    notifyChange();
    return targetId;
  };

  const commitPaneCycle = (): void => {
    if (!paneCycleState) {
      return;
    }
    paneCycleState = null;
    recordPaneVisit(focusedPaneId);
    notifyChange();
  };

  // Property modification operations
  const setPaneTitle = (paneId: string, title: string | null): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex].rename(title || null);
    notifyChange();
    return true;
  };

  const setPaneCwd = (paneId: string, cwd: string): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex].setCwd(cwd || defaultCwd);
    notifyChange();
    return true;
  };

  const setPaneColor = (paneId: string, color: string): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex].setCustomColor(color);
    notifyChange();
    return true;
  };

  const clearPaneColor = (paneId: string): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex].clearCustomColor();
    notifyChange();
    return true;
  };

  const setPaneShellProfile = (paneId: string, profileId: string | null): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex].setShellProfile(profileId);
    notifyChange();
    return true;
  };

  const setPaneTerminalTitle = (paneId: string, terminalTitle: string): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex].setTerminalTitle(terminalTitle || defaultTabTitle);
    notifyChange();
    return true;
  };

  const togglePaneBreathingMonitor = (paneId: string): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    const current: boolean = panes[paneIndex].breathingMonitorEnabled();
    const next = !current;
    panes[paneIndex].setBreathingMonitor(next);
    notifyChange();
    return next;
  };

  const setDefaultCwd = (cwd: string, tabTitle: string): void => {
    if (!cwd || cwd === defaultCwd) {
      return;
    }

    const previousDefaultCwd = defaultCwd;
    const previousDefaultTabTitle = defaultTabTitle;
    defaultCwd = cwd;
    defaultTabTitle = tabTitle || cwd;

    for (const pane of panes) {
      if (pane.cwd() === previousDefaultCwd) {
        pane.setCwd(defaultCwd);
      }
      if (pane.terminalTitle() === previousDefaultTabTitle) {
        pane.setTerminalTitle(defaultTabTitle);
      }
    }
    notifyChange();
  };

  const reorderPane = (paneId: string, newIndex: number): boolean => {
    const paneIndex: number = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    const pane: PaneEntity = panes[paneIndex];
    const nextPanes: PaneEntity[] = panes.filter((p: PaneEntity) => p.id !== paneId);
    const insertionIndex: number = Math.max(0, Math.min(newIndex, nextPanes.length));
    nextPanes.splice(insertionIndex, 0, pane);
    panes = nextPanes;
    notifyChange();
    return true;
  };

  // Session operations
  const buildSessionData = (): SessionData => {
    const focusedIndex: number = getFocusedIndex();
    return {
      version: 2,
      panes: panes.map((p: PaneEntity) => {
        const snapshot = p.snapshot();
        return {
          paneId: snapshot.id,
          title: snapshot.title,
          cwd: snapshot.cwd,
          accent: snapshot.accent,
          customColor: snapshot.customColor,
          shellProfileId: snapshot.shellProfileId,
          breathingMonitor: snapshot.breathingMonitor,
        };
      }),
      focusedPaneIndex: focusedIndex >= 0 ? focusedIndex : 0,
    };
  };

  const restoreSession = (session: {
    panes?: SessionPaneEntry[];
    focusedPaneIndex?: number;
  }): boolean => {
    const validPanes: PaneEntity[] = (session.panes ?? [])
      .filter(
        (p: SessionPaneEntry) =>
          p && typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent),
      )
      .map((p: SessionPaneEntry, index: number): PaneSnapshot => ({
        id: `p${index + 1}`,
        title: (typeof p.title === 'string' && p.title) || null,
        terminalTitle: defaultTabTitle,
        cwd: (typeof p.cwd === 'string' && p.cwd) || defaultCwd,
        accent: p.accent,
        customColor:
          typeof p.customColor === 'string'
          && /^#[0-9a-fA-F]{6}$/.test(p.customColor)
          && p.customColor
            || undefined,
        shellProfileId: (typeof p.shellProfileId === 'string' && p.shellProfileId) || null,
        breathingMonitor: p.breathingMonitor !== false,
      }))
      .map((snapshot: PaneSnapshot) => createPane(snapshot));

    if (validPanes.length === 0) {
      panes = createDefaultPanes();
      // Update the restored panes with current defaults
      for (const pane of panes) {
        pane.setCwd(defaultCwd);
        pane.setTerminalTitle(defaultTabTitle);
      }
      focusedPaneId = panes[0]?.id ?? null;
      nextPaneNumber = panes.length + 1;
      paneMruOrder = panes.map((p: PaneEntity) => p.id);
      paneCycleState = null;
      notifyChange();
      return false;
    }

    panes = validPanes;
    const focusedIndex: number = Math.min(
      Number.isFinite(session.focusedPaneIndex) ? session.focusedPaneIndex! : 0,
      panes.length - 1,
    );
    focusedPaneId = panes[Math.max(0, focusedIndex)]?.id ?? null;
    nextPaneNumber = panes.length + 1;
    // Initial MRU order: focused pane first, then remaining panes in tab order.
    paneMruOrder = [
      focusedPaneId ?? '',
      ...panes.map((p: PaneEntity) => p.id).filter((id: string) => id !== focusedPaneId),
    ].filter((id: string) => id !== '');
    paneCycleState = null;
    notifyChange();
    return true;
  };

  // Public API
  return {
    // Read operations
    getPanes,
    getFocusedPaneId,
    getPaneById,
    getPaneIndex,
    getFocusedIndex,
    getDefaultPanes: (): Pane[] => panes.map((pane: PaneEntity) => paneToLegacy(pane)),

    // Write operations
    addPane,
    closePane,
    focusPane,
    moveFocus,
    navigateLeft,
    navigateRight,
    reorderPane,

    // MRU operations
    cycleToRecentPane,
    commitPaneCycle,
    hasActivePaneCycle: (): boolean => paneCycleState !== null,
    recordPaneVisit,

    // Property modification operations
    setPaneTitle,
    setPaneCwd,
    setPaneColor,
    clearPaneColor,
    setPaneShellProfile,
    setPaneTerminalTitle,
    togglePaneBreathingMonitor,
    setDefaultCwd,

    // Session operations
    buildSessionData,
    restoreSession,
  };
}
