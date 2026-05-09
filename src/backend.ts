/**
 * Backend Layer — Domain-Grouped IPC Interface
 *
 * Provides Tauri backend capabilities organized by domain.
 * This is the new public API that capability modules depend on.
 */

export type Platform = 'win32' | 'darwin' | 'linux';

export interface TerminalCreatePayload {
  paneId: string;
  cols: number;
  rows: number;
  cwd: string;
  shellProfileId?: string | null;
}

export interface TerminalWritePayload {
  paneId: string;
  data: string;
}

export interface TerminalResizePayload {
  paneId: string;
  cols: number;
  rows: number;
}

export interface TerminalDestroyPayload {
  paneId: string;
}

export interface TerminalDataEvent {
  paneId: string;
  data: string;
}

export interface TerminalExitEvent {
  paneId: string;
  exitCode: number;
  reason: string;
}

export interface ShellProfilesListResult {
  profiles: ShellProfileData[];
  defaultProfile: string;
}

export interface ShellProfileData {
  id: string;
  name?: string;
  path?: string;
  args?: string;
  [key: string]: unknown;
}

export interface ClipboardSnapshot {
  text: string;
  hasImage: boolean;
}

export type SettingsData = Record<string, unknown>;

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
  redetectWsl: () => Promise<{ available: boolean; distributions: string[]; defaultShell: string | null }>;
}

export interface WindowApi {
  close: () => Promise<void>;
  openUrl: (url: string) => void;
  showMenu: () => void;
}

/**
 * Backend interface — domain-grouped Tauri capabilities.
 *
 * Simpler than Bridge: no flat aliases, no layout-specific concerns.
 * Focuses on core backend capabilities by domain.
 */
export interface Backend {
  // Platform info
  platform: Platform;

  // Domain-grouped APIs
  terminal: TerminalApi;
  clipboard: ClipboardApi;
  settings: SettingsApi;
  shell: ShellApi;
  window: WindowApi;

  // Lifecycle
  cwdReady: Promise<void>;
}

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
  close: () => Promise<void>;
}

interface TauriWebview {
  listen: <T = unknown>(
    event: string,
    handler: (e: { payload: T }) => void,
  ) => Promise<() => void>;
}

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

function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Creates a Backend instance for Tauri.
 */
export function createBackend(tauri: TauriGlobal): Backend {
  const { invoke } = tauri.core;
  const { getCurrentWindow } = tauri.window;
  const { readText: clipboardReadText, writeText: clipboardWriteText } =
    tauri.clipboardManager;
  const { openUrl } = tauri.opener;

  const currentWebview = tauri.webview.getCurrentWebview();

  function onTauriEvent<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const unlisten = currentWebview.listen(event, (e: { payload: T }) => handler(e.payload));
    return () => { void unlisten.then((fn: () => void) => fn()); };
  }

  let _resolvedCwd = '.';
  const cwdReady: Promise<void> = invoke<string>('get_cwd')
    .then((cwd) => { _resolvedCwd = cwd; })
    .catch(() => {});

  return {
    platform: getRuntimePlatform(),

    terminal: {
      create: (payload) =>
        invoke('terminal_create', {
          paneId: payload.paneId,
          cols: payload.cols,
          rows: payload.rows,
          cwd: payload.cwd,
          shellProfileId: payload.shellProfileId ?? null,
        }),
      write: (payload) =>
        invoke('terminal_write', {
          paneId: payload.paneId,
          data: base64Encode(payload.data),
        }),
      resize: (payload) =>
        invoke('terminal_resize', {
          paneId: payload.paneId,
          cols: payload.cols,
          rows: payload.rows,
        }),
      destroy: (payload) =>
        invoke('terminal_destroy', { paneId: payload.paneId }),
      onData: (handler) =>
        onTauriEvent('vibe99:terminal-data', handler),
      onExit: (handler) =>
        onTauriEvent('vibe99:terminal-exit', handler),
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
      save: (payload) => invoke('settings_save', { settings: payload }),
    },

    shell: {
      list: () => invoke('shell_profiles_list'),
      add: (profile) => invoke('shell_profile_add', { profile }),
      remove: (profileId: string) => invoke('shell_profile_remove', { profileId }),
      setDefault: (profileId: string) => invoke('shell_profile_set', { profileId }),
      detect: () => invoke('shell_profiles_detect'),
      redetectWsl: () => invoke('wsl_redetect'),
    },

    window: {
      close: () => getCurrentWindow().close(),
      openUrl: (url: string) => void openUrl(url),
      showMenu: () => {},
    },

    cwdReady,
  };
}
