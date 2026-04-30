/**
 * IPC Bridge Layer
 *
 * This is the lowest-level module with zero external dependencies.
 * It provides a unified interface to Tauri's backend IPC commands.
 */

// ============================================================================
// Platform & Path Utilities
// ============================================================================

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

// ============================================================================
// Argument Parsing Utilities
// ============================================================================

/**
 * Splits a command-line string into an array of arguments.
 * Handles quoted strings (single and double quotes).
 */
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

/**
 * Converts a string array back to a shell-quoted command-line string.
 * This is the inverse of splitArgs(): formatArgs(splitArgs(s)) === s for any s.
 */
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

// ============================================================================
// Layout Window Bindings
// ============================================================================

const LAYOUT_FOCUS_NOTICE_EVENT = 'vibe99:layout-focus-notice';
const LAYOUT_WINDOW_BINDINGS_KEY = 'vibe99.layoutWindowBindings';

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

// ============================================================================
// Unavailable Bridge (Fallback)
// ============================================================================

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
      snapshot: () => ({ text: '', hasImage: false }),
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
    cwdReady: Promise.resolve(),
  };
}

// ============================================================================
// Tauri Bridge
// ============================================================================

function createTauriBridge(tauri, windowLayoutId) {
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
      onData: (handler) => onTauriEvent('vibe99:terminal-data', handler),
      onExit: (handler) => onTauriEvent('vibe99:terminal-exit', handler),
    },
    clipboard: {
      read: () => clipboardReadText(),
      write: (text) => clipboardWriteText(text),
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
      remove: (profileId) => invoke('shell_profile_remove', { profileId }),
      setDefault: (profileId) => invoke('shell_profile_set', { profileId }),
      detect: () => invoke('shell_profiles_detect'),
    },
    window: {
      close: () => getCurrentWindow().close(),
      openUrl: (url) => openUrl(url),
      showMenu: () => {},
    },
    layouts: {
      list: () => invoke('layouts_list'),
      save: (layout) => invoke('layout_save', { layout }),
      delete: (layoutId) => invoke('layout_delete', { layoutId }),
      rename: (layoutId, newName) => invoke('layout_rename', { layoutId, newName }),
      openWindow: (layoutId) => openLayoutWindow(layoutId),
      openInNewWindow: (layoutId) => openLayoutWindow(layoutId),
      isFullscreen: () => getCurrentWindow().isFullscreen(),
      setFullscreen: (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
      setAsDefault: (layoutId) => invoke('layout_set_default', { layoutId }),
    },
    onMenuAction: (handler) => onTauriEvent('vibe99:menu-action', handler),
    onLayoutFocusNotice: (handler) => onTauriEvent(LAYOUT_FOCUS_NOTICE_EVENT, handler),
    cwdReady: _cwdReady,
  };
}

// ============================================================================
// Bridge Factory
// ============================================================================

/**
 * Creates an IPC bridge instance.
 *
 * @param {Object} tauriOrFallback - The Tauri API object, or a fallback bridge instance.
 * @param {string} [windowLayoutId] - The current window's layout ID (if any).
 * @returns {Object} A bridge object with grouped IPC methods by domain.
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
export function createBridge(tauriOrFallback, windowLayoutId = null) {
  let bridge;

  if (tauriOrFallback && typeof tauriOrFallback === 'object' && tauriOrFallback.core) {
    bridge = createTauriBridge(tauriOrFallback, windowLayoutId);
  } else if (tauriOrFallback && typeof tauriOrFallback === 'object') {
    // Assume it's a pre-configured fallback bridge (e.g., from window.vibe99)
    bridge = tauriOrFallback;
  } else {
    bridge = createUnavailableBridge();
  }

  // Add flat aliases for backward compatibility
  // This allows existing code to use bridge.createTerminal() instead of bridge.terminal.create()
  if (bridge.terminal) {
    bridge.createTerminal = bridge.terminal.create;
    bridge.writeTerminal = bridge.terminal.write;
    bridge.resizeTerminal = bridge.terminal.resize;
    bridge.destroyTerminal = bridge.terminal.destroy;
    bridge.onTerminalData = bridge.terminal.onData;
    bridge.onTerminalExit = bridge.terminal.onExit;
  }
  if (bridge.clipboard) {
    bridge.readClipboardText = bridge.clipboard.read;
    bridge.writeClipboardText = bridge.clipboard.write;
    bridge.getClipboardSnapshot = bridge.clipboard.snapshot;
  }
  if (bridge.settings) {
    bridge.loadSettings = bridge.settings.load;
    bridge.saveSettings = bridge.settings.save;
  }
  if (bridge.shell) {
    bridge.listShellProfiles = bridge.shell.list;
    bridge.addShellProfile = bridge.shell.add;
    bridge.removeShellProfile = bridge.shell.remove;
    bridge.setDefaultShellProfile = bridge.shell.setDefault;
    bridge.detectShellProfiles = bridge.shell.detect;
  }
  if (bridge.window) {
    bridge.closeWindow = bridge.window.close;
    bridge.openExternalUrl = bridge.window.openUrl;
    bridge.showContextMenu = bridge.window.showMenu;
  }
  if (bridge.layouts) {
    bridge.listLayouts = bridge.layouts.list;
    bridge.saveLayout = bridge.layouts.save;
    bridge.deleteLayout = bridge.layouts.delete;
    bridge.renameLayout = bridge.layouts.rename;
    bridge.openLayoutWindow = bridge.layouts.openWindow;
    bridge.openLayoutInNewWindow = bridge.layouts.openInNewWindow;
    bridge.isWindowFullscreen = bridge.layouts.isFullscreen;
    bridge.setWindowFullscreen = bridge.layouts.setFullscreen;
    bridge.setLayoutAsDefault = bridge.layouts.setAsDefault;
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
