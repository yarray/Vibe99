/**
 * Float Window Manager
 *
 * Creates and manages a per-window floating indicator showing compact color
 * blocks for each pane. Lives in the main/layout window and communicates with
 * the float window via Tauri events.
 *
 * Design: one float window per layout window. Label convention:
 *   float window label = `float-{parentWindowLabel}`
 *
 * Persistence: float window open state and position are saved to localStorage
 * keyed by layout ID.
 *   - open:true is saved immediately when the float window opens (sync).
 *   - Position is tracked via tauri://move events from the float renderer.
 *   - open:false is saved only when the USER explicitly closes (X or toggle).
 *   - Parent window close skips the save so open:true is preserved.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PhysicalPosition {
  x: number;
  y: number;
}

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
  /** Layout ID for persisting float window state. */
  getLayoutId: () => string | null;
  onFocusPane: (paneId: string) => void;
  getPanes: () => FloatPaneDescriptor[];
  onOpen?: () => void;
  onClose?: () => void;
}

export interface FloatWindowManager {
  /** Open the float window (noop if already open). */
  open: () => Promise<void>;
  /** Close the float window. Pass parentClosing:true to skip saving open:false. */
  close: (options?: { parentClosing?: boolean }) => Promise<void>;
  /** Toggle the float window open/closed. */
  toggle: () => Promise<void>;
  /** Whether the float window is currently open. */
  isOpen: () => boolean;
  /** Whether the float window should auto-open based on persisted state. */
  shouldAutoOpen: () => boolean;
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
const USER_CLOSED_EVENT = 'vibe99:float-user-closed';
const MOVED_EVENT = 'vibe99:float-moved';

const FLOAT_WINDOW_STATE_KEY = 'vibe99.floatWindowState';

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface FloatWindowState {
  open: boolean;
  x?: number;
  y?: number;
}

type FloatWindowStateMap = Record<string, FloatWindowState>;

function readFloatWindowState(): FloatWindowStateMap {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FLOAT_WINDOW_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeFloatWindowState(state: FloatWindowStateMap): void {
  try {
    window.localStorage.setItem(FLOAT_WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Best effort
  }
}

function saveStateForLayout(layoutId: string, partial: FloatWindowState): void {
  const all = readFloatWindowState();
  all[layoutId] = { ...(all[layoutId] || {}), ...partial };
  writeFloatWindowState(all);
}

function readStateForLayout(layoutId: string): FloatWindowState | null {
  return readFloatWindowState()[layoutId] ?? null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFloatWindowManager(deps: FloatWindowDeps): FloatWindowManager {
  const { tauri, currentWindowLabel, getLayoutId, onFocusPane, getPanes, onOpen, onClose } = deps;
  const floatLabel = `float-${currentWindowLabel}`;

  let isOpenFlag = false;
  let unlistenFocusPane: (() => void) | null = null;
  let unlistenReady: (() => void) | null = null;
  let unlistenClose: (() => void) | null = null;
  let unlistenUserClosed: (() => void) | null = null;
  let unlistenMoved: (() => void) | null = null;
  const alertedPaneIds = new Set<string>();

  function getFloatUrl(): string {
    return `float.html?label=${encodeURIComponent(currentWindowLabel)}`;
  }

  async function ensureListeners(): Promise<void> {
    if (unlistenFocusPane && unlistenReady && unlistenClose && unlistenUserClosed && unlistenMoved) return;
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
      const unlisten = await webview.listen('tauri://close-requested', () => {
        if (isOpenFlag) {
          void tauri.webviewWindow.WebviewWindow.getByLabel(floatLabel)
            .then((existing) => existing?.close())
            .catch(() => {});
          isOpenFlag = false;
          onClose?.();
        }
        void tauri.webviewWindow.WebviewWindow.getByLabel(currentWindowLabel)
          .then((w) => w?.close())
          .catch(() => {});
      });
      unlistenClose = () => { unlisten(); };
    }

    // Float window X button closed by user → save open:false + position
    if (!unlistenUserClosed) {
      const unlisten = await webview.listen<PhysicalPosition>(USER_CLOSED_EVENT, (e) => {
        const layoutId = getLayoutId();
        if (layoutId) {
          saveStateForLayout(layoutId, { open: false, x: e.payload.x, y: e.payload.y });
        }
        isOpenFlag = false;
        onClose?.();
      });
      unlistenUserClosed = () => { unlisten(); };
    }

    // Float window moved → save new position (sent from float-renderer via tauri://move)
    if (!unlistenMoved) {
      const unlisten = await webview.listen<PhysicalPosition>(MOVED_EVENT, (e) => {
        const layoutId = getLayoutId();
        if (layoutId) {
          saveStateForLayout(layoutId, { x: e.payload.x, y: e.payload.y });
        }
      });
      unlistenMoved = () => { unlisten(); };
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
        const existing = await tauri.webviewWindow.WebviewWindow.getByLabel(floatLabel);
        if (existing) {
          emitPanes(buildSnapshot());
          return;
        }
        isOpenFlag = false;
      }

      await ensureListeners();

      const layoutId = getLayoutId();
      const savedState = layoutId ? readStateForLayout(layoutId) : null;

      // Save open:true immediately (sync) so state survives parent close
      if (layoutId) {
        saveStateForLayout(layoutId, { open: true });
      }

      const windowOptions: Record<string, unknown> = {
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
      };

      // Pass saved position in constructor to avoid flash
      if (savedState && savedState.x != null && savedState.y != null) {
        windowOptions.x = savedState.x;
        windowOptions.y = savedState.y;
      }

      const { WebviewWindow } = tauri.webviewWindow;
      new WebviewWindow(floatLabel, windowOptions);

      isOpenFlag = true;
      onOpen?.();
      emitPanes(buildSnapshot());
    },

    async close(options?: { parentClosing?: boolean }): Promise<void> {
      if (!isOpenFlag) return;

      // Only save open:false when the user explicitly closes, NOT when parent is closing.
      // When parent closes, the open:true we saved in open() should remain so the float
      // window reopens on next launch.
      if (!options?.parentClosing) {
        const layoutId = getLayoutId();
        if (layoutId) {
          saveStateForLayout(layoutId, { open: false });
        }
      }

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

    shouldAutoOpen(): boolean {
      const layoutId = getLayoutId();
      if (!layoutId) return false;
      const state = readStateForLayout(layoutId);
      return state?.open === true;
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
