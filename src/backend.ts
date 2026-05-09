/**
 * Backend Layer — Domain-Grouped IPC Interface
 *
 * Provides Tauri backend capabilities organized by domain.
 * This is the new public API that capability modules depend on.
 */

// Re-export core types from bridge
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
} from './bridge';

// Re-export grouped API interfaces from bridge
export type {
  TerminalApi,
  ClipboardApi,
  SettingsApi,
  ShellApi,
  WindowApi,
} from './bridge';

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

// ============================================================================
// Internal Types
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

// ============================================================================
// Platform Utilities
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

function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ============================================================================
// Backend Factory
// ============================================================================

/**
 * Creates a Backend instance for Tauri.
 *
 * @param tauri - The Tauri API object from `window.__TAURI__`.
 * @returns A Backend object with domain-grouped IPC methods.
 *
 * Example:
 * ```ts
 * const backend = createBackend(window.__TAURI__);
 * await backend.terminal.create({ paneId: '1', cols: 80, rows: 24, cwd: '/' });
 * ```
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
    },

    window: {
      close: () => getCurrentWindow().close(),
      openUrl: (url: string) => void openUrl(url),
      showMenu: () => {},
    },

    cwdReady,
  };
}
