import type { Bridge, HotkeyBinding } from './bridge';

export interface HotkeyHandlerDeps {
  bridge: Bridge;
  reportError: (error: unknown) => void;
  isMainWindow: () => boolean;
}

export interface HotkeyHandler {
  init: (layoutHotkeys: Record<string, string>) => Promise<void>;
  sync: (layoutHotkeys: Record<string, string>) => Promise<void>;
  dispose: () => void;
}

export function createHotkeyHandler(deps: HotkeyHandlerDeps): HotkeyHandler {
  const { bridge, reportError, isMainWindow } = deps;

  let removeHotkeyListener: (() => void) | null = null;

  function toBindings(layoutHotkeys: Record<string, string>): HotkeyBinding[] {
    return Object.entries(layoutHotkeys)
      .filter(([, shortcut]) => shortcut && typeof shortcut === 'string')
      .map(([layoutId, shortcut]) => ({ shortcut, layoutId }));
  }

  async function init(layoutHotkeys: Record<string, string>): Promise<void> {
    if (!isMainWindow()) return;

    removeHotkeyListener = bridge.onHotkeyPressed((event) => {
      bridge.layouts.toggleWindow(event.layoutId).catch(reportError);
    });

    await sync(layoutHotkeys);
  }

  async function sync(layoutHotkeys: Record<string, string>): Promise<void> {
    if (!isMainWindow()) return;
    const bindings = toBindings(layoutHotkeys);
    if (bindings.length === 0) return;
    await bridge.hotkey.registerAll(bindings).catch(reportError);
  }

  function dispose(): void {
    if (removeHotkeyListener) {
      removeHotkeyListener();
      removeHotkeyListener = null;
    }
  }

  return { init, sync, dispose };
}
