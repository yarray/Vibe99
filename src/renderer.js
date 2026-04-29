import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import {
  openCommandPalette,
  closeCommandPalette,
  isCommandPaletteOpen,
} from './command-palette.js';
import { createPaneActivityWatcher } from './pane-activity-watcher.js';
import { createBreathingMaskAlert } from './pane-alert-breathing-mask.js';
import '@xterm/xterm/css/xterm.css';

import * as ShortcutsRegistry from './shortcuts-registry.js';
import * as ShortcutsUI from './shortcuts-ui.js';
import * as ColorsRegistry from './colors-registry.js';
import { createActions } from './input/actions.js';
import { createDispatcher } from './input/dispatcher.js';
import { formatChord } from './input/keymap.js';
import { renderHintBar } from './hint-bar.js';

function getRuntimePlatform() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) {
    return 'win32';
  }
  if (platform.includes('mac')) {
    return 'darwin';
  }
  return 'linux';
}

function getDefaultFontFamily(platform = getRuntimePlatform()) {
  if (platform === 'win32' || platform === 'windows') {
    return 'Consolas, "Cascadia Mono", "Courier New", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", monospace';
}

function basename(path) {
  return path.replace(/\/+$/, '').split('/').pop() || '/';
}

const LAYOUT_FOCUS_NOTICE_EVENT = 'vibe99:layout-focus-notice';

// OSC 7 format: \x1b]7;file://hostname/path\x07
// Extracts the path from the OSC 7 sequence and URL-decodes it.
function extractPathFromOsc7(data) {
  const prefix = 'file://';
  if (!data.startsWith(prefix)) {
    return null;
  }
  const afterPrefix = data.slice(prefix.length);
  // Skip hostname part until the next slash
  const slashIndex = afterPrefix.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  let encodedPath = afterPrefix.slice(slashIndex);
  // Windows OSC 7 paths look like /C:/Users/... — strip the leading slash
  // so the result is a valid Windows path (C:/Users/...).
  if (/^\/[A-Za-z]:\//.test(encodedPath)) {
    encodedPath = encodedPath.slice(1);
  }
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

function splitArgs(str) {
  const args = [];
  let cur = '';
  let inQuote = false;
  let quoteChar = '';
  for (const ch of str) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; } else { cur += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { args.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) { args.push(cur); }
  return args;
}

// Converts a string array back to a shell-quoted command-line string.
// This is the inverse of splitArgs(): formatArgs(splitArgs(s)) === s for any s.
function formatArgs(args) {
  return args.map((arg) => {
    // Arguments needing quoting: contain spaces, double quotes, backslashes, or are empty.
    if (arg === '' || /[\s"]/.test(arg) || /\\/.test(arg)) {
      // Escape backslashes and double quotes before wrapping in double quotes.
      const escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    return arg;
  }).join(' ');
}


function createUnavailableBridge() {
  const fail = () => {
    throw new Error('Tauri bridge is unavailable');
  };

  const defaultCwd = '/';

  return {
    platform: getRuntimePlatform(),
    currentWindowLabel: 'browser',
    defaultCwd,
    defaultTabTitle: basename(defaultCwd),
    createTerminal: fail,
    writeTerminal: fail,
    resizeTerminal: fail,
    destroyTerminal: fail,
    closeWindow: fail,
    readClipboardText: () => Promise.reject(new Error('Clipboard bridge is unavailable')),
    writeClipboardText: fail,
    getClipboardSnapshot: () => ({ text: '', hasImage: false }),
    openExternalUrl: fail,
    showContextMenu: fail,
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve({}),
    listShellProfiles: () => Promise.resolve({ profiles: [], defaultProfile: '' }),
    addShellProfile: fail,
    listLayouts: () => Promise.resolve({ layouts: [], defaultLayoutId: '' }),
    saveLayout: fail,
    deleteLayout: fail,
    renameLayout: fail,
    openLayoutWindow: fail,
    openLayoutInNewWindow: fail,
    setLayoutAsDefault: fail,
    removeShellProfile: fail,
    setDefaultShellProfile: fail,
    detectShellProfiles: () => Promise.resolve([]),
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    onMenuAction: () => () => {},
    onLayoutFocusNotice: undefined,
    cwdReady: Promise.resolve(),
  };
}

function createTauriBridge(tauri) {
  const { invoke } = tauri.core;
  const { getCurrentWindow } = tauri.window;
  const { WebviewWindow } = tauri.webviewWindow;
  const { readText: clipboardReadText, writeText: clipboardWriteText } =
    tauri.clipboardManager;
  const { openUrl } = tauri.opener;

  function base64Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  const currentWebview = tauri.webview.getCurrentWebview();

  function onTauriEvent(event, handler) {
    const unlisten = currentWebview.listen(event, (e) => handler(e.payload));
    return () => unlisten.then((fn) => fn());
  }

  let _resolvedCwd = '.';
  const _cwdReady = invoke('get_cwd')
    .then((cwd) => { _resolvedCwd = cwd; })
    .catch(() => {});
  const currentWindow = getCurrentWindow();

  async function focusWindow(win) {
    await win.unminimize().catch(() => {});
    await win.show().catch(() => {});
    await win.setFocus();
    await Promise.resolve(tauri.event?.emitTo?.(win.label, LAYOUT_FOCUS_NOTICE_EVENT))
      .catch(() => {});
  }

  function getLayoutWindowLabel(layoutId) {
    const safeLabel = layoutId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `layout-${safeLabel}`;
  }

  async function openLayoutWindow(layoutId) {
    if (layoutId === windowLayoutId) {
      return focusWindow(currentWindow);
    }

    const boundLabel = getBoundLayoutWindowLabel(layoutId);
    if (boundLabel) {
      const bound = await WebviewWindow.getByLabel(boundLabel);
      if (bound) {
        return focusWindow(bound);
      }
      clearLayoutWindowBinding(layoutId, boundLabel);
    }

    const label = getLayoutWindowLabel(layoutId);
    const existing = layoutId === 'default'
      ? await WebviewWindow.getByLabel('main')
      : await WebviewWindow.getByLabel(label);
    if (existing) {
      return focusWindow(existing);
    }

    const url = `index.html?layoutId=${encodeURIComponent(layoutId)}`;
    const win = new WebviewWindow(label, {
      url,
      title: `Vibe99 - ${layoutId}`,
      width: 1600,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      center: true,
    });
    return win.once('tauri://created', () => {}).then(() => {});
  }

  return {
    platform: getRuntimePlatform(),
    currentWindowLabel: currentWindow.label,
    get defaultCwd() { return _resolvedCwd; },
    get defaultTabTitle() { return basename(_resolvedCwd); },
    createTerminal: (payload) =>
      invoke('terminal_create', {
        paneId: payload.paneId,
        cols: payload.cols,
        rows: payload.rows,
        cwd: payload.cwd,
        shellProfileId: payload.shellProfileId ?? null,
      }),
    writeTerminal: (payload) =>
      invoke('terminal_write', {
        paneId: payload.paneId,
        data: base64Encode(payload.data),
      }),
    resizeTerminal: (payload) =>
      invoke('terminal_resize', {
        paneId: payload.paneId,
        cols: payload.cols,
        rows: payload.rows,
      }),
    destroyTerminal: (payload) =>
      invoke('terminal_destroy', { paneId: payload.paneId }),
    closeWindow: () => getCurrentWindow().close(),
    readClipboardText: () => clipboardReadText(),
    writeClipboardText: (text) => clipboardWriteText(text),
    getClipboardSnapshot: async () => {
      try {
        const text = await clipboardReadText();
        return { text: text ?? '', hasImage: false };
      } catch {
        return { text: '', hasImage: false };
      }
    },
    openExternalUrl: (url) => openUrl(url),
    showContextMenu: () => {},
    loadSettings: () => invoke('settings_load'),
    saveSettings: (payload) => invoke('settings_save', { settings: payload }),
    listShellProfiles: () => invoke('shell_profiles_list'),
    addShellProfile: (profile) => invoke('shell_profile_add', { profile }),
    listLayouts: () => invoke('layouts_list'),
    saveLayout: (layout) => invoke('layout_save', { layout }),
    deleteLayout: (layoutId) => invoke('layout_delete', { layoutId }),
    renameLayout: (layoutId, newName) => invoke('layout_rename', { layoutId, newName }),
    openLayoutWindow: (layoutId) => openLayoutWindow(layoutId),
    openLayoutInNewWindow: (layoutId) => openLayoutWindow(layoutId),
    setLayoutAsDefault: (layoutId) => invoke('layout_set_default', { layoutId }),
    removeShellProfile: (profileId) => invoke('shell_profile_remove', { profileId }),
    setDefaultShellProfile: (profileId) => invoke('shell_profile_set', { profileId }),
    detectShellProfiles: () => invoke('shell_profiles_detect'),
    onTerminalData: (handler) => onTauriEvent('vibe99:terminal-data', handler),
    onTerminalExit: (handler) => onTauriEvent('vibe99:terminal-exit', handler),
    onMenuAction: (handler) => onTauriEvent('vibe99:menu-action', handler),
    onLayoutFocusNotice: (handler) => onTauriEvent(LAYOUT_FOCUS_NOTICE_EVENT, handler),
    cwdReady: _cwdReady,
  };
}

const bridge = window.__TAURI__
  ? createTauriBridge(window.__TAURI__)
  : window.vibe99 ?? createUnavailableBridge();

const windowContext = (() => {
  const params = new URLSearchParams(window.location.search);
  const layoutId = params.get('layoutId');
  return layoutId ? { kind: 'layout', layoutId } : { kind: 'main' };
})();

const initialPanes = [
  {
    id: 'p1',
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: bridge.defaultCwd,
    accent: ColorsRegistry.ACCENT_PALETTE[0],
    shellProfileId: null,
  },
  {
    id: 'p2',
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: bridge.defaultCwd,
    accent: ColorsRegistry.ACCENT_PALETTE[1],
    shellProfileId: null,
  },
  {
    id: 'p3',
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: bridge.defaultCwd,
    accent: ColorsRegistry.ACCENT_PALETTE[2],
    shellProfileId: null,
  },
];


let panes = initialPanes.map((pane) => ({ ...pane }));
let focusedPaneId = panes[0].id;
let nextPaneNumber = panes.length + 1;
let renamingPaneId = null;
let isRenderingTabs = false; // Guard against re-entrant renderTabs calls
let dragState = null;
let currentMode = 'terminal'; // 'terminal' | 'nav'
let enterNavSourcePaneId = null; // Track which pane was focused when entering nav mode
let pendingTabFocus = null;
let layoutRestoreComplete = false;
let layouts = [];
let windowLayoutId = null;
let defaultLayoutId = '';
let selectedLayoutId = null;
let renamingLayoutId = null;
let layoutFocusNotice = null;
let layoutFocusNoticeTimer = null;
const LAYOUT_WINDOW_BINDINGS_KEY = 'vibe99.layoutWindowBindings';

// Auto-refresh polling for Layouts modal
const LAYOUT_MODAL_POLL_INTERVAL = 3000; // 3 seconds
let layoutModalPollTimer = null;

function readLayoutWindowBindings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAYOUT_WINDOW_BINDINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLayoutWindowBindings(bindings) {
  try {
    window.localStorage.setItem(LAYOUT_WINDOW_BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // Best effort only. The stable Tauri window label still prevents duplicates
    // for layout windows created through the normal UI path.
  }
}

function getBoundLayoutWindowLabel(layoutId) {
  const label = readLayoutWindowBindings()[layoutId];
  return typeof label === 'string' && label ? label : null;
}

function clearLayoutWindowBinding(layoutId, expectedLabel = null) {
  if (!layoutId) return;
  const bindings = readLayoutWindowBindings();
  if (expectedLabel !== null && bindings[layoutId] !== expectedLabel) return;
  delete bindings[layoutId];
  writeLayoutWindowBindings(bindings);
}

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

// Mode management
function setMode(next) {
  if (currentMode === next) return;
  currentMode = next;
  document.body.classList.toggle('is-navigation-mode', currentMode === 'nav');
  render();
}

// Most-recently-used pane stack for Ctrl+` cycling. Index 0 is the most
// recently visited pane (typically equals focusedPaneId when no cycle is in
// progress). All current pane IDs always appear exactly once.
let paneMruOrder = panes.map((pane) => pane.id);

// Transient state while the user is cycling with the modifier still held.
// `snapshot` freezes the MRU order at the start of the cycle so repeated
// presses step through a stable list. `index` points into that snapshot.
// `null` means no cycle is in progress.
let paneCycleState = null;

const paneNodeMap = new Map();

const stageEl = document.getElementById('stage');
const tabsListEl = document.getElementById('tabs-list');
const statusLabelEl = document.getElementById('status-label');
const statusHintEl = document.getElementById('status-hint');
const addPaneButtonEl = document.getElementById('tabs-add');
const addPaneDropdownButtonEl = document.getElementById('tabs-add-dropdown');
const layoutsButtonEl = document.getElementById('tabs-layouts');
const settingsButtonEl = document.getElementById('tabs-settings');
const fullscreenButtonEl = document.getElementById('tabs-fullscreen');
const settingsPanelEl = document.getElementById('settings-panel');
const fontSizeInputEl = document.getElementById('font-size-input');
const fontFamilyInputEl = document.getElementById('font-family-input');
const paneWidthRangeEl = document.getElementById('pane-width-range');
const paneWidthInputEl = document.getElementById('pane-width-input');
const paneWidthValueEl = document.getElementById('pane-width-value');
const paneOpacityRangeEl = document.getElementById('pane-opacity-range');
const paneOpacityInputEl = document.getElementById('pane-opacity-input');
const paneOpacityValueEl = document.getElementById('pane-opacity-value');
const paneMaskOpacityRangeEl = document.getElementById('pane-mask-alpha-range');
const paneMaskOpacityInputEl = document.getElementById('pane-mask-alpha-input');
const paneMaskOpacityValueEl = document.getElementById('pane-mask-alpha-value');
const breathingAlertToggleEl = document.getElementById('breathing-alert-toggle');
const shellProfilesSettingsBtn = document.getElementById('shell-profiles-settings-btn');
const layoutsSettingsBtn = document.getElementById('layouts-settings-btn');
const keyboardShortcutsSettingsBtn = document.getElementById('keyboard-shortcuts-settings-btn');

const settings = {
  fontSize: 13,
  fontFamily: getDefaultFontFamily(bridge.platform),
  paneOpacity: 0.8,
  paneMaskOpacity: 0.75,
  paneWidth: 720,
  breathingAlertEnabled: true,
};
let pendingSettingsSave = null;
let pendingLayoutSave = null;

// Called when a pane's cwd changes via OSC 7. Immediately updates the pane
// and schedules a debounced settings save.
function onPaneCwdChanged(paneId, newCwd) {
  const paneIndex = panes.findIndex((p) => p.id === paneId);
  if (paneIndex === -1) {
    return;
  }
  const existingCwd = panes[paneIndex].cwd;
  if (existingCwd === newCwd) {
    return;
  }

  panes[paneIndex] = { ...panes[paneIndex], cwd: newCwd };

  scheduleWindowLayoutSave(5000);
}

let shellProfiles = [];
let defaultShellProfileId = '';
let editingShellProfile = null; // null or { id?, name, command, args }
let selectedShellProfileId = null; // ID of currently selected profile for editing

// Layout dropdown state
let layoutsDropdownOpen = false;
let layoutsDropdownEl = null;

// Surface "settled output on a backgrounded pane" via a pulsing mask. The
// watcher just decides *when* a pane should alert; the alert renderer
// decides *how* it looks. To switch styles (border flash, tab badge, …),
// swap `createBreathingMaskAlert` for another renderer with the same shape.
const paneAlert = createBreathingMaskAlert();
const paneActivityWatcher = createPaneActivityWatcher({
  onAlert: (paneId) => {
    const node = paneNodeMap.get(paneId);
    if (node) paneAlert.setAlerted(node.root, true);
  },
  onClear: (paneId) => {
    const node = paneNodeMap.get(paneId);
    if (node) paneAlert.setAlerted(node.root, false);
  },
});

const removeTerminalDataListener = bridge.onTerminalData(({ paneId, data }) => {
  const node = paneNodeMap.get(paneId);
  if (!node) return;
  node.terminal.write(data);
  paneActivityWatcher.noteData(paneId);
});

bridge.onLayoutFocusNotice?.(() => {
  if (!windowLayoutId) return;
  refocusCurrentPaneTerminal();
  showLayoutFocusNotice(windowLayoutId);
});

const removeTerminalExitListener = bridge.onTerminalExit(({ paneId, exitCode, reason }) => {
  const node = paneNodeMap.get(paneId);
  if (!node) {
    return;
  }

  // Killed sessions are backend-initiated cleanup — don't auto-close UI panes.
  if (reason === 'killed') {
    node.sessionReady = false;
    return;
  }

  // If the terminal was destroyed for a shell change, or the process exited
  // within a short grace period after a shell change, don't close the pane.
  const graceMs = 3000;
  const recentShellChange = node._shellChangeTime && (Date.now() - node._shellChangeTime < graceMs);
  if (node._shellChanging || recentShellChange) {
    node.sessionReady = false;
    node.terminal.writeln('');
    node.terminal.writeln(`\x1b[38;5;204m[shell exited with code ${exitCode}]\x1b[0m`);
    return;
  }

  node.sessionReady = false;
  node.terminal.writeln('');
  node.terminal.writeln(`\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`);

  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) {
    return;
  }

  if (panes.length === 1) {
    void bridge.closeWindow().catch(reportError);
    return;
  }

  closePane(paneIndex, { destroyTerminal: false });
});

const removeMenuActionListener = bridge.onMenuAction(({ action, paneId }) => {
  try {
    handleMenuAction(action, paneId);
  } catch (error) {
    reportError(error);
  }
});

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  statusLabelEl.textContent = `Error: ${message}`;
  statusHintEl.textContent = '';
  console.error(error);
}

function getPreviewWidth(stageWidth, count) {
  if (count <= 1) {
    return 0;
  }

  if (stageWidth >= settings.paneWidth * count) {
    return settings.paneWidth;
  }

  return (stageWidth - settings.paneWidth) / (count - 1);
}

function getPaneLabel(pane) {
  return pane.title ?? pane.terminalTitle ?? '';
}

function applySettings() {
  document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--pane-opacity', settings.paneOpacity.toFixed(2));
  document.documentElement.style.setProperty('--pane-bg-mask-opacity', settings.paneMaskOpacity.toFixed(2));
  document.documentElement.style.setProperty('--pane-width', `${settings.paneWidth}px`);
  fontSizeInputEl.value = String(settings.fontSize);
  fontFamilyInputEl.value = settings.fontFamily;
  paneWidthRangeEl.value = String(settings.paneWidth);
  paneWidthInputEl.value = String(settings.paneWidth);
  paneWidthValueEl.textContent = `${settings.paneWidth}px`;
  paneOpacityRangeEl.value = settings.paneOpacity.toFixed(2);
  paneOpacityInputEl.value = settings.paneOpacity.toFixed(2);
  paneOpacityValueEl.textContent = settings.paneOpacity.toFixed(2);
  paneMaskOpacityRangeEl.value = settings.paneMaskOpacity.toFixed(2);
  paneMaskOpacityInputEl.value = settings.paneMaskOpacity.toFixed(2);
  paneMaskOpacityValueEl.textContent = settings.paneMaskOpacity.toFixed(2);
  breathingAlertToggleEl.checked = settings.breathingAlertEnabled;
  paneActivityWatcher.setGlobalEnabled(settings.breathingAlertEnabled);
}

function applyPersistedSettings(nextSettings) {
  if (!nextSettings || typeof nextSettings !== 'object') {
    return;
  }

  const uiSettings =
    nextSettings && typeof nextSettings.ui === 'object' && nextSettings.ui !== null
      ? nextSettings.ui
      : nextSettings;

  if (Number.isFinite(uiSettings.fontSize)) {
    settings.fontSize = uiSettings.fontSize;
  }

  if (typeof uiSettings.fontFamily === 'string') {
    settings.fontFamily = uiSettings.fontFamily;
  }

  if (Number.isFinite(uiSettings.paneOpacity)) {
    settings.paneOpacity = Math.max(0.55, Math.min(1, uiSettings.paneOpacity));
  }

  if (Number.isFinite(uiSettings.paneMaskOpacity)) {
    settings.paneMaskOpacity = Math.max(0, Math.min(1, uiSettings.paneMaskOpacity));
  }

  // Migrate legacy paneMaskAlpha → paneMaskOpacity
  if (Number.isFinite(uiSettings.paneMaskAlpha) && !Number.isFinite(uiSettings.paneMaskOpacity)) {
    settings.paneMaskOpacity = Math.max(0, Math.min(1, uiSettings.paneMaskAlpha));
  }

  // Migrate v3 inverted mask opacity: old value was 1 - overlay opacity.
  if (nextSettings?.version != null && nextSettings.version < 4) {
    settings.paneMaskOpacity = 1 - settings.paneMaskOpacity;
  }

  if (Number.isFinite(uiSettings.paneWidth)) {
    settings.paneWidth = uiSettings.paneWidth;
  }

  if (typeof uiSettings.breathingAlertEnabled === 'boolean') {
    settings.breathingAlertEnabled = uiSettings.breathingAlertEnabled;
  }

  // Load keyboard shortcuts
  if (typeof uiSettings.shortcuts === 'object' && uiSettings.shortcuts !== null) {
    ShortcutsRegistry.loadShortcutsFromSettings(uiSettings);
  } else {
    ShortcutsRegistry.loadShortcutsFromSettings({});
  }
}

/**
 * @typedef {Object} PaneStateV2
 * @property {string} paneId
 * @property {string|null} title
 * @property {string} cwd  — shell's real working directory (from OSC 7)
 * @property {string} accent
 * @property {string|undefined} customColor
 * @property {string|null} shellProfileId
 * @property {boolean} breathingMonitor
 * @typedef {Object} SessionStateV2
 * @property {number} version  — always 2
 * @property {PaneStateV2[]} panes
 * @property {number} focusedPaneIndex
 */

/** @returns {SessionStateV2} */
function buildSessionData() {
  const focusedIndex = getFocusedIndex();
  return {
    version: 2,
    panes: panes.map((p) => ({
      paneId: p.id,
      title: p.title,
      cwd: p.cwd,
      accent: p.accent,
      customColor: p.customColor,
      shellProfileId: p.shellProfileId,
      breathingMonitor: p.breathingMonitor !== false,
    })),
    focusedPaneIndex: focusedIndex >= 0 ? focusedIndex : 0,
  };
}

function restoreSession(session) {
  const validPanes = (session.panes ?? [])
    .filter((p) => p && typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent))
    .map((p, index) => ({
      id: `p${index + 1}`,
      title: (typeof p.title === 'string' && p.title) || null,
      terminalTitle: bridge.defaultTabTitle,
      cwd: (typeof p.cwd === 'string' && p.cwd) || bridge.defaultCwd,
      accent: p.accent,
      customColor: (typeof p.customColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.customColor) && p.customColor) || undefined,
      shellProfileId: (typeof p.shellProfileId === 'string' && p.shellProfileId) || null,
      breathingMonitor: p.breathingMonitor !== false,
    }));

  if (validPanes.length === 0) {
    panes = initialPanes.map((p) => ({
      ...p,
      cwd: bridge.defaultCwd,
      terminalTitle: bridge.defaultTabTitle,
    }));
    focusedPaneId = panes[0].id;
    nextPaneNumber = panes.length + 1;
    paneMruOrder = panes.map((p) => p.id);
    paneCycleState = null;
    return;
  }

  panes = validPanes;
  const focusedIndex = Math.min(
    Number.isFinite(session.focusedPaneIndex) ? session.focusedPaneIndex : 0,
    panes.length - 1,
  );
  focusedPaneId = panes[Math.max(0, focusedIndex)].id;
  nextPaneNumber = panes.length + 1;
  // Initial MRU order: focused pane first, then remaining panes in tab order.
  paneMruOrder = [focusedPaneId, ...panes.map((p) => p.id).filter((id) => id !== focusedPaneId)];
  paneCycleState = null;
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
  return {
    id: 'default',
    name: 'Default',
    panes: initialPanes.map((p) => ({
      paneId: p.id,
      title: p.title,
      cwd: bridge.defaultCwd,
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
  const layout = createLayoutFromCurrentWindow(
    windowLayoutId,
    existing?.name || windowLayoutId,
  );
  const config = await bridge.saveLayout(layout);
  layouts = config.layouts ?? layouts;
  defaultLayoutId = config.defaultLayoutId ?? defaultLayoutId;
  updateLayoutsIndicator();
}

async function saveLayoutAs(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return;
  }
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
  ensurePaneNodes();
  setWindowLayoutId(layoutId);
  flushWindowLayoutSave();
  updateLayoutsIndicator();
}

/**
 * Update the layouts button to reflect this window's bound layout.
 */
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

async function toggleLayoutsDropdown() {
  if (layoutsDropdownOpen) {
    closeLayoutsDropdown();
    return;
  }

  // Reload layouts to ensure we have the latest list
  try {
    await refreshLayouts();
  } catch (error) {
    reportError(error);
  }

  // Create dropdown menu
  layoutsDropdownEl = document.createElement('div');
  layoutsDropdownEl.className = 'layouts-dropdown';

  // Add layout items
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
      if (layout.id === windowLayoutId) {
        item.classList.add('is-active');
      }

      const checkmark = document.createElement('span');
      checkmark.className = 'layouts-dropdown-check';
      if (layout.id === windowLayoutId) {
        checkmark.classList.add('is-active');
      }

      const label = document.createElement('span');
      label.className = 'layouts-dropdown-label';
      label.textContent = layout.name || layout.id;

      item.append(label, checkmark);
      item.addEventListener('click', () => {
        bridge.openLayoutWindow(layout.id).catch(reportError);
        closeLayoutsDropdown();
      });

      layoutsDropdownEl.appendChild(item);
    }
  }

  // Separator
  const separator = document.createElement('div');
  separator.className = 'layouts-dropdown-separator';
  layoutsDropdownEl.appendChild(separator);

  // "Save Layout" action
  const saveCurrentAction = document.createElement('div');
  saveCurrentAction.className = 'layouts-dropdown-action';
  saveCurrentAction.textContent = 'Save Layout';
  saveCurrentAction.addEventListener('click', () => {
    saveCurrentLayout().catch(reportError);
    closeLayoutsDropdown();
  });
  layoutsDropdownEl.appendChild(saveCurrentAction);

  // "Save Layout As..." action
  const saveAction = document.createElement('div');
  saveAction.className = 'layouts-dropdown-action';
  saveAction.textContent = 'Save Layout As…';
  saveAction.addEventListener('click', () => {
    if (saveAction.classList.contains('is-editing')) return;

    saveAction.classList.add('is-editing');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layouts-dropdown-input';
    input.placeholder = 'Layout name';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'layouts-dropdown-btn layouts-dropdown-btn-confirm';
    confirmBtn.textContent = '✓';
    confirmBtn.title = 'Confirm (Enter)';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'layouts-dropdown-btn layouts-dropdown-btn-cancel';
    cancelBtn.textContent = '✕';
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
      if (value) {
        saveLayoutAs(value).catch(reportError);
      }
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

  // "Manage Layouts..." action
  const manageAction = document.createElement('div');
  manageAction.className = 'layouts-dropdown-action';
  manageAction.textContent = 'Manage Layouts…';
  manageAction.addEventListener('click', () => {
    openLayoutsModal();
    closeLayoutsDropdown();
  });
  layoutsDropdownEl.appendChild(manageAction);

  // Position and append
  layoutsButtonEl.appendChild(layoutsDropdownEl);
  layoutsDropdownOpen = true;

  // Close on outside click
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
}

function handleLayoutsDropdownOutsideClick(event) {
  if (!layoutsButtonEl.contains(event.target)) {
    closeLayoutsDropdown();
  }
}

function buildSettingsPayloadForCurrentWindow() {
  return {
    version: 6,
    ui: {
      ...settings,
      shortcuts: ShortcutsRegistry.getShortcutsForSave()
    },
  };
}

function scheduleSettingsSave() {
  if (pendingSettingsSave !== null) {
    window.clearTimeout(pendingSettingsSave);
  }

  pendingSettingsSave = window.setTimeout(() => {
    pendingSettingsSave = null;
    bridge.saveSettings(buildSettingsPayloadForCurrentWindow()).catch(reportError);
  }, 150);
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

function flushSettingsSave() {
  if (pendingSettingsSave !== null) {
    window.clearTimeout(pendingSettingsSave);
    pendingSettingsSave = null;
  }
  void bridge.saveSettings(buildSettingsPayloadForCurrentWindow()).catch(reportError);
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

// ----------------------------------------------------------------
// Shell profile management
// ----------------------------------------------------------------

let detectedShellProfiles = [];

function loadShellProfiles() {
  return Promise.all([
    bridge.listShellProfiles(),
    bridge.detectShellProfiles().catch(() => []),
  ]).then(([config, detected]) => {
    detectedShellProfiles = detected;
    const userProfiles = config.profiles ?? [];
    const userIds = new Set(userProfiles.map((p) => p.id));
    // Merge: user profiles first, then detected ones not already present.
    shellProfiles = [...userProfiles, ...detected.filter((p) => !userIds.has(p.id))];
    defaultShellProfileId = config.defaultProfile ?? '';
  }).catch(reportError);
}

function createProfileActionButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-btn';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function changePaneShell(paneId, profileId) {
  const node = paneNodeMap.get(paneId);
  if (!node) return;

  const previousProfileId = panes.find((p) => p.id === paneId)?.shellProfileId ?? null;

  panes = panes.map((p) =>
    p.id === paneId ? { ...p, shellProfileId: profileId } : p
  );
  scheduleWindowLayoutSave();

  // Suppress the exit handler — the old PTY is about to be replaced.
  // spawn() on the backend already destroys any previous session.
  node._shellChanging = true;
  node._shellChangeTime = Date.now();
  node.sessionReady = false;
  node.terminal.clear();
  initializePaneTerminal(node).finally(() => {
    node._shellChanging = false;
    // Revert profile on failure so the session doesn't persist a broken profile.
    if (!node.sessionReady) {
      panes = panes.map((p) =>
        p.id === paneId ? { ...p, shellProfileId: previousProfileId } : p
      );
      scheduleWindowLayoutSave();
    }
  });
}

// ----------------------------------------------------------------
// Settings modals for complex settings
// ----------------------------------------------------------------

function openShellProfilesModal() {
  loadShellProfiles();

  const overlay = document.createElement('div');
  overlay.className = 'settings-modal-overlay';

  overlay.innerHTML = `
    <div class="settings-modal shell-profiles-modal">
      <div class="settings-modal-header">
        <div class="settings-modal-title-group">
          <span>Shell Profiles</span>
          <button type="button" class="shell-profiles-add-btn" id="modal-shell-profile-add" aria-label="Add Profile">+</button>
        </div>
        <button type="button" class="settings-modal-close" aria-label="Close">×</button>
      </div>
      <div class="settings-modal-body shell-profiles-modal-body">
        <div class="shell-profiles-sidebar">
          <div class="shell-profile-list" id="modal-shell-profile-list"></div>
        </div>
        <div class="shell-profiles-editor-panel" id="modal-shell-profile-editor">
          <div class="shell-profiles-editor-placeholder">Select a profile or create a new one</div>
        </div>
      </div>
    </div>
  `;

  const closeModal = () => {
    overlay.remove();
    editingShellProfile = null;
    selectedShellProfileId = null;
    unregisterModal(closeModal);
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector('.settings-modal-close').addEventListener('click', closeModal);

  // Add profile button
  overlay.querySelector('#modal-shell-profile-add').addEventListener('click', () => {
    editingShellProfile = {
      id: '',
      name: '',
      command: '',
      args: '',
      isNew: true
    };
    selectedShellProfileId = null;
    renderModalShellProfiles();
  });

  document.body.appendChild(overlay);

  // Store reference to modal elements for rendering
  overlay._modalShellProfileList = overlay.querySelector('#modal-shell-profile-list');
  overlay._modalShellProfileEditor = overlay.querySelector('#modal-shell-profile-editor');

  // Select first profile by default if available
  if (shellProfiles.length > 0) {
    const firstProfile = shellProfiles[0];
    selectedShellProfileId = firstProfile.id;
    editingShellProfile = {
      id: firstProfile.id,
      name: firstProfile.name || '',
      command: firstProfile.command,
      args: formatArgs(firstProfile.args ?? []),
      isNew: false
    };
  } else {
    selectedShellProfileId = null;
    editingShellProfile = null;
  }

  renderModalShellProfiles();
  registerModal(closeModal);
}

function renderModalShellProfiles() {
  const overlay = document.querySelector('.settings-modal-overlay');
  if (!overlay || !overlay._modalShellProfileList) return;

  const listEl = overlay._modalShellProfileList;
  const editorEl = overlay._modalShellProfileEditor;

  if (!listEl || !editorEl) return;

  listEl.replaceChildren();
  editorEl.replaceChildren();

  // Render sidebar list
  if (shellProfiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'shell-profile-empty';
    empty.textContent = 'No profiles configured';
    listEl.appendChild(empty);
  } else {
    const detectedIds = new Set(detectedShellProfiles.map((p) => p.id));

    for (const profile of shellProfiles) {
      const isDetected = detectedIds.has(profile.id);
      const item = document.createElement('div');
      item.className = `shell-profile-item${profile.id === selectedShellProfileId ? ' is-selected' : ''}${profile.id === defaultShellProfileId ? ' is-default' : ''}${isDetected ? ' is-detected' : ''}`;
      item.dataset.profileId = profile.id;
      item.draggable = !isDetected;

      const name = document.createElement('div');
      name.className = 'shell-profile-name';
      name.textContent = profile.name || profile.id;

      const actions = document.createElement('div');
      actions.className = 'shell-profile-actions';

      // Quick actions: set default, clone, delete
      if (profile.id !== defaultShellProfileId) {
        actions.appendChild(createProfileActionButton('★', 'Set as default', () => {
          const apply = (config) => {
            const userIds = new Set((config.profiles ?? []).map((p) => p.id));
            shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
            defaultShellProfileId = config.defaultProfile ?? '';
            renderModalShellProfiles();
          };
          if (isDetected) {
            bridge.addShellProfile(profile).then(() => {
              bridge.setDefaultShellProfile(profile.id).then(apply).catch(reportError);
            }).catch(reportError);
          } else {
            bridge.setDefaultShellProfile(profile.id).then(apply).catch(reportError);
          }
        }));
      }

      actions.appendChild(createProfileActionButton('⧉', 'Clone profile', () => {
        cloneProfile(profile);
      }));

      if (!isDetected) {
        actions.appendChild(createProfileActionButton('✕', 'Delete', () => {
          if (selectedShellProfileId === profile.id) {
            selectedShellProfileId = null;
            editingShellProfile = null;
          }
          bridge.removeShellProfile(profile.id).then((config) => {
            const userIds = new Set((config.profiles ?? []).map((p) => p.id));
            shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
            defaultShellProfileId = config.defaultProfile ?? '';
            renderModalShellProfiles();
          }).catch(reportError);
        }));
      }

      item.append(name, actions);

      // Click to select (but not when dragging)
      let isDragging = false;
      let dragStartTime = 0;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.shell-profile-actions')) return;
        if (isDragging) return;
        selectedShellProfileId = profile.id;
        editingShellProfile = {
          id: profile.id,
          name: profile.name || '',
          command: profile.command,
          args: formatArgs(profile.args ?? []),
          isNew: false
        };
        renderModalShellProfiles();
      });

      // Drag events for reordering
      if (!isDetected) {
        item.addEventListener('dragstart', (e) => {
          dragStartTime = Date.now();
          isDragging = true;
          item.classList.add('is-dragging');
          e.dataTransfer.setData('text/plain', profile.id);
          e.dataTransfer.effectAllowed = 'move';
          // Set a drag image if possible
          if (e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(item, 0, 0);
          }
        });

        item.addEventListener('dragend', (e) => {
          const dragDuration = Date.now() - dragStartTime;
          // If drag was very short, treat it as a click
          if (dragDuration < 200) {
            isDragging = false;
          }
          setTimeout(() => {
            isDragging = false;
          }, 100);
          item.classList.remove('is-dragging');
          document.querySelectorAll('.shell-profile-item').forEach(el => {
            el.classList.remove('drag-over');
          });
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const dragging = document.querySelector('.shell-profile-item.is-dragging');
          if (dragging && dragging !== item) {
            item.classList.add('drag-over');
          }
        });

        item.addEventListener('dragleave', (e) => {
          // Only remove drag-over if we're actually leaving the item
          if (!item.contains(e.relatedTarget)) {
            item.classList.remove('drag-over');
          }
        });

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          item.classList.remove('drag-over');
          const draggedId = e.dataTransfer.getData('text/plain');
          const targetId = profile.id;

          if (draggedId !== targetId) {
            reorderProfiles(draggedId, targetId);
          }
        });
      }

      listEl.appendChild(item);
    }
  }

  // Render editor panel
  if (editingShellProfile) {
    editorEl.appendChild(createModalShellProfileEditor());
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'shell-profiles-editor-placeholder';
    placeholder.textContent = 'Select a profile or create a new one';
    editorEl.appendChild(placeholder);
  }
}

// ---------------------------------------------------------------------------
// Layouts modal (Layout Manager) - mirrors Shell Profiles modal pattern
// ---------------------------------------------------------------------------
function openLayoutsModal() {
  // Load existing layouts from bridge
  bridge.listLayouts()
    .then((config) => {
      layouts = config.layouts ?? [];
      defaultLayoutId = config.defaultLayoutId ?? '';
    })
    .catch(reportError)
    .finally(() => {
      const overlay = document.createElement('div');
      overlay.className = 'settings-modal-overlay';

      overlay.innerHTML = `
        <div class="settings-modal layouts-modal">
          <div class="settings-modal-header">
            <div class="settings-modal-title-group">
              <span>Layouts</span>
              <button type="button" class="layouts-add-btn" id="modal-layout-add" aria-label="Add Layout">+</button>
            </div>
            <button type="button" class="settings-modal-close" aria-label="Close">×</button>
          </div>
          <div class="settings-modal-body layouts-modal-body">
            <div class="layouts-sidebar">
              <div class="layout-list" id="modal-layout-list"></div>
            </div>
            <div class="layouts-editor-panel" id="modal-layout-editor">
              <div class="layouts-editor-placeholder">Select a layout or create a new one</div>
            </div>
          </div>
        </div>
      `;

      const closeModal = () => {
        // Clear the polling timer when modal closes
        if (layoutModalPollTimer) {
          clearInterval(layoutModalPollTimer);
          layoutModalPollTimer = null;
        }
        overlay.remove();
        selectedLayoutId = null;
      };

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });

      overlay.querySelector('.settings-modal-close').addEventListener('click', closeModal);

      // Add Layout button — inserts inline input at top of list
      overlay.querySelector('#modal-layout-add').addEventListener('click', () => {
        const listEl = overlay._modalLayoutList;
        if (!listEl) return;

        // Remove any existing inline input
        const existing = listEl.querySelector('.layout-item.is-editing');
        if (existing) existing.remove();

        const item = document.createElement('div');
        item.className = 'layout-item is-editing';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'layout-name-input';
        input.placeholder = 'Layout name';

        const cleanup = () => {
          item.remove();
        };

        const confirm = () => {
          const trimmed = input.value.trim();
          cleanup();
          if (!trimmed) return;
          const layout = createLayoutFromCurrentWindow(trimmed.toLowerCase().replace(/\s+/g, '-'), trimmed);
          bridge.saveLayout(layout)
            .then(() => bridge.listLayouts())
            .then((config) => {
              layouts = config.layouts ?? [];
              defaultLayoutId = config.defaultLayoutId ?? '';
              setWindowLayoutId(layout.id);
              updateLayoutsIndicator();
              renderModalLayouts(overlay);
            })
            .catch(reportError);
        };

        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            confirm();
          }
          if (event.key === 'Escape') {
            cleanup();
          }
        });

        input.addEventListener('blur', confirm);

        item.appendChild(input);
        listEl.insertBefore(item, listEl.firstChild);

        queueMicrotask(() => {
          input.focus();
        });
      });

      document.body.appendChild(overlay);

      // Store references for rendering
      overlay._modalLayoutList = overlay.querySelector('#modal-layout-list');
      overlay._modalLayoutEditor = overlay.querySelector('#modal-layout-editor');

      // initial render
      renderModalLayouts(overlay);

      // Start polling for layout updates
      layoutModalPollTimer = setInterval(async () => {
        try {
          const config = await bridge.listLayouts();
          const newLayouts = config.layouts ?? [];
          const newDefaultLayoutId = config.defaultLayoutId ?? '';

          // Check if layouts have changed (compare IDs and names)
          const layoutsChanged =
            newLayouts.length !== layouts.length ||
            newDefaultLayoutId !== defaultLayoutId ||
            newLayouts.some((newLayout) => {
              const existing = layouts.find((l) => l.id === newLayout.id);
              if (!existing) return true;
              // Check if name or panes have changed
              return existing.name !== newLayout.name ||
                     JSON.stringify(existing.panes) !== JSON.stringify(newLayout.panes);
            }) ||
            layouts.some((existing) => !newLayouts.find((l) => l.id === existing.id));

          if (layoutsChanged) {
            layouts = newLayouts;
            defaultLayoutId = newDefaultLayoutId;
            updateLayoutsIndicator();
            renderModalLayouts(overlay);
          }
        } catch (err) {
          // Silently ignore polling errors to avoid disrupting the UI
          console.error('Layout modal poll error:', err);
        }
      }, LAYOUT_MODAL_POLL_INTERVAL);
    });
}

function renderModalLayouts(overlay) {
  const listEl = overlay?._modalLayoutList ?? document.querySelector('.settings-modal-overlay')?.querySelector('#modal-layout-list');
  const editorEl = overlay?._modalLayoutEditor ?? document.querySelector('.settings-modal-overlay')?.querySelector('#modal-layout-editor');
  if (!listEl || !editorEl) return;

  listEl.replaceChildren();
  editorEl.replaceChildren();

  // Left column: layout list
  if (layouts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'layout-empty';
    empty.textContent = 'No layouts saved';
    listEl.appendChild(empty);
  } else {
    for (const layout of layouts) {
      const isActive = layout.id === windowLayoutId;
      const isDefault = layout.id === defaultLayoutId;
      const isSelected = layout.id === selectedLayoutId;
      const item = document.createElement('div');
      item.className = `layout-item${isActive ? ' is-active' : ''}${isDefault ? ' is-default' : ''}${isSelected ? ' is-selected' : ''}`;
      item.dataset.layoutId = layout.id;

      let nameEl;
      if (renamingLayoutId === layout.id) {
        nameEl = document.createElement('input');
        nameEl.type = 'text';
        nameEl.className = 'layout-name layout-name-input';
        nameEl.value = layout.name || layout.id;
        nameEl.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        nameEl.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        nameEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            const newName = nameEl.value.trim();
            renamingLayoutId = null;
            if (newName) {
              bridge.renameLayout(layout.id, newName)
                .then(() => bridge.listLayouts())
                .then((config) => {
                  layouts = config.layouts ?? [];
                  defaultLayoutId = config.defaultLayoutId ?? '';
                  updateLayoutsIndicator();
                  renderModalLayouts(overlay);
                })
                .catch(reportError);
            } else {
              renderModalLayouts(overlay);
            }
          }
          if (event.key === 'Escape') {
            renamingLayoutId = null;
            renderModalLayouts(overlay);
          }
        });
        nameEl.addEventListener('blur', () => {
          const newName = nameEl.value.trim();
          renamingLayoutId = null;
          if (newName) {
            bridge.renameLayout(layout.id, newName)
              .then(() => bridge.listLayouts())
              .then((config) => {
                layouts = config.layouts ?? [];
                defaultLayoutId = config.defaultLayoutId ?? '';
                updateLayoutsIndicator();
                renderModalLayouts(overlay);
              })
              .catch(reportError);
          } else {
            renderModalLayouts(overlay);
          }
        });
      } else {
        nameEl = document.createElement('div');
        nameEl.className = 'layout-name';
        const nameText = layout.name || layout.id;
        nameEl.textContent = isDefault ? `★ ${nameText}` : nameText;
      }

      const info = document.createElement('div');
      info.className = 'layout-pane-count';
      const panesCount = (layout.panes?.length) ?? 0;
      info.textContent = `${panesCount} pane${panesCount === 1 ? '' : 's'}`;

      const actions = document.createElement('div');
      actions.className = 'layout-actions';

      // "Open in New Window" button (fallback to switchLayout until Sub-4 is complete)
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'settings-btn';
      switchBtn.textContent = '⎆';
      switchBtn.title = 'Open in new window';
      switchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bridge.openLayoutWindow(layout.id).catch(reportError);
        overlay?.remove();
      });
      actions.appendChild(switchBtn);

      // Rename button
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'settings-btn';
      renameBtn.textContent = '✎';
      renameBtn.title = 'Rename layout';
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        renamingLayoutId = layout.id;
        renderModalLayouts(overlay);
        // Focus the input after re-render
        queueMicrotask(() => {
          const input = listEl.querySelector(`.layout-item[data-layout-id="${layout.id}"] .layout-name-input`);
          if (input) {
            input.focus();
            input.select();
          }
        });
      });
      actions.appendChild(renameBtn);

      // Delete button (not allowed for default)
      if (layout.id !== 'default' && layout.id !== windowLayoutId) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'settings-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Delete layout';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedLayoutId === layout.id) selectedLayoutId = null;
          deleteLayoutById(layout.id)
            .then(() => renderModalLayouts(overlay))
            .catch(reportError);
        });
        actions.appendChild(deleteBtn);
      }

      // Active layout checkmark (positioned on the right)
      const checkmark = document.createElement('span');
      checkmark.className = 'layout-item-check';
      checkmark.textContent = isActive ? '✓' : '';

      item.append(nameEl, info, actions, checkmark);

      // Click selects layout (without triggering actions)
      item.addEventListener('click', (e) => {
        if (e.target.closest('.layout-actions')) return;
        selectedLayoutId = layout.id;
        renderModalLayouts(overlay);
      });

      listEl.appendChild(item);
    }
  }

  // Right column: editor/info panel
  const selected = layouts.find((l) => l.id === selectedLayoutId) || null;
  if (selected) {
    const info = document.createElement('div');
    info.className = 'layout-info';

    // Name row: input + confirm + cancel
    const nameRow = document.createElement('div');
    nameRow.className = 'layout-name-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'layout-name-input';
    nameInput.value = selected.name || '';
    const originalName = selected.name || '';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'settings-btn layout-name-btn layout-name-btn-confirm';
    confirmBtn.textContent = '✓';
    confirmBtn.title = 'Confirm (Enter)';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'settings-btn layout-name-btn layout-name-btn-cancel';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Cancel (Esc)';

    const doSave = () => {
      const newName = nameInput.value.trim();
      if (!newName) return;
      bridge.renameLayout(selected.id, newName)
        .then(() => bridge.listLayouts())
        .then((config) => {
          layouts = config.layouts ?? [];
          defaultLayoutId = config.defaultLayoutId ?? defaultLayoutId;
          updateLayoutsIndicator();
          renderModalLayouts(overlay);
        })
        .catch(reportError);
    };

    const doCancel = () => {
      nameInput.value = originalName;
    };

    confirmBtn.addEventListener('click', doSave);
    cancelBtn.addEventListener('click', doCancel);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    });

    nameRow.appendChild(nameInput);
    nameRow.appendChild(confirmBtn);
    nameRow.appendChild(cancelBtn);
    info.appendChild(nameRow);

    // Set as Default row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'layout-info-actions';

    // "Set as Default" button — uses dedicated backend command for proper validation
    const isDefault = selected.id === defaultLayoutId;
    const setDefaultBtn = document.createElement('button');
    setDefaultBtn.type = 'button';
    setDefaultBtn.className = 'settings-btn layout-info-btn';
    setDefaultBtn.textContent = isDefault ? '✓ Default' : 'Set as Default';
    setDefaultBtn.disabled = isDefault;
    setDefaultBtn.title = isDefault ? 'This is the default layout' : 'Set this layout to restore on startup';
    setDefaultBtn.addEventListener('click', () => {
      bridge.setLayoutAsDefault(selected.id)
        .then((config) => {
          defaultLayoutId = config.defaultLayoutId ?? selected.id;
          renderModalLayouts(overlay);
        })
        .catch(reportError);
    });
    actionsRow.appendChild(setDefaultBtn);

    // Open in New Window button
    const openInNewWindowBtn = document.createElement('button');
    openInNewWindowBtn.type = 'button';
    openInNewWindowBtn.className = 'settings-btn layout-info-btn';
    openInNewWindowBtn.textContent = 'Open in New Window';
    openInNewWindowBtn.addEventListener('click', async () => {
      await bridge.openLayoutInNewWindow(selected.id).catch(reportError);
      overlay?.remove();
    });
    actionsRow.appendChild(openInNewWindowBtn);
    info.appendChild(actionsRow);

    // Pane count and details
    const panesCount = selected.panes?.length ?? 0;
    const paneCountLabel = document.createElement('div');
    paneCountLabel.className = 'layout-pane-count-label';
    paneCountLabel.textContent = `Panes (${panesCount})`;
    info.appendChild(paneCountLabel);

    // Pane details list
    const panesList = document.createElement('div');
    panesList.className = 'layout-panes-list';
    for (const pane of selected.panes ?? []) {
      const paneItem = document.createElement('div');
      paneItem.className = 'layout-pane-item';

      const paneTitle = document.createElement('div');
      paneTitle.className = 'layout-pane-title';
      paneTitle.textContent = pane.title || 'Untitled';
      paneItem.appendChild(paneTitle);

      const paneDetails = document.createElement('div');
      paneDetails.className = 'layout-pane-details';

      const paneCwd = document.createElement('span');
      paneCwd.className = 'layout-pane-cwd';
      // Shorten home directory path
      const shortCwd = pane.cwd?.replace(/^\/home\/[^\/]+/, '~') ?? pane.cwd ?? 'unknown';
      paneCwd.textContent = shortCwd;
      paneDetails.appendChild(paneCwd);

      if (pane.shellProfileId) {
        const profile = shellProfiles.find((p) => p.id === pane.shellProfileId);
        if (profile) {
          const paneProfile = document.createElement('span');
          paneProfile.className = 'layout-pane-profile';
          paneProfile.textContent = `(${profile.name || profile.id})`;
          paneDetails.appendChild(paneProfile);
        }
      }

      paneItem.appendChild(paneDetails);
      panesList.appendChild(paneItem);
    }
    info.appendChild(panesList);

    editorEl.appendChild(info);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'layouts-editor-placeholder';
    placeholder.textContent = 'Select a layout or create a new one';
    editorEl.appendChild(placeholder);
  }
}

function cloneProfile(profile) {
  const clonedProfile = {
    id: `${profile.id}-copy-${Date.now()}`,
    name: `${profile.name || profile.id} (副本)`,
    command: profile.command,
    args: profile.args ? [...profile.args] : [],
  };

  bridge.addShellProfile(clonedProfile).then((config) => {
    const userIds = new Set((config.profiles ?? []).map((p) => p.id));
    shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
    defaultShellProfileId = config.defaultProfile ?? '';

    // Enter edit mode with the cloned profile (same as New Profile but with content filled in)
    selectedShellProfileId = clonedProfile.id;
    editingShellProfile = {
      id: clonedProfile.id,
      name: clonedProfile.name,
      command: clonedProfile.command,
      args: formatArgs(clonedProfile.args ?? []),
      isNew: true // Treat as new so user can edit the ID
    };
    renderModalShellProfiles();
  }).catch(reportError);
}

function reorderProfiles(draggedId, targetId) {
  const draggedIndex = shellProfiles.findIndex(p => p.id === draggedId);
  const targetIndex = shellProfiles.findIndex(p => p.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  // Remove dragged profile and insert at target position
  const [draggedProfile] = shellProfiles.splice(draggedIndex, 1);
  shellProfiles.splice(targetIndex, 0, draggedProfile);

  // Save the new order (add all profiles to persist order)
  const userProfiles = shellProfiles.filter(p => !detectedShellProfiles.some(dp => dp.id === p.id));
  const savePromises = userProfiles.map(p => bridge.addShellProfile(p));

  Promise.all(savePromises).then(() => {
    renderModalShellProfiles();
  }).catch(reportError);
}

function createModalShellProfileEditor() {
  const editor = document.createElement('div');
  editor.className = 'shell-profile-editor';

  const fields = [
    { key: 'name', label: 'Name (optional)', placeholder: 'e.g. Zsh' },
    { key: 'id', label: 'ID', placeholder: 'e.g. zsh' },
    { key: 'command', label: 'Command', placeholder: '/bin/zsh' },
    { key: 'args', label: 'Arguments', placeholder: '-il' },
  ];

  const inputs = {};
  for (const field of fields) {
    const label = document.createElement('label');
    label.textContent = field.label;
    label.setAttribute('for', `modal-shell-edit-${field.key}`);

    const input = document.createElement('input');
    input.id = `modal-shell-edit-${field.key}`;
    input.type = 'text';
    input.value = editingShellProfile[field.key] ?? '';
    input.placeholder = field.placeholder;
    input.dataset.field = field.key;
    inputs[field.key] = input;

    if (field.key === 'name' && editingShellProfile.isNew) {
      input.addEventListener('input', () => {
        const idInput = inputs.id;
        if (!idInput.value && input.value.trim()) {
          idInput.value = input.value.trim().toLowerCase().replace(/\s+/g, '-');
        }
      });
    }

    editor.append(label, input);
  }

  const actions = document.createElement('div');
  actions.className = 'shell-profile-editor-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'settings-btn shell-profile-editor-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    editingShellProfile = null;
    selectedShellProfileId = null;
    renderModalShellProfiles();
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'settings-btn shell-profile-editor-btn is-primary';
  save.textContent = 'Save';
  save.addEventListener('click', () => {
    const profile = {
      id: inputs.id.value.trim(),
      name: inputs.name.value.trim(),
      command: inputs.command.value.trim(),
      args: splitArgs(inputs.args.value.trim()),
    };

    if (!profile.id || !profile.command) {
      reportError(new Error('ID and Command are required'));
      return;
    }

    bridge.addShellProfile(profile).then((config) => {
      const userIds = new Set((config.profiles ?? []).map((p) => p.id));
      shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
      defaultShellProfileId = config.defaultProfile ?? '';

      // Select the newly created/saved profile
      selectedShellProfileId = profile.id;
      editingShellProfile = {
        id: profile.id,
        name: profile.name,
        command: profile.command,
        args: formatArgs(profile.args),
        isNew: false
      };
      renderModalShellProfiles();
    }).catch(reportError);
  });

  actions.append(cancel, save);
  editor.appendChild(actions);

  queueMicrotask(() => {
    const firstInput = editor.querySelector('input');
    if (firstInput) {
      firstInput.focus();
      firstInput.select();
    }
  });

  return editor;
}

function createTerminalTheme(accent) {
  return {
    background: '#11111100',
    foreground: '#d9d4c7',
    cursor: accent,
    cursorAccent: '#111111',
    selectionBackground: `${accent}44`,
    black: '#111111',
    red: '#ff6b57',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#d9d4c7',
    brightBlack: '#5a6374',
    brightRed: '#ff8578',
    brightGreen: '#b0d98b',
    brightYellow: '#f0d58a',
    brightBlue: '#7eb7ff',
    brightMagenta: '#d9a5e8',
    brightCyan: '#7fd8e6',
    brightWhite: '#ffffff',
  };
}

function isLinkOpenModifierPressed(event) {
  return event.ctrlKey || (bridge.platform === 'darwin' && event.metaKey);
}

function handleTerminalLinkActivation(event, uri) {
  if (!isLinkOpenModifierPressed(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void bridge.openExternalUrl(uri).catch(reportError);
}

function getFocusedIndex() {
  const focusedIndex = panes.findIndex((pane) => pane.id === focusedPaneId);
  if (focusedIndex !== -1) {
    return focusedIndex;
  }

  focusedPaneId = panes[0]?.id ?? null;
  return panes.length > 0 ? 0 : -1;
}

function getPaneLeft(index, previewWidth, focusedIndex) {
  if (previewWidth >= settings.paneWidth) {
    return index * settings.paneWidth;
  }

  const focusedLeft = focusedIndex * previewWidth;

  if (index < focusedIndex) {
    return index * previewWidth;
  }

  if (index === focusedIndex) {
    return focusedLeft;
  }

  return focusedLeft + settings.paneWidth + (index - focusedIndex - 1) * previewWidth;
}

function getTextColorForBackground(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

function createTab(pane, index, focusedIndex, dragMeta) {
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
    void showTabContextMenu(pane.id, event);
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
  if (currentMode === 'nav') {
    swatch.textContent = String(index + 1);
    // Apply text color based on accent color brightness
    swatch.style.setProperty('--swatch-text-color', 'var(--tab-text-color)');
  }

  let label;
  if (renamingPaneId === pane.id) {
    label = document.createElement('input');
    label.className = 'tab-input';
    label.type = 'text';
    label.value = getPaneLabel(pane);
    label.setAttribute('aria-label', `Rename tab ${pane.id}`);
    label.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    label.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        commitRenamePane(pane.id, label.value);
      }

      if (event.key === 'Escape') {
        cancelRenamePane();
      }
    });
    label.addEventListener('blur', () => {
      commitRenamePane(pane.id, label.value);
    });
    queueMicrotask(() => {
      label.focus();
      label.select();
    });
  } else {
    label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = getPaneLabel(pane);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.textContent = 'x';
  close.setAttribute('aria-label', `Close tab ${pane.id}`);
  close.disabled = panes.length === 1;

  // Show pending close state
  if (pendingClosePaneId === pane.id) {
    close.classList.add('pending-close');
    close.textContent = '?';
  }

  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closePane(index);
  });

  tabMain.append(swatch, label);
  tab.append(tabMain, close);
  return tab;
}

function createPane(pane) {
  const paneEl = document.createElement('article');
  paneEl.className = 'pane';
  const accentColor = pane.customColor || pane.accent;
  paneEl.style.setProperty('--pane-accent', accentColor);
  paneEl.addEventListener('click', () => {
    focusPane(pane.id);
  });

  const shell = document.createElement('div');
  shell.className = 'pane-shell';

  const body = document.createElement('div');
  body.className = 'pane-body';

  const surface = document.createElement('div');
  surface.className = 'pane-surface';

  const terminalHost = document.createElement('div');
  terminalHost.className = 'terminal-host';
  surface.append(terminalHost);
  body.append(surface);
  paneAlert.attach(paneEl, body);
  shell.append(body);
  paneEl.append(shell);

  const terminal = new Terminal({
    allowProposedApi: true,
    allowTransparency: true,
    convertEol: false,
    customGlyphs: true,
    cursorBlink: true,
    disableStdin: false,
    drawBoldTextInBrightColors: false,
    fontFamily: settings.fontFamily || getDefaultFontFamily(bridge.platform),
    fontSize: settings.fontSize,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: createTerminalTheme(accentColor),
  });
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon(handleTerminalLinkActivation);
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  // Unicode 11 width tables align xterm.js's wcwidth with what modern CLI
  // apps (Node.js / Ink-based UIs like Claude Code) assume, so CJK
  // characters reliably consume two cells instead of drifting between one
  // and two when an app redraws after IME input.
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  terminal.open(terminalHost);
  try { terminal.loadAddon(new WebglAddon()); } catch {}
  terminal.attachCustomKeyEventHandler((event) => {
    // Ctrl+Tab is reserved for pane MRU cycling — never let xterm forward
    // the literal Tab keystroke to the PTY.
    if (
      event.type === 'keydown' &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.code === 'Tab'
    ) {
      return false;
    }
    // Ctrl+Shift+C/V are reserved for copy/paste — handled by the
    // window-level shortcut handler. Returning false here prevents xterm
    // from consuming the event so it can bubble up and preventDefault()
    // runs before the WebView intercepts it for DevTools/Carets.
    if (
      event.type === 'keydown' &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'C' || event.key === 'c' || event.key === 'V' || event.key === 'v')
    ) {
      return false;
    }
    // Ctrl+ArrowLeft/Right are reserved for spatial pane navigation (VIB-71).
    // In WSL+zsh these send CSI sequences that xterm would forward to the PTY
    // as literal characters (e.g. 5D). Returning false stops xterm from
    // consuming the event so it reaches the window-level dispatcher.
    if (
      event.type === 'keydown' &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.code === 'ArrowLeft' || event.code === 'ArrowRight')
    ) {
      return false;
    }
    if (!isWindowsCtrlVPasteHotkey(event)) {
      return true;
    }
    return false;
  });

  const node = {
    paneId: pane.id,
    cwd: pane.cwd,
    root: paneEl,
    terminalHost,
    terminal,
    fitAddon,
    sessionReady: false,
    sizeKey: '',
    needsFit: true,
    accent: pane.accent,
  };

  terminalHost.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    focusPane(node.paneId, { focusTerminal: false });
    void showTerminalContextMenu(node, event);
  });

  terminal.onData((data) => {
    if (node.sessionReady) {
      bridge.writeTerminal({ paneId: node.paneId, data });
    }
  });

  terminal.onTitleChange((nextTitle) => {
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) {
      return;
    }
    panes = panes.map((entry) =>
      entry.id === pane.id ? { ...entry, terminalTitle: trimmedTitle } : entry
    );
    if (entryNeedsTabRefresh(pane.id)) {
      renderTabs();
    }
  });

  terminal.onSelectionChange(() => {
    const selection = terminal.getSelection();
    if (selection) {
      bridge.writeClipboardText(selection);
    }
  });

  terminal.parser.registerOscHandler(52, (data) => {
    const semicolon = data.indexOf(';');
    if (semicolon === -1) {
      return true;
    }
    const base64Text = data.slice(semicolon + 1);
    if (!base64Text || base64Text === '?') {
      return true;
    }
    try {
      const bytes = atob(base64Text);
      const text = new TextDecoder().decode(
        Uint8Array.from(bytes, (c) => c.charCodeAt(0))
      );
      bridge.writeClipboardText(text);
    } catch {}
    return true;
  });

  // OSC 7 handler for cwd tracking. Shells that support OSC 7 emit the
  // current working directory in the format \x1b]7;file://hostname/path\x07.
  // This allows us to track directory changes and persist them for session restore.
  terminal.parser.registerOscHandler(7, (data) => {
    const newCwd = extractPathFromOsc7(data);
    if (newCwd) {
      onPaneCwdChanged(pane.id, newCwd);
    }
    return true;
  });

  return node;
}

function entryNeedsTabRefresh(paneId) {
  const pane = panes.find((entry) => entry.id === paneId);
  return Boolean(pane && pane.title === null);
}

function fitTerminal(node, force = false) {
  node.terminal.options.fontSize = settings.fontSize;
  node.terminal.options.fontFamily = settings.fontFamily || getDefaultFontFamily(bridge.platform);
  node.fitAddon.fit();

  const cols = Math.max(20, node.terminal.cols || 80);
  const rows = Math.max(8, node.terminal.rows || 24);
  const nextSizeKey = `${cols}x${rows}`;

  if (node.sessionReady && (force || nextSizeKey !== node.sizeKey)) {
    bridge.resizeTerminal({
      paneId: node.paneId,
      cols,
      rows,
    });
    // SIGWINCH on the PTY usually triggers a screen redraw — those bytes
    // would otherwise look like background activity and trip the alert.
    paneActivityWatcher.noteResize(node.paneId);
  }

  node.sizeKey = nextSizeKey;
  node.needsFit = false;
}

async function initializePaneTerminal(node) {
  fitTerminal(node, true);
  const pane = panes.find((p) => p.id === node.paneId);
  const profileId = pane?.shellProfileId ?? null;
  try {
    await bridge.createTerminal({
      paneId: node.paneId,
      cols: node.terminal.cols,
      rows: node.terminal.rows,
      cwd: node.cwd,
      shellProfileId: profileId,
    });
    node.sessionReady = true;
    fitTerminal(node, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    node.terminal.writeln(`\x1b[38;5;204mFailed to start shell${profileId ? ` "${profileId}"` : ''}: ${message}\x1b[0m`);
  }
}

function ensurePaneNodes() {
  const activeIds = new Set(panes.map((pane) => pane.id));

  for (const [paneId, node] of paneNodeMap.entries()) {
    if (!activeIds.has(paneId)) {
      paneActivityWatcher.forget(paneId);
      bridge.destroyTerminal({ paneId });
      node.terminal.dispose();
      node.root.remove();
      paneNodeMap.delete(paneId);
    }
  }

  for (const pane of panes) {
    if (!paneNodeMap.has(pane.id)) {
      const node = createPane(pane);
      paneNodeMap.set(pane.id, node);
      stageEl.append(node.root);
      paneActivityWatcher.setPaneEnabled(pane.id, pane.breathingMonitor !== false);
      requestAnimationFrame(() => {
        initializePaneTerminal(node);
      });
    }
  }
}

function createPaneData(shellProfileId = null) {
  const usedAccents = new Set(panes.map((p) => p.accent.toLowerCase()));
  const accent = ColorsRegistry.ACCENT_PALETTE.find((c) => !usedAccents.has(c.toLowerCase()))
    || ColorsRegistry.ACCENT_PALETTE[(nextPaneNumber - 1) % ColorsRegistry.ACCENT_PALETTE.length];
  const focusedPane = panes[getFocusedIndex()];
  const pane = {
    id: `p${nextPaneNumber}`,
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: focusedPane?.cwd || bridge.defaultCwd,
    accent,
    shellProfileId: shellProfileId ?? null,
  };

  nextPaneNumber += 1;
  return pane;
}

// Move `paneId` to the front of the MRU stack. Called when a pane is "really"
// visited (clicked, navigation Enter, new pane, etc.) — not while previewing
// in navigation mode and not while a cycle is in progress.
function recordPaneVisit(paneId) {
  if (!paneId) {
    return;
  }
  if (paneMruOrder[0] === paneId) {
    return;
  }
  paneMruOrder = [paneId, ...paneMruOrder.filter((id) => id !== paneId)];
}

// Drop dead pane IDs and append any new ones that snuck in. Keeps the MRU
// invariant (one entry per current pane) without reshuffling the order.
function syncPaneMruOrder() {
  const known = new Set(panes.map((pane) => pane.id));
  paneMruOrder = paneMruOrder.filter((id) => known.has(id));
  for (const pane of panes) {
    if (!paneMruOrder.includes(pane.id)) {
      paneMruOrder.push(pane.id);
    }
  }
}

function focusPane(paneId, options = {}) {
  const { focusTerminal = true } = options;
  paneCycleState = null;
  focusedPaneId = paneId;
  setMode('terminal');
  recordPaneVisit(paneId);
  render();
  const node = paneNodeMap.get(paneId);
  if (node && focusTerminal) {
    requestAnimationFrame(() => {
      node.terminal.focus();
    });
  }
}

function refocusCurrentPaneTerminal() {
  const node = paneNodeMap.get(focusedPaneId);
  if (!node) return;
  paneCycleState = null;
  setMode('terminal');
  requestAnimationFrame(() => {
    node.terminal.focus();
  });
}

function getLayoutDisplayName(layoutId) {
  if (!layoutId) return 'Layout';
  const layout = layouts.find((item) => item.id === layoutId);
  return layout?.name || (layoutId === 'default' ? 'Default' : layoutId);
}

function getFocusedPaneAccent() {
  const pane = panes[getFocusedIndex()];
  return pane?.customColor || pane?.accent || '#ffd166';
}

function showLayoutFocusNotice(layoutId) {
  const layoutName = getLayoutDisplayName(layoutId);
  layoutFocusNotice = { layoutId };
  document.body.style.setProperty('--layout-focus-accent', getFocusedPaneAccent());
  document.body.dataset.layoutFocusName = layoutName;
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

function addPane(shellProfileId = null) {
  const newPane = createPaneData(shellProfileId);
  paneCycleState = null;
  panes = [...panes, newPane];
  focusedPaneId = newPane.id;
  recordPaneVisit(newPane.id);
  render(true);
}

function closePane(index, options = {}) {
  const { destroyTerminal = true } = options;

  if (panes.length === 1) {
    return;
  }

  const closingPane = panes[index];
  if (!closingPane) {
    return;
  }

  if (closingPane.id === renamingPaneId) {
    renamingPaneId = null;
  }

  if (closingPane.id === dragState?.paneId) {
    endTabDrag();
  }

  if (closingPane.id === pendingTabFocus?.paneId) {
    clearPendingTabFocus();
  }

  if (destroyTerminal) {
    bridge.destroyTerminal({ paneId: closingPane.id });
  }

  const remainingPanes = panes.filter((_, paneIndex) => paneIndex !== index);
  if (closingPane.id === focusedPaneId) {
    const fallbackIndex = Math.max(0, index - 1);
    focusedPaneId = remainingPanes[fallbackIndex]?.id ?? remainingPanes[0]?.id ?? null;
  }
  panes = remainingPanes;
  paneCycleState = null;
  paneMruOrder = paneMruOrder.filter((id) => id !== closingPane.id);
  recordPaneVisit(focusedPaneId);

  render(true);
}

function beginRenamePane(index) {
  const pane = panes[index];
  if (!pane) {
    return;
  }

  clearPendingTabFocus();
  renamingPaneId = pane.id;
  try {
    render();
  } catch (error) {
    renamingPaneId = null;
    reportError(error);
  }
}

function cancelRenamePane() {
  renamingPaneId = null;
  try {
    render();
  } catch (error) {
    reportError(error);
  }
}

function commitRenamePane(paneId, nextTitle) {
  const trimmedTitle = nextTitle.trim();
  renamingPaneId = null;

  panes = panes.map((entry) =>
    entry.id === paneId ? { ...entry, title: trimmedTitle || null } : entry
  );

  // Return focus to the renamed pane's terminal
  focusPane(paneId, { focusTerminal: true });
}

function clearPendingTabFocus() {
  if (!pendingTabFocus) {
    return;
  }

  window.clearTimeout(pendingTabFocus.timerId);
  pendingTabFocus = null;
}

function scheduleTabFocus(paneId) {
  clearPendingTabFocus();
  pendingTabFocus = {
    paneId,
    timerId: window.setTimeout(() => {
      pendingTabFocus = null;
      focusPane(paneId);
    }, 180),
  };
}

function activateTabPointerUp(paneId) {
  if (pendingTabFocus?.paneId === paneId) {
    clearPendingTabFocus();
    const paneIndex = panes.findIndex((pane) => pane.id === paneId);
    if (paneIndex !== -1) {
      beginRenamePane(paneIndex);
    }
    return;
  }

  scheduleTabFocus(paneId);
}

function beginTabDrag(index, event) {
  if (event.button !== 0 || renamingPaneId !== null) {
    return;
  }

  const pane = panes[index];
  if (!pane) {
    return;
  }

  event.preventDefault();
  dragState = {
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

function handleTabPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  dragState.currentX = event.clientX;
  const offsetX = dragState.currentX - dragState.startX;
  const hasMoved = Math.abs(offsetX) > 4;

  if (!hasMoved && !dragState.hasMoved) {
    return;
  }

  dragState.hasMoved = true;
  dragState.dropIndex = getTabDropIndex(event.clientX);
  renderTabs();
}

function handleTabPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const { paneId, dropIndex, hasMoved } = dragState;
  endTabDrag();

  if (!hasMoved) {
    activateTabPointerUp(paneId);
    return;
  }

  const pane = panes.find((entry) => entry.id === paneId);
  const nextPanes = panes.filter((entry) => entry.id !== paneId);
  const insertionIndex = Math.max(0, Math.min(dropIndex, nextPanes.length));
  nextPanes.splice(insertionIndex, 0, pane);
  panes = nextPanes;
  render();
}

function endTabDrag() {
  dragState = null;
  document.body.classList.remove('is-dragging-tabs');
  window.removeEventListener('pointermove', handleTabPointerMove);
  window.removeEventListener('pointerup', handleTabPointerUp);
  window.removeEventListener('pointercancel', handleTabPointerUp);
}

function getTabDropIndex(clientX) {
  const tabElements = [...tabsListEl.querySelectorAll('.tab')].filter(
    (tab) => tab.dataset.paneId !== dragState?.paneId
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

function renderTabs() {
  if (isRenderingTabs) {
    return;
  }
  isRenderingTabs = true;
  const focusedIndex = getFocusedIndex();
  const draggedPaneId = dragState?.paneId ?? null;
  let slot = 0;

  tabsListEl.replaceChildren(
    ...panes.map((pane, index) => {
      const isDragging = pane.id === draggedPaneId && dragState?.hasMoved;
      const insertBefore = !isDragging && dragState?.hasMoved && dragState.dropIndex === slot;
      const dragMeta = {
        isDragging,
        insertBefore,
        offsetX: isDragging ? dragState.currentX - dragState.startX : 0,
      };
      if (!isDragging) {
        slot += 1;
      }
      return createTab(pane, index, focusedIndex, dragMeta);
    })
  );
  isRenderingTabs = false;
}

function renderPanes(refit = false) {
  const stageWidth = stageEl.clientWidth;
  const stageHeight = stageEl.clientHeight;
  const previewWidth = getPreviewWidth(stageWidth, panes.length);
  const focusedIndex = getFocusedIndex();

  ensurePaneNodes();
  paneActivityWatcher.setFocus(focusedPaneId);

  panes.forEach((pane, index) => {
    const node = paneNodeMap.get(pane.id);
    const left = getPaneLeft(index, previewWidth, focusedIndex);
    const isFocused = index === focusedIndex;
    const accentColor = pane.customColor || pane.accent;

    node.root.classList.toggle('is-focused', isFocused);
    node.root.classList.toggle('is-navigation-target', isFocused && currentMode === 'nav');
    node.root.style.setProperty('--pane-accent', accentColor);
    node.root.style.left = `${left}px`;
    node.root.style.zIndex = String(index + 1);
    node.root.style.height = `${stageHeight}px`;

    if (node.accent !== accentColor) {
      node.terminal.options.theme = createTerminalTheme(accentColor);
      node.accent = accentColor;
    }

    if (refit || node.needsFit) {
      fitTerminal(node, true);
    }
  });
}

function render(refit = false) {
  renderTabs();
  renderPanes(refit);
  updateStatus();
  if (layoutRestoreComplete) {
    scheduleWindowLayoutSave();
  }
}

function moveFocus(delta) {
  if (panes.length === 0) {
    return;
  }

  const focusedIndex = getFocusedIndex();
  const nextIndex = (focusedIndex + delta + panes.length) % panes.length;
  focusedPaneId = panes[nextIndex].id;
  render();
}

function navigateLeft() {
  if (panes.length === 0) {
    return;
  }

  const focusedIndex = getFocusedIndex();
  const nextIndex = focusedIndex - 1;

  if (nextIndex >= 0) {
    focusPane(panes[nextIndex].id);
  }
}

function navigateRight() {
  if (panes.length === 0) {
    return;
  }

  const focusedIndex = getFocusedIndex();
  const nextIndex = focusedIndex + 1;

  if (nextIndex < panes.length) {
    focusPane(panes[nextIndex].id);
  }
}

// Cycle to the previously-visited pane (similar to browser Ctrl+Tab).
// First press steps from current to MRU[1]; subsequent presses while the
// modifier is held step further back through the snapshot. Reverse cycles
// (Shift+Ctrl+`) walk the snapshot the other way. The cycle commits when
// the modifier is released (see commitPaneCycle).
function cycleToRecentPane({ reverse = false } = {}) {
  if (panes.length < 2) {
    return;
  }

  syncPaneMruOrder();

  if (!paneCycleState) {
    paneCycleState = { snapshot: [...paneMruOrder], index: 0 };
  }

  const { snapshot } = paneCycleState;
  if (snapshot.length < 2) {
    return;
  }

  const step = reverse ? -1 : 1;
  paneCycleState.index = (paneCycleState.index + step + snapshot.length) % snapshot.length;
  const targetId = snapshot[paneCycleState.index];

  if (!panes.some((pane) => pane.id === targetId)) {
    // Target pane was closed mid-cycle — recover by aborting.
    paneCycleState = null;
    return;
  }

  focusedPaneId = targetId;
  setMode('terminal');
  render();

  const node = paneNodeMap.get(targetId);
  if (node) {
    requestAnimationFrame(() => {
      node.terminal.focus();
    });
  }
}

// Promote the cycle's final pane to the front of the MRU stack.
// Called when the cycling modifier is released.
function commitPaneCycle() {
  if (!paneCycleState) {
    return;
  }
  paneCycleState = null;
  recordPaneVisit(focusedPaneId);
}

// Cycle focus through panes that have a breathing (activity) alert.
// Jumps to the first lit pane on first press, then cycles forward.
// Focusing a pane automatically clears its alert via paneActivityWatcher.
function cycleToNextLitPane() {
  const litIds = panes
    .map((p) => p.id)
    .filter((id) => paneNodeMap.get(id)?.root.classList.contains('has-pending-activity'));
  if (litIds.length === 0) {
    return;
  }
  const focusedIndex = litIds.indexOf(focusedPaneId);
  const nextIndex = focusedIndex >= 0 ? (focusedIndex + 1) % litIds.length : 0;
  focusPane(litIds[nextIndex]);
}

function isEditableTarget() {
  return (
    document.activeElement?.tagName === 'INPUT' ||
    document.activeElement?.classList?.contains('xterm-helper-textarea')
  );
}

function getPaneIndex(paneId) {
  return panes.findIndex((pane) => pane.id === paneId);
}

function getPaneNode(paneId) {
  return paneNodeMap.get(paneId) ?? null;
}

async function getClipboardSnapshot() {
  try {
    return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
  } catch {
    return { text: '', hasImage: false };
  }
}

function isWindowsCtrlVPasteHotkey(event) {
  return (
    bridge.platform === 'win32' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'v'
  );
}

function copyTerminalSelection(paneId = focusedPaneId) {
  const node = getPaneNode(paneId);
  if (!node) {
    return false;
  }

  const selection = node.terminal.getSelection();
  if (!selection) {
    return false;
  }

  bridge.writeClipboardText(selection);
  return true;
}

async function pasteIntoTerminal(paneId = focusedPaneId, options = {}) {
  const node = getPaneNode(paneId);
  if (!node?.sessionReady) {
    return false;
  }

  const text = options.clipboardSnapshot?.text ?? (await bridge.readClipboardText());
  if (!text) {
    return false;
  }

  if (bridge.platform === 'win32') {
    node.terminal.paste(text);
  } else {
    bridge.writeTerminal({ paneId: node.paneId, data: text });
  }
  return true;
}

function selectAllInTerminal(paneId = focusedPaneId) {
  const node = getPaneNode(paneId);
  if (!node) {
    return false;
  }

  node.terminal.selectAll();
  return true;
}

function showContextMenu(items, x, y, paneId) {
  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.disabled = item.disabled || false;

    const label = document.createElement('span');
    label.className = 'context-menu-label';
    label.textContent = item.label;
    row.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'context-menu-shortcut';
      shortcut.textContent = item.shortcut;
      row.appendChild(shortcut);
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      handleMenuAction(item.action, paneId);
    });

    if (item.children?.length) {
      row.classList.add('context-menu-parent');
      const submenu = document.createElement('div');
      submenu.className = 'context-menu-submenu';
      submenu.setAttribute('role', 'menu');
      for (const child of item.children) {
        const childRow = document.createElement('button');
        childRow.type = 'button';
        childRow.className = 'context-menu-item';
        childRow.setAttribute('role', 'menuitem');
        childRow.disabled = child.disabled || false;

        const childLabel = document.createElement('span');
        childLabel.className = 'context-menu-label';
        childLabel.textContent = child.label;
        childRow.appendChild(childLabel);

        if (child.isDefault) {
          const check = document.createElement('span');
          check.className = 'context-menu-shortcut';
          check.textContent = '★';
          childRow.appendChild(check);
        }

        childRow.addEventListener('click', (e) => {
          e.stopPropagation();
          hideContextMenu();
          handleMenuAction(child.action, paneId);
        });

        submenu.appendChild(childRow);
      }
      row.appendChild(submenu);
    }

    menu.appendChild(row);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    if (rect.right > winW) {
      menu.style.left = `${Math.max(0, x - rect.width)}px`;
    }
    if (rect.bottom > winH) {
      menu.style.top = `${Math.max(0, y - rect.height)}px`;
    }
  });

  queueMicrotask(() => {
    document.addEventListener('pointerdown', dismissContextMenuOnOutside);
    window.addEventListener('blur', hideContextMenu);
  });
}

function hideContextMenu() {
  const menu = document.querySelector('.context-menu');
  if (menu) {
    menu.remove();
  }
  document.removeEventListener('pointerdown', dismissContextMenuOnOutside);
  window.removeEventListener('blur', hideContextMenu);
}

function dismissContextMenuOnOutside(event) {
  if (!event.target.closest('.context-menu')) {
    hideContextMenu();
  }
}

async function showTerminalContextMenu(node, event) {
  const clipboardSnapshot = await getClipboardSnapshot();

  const shellChildren = shellProfiles.map((p) => ({
    label: p.name || p.id,
    action: `terminal-change-shell:${p.id}`,
    isDefault: p.id === defaultShellProfileId,
  }));

  const pane = panes[getPaneIndex(node.paneId)];
  const breathingOn = pane && pane.breathingMonitor !== false;

  const items = [
    { label: 'Copy', action: 'terminal-copy', disabled: !node.terminal.hasSelection(), shortcut: '⇧⌘C' },
    { label: 'Paste', action: 'terminal-paste', disabled: !clipboardSnapshot.text, shortcut: '⇧⌘V' },
    { label: 'Paste Image', action: 'terminal-paste-image', disabled: !clipboardSnapshot.hasImage },
    { type: 'separator' },
    { label: 'Change Color...', action: 'terminal-change-color' },
    {
      label: 'Background activity alert',
      action: 'pane-toggle-breathing',
      shortcut: breathingOn ? '✓' : '',
    },
    { label: 'Select All', action: 'terminal-select-all', shortcut: '⌘A' },
  ];

  if (shellChildren.length > 0) {
    items.push(
      { type: 'separator' },
      { label: 'Change Profile', children: shellChildren },
    );
  }

  showContextMenu(items, event.clientX, event.clientY, node.paneId);
}

function showTabContextMenu(paneId, event) {
  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) {
    return;
  }

  paneCycleState = null;
  focusedPaneId = paneId;
  recordPaneVisit(paneId);
  render();

  const pane = panes[paneIndex];
  const hasCustomColor = pane && pane.customColor !== undefined;

  const items = [
    { label: 'Change Color...', action: 'tab-change-color' },
    { type: 'separator' },
    { label: 'Rename Tab', action: 'tab-rename' },
    { label: 'Close Tab', action: 'tab-close', disabled: panes.length <= 1 },
  ];
  showContextMenu(items, event.clientX, event.clientY, paneId);
}

function showColorPicker(paneId) {
  hideContextMenu();

  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) return;

  const pane = panes[paneIndex];
  const currentColor = pane.customColor || pane.accent;
  const presetColors = ColorsRegistry.PRESET_PANE_COLORS;

  // Find the index of the currently selected color for initial keyboard focus
  let focusedIndex = presetColors.indexOf(currentColor);
  if (focusedIndex === -1) focusedIndex = 0;

  const picker = document.createElement('div');
  picker.className = 'color-picker-overlay';
  picker.innerHTML = `
    <div class="color-picker-dialog">
      <div class="color-picker-header">
        <span>Pane Color</span>
        <button type="button" class="color-picker-close" aria-label="Close">×</button>
      </div>
      <div class="color-picker-presets">
        ${presetColors.map((color, index) => `
          <button type="button" class="color-preset${color === currentColor ? ' is-selected' : ''}${index === focusedIndex ? ' is-focused' : ''}"
                  style="--color: ${color}" data-color="${color}" data-index="${index}" tabindex="-1" aria-label="Select ${color}"></button>
        `).join('')}
      </div>
      <div class="color-picker-custom">
        <label>Custom:</label>
        <input type="color" class="color-picker-input" value="${currentColor}" />
      </div>
      <div class="color-picker-footer">
        <button type="button" class="color-picker-clear">Clear Color</button>
      </div>
    </div>
  `;

  // Keyboard navigation for preset colors
  // Grid layout: 8 columns, so up/down moves by 8, left/right moves by 1
  const GRID_COLUMNS = 8;

  const handleKeydown = (e) => {
    const presetButtons = picker.querySelectorAll('.color-preset');
    const totalColors = presetColors.length;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move left one column, wrap to previous row if needed
        focusedIndex = (focusedIndex - 1 + totalColors) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'ArrowRight':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move right one column, wrap to next row if needed
        focusedIndex = (focusedIndex + 1) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'ArrowUp':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move up one row (8 columns)
        focusedIndex = (focusedIndex - GRID_COLUMNS + totalColors) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'ArrowDown':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move down one row (8 columns)
        focusedIndex = (focusedIndex + GRID_COLUMNS) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        // Select the focused color
        const selectedColor = presetButtons[focusedIndex].dataset.color;
        setPaneColor(paneId, selectedColor);
        picker.removeEventListener('keydown', handleKeydown);
        picker.remove();
        // Return focus to the pane
        focusPane(paneId);
        break;

      case 'Escape':
        e.preventDefault();
        picker.removeEventListener('keydown', handleKeydown);
        picker.remove();
        // Return focus to the pane
        focusPane(paneId);
        break;
    }
  };

  picker.addEventListener('click', (e) => {
    if (e.target === picker) {
      picker.removeEventListener('keydown', handleKeydown);
      picker.remove();
      unregisterModal(closeColorPicker);
    }
  });

picker.querySelector('.color-picker-close').addEventListener('click', () => {
    picker.removeEventListener('keydown', handleKeydown);
    closeColorPicker();
  });

  picker.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      setPaneColor(paneId, color);
      picker.removeEventListener('keydown', handleKeydown);
      closeColorPicker();
      // Return focus to the pane
      focusPane(paneId);
    });

    // Update focused index on mouse hover for consistency
    btn.addEventListener('mouseenter', () => {
      const presetButtons = picker.querySelectorAll('.color-preset');
      presetButtons[focusedIndex].classList.remove('is-focused');
      focusedIndex = parseInt(btn.dataset.index, 10);
      btn.classList.add('is-focused');
    });
  });

  const colorInput = picker.querySelector('.color-picker-input');
  colorInput.addEventListener('input', () => {
    setPaneColor(paneId, colorInput.value);
  });

  // When custom color input is focused, remove keyboard focus from presets
  colorInput.addEventListener('focus', () => {
    const presetButtons = picker.querySelectorAll('.color-preset');
    presetButtons[focusedIndex].classList.remove('is-focused');
  });

  picker.querySelector('.color-picker-clear').addEventListener('click', () => {
    clearPaneColor(paneId);
    picker.removeEventListener('keydown', handleKeydown);
    closeColorPicker();
  });

  document.body.appendChild(picker);

  // Attach keyboard listener to the picker for capturing arrow keys
  picker.addEventListener('keydown', handleKeydown);

  // Focus the picker overlay to enable keyboard capture
  picker.setAttribute('tabindex', '-1');
  picker.focus();

  function closeColorPicker() {
    picker.remove();
    unregisterModal(closeColorPicker);
  }

  registerModal(closeColorPicker);
}

function setPaneColor(paneId, color) {
  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) return;

  panes[paneIndex] = { ...panes[paneIndex], customColor: color };
  scheduleWindowLayoutSave();
  render();
}

function clearPaneColor(paneId) {
  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) return;

  panes[paneIndex] = { ...panes[paneIndex], customColor: undefined };
  scheduleWindowLayoutSave();
  render();
}

function togglePaneBreathingMonitor(paneId) {
  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) return;

  const next = panes[paneIndex].breathingMonitor === false;
  panes[paneIndex] = { ...panes[paneIndex], breathingMonitor: next };
  paneActivityWatcher.setPaneEnabled(paneId, next);
  scheduleWindowLayoutSave();
}

// VIB-16: open the command palette over the current panes. Build a
// feature-agnostic item list and let the palette module do the rest.
function openTabSwitcher() {
  hideContextMenu();
  if (renamingPaneId !== null) {
    cancelRenamePane();
  }
  if (!settingsPanelEl.classList.contains('is-hidden')) {
    closeSettingsPanel();
  }

  const items = panes.map((pane) => ({
    id: pane.id,
    label: getPaneLabel(pane) || pane.id,
    accent: pane.customColor || pane.accent,
  }));

  openCommandPalette(items, focusPane, {
    placeholder: 'Switch tab by title…',
    emptyText: 'No matching tabs',
  });
}

function openCommandList() {
  hideContextMenu();
  if (renamingPaneId !== null) {
    cancelRenamePane();
  }
  if (!settingsPanelEl.classList.contains('is-hidden')) {
    closeSettingsPanel();
  }

  const items = [
    { id: 'change-profile',  label: 'Change profile' },
    { id: 'change-color',    label: 'Change color' },
    { id: 'rename-pane',     label: 'Rename pane' },
    { id: 'profile-settings',  label: 'Profile settings' },
    { id: 'shortcuts-settings', label: 'Shortcuts settings' },
    { id: 'layout-save',     label: 'Layout: Save Layout' },
    { id: 'layout-default',  label: 'Layout: Open Default' },
    ...layouts
      .filter((l) => l.id !== 'default')
      .map((l) => ({ id: `layout-open:${l.id}`, label: `Layout: Open ${l.name}` })),
    { id: 'layout-manage',   label: 'Layout: Manage Layouts' },
  ];

  openCommandPalette(items, (commandId) => {
    if (commandId === 'change-profile') {
      openProfileSwitcher();
    } else if (commandId === 'change-color') {
      showColorPicker(focusedPaneId);
    } else if (commandId === 'rename-pane') {
      const index = getPaneIndex(focusedPaneId);
      if (index !== -1) beginRenamePane(index);
    } else if (commandId === 'profile-settings') {
      openShellProfilesModal();
    } else if (commandId === 'shortcuts-settings') {
      closeKeyboardShortcutsModal();
      registerModal(closeKeyboardShortcutsModal);
      ShortcutsUI.openKeyboardShortcutsModal(bridge, scheduleSettingsSave);
    } else if (commandId === 'layout-save') {
      saveCurrentLayout().catch(reportError);
    } else if (commandId === 'layout-default') {
      bridge.openLayoutWindow('default').catch(reportError);
    } else if (commandId.startsWith('layout-open:')) {
      const layoutId = commandId.slice('layout-open:'.length);
      bridge.openLayoutWindow(layoutId).catch(reportError);
    } else if (commandId === 'layout-manage') {
      openLayoutsModal();
    }
  }, {
    placeholder: 'Type a command…',
    emptyText: 'No matching commands',
  });
}

function openProfileSwitcher() {
  if (shellProfiles.length === 0) {
    loadShellProfiles();
    return;
  }

  const items = shellProfiles.map((p) => ({
    id: p.id,
    label: p.name || p.id,
  }));

  openCommandPalette(items, (profileId) => {
    changePaneShell(focusedPaneId, profileId);
    focusPane(focusedPaneId);
  }, {
    placeholder: 'Select a profile…',
    emptyText: 'No matching profiles',
  });
}

async function pasteImageIntoTerminal(paneId = focusedPaneId, options = {}) {
  const node = getPaneNode(paneId);
  if (!node?.sessionReady) {
    return false;
  }

  const clipboardSnapshot = options.clipboardSnapshot ?? (await getClipboardSnapshot());
  if (!clipboardSnapshot.hasImage) {
    return false;
  }

  bridge.writeTerminal({ paneId: node.paneId, data: '\u0016' });
  return true;
}

function handleMenuAction(action, paneId) {
  if (action === 'terminal-copy') {
    copyTerminalSelection(paneId);
    return;
  }

  if (action === 'terminal-paste') {
    void pasteIntoTerminal(paneId);
    return;
  }

  if (action === 'terminal-paste-image') {
    pasteImageIntoTerminal(paneId);
    return;
  }

  if (action === 'terminal-select-all') {
    selectAllInTerminal(paneId);
    return;
  }

  if (action === 'terminal-change-color') {
    showColorPicker(paneId);
    return;
  }

  if (action === 'tab-rename') {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex !== -1) {
      beginRenamePane(paneIndex);
    }
    return;
  }

  if (action === 'tab-close') {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex !== -1) {
      closePane(paneIndex);
    }
    return;
  }

  if (action === 'tab-change-color') {
    showColorPicker(paneId);
    return;
  }

  if (action.startsWith('tab-set-color:')) {
    const color = action.slice('tab-set-color:'.length);
    setPaneColor(paneId, color);
    return;
  }

  if (action === 'tab-clear-color') {
    clearPaneColor(paneId);
    return;
  }

  if (action === 'pane-toggle-breathing') {
    togglePaneBreathingMonitor(paneId);
    return;
  }

  if (action.startsWith('terminal-change-shell:')) {
    const profileId = action.slice('terminal-change-shell:'.length);
    changePaneShell(paneId, profileId);
  }
}

function blurFocusedTerminal() {
  const node = paneNodeMap.get(focusedPaneId);
  if (node) {
    node.terminal.blur();
  }
}

function enterNavigationMode() {
  if (panes.length === 0) {
    return;
  }

  // Save the source pane ID so we can return to it on cancel
  enterNavSourcePaneId = focusedPaneId;
  setMode('nav');
  blurFocusedTerminal();
  render();
}

function cancelNavigationMode() {
  // Return focus to the pane that was focused when entering nav mode
  if (enterNavSourcePaneId) {
    focusPane(enterNavSourcePaneId, { focusTerminal: true });
    enterNavSourcePaneId = null;
  } else {
    setMode('terminal');
    render();
  }
}

function updateStatus() {
  if (layoutFocusNotice) {
    statusLabelEl.textContent = 'Layout focused';
    statusLabelEl.classList.remove('is-navigation-mode');
    statusHintEl.textContent = getLayoutDisplayName(layoutFocusNotice.layoutId);
    return;
  }

  const focusedPane = panes[getFocusedIndex()];
  const focusedPaneLabel = getPaneLabel(focusedPane) || focusedPane.id;

  // Use the hint bar system
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

// ---------------------------------------------------------------------------
// VIB-33: Navigation mode enhancement functions
// ---------------------------------------------------------------------------

function focusPaneAt(index) {
  if (panes.length === 0 || index < 0 || index >= panes.length) return;
  paneCycleState = null;
  focusedPaneId = panes[index].id;
  // Stay in nav mode, just update which pane is focused
  render();
}

function getPaneCount() {
  return panes.length;
}

function getPaneIdAt(index) {
  if (panes.length === 0 || index < 0 || index >= panes.length) return null;
  return panes[index].id;
}

// Two-step close confirmation state
let pendingClosePaneId = null;

function requestClosePane(paneId) {
  if (pendingClosePaneId === paneId) {
    // Second press - confirmed
    const index = panes.findIndex((pane) => pane.id === paneId);
    if (index !== -1) {
      pendingClosePaneId = null;
      closePane(index);

      // Exit nav mode and return focus to the now-focused pane after close
      if (currentMode === 'nav' && panes.length > 0) {
        focusPane(focusedPaneId, { focusTerminal: true });
      }
    }
  } else {
    // First press - show pending state
    pendingClosePaneId = paneId;
    render();
  }
}

function startInlineRename(paneId) {
  const index = panes.findIndex((pane) => pane.id === paneId);
  if (index !== -1) {
    // Exit nav mode before starting rename
    if (currentMode === 'nav') {
      setMode('terminal');
    }
    beginRenamePane(index);
  }
}

function closeKeyboardShortcutsModal() {
  const overlay = document.querySelector('.settings-modal-overlay');
  if (overlay) overlay.remove();
}

function openKeymapHelpModal() {
  closeKeyboardShortcutsModal();
  registerModal(closeKeyboardShortcutsModal);
  ShortcutsUI.openKeyboardShortcutsModal(bridge, scheduleSettingsSave);
}

// ---------------------------------------------------------------------------
// Wire renderer-level callbacks into pure action handlers
// ---------------------------------------------------------------------------

// Wire renderer-level callbacks into pure action handlers, then route every
// global keydown through the declarative keymap dispatcher. The keydown switch
// that used to live here is now `KEYMAP` in `input/keymap.js` plus a few flag
// columns (`mode`, `skipInInput`, `stopPropagation`) interpreted by the
// dispatcher.
const keyboardActions = createActions({
  addPane,
  enterNavigationMode,
  cycleToRecentPane,
  cycleToNextLitPane,
  navigateLeft,
  navigateRight,
  copyTerminalSelection,
  pasteIntoTerminal,
  moveFocus,
  focusPane,
  cancelNavigationMode,
  getFocusedPaneId: () => focusedPaneId,
  isCommandPaletteOpen,
  closeCommandPalette,
  openTabSwitcher,
  openCommandList,
  focusPaneAt,
  getPaneCount,
  getPaneIdAt,
  requestClosePane,
  startInlineRename,
  openKeymapHelpModal,
  openLayoutsModal,
});

const dispatchKeydown = createDispatcher({
  getKeymap: ShortcutsRegistry.getActiveKeymap,
  actions: keyboardActions,
  getMode: () => currentMode,
  isInputFocused: () => document.activeElement?.tagName === 'INPUT',
  isCommandPaletteOpen,
});

window.addEventListener('keydown', dispatchKeydown, true);

// Commit the pane cycle when the cycling modifier is released. Without this,
// a user who presses Ctrl+` and then switches to a different pane via mouse
// would not see their MRU updated to reflect the new active pane.
window.addEventListener('keyup', (event) => {
  if (paneCycleState && (event.key === 'Control' || event.key === 'Meta')) {
    commitPaneCycle();
  }
});

// If the window loses focus mid-cycle (alt-tab away), the keyup event for
// the cycling modifier may never fire. Commit the cycle defensively so the
// MRU stays consistent with what the user sees.
window.addEventListener('blur', () => {
  if (paneCycleState) {
    commitPaneCycle();
  }
});

// ---------------------------------------------------------------------------
// Modal stack — ESC closes the topmost modal/panel
// ---------------------------------------------------------------------------
const modalStack = [];

function registerModal(closeFn) {
  modalStack.push(closeFn);
}

function unregisterModal(closeFn) {
  const idx = modalStack.indexOf(closeFn);
  if (idx !== -1) modalStack.splice(idx, 1);
}

function closeTopModal() {
  const closeFn = modalStack[modalStack.length - 1];
  if (closeFn) closeFn();
  // Return focus to the current pane after closing a modal
  if (focusedPaneId) {
    focusPane(focusedPaneId, { focusTerminal: true });
  }
}

function closeSettingsPanel() {
  settingsPanelEl.classList.add('is-hidden');
  editingShellProfile = null;
  unregisterModal(closeSettingsPanel);
}

addPaneButtonEl.addEventListener('click', () => {
  try {
    addPane();
  } catch (error) {
    reportError(error);
  }
});

function showAddPaneProfilePopup() {
  // Ensure profiles are loaded
  if (shellProfiles.length === 0) {
    loadShellProfiles().then(() => {
      renderAddPaneProfilePopup(shellProfiles);
    });
    return;
  }
  renderAddPaneProfilePopup(shellProfiles);
}

function renderAddPaneProfilePopup(profiles) {
  // Remove any existing popup
  const existing = document.querySelector('.add-pane-profile-popup');
  if (existing) {
    existing.remove();
    document.removeEventListener('click', dismissAddPaneProfilePopup);
    return;
  }

  const popup = document.createElement('div');
  popup.className = 'add-pane-profile-popup';

  if (profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'add-pane-profile-empty';
    empty.textContent = 'No profiles available';
    popup.appendChild(empty);
  } else {
    for (const profile of profiles) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'add-pane-profile-item';

      const name = document.createElement('span');
      name.className = 'profile-name';
      name.textContent = profile.name || profile.id;
      item.appendChild(name);

      if (profile.id === defaultShellProfileId) {
        const mark = document.createElement('span');
        mark.className = 'profile-default-mark';
        mark.textContent = 'default';
        item.appendChild(mark);
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.remove();
        document.removeEventListener('click', dismissAddPaneProfilePopup);
        try {
          addPane(profile.id);
        } catch (error) {
          reportError(error);
        }
      });

      popup.appendChild(item);
    }
  }

  // Position popup aligned with the tabs panel bottom (same as Settings)
  const rect = addPaneDropdownButtonEl.getBoundingClientRect();
  const tabsPanelRect = document.querySelector('.tabs-panel').getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${tabsPanelRect.bottom + 1}px`;
  document.body.appendChild(popup);

  // Adjust if popup overflows the right edge of the viewport
  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      const overflow = popupRect.right - (window.innerWidth - 8);
      popup.style.left = `${Math.max(8, parseFloat(popup.style.left) - overflow)}px`;
    }
    document.addEventListener('click', dismissAddPaneProfilePopup);
  });
}

function dismissAddPaneProfilePopup(event) {
  const popup = document.querySelector('.add-pane-profile-popup');
  if (popup && !popup.contains(event.target) && event.target !== addPaneDropdownButtonEl) {
    popup.remove();
    document.removeEventListener('click', dismissAddPaneProfilePopup);
  }
}

addPaneDropdownButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  try {
    showAddPaneProfilePopup();
  } catch (error) {
    reportError(error);
  }
});

layoutsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleLayoutsDropdown();
});

settingsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  const wasHidden = settingsPanelEl.classList.toggle('is-hidden');
  if (wasHidden) {
    closeSettingsPanel();
  } else {
    applySettings();
    registerModal(closeSettingsPanel);
  }
});

// Shell profiles modal button (clickable row)
// Layouts modal button (clickable row)
if (layoutsSettingsBtn) {
  layoutsSettingsBtn.addEventListener('click', () => {
    openLayoutsModal();
  });

  layoutsSettingsBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLayoutsModal();
    }
  });
}

shellProfilesSettingsBtn.addEventListener('click', () => {
  openShellProfilesModal();
});

shellProfilesSettingsBtn.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openShellProfilesModal();
  }
});

// ----------------------------------------------------------------
// Keyboard shortcuts modal
// ----------------------------------------------------------------

// Keyboard shortcuts modal button (clickable row)
keyboardShortcutsSettingsBtn.addEventListener('click', () => {
  closeKeyboardShortcutsModal();
  registerModal(closeKeyboardShortcutsModal);
  ShortcutsUI.openKeyboardShortcutsModal(bridge, scheduleSettingsSave);
});

keyboardShortcutsSettingsBtn.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    closeKeyboardShortcutsModal();
    registerModal(closeKeyboardShortcutsModal);
    ShortcutsUI.openKeyboardShortcutsModal(bridge, scheduleSettingsSave);
  }
});

// Fullscreen toggle
function isFullscreenSupported() {
  return (
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen ||
    false
  );
}

function getIsFullscreen() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    null
  );
}

function updateFullscreenButton() {
  const isFs = getIsFullscreen();
  fullscreenButtonEl.classList.toggle('is-fullscreen', Boolean(isFs));
  fullscreenButtonEl.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
}

function toggleFullscreen() {
  if (!isFullscreenSupported()) {
    return;
  }

  if (getIsFullscreen()) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } else {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    }
  }
}

function hideFullscreenButtonIfUnsupported() {
  if (!isFullscreenSupported()) {
    fullscreenButtonEl.classList.add('is-hidden');
  }
}

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

fullscreenButtonEl.addEventListener('click', () => {
  toggleFullscreen();
});

hideFullscreenButtonIfUnsupported();

settingsPanelEl.addEventListener('click', (event) => {
  event.stopPropagation();
});

fontSizeInputEl.addEventListener('change', () => {
  const nextValue = Number(fontSizeInputEl.value);
  if (!Number.isFinite(nextValue)) {
    applySettings();
    return;
  }

  settings.fontSize = Math.max(10, Math.min(24, Math.round(nextValue)));
  applySettings();
  render(true);
  scheduleSettingsSave();
});

fontFamilyInputEl.addEventListener('change', () => {
  settings.fontFamily = fontFamilyInputEl.value.trim() || getDefaultFontFamily(bridge.platform);
  applySettings();
  render(true);
  scheduleSettingsSave();
});

function updatePaneWidth(nextValue) {
  const parsedValue = Number(nextValue);
  if (!Number.isFinite(parsedValue)) {
    applySettings();
    return;
  }

  settings.paneWidth = Math.max(520, Math.min(2000, Math.round(parsedValue / 10) * 10));
  applySettings();
  render(true);
  scheduleSettingsSave();
}

function updatePaneOpacity(nextValue) {
  const parsedValue = Number(nextValue);
  if (!Number.isFinite(parsedValue)) {
    applySettings();
    return;
  }

  settings.paneOpacity = Math.max(0.55, Math.min(1, Number(parsedValue.toFixed(2))));
  applySettings();
  scheduleSettingsSave();
}

function updatePaneMaskOpacity(nextValue) {
  const parsedValue = Number(nextValue);
  if (!Number.isFinite(parsedValue)) {
    applySettings();
    return;
  }

  settings.paneMaskOpacity = Math.max(0, Math.min(1, Number(parsedValue.toFixed(2))));
  applySettings();
  scheduleSettingsSave();
}

paneWidthRangeEl.addEventListener('input', () => {
  updatePaneWidth(paneWidthRangeEl.value);
});

paneWidthInputEl.addEventListener('change', () => {
  updatePaneWidth(paneWidthInputEl.value);
});

paneOpacityRangeEl.addEventListener('input', () => {
  updatePaneOpacity(paneOpacityRangeEl.value);
});

paneOpacityInputEl.addEventListener('change', () => {
  updatePaneOpacity(paneOpacityInputEl.value);
});

paneMaskOpacityRangeEl.addEventListener('input', () => {
  updatePaneMaskOpacity(paneMaskOpacityRangeEl.value);
});

paneMaskOpacityInputEl.addEventListener('change', () => {
  updatePaneMaskOpacity(paneMaskOpacityInputEl.value);
});

breathingAlertToggleEl.addEventListener('change', () => {
  settings.breathingAlertEnabled = breathingAlertToggleEl.checked;
  paneActivityWatcher.setGlobalEnabled(settings.breathingAlertEnabled);
  scheduleSettingsSave();
});

// Close settings panel via click-outside, keeping modal stack in sync
window.addEventListener('pointerdown', (event) => {
  if (
    !settingsPanelEl.classList.contains('is-hidden') &&
    !settingsPanelEl.contains(event.target) &&
    !settingsButtonEl.contains(event.target)
  ) {
    closeSettingsPanel();
  }
});

// Global ESC: close the topmost modal/panel registered in the stack
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeTopModal();
  }
});

window.addEventListener('resize', () => {
  try {
    render(true);
  } catch (error) {
    reportError(error);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await bridge.cwdReady;

    const savedSettings = await bridge.loadSettings();
    applyPersistedSettings(savedSettings);
    applySettings();
    loadShellProfiles();

    await refreshLayouts();

    let defaultLayout = layouts.find((l) => l.id === defaultLayoutId)
      || layouts.find((l) => l.id === 'default');

    if (!defaultLayout) {
      defaultLayout = createDefaultLayout();
      const saved = await bridge.saveLayout(defaultLayout);
      layouts = saved.layouts ?? [defaultLayout];
      defaultLayoutId = saved.defaultLayoutId ?? defaultLayoutId;
    }

    if (defaultLayoutId !== defaultLayout.id) {
      const config = await bridge.setLayoutAsDefault(defaultLayout.id);
      layouts = config.layouts ?? layouts;
      defaultLayoutId = config.defaultLayoutId ?? defaultLayout.id;
    }

    const targetLayoutId = windowContext.kind === 'layout'
      ? windowContext.layoutId
      : defaultLayoutId;
    const targetLayout = layouts.find((l) => l.id === targetLayoutId);
    if (!targetLayout) {
      throw new Error(`Layout not found: ${targetLayoutId}`);
    }

    setWindowLayoutId(targetLayout.id);
    restoreSession({ panes: targetLayout.panes, focusedPaneIndex: targetLayout.focusedPaneIndex });
    ensurePaneNodes();

    updateLayoutsIndicator();
    render(true);
    layoutRestoreComplete = true;
  } catch (error) {
    reportError(error);
    const msg = error instanceof Error ? error.message : String(error);
    document.body.innerHTML = `<div style="color:#e06c75;padding:2em;font-family:monospace;white-space:pre-wrap">Initialization failed: ${msg}</div>`;
  }
});

window.addEventListener('beforeunload', () => {
  flushWindowLayoutSave();
  flushSettingsSave();
  clearLayoutWindowBinding(windowLayoutId, bridge.currentWindowLabel);
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
