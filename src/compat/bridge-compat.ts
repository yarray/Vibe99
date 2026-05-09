/**
 * Bridge Compat — wraps Backend to expose the legacy Bridge interface.
 *
 * Also contains the full `createBridge` factory and layout-window utilities
 * that used to live in `bridge.ts`.
 *
 * @module compat/bridge-compat
 */

import type {
  Backend,
  Platform,
  TerminalCreatePayload,
  TerminalWritePayload,
  TerminalResizePayload,
  TerminalDestroyPayload,
  TerminalDataEvent,
  TerminalExitEvent,
  ShellProfileData,
  ShellProfilesListResult,
  SettingsData,
  ClipboardSnapshot,
  TerminalApi,
  ClipboardApi,
  SettingsApi,
  ShellApi,
  WindowApi,
} from '../backend';

export type {
  Platform,
  TerminalCreatePayload,
  TerminalWritePayload,
  TerminalResizePayload,
  TerminalDestroyPayload,
  TerminalDataEvent,
  TerminalExitEvent,
  ShellProfileData,
  ShellProfilesListResult,
  SettingsData,
  ClipboardSnapshot,
  TerminalApi,
  ClipboardApi,
  SettingsApi,
  ShellApi,
  WindowApi,
};

// ---------------------------------------------------------------------------
// Bridge-specific types
// ---------------------------------------------------------------------------

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
  redetectWsl: ShellApi['redetectWsl'];

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

// ---------------------------------------------------------------------------
// Internal Tauri types
// ---------------------------------------------------------------------------

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

interface TauriWindow {
  label: string;
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  setFocus: () => Promise<void>;
  close: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
}

interface TauriWebview {
  listen: <T = unknown>(
    event: string,
    handler: (e: { payload: T }) => void,
  ) => Promise<() => void>;
}

// ---------------------------------------------------------------------------
// Platform & Path Utilities
// ---------------------------------------------------------------------------

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

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || '/';
}

function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Layout Window Bindings
// ---------------------------------------------------------------------------

const LAYOUT_FOCUS_NOTICE_EVENT = 'vibe99:layout-focus-notice';
const LAYOUT_WINDOW_BINDINGS_KEY = 'vibe99.layoutWindowBindings';

type LayoutWindowBindings = Record<string, string>;

export function readLayoutWindowBindings(): LayoutWindowBindings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAYOUT_WINDOW_BINDINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLayoutWindowBindings(bindings: LayoutWindowBindings): void {
  try {
    window.localStorage.setItem(LAYOUT_WINDOW_BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // Best effort only.
  }
}

export function getBoundLayoutWindowLabel(layoutId: string): string | null {
  const label = readLayoutWindowBindings()[layoutId];
  return typeof label === 'string' && label ? label : null;
}

export function clearLayoutWindowBinding(layoutId: string | undefined, expectedLabel: string | null = null): void {
  if (!layoutId) return;
  const bindings = readLayoutWindowBindings();
  if (expectedLabel !== null && bindings[layoutId] !== expectedLabel) return;
  delete bindings[layoutId];
  writeLayoutWindowBindings(bindings);
}

// ---------------------------------------------------------------------------
// Unavailable Bridge (Fallback)
// ---------------------------------------------------------------------------

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
      redetectWsl: () => Promise.resolve({ available: false, distributions: [], defaultShell: null }),
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
    redetectWsl: () => Promise.resolve({ available: false, distributions: [], defaultShell: null }),
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

// ---------------------------------------------------------------------------
// Tauri Bridge
// ---------------------------------------------------------------------------

function createTauriBridge(tauri: TauriGlobal, windowLayoutId: string | null): Omit<Bridge, 'createTerminal' | 'writeTerminal' | 'resizeTerminal' | 'destroyTerminal' | 'onTerminalData' | 'onTerminalExit' | 'readClipboardText' | 'writeClipboardText' | 'getClipboardSnapshot' | 'loadSettings' | 'saveSettings' | 'listShellProfiles' | 'addShellProfile' | 'removeShellProfile' | 'setDefaultShellProfile' | 'detectShellProfiles' | 'redetectWsl' | 'closeWindow' | 'openExternalUrl' | 'showContextMenu' | 'listLayouts' | 'saveLayout' | 'deleteLayout' | 'renameLayout' | 'openLayoutWindow' | 'openLayoutInNewWindow' | 'isWindowFullscreen' | 'setWindowFullscreen' | 'setLayoutAsDefault'> {
  const { invoke } = tauri.core;
  const { getCurrentWindow } = tauri.window;
  const { WebviewWindow } = tauri.webviewWindow;
  const { readText: clipboardReadText, writeText: clipboardWriteText } =
    tauri.clipboardManager;
  const { openUrl } = tauri.opener;

  const currentWebview = tauri.webview.getCurrentWebview();

  function onTauriEvent<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const unlisten = currentWebview.listen(event, (e: { payload: T }) => handler(e.payload));
    return () => { void unlisten.then((fn: () => void) => fn()); };
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

    if (layoutId !== 'default') {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        return focusWindow(existing);
      }
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
      redetectWsl: () => invoke('wsl_redetect'),
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

// ---------------------------------------------------------------------------
// Bridge Factory
// ---------------------------------------------------------------------------

/**
 * Creates an IPC bridge instance.
 *
 * @param tauriOrFallback - The Tauri API object, or a fallback bridge instance.
 * @param windowLayoutId - The current window's layout ID (if any).
 * @returns A bridge object with grouped IPC methods by domain.
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
      redetectWsl: partial.shell.redetectWsl,
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
    bridge = tauriOrFallback as Bridge;
  } else {
    bridge = createUnavailableBridge();
  }

  return bridge;
}

// ---------------------------------------------------------------------------
// BridgeCompat factory
// ---------------------------------------------------------------------------

export interface BridgeCompatDeps {
  backend: Backend;
  tauri: unknown;
  currentWindowLabel: string;
  defaultCwd: string;
  defaultTabTitle: string;
  layouts: Bridge['layouts'];
  onMenuAction: Bridge['onMenuAction'];
  onLayoutFocusNotice: Bridge['onLayoutFocusNotice'];
}

export function createBridgeCompat(deps: BridgeCompatDeps): Bridge {
  const { backend, currentWindowLabel, defaultCwd, defaultTabTitle } = deps;

  return {
    platform: backend.platform as Platform,
    currentWindowLabel,
    defaultCwd,
    defaultTabTitle,

    terminal: backend.terminal,
    clipboard: backend.clipboard,
    settings: backend.settings,
    shell: backend.shell,
    window: backend.window,
    layouts: deps.layouts,

    onMenuAction: deps.onMenuAction,
    onLayoutFocusNotice: deps.onLayoutFocusNotice,
    cwdReady: backend.cwdReady,

    createTerminal: backend.terminal.create,
    writeTerminal: backend.terminal.write,
    resizeTerminal: backend.terminal.resize,
    destroyTerminal: backend.terminal.destroy,
    onTerminalData: backend.terminal.onData,
    onTerminalExit: backend.terminal.onExit,

    readClipboardText: backend.clipboard.read,
    writeClipboardText: backend.clipboard.write,
    getClipboardSnapshot: backend.clipboard.snapshot,

    loadSettings: backend.settings.load,
    saveSettings: backend.settings.save,

    listShellProfiles: backend.shell.list,
    addShellProfile: backend.shell.add,
    removeShellProfile: backend.shell.remove,
    setDefaultShellProfile: backend.shell.setDefault,
    detectShellProfiles: backend.shell.detect,
    redetectWsl: backend.shell.redetectWsl,

    closeWindow: backend.window.close,
    openExternalUrl: backend.window.openUrl,
    showContextMenu: backend.window.showMenu,

    listLayouts: deps.layouts.list,
    saveLayout: deps.layouts.save,
    deleteLayout: deps.layouts.delete,
    renameLayout: deps.layouts.rename,
    openLayoutWindow: deps.layouts.openWindow,
    openLayoutInNewWindow: deps.layouts.openInNewWindow,
    isWindowFullscreen: deps.layouts.isFullscreen,
    setWindowFullscreen: deps.layouts.setFullscreen,
    setLayoutAsDefault: deps.layouts.setAsDefault,
  };
}
