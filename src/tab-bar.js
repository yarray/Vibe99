/**
 * Tab Bar Module
 *
 * Handles tab rendering, drag-and-drop reordering, focus management,
 * and inline renaming for the terminal pane tabs.
 *
 * @module tab-bar
 */

/**
 * Creates a tab bar instance.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.paneState - Pane state manager from pane-state.js
 * @param {Object} deps.state - Local state object containing transient UI state
 * @param {string|null} deps.state.renamingPaneId - ID of the pane being renamed
 * @param {Object|null} deps.state.dragState - Current drag state
 * @param {Object|null} deps.state.pendingTabFocus - Pending tab focus state
 * @param {string} deps.state.currentMode - Current mode ('terminal' or 'nav')
 * @param {string|null} deps.state.pendingClosePaneId - ID of pane pending close
 * @param {Function} deps.getPaneLabel - Function to get label for a pane
 * @param {Function} deps.getTextForBg - Function to get text color for background
 * @param {Function} deps.onTabClick - Callback when tab is clicked (focusPane)
 * @param {Function} deps.onTabContext - Callback when tab is context-clicked
 * @param {Function} deps.onTabDrag - Callback when tab is dragged (fromIndex, toIndex)
 * @param {Function} deps.onRename - Callback when tab is renamed (paneId, title)
 * @param {Function} deps.onCloseTab - Callback when tab close is clicked (index)
 * @param {Function} deps.reportError - Error reporting function
 * @param {HTMLElement} deps.tabsListEl - Container element for tabs
 * @param {Function} deps.setIcon - Icon setting function from icons.js
 * @returns {Object} Tab bar API
 */
export function createTabBar({
  paneState,
  state,
  getPaneLabel,
  getTextColorForBackground,
  onTabClick,
  onTabContext,
  onTabDrag,
  onRename,
  onCloseTab,
  reportError,
  tabsListEl,
  setIcon,
}) {
  let isRenderingTabs = false;

  /**
   * Begins renaming a pane.
   * @param {number} index - Pane index
   */
  function beginRenamePane(index) {
    const panes = paneState.getPanes();
    const pane = panes[index];
    if (!pane) {
      return;
    }

    clearPendingTabFocus();
    state.renamingPaneId = pane.id;
    try {
      renderTabs();
    } catch (error) {
      state.renamingPaneId = null;
      reportError(error);
    }
  }

  /**
   * Cancels renaming a pane.
   */
  function cancelRenamePane() {
    state.renamingPaneId = null;
    try {
      renderTabs();
    } catch (error) {
      reportError(error);
    }
  }

  /**
   * Commits the rename of a pane.
   * @param {string} paneId - Pane ID
   * @param {string} nextTitle - New title
   */
  function commitRenamePane(paneId, nextTitle) {
    const trimmedTitle = nextTitle.trim();
    state.renamingPaneId = null;
    onRename(paneId, trimmedTitle || null);
  }

  /**
   * Clears pending tab focus.
   */
  function clearPendingTabFocus() {
    if (!state.pendingTabFocus) {
      return;
    }

    window.clearTimeout(state.pendingTabFocus.timerId);
    state.pendingTabFocus = null;
  }

  /**
   * Schedules tab focus after a delay.
   * @param {string} paneId - Pane ID to focus
   */
  function scheduleTabFocus(paneId) {
    clearPendingTabFocus();
    state.pendingTabFocus = {
      paneId,
      timerId: window.setTimeout(() => {
        state.pendingTabFocus = null;
        onTabClick(paneId);
      }, 180),
    };
  }

  /**
   * Handles pointer up on a tab.
   * @param {string} paneId - Pane ID
   */
  function activateTabPointerUp(paneId) {
    if (state.pendingTabFocus?.paneId === paneId) {
      clearPendingTabFocus();
      const paneIndex = paneState.getPaneIndex(paneId);
      if (paneIndex !== -1) {
        beginRenamePane(paneIndex);
      }
      return;
    }

    scheduleTabFocus(paneId);
  }

  /**
   * Begins dragging a tab.
   * @param {number} index - Tab index
   * @param {PointerEvent} event - Pointer event
   */
  function beginTabDrag(index, event) {
    if (event.button !== 0 || state.renamingPaneId !== null) {
      return;
    }

    const panes = paneState.getPanes();
    const pane = panes[index];
    if (!pane) {
      return;
    }

    event.preventDefault();
    state.dragState = {
      paneId: pane.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      currentX: event.clientX,
      dropIndex: index,
      hasMoved: false,
    };

    document.body.classList.add('is-dragging-tabs');
    window.addEventListener('pointermove', handleTabPointerMove);
    window.addEventListener('pointerup', handleTabPointerUp);
    window.addEventListener('pointercancel', handleTabPointerUp);
  }

  /**
   * Handles pointer move during tab drag.
   * @param {PointerEvent} event - Pointer event
   */
  function handleTabPointerMove(event) {
    if (!state.dragState || event.pointerId !== state.dragState.pointerId) {
      return;
    }

    state.dragState.currentX = event.clientX;
    const offsetX = state.dragState.currentX - state.dragState.startX;
    const hasMoved = Math.abs(offsetX) > 4;

    if (!hasMoved && !state.dragState.hasMoved) {
      return;
    }

    state.dragState.hasMoved = true;
    state.dragState.dropIndex = getTabDropIndex(event.clientX);
    renderTabs();
  }

  /**
   * Handles pointer up during tab drag.
   * @param {PointerEvent} event - Pointer event
   */
  function handleTabPointerUp(event) {
    if (!state.dragState || event.pointerId !== state.dragState.pointerId) {
      return;
    }

    const { paneId, dropIndex, hasMoved } = state.dragState;
    endTabDrag();

    if (!hasMoved) {
      activateTabPointerUp(paneId);
      return;
    }

    // Call the drag callback with from and to indices
    const panes = paneState.getPanes();
    const fromIndex = panes.findIndex((entry) => entry.id === paneId);
    if (fromIndex !== -1) {
      onTabDrag(fromIndex, dropIndex);
    }
  }

  /**
   * Ends the current tab drag operation.
   */
  function endTabDrag() {
    state.dragState = null;
    document.body.classList.remove('is-dragging-tabs');
    window.removeEventListener('pointermove', handleTabPointerMove);
    window.removeEventListener('pointerup', handleTabPointerUp);
    window.removeEventListener('pointercancel', handleTabPointerUp);
  }

  /**
   * Gets the drop index for a tab based on client X position.
   * @param {number} clientX - Client X coordinate
   * @returns {number} Drop index
   */
  function getTabDropIndex(clientX) {
    const tabElements = [...tabsListEl.querySelectorAll('.tab')].filter(
      (tab) => tab.dataset.paneId !== state.dragState?.paneId
    );

    let slot = 0;
    for (const tab of tabElements) {
      const rect = tab.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return slot;
      }
      slot += 1;
    }

    return slot;
  }

  /**
   * Creates a tab DOM element.
   * @param {Object} pane - Pane data
   * @param {number} index - Tab index
   * @param {number} focusedIndex - Index of the focused tab
   * @param {Object} dragMeta - Drag metadata
   * @returns {HTMLElement} Tab element
   */
  function createTab(pane, index, focusedIndex, dragMeta) {
    const tab = document.createElement('div');
    tab.className = `tab${index === focusedIndex ? ' is-focused' : ''}`;
    if (dragMeta?.isDragging) {
      tab.classList.add('is-dragging');
      tab.style.transform = `translateX(${dragMeta.offsetX}px)`;
    }
    if (dragMeta?.insertBefore) {
      tab.classList.add('insert-before');
    }
    const accentColor = pane.customColor || pane.accent;
    tab.style.setProperty('--pane-accent', accentColor);
    tab.style.setProperty('--tab-text-color', getTextColorForBackground(accentColor));
    tab.dataset.paneId = pane.id;
    tab.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onTabContext(pane.id, event);
    });

    const tabMain = document.createElement('button');
    tabMain.type = 'button';
    tabMain.className = 'tab-main';
    tabMain.setAttribute('aria-pressed', String(index === focusedIndex));
    tabMain.addEventListener('pointerdown', (event) => {
      beginTabDrag(index, event);
    });
    tabMain.addEventListener('dblclick', (event) => {
      event.preventDefault();
      beginRenamePane(index);
    });

    const swatch = document.createElement('span');
    swatch.className = 'tab-swatch';

    // Show number badge in navigation mode
    if (state.currentMode === 'nav') {
      swatch.textContent = String(index + 1);
      // Apply text color based on accent color brightness
      swatch.style.setProperty('--swatch-text-color', 'var(--tab-text-color)');
    }

    let label;
    if (state.renamingPaneId === pane.id) {
      label = document.createElement('input');
      label.className = 'tab-input';
      label.type = 'text';
      label.value = getPaneLabel(pane);
      label.setAttribute('aria-label', `Rename tab ${pane.id}`);
      label.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      label.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      label.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          commitRenamePane(pane.id, label.value);
        }

        if (event.key === 'Escape') {
          event.stopPropagation();
          cancelRenamePane();
        }
      });
      label.addEventListener('blur', () => {
        commitRenamePane(pane.id, label.value);
      });
      queueMicrotask(() => {
        label.focus();
        label.select();
      });
    } else {
      label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = getPaneLabel(pane);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    setIcon(close, 'x', 14);
    close.setAttribute('aria-label', `Close tab ${pane.id}`);

    const panes = paneState.getPanes();
    close.disabled = panes.length === 1;

    // Show pending close state
    if (state.pendingClosePaneId === pane.id) {
      close.classList.add('pending-close');
      close.textContent = '?';
    }

    close.addEventListener('click', (event) => {
      event.stopPropagation();
      onCloseTab(index);
    });

    tabMain.append(swatch, label);
    tab.append(tabMain, close);
    return tab;
  }

  /**
   * Renders all tabs.
   */
  function renderTabs() {
    if (isRenderingTabs) {
      return;
    }
    isRenderingTabs = true;
    const panes = paneState.getPanes();
    const focusedIndex = paneState.getFocusedIndex();
    const draggedPaneId = state.dragState?.paneId ?? null;
    let slot = 0;

    tabsListEl.replaceChildren(
      ...panes.map((pane, index) => {
        const isDragging = pane.id === draggedPaneId && state.dragState?.hasMoved;
        const insertBefore = !isDragging && state.dragState?.hasMoved && state.dragState.dropIndex === slot;
        const dragMeta = {
          isDragging,
          insertBefore,
          offsetX: isDragging ? state.dragState.currentX - state.dragState.startX : 0,
        };
        if (!isDragging) {
          slot += 1;
        }
        return createTab(pane, index, focusedIndex, dragMeta);
      })
    );
    isRenderingTabs = false;
  }

  return {
    renderTabs,
    beginRenamePane,
    cancelRenamePane,
    commitRenamePane,
  };
}
