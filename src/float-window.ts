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

/** Lightweight pane descriptor consumed by the float window sync. */
export interface FloatPaneDescriptor {
  id: string;
  accent: string;
  customColor?: string;
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
  getPanes: () => FloatPaneDescriptor[];
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
  /** Record that a pane has triggered an alert. */
  noteAlert: (paneId: string) => void;
  /** Clear the alert state for a pane. */
  noteClear: (paneId: string) => void;
  /** Sync the current pane state to the float window. */
  sync: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANES_EVENT = 'vibe99:float-panes';
const FOCUS_PANE_EVENT = 'vibe99:float-focus-pane';
const READY_EVENT = 'vibe99:float-ready';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFloatWindowManager(deps: FloatWindowDeps): FloatWindowManager {
  const { tauri, currentWindowLabel, onFocusPane, getPanes, onOpen, onClose } = deps;
  const floatLabel = `float-${currentWindowLabel}`;

  let isOpenFlag = false;
  let unlistenFocusPane: (() => void) | null = null;
  let unlistenReady: (() => void) | null = null;
  let unlistenClose: (() => void) | null = null;
  const alertedPaneIds = new Set<string>();

  function getFloatUrl(): string {
    return `float.html?label=${encodeURIComponent(currentWindowLabel)}`;
  }

  async function ensureListeners(): Promise<void> {
    if (unlistenFocusPane && unlistenReady && unlistenClose) return;
    const webview = tauri.webview.getCurrentWebview();

    if (!unlistenFocusPane) {
      const unlisten = await webview.listen<{ paneId: string }>(FOCUS_PANE_EVENT, (e) => {
        onFocusPane(e.payload.paneId);
      });
      unlistenFocusPane = () => { unlisten(); };
    }

    if (!unlistenReady) {
      const unlisten = await webview.listen<void>(READY_EVENT, () => {
        emitPanes(buildSnapshot());
      });
      unlistenReady = () => { unlisten(); };
    }

    if (!unlistenClose) {
      const unlisten = await webview.listen('tauri://close', () => {
        if (!isOpenFlag) return;
        void tauri.webviewWindow.WebviewWindow.getByLabel(floatLabel)
          .then((existing) => existing?.close())
          .catch(() => {});
        isOpenFlag = false;
        onClose?.();
      });
      unlistenClose = () => { unlisten(); };
    }
  }

  function buildSnapshot(): FloatPaneSnapshot[] {
    return getPanes().map((pane) => ({
      id: pane.id,
      accent: pane.customColor || pane.accent,
      alerted: alertedPaneIds.has(pane.id),
    }));
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
          emitPanes(buildSnapshot());
          return;
        }
        isOpenFlag = false;
      }

      await ensureListeners();

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
      emitPanes(buildSnapshot());
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

    noteAlert(paneId: string): void {
      alertedPaneIds.add(paneId);
      emitPanes(buildSnapshot());
    },

    noteClear(paneId: string): void {
      alertedPaneIds.delete(paneId);
      emitPanes(buildSnapshot());
    },

    sync(): void {
      if (!isOpenFlag) return;
      emitPanes(buildSnapshot());
    },
  };
}
