/**
 * Pane State Management Module
 *
 * Pure logic module for managing pane state, collection operations, and
 * session persistence. No DOM operations.
 *
 * @module pane-state
 */

/**
 * Creates a pane state manager.
 *
 * @param {Object} deps - Dependencies
 * @param {string} deps.defaultCwd - Default working directory for new panes
 * @param {string} deps.defaultTabTitle - Default title for new panes
 * @param {() => string[]} deps.getAccentPalette - Function that returns the color palette for accents
 * @param {() => void} deps.onStateChange - Callback called when state changes
 * @returns {Object} Pane state manager interface
 */
export function createPaneState({ defaultCwd, defaultTabTitle, getAccentPalette, onStateChange }) {
  const palette = getAccentPalette();
  const initialPanes = [
    {
      id: 'p1',
      title: null,
      terminalTitle: defaultTabTitle,
      cwd: defaultCwd,
      accent: palette[0],
      shellProfileId: null,
    },
    {
      id: 'p2',
      title: null,
      terminalTitle: defaultTabTitle,
      cwd: defaultCwd,
      accent: palette[1],
      shellProfileId: null,
    },
    {
      id: 'p3',
      title: null,
      terminalTitle: defaultTabTitle,
      cwd: defaultCwd,
      accent: palette[2],
      shellProfileId: null,
    },
  ];

  // Core state
  let panes = initialPanes.map((pane) => ({ ...pane }));
  let focusedPaneId = panes[0].id;
  let nextPaneNumber = panes.length + 1;

  // Most-recently-used pane stack for Ctrl+Tab cycling. Index 0 is the most
  // recently visited pane (typically equals focusedPaneId when no cycle is in
  // progress). All current pane IDs always appear exactly once.
  let paneMruOrder = panes.map((pane) => pane.id);

  // Transient state while the user is cycling with the modifier still held.
  // `snapshot` freezes the MRU order at the start of the cycle so repeated
  // presses step through a stable list. `index` points into that snapshot.
  // `null` means no cycle is in progress.
  let paneCycleState = null;

  // Internal helpers
  const notifyChange = () => {
    if (onStateChange) {
      onStateChange();
    }
  };

  const syncPaneMruOrder = () => {
    const known = new Set(panes.map((pane) => pane.id));
    paneMruOrder = paneMruOrder.filter((id) => known.has(id));
    for (const pane of panes) {
      if (!paneMruOrder.includes(pane.id)) {
        paneMruOrder.push(pane.id);
      }
    }
  };

  // Read operations
  const getPanes = () => [...panes];

  const getFocusedPaneId = () => focusedPaneId;

  const getPaneById = (paneId) => panes.find((pane) => pane.id === paneId) ?? null;

  const getPaneIndex = (paneId) => panes.findIndex((pane) => pane.id === paneId);

  const getFocusedIndex = () => {
    const focusedIndex = panes.findIndex((pane) => pane.id === focusedPaneId);
    if (focusedIndex !== -1) {
      return focusedIndex;
    }

    focusedPaneId = panes[0]?.id ?? null;
    return panes.length > 0 ? 0 : -1;
  };

  // Write operations
  const addPane = (shellProfileId = null) => {
    const usedAccents = new Set(panes.map((p) => (p.customColor || p.accent).toLowerCase()));
    const accent = getAccentPalette().find((c) => !usedAccents.has(c.toLowerCase()))
      || getAccentPalette()[(nextPaneNumber - 1) % getAccentPalette().length];
    const focusedPane = panes[getFocusedIndex()];
    const newPane = {
      id: `p${nextPaneNumber}`,
      title: null,
      terminalTitle: defaultTabTitle,
      cwd: focusedPane?.cwd || defaultCwd,
      accent,
      shellProfileId: shellProfileId ?? null,
    };

    nextPaneNumber += 1;
    paneCycleState = null;
    panes = [...panes, newPane];
    focusedPaneId = newPane.id;
    recordPaneVisit(newPane.id);
    notifyChange();
    return newPane.id;
  };

  const closePane = (index) => {
    if (panes.length === 1) {
      return null;
    }

    const closingPane = panes[index];
    if (!closingPane) {
      return null;
    }

    const wasFocused = closingPane.id === focusedPaneId;
    const remainingPanes = panes.filter((_, paneIndex) => paneIndex !== index);
    if (wasFocused) {
      const fallbackIndex = Math.max(0, index - 1);
      focusedPaneId = remainingPanes[fallbackIndex]?.id ?? remainingPanes[0]?.id ?? null;
    }
    panes = remainingPanes;
    paneCycleState = null;
    paneMruOrder = paneMruOrder.filter((id) => id !== closingPane.id);
    recordPaneVisit(focusedPaneId);
    notifyChange();
    return closingPane.id;
  };

  const focusPane = (paneId) => {
    const targetPane = panes.find((p) => p.id === paneId);
    if (!targetPane) {
      return false;
    }
    paneCycleState = null;
    focusedPaneId = paneId;
    recordPaneVisit(paneId);
    notifyChange();
    return true;
  };

  const moveFocus = (delta) => {
    if (panes.length === 0) {
      return false;
    }

    const focusedIndex = getFocusedIndex();
    const nextIndex = (focusedIndex + delta + panes.length) % panes.length;
    focusedPaneId = panes[nextIndex].id;
    notifyChange();
    return true;
  };

  const navigateLeft = () => {
    if (panes.length === 0) {
      return false;
    }

    const focusedIndex = getFocusedIndex();
    const nextIndex = focusedIndex - 1;

    if (nextIndex >= 0) {
      focusedPaneId = panes[nextIndex].id;
      notifyChange();
      return true;
    }
    return false;
  };

  const navigateRight = () => {
    if (panes.length === 0) {
      return false;
    }

    const focusedIndex = getFocusedIndex();
    const nextIndex = focusedIndex + 1;

    if (nextIndex < panes.length) {
      focusedPaneId = panes[nextIndex].id;
      notifyChange();
      return true;
    }
    return false;
  };

  // MRU operations
  const recordPaneVisit = (paneId) => {
    if (!paneId) {
      return;
    }
    if (paneMruOrder[0] === paneId) {
      return;
    }
    paneMruOrder = [paneId, ...paneMruOrder.filter((id) => id !== paneId)];
  };

  const cycleToRecentPane = ({ reverse = false } = {}) => {
    if (panes.length < 2) {
      return null;
    }

    syncPaneMruOrder();

    if (!paneCycleState) {
      paneCycleState = { snapshot: [...paneMruOrder], index: 0 };
    }

    const { snapshot } = paneCycleState;
    if (snapshot.length < 2) {
      return null;
    }

    const step = reverse ? -1 : 1;
    paneCycleState.index = (paneCycleState.index + step + snapshot.length) % snapshot.length;
    const targetId = snapshot[paneCycleState.index];

    if (!panes.some((pane) => pane.id === targetId)) {
      // Target pane was closed mid-cycle — recover by aborting.
      paneCycleState = null;
      return null;
    }

    focusedPaneId = targetId;
    notifyChange();
    return targetId;
  };

  const commitPaneCycle = () => {
    if (!paneCycleState) {
      return;
    }
    paneCycleState = null;
    recordPaneVisit(focusedPaneId);
    notifyChange();
  };

  // Property modification operations
  const setPaneTitle = (paneId, title) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex] = { ...panes[paneIndex], title: title || null };
    notifyChange();
    return true;
  };

  const setPaneCwd = (paneId, cwd) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex] = { ...panes[paneIndex], cwd: cwd || defaultCwd };
    notifyChange();
    return true;
  };

  const setPaneColor = (paneId, color) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex] = { ...panes[paneIndex], customColor: color };
    notifyChange();
    return true;
  };

  const clearPaneColor = (paneId) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex] = { ...panes[paneIndex], customColor: undefined };
    notifyChange();
    return true;
  };

  const setPaneShellProfile = (paneId, profileId) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex] = { ...panes[paneIndex], shellProfileId: profileId };
    notifyChange();
    return true;
  };

  const setPaneTerminalTitle = (paneId, terminalTitle) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    panes[paneIndex] = { ...panes[paneIndex], terminalTitle: terminalTitle || defaultTabTitle };
    notifyChange();
    return true;
  };

  const togglePaneBreathingMonitor = (paneId) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    const next = panes[paneIndex].breathingMonitor === false;
    panes[paneIndex] = { ...panes[paneIndex], breathingMonitor: next };
    notifyChange();
    return next;
  };

  const reorderPane = (paneId, newIndex) => {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex === -1) return false;

    const pane = panes[paneIndex];
    const nextPanes = panes.filter((p) => p.id !== paneId);
    const insertionIndex = Math.max(0, Math.min(newIndex, nextPanes.length));
    nextPanes.splice(insertionIndex, 0, pane);
    panes = nextPanes;
    notifyChange();
    return true;
  };

  // Session operations
  const buildSessionData = () => {
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
  };

  const restoreSession = (session) => {
    const validPanes = (session.panes ?? [])
      .filter((p) => p && typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent))
      .map((p, index) => ({
        id: `p${index + 1}`,
        title: (typeof p.title === 'string' && p.title) || null,
        terminalTitle: defaultTabTitle,
        cwd: (typeof p.cwd === 'string' && p.cwd) || defaultCwd,
        accent: p.accent,
        customColor: (typeof p.customColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.customColor) && p.customColor) || undefined,
        shellProfileId: (typeof p.shellProfileId === 'string' && p.shellProfileId) || null,
        breathingMonitor: p.breathingMonitor !== false,
      }));

    if (validPanes.length === 0) {
      panes = initialPanes.map((p) => ({
        ...p,
        cwd: defaultCwd,
        terminalTitle: defaultTabTitle,
      }));
      focusedPaneId = panes[0].id;
      nextPaneNumber = panes.length + 1;
      paneMruOrder = panes.map((p) => p.id);
      paneCycleState = null;
      notifyChange();
      return false;
    }

    panes = validPanes;
    const focusedIndex = Math.min(
      Number.isFinite(session.focusedPaneIndex) ? session.focusedPaneIndex : 0,
      panes.length - 1,
    );
    focusedPaneId = panes[Math.max(0, focusedIndex)].id;
    nextPaneNumber = panes.length + 1;
    // Initial MRU order: focused pane first, then remaining panes in tab order.
    paneMruOrder = [focusedPaneId, ...panes.map((p) => p.id).filter((id) => id !== focusedPaneId)];
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
    hasActivePaneCycle: () => paneCycleState !== null,
    recordPaneVisit,

    // Property modification operations
    setPaneTitle,
    setPaneCwd,
    setPaneColor,
    clearPaneColor,
    setPaneShellProfile,
    setPaneTerminalTitle,
    togglePaneBreathingMonitor,

    // Session operations
    buildSessionData,
    restoreSession,
  };
}
