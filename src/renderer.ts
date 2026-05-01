import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from './command-palette';
import { createPaneActivityWatcher } from './pane-activity-watcher';
import { createBreathingMaskAlert } from './pane-alert-breathing-mask';
import {
  createBridge,
  clearLayoutWindowBinding,
} from './bridge';
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
let currentMode: string = 'terminal';
let paneRenderer: PaneRenderer | null = null;
let enterNavSourcePaneId: string | null = null;
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
    get currentMode() { return currentMode; },
    get pendingClosePaneId() { return c; }, set pendingClosePaneId(v: string | null) { c = v; },
  };
})();

// ---------------------------------------------------------------------------
const bridge = createBridge((window as any).__TAURI__ ?? (window as any).vibe99 ?? null, null);

const windowContext: { kind: 'layout'; layoutId: string } | { kind: 'main' } = (() => {
  const params = new URLSearchParams(window.location.search);
  const layoutId = params.get('layoutId');
  return layoutId ? { kind: 'layout', layoutId } : { kind: 'main' };
})();

// ---------------------------------------------------------------------------
const paneState = createPaneState({
  defaultCwd: bridge.defaultCwd,
  defaultTabTitle: bridge.defaultTabTitle,
  getAccentPalette: () => [...ColorsRegistry.ACCENT_PALETTE],
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
  bridge: bridge as any,
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
  contextMenus: contextMenus as any,
  bridge,
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
  showLayoutFocusNotice(layoutManager.getWindowLayoutId()!);
});

const removeTerminalExitListener = bridge.onTerminalExit(({ paneId, exitCode, reason }) => {
  const handled = paneOps?.handleTerminalExit({ paneId, exitCode, reason });
  if (handled === false) {
    void bridge.closeWindow().catch(reportError);
  }
});

const removeMenuActionListener = bridge.onMenuAction(({ action, paneId }) => {
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
  if (currentMode === next) return;
  currentMode = next;
  document.body.classList.toggle('is-navigation-mode', currentMode === 'nav');
  render();
}

function enterNavigationMode(): void {
  if (paneState.getPanes().length === 0) return;
  enterNavSourcePaneId = paneState.getFocusedPaneId();
  setMode('nav'); paneOps?.blurFocusedTerminal(); render();
}

function cancelNavigationMode(): void {
  if (enterNavSourcePaneId) { paneOps?.focusPane(enterNavSourcePaneId, { focusTerminal: true }); enterNavSourcePaneId = null; }
  else { setMode('terminal'); render(); }
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
    currentMode,
    focusedPaneLabel,
    bridge.platform
  );

  statusLabelEl.textContent = modeLabel;
  statusLabelEl.classList.toggle('is-navigation-mode', currentMode === 'nav');
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

function openShortcutsModal(): void {
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
    paneState.restoreSession({ panes: targetLayout.panes as any, focusedPaneIndex: targetLayout.focusedPaneIndex });
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
  clearLayoutWindowBinding(layoutManager.getWindowLayoutId() ?? undefined, bridge.currentWindowLabel);
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
