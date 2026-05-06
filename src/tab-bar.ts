/**
 * Tab Bar Module
 *
 * Handles tab rendering, drag-and-drop reordering, focus management,
 * and inline renaming for the terminal pane tabs.
 */

import type { Pane, PaneState } from './pane-state';
import type { IconName } from './icons';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface DragState {
  paneId: string;
  pointerId: number;
  startX: number;
  currentX: number;
  dropIndex: number;
  hasMoved: boolean;
}

export interface PendingTabFocus {
  paneId: string;
  timerId: number;
}

export interface TabBarLocalState {
  renamingPaneId: string | null;
  dragState: DragState | null;
  pendingTabFocus: PendingTabFocus | null;
  currentMode: string;
  pendingClosePaneId: string | null;
}

interface DragMeta {
  isDragging: boolean;
  insertBefore: boolean;
  offsetX: number;
}

export interface TabBarDeps {
  paneState: PaneState;
  state: TabBarLocalState;
  getPaneLabel: (pane: Pane) => string;
  getTextColorForBackground: (hexColor: string) => string;
  onTabClick: (paneId: string) => void;
  onTabContext: (paneId: string, event: PointerEvent | MouseEvent) => void;
  onTabDrag: (fromIndex: number, toIndex: number) => void;
  onRename: (paneId: string, title: string | null) => void;
  onCloseTab: (index: number) => void;
  reportError: (error: unknown) => void;
  tabsListEl: HTMLElement;
  setIcon: (el: HTMLElement, name: IconName, size?: number) => void;
}

export interface TabBar {
  renderTabs: () => void;
  beginRenamePane: (index: number) => void;
  cancelRenamePane: () => void;
  commitRenamePane: (paneId: string, nextTitle: string) => void;
  state: TabBarLocalState;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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
}: TabBarDeps): TabBar {
  let isRenderingTabs = false;

  function beginRenamePane(index: number): void {
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

  function cancelRenamePane(): void {
    state.renamingPaneId = null;
    try {
      renderTabs();
    } catch (error) {
      reportError(error);
    }
  }

  function commitRenamePane(paneId: string, nextTitle: string): void {
    const trimmedTitle = nextTitle.trim();
    state.renamingPaneId = null;
    onRename(paneId, trimmedTitle || null);
  }

  function clearPendingTabFocus(): void {
    if (!state.pendingTabFocus) {
      return;
    }

    window.clearTimeout(state.pendingTabFocus.timerId);
    state.pendingTabFocus = null;
  }

  function scheduleTabFocus(paneId: string): void {
    clearPendingTabFocus();
    state.pendingTabFocus = {
      paneId,
      timerId: window.setTimeout(() => {
        state.pendingTabFocus = null;
        onTabClick(paneId);
      }, 180),
    };
  }

  function activateTabPointerUp(paneId: string): void {
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

  function beginTabDrag(index: number, event: PointerEvent): void {
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

  function handleTabPointerMove(event: PointerEvent): void {
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

  function handleTabPointerUp(event: PointerEvent): void {
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

  function endTabDrag(): void {
    state.dragState = null;
    document.body.classList.remove('is-dragging-tabs');
    window.removeEventListener('pointermove', handleTabPointerMove);
    window.removeEventListener('pointerup', handleTabPointerUp);
    window.removeEventListener('pointercancel', handleTabPointerUp);
  }

  function getTabDropIndex(clientX: number): number {
    const tabElements = [...tabsListEl.querySelectorAll<HTMLDivElement>('.tab')].filter(
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

  function createTab(pane: Pane, index: number, focusedIndex: number, dragMeta: DragMeta): HTMLElement {
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

    let label: HTMLElement;
    if (state.renamingPaneId === pane.id) {
      const input = document.createElement('input');
      input.className = 'tab-input';
      input.type = 'text';
      input.value = getPaneLabel(pane);
      input.setAttribute('aria-label', `Rename tab ${pane.id}`);
      input.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      input.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          commitRenamePane(pane.id, input.value);
        }

        if (event.key === 'Escape') {
          event.stopPropagation();
          cancelRenamePane();
        }
      });
      input.addEventListener('blur', () => {
        if (state.renamingPaneId === pane.id) {
          commitRenamePane(pane.id, input.value);
        }
      });
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      label = input;
    } else {
      const span = document.createElement('span');
      span.className = 'tab-label';
      span.textContent = getPaneLabel(pane);
      label = span;
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

  function renderTabs(): void {
    if (isRenderingTabs) {
      return;
    }
    isRenderingTabs = true;
    const panes = paneState.getPanes();
    const focusedIndex = paneState.getFocusedIndex();
    const draggedPaneId = state.dragState?.paneId ?? null;
    const ds = state.dragState;
    let slot = 0;

    tabsListEl.replaceChildren(
      ...panes.map((pane, index) => {
        const isDragging = pane.id === draggedPaneId && ds?.hasMoved === true;
        const insertBefore = !isDragging && ds?.hasMoved === true && ds.dropIndex === slot;
        const dragMeta: DragMeta = {
          isDragging,
          insertBefore,
          offsetX: isDragging && ds ? ds.currentX - ds.startX : 0,
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
    state,
  };
}
