import { createRendererApp } from './create-renderer-app';

const app = createRendererApp({
  stageEl: document.getElementById('stage')!,
  tabsListEl: document.getElementById('tabs-list')!,
  statusLabelEl: document.getElementById('status-label')!,
  statusHintEl: document.getElementById('status-hint')!,
  addPaneButtonEl: document.getElementById('tabs-add')!,
  addProfileButtonEl: document.getElementById('tabs-add-profile')!,
  layoutsButtonEl: document.getElementById('tabs-layouts')!,
  settingsButtonEl: document.getElementById('tabs-settings')!,
  fullscreenButtonEl: document.getElementById('tabs-fullscreen')!,
  settingsPanelEl: document.getElementById('settings-panel')!,
  shellProfilesSettingsBtn: document.getElementById('shell-profiles-settings-btn')!,
  layoutsSettingsBtn: document.getElementById('layouts-settings-btn')!,
  keyboardShortcutsSettingsBtn: document.getElementById('keyboard-shortcuts-settings-btn')!,
});

window.addEventListener('keydown', app.getDispatchKeydown(), true);

window.addEventListener('keyup', (event) => {
  if (app.paneState.hasActivePaneCycle() && (event.key === 'Control' || event.key === 'Meta')) {
    app.paneState.commitPaneCycle();
  }
});

window.addEventListener('blur', () => {
  if (app.paneState.hasActivePaneCycle()) app.paneState.commitPaneCycle();
});

window.addEventListener('pointerdown', (event) => {
  const settingsPanelEl = document.getElementById('settings-panel')!;
  const settingsButtonEl = document.getElementById('tabs-settings')!;
  if (
    !settingsPanelEl.classList.contains('is-hidden') &&
    !settingsPanelEl.contains(event.target as Node) &&
    !settingsButtonEl.contains(event.target as Node)
  ) {
    settingsPanelEl.classList.add('is-hidden');
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    app.closeTopModal();
    const focusedPaneId = app.paneState.getFocusedPaneId();
    if (focusedPaneId && app.isModalStackEmpty()) {
      app.focusPane(focusedPaneId, { focusTerminal: true });
    }
  }
}, true);

window.addEventListener('resize', () => {
  try { app.render(true); } catch (error) { console.error(error); }
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await app.init();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    document.body.innerHTML = `<div style="color:#e06c75;padding:2em;font-family:monospace;white-space:pre-wrap">Initialization failed: ${msg}</div>`;
  }
});

window.addEventListener('beforeunload', () => {
  app.destroy();
});

window.addEventListener('error', (event) => {
  console.error(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
});
