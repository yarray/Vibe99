// Pane operations — coordinates paneState, paneRenderer, tabBar, and layoutManager.

export function createPaneOperations({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  render,
  setMode,
  getCurrentMode,
  state,
}) {
  function focusPane(paneId, options = {}) {
    const { focusTerminal = true } = options;
    paneState.focusPane(paneId);
    setMode('terminal');
    render();
    paneRenderer?.setAlerted(paneId, false);
    if (focusTerminal) {
      paneRenderer?.focusTerminal(paneId);
    }
  }

  function refocusCurrentPaneTerminal() {
    const paneId = paneState.getFocusedPaneId();
    if (!paneId) return;
    setMode('terminal');
    paneRenderer?.focusTerminal(paneId);
  }

  function blurFocusedTerminal() {
    const paneId = paneState.getFocusedPaneId();
    if (paneId) paneRenderer?.blurTerminal(paneId);
  }

  function addPane(shellProfileId = null) {
    const newPaneId = paneState.addPane(shellProfileId);
    setMode('terminal');
    document.body.classList.remove('is-navigation-mode');
    render(true);
    return newPaneId;
  }

  function closePane(index, options = {}) {
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

    const wasFocused = closingPane.id === paneState.getFocusedPaneId();
    paneState.closePane(index);
    render(true);

    if (wasFocused) {
      const newFocusedPaneId = paneState.getFocusedPaneId();
      if (newFocusedPaneId) {
        requestAnimationFrame(() => {
          setMode('terminal');
          paneRenderer?.focusTerminal(newFocusedPaneId);
        });
      }
    }
  }

  function moveFocus(delta) {
    const currentPanes = paneState.getPanes();
    if (currentPanes.length === 0) return;
    paneState.moveFocus(delta);
    render();
  }

  function navigateLeft() {
    const currentPanes = paneState.getPanes();
    if (currentPanes.length === 0) return;
    const focusedIndex = paneState.getFocusedIndex();
    const nextIndex = focusedIndex - 1;
    if (nextIndex >= 0) {
      focusPane(currentPanes[nextIndex].id);
    }
  }

  function navigateRight() {
    const currentPanes = paneState.getPanes();
    if (currentPanes.length === 0) return;
    const focusedIndex = paneState.getFocusedIndex();
    const nextIndex = focusedIndex + 1;
    if (nextIndex < currentPanes.length) {
      focusPane(currentPanes[nextIndex].id);
    }
  }

  function cycleToRecentPane({ reverse = false } = {}) {
    const currentPanes = paneState.getPanes();
    if (currentPanes.length < 2) return;
    const targetId = paneState.cycleToRecentPane({ reverse });
    if (!targetId) return;
    setMode('terminal');
    render();
    paneRenderer?.focusTerminal(targetId);
  }

  function commitPaneCycle() {
    paneState.commitPaneCycle();
  }

  function cycleToNextLitPane() {
    const currentPanes = paneState.getPanes();
    const litIds = currentPanes
      .map((p) => p.id)
      .filter((id) => paneRenderer?.getNode(id)?.root.classList.contains('has-pending-activity'));
    if (litIds.length === 0) return;
    const focusedIndex = litIds.indexOf(paneState.getFocusedPaneId());
    const nextIndex = focusedIndex >= 0 ? (focusedIndex + 1) % litIds.length : 0;
    focusPane(litIds[nextIndex]);
  }

  function focusPaneAt(index) {
    const currentPanes = paneState.getPanes();
    if (currentPanes.length === 0 || index < 0 || index >= currentPanes.length) return;
    paneState.focusPane(currentPanes[index].id);
    render();
  }

  function getPaneCount() {
    return paneState.getPanes().length;
  }

  function getPaneIdAt(index) {
    const currentPanes = paneState.getPanes();
    if (currentPanes.length === 0 || index < 0 || index >= currentPanes.length) return null;
    return currentPanes[index].id;
  }

  function requestClosePane(paneId) {
    if (state.pendingClosePaneId === paneId) {
      const index = paneState.getPaneIndex(paneId);
      if (index !== -1) {
        state.pendingClosePaneId = null;
        closePane(index);
        const currentPanes = paneState.getPanes();
        if (getCurrentMode() === 'nav' && currentPanes.length > 0) {
          focusPane(paneState.getFocusedPaneId(), { focusTerminal: true });
        }
      }
    } else {
      state.pendingClosePaneId = paneId;
      render();
    }
  }

  function startInlineRename(paneId) {
    const index = paneState.getPaneIndex(paneId);
    if (index !== -1) {
      if (getCurrentMode() === 'nav') setMode('terminal');
      tabBar.beginRenamePane(index);
    }
  }

  function togglePaneBreathingMonitor(paneId) {
    const next = paneState.togglePaneBreathingMonitor(paneId);
    layoutManager.scheduleWindowLayoutSave();
    return next;
  }

  function getFocusedPaneAccent() {
    const pane = paneState.getPanes()[paneState.getFocusedIndex()];
    return pane?.customColor || pane?.accent || '#ffd166';
  }

  function isEditableTarget() {
    return (
      document.activeElement?.tagName === 'INPUT' ||
      document.activeElement?.classList?.contains('xterm-helper-textarea')
    );
  }

  async function getClipboardSnapshot(bridge) {
    try {
      return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
    } catch {
      return { text: '', hasImage: false };
    }
  }

  function getPaneLabel(pane) {
    return pane.title ?? pane.terminalTitle ?? '';
  }

  function handleTerminalExit({ paneId, exitCode, reason }) {
    const node = paneRenderer?.getNode(paneId);
    if (!node) return false;

    if (reason === 'killed') {
      paneRenderer.setSessionReady(paneId, false);
      return true;
    }

    const graceMs = 3000;
    const recentShellChange = paneRenderer.getShellChangeTime(paneId) && (Date.now() - paneRenderer.getShellChangeTime(paneId) < graceMs);
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
