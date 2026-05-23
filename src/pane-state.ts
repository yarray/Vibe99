/**
 * Pane State Management Module
 *
 * Pure logic module for managing pane state, collection operations, and
 * session persistence. No DOM operations.
 *
 * This module is a compatibility facade over the Layout aggregate root.
 * New code should prefer using `Layout` from `./domain/layout.js` directly.
 *
 * @module pane-state
 */

import type { Pane as PaneEntity, PaneSnapshot } from './domain/pane.js';
import { createPane, createDefaultPane } from './domain/pane.js';
import type { Layout, LayoutSnapshot } from './domain/layout.js';
import { createLayout } from './domain/layout.js';

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
  themeId: string | null;
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
  themeId: string | null;
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
  setPaneTheme: (paneId: string, themeId: string | null) => boolean;
  setPaneTerminalTitle: (paneId: string, terminalTitle: string) => boolean;
  togglePaneBreathingMonitor: (paneId: string) => boolean;
  setDefaultCwd: (cwd: string, tabTitle: string) => void;

  // Session operations
  buildSessionData: () => SessionData;
  restoreSession: (session: { panes?: SessionPaneEntry[]; focusedPaneIndex?: number }) => boolean;

  // Domain access
  /** Get the underlying Layout aggregate root. */
  getLayout: () => Layout;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
    themeId: pane.themeId(),
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
    themeId: snapshot.themeId,
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
  const createDefaultPaneEntities = (): PaneEntity[] => [
    createDefaultPane(crypto.randomUUID(), { cwd: defaultCwd, terminalTitle: defaultTabTitle, accent: palette[0] }),
    createDefaultPane(crypto.randomUUID(), { cwd: defaultCwd, terminalTitle: defaultTabTitle, accent: palette[1] }),
    createDefaultPane(crypto.randomUUID(), { cwd: defaultCwd, terminalTitle: defaultTabTitle, accent: palette[2] }),
  ];

  const defaultPaneEntities = createDefaultPaneEntities();

  // Core state - delegated to Layout aggregate root
  let layout = createLayout({
    id: 'default',
    name: 'Default',
    panes: defaultPaneEntities.map((pane) => pane.snapshot()),
    focusedPaneId: defaultPaneEntities[0]?.id ?? null,
    mruPaneIds: defaultPaneEntities.map((pane) => pane.id),
  });

  // Internal helpers
  const notifyChange = (): void => {
    if (onStateChange) {
      onStateChange();
    }
  };

  // Read operations
  const getPanes = (): Pane[] => layout.panes().map((pane) => paneToLegacy(pane));

  const getFocusedPaneId = (): string | null => layout.focusedPaneId();

  const getPaneById = (paneId: string): Pane | null => {
    const pane = layout.panes().find((p) => p.id === paneId);
    return pane ? paneToLegacy(pane) : null;
  };

  const getPaneIndex = (paneId: string): number =>
    layout.panes().findIndex((pane) => pane.id === paneId);

  const getFocusedIndex = (): number => {
    const focusedIndex = layout.panes().findIndex((pane) => pane.id === layout.focusedPaneId());
    if (focusedIndex !== -1) {
      return focusedIndex;
    }

    const panes = layout.panes();
    const fallbackId = panes[0]?.id ?? null;
    if (fallbackId) {
      layout.setFocusedPaneId(fallbackId);
    }
    return panes.length > 0 ? 0 : -1;
  };

  // Write operations
  const addPane = (shellProfileId: string | null = null): string => {
    const usedAccents: Set<string> = new Set(
      layout.panes().map((p) => (p.customColor() || p.accent()).toLowerCase()),
    );
    const accent: string =
      getAccentPalette().find((c: string) => !usedAccents.has(c.toLowerCase()))
      || getAccentPalette()[layout.panes().length % getAccentPalette().length];
    const focusedPane: PaneEntity | undefined = layout.panes()[getFocusedIndex()];
    const newPane: PaneEntity = createDefaultPane(crypto.randomUUID(), {
      cwd: focusedPane?.cwd() || defaultCwd,
      terminalTitle: defaultTabTitle,
      accent,
    });
    if (shellProfileId !== null && shellProfileId !== undefined) {
      newPane.setShellProfile(shellProfileId);
    }

    layout.addPane(newPane);
    notifyChange();
    return newPane.id;
  };

  const closePane = (index: number): string | null => {
    if (layout.panes().length === 1) {
      return null;
    }

    const closingPane: PaneEntity | undefined = layout.panes()[index];
    if (!closingPane) {
      return null;
    }

    layout.closePane(closingPane.id);
    notifyChange();
    return closingPane.id;
  };

  const focusPane = (paneId: string): boolean => {
    const result = layout.focusPane(paneId);
    if (result) {
      notifyChange();
    }
    return result;
  };

  const moveFocus = (delta: number): boolean => {
    const result = layout.moveFocus(delta);
    if (result) {
      notifyChange();
    }
    return result;
  };

  const navigateLeft = (): boolean => {
    if (layout.panes().length === 0) {
      return false;
    }

    const focusedIndex = getFocusedIndex();
    const nextIndex = focusedIndex - 1;

    if (nextIndex >= 0) {
      layout.setFocusedPaneId(layout.panes()[nextIndex].id);
      notifyChange();
      return true;
    }
    return false;
  };

  const navigateRight = (): boolean => {
    if (layout.panes().length === 0) {
      return false;
    }

    const focusedIndex = getFocusedIndex();
    const nextIndex = focusedIndex + 1;

    if (nextIndex < layout.panes().length) {
      layout.setFocusedPaneId(layout.panes()[nextIndex].id);
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
    layout.recordPaneVisit(paneId);
  };

  const cycleToRecentPane = ({ reverse = false }: { reverse?: boolean } = {}): string | null => {
    const targetId = layout.cycleRecent({ reverse });
    if (targetId) {
      notifyChange();
    }
    return targetId;
  };

  const commitPaneCycle = (): void => {
    layout.commitCycle();
    notifyChange();
  };

  // Property modification operations
  const setPaneTitle = (paneId: string, title: string | null): boolean => {
    const result = layout.renamePane(paneId, title || null);
    if (result) {
      notifyChange();
    }
    return result;
  };

  const setPaneCwd = (paneId: string, cwd: string): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    pane.setCwd(cwd || defaultCwd);
    notifyChange();
    return true;
  };

  const setPaneColor = (paneId: string, color: string): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    pane.setCustomColor(color);
    notifyChange();
    return true;
  };

  const clearPaneColor = (paneId: string): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    pane.clearCustomColor();
    notifyChange();
    return true;
  };

  const setPaneShellProfile = (paneId: string, profileId: string | null): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    pane.setShellProfile(profileId);
    notifyChange();
    return true;
  };

  const setPaneTheme = (paneId: string, themeId: string | null): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    pane.setTheme(themeId);
    notifyChange();
    return true;
  };

  const setPaneTerminalTitle = (paneId: string, terminalTitle: string): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    pane.setTerminalTitle(terminalTitle || defaultTabTitle);
    notifyChange();
    return true;
  };

  const togglePaneBreathingMonitor = (paneId: string): boolean => {
    const pane = layout.panes().find((p) => p.id === paneId);
    if (!pane) return false;

    const current: boolean = pane.breathingMonitorEnabled();
    const next = !current;
    pane.setBreathingMonitor(next);
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

    for (const pane of layout.panes()) {
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
    const result = layout.movePane(paneId, newIndex);
    if (result) {
      notifyChange();
    }
    return result;
  };

  // Session operations
  const buildSessionData = (): SessionData => {
    const panes = layout.panes();
    const focusedIndex = getFocusedIndex();
    return {
      version: 2,
      panes: panes.map((p) => {
        const snapshot = p.snapshot();
        return {
          paneId: snapshot.id,
          title: snapshot.title,
          cwd: snapshot.cwd,
          accent: snapshot.accent,
          customColor: snapshot.customColor,
          shellProfileId: snapshot.shellProfileId,
          themeId: snapshot.themeId,
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
    const validSnapshots: PaneSnapshot[] = (session.panes ?? [])
      .filter(
        (p: SessionPaneEntry) =>
          p && typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent),
      )
      .map((p: SessionPaneEntry, index: number): PaneSnapshot => ({
        id: p.paneId || `p${index + 1}`,
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
        themeId: (typeof p.themeId === 'string' && p.themeId) || null,
        breathingMonitor: p.breathingMonitor !== false,
      }));

    if (validSnapshots.length === 0) {
      const freshDefaults = createDefaultPaneEntities();
      layout = createLayout({
        id: 'default',
        name: 'Default',
        panes: freshDefaults.map((pane) => pane.snapshot()),
        focusedPaneId: freshDefaults[0]?.id ?? null,
        mruPaneIds: freshDefaults.map((pane) => pane.id),
      });
      for (const pane of layout.panes()) {
        pane.setCwd(defaultCwd);
        pane.setTerminalTitle(defaultTabTitle);
      }
      notifyChange();
      return false;
    }

    const focusedIndex: number = Math.min(
      Number.isFinite(session.focusedPaneIndex) ? session.focusedPaneIndex! : 0,
      validSnapshots.length - 1,
    );
    const focusedPaneId = validSnapshots[Math.max(0, focusedIndex)]?.id ?? null;

    layout = createLayout({
      id: 'default',
      name: 'Default',
      panes: validSnapshots,
      focusedPaneId,
      mruPaneIds: [
        focusedPaneId ?? '',
        ...validSnapshots.map((p) => p.id).filter((id) => id !== focusedPaneId),
      ].filter((id) => id !== ''),
    });

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
    getDefaultPanes: (): Pane[] => layout.panes().map((pane) => paneToLegacy(pane)),

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
    hasActivePaneCycle: (): boolean => layout.hasActiveCycle(),
    recordPaneVisit,

    // Property modification operations
    setPaneTitle,
    setPaneCwd,
    setPaneColor,
    clearPaneColor,
    setPaneShellProfile,
    setPaneTheme,
    setPaneTerminalTitle,
    togglePaneBreathingMonitor,
    setDefaultCwd,

    // Session operations
    buildSessionData,
    restoreSession,

    // Domain access
    getLayout: () => layout,
  };
}
