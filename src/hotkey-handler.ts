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

  function toBindings(layoutHotkeys: Record<string, string>): HotkeyBinding[] {
    return Object.entries(layoutHotkeys)
      .filter(([, shortcut]) => shortcut && typeof shortcut === 'string')
      .map(([layoutId, shortcut]) => ({ shortcut, layoutId }));
  }

  async function init(layoutHotkeys: Record<string, string>): Promise<void> {
    removeHotkeyListener = bridge.onHotkeyPressed((event) => {
      // Only handle if this window is the target layout or main window
      if (windowLayoutId !== null && event.layoutId !== windowLayoutId) return;
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
  }

  return { init, sync, dispose };
}
