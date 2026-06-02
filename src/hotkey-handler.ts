import type { Bridge, HotkeyBinding } from './bridge';

export interface HotkeyHandlerDeps {
  bridge: Bridge;
  reportError: (error: unknown) => void;
  windowLayoutId: string | null;
}

export interface HotkeyHandler {
  init: (layoutHotkeys: Record<string, string>) => Promise<void>;
  sync: (layoutHotkeys: Record<string, string>) => Promise<void>;
  dispose: () => void;
}

export function createHotkeyHandler(deps: HotkeyHandlerDeps): HotkeyHandler {
  const { bridge, reportError, windowLayoutId } = deps;

  let removeHotkeyListener: (() => void) | null = null;
  let toggleDebounce: number | null = null;

  function toBindings(layoutHotkeys: Record<string, string>): HotkeyBinding[] {
    return Object.entries(layoutHotkeys)
      .filter(([, shortcut]) => shortcut && typeof shortcut === 'string')
      .map(([layoutId, shortcut]) => ({ shortcut, layoutId }));
  }

  async function init(layoutHotkeys: Record<string, string>): Promise<void> {
    removeHotkeyListener = bridge.onHotkeyPressed((event) => {
      // hotkey:pressed is broadcast to all windows; only the main window
      // handles layout toggles to avoid double-toggle race conditions.
      if (windowLayoutId !== null) return;
      if (toggleDebounce !== null) return;
      toggleDebounce = window.setTimeout(() => { toggleDebounce = null; }, 150);
      bridge.layouts.toggleWindow(event.layoutId).catch(reportError);
    });

    await sync(layoutHotkeys);
  }

  async function sync(layoutHotkeys: Record<string, string>): Promise<void> {
    const bindings = toBindings(layoutHotkeys);
    await bridge.hotkey.registerAll(bindings).catch((e) => {
      console.error('[hotkey] registerAll failed', e);
      reportError(e);
    });
  }

  function dispose(): void {
    if (removeHotkeyListener) {
      removeHotkeyListener();
      removeHotkeyListener = null;
    }
    if (toggleDebounce !== null) {
      window.clearTimeout(toggleDebounce);
      toggleDebounce = null;
    }
  }

  return { init, sync, dispose };
}
