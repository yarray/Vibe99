import { setIcon } from './icons';
import {
  type Bridge,
  type LayoutData,
  type LayoutsListResult,
  type LayoutSaveResult,
  readLayoutWindowBindings,
  writeLayoutWindowBindings,
  clearLayoutWindowBinding,
} from './bridge';
import type { PaneState, SessionData } from './pane-state';
import type { ModalStack, CloseFn } from './modal-stack';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Dependencies injected into createLayoutManager. */
export interface LayoutManagerDeps {
  bridge: Bridge;
  paneState: PaneState;
  modalStack: ModalStack;
  reportError: (error: unknown) => void;
  layoutsButtonEl: HTMLElement;
  onManageLayouts?: () => void;
}

/** The public API surface returned by createLayoutManager. */
export interface LayoutManager {
  setWindowLayoutId: (layoutId: string | null) => void;
  getWindowLayoutId: () => string | null;
  refreshLayouts: () => Promise<LayoutsListResult>;
  saveCurrentLayout: () => Promise<void>;
  saveLayoutAs: (name: string) => Promise<void>;
  switchLayout: (layoutId: string) => Promise<void>;
  updateLayoutsIndicator: () => void;
  deleteLayoutById: (layoutId: string) => Promise<void>;
  renameLayoutById: (layoutId: string, newName: string) => void;
  toggleLayoutsDropdown: () => Promise<void>;
  closeLayoutsDropdown: () => void;
  scheduleWindowLayoutSave: (delay?: number) => void;
  flushWindowLayoutSave: () => void;
  getLayoutDisplayName: (layoutId: string | null) => string;
  createDefaultLayout: () => LayoutData;
  getLayouts: () => LayoutData[];
  getDefaultLayoutId: () => string;
  setLayoutRestoreComplete: (value: boolean) => void;
  // Internal accessors for layout-modal
  _getSelectedLayoutId: () => string | null;
  _setSelectedLayoutId: (id: string | null) => void;
  _getRenamingLayoutId: () => string | null;
  _setRenamingLayoutId: (id: string | null) => void;
  _setLayouts: (newLayouts: LayoutData[]) => void;
  _setDefaultLayoutId: (id: string) => void;
  createLayoutFromCurrentWindow: (layoutId: string, name: string) => LayoutData;
  restoreSession: (session: { panes?: SessionData['panes']; focusedPaneIndex?: number }) => boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLayoutManager({
  bridge,
  paneState,
  modalStack,
  reportError,
  layoutsButtonEl,
  onManageLayouts,
}: LayoutManagerDeps): LayoutManager {
  let windowLayoutId: string | null = null;
  let layouts: LayoutData[] = [];
  let defaultLayoutId: string = '';
  let selectedLayoutId: string | null = null;
  let renamingLayoutId: string | null = null;
  let pendingLayoutSave: ReturnType<typeof setTimeout> | null = null;
  let layoutsDropdownOpen: boolean = false;
  let layoutsDropdownEl: HTMLDivElement | null = null;
  let layoutRestoreComplete: boolean = false;

  function setWindowLayoutId(layoutId: string | null): void {
    if (windowLayoutId === layoutId) return;
    if (windowLayoutId) {
      clearLayoutWindowBinding(windowLayoutId, bridge.currentWindowLabel);
    }
    windowLayoutId = layoutId;
    if (layoutId) {
      const bindings = readLayoutWindowBindings();
      bindings[layoutId] = bridge.currentWindowLabel;
      writeLayoutWindowBindings(bindings);
    }
  }

  function buildSessionData(): SessionData {
    return paneState.buildSessionData();
  }

  function restoreSession(session: { panes?: SessionData['panes']; focusedPaneIndex?: number }): boolean {
    return paneState.restoreSession(session);
  }

  function createLayoutFromCurrentWindow(layoutId: string, name: string): LayoutData {
    const session: SessionData = buildSessionData();
    return {
      id: layoutId,
      name,
      panes: session.panes as unknown as LayoutData['panes'],
      focusedPaneIndex: session.focusedPaneIndex,
    };
  }

  function createDefaultLayout(): LayoutData {
    const currentPanes = paneState.getPanes();
    return {
      id: 'default',
      name: 'Default',
      panes: currentPanes.map((p) => ({
        paneId: p.id,
        title: p.title,
        cwd: p.cwd,
        accent: p.accent,
        customColor: p.customColor,
        shellProfileId: p.shellProfileId,
        breathingMonitor: p.breathingMonitor !== false,
      })) as unknown as LayoutData['panes'],
      focusedPaneIndex: 0,
    };
  }

  async function refreshLayouts(): Promise<LayoutsListResult> {
    const config = await bridge.listLayouts();
    layouts = config.layouts ?? [];
    defaultLayoutId = config.defaultLayoutId ?? '';
    return config;
  }

  async function saveCurrentLayout(): Promise<void> {
    if (!windowLayoutId) {
      throw new Error('Current window is not bound to a layout');
    }
    const existing = layouts.find((l) => l.id === windowLayoutId);
    const layout = createLayoutFromCurrentWindow(windowLayoutId, existing?.name || windowLayoutId);
    const config = await bridge.saveLayout(layout);
    layouts = config.layouts ?? layouts;
    defaultLayoutId = config.defaultLayoutId ?? defaultLayoutId;
    updateLayoutsIndicator();
  }

  async function saveLayoutAs(name: string): Promise<void> {
    if (!name || typeof name !== 'string' || !name.trim()) return;
    name = name.trim();
    const layout = createLayoutFromCurrentWindow(name.toLowerCase().replace(/\s+/g, '-'), name);
    const config = await bridge.saveLayout(layout);
    layouts = config.layouts ?? [];
    defaultLayoutId = config.defaultLayoutId ?? '';
    setWindowLayoutId(layout.id);
    updateLayoutsIndicator();
  }

  async function switchLayout(layoutId: string): Promise<void> {
    const layout = layouts.find((l) => l.id === layoutId);
    if (!layout) return;
    restoreSession({ panes: layout.panes as unknown as SessionData['panes'], focusedPaneIndex: layout.focusedPaneIndex });
    setWindowLayoutId(layoutId);
    flushWindowLayoutSave();
    updateLayoutsIndicator();
  }

  function updateLayoutsIndicator(): void {
    if (!layoutsButtonEl) return;
    const currentLayout = layouts.find((l) => l.id === windowLayoutId);
    const layoutName = currentLayout ? currentLayout.name : 'No layout';
    layoutsButtonEl.setAttribute('aria-label', `Layouts (${layoutName})`);
  }

  function deleteLayoutById(layoutId: string): Promise<void> {
    if (layoutId === windowLayoutId) {
      reportError(new Error('Cannot delete the layout used by this window'));
      return Promise.resolve();
    }
    return bridge.deleteLayout(layoutId)
      .then(() => bridge.listLayouts())
      .then((config: LayoutsListResult) => {
        layouts = config.layouts ?? [];
        defaultLayoutId = config.defaultLayoutId ?? '';
        updateLayoutsIndicator();
      })
      .catch(reportError);
  }

  function renameLayoutById(layoutId: string, newName: string): void {
    bridge.renameLayout(layoutId, newName)
      .then(() => bridge.listLayouts())
      .then((config: LayoutsListResult) => {
        layouts = config.layouts ?? [];
      })
      .catch(reportError);
  }

  function scheduleWindowLayoutSave(delay: number = 250): void {
    if (!layoutRestoreComplete || !windowLayoutId) return;
    if (pendingLayoutSave !== null) {
      window.clearTimeout(pendingLayoutSave);
    }
    pendingLayoutSave = window.setTimeout(() => {
      pendingLayoutSave = null;
      saveCurrentLayout().catch(reportError);
    }, delay);
  }

  function flushWindowLayoutSave(): void {
    if (pendingLayoutSave !== null) {
      window.clearTimeout(pendingLayoutSave);
      pendingLayoutSave = null;
    }
    if (layoutRestoreComplete && windowLayoutId) {
      void saveCurrentLayout().catch(reportError);
    }
  }

  async function toggleLayoutsDropdown(): Promise<void> {
    if (layoutsDropdownOpen) {
      closeLayoutsDropdown();
      return;
    }
    try {
      await refreshLayouts();
    } catch (error: unknown) {
      reportError(error);
    }

    layoutsDropdownEl = document.createElement('div');
    layoutsDropdownEl.className = 'layouts-dropdown';

    if (layouts.length === 0) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'layouts-dropdown-item';
      emptyItem.textContent = 'No saved layouts';
      emptyItem.style.color = 'var(--panel-muted)';
      layoutsDropdownEl.appendChild(emptyItem);
    } else {
      for (const layout of layouts) {
        const item = document.createElement('div');
        item.className = 'layouts-dropdown-item';
        if (layout.id === windowLayoutId) item.classList.add('is-active');

        const checkmark = document.createElement('span');
        checkmark.className = 'layout-item-current';
        if (layout.id === windowLayoutId) checkmark.classList.add('is-active');

        const label = document.createElement('span');
        label.className = 'layouts-dropdown-label';
        label.textContent = layout.name || layout.id;

        item.append(label, checkmark);
        item.addEventListener('click', (event: MouseEvent) => {
          event.stopPropagation();
          bridge.openLayoutWindow(layout.id).catch(reportError);
          closeLayoutsDropdown();
        });
        layoutsDropdownEl.appendChild(item);
      }
    }

    const separator = document.createElement('div');
    separator.className = 'layouts-dropdown-separator';
    layoutsDropdownEl.appendChild(separator);

    const saveAction = document.createElement('div');
    saveAction.className = 'layouts-dropdown-action';
    saveAction.textContent = 'Save Layout As…';
    saveAction.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      if (saveAction.classList.contains('is-editing')) return;
      saveAction.classList.add('is-editing');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'layouts-dropdown-input';
      input.placeholder = 'Layout name';

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'layouts-dropdown-btn layouts-dropdown-btn-confirm';
      setIcon(confirmBtn, 'check', 14);
      confirmBtn.title = 'Confirm (Enter)';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'layouts-dropdown-btn layouts-dropdown-btn-cancel';
      setIcon(cancelBtn, 'x', 14);
      cancelBtn.title = 'Cancel (Esc)';

      let confirmed = false;
      const restore = () => {
        saveAction.classList.remove('is-editing');
        saveAction.replaceChildren();
        saveAction.textContent = 'Save Layout As…';
      };
      const doConfirm = () => {
        if (confirmed) return;
        confirmed = true;
        const value = input.value.trim();
        if (value) saveLayoutAs(value).catch(reportError);
        closeLayoutsDropdown();
      };
      const doCancel = () => {
        if (confirmed) return;
        confirmed = true;
        restore();
      };

      confirmBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); doConfirm(); });
      cancelBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); doCancel(); });
      input.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
        if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
      });

      saveAction.replaceChildren();
      saveAction.append(input, confirmBtn, cancelBtn);
      queueMicrotask(() => input.focus());
    });
    layoutsDropdownEl.appendChild(saveAction);

    const manageAction = document.createElement('div');
    manageAction.className = 'layouts-dropdown-action';
    manageAction.textContent = 'Manage Layouts…';
    manageAction.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      closeLayoutsDropdown();
      onManageLayouts?.();
    });
    layoutsDropdownEl.appendChild(manageAction);

    layoutsButtonEl.appendChild(layoutsDropdownEl);
    layoutsDropdownOpen = true;
    modalStack.register(closeLayoutsDropdown);

    requestAnimationFrame(() => {
      document.addEventListener('click', handleLayoutsDropdownOutsideClick);
    });
  }

  function closeLayoutsDropdown(): void {
    if (layoutsDropdownEl) {
      layoutsDropdownEl.remove();
      layoutsDropdownEl = null;
    }
    layoutsDropdownOpen = false;
    document.removeEventListener('click', handleLayoutsDropdownOutsideClick);
    modalStack.unregister(closeLayoutsDropdown);
  }

  function handleLayoutsDropdownOutsideClick(event: MouseEvent): void {
    if (!layoutsButtonEl.contains(event.target as Node)) {
      closeLayoutsDropdown();
    }
  }

  function getLayoutDisplayName(layoutId: string | null): string {
    if (!layoutId) return 'Layout';
    const layout = layouts.find((item) => item.id === layoutId);
    return layout?.name || (layoutId === 'default' ? 'Default' : layoutId);
  }

  function getWindowLayoutId(): string | null { return windowLayoutId; }
  function getLayouts(): LayoutData[] { return layouts; }
  function getDefaultLayoutId(): string { return defaultLayoutId; }
  function _getSelectedLayoutId(): string | null { return selectedLayoutId; }
  function _setSelectedLayoutId(id: string | null): void { selectedLayoutId = id; }
  function _getRenamingLayoutId(): string | null { return renamingLayoutId; }
  function _setRenamingLayoutId(id: string | null): void { renamingLayoutId = id; }
  function _setLayouts(newLayouts: LayoutData[]): void { layouts = newLayouts; }
  function _setDefaultLayoutId(id: string): void { defaultLayoutId = id; }
  function setLayoutRestoreComplete(value: boolean): void { layoutRestoreComplete = value; }

  return {
    setWindowLayoutId,
    getWindowLayoutId,
    refreshLayouts,
    saveCurrentLayout,
    saveLayoutAs,
    switchLayout,
    updateLayoutsIndicator,
    deleteLayoutById,
    renameLayoutById,
    toggleLayoutsDropdown,
    closeLayoutsDropdown,
    scheduleWindowLayoutSave,
    flushWindowLayoutSave,
    getLayoutDisplayName,
    createDefaultLayout,
    getLayouts,
    getDefaultLayoutId,
    setLayoutRestoreComplete,
    // Internal accessors for layout-modal
    _getSelectedLayoutId,
    _setSelectedLayoutId,
    _getRenamingLayoutId,
    _setRenamingLayoutId,
    _setLayouts,
    _setDefaultLayoutId,
    createLayoutFromCurrentWindow,
    restoreSession,
  };
}
