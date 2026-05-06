import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from './command-palette';
import { createPaneActivityWatcher } from './pane-activity-watcher';
import { createBreathingMaskAlert } from './pane-alert-breathing-mask';
import {
  createBackend,
  clearLayoutWindowBinding,
} from './backend';
import { createPaneRenderer, getTextColorForBackground } from './pane-renderer';
import type { PaneRenderer } from './pane-renderer';
import { createShellProfileManager } from './shell-profiles';
import { createContextMenus } from './context-menus';
import { createLayoutManager } from './layout-manager';
import { createLayoutModal } from './layout-modal';
import { createModalStack } from './modal-stack';
import { createFullscreenManager } from './fullscreen-manager';
import { createPaneOperations } from './pane-operations';
import { createCommandPaletteEntries } from './command-palette-entries';
import '@xterm/xterm/css/xterm.css';

import * as ShortcutsRegistry from './shortcuts-registry';
import * as ShortcutsUI from './shortcuts-ui';
import * as ColorsRegistry from './colors-registry';
import { createPaneState } from './pane-state';
import { createFocusController } from './manager/create-focus-controller.js';
import { setIcon } from './icons';
import { createActions } from './input/actions';
import { createDispatcher } from './input/dispatcher';

import { renderHintBar } from './hint-bar';
import { createSettingsManager } from './settings';
import { createTabBar } from './tab-bar';
import type { TabBarLocalState } from './tab-bar';
import type { PaneNode } from './pane-renderer';
import type { ShellProfile, EditingShellProfile } from './shell-profiles';

// ---------------------------------------------------------------------------
const stageEl = document.getElementById('stage')!;
const tabsListEl = document.getElementById('tabs-list')!;
const statusLabelEl = document.getElementById('status-label')!;
const statusHintEl = document.getElementById('status-hint')!;
const addPaneButtonEl = document.getElementById('tabs-add')!;
const addProfileButtonEl = document.getElementById('tabs-add-profile')!;
const layoutsButtonEl = document.getElementById('tabs-layouts')!;
const settingsButtonEl = document.getElementById('tabs-settings')!;
const fullscreenButtonEl = document.getElementById('tabs-fullscreen')!;
const settingsPanelEl = document.getElementById('settings-panel')!;
const shellProfilesSettingsBtn = document.getElementById('shell-profiles-settings-btn')!;
const layoutsSettingsBtn = document.getElementById('layouts-settings-btn')!;
const keyboardShortcutsSettingsBtn = document.getElementById('keyboard-shortcuts-settings-btn')!;

// ---------------------------------------------------------------------------
let paneRenderer: PaneRenderer | null = null;
let layoutRestoreComplete = false;
let layoutFocusNotice: { layoutId: string } | null = null;
let layoutFocusNoticeTimer: number | null = null;


// Shell-profile state (shared with shell-profiles module via adapter)
let shellProfiles: ShellProfile[] = [];
let defaultShellProfileId = '';
let editingShellProfile: EditingShellProfile | null = null;
let selectedShellProfileId: string | null = null;

// Tab-bar mutable state
const tabBarState: TabBarLocalState = (() => {
  let r: string | null = null;
  let d: TabBarLocalState['dragState'] = null;
  let p: TabBarLocalState['pendingTabFocus'] = null;
  let c: string | null = null;
  return {
    get renamingPaneId() { return r; }, set renamingPaneId(v: string | null) { r = v; },
    get dragState() { return d; }, set dragState(v: TabBarLocalState['dragState']) { d = v; },
    get pendingTabFocus() { return p; }, set pendingTabFocus(v: TabBarLocalState['pendingTabFocus']) { p = v; },
    get currentMode() { return focusController.getMode(); },
    get pendingClosePaneId() { return c; }, set pendingClosePaneId(v: string | null) { c = v; },
  };
})();

// ---------------------------------------------------------------------------
const backend = createBackend((window as any).__TAURI__ ?? (window as any).vibe99 ?? null, null);

const windowContext: { kind: 'layout'; layoutId: string } | { kind: 'main' } = (() => {
  const params = new URLSearchParams(window.location.search);
  const layoutId = params.get('layoutId');
  return layoutId ? { kind: 'layout', layoutId } : { kind: 'main' };
})();

// ---------------------------------------------------------------------------
const paneState = createPaneState({
  defaultCwd: backend.defaultCwd,
  defaultTabTitle: backend.defaultTabTitle,
  getAccentPalette: () => [...ColorsRegistry.ACCENT_PALETTE],
  onStateChange: () => {},
});

const focusController = createFocusController(
  {
    getAll: () => paneState.getPanes(),
    getActiveId: () => paneState.getFocusedPaneId(),
    setActive: (paneId: string) => paneState.focusPane(paneId),
    size: () => paneState.getPanes().length,
  },
  {
    onModeChange: (mode) => {
      document.body.classList.toggle('is-navigation-mode', mode === 'nav');
      render();
    },
    onFocusChange: () => {
      render();
    },
  },
);

const modalStack = createModalStack();

const layoutManager = createLayoutManager({
  backend,
  paneState,
  modalStack,
  reportError,
  layoutsButtonEl,
  onManageLayouts: () => layoutModal.openLayoutsModal(),
});
(window as any).layoutManager = layoutManager;

const layoutModal = createLayoutModal({
  backend,
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
  backend,
  reportError,
  applyCallback: () => render(true),
  paneActivityWatcher,
});

// paneOps is created after tabBar and paneRenderer, but closures capture the binding.
let paneOps: ReturnType<typeof createPaneOperations> | null = null;

const tabBar = createTabBar({
  paneState,
  state: tabBarState,
  getPaneLabel: (pane) => paneOps?.getPaneLabel(pane) ?? '',
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
  backend,
  paneState,
  settingsManager,
  paneAlert,
  paneActivityWatcher,
  reportError,
  stageEl,
  getMode: () => focusController.getMode(),
  onPaneClick: (...args) => paneOps?.focusPane(...args),
  onTerminalTitleChange: (paneId, title) => paneState.setPaneTerminalTitle(paneId, title),
  onTerminalContextMenu: (node, event) => {
    void contextMenus?.showTerminalContextMenu(node, event);
  },
  scheduleWindowLayoutSave: () => layoutManager.scheduleWindowLayoutSave(),
  tabBar,
  getPaneLabel: (pane) => paneOps?.getPaneLabel(pane) ?? '',
  onPaneCwdChanged: (paneId, newCwd) => {
    const pane = paneState.getPaneById(paneId);
    if (!pane || pane.cwd === newCwd) return;
    paneState.setPaneCwd(paneId, newCwd);
    layoutManager.scheduleWindowLayoutSave(5000);
  },
});

// Modules that need paneRenderer / tabBar (closures capture the variable binding)
let shellProfileManager: ReturnType<typeof createShellProfileManager> | null = null;
let contextMenus: ReturnType<typeof createContextMenus> | null = null;

shellProfileManager = createShellProfileManager({
  backend: backend as any,
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
  initializePaneTerminal: (node: PaneNode) => paneRenderer?.initializePaneTerminal(node),
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
    setFocusedPaneId: (id) => paneState.focusPane(id),
    getPaneNode: (paneId) => paneRenderer?.getNode(paneId) ?? null,
    clearPaneCycleState: () => {},
    recordPaneVisit: (paneId) => focusController.recordPaneVisit(paneId),
    render: () => render(),
    scheduleSave: () => layoutManager.scheduleWindowLayoutSave(),
    registerModal: (closeFn) => modalStack.register(closeFn),
    unregisterModal: (closeFn) => modalStack.unregister(closeFn),
  },
  backend,
  shellProfileManager,
  reportError,
  focusPane: (...args) => paneOps?.focusPane(...args),
  beginRenamePane: (index) => tabBar.beginRenamePane(index),
  closePane: (...args) => paneOps?.closePane(...args),
  togglePaneBreathingMonitor: (paneId) => {
    const next = paneOps?.togglePaneBreathingMonitor(paneId) ?? false;
    paneActivityWatcher.setPaneEnabled(paneId, next);
  },
});

paneOps = createPaneOperations({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  render,
  focusController,
  state: tabBarState,
});

const commandPaletteEntries = createCommandPaletteEntries({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  layoutModal,
  shellProfileManager,
  contextMenus: contextMenus as any,
  backend,
  settingsManager,
  modalStack,
  focusPane: (id: string | null) => { if (id) paneOps?.focusPane(id); },
  addPane: (profileId?: string | null) => paneOps?.addPane(profileId),
  closeSettingsPanel,
  closeKeyboardShortcutsModal,
  openKeymapHelpModal,
  settingsPanelEl,
  statusLabelEl,
  statusHintEl,
  getCurrentMode: () => focusController.getMode(),
  setMode: (mode: string) => focusController.setMode(mode),
});

const fullscreenManager = createFullscreenManager({
  backend,
  fullscreenButtonEl,
  reportError,
});

// ---------------------------------------------------------------------------
const removeTerminalDataListener = backend.terminal.onData(({ paneId, data }) => {
  paneRenderer?.write(paneId, data);
});

backend.onLayoutFocusNotice?.(() => {
  if (!layoutManager.getWindowLayoutId()) return;
  paneOps?.refocusCurrentPaneTerminal();
  showLayoutFocusNotice(layoutManager.getWindowLayoutId()!);
});

const removeTerminalExitListener = backend.terminal.onExit(({ paneId, exitCode, reason }) => {
  const handled = paneOps?.handleTerminalExit({ paneId, exitCode, reason });
  if (handled === false) {
    void backend.window.close().catch(reportError);
  }
});

const removeMenuActionListener = backend.onMenuAction(({ action, paneId }) => {
  try {
    contextMenus?.handleMenuAction(action, paneId ?? '');
  } catch (error) {
    reportError(error);
  }
});

// ---------------------------------------------------------------------------
function reportError(error: unknown): void {
  statusLabelEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  statusHintEl.textContent = '';
  console.error(error);
}

// ---------------------------------------------------------------------------
function setMode(next: string): void {
  focusController.setMode(next);
}

function enterNavigationMode(): void {
  focusController.enterNavigationMode();
  paneOps?.blurFocusedTerminal();
}

function cancelNavigationMode(): void {
  const sourceId = focusController.getEnterNavSourcePaneId();
  focusController.cancelNavigationMode();
  if (sourceId) {
    paneRenderer?.focusTerminal(sourceId);
    paneRenderer?.setAlerted(sourceId, false);
  }
}

// ---------------------------------------------------------------------------
function render(refit = false): void {
  tabBar.renderTabs();
  paneRenderer?.renderPanes(refit);
  updateStatus();
  if (layoutRestoreComplete) {
    layoutManager.scheduleWindowLayoutSave();
  }
}

function updateStatus(): void {
  if (layoutFocusNotice) {
    statusLabelEl.textContent = 'Layout focused';
    statusLabelEl.classList.remove('is-navigation-mode');
    statusHintEl.textContent = layoutManager.getLayoutDisplayName(layoutFocusNotice.layoutId);
    return;
  }

  const currentPanes = paneState.getPanes();
  const focusedPane = currentPanes[paneState.getFocusedIndex()];
  const focusedPaneLabel = focusedPane ? (paneOps?.getPaneLabel(focusedPane) || focusedPane.id) : '';

  const keymap = ShortcutsRegistry.getActiveKeymap();
  const { modeLabel, hintsHtml } = renderHintBar(
    keymap,
    focusController.getMode(),
    focusedPaneLabel,
    backend.platform
  );

  statusLabelEl.textContent = modeLabel;
  statusLabelEl.classList.toggle('is-navigation-mode', focusController.getMode() === 'nav');
  statusHintEl.innerHTML = hintsHtml;
}

function showLayoutFocusNotice(layoutId: string): void {
  layoutFocusNotice = { layoutId };
  document.body.style.setProperty('--layout-focus-accent', paneOps?.getFocusedPaneAccent() ?? null);
  document.body.dataset.layoutFocusName = layoutManager.getLayoutDisplayName(layoutId);
  document.body.classList.remove('is-layout-focus-notice');
  void document.body.offsetWidth;
  document.body.classList.add('is-layout-focus-notice');
  updateStatus();
  window.clearTimeout(layoutFocusNoticeTimer ?? undefined);
  layoutFocusNoticeTimer = window.setTimeout(() => {
    layoutFocusNotice = null;
    delete document.body.dataset.layoutFocusName;
    document.body.classList.remove('is-layout-focus-notice');
    updateStatus();
  }, 1400);
}

// ---------------------------------------------------------------------------
function closeSettingsPanel(): void {
  settingsPanelEl.classList.add('is-hidden');
  modalStack.unregister(closeSettingsPanel);
}
function closeKeyboardShortcutsModal(): void {
  document.querySelector('.settings-modal-overlay')?.remove();
  modalStack.unregister(closeKeyboardShortcutsModal);
}
function openKeymapHelpModal(): void {
  closeKeyboardShortcutsModal();
  modalStack.register(closeKeyboardShortcutsModal);
  ShortcutsUI.openKeyboardShortcutsModal(backend, settingsManager.scheduleSettingsSave);
}

// ---------------------------------------------------------------------------
const keyboardActions = createActions({
  addPane: (...args) => paneOps?.addPane(...args),
  enterNavigationMode,
  cycleToRecentPane: (...args) => paneOps?.cycleToRecentPane(...args),
  cycleToNextLitPane: (...args) => paneOps?.cycleToNextLitPane(...args),
  navigateLeft: (...args) => paneOps?.navigateLeft(...args),
  navigateRight: (...args) => paneOps?.navigateRight(...args),
  copyTerminalSelection: () => { const id = paneState.getFocusedPaneId(); return id ? paneRenderer?.copySelection(id) : false; },
  pasteIntoTerminal: async () => { const id = paneState.getFocusedPaneId(); if (id) await paneRenderer?.pasteInto(id); },
  moveFocus: (...args) => paneOps?.moveFocus(...args),
  focusPane: (...args) => paneOps?.focusPane(...args),
  cancelNavigationMode,
  getFocusedPaneId: () => paneState.getFocusedPaneId() ?? '',
  isCommandPaletteOpen,
  closeCommandPalette,
  openTabSwitcher: () => commandPaletteEntries.openTabSwitcher(),
  openCommandList: () => commandPaletteEntries.openCommandList(),
  openNewPaneProfilePicker: () => commandPaletteEntries.openNewPaneProfilePicker(),
  focusPaneAt: (...args) => paneOps?.focusPaneAt(...args),
  getPaneCount: () => paneOps?.getPaneCount() ?? 0,
  getPaneIdAt: (index: number) => paneOps?.getPaneIdAt(index) ?? undefined,
  requestClosePane: (paneId: string) => paneOps?.requestClosePane(paneId),
  startInlineRename: (...args) => paneOps?.startInlineRename(...args),
  openKeymapHelpModal,
  openLayoutsModal: () => layoutModal.openLayoutsModal(),
});

const dispatchKeydown = createDispatcher({
  getKeymap: ShortcutsRegistry.getActiveKeymap,
  actions: keyboardActions,
  getMode: () => focusController.getMode(),
  isInputFocused: () => document.activeElement?.tagName === 'INPUT',
  isCommandPaletteOpen,
});

window.addEventListener('keydown', dispatchKeydown, true);

window.addEventListener('keyup', (event) => {
  if (focusController.hasActivePaneCycle() && (event.key === 'Control' || event.key === 'Meta')) {
    focusController.commitPaneCycle();
  }
});

window.addEventListener('blur', () => {
  if (focusController.hasActivePaneCycle()) focusController.commitPaneCycle();
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

function openShortcutsModal(): void {
  closeKeyboardShortcutsModal();
  modalStack.register(closeKeyboardShortcutsModal);
  ShortcutsUI.openKeyboardShortcutsModal(backend, settingsManager.scheduleSettingsSave);
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
    !settingsPanelEl.contains(event.target as Node) &&
    !settingsButtonEl.contains(event.target as Node)
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
    await backend.cwdReady;

    const savedSettings = await backend.settings.load();
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
      const saved = await backend.layouts.save(defaultLayout);
      layoutManager._setLayouts(saved.layouts ?? [defaultLayout]);
      layoutManager._setDefaultLayoutId(saved.defaultLayoutId ?? defaultLayoutId);
    }

    if (defaultLayoutId !== defaultLayout.id) {
      const config = await backend.layouts.setAsDefault(defaultLayout.id);
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
    paneState.restoreSession({ panes: targetLayout.panes as any, focusedPaneIndex: targetLayout.focusedPaneIndex });
    focusController.syncMru();
    focusController.recordPaneVisit(paneState.getFocusedPaneId());
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
  clearLayoutWindowBinding(layoutManager.getWindowLayoutId() ?? undefined, backend.currentWindowLabel);
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
