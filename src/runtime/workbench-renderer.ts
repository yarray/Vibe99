/**
 * Workbench Renderer
 *
 * Encapsulates all orchestration logic for a single Vibe99 window:
 * module creation, command dispatch, rendering, state management,
 * and business-rule helpers.
 *
 * The bootstrap entry (`renderer.ts`) only injects DOM refs + the bridge,
 * then wires global window events to the methods exposed here.
 *
 * @module runtime/workbench-renderer
 */

import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from '../command-palette';
import { createPaneActivityWatcher } from '../pane-activity-watcher';
import { createBreathingMaskAlert } from '../pane-alert-breathing-mask';
import {
  clearLayoutWindowBinding,
} from '../bridge';
import type { Bridge } from '../bridge';
import { createFloatWindowManager } from '../float-window';
import { createPaneRenderer, getTextColorForBackground } from '../pane-renderer';
import type { PaneRenderer } from '../pane-renderer';
import { createShellProfileManager } from '../shell-profiles';
import { createHookManager } from '../hooks';
import type { AlertStartPayload, AlertStopPayload } from '../hooks';
import { createContextMenus } from '../context-menus';
import { createLayoutManager } from '../layout-manager';
import { createLayoutModal } from '../layout-modal';
import { createModalStack } from '../modal-stack';
import { createFullscreenManager } from '../fullscreen-manager';
import type { CommandResult, WorkbenchMode } from '../domain/commands.js';
import type { AppCommand } from '../domain/commands.js';
import { createCommandPaletteEntries } from '../command-palette-entries';
import { createWorkbench } from './workbench.js';
import type { Workbench } from './workbench.js';
import { createQuakeView } from './quake-view.js';

import * as ShortcutsRegistry from '../shortcuts-registry';
import * as ShortcutsUI from '../shortcuts-ui';
import * as ColorsRegistry from '../colors-registry';
import { createPaneState } from '../pane-state';
import { setIcon } from '../icons';
import { createActions } from '../input/actions';
import { createDispatcher } from '../input/dispatcher';

import { renderHintBar } from '../hint-bar';
import { createSettingsManager } from '../settings';
import { createHotkeyHandler } from '../hotkey-handler';
import { createTabBar } from '../tab-bar';
import type { TabBarLocalState } from '../tab-bar';
import type { ShellProfile, EditingShellProfile } from '../shell-profiles';
import { createDefaultTerminalTheme } from '../domain/theme';
import { enable, disable } from '@tauri-apps/plugin-autostart';

// ---------------------------------------------------------------------------
// Dependencies injected by the bootstrap entry
// ---------------------------------------------------------------------------

export interface WorkbenchRendererDeps {
  bridge: Bridge;
  stageEl: HTMLElement;
  tabsListEl: HTMLElement;
  statusLabelEl: HTMLElement;
  statusHintEl: HTMLElement;
  settingsPanelEl: HTMLElement;
  settingsButtonEl: HTMLElement;
  layoutsButtonEl: HTMLElement;
  fullscreenButtonEl: HTMLElement;
  shellProfilesSettingsBtn: HTMLElement;
  hooksSettingsBtn: HTMLElement;
  layoutsSettingsBtn: HTMLElement;
  keyboardShortcutsSettingsBtn: HTMLElement;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WorkbenchRenderer {
  dispatch: (command: AppCommand) => CommandResult;
  render: (refit?: boolean) => void;
  init: () => Promise<void>;
  dispose: () => void;
  reportError: (error: unknown) => void;
  onKeydown: (event: KeyboardEvent) => void;
  onKeyup: (event: KeyboardEvent) => void;
  onWindowBlur: () => void;
  onResize: () => void;
  onPointerdown: (event: PointerEvent) => void;
  onEscapeKeydown: (event: KeyboardEvent) => void;
  onAddPaneClick: () => void;
  onAddProfileClick: () => void;
  onLayoutsClick: () => void;
  onSettingsClick: () => void;
  onLayoutsSettingsClick: () => void;
  onShellProfilesSettingsClick: () => void;
  onHooksSettingsClick: () => void;
  onKeyboardShortcutsSettingsClick: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorkbenchRenderer(deps: WorkbenchRendererDeps): WorkbenchRenderer {
  const {
    bridge,
    stageEl,
    tabsListEl,
    statusLabelEl,
    statusHintEl,
    settingsPanelEl,
    settingsButtonEl,
    layoutsButtonEl,
    fullscreenButtonEl,
    shellProfilesSettingsBtn,
    hooksSettingsBtn,
    layoutsSettingsBtn,
    keyboardShortcutsSettingsBtn,
  } = deps;

  // -- Mutable bootstrap state ------------------------------------------------

  let currentMode: WorkbenchMode = 'terminal';
  let paneRenderer: PaneRenderer | null = null;
  let workbench: Workbench | null = null;
  let enterNavSourcePaneId: string | null = null;
  let layoutRestoreComplete = false;
  let layoutFocusNotice: { layoutId: string } | null = null;
  let layoutFocusNoticeTimer: number | null = null;
  let quakeView: ReturnType<typeof createQuakeView> | null = null;

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

  const windowContext: { kind: 'layout'; layoutId: string } | { kind: 'main' } = (() => {
    const params = new URLSearchParams(window.location.search);
    const layoutId = (window as any).__VIBE99_LAYOUT_ID ?? params.get('layoutId');
    return layoutId ? { kind: 'layout', layoutId } : { kind: 'main' };
  })();

  // -- Core modules -----------------------------------------------------------

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
    onManageLayouts: () => layoutModal!.openLayoutsModal(),
  });
  (window as any).layoutManager = layoutManager;

  let layoutModal: ReturnType<typeof createLayoutModal> | null = null;

  const hookManager = createHookManager({
    bridge: bridge as any,
    reportError,
    registerModal: (closeFn) => modalStack.register(closeFn),
    unregisterModal: (closeFn) => modalStack.unregister(closeFn),
  });

  const paneAlert = createBreathingMaskAlert();
  let globalBreathingEnabled = true;

  function applyBreathingIntensity(intensity: string): void {
    const root = document.documentElement;
    globalBreathingEnabled = intensity !== 'none';
    switch (intensity) {
      case 'none':
        root.style.removeProperty('--breathing-peak-opacity');
        root.style.removeProperty('--breathing-duration');
        root.style.removeProperty('--breathing-glow');
        break;
      case 'mild':
        root.style.setProperty('--breathing-peak-opacity', 'max(0.2, calc(0.6 - var(--pane-bg-mask-opacity)))');
        root.style.setProperty('--breathing-duration', '3.5s');
        root.style.setProperty('--breathing-glow', 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)');
        break;
      case 'intense':
        root.style.setProperty('--breathing-peak-opacity', 'max(0.7, calc(1 - var(--pane-bg-mask-opacity)))');
        root.style.setProperty('--breathing-duration', '2.4s');
        root.style.setProperty('--breathing-glow',
          'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)');
        break;
    }
    if (!globalBreathingEnabled) {
      paneState.getPanes().forEach((pane) => {
        paneRenderer?.setAlerted(pane.id, false);
      });
    }
  }

  const paneActivityWatcher = createPaneActivityWatcher({
    onAlert: (paneId) => {
      if (globalBreathingEnabled) {
        paneRenderer?.setAlerted(paneId, true);
      }
      floatWindowManager.noteAlert(paneId);
      const payload: AlertStartPayload = {
        paneId,
        paneTitle: (() => { const p = paneState.getPaneById(paneId); return p ? (p.title ?? p.terminalTitle ?? '') : ''; })(),
        recentOutput: paneRenderer?.getRecentOutput(paneId, 20) ?? '',
      };
      hookManager.emitEvent('alert.start', payload);
    },
    onClear: (paneId) => {
      if (globalBreathingEnabled) {
        paneRenderer?.setAlerted(paneId, false);
      }
      floatWindowManager.noteClear(paneId);
      const payload: AlertStopPayload = {
        paneId,
        paneTitle: (() => { const p = paneState.getPaneById(paneId); return p ? (p.title ?? p.terminalTitle ?? '') : ''; })(),
      };
      hookManager.emitEvent('alert.stop', payload);
    },
  });

  const settingsManager = createSettingsManager({
    bridge,
    reportError,
    applyCallback: () => render(true),
    paneActivityWatcher,
    onBreathingIntensityChange: (intensity) => {
      applyBreathingIntensity(intensity);
      paneActivityWatcher.setGlobalEnabled(intensity !== 'none');
    },
    onToggleFloatWindow: () => floatWindowManager.toggle(),
    getFloatWindowOpen: () => floatWindowManager.isOpen(),
    requestAppRestart: () => window.location.reload(),
    getLayoutUiOverrides: () => paneState.getLayoutUiOverrides(),
    onLayoutUiOverridesChange: (overrides) => {
      paneState.setLayoutUiOverrides(overrides);
      // Trigger a layout save to persist the uiOverrides
      layoutManager.scheduleWindowLayoutSave();
    },
  });

  const hotkeyHandler = createHotkeyHandler({
    bridge,
    reportError,
    windowLayoutId: windowContext.kind === 'layout' ? windowContext.layoutId : null,
  });

  // -- Inline helpers ---------------------------------------------------------

  function getFocusedPaneAccent(): string {
    const pane = paneState.getPanes()[paneState.getFocusedIndex()];
    return pane?.customColor || pane?.accent || '#ffd166';
  }

  function handleTerminalExit({ paneId, exitCode, reason }: { paneId: string; exitCode: number; reason: string }): boolean {
    const session = workbench!.session(paneId);
    if (!session) return true;

    if (reason === 'killed') {
      session.setReady(false);
      return true;
    }

    const graceMs = 3000;
    const shellTime = session.shellChangeTime();
    const recentShellChange = shellTime && (Date.now() - shellTime < graceMs);
    if (session.isShellChanging() || recentShellChange) {
      session.setReady(false);
      paneRenderer!.writeln(paneId, '');
      paneRenderer!.writeln(paneId, `\x1b[38;5;204m[shell exited with code ${exitCode}]\x1b[0m`);
      session.showExitedState({ exitCode, reason });
      return true;
    }

    session.setReady(false);
    paneRenderer!.writeln(paneId, '');
    paneRenderer!.writeln(paneId, `\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`);
    session.showExitedState({ exitCode, reason });

    return true;
  }

  // -- Command dispatcher -----------------------------------------------------

  let dispatch: (command: AppCommand) => CommandResult;


  const tabBar = createTabBar({
    getPanes: () => paneState.getPanes(),
    getFocusedIndex: () => paneState.getFocusedIndex(),
    getPaneIndex: (paneId) => paneState.getPaneIndex(paneId),
    state: tabBarState,
    getPaneLabel: (pane) => pane.title ?? pane.terminalTitle ?? '',
    getTextColorForBackground,
    dispatch: (command: AppCommand) => dispatch(command),
    onTabContext: (paneId, event) => contextMenus?.showTabContextMenu(paneId, event),
    reportError,
    tabsListEl,
    setIcon,
  });

  workbench = createWorkbench({
    layout: () => paneState.getLayout(),
    terminalSessionDeps: {
      bridge,
      settingsManager,
      activityWatcher: {
        noteResize: (paneId) => paneActivityWatcher.noteResize(paneId),
        noteData: (paneId) => paneActivityWatcher.noteData(paneId),
        forget: (paneId) => paneActivityWatcher.forget(paneId),
      },
      reportError,
      getPaneSnapshot: (paneId: string) => paneState.getPaneById(paneId),
      onPaneClick: (paneId: string, opts?: { focusTerminal?: boolean }) => {
        return dispatch({ type: 'pane.focus', paneId, focusTerminal: opts?.focusTerminal });
      },
      onTitleChange: (paneId: string, title: string) => paneState.setPaneTerminalTitle(paneId, title),
      onCwdChanged: (paneId: string, newCwd: string) => {
        const pane = paneState.getPaneById(paneId);
        if (!pane || pane.cwd === newCwd) return;
        paneState.setPaneCwd(paneId, newCwd);
        layoutManager.scheduleWindowLayoutSave(5000);
      },
      onTabRefreshNeeded: (paneId: string) => {
        const pane = paneState.getPaneById(paneId);
        if (pane && pane.title === null) {
          tabBar.renderTabs();
        }
      },
      onContextMenu: (session, event) => {
        void contextMenus?.showTerminalContextMenu(session.paneId, event);
      },
      terminalTheme: createDefaultTerminalTheme,
    },
    stageEl,
    paneActivityWatcher: {
      noteResize: (paneId) => paneActivityWatcher.noteResize(paneId),
      noteData: (paneId) => paneActivityWatcher.noteData(paneId),
      setFocus: (id) => paneActivityWatcher.setFocus(id),
      setPaneEnabled: (paneId, enabled) => paneActivityWatcher.setPaneEnabled(paneId, enabled),
      isAlerted: (paneId) => paneActivityWatcher.isAlerted(paneId),
      alertedPaneIds: () => paneActivityWatcher.alertedPaneIds(),
    },
    paneAlert,
    tabBar,
    tabBarState,
    entryNeedsTabRefresh: (paneId: string) => {
      const pane = paneState.getPaneById(paneId);
      return Boolean(pane && pane.title === null);
    },
    paneState,
    setMode,
    getCurrentMode: () => currentMode,
    scheduleSave: () => layoutManager.scheduleWindowLayoutSave(),
    bridge,
    render,
    setPaneActivityAlertEnabled: (paneId, enabled) => {
      paneActivityWatcher.setPaneEnabled(paneId, enabled);
      if (!enabled) {
        paneRenderer?.setAlerted(paneId, false);
      }
    },
    getShellProfiles: () => shellProfiles,
  });

  paneRenderer = createPaneRenderer({
    paneState,
    settingsManager,
    paneAlert,
    paneActivityWatcher,
    stageEl,
    getMode: () => currentMode,
    workbench: workbench!,
  });

  dispatch = (command: AppCommand) => workbench!.dispatch(command);

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
    dispatch,
    registerModal: (closeFn) => modalStack.register(closeFn),
    unregisterModal: (closeFn) => modalStack.unregister(closeFn),
  });

  contextMenus = createContextMenus({
    state: {
      getPanels: () => paneState.getPanes(),
      getPaneIndex: (paneId) => paneState.getPaneIndex(paneId),
      getFocusedPaneId: () => paneState.getFocusedPaneId(),
      scheduleSave: () => layoutManager.scheduleWindowLayoutSave(),
      registerModal: (closeFn) => modalStack.register(closeFn),
      unregisterModal: (closeFn) => modalStack.unregister(closeFn),
    },
    bridge,
    shellProfileManager,
    reportError,
    dispatch,
  });

  layoutModal = createLayoutModal({
    bridge,
    paneState,
    modalStack,
    reportError,
    layoutManager,
    settingsManager,
    dispatch,
  });

  // Track auto-save state for E2E testing
  let autoSaveEnabled = true;
  function setAutoSaveEnabled(enabled: boolean): void { autoSaveEnabled = enabled; }
  function isAutoSaveEnabled(): boolean { return autoSaveEnabled; }

  // Override scheduleWindowLayoutSave to respect the auto-save flag
  const originalScheduleWindowLayoutSave = layoutManager.scheduleWindowLayoutSave.bind(layoutManager);
  layoutManager.scheduleWindowLayoutSave = function(delay: number = 250): void {
    if (autoSaveEnabled) {
      return originalScheduleWindowLayoutSave(delay);
    }
  };

  // Sync hotkeys when settings change
  const originalScheduleSettingsSave = settingsManager.scheduleSettingsSave.bind(settingsManager);
  settingsManager.scheduleSettingsSave = function(): void {
    originalScheduleSettingsSave();
    const next = settingsManager.settings.layoutHotkeys ?? {};
    void hotkeyHandler.sync(next).catch(reportError);
  };

  // Expose internals for E2E testing
  (window as any).__vibe99_test = {
    bridge,
    contextMenus,
    paneRenderer,
    setAutoSaveEnabled,
    isAutoSaveEnabled,
  };

  let cachedFloatWindowState: Record<string, any> = {};

  // Derive ignoreFocus from live state — no manual flag to keep in sync.
  function syncIgnoreFocus(): void {
    paneActivityWatcher.setIgnoreFocus(floatWindowManager.isOpen() && !document.hasFocus());
  }

  window.addEventListener('focus', () => {
    syncIgnoreFocus();
    paneActivityWatcher.setFocus(paneState.getFocusedPaneId());
    paneRenderer?.refreshActivitySnapshots();
    if (document.visibilityState === 'visible') {
      render();
    }
  });
  window.addEventListener('blur', () => syncIgnoreFocus());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      document.body.classList.add('is-window-hidden');
    } else {
      document.body.classList.remove('is-window-hidden');
      render();
    }
  });

  const floatWindowManager = createFloatWindowManager({
    tauri: (window as any).__TAURI__,
    currentWindowLabel: bridge.currentWindowLabel,
    getLayoutId: () => layoutManager.getWindowLayoutId(),
    getPanes: () => paneState.getPanes(),
    onFocusPane: (paneId) => {
      void bridge.focusWindow();
      dispatch({ type: 'pane.focus', paneId, focusTerminal: true });
    },
    onOpen: () => {
      syncIgnoreFocus();
      floatWindowManager.sync();
    },
    onClose: () => syncIgnoreFocus(),
    persistFloatState: (state) => {
      cachedFloatWindowState = state;
      void bridge.saveFloatWindowState(state).catch(reportError);
    },
  });

  (window as any).__floatWindowManager = floatWindowManager;

  const commandPaletteEntries = createCommandPaletteEntries({
    getPanes: () => paneState.getPanes(),
    getFocusedPaneId: () => paneState.getFocusedPaneId(),
    tabBar,
    layoutManager,
    layoutModal,
    shellProfileManager,
    contextMenus: contextMenus as any,
    bridge,
    settingsManager,
    modalStack,
    focusPane: (id: string | null) => { if (id) dispatch({ type: 'pane.focus', paneId: id }); },
    addPane: (profileId?: string | null) => dispatch({ type: 'pane.create', shellProfileId: profileId }),
    closeSettingsPanel,
    closeKeyboardShortcutsModal,
    openKeymapHelpModal,
    settingsPanelEl,
    statusLabelEl,
    statusHintEl,
    getCurrentMode: () => currentMode,
    setMode,
    toggleFloatWindow: () => { void floatWindowManager.toggle(); },
    dispatch,
  });

  const fullscreenManager = createFullscreenManager({
    bridge,
    fullscreenButtonEl,
    reportError,
  });

  // -- Bridge event listeners -------------------------------------------------

  const removeTerminalDataListener = bridge.onTerminalData(({ paneId, data }) => {
    paneRenderer?.write(paneId, data);
  });

  bridge.onLayoutFocusNotice?.(() => {
    if (!layoutManager.getWindowLayoutId()) return;
    dispatch({ type: 'focus.refocus' });
    const lid = layoutManager.getWindowLayoutId()!;
    if (!settingsManager.settings.quakeLayouts[lid]) {
      showLayoutFocusNotice(lid);
    }
  });

  const removeTerminalExitListener = bridge.onTerminalExit(({ paneId, exitCode, reason }) => {
    const handled = handleTerminalExit({ paneId, exitCode, reason });
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

  // -- Core helpers -----------------------------------------------------------

  function reportError(error: unknown): void {
    statusLabelEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    statusHintEl.textContent = '';
    console.error(error);
  }

  function setMode(next: WorkbenchMode): void {
    if (currentMode === next) return;
    currentMode = next;
    document.body.classList.toggle('is-navigation-mode', currentMode === 'nav');
    render();
  }

  function enterNavigationMode(): void {
    if (paneState.getPanes().length === 0) return;
    enterNavSourcePaneId = paneState.getFocusedPaneId();
    setMode('nav'); dispatch({ type: 'focus.blur' }); render();
  }

  function cancelNavigationMode(): void {
    if (enterNavSourcePaneId) {
      dispatch({ type: 'pane.focus', paneId: enterNavSourcePaneId, focusTerminal: true });
      enterNavSourcePaneId = null;
    } else {
      setMode('terminal'); render();
    }
  }

  function render(refit = false): void {
    tabBar.renderTabs();
    paneRenderer?.renderPanes(refit);
    updateStatus();
    floatWindowManager.sync();
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
    const focusedPaneLabel = focusedPane ? ((focusedPane.title ?? focusedPane.terminalTitle) || focusedPane.id) : '';

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
    document.body.style.setProperty('--layout-focus-accent', getFocusedPaneAccent());
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
    }, 1000);
  }

  // -- Settings / modal helpers -----------------------------------------------

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

  function openShortcutsModal(): void {
    closeKeyboardShortcutsModal();
    modalStack.register(closeKeyboardShortcutsModal);
    ShortcutsUI.openKeyboardShortcutsModal(bridge, settingsManager.scheduleSettingsSave);
  }

  // -- Keyboard dispatcher ----------------------------------------------------

  const keyboardActions = createActions({
    addPane: () => dispatch({ type: 'pane.create' }),
    enterNavigationMode,
    cycleToRecentPane: (opts) => dispatch({ type: 'focus.recent', reverse: opts.reverse }),
    cycleToNextLitPane: () => dispatch({ type: 'focus.nextLit' }),
    navigateLeft: () => dispatch({ type: 'focus.left' }),
    navigateRight: () => dispatch({ type: 'focus.right' }),
    copyTerminalSelection: () => { const id = paneState.getFocusedPaneId(); if (id) dispatch({ type: 'terminal.copy', paneId: id }); },
    pasteIntoTerminal: async () => { const id = paneState.getFocusedPaneId(); if (id) dispatch({ type: 'terminal.paste', paneId: id }); },
    moveFocus: (delta) => dispatch({ type: delta > 0 ? 'focus.next' : 'focus.prev' }),
    focusPane: (paneId, opts) => dispatch({ type: 'pane.focus', paneId, focusTerminal: opts?.focusTerminal }),
    cancelNavigationMode,
    getFocusedPaneId: () => paneState.getFocusedPaneId() ?? '',
    isCommandPaletteOpen,
    closeCommandPalette,
    openTabSwitcher: () => commandPaletteEntries.openTabSwitcher(),
    openCommandList: () => commandPaletteEntries.openCommandList(),
    openNewPaneProfilePicker: () => commandPaletteEntries.openNewPaneProfilePicker(),
    focusPaneAt: (index) => dispatch({ type: 'focus.at', index }),
    getPaneCount: () => paneState.getPanes().length,
    getPaneIdAt: (index: number) => paneState.getPanes()[index]?.id,
    requestClosePane: (paneId: string) => dispatch({ type: 'pane.requestClose', paneId }),
    startInlineRename: (paneId: string) => dispatch({ type: 'pane.rename.start', paneId }),
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

  // -- E2E test exposes -------------------------------------------------------

  (window as any).paneActivityWatcher = paneActivityWatcher;
  (window as any).settingsManager = settingsManager;
  (window as any).floatWindowManager = floatWindowManager;
  (window as any).settings = settingsManager.settings;

  // -- Init / dispose ---------------------------------------------------------

  async function init(): Promise<void> {
    await bridge.cwdReady;
    paneState.setDefaultCwd(bridge.defaultCwd, bridge.defaultTabTitle);

    const savedSettings = await bridge.loadSettings();
    settingsManager.applyPersistedSettings(savedSettings);
    settingsManager.applySettings();
    cachedFloatWindowState = (savedSettings as any).floatWindows || {};
    floatWindowManager.setPersistedState(cachedFloatWindowState);
    shellProfileManager?.loadShellProfiles();
    hookManager.loadHooks();

    await hotkeyHandler.init(settingsManager.settings.layoutHotkeys ?? {});

    await layoutManager.refreshLayouts();
    let layouts = layoutManager.getLayouts();
    let defaultLayoutId = layoutManager.getDefaultLayoutId();

    // Migrate: if defaultLayoutId is set but no layout has autostart,
    // set the default layout's autostart to true for backward compat
    const hasAnyAutostart = layouts.some((l) => l.autostart === true);
    if (!hasAnyAutostart && defaultLayoutId) {
      const defaultLayout = layouts.find((l) => l.id === defaultLayoutId);
      if (defaultLayout) {
        defaultLayout.autostart = true;
        await bridge.saveLayout(defaultLayout);
        await layoutManager.refreshLayouts();
        layouts = layoutManager.getLayouts();
      }
    }

    // Self-healing: sync OS autostart registration with layout state.
    // - Any layout has autostart → ensure the app is registered for boot launch.
    // - No layouts have autostart → remove stale OS registration (e.g. registry).
    if (windowContext.kind === 'main') {
      const hasAutostartLayouts = layouts.some((l) => l.autostart === true);
      if (hasAutostartLayouts) {
        enable().catch((err) => console.error('autostart enable failed:', err));
      } else {
        disable().catch((err) => console.error('autostart disable failed:', err));
      }
    }

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

    // Determine target layout for this window.
    // For the main window: always use the default layout.
    // For layout-specific windows (opened via ?layoutId=): use the specified layout.
    const targetLayoutId = windowContext.kind === 'layout'
      ? windowContext.layoutId
      : layoutManager.getDefaultLayoutId();
    const targetLayout = layoutManager.getLayouts().find((l) => l.id === targetLayoutId);
    if (!targetLayout) {
      throw new Error(`Layout not found: ${targetLayoutId}`);
    }

    layoutManager.setWindowLayoutId(targetLayout.id);
    const quakeConfig = settingsManager.settings.quakeLayouts[targetLayout.id];
    if (quakeConfig) {
      console.debug('[quake] init', {
        layoutId: targetLayout.id,
        currentWindowLabel: bridge.currentWindowLabel,
        windowContext,
        quakeConfig,
      });
      quakeView = createQuakeView({ bridge, layoutId: targetLayout.id });
      quakeView.init();
      await bridge.applyQuake(targetLayout.id, quakeConfig);
    }
    paneState.restoreSession({ panes: targetLayout.panes as any, focusedPaneIndex: targetLayout.focusedPaneIndex });
    paneState.setLayoutThemeId(targetLayout.themeId);
    paneState.setLayoutUiOverrides(targetLayout.uiOverrides);
    settingsManager.applySettings();
    paneRenderer?.ensureSessions();

    layoutManager.updateLayoutsIndicator();
    render(true);
    layoutManager.setLayoutRestoreComplete(true);
    layoutRestoreComplete = true;

    // Auto-restore float window if it was open before the app was closed
    if (floatWindowManager.shouldAutoOpen()) {
      void floatWindowManager.open();
    }

    // Open windows for all autostart layouts on system boot (main window only)
    if (windowContext.kind === 'main' && (window as any).__VIBE99_AUTOSTART) {
      const autostartLayouts = layoutManager.getAutostartLayouts();
      for (const layout of autostartLayouts) {
        bridge.openLayoutWindow(layout.id).catch((err) => {
          console.error('Failed to open autostart layout window:', layout.id, err);
        });
      }
    }
  }

  function dispose(): void {
    layoutManager.flushWindowLayoutSave();
    settingsManager.flushSettingsSave();
    hotkeyHandler.dispose();
    quakeView?.dispose();
    clearLayoutWindowBinding(layoutManager.getWindowLayoutId() ?? undefined, bridge.currentWindowLabel);
    removeTerminalDataListener();
    removeTerminalExitListener();
    removeMenuActionListener();
    void floatWindowManager.close({ parentClosing: true });
  }

  // -- Event handlers (returned to bootstrap) ---------------------------------

  return {
    dispatch: (command) => dispatch(command),
    render,
    init,
    dispose,
    reportError,
    onKeydown: dispatchKeydown,
    onKeyup: (event) => {
      if (paneState.hasActivePaneCycle() && (event.key === 'Control' || event.key === 'Meta')) {
        paneState.commitPaneCycle();
      }
    },
    onWindowBlur: () => {
      if (paneState.hasActivePaneCycle()) paneState.commitPaneCycle();
    },
    onResize: () => {
      try { render(true); } catch (error) { reportError(error); }
    },
    onPointerdown: (event) => {
      if (
        !settingsPanelEl.classList.contains('is-hidden') &&
        !settingsPanelEl.contains(event.target as Node) &&
        !settingsButtonEl.contains(event.target as Node)
      ) {
        closeSettingsPanel();
      }
    },
    onEscapeKeydown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        modalStack.closeTop();
        const focusedPaneId = paneState.getFocusedPaneId();
        if (focusedPaneId && modalStack.isEmpty()) {
          dispatch({ type: 'pane.focus', paneId: focusedPaneId, focusTerminal: true });
        }
      }
    },
    onAddPaneClick: () => {
      try { dispatch({ type: 'pane.create' }); } catch (error) { reportError(error); }
    },
    onAddProfileClick: () => {
      try { commandPaletteEntries.openNewPaneProfilePicker(); } catch (error) { reportError(error); }
    },
    onLayoutsClick: () => {
      layoutManager.toggleLayoutsDropdown();
    },
    onSettingsClick: () => {
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
    },
    onLayoutsSettingsClick: () => {
      layoutModal.openLayoutsModal();
    },
    onShellProfilesSettingsClick: () => {
      shellProfileManager?.openShellProfilesModal();
    },
    onHooksSettingsClick: () => {
      hookManager.openHooksModal();
    },
    onKeyboardShortcutsSettingsClick: () => {
      openShortcutsModal();
    },
  };
}
