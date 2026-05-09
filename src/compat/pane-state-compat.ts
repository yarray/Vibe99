/**
 * PaneState Compat — wraps PaneManager + FocusController to expose the
 * legacy PaneState interface.  Consumers can swap `createPaneState` for
 * `createPaneStateCompat` without changing their call-sites.
 *
 * @module compat/pane-state-compat
 */

import type { PaneManager } from '../manager/create-pane-manager';
import type { FocusController } from '../manager/create-focus-controller';

// ---------------------------------------------------------------------------
// Types (inlined from the removed pane-state.ts)
// ---------------------------------------------------------------------------

/** Shape of a single pane object. */
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

  // Session operations
  buildSessionData: () => SessionData;
  restoreSession: (session: { panes?: SessionPaneEntry[]; focusedPaneIndex?: number }) => boolean;
}

/** Dependencies for the compat layer. */
export interface PaneStateCompatDeps {
  paneManager: PaneManager;
  focusController: FocusController;
  defaultCwd: string;
  defaultTabTitle: string;
  getAccentPalette: () => string[];
  onStateChange?: () => void;
}

/**
 * Creates a PaneState-compatible object backed by PaneManager + FocusController.
 */
export function createPaneStateCompat(deps: PaneStateCompatDeps): PaneState {
  const {
    paneManager,
    focusController,
    defaultCwd,
    defaultTabTitle,
    getAccentPalette,
    onStateChange,
  } = deps;

  interface PaneView {
    id: string;
    title: string | null;
    terminalTitle: string;
    cwd: string;
    accent: string;
    customColor?: string;
    shellProfileId: string | null;
    breathingMonitor?: boolean;
  }

  let panes: PaneView[] = [];
  let nextPaneNumber = 1;

  // ---- helpers ----

  const notify = (): void => { onStateChange?.(); };

  function makeInitialPanes(): PaneView[] {
    const palette = getAccentPalette();
    return [
      { id: 'p1', title: null, terminalTitle: defaultTabTitle, cwd: defaultCwd, accent: palette[0], shellProfileId: null },
      { id: 'p2', title: null, terminalTitle: defaultTabTitle, cwd: defaultCwd, accent: palette[1], shellProfileId: null },
      { id: 'p3', title: null, terminalTitle: defaultTabTitle, cwd: defaultCwd, accent: palette[2], shellProfileId: null },
    ];
  }

  function pickAccent(): string {
    const palette = getAccentPalette();
    const used = new Set(panes.map((p) => (p.customColor || p.accent).toLowerCase()));
    return palette.find((c) => !used.has(c.toLowerCase()))
      ?? palette[(nextPaneNumber - 1) % palette.length];
  }

  function toPane(view: PaneView): Pane {
    return { ...view };
  }

  // ---- Read operations ----

  function getPanes(): Pane[] {
    return panes.map(toPane);
  }

  function getFocusedPaneId(): string | null {
    return paneManager.getFocusedPaneId();
  }

  function getPaneById(paneId: string): Pane | null {
    const v = panes.find((p) => p.id === paneId);
    return v ? toPane(v) : null;
  }

  function getPaneIndex(paneId: string): number {
    return panes.findIndex((p) => p.id === paneId);
  }

  function getFocusedIndex(): number {
    const fid = paneManager.getFocusedPaneId();
    if (fid === null) return panes.length > 0 ? 0 : -1;
    const idx = panes.findIndex((p) => p.id === fid);
    return idx >= 0 ? idx : 0;
  }

  // ---- Write operations ----

  function addPane(shellProfileId: string | null = null): string {
    const accent = pickAccent();
    const focused = panes[getFocusedIndex()];
    const id = `p${nextPaneNumber++}`;
    const view: PaneView = {
      id,
      title: null,
      terminalTitle: defaultTabTitle,
      cwd: focused?.cwd || defaultCwd,
      accent,
      shellProfileId: shellProfileId ?? null,
    };

    paneManager.create({
      id,
      accent,
      cwd: view.cwd,
      shellProfileId: view.shellProfileId,
    });

    panes = [...panes, view];
    focusController.recordPaneVisit(id);
    notify();
    return id;
  }

  function closePane(index: number): string | null {
    if (panes.length <= 1) return null;
    const closing = panes[index];
    if (!closing) return null;

    const wasFocused = closing.id === paneManager.getFocusedPaneId();
    panes = panes.filter((_, i) => i !== index);
    paneManager.destroy(closing.id);

    if (wasFocused) {
      const fallbackIdx = Math.min(index, panes.length - 1);
      const newId = panes[fallbackIdx]?.id ?? null;
      if (newId) paneManager.setActive(newId);
    }
    focusController.recordPaneVisit(paneManager.getFocusedPaneId());
    notify();
    return closing.id;
  }

  function focusPane(paneId: string): boolean {
    const found = panes.some((p) => p.id === paneId);
    if (!found) return false;
    paneManager.focusPane(paneId);
    focusController.recordPaneVisit(paneId);
    notify();
    return true;
  }

  function moveFocus(delta: number): boolean {
    if (panes.length === 0) return false;
    const idx = getFocusedIndex();
    const nextIdx = (idx + delta + panes.length) % panes.length;
    paneManager.focusPane(panes[nextIdx].id);
    notify();
    return true;
  }

  function navigateLeft(): boolean {
    if (panes.length === 0) return false;
    const idx = getFocusedIndex() - 1;
    if (idx >= 0) {
      paneManager.focusPane(panes[idx].id);
      notify();
      return true;
    }
    return false;
  }

  function navigateRight(): boolean {
    if (panes.length === 0) return false;
    const idx = getFocusedIndex() + 1;
    if (idx < panes.length) {
      paneManager.focusPane(panes[idx].id);
      notify();
      return true;
    }
    return false;
  }

  function reorderPane(paneId: string, newIndex: number): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    const [entry] = panes.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newIndex, panes.length));
    panes.splice(clamped, 0, entry);
    notify();
    return true;
  }

  // ---- MRU operations (delegated to FocusController) ----

  function cycleToRecentPane(opts?: { reverse?: boolean }): string | null {
    const result = focusController.cycleToRecentPane(opts);
    if (result) notify();
    return result;
  }

  function commitPaneCycle(): void {
    focusController.commitPaneCycle();
    notify();
  }

  function hasActivePaneCycle(): boolean {
    return focusController.hasActivePaneCycle();
  }

  function recordPaneVisit(paneId: string | null): void {
    focusController.recordPaneVisit(paneId);
  }

  // ---- Property modification ----

  function setPaneTitle(paneId: string, title: string | null): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    panes[idx] = { ...panes[idx], title: title || null };
    notify();
    return true;
  }

  function setPaneCwd(paneId: string, cwd: string): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    panes[idx] = { ...panes[idx], cwd: cwd || defaultCwd };
    const handle = paneManager.get(paneId);
    handle?.setState({ cwd: cwd || defaultCwd });
    notify();
    return true;
  }

  function setPaneColor(paneId: string, color: string): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    panes[idx] = { ...panes[idx], customColor: color };
    const handle = paneManager.get(paneId);
    handle?.setState({ customColor: color });
    notify();
    return true;
  }

  function clearPaneColor(paneId: string): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    panes[idx] = { ...panes[idx], customColor: undefined };
    notify();
    return true;
  }

  function setPaneShellProfile(paneId: string, profileId: string | null): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    panes[idx] = { ...panes[idx], shellProfileId: profileId };
    const handle = paneManager.get(paneId);
    handle?.setState({ shellProfileId: profileId });
    notify();
    return true;
  }

  function setPaneTerminalTitle(paneId: string, terminalTitle: string): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    panes[idx] = { ...panes[idx], terminalTitle: terminalTitle || defaultTabTitle };
    notify();
    return true;
  }

  function togglePaneBreathingMonitor(paneId: string): boolean {
    const idx = getPaneIndex(paneId);
    if (idx === -1) return false;
    const next = panes[idx].breathingMonitor === false;
    panes[idx] = { ...panes[idx], breathingMonitor: next };
    notify();
    return next;
  }

  // ---- Session operations ----

  function buildSessionData(): SessionData {
    const focusedIndex = getFocusedIndex();
    return {
      version: 2,
      panes: panes.map((p) => ({
        paneId: p.id,
        title: p.title,
        cwd: p.cwd,
        accent: p.accent,
        customColor: p.customColor,
        shellProfileId: p.shellProfileId,
        breathingMonitor: p.breathingMonitor !== false,
      })),
      focusedPaneIndex: focusedIndex >= 0 ? focusedIndex : 0,
    };
  }

  function restoreSession(session: {
    panes?: SessionPaneEntry[];
    focusedPaneIndex?: number;
  }): boolean {
    const valid: PaneView[] = (session.panes ?? [])
      .filter(
        (p) =>
          p && typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent),
      )
      .map((p, index): PaneView => ({
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
      }));

    // Destroy any existing panes from PaneManager
    for (const existing of paneManager.getAll()) {
      paneManager.destroy(existing.id);
    }

    if (valid.length === 0) {
      panes = makeInitialPanes();
      panes.forEach((p) => {
        paneManager.create({ id: p.id, accent: p.accent, cwd: p.cwd, shellProfileId: p.shellProfileId });
      });
      paneManager.setActive(panes[0].id);
      nextPaneNumber = panes.length + 1;
      notify();
      return false;
    }

    panes = valid;
    valid.forEach((p) => {
      paneManager.create({ id: p.id, accent: p.accent, cwd: p.cwd, shellProfileId: p.shellProfileId });
    });
    const focusedIndex = Math.min(
      Number.isFinite(session.focusedPaneIndex) ? session.focusedPaneIndex! : 0,
      panes.length - 1,
    );
    paneManager.setActive(panes[Math.max(0, focusedIndex)].id);
    nextPaneNumber = panes.length + 1;
    notify();
    return true;
  }

  // ---- Public API ----

  return {
    getPanes,
    getFocusedPaneId,
    getPaneById,
    getPaneIndex,
    getFocusedIndex,

    addPane,
    closePane,
    focusPane,
    moveFocus,
    navigateLeft,
    navigateRight,
    reorderPane,

    cycleToRecentPane,
    commitPaneCycle,
    hasActivePaneCycle,
    recordPaneVisit,

    setPaneTitle,
    setPaneCwd,
    setPaneColor,
    clearPaneColor,
    setPaneShellProfile,
    setPaneTerminalTitle,
    togglePaneBreathingMonitor,

    buildSessionData,
    restoreSession,
  };
}
