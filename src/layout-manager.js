import { setIcon } from './icons.js';
import {
  readLayoutWindowBindings,
  writeLayoutWindowBindings,
  clearLayoutWindowBinding,
} from './bridge.js';

export function createLayoutManager({
  bridge,
  paneState,
  modalStack,
  reportError,
  layoutsButtonEl,
  onManageLayouts,
}) {
  let windowLayoutId = null;
  let layouts = [];
  let defaultLayoutId = '';
  let selectedLayoutId = null;
  let renamingLayoutId = null;
  let pendingLayoutSave = null;
  let layoutsDropdownOpen = false;
  let layoutsDropdownEl = null;
  let layoutRestoreComplete = false;

  function setWindowLayoutId(layoutId) {
    if (!layoutId || windowLayoutId === layoutId) return;
    if (windowLayoutId) {
      clearLayoutWindowBinding(windowLayoutId, bridge.currentWindowLabel);
    }
    windowLayoutId = layoutId;
    const bindings = readLayoutWindowBindings();
    bindings[layoutId] = bridge.currentWindowLabel;
    writeLayoutWindowBindings(bindings);
  }

  function buildSessionData() {
    return paneState.buildSessionData();
  }

  function restoreSession(session) {
    return paneState.restoreSession(session);
  }

  function createLayoutFromCurrentWindow(layoutId, name) {
    const session = buildSessionData();
    return {
      id: layoutId,
      name,
      panes: session.panes,
      focusedPaneIndex: session.focusedPaneIndex,
    };
  }

  function createDefaultLayout() {
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
      })),
      focusedPaneIndex: 0,
    };
  }

  async function refreshLayouts() {
    const config = await bridge.listLayouts();
    layouts = config.layouts ?? [];
    defaultLayoutId = config.defaultLayoutId ?? '';
    return config;
  }

  async function saveCurrentLayout() {
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

  async function saveLayoutAs(name) {
    if (!name || typeof name !== 'string' || !name.trim()) return;
    name = name.trim();
    const layout = createLayoutFromCurrentWindow(name.toLowerCase().replace(/\s+/g, '-'), name);
    const config = await bridge.saveLayout(layout);
    layouts = config.layouts ?? [];
    defaultLayoutId = config.defaultLayoutId ?? '';
    setWindowLayoutId(layout.id);
    updateLayoutsIndicator();
  }

  async function switchLayout(layoutId) {
    const layout = layouts.find((l) => l.id === layoutId);
    if (!layout) return;
    restoreSession({ panes: layout.panes, focusedPaneIndex: layout.focusedPaneIndex });
    setWindowLayoutId(layoutId);
    flushWindowLayoutSave();
    updateLayoutsIndicator();
  }

  function updateLayoutsIndicator() {
    if (!layoutsButtonEl) return;
    const currentLayout = layouts.find((l) => l.id === windowLayoutId);
    const layoutName = currentLayout ? currentLayout.name : 'No layout';
    layoutsButtonEl.setAttribute('aria-label', `Layouts (${layoutName})`);
  }

  function deleteLayoutById(layoutId) {
    if (layoutId === windowLayoutId) {
      reportError(new Error('Cannot delete the layout used by this window'));
      return Promise.resolve();
    }
    return bridge.deleteLayout(layoutId)
      .then(() => bridge.listLayouts())
      .then((config) => {
        layouts = config.layouts ?? [];
        defaultLayoutId = config.defaultLayoutId ?? '';
        updateLayoutsIndicator();
      })
      .catch(reportError);
  }

  function renameLayoutById(layoutId, newName) {
    bridge.renameLayout(layoutId, newName)
      .then(() => bridge.listLayouts())
      .then((config) => {
        layouts = config.layouts ?? [];
      })
      .catch(reportError);
  }

  function scheduleWindowLayoutSave(delay = 250) {
    if (!layoutRestoreComplete || !windowLayoutId) return;
    if (pendingLayoutSave !== null) {
      window.clearTimeout(pendingLayoutSave);
    }
    pendingLayoutSave = window.setTimeout(() => {
      pendingLayoutSave = null;
      saveCurrentLayout().catch(reportError);
    }, delay);
  }

  function flushWindowLayoutSave() {
    if (pendingLayoutSave !== null) {
      window.clearTimeout(pendingLayoutSave);
      pendingLayoutSave = null;
    }
    if (layoutRestoreComplete && windowLayoutId) {
      void saveCurrentLayout().catch(reportError);
    }
  }

  async function toggleLayoutsDropdown() {
    if (layoutsDropdownOpen) {
      closeLayoutsDropdown();
      return;
    }
    try {
      await refreshLayouts();
    } catch (error) {
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
        item.addEventListener('click', (event) => {
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
    saveAction.addEventListener('click', (event) => {
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

      confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); doConfirm(); });
      cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); doCancel(); });
      input.addEventListener('keydown', (e) => {
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
    manageAction.addEventListener('click', (event) => {
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

  function closeLayoutsDropdown() {
    if (layoutsDropdownEl) {
      layoutsDropdownEl.remove();
      layoutsDropdownEl = null;
    }
    layoutsDropdownOpen = false;
    document.removeEventListener('click', handleLayoutsDropdownOutsideClick);
    modalStack.unregister(closeLayoutsDropdown);
  }

  function handleLayoutsDropdownOutsideClick(event) {
    if (!layoutsButtonEl.contains(event.target)) {
      closeLayoutsDropdown();
    }
  }

  function getLayoutDisplayName(layoutId) {
    if (!layoutId) return 'Layout';
    const layout = layouts.find((item) => item.id === layoutId);
    return layout?.name || (layoutId === 'default' ? 'Default' : layoutId);
  }

  function getWindowLayoutId() { return windowLayoutId; }
  function getLayouts() { return layouts; }
  function getDefaultLayoutId() { return defaultLayoutId; }
  function _getSelectedLayoutId() { return selectedLayoutId; }
  function _setSelectedLayoutId(id) { selectedLayoutId = id; }
  function _getRenamingLayoutId() { return renamingLayoutId; }
  function _setRenamingLayoutId(id) { renamingLayoutId = id; }
  function _setLayouts(newLayouts) { layouts = newLayouts; }
  function _setDefaultLayoutId(id) { defaultLayoutId = id; }
  function setLayoutRestoreComplete(value) { layoutRestoreComplete = value; }

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
