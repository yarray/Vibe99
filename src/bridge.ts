/**
 * IPC Bridge Layer
 *
 * This is the lowest-level module with zero external dependencies.
 * It provides a unified interface to Tauri's backend IPC commands.
 */

// ============================================================================
// Types
// ============================================================================

export type Platform = 'win32' | 'darwin' | 'linux';

/** Payload for terminal_create */
export interface TerminalCreatePayload {
  paneId: string;
  cols: number;
  rows: number;
  cwd: string;
  shellProfileId?: string | null;
}

/** Payload for terminal_write */
export interface TerminalWritePayload {
  paneId: string;
  data: string;
}

/** Payload for terminal_resize */
export interface TerminalResizePayload {
  paneId: string;
  cols: number;
  rows: number;
}

/** Payload for terminal_destroy */
export interface TerminalDestroyPayload {
  paneId: string;
}

/** Union of all terminal payload types */
export type TerminalPayloads =
  | TerminalCreatePayload
  | TerminalWritePayload
  | TerminalResizePayload
  | TerminalDestroyPayload;

/** Data received from terminal output events */
export interface TerminalDataEvent {
  paneId: string;
  data: string;
}

/** Data received from terminal exit events */
export interface TerminalExitEvent {
  paneId: string;
  exitCode: number;
  reason: string;
}

/** Menu action event */
export interface MenuActionEvent {
  action: string;
  paneId?: string;
}

/** Layout pane descriptor */
export interface LayoutPane {
  id: string;
  cwd?: string;
  shellProfileId?: string | null;
  [key: string]: unknown;
}

/** Layout data as stored / transmitted */
export interface LayoutData {
  id: string;
  name: string;
  panes: LayoutPane[];
  focusedPaneIndex: number;
}

/** Result of listing layouts */
export interface LayoutsListResult {
  layouts: LayoutData[];
  defaultLayoutId: string;
}

/** Result of saving a layout */
export interface LayoutSaveResult {
  layouts: LayoutData[];
  defaultLayoutId?: string;
}

/** Result of listing shell profiles */
export interface ShellProfilesListResult {
  profiles: ShellProfileData[];
  defaultProfile: string;
}

/** A single shell profile */
export interface ShellProfileData {
  id: string;
  name?: string;
  path?: string;
  args?: string;
  [key: string]: unknown;
}

/** Clipboard snapshot */
export interface ClipboardSnapshot {
  text: string;
  hasImage: boolean;
}

/** Arbitrary settings object */
export type SettingsData = Record<string, unknown>;

/**
 * Minimal shape of `window.__TAURI__` — the global Tauri API object injected
 * when `app.withGlobalTauri` is enabled.  Only the surface used by
 * `createTauriBridge` is declared here.
 */
interface TauriGlobal {
  core: {
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  window: {
    getCurrentWindow: () => TauriWindow;
  };
  webview: {
    getCurrentWebview: () => TauriWebview;
  };
  webviewWindow: {
    WebviewWindow: typeof import('@tauri-apps/api/webviewWindow').WebviewWindow;
  };
  event?: {
    emitTo?: (target: string, event: string) => Promise<void>;
  };
  clipboardManager: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  opener: {
    openUrl: (url: string | URL) => Promise<void>;
  };
}

/**
 * Minimal subset of the Tauri Window class used internally.
 * Avoids importing the full type which pulls in DPI / Image / etc.
 */
interface TauriWindow {
  label: string;
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  setFocus: () => Promise<void>;
  close: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
}

/**
 * Minimal subset of the Tauri Webview class used internally.
 */
interface TauriWebview {
  listen: <T = unknown>(
    event: string,
    handler: (e: { payload: T }) => void,
  ) => Promise<() => void>;
}

// -- Grouped API interfaces --

export interface TerminalApi {
  create: (payload: TerminalCreatePayload) => Promise<void>;
  write: (payload: TerminalWritePayload) => Promise<void>;
  resize: (payload: TerminalResizePayload) => Promise<void>;
  destroy: (payload: TerminalDestroyPayload) => Promise<void>;
  onData: (handler: (event: TerminalDataEvent) => void) => () => void;
  onExit: (handler: (event: TerminalExitEvent) => void) => () => void;
}

export interface ClipboardApi {
  read: () => Promise<string>;
  write: (text: string) => Promise<void>;
  snapshot: () => Promise<ClipboardSnapshot>;
}

export interface SettingsApi {
  load: () => Promise<SettingsData>;
  save: (payload: SettingsData) => Promise<SettingsData>;
}

export interface ShellApi {
  list: () => Promise<ShellProfilesListResult>;
  add: (profile: ShellProfileData) => Promise<void>;
  remove: (profileId: string) => Promise<void>;
  setDefault: (profileId: string) => Promise<void>;
  detect: () => Promise<string[]>;
}

export interface WindowApi {
  close: () => Promise<void>;
  openUrl: (url: string) => void;
  showMenu: () => void;
}

export interface LayoutsApi {
  list: () => Promise<LayoutsListResult>;
  save: (layout: LayoutData) => Promise<LayoutSaveResult>;
  delete: (layoutId: string) => Promise<void>;
  rename: (layoutId: string, newName: string) => Promise<void>;
  openWindow: (layoutId: string) => Promise<void>;
  openInNewWindow: (layoutId: string) => Promise<void>;
  isFullscreen: (() => Promise<boolean>) | undefined;
  setFullscreen: ((fullscreen: boolean) => Promise<void>) | undefined;
  setAsDefault: (layoutId: string) => Promise<LayoutsListResult>;
}

/** Event listener unsubscribes with void return */
type UnsubscribeFn = () => void;

/**
 * The full Bridge interface returned by createBridge().
 *
 * Provides grouped IPC methods by domain plus flat aliases for backward
 * compatibility.
 */
export interface Bridge {
  // Identity
  platform: Platform;
  currentWindowLabel: string;
  defaultCwd: string;
  defaultTabTitle: string;

  // Grouped APIs
  terminal: TerminalApi;
  clipboard: ClipboardApi;
  settings: SettingsApi;
  shell: ShellApi;
  window: WindowApi;
  layouts: LayoutsApi;

  // Event listeners
  onMenuAction: (handler: (event: MenuActionEvent) => void) => UnsubscribeFn;
  onLayoutFocusNotice: ((handler: () => void) => UnsubscribeFn) | undefined;

  // Lifecycle
  cwdReady: Promise<void>;

  // -- Flat aliases (backward compat) --
  createTerminal: TerminalApi['create'];
  writeTerminal: TerminalApi['write'];
  resizeTerminal: TerminalApi['resize'];
  destroyTerminal: TerminalApi['destroy'];
  onTerminalData: TerminalApi['onData'];
  onTerminalExit: TerminalApi['onExit'];

  readClipboardText: ClipboardApi['read'];
  writeClipboardText: ClipboardApi['write'];
  getClipboardSnapshot: ClipboardApi['snapshot'];

  loadSettings: SettingsApi['load'];
  saveSettings: SettingsApi['save'];

  listShellProfiles: ShellApi['list'];
  addShellProfile: ShellApi['add'];
  removeShellProfile: ShellApi['remove'];
  setDefaultShellProfile: ShellApi['setDefault'];
  detectShellProfiles: ShellApi['detect'];

  closeWindow: WindowApi['close'];
  openExternalUrl: WindowApi['openUrl'];
  showContextMenu: WindowApi['showMenu'];

  listLayouts: LayoutsApi['list'];
  saveLayout: LayoutsApi['save'];
  deleteLayout: LayoutsApi['delete'];
  renameLayout: LayoutsApi['rename'];
  openLayoutWindow: LayoutsApi['openWindow'];
  openLayoutInNewWindow: LayoutsApi['openInNewWindow'];
  isWindowFullscreen: LayoutsApi['isFullscreen'];
  setWindowFullscreen: LayoutsApi['setFullscreen'];
  setLayoutAsDefault: LayoutsApi['setAsDefault'];
}

// ============================================================================
// Platform & Path Utilities
// ============================================================================

function getRuntimePlatform(): Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) {
    return 'win32';
  }
  if (platform.includes('mac')) {
    return 'darwin';
  }
  return 'linux';
}

function getDefaultFontFamily(platform: Platform = getRuntimePlatform()): string {
  if (platform === 'win32') {
    return 'Consolas, "Cascadia Mono", "Courier New", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", monospace';
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || '/';
}

// ============================================================================
// Argument Parsing Utilities
// ============================================================================

/**
 * Splits a command-line string into an array of arguments.
 * Handles quoted strings (single and double quotes).
 */
function splitArgs(str: string): string[] {
  const args: string[] = [];
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

/**
 * Converts a string array back to a shell-quoted command-line string.
 * This is the inverse of splitArgs(): formatArgs(splitArgs(s)) === s for any s.
 */
function formatArgs(args: string[]): string {
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

// ============================================================================
// Layout Window Bindings
// ============================================================================

const LAYOUT_FOCUS_NOTICE_EVENT = 'vibe99:layout-focus-notice';
const LAYOUT_WINDOW_BINDINGS_KEY = 'vibe99.layoutWindowBindings';

type LayoutWindowBindings = Record<string, string>;

function readLayoutWindowBindings(): LayoutWindowBindings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAYOUT_WINDOW_BINDINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLayoutWindowBindings(bindings: LayoutWindowBindings): void {
  try {
    window.localStorage.setItem(LAYOUT_WINDOW_BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // Best effort only. The stable Tauri window label still prevents duplicates
    // for layout windows created through the normal UI path.
  }
}

function getBoundLayoutWindowLabel(layoutId: string): string | null {
  const label = readLayoutWindowBindings()[layoutId];
  return typeof label === 'string' && label ? label : null;
}

function clearLayoutWindowBinding(layoutId: string | undefined, expectedLabel: string | null = null): void {
  if (!layoutId) return;
  const bindings = readLayoutWindowBindings();
  if (expectedLabel !== null && bindings[layoutId] !== expectedLabel) return;
  delete bindings[layoutId];
  writeLayoutWindowBindings(bindings);
}

/**
 * Helper type: extracts the flat alias keys from Bridge.
 * Used to Omit them from createTauriBridge's return since those are added by createBridge.
 */
type FlatAliases = {
  createTerminal: unknown;
  writeTerminal: unknown;
  resizeTerminal: unknown;
  destroyTerminal: unknown;
  onTerminalData: unknown;
  onTerminalExit: unknown;
  readClipboardText: unknown;
  writeClipboardText: unknown;
  getClipboardSnapshot: unknown;
  loadSettings: unknown;
  saveSettings: unknown;
  listShellProfiles: unknown;
  addShellProfile: unknown;
  removeShellProfile: unknown;
  setDefaultShellProfile: unknown;
  detectShellProfiles: unknown;
  closeWindow: unknown;
  openExternalUrl: unknown;
  showContextMenu: unknown;
  listLayouts: unknown;
  saveLayout: unknown;
  deleteLayout: unknown;
  renameLayout: unknown;
  openLayoutWindow: unknown;
  openLayoutInNewWindow: unknown;
  isWindowFullscreen: unknown;
  setWindowFullscreen: unknown;
  setLayoutAsDefault: unknown;
};

// ============================================================================
// Unavailable Bridge (Fallback)
// ============================================================================

function createUnavailableBridge(): Bridge {
  const fail = (): never => {
    throw new Error('Tauri bridge is unavailable');
  };

  const defaultCwd = '/';

  return {
    platform: getRuntimePlatform(),
    currentWindowLabel: 'browser',
    defaultCwd,
    defaultTabTitle: basename(defaultCwd),
    terminal: {
      create: fail,
      write: fail,
      resize: fail,
      destroy: fail,
      onData: () => () => {},
      onExit: () => () => {},
    },
    clipboard: {
      read: () => Promise.reject(new Error('Clipboard bridge is unavailable')),
      write: fail,
      snapshot: async () => ({ text: '', hasImage: false }),
    },
    settings: {
      load: () => Promise.resolve({}),
      save: () => Promise.resolve({}),
    },
    shell: {
      list: () => Promise.resolve({ profiles: [], defaultProfile: '' }),
      add: fail,
      remove: fail,
      setDefault: fail,
      detect: () => Promise.resolve([]),
    },
    window: {
      close: fail,
      openUrl: fail,
      showMenu: () => {},
    },
    layouts: {
      list: () => Promise.resolve({ layouts: [], defaultLayoutId: '' }),
      save: fail,
      delete: fail,
      rename: fail,
      openWindow: fail,
      openInNewWindow: fail,
      isFullscreen: undefined,
      setFullscreen: undefined,
      setAsDefault: fail,
    },
    onMenuAction: () => () => {},
    onLayoutFocusNotice: undefined,
    cwdReady: Promise.resolve(),

    // Flat aliases (all point to the same grouped methods)
    createTerminal: fail,
    writeTerminal: fail,
    resizeTerminal: fail,
    destroyTerminal: fail,
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    readClipboardText: () => Promise.reject(new Error('Clipboard bridge is unavailable')),
    writeClipboardText: fail,
    getClipboardSnapshot: async () => ({ text: '', hasImage: false }),
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve({}),
    listShellProfiles: () => Promise.resolve({ profiles: [], defaultProfile: '' }),
    addShellProfile: fail,
    removeShellProfile: fail,
    setDefaultShellProfile: fail,
    detectShellProfiles: () => Promise.resolve([]),
    closeWindow: fail,
    openExternalUrl: fail,
    showContextMenu: () => {},
    listLayouts: () => Promise.resolve({ layouts: [], defaultLayoutId: '' }),
    saveLayout: fail,
    deleteLayout: fail,
    renameLayout: fail,
    openLayoutWindow: fail,
    openLayoutInNewWindow: fail,
    isWindowFullscreen: undefined,
    setWindowFullscreen: undefined,
    setLayoutAsDefault: fail,
  };
}

// ============================================================================
// Tauri Bridge
// ============================================================================

function createTauriBridge(tauri: TauriGlobal, windowLayoutId: string | null): Omit<Bridge, keyof FlatAliases> {
  const { invoke } = tauri.core;
  const { getCurrentWindow } = tauri.window;
  const { WebviewWindow } = tauri.webviewWindow;
  const { readText: clipboardReadText, writeText: clipboardWriteText } =
    tauri.clipboardManager;
  const { openUrl } = tauri.opener;

  function base64Encode(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  const currentWebview = tauri.webview.getCurrentWebview();

  function onTauriEvent<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const unlisten = currentWebview.listen(event, (e: { payload: T }) => handler(e.payload));
    return () => { unlisten.then((fn: () => void) => fn()); };
  }

  let _resolvedCwd = '.';
  const _cwdReady: Promise<void> = invoke<string>('get_cwd')
    .then((cwd) => { _resolvedCwd = cwd; })
    .catch(() => {});
  const currentWindow = getCurrentWindow();

  async function focusWindow(win: TauriWindow): Promise<void> {
    await win.unminimize().catch(() => {});
    await win.show().catch(() => {});
    await win.setFocus();
    await Promise.resolve(tauri.event?.emitTo?.(win.label, LAYOUT_FOCUS_NOTICE_EVENT))
      .catch(() => {});
  }

  function getLayoutWindowLabel(layoutId: string): string {
    const safeLabel = layoutId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `layout-${safeLabel}`;
  }

  async function openLayoutWindow(layoutId: string): Promise<void> {
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
    terminal: {
      create: (payload: TerminalCreatePayload) =>
        invoke('terminal_create', {
          paneId: payload.paneId,
          cols: payload.cols,
          rows: payload.rows,
          cwd: payload.cwd,
          shellProfileId: payload.shellProfileId ?? null,
        }),
      write: (payload: TerminalWritePayload) =>
        invoke('terminal_write', {
          paneId: payload.paneId,
          data: base64Encode(payload.data),
        }),
      resize: (payload: TerminalResizePayload) =>
        invoke('terminal_resize', {
          paneId: payload.paneId,
          cols: payload.cols,
          rows: payload.rows,
        }),
      destroy: (payload: TerminalDestroyPayload) =>
        invoke('terminal_destroy', { paneId: payload.paneId }),
      onData: (handler: (event: TerminalDataEvent) => void) =>
        onTauriEvent<TerminalDataEvent>('vibe99:terminal-data', handler),
      onExit: (handler: (event: TerminalExitEvent) => void) =>
        onTauriEvent<TerminalExitEvent>('vibe99:terminal-exit', handler),
    },
    clipboard: {
      read: () => clipboardReadText(),
      write: (text: string) => clipboardWriteText(text),
      snapshot: async () => {
        try {
          const text = await clipboardReadText();
          return { text: text ?? '', hasImage: false };
        } catch {
          return { text: '', hasImage: false };
        }
      },
    },
    settings: {
      load: () => invoke('settings_load'),
      save: (payload: SettingsData) => invoke('settings_save', { settings: payload }),
    },
    shell: {
      list: () => invoke('shell_profiles_list'),
      add: (profile: ShellProfileData) => invoke('shell_profile_add', { profile }),
      remove: (profileId: string) => invoke('shell_profile_remove', { profileId }),
      setDefault: (profileId: string) => invoke('shell_profile_set', { profileId }),
      detect: () => invoke('shell_profiles_detect'),
    },
    window: {
      close: () => getCurrentWindow().close(),
      openUrl: (url: string) => openUrl(url),
      showMenu: () => {},
    },
    layouts: {
      list: () => invoke('layouts_list'),
      save: (layout: LayoutData) => invoke('layout_save', { layout }),
      delete: (layoutId: string) => invoke('layout_delete', { layoutId }),
      rename: (layoutId: string, newName: string) => invoke('layout_rename', { layoutId, newName }),
      openWindow: (layoutId: string) => openLayoutWindow(layoutId),
      openInNewWindow: (layoutId: string) => openLayoutWindow(layoutId),
      isFullscreen: () => getCurrentWindow().isFullscreen(),
      setFullscreen: (fullscreen: boolean) => getCurrentWindow().setFullscreen(fullscreen),
      setAsDefault: (layoutId: string) => invoke('layout_set_default', { layoutId }),
    },
    onMenuAction: (handler: (event: MenuActionEvent) => void) =>
      onTauriEvent<MenuActionEvent>('vibe99:menu-action', handler),
    onLayoutFocusNotice: (handler: () => void) =>
      onTauriEvent<void>(LAYOUT_FOCUS_NOTICE_EVENT, handler),
    cwdReady: _cwdReady,
  };
}

// ============================================================================
// Bridge Factory
// ============================================================================

/**
 * Creates an IPC bridge instance.
 *
 * @param tauriOrFallback - The Tauri API object, or a fallback bridge instance.
 * @param windowLayoutId - The current window's layout ID (if any).
 * @returns A bridge object with grouped IPC methods by domain.
 *
 * The returned object has methods grouped by domain (terminal, clipboard, settings, etc.),
 * but also provides flat aliases for backward compatibility.
 *
 * Grouped access:
 * - bridge.terminal.create(...)
 * - bridge.clipboard.read()
 *
 * Flat access (for backward compatibility):
 * - bridge.createTerminal(...)
 * - bridge.readClipboardText()
 */
export function createBridge(
  tauriOrFallback: TauriGlobal | Partial<Bridge> | null,
  windowLayoutId: string | null = null,
): Bridge {
  let bridge: Bridge;

  if (tauriOrFallback && typeof tauriOrFallback === 'object' && 'core' in tauriOrFallback) {
    const partial = createTauriBridge(tauriOrFallback, windowLayoutId);
    bridge = {
      ...partial,
      createTerminal: partial.terminal.create,
      writeTerminal: partial.terminal.write,
      resizeTerminal: partial.terminal.resize,
      destroyTerminal: partial.terminal.destroy,
      onTerminalData: partial.terminal.onData,
      onTerminalExit: partial.terminal.onExit,
      readClipboardText: partial.clipboard.read,
      writeClipboardText: partial.clipboard.write,
      getClipboardSnapshot: partial.clipboard.snapshot,
      loadSettings: partial.settings.load,
      saveSettings: partial.settings.save,
      listShellProfiles: partial.shell.list,
      addShellProfile: partial.shell.add,
      removeShellProfile: partial.shell.remove,
      setDefaultShellProfile: partial.shell.setDefault,
      detectShellProfiles: partial.shell.detect,
      closeWindow: partial.window.close,
      openExternalUrl: partial.window.openUrl,
      showContextMenu: partial.window.showMenu,
      listLayouts: partial.layouts.list,
      saveLayout: partial.layouts.save,
      deleteLayout: partial.layouts.delete,
      renameLayout: partial.layouts.rename,
      openLayoutWindow: partial.layouts.openWindow,
      openLayoutInNewWindow: partial.layouts.openInNewWindow,
      isWindowFullscreen: partial.layouts.isFullscreen,
      setWindowFullscreen: partial.layouts.setFullscreen,
      setLayoutAsDefault: partial.layouts.setAsDefault,
    };
  } else if (tauriOrFallback && typeof tauriOrFallback === 'object') {
    // Assume it's a pre-configured fallback bridge (e.g., from window.vibe99)
    bridge = tauriOrFallback as Bridge;
  } else {
    bridge = createUnavailableBridge();
  }

  return bridge;
}

// Export utilities for external use
export {
  getRuntimePlatform,
  getDefaultFontFamily,
  basename,
  splitArgs,
  formatArgs,
  LAYOUT_FOCUS_NOTICE_EVENT,
  readLayoutWindowBindings,
  writeLayoutWindowBindings,
  getBoundLayoutWindowLabel,
  clearLayoutWindowBinding,
};
