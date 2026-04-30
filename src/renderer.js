import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from './command-palette.js';
import { createPaneActivityWatcher } from './pane-activity-watcher.js';
import { createBreathingMaskAlert } from './pane-alert-breathing-mask.js';
import {
  createBridge,
  clearLayoutWindowBinding,
} from './bridge.js';
import { createPaneRenderer, getTextColorForBackground } from './pane-renderer.js';
import { createShellProfileManager } from './shell-profiles.js';
import { createContextMenus } from './context-menus.js';
import { createLayoutManager } from './layout-manager.js';
import { createLayoutModal } from './layout-modal.js';
import { createModalStack } from './modal-stack.js';
import { createFullscreenManager } from './fullscreen-manager.js';
import { createPaneOperations } from './pane-operations.js';
import { createCommandPaletteEntries } from './command-palette-entries.js';
import '@xterm/xterm/css/xterm.css';

import * as ShortcutsRegistry from './shortcuts-registry.js';
import * as ShortcutsUI from './shortcuts-ui.js';
import * as ColorsRegistry from './colors-registry.js';
import { createPaneState } from './pane-state.js';
import { setIcon } from './icons.js';
import { createActions } from './input/actions.js';
import { createDispatcher } from './input/dispatcher.js';

import { renderHintBar } from './hint-bar.js';
import { createSettingsManager } from './settings.js';
import { createTabBar } from './tab-bar.js';

// ---------------------------------------------------------------------------
const stageEl = document.getElementById('stage');
const tabsListEl = document.getElementById('tabs-list');
const statusLabelEl = document.getElementById('status-label');
const statusHintEl = document.getElementById('status-hint');
const addPaneButtonEl = document.getElementById('tabs-add');
const addProfileButtonEl = document.getElementById('tabs-add-profile');
const layoutsButtonEl = document.getElementById('tabs-layouts');
const settingsButtonEl = document.getElementById('tabs-settings');
const fullscreenButtonEl = document.getElementById('tabs-fullscreen');
const settingsPanelEl = document.getElementById('settings-panel');
const shellProfilesSettingsBtn = document.getElementById('shell-profiles-settings-btn');
const layoutsSettingsBtn = document.getElementById('layouts-settings-btn');
const keyboardShortcutsSettingsBtn = document.getElementById('keyboard-shortcuts-settings-btn');

// ---------------------------------------------------------------------------
let currentMode = 'terminal', paneRenderer = null, enterNavSourcePaneId = null, layoutRestoreComplete = false, layoutFocusNotice = null, layoutFocusNoticeTimer = null;


// Shell-profile state (shared with shell-profiles module via adapter)
let shellProfiles = [], defaultShellProfileId = '', editingShellProfile = null, selectedShellProfileId = null;

// Tab-bar mutable state
const tabBarState = (() => {
  let r = null, d = null, p = null, c = null;
  return {
    get renamingPaneId() { return r; }, set renamingPaneId(v) { r = v; },
    get dragState() { return d; }, set dragState(v) { d = v; },
    get pendingTabFocus() { return p; }, set pendingTabFocus(v) { p = v; },
    get currentMode() { return currentMode; },
    get pendingClosePaneId() { return c; },
  };
})();

// ---------------------------------------------------------------------------
const bridge = createBridge(window.__TAURI__ ?? window.vibe99 ?? null, null);

const windowContext = (() => {
  const params = new URLSearchParams(window.location.search);
  const layoutId = params.get('layoutId');
  return layoutId ? { kind: 'layout', layoutId } : { kind: 'main' };
})();

// ---------------------------------------------------------------------------
const paneState = createPaneState({
  defaultCwd: bridge.defaultCwd,
  defaultTabTitle: bridge.defaultTabTitle,
  getAccentPalette: () => ColorsRegistry.ACCENT_PALETTE,
  onStateChange: () => {},
});

const modalStack = createModalStack();

const layoutManager = createLayoutManager({
  bridge,
  paneState,
  modalStack,
  reportError,
  layoutsButtonEl,
  onManageLayouts: () => layoutModal.openLayoutsModal(),
});

const layoutModal = createLayoutModal({
  bridge,
  paneState,
  modalStack,
  reportError,
  layoutManager,
});

const paneAlert = createBreathingMaskAlert();
const paneActivityWatcher = createPaneActivityWatcher({
  onAlert: (paneId) => paneRenderer?.setAlerted(paneId, true),
  onClear: (paneId) => paneRenderer?.setAlerted(paneId, false),
});

const settingsManager = createSettingsManager({
  bridge,
  reportError,
  applyCallback: () => render(true),
  paneActivityWatcher,
});

// paneOps is created after tabBar and paneRenderer, but closures capture the binding.
let paneOps = null;

const tabBar = createTabBar({
  paneState,
  state: tabBarState,
  getPaneLabel: (...args) => paneOps?.getPaneLabel(...args),
  getTextColorForBackground,
  onTabClick: (...args) => paneOps?.focusPane(...args),
  onTabContext: (paneId, event) => contextMenus?.showTabContextMenu(paneId, event),
  onTabDrag: (fromIndex, toIndex) => {
    const panes = paneState.getPanes();
    const pane = panes[fromIndex];
    paneState.reorderPane(pane.id, toIndex);
    render();
  },
  onRename: (paneId, title) => {
    paneState.setPaneTitle(paneId, title);
    paneOps?.focusPane(paneId, { focusTerminal: true });
  },
  onCloseTab: (...args) => paneOps?.closePane(...args),
  reportError,
  tabsListEl,
  setIcon,
});

paneRenderer = createPaneRenderer({
  bridge,
  paneState,
  settingsManager,
  paneAlert,
  paneActivityWatcher,
  reportError,
  stageEl,
  getMode: () => currentMode,
  onPaneClick: (...args) => paneOps?.focusPane(...args),
  onTerminalTitleChange: (paneId, title) => paneState.setPaneTerminalTitle(paneId, title),
  onTerminalContextMenu: (node, event) => {
    void contextMenus?.showTerminalContextMenu(node, event);
  },
  scheduleWindowLayoutSave: () => layoutManager.scheduleWindowLayoutSave(),
  tabBar,
  getPaneLabel: (...args) => paneOps?.getPaneLabel(...args),
  onPaneCwdChanged: (paneId, newCwd) => {
    const pane = paneState.getPaneById(paneId);
    if (!pane || pane.cwd === newCwd) return;
    paneState.setPaneCwd(paneId, newCwd);
    layoutManager.scheduleWindowLayoutSave(5000);
  },
});

// Modules that need paneRenderer / tabBar (closures capture the variable binding)
let shellProfileManager = null;
let contextMenus = null;

shellProfileManager = createShellProfileManager({
  bridge,
  state: {
    getPanels: () => paneState.getPanes(),
    setPanels: (newPanes) => {
      newPanes.forEach((p) => {
        const existing = paneState.getPaneById(p.id);
        if (existing && p.shellProfileId !== existing.shellProfileId) {
          paneState.setPaneShellProfile(p.id, p.shellProfileId);
        }
      });
    },
    getFocusedPaneId: () => paneState.getFocusedPaneId(),
    getPaneNode: (paneId) => paneRenderer?.getNode(paneId) ?? null,
    getShellProfiles: () => shellProfiles,
    setShellProfiles: (profiles) => { shellProfiles = profiles; },
    getDefaultShellProfileId: () => defaultShellProfileId,
    setDefaultShellProfileId: (id) => { defaultShellProfileId = id; },
    getDetectedShellProfiles: () => [],
    setDetectedShellProfiles: () => {},
    getEditingShellProfile: () => editingShellProfile,
    setEditingShellProfile: (profile) => { editingShellProfile = profile; },
    getSelectedShellProfileId: () => selectedShellProfileId,
    setSelectedShellProfileId: (id) => { selectedShellProfileId = id; },
  },
  reportError,
  scheduleSave: () => layoutManager.scheduleWindowLayoutSave(),
  initializePaneTerminal: (node) => paneRenderer?.initializePaneTerminal(node),
  registerModal: (closeFn) => modalStack.register(closeFn),
  unregisterModal: (closeFn) => modalStack.unregister(closeFn),
});

contextMenus = createContextMenus({
  state: {
    getPanels: () => paneState.getPanes(),
    setPanels: (newPanes) => {
      newPanes.forEach((p) => {
        const existing = paneState.getPaneById(p.id);
        if (existing && p.customColor !== existing.customColor) {
          if (p.customColor === undefined) {
            paneState.clearPaneColor(p.id);
          } else {
            paneState.setPaneColor(p.id, p.customColor);
          }
        }
      });
    },
    getPaneIndex: (paneId) => paneState.getPaneIndex(paneId),
    getFocusedPaneId: () => paneState.getFocusedPaneId(),
    setFocusedPaneId: (id) => paneState.setFocusedPaneId(id),
    getPaneNode: (paneId) => paneRenderer?.getNode(paneId) ?? null,
    clearPaneCycleState: () => {},
    recordPaneVisit: (paneId) => paneState.recordPaneVisit(paneId),
    render: () => render(),
    scheduleSave: () => layoutManager.scheduleWindowLayoutSave(),
    registerModal: (closeFn) => modalStack.register(closeFn),
    unregisterModal: (closeFn) => modalStack.unregister(closeFn),
  },
  bridge,
  shellProfileManager,
  reportError,
  focusPane: (...args) => paneOps?.focusPane(...args),
  beginRenamePane: (index) => tabBar.beginRenamePane(index),
  closePane: (...args) => paneOps?.closePane(...args),
  togglePaneBreathingMonitor: (paneId) => {
    const next = paneOps?.togglePaneBreathingMonitor(paneId);
    paneActivityWatcher.setPaneEnabled(paneId, next);
  },
});

paneOps = createPaneOperations({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  render,
  setMode,
  getCurrentMode: () => currentMode,
  state: tabBarState,
});

const commandPaletteEntries = createCommandPaletteEntries({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  layoutModal,
  shellProfileManager,
  contextMenus,
  bridge,
  settingsManager,
  modalStack,
  focusPane: (...args) => paneOps?.focusPane(...args),
  addPane: (...args) => paneOps?.addPane(...args),
  closeSettingsPanel,
  closeKeyboardShortcutsModal,
  openKeymapHelpModal,
  settingsPanelEl,
  statusLabelEl,
  statusHintEl,
  getCurrentMode: () => currentMode,
  setMode,
});

const fullscreenManager = createFullscreenManager({
  bridge,
  fullscreenButtonEl,
  reportError,
});

// ---------------------------------------------------------------------------
const removeTerminalDataListener = bridge.onTerminalData(({ paneId, data }) => {
  paneRenderer?.write(paneId, data);
});

bridge.onLayoutFocusNotice?.(() => {
  if (!layoutManager.getWindowLayoutId()) return;
  paneOps?.refocusCurrentPaneTerminal();
  showLayoutFocusNotice(layoutManager.getWindowLayoutId());
});

const removeTerminalExitListener = bridge.onTerminalExit(({ paneId, exitCode, reason }) => {
  const handled = paneOps?.handleTerminalExit({ paneId, exitCode, reason });
  if (handled === false) {
    void bridge.closeWindow().catch(reportError);
  }
});

const removeMenuActionListener = bridge.onMenuAction(({ action, paneId }) => {
  try {
    contextMenus?.handleMenuAction(action, paneId);
  } catch (error) {
    reportError(error);
  }
});

// ---------------------------------------------------------------------------
function reportError(error) {
  statusLabelEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  statusHintEl.textContent = '';
  console.error(error);
}

// ---------------------------------------------------------------------------
function setMode(next) {
  if (currentMode === next) return;
  currentMode = next;
  document.body.classList.toggle('is-navigation-mode', currentMode === 'nav');
  render();
}

function enterNavigationMode() {
  if (paneState.getPanes().length === 0) return;
  enterNavSourcePaneId = paneState.getFocusedPaneId();
  setMode('nav'); paneOps?.blurFocusedTerminal(); render();
}

function cancelNavigationMode() {
  if (enterNavSourcePaneId) { paneOps?.focusPane(enterNavSourcePaneId, { focusTerminal: true }); enterNavSourcePaneId = null; }
  else { setMode('terminal'); render(); }
}

// ---------------------------------------------------------------------------
function render(refit = false) {
  tabBar.renderTabs();
  paneRenderer?.renderPanes(refit);
  updateStatus();
  if (layoutRestoreComplete) {
    layoutManager.scheduleWindowLayoutSave();
  }
}

function updateStatus() {
  if (layoutFocusNotice) {
    statusLabelEl.textContent = 'Layout focused';
    statusLabelEl.classList.remove('is-navigation-mode');
    statusHintEl.textContent = layoutManager.getLayoutDisplayName(layoutFocusNotice.layoutId);
    return;
  }

  const currentPanes = paneState.getPanes();
  const focusedPane = currentPanes[paneState.getFocusedIndex()];
  const focusedPaneLabel = paneOps?.getPaneLabel(focusedPane) || focusedPane.id;

  const keymap = ShortcutsRegistry.getActiveKeymap();
  const { modeLabel, hintsHtml } = renderHintBar(
    keymap,
    currentMode,
    focusedPaneLabel,
    bridge.platform
  );

  statusLabelEl.textContent = modeLabel;
  statusLabelEl.classList.toggle('is-navigation-mode', currentMode === 'nav');
  statusHintEl.innerHTML = hintsHtml;
}

function showLayoutFocusNotice(layoutId) {
  layoutFocusNotice = { layoutId };
  document.body.style.setProperty('--layout-focus-accent', paneOps?.getFocusedPaneAccent());
  document.body.dataset.layoutFocusName = layoutManager.getLayoutDisplayName(layoutId);
  document.body.classList.remove('is-layout-focus-notice');
  void document.body.offsetWidth;
  document.body.classList.add('is-layout-focus-notice');
  updateStatus();
  window.clearTimeout(layoutFocusNoticeTimer);
  layoutFocusNoticeTimer = window.setTimeout(() => {
    layoutFocusNotice = null;
    delete document.body.dataset.layoutFocusName;
    document.body.classList.remove('is-layout-focus-notice');
    updateStatus();
  }, 1400);
}

// ---------------------------------------------------------------------------
function closeSettingsPanel() {
  settingsPanelEl.classList.add('is-hidden');
  modalStack.unregister(closeSettingsPanel);
}
function closeKeyboardShortcutsModal() {
  document.querySelector('.settings-modal-overlay')?.remove();
  modalStack.unregister(closeKeyboardShortcutsModal);
}
function openKeymapHelpModal() {
  closeKeyboardShortcutsModal();
  modalStack.register(closeKeyboardShortcutsModal);
  ShortcutsUI.openKeyboardShortcutsModal(bridge, settingsManager.scheduleSettingsSave);
}

// ---------------------------------------------------------------------------
const keyboardActions = createActions({
  addPane: (...args) => paneOps?.addPane(...args),
  enterNavigationMode,
  cycleToRecentPane: (...args) => paneOps?.cycleToRecentPane(...args),
  cycleToNextLitPane: (...args) => paneOps?.cycleToNextLitPane(...args),
  navigateLeft: (...args) => paneOps?.navigateLeft(...args),
  navigateRight: (...args) => paneOps?.navigateRight(...args),
  copyTerminalSelection: () => paneRenderer?.copySelection(paneState.getFocusedPaneId()),
  pasteIntoTerminal: () => paneRenderer?.pasteInto(paneState.getFocusedPaneId()),
  moveFocus: (...args) => paneOps?.moveFocus(...args),
  focusPane: (...args) => paneOps?.focusPane(...args),
  cancelNavigationMode,
  getFocusedPaneId: () => paneState.getFocusedPaneId(),
  isCommandPaletteOpen,
  closeCommandPalette,
  openTabSwitcher: () => commandPaletteEntries.openTabSwitcher(),
  openCommandList: () => commandPaletteEntries.openCommandList(),
  openNewPaneProfilePicker: () => commandPaletteEntries.openNewPaneProfilePicker(),
  focusPaneAt: (...args) => paneOps?.focusPaneAt(...args),
  getPaneCount: () => paneOps?.getPaneCount(),
  getPaneIdAt: (...args) => paneOps?.getPaneIdAt(...args),
  requestClosePane: (...args) => paneOps?.requestClosePane(...args),
  startInlineRename: (...args) => paneOps?.startInlineRename(...args),
  openKeymapHelpModal,
  openLayoutsModal: () => layoutModal.openLayoutsModal(),
});

const dispatchKeydown = createDispatcher({
  getKeymap: ShortcutsRegistry.getActiveKeymap,
  actions: keyboardActions,
  getMode: () => currentMode,
  isInputFocused: () => document.activeElement?.tagName === 'INPUT',
  isCommandPaletteOpen,
});

window.addEventListener('keydown', dispatchKeydown, true);

window.addEventListener('keyup', (event) => {
  if (paneState.hasActivePaneCycle() && (event.key === 'Control' || event.key === 'Meta')) {
    paneState.commitPaneCycle();
  }
});

window.addEventListener('blur', () => {
  if (paneState.hasActivePaneCycle()) paneState.commitPaneCycle();
});

// ---------------------------------------------------------------------------
addPaneButtonEl.addEventListener('click', () => {
  try { paneOps?.addPane(); } catch (error) { reportError(error); }
});

addProfileButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  try { commandPaletteEntries.openNewPaneProfilePicker(); } catch (error) { reportError(error); }
});

layoutsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  layoutManager.toggleLayoutsDropdown();
});

settingsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  const existingProfilePopup = document.querySelector('.add-pane-profile-popup');
  if (existingProfilePopup) existingProfilePopup.remove();
  layoutManager.closeLayoutsDropdown();

  const wasHidden = settingsPanelEl.classList.toggle('is-hidden');
  if (wasHidden) {
    closeSettingsPanel();
  } else {
    settingsManager.applySettings();
    modalStack.register(closeSettingsPanel);
  }
});

layoutsSettingsBtn?.addEventListener('click', () => layoutModal.openLayoutsModal());
layoutsSettingsBtn?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); layoutModal.openLayoutsModal(); }
});

shellProfilesSettingsBtn.addEventListener('click', () => shellProfileManager?.openShellProfilesModal());
shellProfilesSettingsBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shellProfileManager?.openShellProfilesModal(); }
});

function openShortcutsModal() {
  closeKeyboardShortcutsModal();
  modalStack.register(closeKeyboardShortcutsModal);
  ShortcutsUI.openKeyboardShortcutsModal(bridge, settingsManager.scheduleSettingsSave);
}
keyboardShortcutsSettingsBtn.addEventListener('click', openShortcutsModal);
keyboardShortcutsSettingsBtn.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openShortcutsModal(); }
});

settingsPanelEl.addEventListener('click', (event) => event.stopPropagation());

// ---------------------------------------------------------------------------
window.addEventListener('pointerdown', (event) => {
  if (
    !settingsPanelEl.classList.contains('is-hidden') &&
    !settingsPanelEl.contains(event.target) &&
    !settingsButtonEl.contains(event.target)
  ) {
    closeSettingsPanel();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    modalStack.closeTop();
    const focusedPaneId = paneState.getFocusedPaneId();
    if (focusedPaneId && modalStack.isEmpty()) {
      paneOps?.focusPane(focusedPaneId, { focusTerminal: true });
    }
  }
}, true);

window.addEventListener('resize', () => {
  try { render(true); } catch (error) { reportError(error); }
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await bridge.cwdReady;

    const savedSettings = await bridge.loadSettings();
    settingsManager.applyPersistedSettings(savedSettings);
    settingsManager.applySettings();
    shellProfileManager?.loadShellProfiles();

    await layoutManager.refreshLayouts();
    let layouts = layoutManager.getLayouts();
    let defaultLayoutId = layoutManager.getDefaultLayoutId();

    let defaultLayout = layouts.find((l) => l.id === defaultLayoutId)
      || layouts.find((l) => l.id === 'default');

    if (!defaultLayout) {
      defaultLayout = layoutManager.createDefaultLayout();
      const saved = await bridge.saveLayout(defaultLayout);
      layoutManager._setLayouts(saved.layouts ?? [defaultLayout]);
      layoutManager._setDefaultLayoutId(saved.defaultLayoutId ?? defaultLayoutId);
    }

    if (defaultLayoutId !== defaultLayout.id) {
      const config = await bridge.setLayoutAsDefault(defaultLayout.id);
      layoutManager._setLayouts(config.layouts ?? layouts);
      layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? defaultLayout.id);
    }

    const targetLayoutId = windowContext.kind === 'layout'
      ? windowContext.layoutId
      : layoutManager.getDefaultLayoutId();
    const targetLayout = layoutManager.getLayouts().find((l) => l.id === targetLayoutId);
    if (!targetLayout) {
      throw new Error(`Layout not found: ${targetLayoutId}`);
    }

    layoutManager.setWindowLayoutId(targetLayout.id);
    paneState.restoreSession({ panes: targetLayout.panes, focusedPaneIndex: targetLayout.focusedPaneIndex });
    paneRenderer?.ensurePaneNodes();

    layoutManager.updateLayoutsIndicator();
    render(true);
    layoutManager.setLayoutRestoreComplete(true);
  } catch (error) {
    reportError(error);
    const msg = error instanceof Error ? error.message : String(error);
    document.body.innerHTML = `<div style="color:#e06c75;padding:2em;font-family:monospace;white-space:pre-wrap">Initialization failed: ${msg}</div>`;
  }
});

window.addEventListener('beforeunload', () => {
  layoutManager.flushWindowLayoutSave();
  settingsManager.flushSettingsSave();
  clearLayoutWindowBinding(layoutManager.getWindowLayoutId(), bridge.currentWindowLabel);
  removeTerminalDataListener();
  removeTerminalExitListener();
  removeMenuActionListener();
});

window.addEventListener('error', (event) => {
  reportError(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason);
});
