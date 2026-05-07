import { closeCommandPalette, isCommandPaletteOpen } from './command-palette';
import { createBreathingMaskAlert } from './pane-alert-breathing-mask';
import { createBackend, clearLayoutWindowBinding } from './backend';
import { createShellProfileManager } from './shell-profiles';
import { createContextMenus, type ContextMenus } from './context-menus';
import { createLayoutManager } from './layout-manager';
import { createLayoutModal } from './layout-modal';
import { createModalStack } from './modal-stack';
import { createFullscreenManager } from './fullscreen-manager';
import { createPaneOperations } from './pane-operations';
import { createCommandPaletteEntries } from './command-palette-entries';
import { createShellProfileState } from './shell-profile-adapter';
import '@xterm/xterm/css/xterm.css';

import * as ShortcutsRegistry from './shortcuts-registry';
import * as ShortcutsUI from './shortcuts-ui';
import * as ColorsRegistry from './colors-registry';
import { createFocusController } from './manager/create-focus-controller.js';
import { setIcon } from './icons';
import { createActions } from './input/actions';
import { createDispatcher } from './input/dispatcher';
import { renderHintBar } from './hint-bar';
import { createSettingsManager } from './settings';
import { createTabBar } from './tab-bar';
import type { TabBarLocalState, TabBar } from './tab-bar';
import type { ShellProfile } from './shell-profiles';
import { createPaneManager, type PaneManager } from './manager/create-pane-manager';
import type { TerminalCapability } from './pane/capabilities/terminal-capability';
import type { PtyCapability } from './pane/capabilities/pty-capability';

// DOM elements
const $ = (id: string) => document.getElementById(id)!;
const els = { stage: $('stage'), tabs: $('tabs-list'), status: $('status-label'), hint: $('status-hint'), settings: $('settings-panel') };
const getTextColorForBackground = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.5 ? '#000' : '#fff';
};

// State
let layoutRestore = false, notice: { id: string } | null = null, timer: number | null = null;
let tab: TabBar | null = null, ops: ReturnType<typeof createPaneOperations> | null = null, menus: ContextMenus | null = null;
const state: TabBarLocalState = (() => {
  let r: string | null = null, d: TabBarLocalState['dragState'] = null, p: TabBarLocalState['pendingTabFocus'] = null, c: string | null = null;
  return { get renamingPaneId() { return r; }, set renamingPaneId(v: string | null) { r = v; }, get dragState() { return d; }, set dragState(v: any) { d = v; }, get pendingTabFocus() { return p; }, set pendingTabFocus(v: any) { p = v; }, get currentMode() { return fc.getMode(); }, get pendingClosePaneId() { return c; }, set pendingClosePaneId(v: string | null) { c = v; } };
})();

// Helpers
const err = (e: unknown) => { els.status.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`; els.hint.textContent = ''; console.error(e); };
const label = (p: { title: string | null; terminalTitle: string }): string => p.title ?? p.terminalTitle ?? '';
const getLabel = (pane: any): string => ops ? ops.getPaneLabel(pane.getState() as any) : (pane.getState?.() ? label(pane.getState() as any) : pane.id ?? '');
const closeSet = () => { els.settings.classList.add('is-hidden'); ms.unregister(closeSet); };
const closeKey = () => { document.querySelector('.settings-modal-overlay')?.remove(); ms.unregister(closeKey); };
const openKey = () => { closeKey(); ms.register(closeKey); ShortcutsUI.openKeyboardShortcutsModal(be, sm.scheduleSettingsSave); };

// Backend
const be = createBackend((window as any).__TAURI__ ?? (window as any).vibe99 ?? null, null);
const ctx = (() => { const p = new URLSearchParams(window.location.search).get('layoutId'); return p ? { kind: 'layout' as const, id: p } : { kind: 'main' as const }; })();

// PaneManager
const pm: PaneManager = createPaneManager({
  backend: be, paneAlert: createBreathingMaskAlert(), onPaneClick: () => {}, onTerminalContextMenu: () => {},
  onStateChange: () => render(), defaultCwd: be.defaultCwd, defaultTabTitle: be.defaultTabTitle, getAccentPalette: () => [...ColorsRegistry.ACCENT_PALETTE],
});

const fc = createFocusController(pm, {
  onModeChange: (m) => { document.body.classList.toggle('is-navigation-mode', m === 'nav'); render(); },
  onFocusChange: () => render(),
});

// Managers
const ms = createModalStack();
const lm = createLayoutManager({ backend: be, paneManager: pm, modalStack: ms, reportError: err, layoutsButtonEl: $('tabs-layouts'), onManageLayouts: () => lmod.openLayoutsModal() });
(window as any).layoutManager = lm;
const lmod = createLayoutModal({ backend: be, modalStack: ms, reportError: err, layoutManager: lm });
const sm = createSettingsManager({ backend: be, reportError: err, applyCallback: () => render(true), paneActivityWatcher: null as any });

// TabBar
tab = createTabBar({
  paneManager: pm, state, getPaneLabel: getLabel, getTextColorForBackground,
  onTabClick: (id) => { ops?.focusPane(id); },
  onTabContext: (id, e) => { menus?.showTabContextMenu(id, e); },
  onTabDrag: (fi, ti) => {
    const fid = pm.getPaneIdAt(fi), tid = pm.getPaneIdAt(ti);
    if (fid && tid && fi !== ti) {
      const all = pm.getAll(), filt = all.filter(p => p.id !== fid);
      filt.splice(ti, 0, all[fi]);
      pm.closeAll();
      filt.forEach(p => { const s = p.serialize().state as any; pm.create({ title: s.title, cwd: s.cwd, accent: s.accent, shellProfileId: s.shellProfileId }); });
      render();
    }
  },
  onRename: (id, t) => { if (t !== null) pm.setPaneTitle(id, t); ops?.focusPane(id, { focusTerminal: true }); },
  onCloseTab: (i) => ops?.closePane(i),
  reportError: err, tabsListEl: els.tabs, setIcon,
});

// ShellProfileManager and ContextMenus
const spState = createShellProfileState(pm, ms, () => lm.scheduleWindowLayoutSave());
const spm = createShellProfileManager({ backend: be as any, state: spState, reportError: err, scheduleSave: () => lm.scheduleWindowLayoutSave(), initializePaneTerminal: async () => {}, registerModal: (fn) => ms.register(fn), unregisterModal: (fn) => ms.unregister(fn) });
menus = createContextMenus({
  state: { paneManager: pm, recordPaneVisit: (id) => fc.recordPaneVisit(id), clearPaneCycleState: () => fc.commitPaneCycle(), render: () => render(), registerModal: (fn) => ms.register(fn), unregisterModal: (fn) => ms.unregister(fn), scheduleSave: () => lm.scheduleWindowLayoutSave() },
  backend: be, shellProfileManager: spm, reportError: err, focusPane: (id) => ops?.focusPane(id), beginRenamePane: (i) => tab?.beginRenamePane(i), closePane: (i) => ops?.closePane(i), togglePaneBreathingMonitor: (id) => pm.togglePaneBreathingMonitor(id),
});

ops = createPaneOperations({ paneManager: pm, tabBar: tab as TabBar, layoutManager: lm, render, focusController: fc, state });

const cpe = createCommandPaletteEntries({ paneManager: pm, tabBar: tab as TabBar, layoutManager: lm, layoutModal: lmod, shellProfileManager: spm, contextMenus: menus as any, backend: be, settingsManager: sm, modalStack: ms, focusPane: (id) => { if (id) ops?.focusPane(id); }, addPane: (id) => ops?.addPane(id), closeSettingsPanel: closeSet, closeKeyboardShortcutsModal: closeKey, openKeymapHelpModal: openKey, settingsPanelEl: els.settings, statusLabelEl: els.status, statusHintEl: els.hint, getCurrentMode: () => fc.getMode(), setMode: (m) => fc.setMode(m) });
createFullscreenManager({ backend: be, fullscreenButtonEl: $('tabs-fullscreen'), reportError: err });

// Terminal events
be.terminal.onData(({ paneId, data }) => { if (!pm.get(paneId)) pm.get(paneId)?.capability<TerminalCapability>('terminal')?.write(data); });
be.terminal.onExit(({ paneId, exitCode, reason }) => { if (pm.get(paneId)) return; const h = ops?.handleTerminalExit({ paneId, exitCode, reason }); if (h === false) void be.window.close().catch(() => {}); });
be.onMenuAction?.(({ action, paneId }) => { try { menus?.handleMenuAction(action, paneId ?? ''); } catch {} });
be.onLayoutFocusNotice?.(() => { if (lm.getWindowLayoutId()) { ops?.refocusCurrentPaneTerminal(); showNotice(lm.getWindowLayoutId()!); } });

// Functions
function render(refit = false): void {
  tab?.renderTabs();
  if (refit) {
    const w = els.stage.clientWidth, h = els.stage.clientHeight, panes = pm.getAll(), fi = pm.getFocusedIndex();
    panes.forEach((p, i) => { pm.setLayout(p.id, { left: i * (w / panes.length), height: h, zIndex: i + 1 }); pm.setFocused(p.id, i === fi, fc.getMode() === 'nav'); });
  }
  update();
  if (layoutRestore) lm.scheduleWindowLayoutSave();
}

function update(): void {
  if (notice) {
    els.status.textContent = 'Layout focused';
    els.status.classList.remove('is-navigation-mode');
    els.hint.textContent = lm.getLayoutDisplayName(notice.id);
    return;
  }
  const fp = pm.getActive();
  const { modeLabel, hintsHtml } = renderHintBar(ShortcutsRegistry.getActiveKeymap(), fc.getMode(), fp ? label(fp.serialize().state as any) : '', be.platform);
  els.status.textContent = modeLabel;
  els.status.classList.toggle('is-navigation-mode', fc.getMode() === 'nav');
  els.hint.innerHTML = hintsHtml;
}

function showNotice(lid: string): void {
  notice = { id: lid };
  document.body.style.setProperty('--layout-focus-accent', ops?.getFocusedPaneAccent() ?? null);
  document.body.dataset.layoutFocusName = lm.getLayoutDisplayName(lid);
  document.body.classList.remove('is-layout-focus-notice');
  void document.body.offsetWidth;
  document.body.classList.add('is-layout-focus-notice');
  update();
  window.clearTimeout(timer ?? undefined);
  timer = window.setTimeout(() => { notice = null; delete document.body.dataset.layoutFocusName; document.body.classList.remove('is-layout-focus-notice'); update(); }, 1400);
}

// Keyboard
const ka = createActions({
  addPane: (...a) => ops?.addPane(...a), enterNavigationMode: () => fc.enterNavigationMode(), cycleToRecentPane: (...a) => ops?.cycleToRecentPane(...a), cycleToNextLitPane: (...a) => ops?.cycleToNextLitPane(...a), navigateLeft: (...a) => ops?.navigateLeft(...a), navigateRight: (...a) => ops?.navigateRight(...a),
  copyTerminalSelection: () => { const id = pm.getActiveId(); if (!id) return false; const t = pm.get(id)?.capability<TerminalCapability>('terminal'); const s = t?.getSelection(); if (s) { void be.clipboard.write(s); return true; } return false; },
  pasteIntoTerminal: async () => { const id = pm.getActiveId(); if (!id) return; const pty = pm.get(id)?.capability<PtyCapability>('pty'); const txt = await be.clipboard.read(); if (txt && pty) pty.write(txt); },
  moveFocus: (...a) => ops?.moveFocus(...a), focusPane: (...a) => ops?.focusPane(...a),
  cancelNavigationMode: () => { const sid = fc.getEnterNavSourcePaneId(); fc.cancelNavigationMode(); if (sid) pm.get(sid)?.capability<TerminalCapability>('terminal')?.focus(); },
  getFocusedPaneId: () => pm.getActiveId() ?? '', isCommandPaletteOpen, closeCommandPalette,
  openTabSwitcher: () => cpe.openTabSwitcher(), openCommandList: () => cpe.openCommandList(), openNewPaneProfilePicker: () => cpe.openNewPaneProfilePicker(),
  focusPaneAt: (...a) => ops?.focusPaneAt(...a), getPaneCount: () => ops?.getPaneCount() ?? 0, getPaneIdAt: (i) => ops?.getPaneIdAt(i) ?? undefined,
  requestClosePane: (id) => ops?.requestClosePane(id), startInlineRename: (id) => { const i = pm.getPaneIndex(id); if (i >= 0) ops?.startInlineRename(id); },
  openKeymapHelpModal: openKey, openLayoutsModal: () => lmod.openLayoutsModal(),
});

const dk = createDispatcher({ getKeymap: ShortcutsRegistry.getActiveKeymap, actions: ka, getMode: () => fc.getMode(), isInputFocused: () => document.activeElement?.tagName === 'INPUT', isCommandPaletteOpen });

// Window events
window.addEventListener('keydown', dk, true);
window.addEventListener('keyup', (e) => { if (fc.hasActivePaneCycle() && (e.key === 'Control' || e.key === 'Meta')) fc.commitPaneCycle(); });
window.addEventListener('blur', () => { if (fc.hasActivePaneCycle()) fc.commitPaneCycle(); });
window.addEventListener('pointerdown', (e) => { if (!els.settings.classList.contains('is-hidden') && !els.settings.contains(e.target as Node) && !$('tabs-settings').contains(e.target as Node)) closeSet(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); ms.closeTop(); const fid = pm.getActiveId(); if (fid && ms.isEmpty()) ops?.focusPane(fid, { focusTerminal: true }); } }, true);
window.addEventListener('resize', () => { try { render(true); } catch {} });
$('tabs-add').addEventListener('click', () => { try { ops?.addPane(); } catch {} });
$('tabs-add-profile').addEventListener('click', (e) => { e.stopPropagation(); try { cpe.openNewPaneProfilePicker(); } catch {} });
$('tabs-layouts').addEventListener('click', (e) => { e.stopPropagation(); lm.toggleLayoutsDropdown(); });
$('tabs-settings').addEventListener('click', (e) => { e.stopPropagation(); document.querySelector('.add-pane-profile-popup')?.remove(); lm.closeLayoutsDropdown(); const wh = els.settings.classList.toggle('is-hidden'); if (wh) closeSet(); else { sm.applySettings(); ms.register(closeSet); } });
$('layouts-settings-btn')?.addEventListener('click', () => lmod.openLayoutsModal());
$('layouts-settings-btn')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lmod.openLayoutsModal(); } });
$('shell-profiles-settings-btn').addEventListener('click', () => spm?.openShellProfilesModal());
$('shell-profiles-settings-btn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); spm?.openShellProfilesModal(); } });
$('keyboard-shortcuts-settings-btn').addEventListener('click', () => { closeKey(); ms.register(closeKey); ShortcutsUI.openKeyboardShortcutsModal(be, sm.scheduleSettingsSave); });
$('keyboard-shortcuts-settings-btn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeKey(); ms.register(closeKey); ShortcutsUI.openKeyboardShortcutsModal(be, sm.scheduleSettingsSave); } });
els.settings.addEventListener('click', (e) => e.stopPropagation());

// Init
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await be.cwdReady;
    const ss = await be.settings.load();
    sm.applyPersistedSettings(ss);
    sm.applySettings();
    spm?.loadShellProfiles();
    await lm.refreshLayouts();
    let layouts = lm.getLayouts(), dlid = lm.getDefaultLayoutId();
    let dl = layouts.find((l) => l.id === dlid) || layouts.find((l) => l.id === 'default');
    if (!dl) {
      dl = lm.createDefaultLayout();
      const sv = await be.layouts.save(dl);
      lm._setLayouts(sv.layouts ?? [dl]);
      lm._setDefaultLayoutId(sv.defaultLayoutId ?? dlid);
    }
    if (dlid !== dl.id) {
      const cfg = await be.layouts.setAsDefault(dl.id);
      lm._setLayouts(cfg.layouts ?? layouts);
      lm._setDefaultLayoutId(cfg.defaultLayoutId ?? dl.id);
    }
    const tlid = ctx.kind === 'layout' ? ctx.id : lm.getDefaultLayoutId();
    const tl = lm.getLayouts().find((l) => l.id === tlid);
    if (!tl) throw new Error(`Layout not found: ${tlid}`);
    lm.setWindowLayoutId(tl.id);
    pm.restoreSession(tl.panes as any, tl.focusedPaneIndex ?? 0);
    fc.syncMru();
    fc.recordPaneVisit(pm.getActiveId());
    lm.updateLayoutsIndicator();
    render(true);
    lm.setLayoutRestoreComplete(true);
  } catch (e) { document.body.innerHTML = `<div style="color:#e06c75;padding:2em;font-family:monospace;white-space:pre-wrap">Initialization failed: ${e instanceof Error ? e.message : String(e)}</div>`; }
});

window.addEventListener('beforeunload', () => { lm.flushWindowLayoutSave(); sm.flushSettingsSave(); clearLayoutWindowBinding(lm.getWindowLayoutId() ?? undefined, be.currentWindowLabel); });
window.addEventListener('error', (e) => { els.status.textContent = `Error: ${e.error || e.message}`; console.error(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { els.status.textContent = `Error: ${e.reason}`; console.error(e.reason); });
