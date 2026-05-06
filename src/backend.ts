/**
 * Backend Layer - Domain-Grouped IPC Interface
 *
 * This module provides a clean, domain-grouped interface to Tauri's backend IPC commands.
 * Each domain (terminal, clipboard, settings, etc.) exposes only its relevant operations.
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

// ============================================================================
// Domain API Interfaces
// ============================================================================

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

// ============================================================================
// Backend Interface
// ============================================================================

export interface Backend {
  // Identity
  platform: Platform;
  currentWindowLabel: string;
  defaultCwd: string;
  defaultTabTitle: string;

  // Domain APIs
  terminal: TerminalApi;
  clipboard: ClipboardApi;
  settings: SettingsApi;
  shell: ShellApi;
  window: WindowApi;
  layouts: LayoutsApi;

  // Event listeners
  onMenuAction: (handler: (event: MenuActionEvent) => void) => () => void;
  onLayoutFocusNotice: ((handler: () => void) => () => void) | undefined;

  // Lifecycle
  cwdReady: Promise<void>;
}

// ============================================================================
// Tauri Types
// ============================================================================

/**
 * Minimal shape of `window.__TAURI__` — the global Tauri API object.
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

// ============================================================================
// Utilities
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

// Layout window bindings
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
    // Best effort
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

// ============================================================================
// Unavailable Backend (Fallback)
// ============================================================================

function createUnavailableBackend(): Backend {
  const fail = (): never => {
    throw new Error('Backend is unavailable');
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
      read: () => Promise.reject(new Error('Clipboard is unavailable')),
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
  };
}

// ============================================================================
// Tauri Backend
// ============================================================================

function createTauriBackend(tauri: TauriGlobal, windowLayoutId: string | null): Backend {
  const { invoke } = tauri.core;
  const { getCurrentWindow } = tauri.window;
  const { WebviewWindow } = tauri.webviewWindow;
  const { readText: clipboardReadText, writeText: clipboardWriteText } = tauri.clipboardManager;
  const { openUrl } = tauri.opener;

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
// Backend Factory
// ============================================================================

/**
 * Creates a backend instance with domain-grouped IPC methods.
 *
 * @param tauriOrFallback - The Tauri API object, or a fallback backend instance.
 * @param windowLayoutId - The current window's layout ID (if any).
 * @returns A backend object with grouped IPC methods by domain.
 *
 * Usage:
 * - backend.terminal.create(...)
 * - backend.clipboard.read()
 * - backend.settings.load()
 */
export function createBackend(
  tauriOrFallback: TauriGlobal | Partial<Backend> | null,
  windowLayoutId: string | null = null,
): Backend {
  if (tauriOrFallback && typeof tauriOrFallback === 'object' && 'core' in tauriOrFallback) {
    return createTauriBackend(tauriOrFallback, windowLayoutId);
  } else if (tauriOrFallback && typeof tauriOrFallback === 'object') {
    return tauriOrFallback as Backend;
  } else {
    return createUnavailableBackend();
  }
}

// Export utilities for external use
export {
  basename,
  clearLayoutWindowBinding,
  getBoundLayoutWindowLabel,
  readLayoutWindowBindings,
  writeLayoutWindowBindings,
  LAYOUT_FOCUS_NOTICE_EVENT,
  getRuntimePlatform,
};
