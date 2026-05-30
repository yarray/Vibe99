import { createBridge } from './bridge';
import { createWorkbenchRenderer } from './runtime/workbench-renderer';
import { initCliBridge } from './cli-bridge';
import { loadBuiltinThemes } from './domain/theme-presets';
import '@xterm/xterm/css/xterm.css';

// ---------------------------------------------------------------------------
// Themes — load built-in presets before any terminal is created
// ---------------------------------------------------------------------------
loadBuiltinThemes();

// ---------------------------------------------------------------------------
// DOM refs
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
const hooksSettingsBtn = document.getElementById('hooks-settings-btn')!;
const layoutsSettingsBtn = document.getElementById('layouts-settings-btn')!;
const keyboardShortcutsSettingsBtn = document.getElementById('keyboard-shortcuts-settings-btn')!;

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------
function resolveWindowLayoutId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return (window as any).__VIBE99_LAYOUT_ID ?? params.get('layoutId');
}

const windowLayoutId = resolveWindowLayoutId();
const bridge = createBridge((window as any).__TAURI__ ?? (window as any).vibe99 ?? null, windowLayoutId);

// E2E instrumentation: capture writeTerminal calls
const _originalWriteTerminal = bridge.writeTerminal;
(bridge as any).writeTerminal = (payload: any) => {
  const captures = (window as any).__e2e_capturedWrites;
  if (captures) {
    captures.push(payload);
  }
  return _originalWriteTerminal(payload);
};

// ---------------------------------------------------------------------------
// Workbench renderer — all orchestration lives here
// ---------------------------------------------------------------------------
const wb = createWorkbenchRenderer({
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
});

// ---------------------------------------------------------------------------
// Global browser / Tauri events
// ---------------------------------------------------------------------------
window.addEventListener('keydown', wb.onKeydown, true);

window.addEventListener('keyup', wb.onKeyup);

window.addEventListener('blur', wb.onWindowBlur);

window.addEventListener('resize', wb.onResize);

window.addEventListener('pointerdown', wb.onPointerdown);

window.addEventListener('keydown', wb.onEscapeKeydown, true);

window.addEventListener('DOMContentLoaded', () => {
  wb.init().then(() => {
    initCliBridge({
      dispatch: wb.dispatch,
      listen: (event, handler) => bridge.listen(event, handler),
      invoke: async (cmd, args) => {
        const tauri = (window as any).__TAURI__;
        if (tauri) {
          await tauri.core.invoke(cmd, args);
        }
      },
    });
  }).catch(wb.reportError);
});

window.addEventListener('beforeunload', wb.dispose);

window.addEventListener('error', (event) => {
  wb.reportError(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  wb.reportError(event.reason);
});

// ---------------------------------------------------------------------------
// Toolbar button events
// ---------------------------------------------------------------------------
addPaneButtonEl.addEventListener('click', wb.onAddPaneClick);

addProfileButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  wb.onAddProfileClick();
});

layoutsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  wb.onLayoutsClick();
});

settingsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  wb.onSettingsClick();
});

settingsPanelEl.addEventListener('click', (event) => event.stopPropagation());

layoutsSettingsBtn?.addEventListener('click', wb.onLayoutsSettingsClick);
layoutsSettingsBtn?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wb.onLayoutsSettingsClick(); }
});

shellProfilesSettingsBtn.addEventListener('click', wb.onShellProfilesSettingsClick);
shellProfilesSettingsBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wb.onShellProfilesSettingsClick(); }
});

hooksSettingsBtn.addEventListener('click', wb.onHooksSettingsClick);
hooksSettingsBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wb.onHooksSettingsClick(); }
});

keyboardShortcutsSettingsBtn.addEventListener('click', wb.onKeyboardShortcutsSettingsClick);
keyboardShortcutsSettingsBtn.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); wb.onKeyboardShortcutsSettingsClick(); }
});
