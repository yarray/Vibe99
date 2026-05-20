/**
 * Hotkey Handler Module
 *
 * Handles global hotkey events for toggling Layout windows with Quake-style animation.
 * Listens for Tauri events and manages window show/hide with optional animations.
 *
 * Design principles:
 * - Integrates with quake-animation for smooth show/hide
 * - Manages per-layout window state
 * - Respects Quake mode settings
 *
 * @module hotkey-handler
 */

import * as QuakeAnimation from './quake-animation';
import type { Bridge, LayoutData } from './bridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Hotkey pressed event payload from Tauri
 */
export interface HotkeyPressedEvent {
  layoutId: string;
  shortcut: string;
}

/**
 * Tauri global interface for hotkey events
 */
interface TauriGlobalForHotkey {
  webview: {
    getCurrentWebview: () => {
      listen: <T = unknown>(
        event: string,
        handler: (e: { payload: T }) => void,
      ) => Promise<() => void>;
    };
  };
  webviewWindow: {
    WebviewWindow: {
      getByLabel: (label: string) => Promise<{
        show: () => Promise<void>;
        hide: () => Promise<void>;
        setSize: (size: { width: number; height: number }) => Promise<void>;
        setPosition: (position: { x: number; y: number }) => Promise<void>;
        setFocus: () => Promise<void>;
        unminimize: () => Promise<void>;
      } | null>;
    };
  };
}

/**
 * Wrapper to convert Tauri window to QuakeAnimationWindow
 */
function wrapWindowForAnimation(win: {
  show: () => Promise<void>;
  hide: () => Promise<void>;
  setSize: (size: { width: number; height: number }) => Promise<void>;
  setPosition: (position: { x: number; y: number }) => Promise<void>;
}): QuakeAnimation.QuakeAnimationWindow {
  return {
    show: () => win.show(),
    hide: () => win.hide(),
    setSize: (size) => win.setSize(size),
    setPosition: (pos) => win.setPosition(pos),
  };
}

/**
 * Quake mode settings from the app settings
 */
interface QuakeSettings {
  enabled: boolean;
  animationDuration: number;
  screenPosition: 'top' | 'bottom';
  heightPercent: number;
}

/**
 * Hotkey handler dependencies
 */
export interface HotkeyHandlerDeps {
  /** The Tauri global API */
  tauri: TauriGlobalForHotkey;
  /** The bridge for Layout operations */
  bridge: Bridge;
  /** Function to get current quake mode settings */
  getQuakeSettings: () => QuakeSettings | null;
  /** Optional callback when window is shown */
  onWindowShown?: (layoutId: string) => void;
  /** Optional callback when window is hidden */
  onWindowHidden?: (layoutId: string) => void;
}

/**
 * Hotkey handler interface
 */
export interface HotkeyHandler {
  /** Start listening for hotkey events */
  start: () => Promise<void>;
  /** Stop listening for hotkey events */
  stop: () => void;
  /** Check if currently listening */
  isListening: () => boolean;
}

// ---------------------------------------------------------------------------
// Window State Management
// ---------------------------------------------------------------------------

/**
 * Track visibility state of Layout windows toggled via hotkey
 */
const windowVisibilityState = new Map<string, boolean>();

/**
 * Get the window label for a Layout
 */
function getLayoutWindowLabel(layoutId: string): string {
  // Match the naming convention in bridge.ts
  const safeLabel = layoutId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `layout-${safeLabel}`;
}

/**
 * Check if a Layout window is currently visible (according to our tracking)
 */
function isWindowVisible(layoutId: string): boolean {
  return windowVisibilityState.get(layoutId) === true;
}

/**
 * Set the visibility state for a Layout window
 */
function setWindowVisible(layoutId: string, visible: boolean): void {
  windowVisibilityState.set(layoutId, visible);
}

// ---------------------------------------------------------------------------
// Hotkey Event Handler
// ---------------------------------------------------------------------------

/**
 * Handle a hotkey press event
 */
async function handleHotkeyPressed(
  event: HotkeyPressedEvent,
  deps: HotkeyHandlerDeps,
): Promise<void> {
  const { layoutId } = event;
  const { bridge, getQuakeSettings, onWindowShown, onWindowHidden } = deps;

  const quakeSettings = getQuakeSettings();
  const quakeConfig = quakeSettings
    ? QuakeAnimation.parseQuakeModeConfig(quakeSettings)
    : QuakeAnimation.DEFAULT_QUAKE_MODE;

  const label = getLayoutWindowLabel(layoutId);
  const existingWindow = await deps.tauri.webviewWindow.WebviewWindow.getByLabel(label);

  if (existingWindow) {
    // Window exists, toggle visibility
    const animWindow = wrapWindowForAnimation(existingWindow);
    if (isWindowVisible(layoutId)) {
      // Hide the window
      if (quakeConfig.enabled) {
        await QuakeAnimation.hideWithQuakeAnimation(animWindow, quakeConfig);
      } else {
        await existingWindow.hide();
      }
      setWindowVisible(layoutId, false);
      onWindowHidden?.(layoutId);
    } else {
      // Show the window
      if (quakeConfig.enabled) {
        await QuakeAnimation.showWithQuakeAnimation(animWindow, quakeConfig);
      } else {
        await existingWindow.unminimize().catch(() => {});
        await existingWindow.show();
      }
      await existingWindow.setFocus();
      setWindowVisible(layoutId, true);
      onWindowShown?.(layoutId);
    }
  } else {
    // Window doesn't exist, create it using the bridge
    await bridge.layouts.openWindow(layoutId);
    setWindowVisible(layoutId, true);
    onWindowShown?.(layoutId);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a hotkey handler instance
 */
export function createHotkeyHandler(deps: HotkeyHandlerDeps): HotkeyHandler {
  let unlisten: (() => void) | null = null;
  let listening = false;

  return {
    async start(): Promise<void> {
      if (listening) return;

      const webview = deps.tauri.webview.getCurrentWebview();

      // Listen for hotkey pressed events from Tauri
      unlisten = await webview.listen<HotkeyPressedEvent>(
        'hotkey:pressed',
        (e) => {
          void handleHotkeyPressed(e.payload, deps);
        },
      );

      listening = true;
    },

    stop(): void {
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      listening = false;
    },

    isListening(): boolean {
      return listening;
    },
  };
}

// ---------------------------------------------------------------------------
// Initialization Helper
// ---------------------------------------------------------------------------

/**
 * Initialize hotkey handling for the app
 *
 * This helper creates and starts a hotkey handler with standard setup.
 * Call this during app initialization to enable global hotkey support.
 *
 * @param tauri - The Tauri global API
 * @param bridge - The bridge for Layout operations
 * @param getQuakeSettings - Function to get current quake settings
 * @returns The hotkey handler instance
 */
export async function initializeHotkeyHandler(
  tauri: TauriGlobalForHotkey,
  bridge: Bridge,
  getQuakeSettings: () => QuakeSettings | null,
): Promise<HotkeyHandler> {
  const handler = createHotkeyHandler({
    tauri,
    bridge,
    getQuakeSettings,
  });

  await handler.start();
  return handler;
}

/**
 * Update visibility state for a Layout window
 *
 * Call this when a window is shown/hidden through other means (not hotkey)
 * to keep our tracking in sync.
 *
 * @param layoutId - The Layout ID
 * @param visible - Whether the window is visible
 */
export function updateWindowVisibilityState(layoutId: string, visible: boolean): void {
  setWindowVisible(layoutId, visible);
}

/**
 * Get the visibility state for a Layout window
 *
 * @param layoutId - The Layout ID
 * @returns Whether the window is tracked as visible
 */
export function getWindowVisibilityState(layoutId: string): boolean {
  return isWindowVisible(layoutId);
}

/**
 * Clear all visibility state
 *
 * Call this when the app is shutting down or when all windows are closed.
 */
export function clearWindowVisibilityState(): void {
  windowVisibilityState.clear();
}
