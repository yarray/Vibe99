/**
 * Float Window Manager
 *
 * Creates and manages a per-window floating indicator showing compact color
 * blocks for each pane. Lives in the main/layout window and communicates with
 * the float window via Tauri events.
 *
 * Design: one float window per layout window. Label convention:
 *   float window label = `float-{parentWindowLabel}`
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TauriWindow {
  label: string;
  close: () => Promise<void>;
  once: (event: string, handler: () => void) => Promise<() => void>;
}

interface TauriGlobal {
  webviewWindow: {
    WebviewWindow: {
      new (label: string, options: Record<string, unknown>): TauriWindow;
      getByLabel: (label: string) => Promise<TauriWindow | null>;
    };
  };
  event?: {
    emitTo?: (target: string, event: string, payload?: unknown) => Promise<void>;
  };
  webview: {
    getCurrentWebview: () => {
      listen: <T = unknown>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
    };
  };
}

export interface FloatPaneSnapshot {
  id: string;
  accent: string;
  alerted: boolean;
}

export interface FloatWindowDeps {
  tauri: TauriGlobal;
  currentWindowLabel: string;
  onFocusPane: (paneId: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface FloatWindowManager {
  /** Open the float window (noop if already open). */
  open: () => Promise<void>;
  /** Close the float window (noop if not open). */
  close: () => Promise<void>;
  /** Toggle the float window open/closed. */
  toggle: () => Promise<void>;
  /** Whether the float window is currently open. */
  isOpen: () => boolean;
  /** Push the latest pane snapshot to the float window. */
  syncPanes: (panes: FloatPaneSnapshot[]) => void;
}

export interface FloatWindowState {
  isOpen: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANES_EVENT = 'vibe99:float-panes';
const FOCUS_PANE_EVENT = 'vibe99:float-focus-pane';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFloatWindowManager(deps: FloatWindowDeps): FloatWindowManager {
  const { tauri, currentWindowLabel, onFocusPane, onOpen, onClose } = deps;
  const floatLabel = `float-${currentWindowLabel}`;

  let isOpenFlag = false;
  let unlistenFocusPane: (() => void) | null = null;
  let lastSnapshot: FloatPaneSnapshot[] = [];

  function getFloatUrl(): string {
    return `float.html?label=${encodeURIComponent(currentWindowLabel)}`;
  }

  async function ensureListener(): Promise<void> {
    if (unlistenFocusPane) return;
    const webview = tauri.webview.getCurrentWebview();
    const unlisten = await webview.listen<{ paneId: string }>(FOCUS_PANE_EVENT, (e) => {
      onFocusPane(e.payload.paneId);
    });
    unlistenFocusPane = () => { unlisten(); };
  }

  function emitPanes(panes: FloatPaneSnapshot[]): void {
    if (!isOpenFlag) return;
    void tauri.event?.emitTo?.(floatLabel, PANES_EVENT, { panes }).catch(() => {});
  }

  return {
    async open(): Promise<void> {
      if (isOpenFlag) {
        // Verify the window still exists (it may have been closed externally)
        const existing = await tauri.webviewWindow.WebviewWindow.getByLabel(floatLabel);
        if (existing) {
          emitPanes(lastSnapshot);
          return;
        }
        isOpenFlag = false;
      }

      await ensureListener();

      const { WebviewWindow } = tauri.webviewWindow;
      new WebviewWindow(floatLabel, {
        url: getFloatUrl(),
        title: 'Vibe99 Float',
        width: 56,
        height: 52,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        shadow: false,
        visible: true,
        center: false,
      });

      isOpenFlag = true;
      onOpen?.();
      emitPanes(lastSnapshot);
    },

    async close(): Promise<void> {
      if (!isOpenFlag) return;
      const existing = await tauri.webviewWindow.WebviewWindow.getByLabel(floatLabel);
      if (existing) {
        await existing.close().catch(() => {});
      }
      isOpenFlag = false;
      onClose?.();
    },

    async toggle(): Promise<void> {
      if (isOpenFlag) {
        await this.close();
      } else {
        await this.open();
      }
    },

    isOpen(): boolean {
      return isOpenFlag;
    },

    syncPanes(panes: FloatPaneSnapshot[]): void {
      lastSnapshot = panes;
      emitPanes(panes);
    },
  };
}
