/**
 * Bridge Compat — wraps Backend to expose the legacy Bridge interface.
 * @module compat/bridge-compat
 */

import type { Backend } from '../backend';
import type {
  Bridge,
  Platform,
  TerminalCreatePayload,
  TerminalWritePayload,
  TerminalResizePayload,
  TerminalDestroyPayload,
  TerminalDataEvent,
  TerminalExitEvent,
  MenuActionEvent,
  LayoutData,
  LayoutsListResult,
  LayoutSaveResult,
  ShellProfileData,
  ShellProfilesListResult,
  SettingsData,
  ClipboardSnapshot,
} from '../bridge';

export type { Bridge };

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
