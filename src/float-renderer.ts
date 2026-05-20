/**
 * Float Window Renderer
 *
 * Lightweight renderer for the floating indicator window. Displays a compact
 * row of color blocks — one per pane — with breathing animation for alerted
 * panes. Communicates with the parent layout window via Tauri events.
 *
 * No terminal, no xterm, no heavy dependencies. Pure DOM + CSS + events.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FloatPaneInfo {
  id: string;
  accent: string;
  alerted: boolean;
}

interface PanesUpdatePayload {
  panes: FloatPaneInfo[];
}

// ---------------------------------------------------------------------------
// Tauri shims (minimal surface, no heavy imports)
// ---------------------------------------------------------------------------

interface PhysicalPosition {
  x: number;
  y: number;
}

interface TauriWindow {
  label: string;
  setSize: (size: { type: string; width: number; height: number }) => Promise<void>;
  startDragging: () => Promise<void>;
  close: () => Promise<void>;
  outerPosition: () => Promise<PhysicalPosition>;
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
}

interface TauriGlobal {
  core: {
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  window: {
    getCurrentWindow: () => TauriWindow;
  };
  webview: {
    getCurrentWebview: () => {
      listen: <T = unknown>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
    };
  };
  webviewWindow: {
    WebviewWindow: {
      getByLabel: (label: string) => Promise<{ close: () => Promise<void> } | null>;
    };
  };
  event?: {
    emitTo?: (target: string, event: string, payload?: unknown) => Promise<void>;
  };
}

const tauri = (window as any).__TAURI__ as TauriGlobal | undefined;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK_SIZE = 32;
const BLOCK_GAP = 6;
const PADDING_X = 12;
const PADDING_Y = 10;
const WRAPPER_PAD_X = 10;
const WRAPPER_PAD_Y = 10;
const MIN_WIDTH = 56 + WRAPPER_PAD_X;
const HEIGHT = BLOCK_SIZE + PADDING_Y * 2 + WRAPPER_PAD_Y;

const PANES_EVENT = 'vibe99:float-panes';
const FOCUS_PANE_EVENT = 'vibe99:float-focus-pane';
const READY_EVENT = 'vibe99:float-ready';
const USER_CLOSED_EVENT = 'vibe99:float-user-closed';
const MOVED_EVENT = 'vibe99:float-moved';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const wrapperEl = document.getElementById('float-wrapper')!;
const containerEl = document.getElementById('float-container')!;
const closeBtnEl = document.getElementById('float-close-btn')!;
const params = new URLSearchParams(window.location.search);
const parentLabel = params.get('label') ?? '';

let currentPanes: FloatPaneInfo[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeWidth(paneCount: number): number {
  if (paneCount === 0) return MIN_WIDTH;
  return paneCount * BLOCK_SIZE + (paneCount - 1) * BLOCK_GAP + PADDING_X * 2 + WRAPPER_PAD_X;
}

function emitToParent(event: string, payload?: unknown): void {
  if (!parentLabel || !tauri?.event?.emitTo) return;
  void tauri.event.emitTo(parentLabel, event, payload).catch(() => {});
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(panes: FloatPaneInfo[]): void {
  currentPanes = panes;

  // Reconcile DOM: update existing blocks, add new ones, remove extras.
  const existing = Array.from(containerEl.children) as HTMLElement[];
  const targetCount = panes.length;

  for (let i = 0; i < targetCount; i++) {
    const pane = panes[i];
    let block = existing[i];
    if (!block) {
      block = document.createElement('div');
      block.className = 'float-block';
      containerEl.append(block);
    }
    block.onclick = () => handleBlockClick(pane.id);
    block.style.backgroundColor = pane.accent;
    block.style.setProperty('--block-glow', pane.accent);
    block.classList.toggle('is-alerted', pane.alerted);
    block.title = pane.id;
  }

  // Remove excess blocks
  while (containerEl.children.length > targetCount) {
    containerEl.lastElementChild?.remove();
  }

  // Adjust window size
  adjustWindowSize();
}

function adjustWindowSize(): void {
  if (!tauri) return;
  const width = computeWidth(currentPanes.length);
  const win = tauri.window.getCurrentWindow();
  void win.setSize({ type: 'Logical', width, height: HEIGHT });
}

function handleBlockClick(paneId: string): void {
  emitToParent(FOCUS_PANE_EVENT, { paneId });
}

// ---------------------------------------------------------------------------
// Drag support
// ---------------------------------------------------------------------------

wrapperEl.addEventListener('mousedown', (event) => {
  // Start drag on wrapper / container background only, not on blocks or close button.
  if (event.target === wrapperEl || event.target === containerEl) {
    if (tauri) {
      void tauri.window.getCurrentWindow().startDragging();
    }
  }
});

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

closeBtnEl.addEventListener('click', async (event) => {
  event.stopPropagation();
  if (tauri) {
    const win = tauri.window.getCurrentWindow();
    try {
      const pos = await win.outerPosition();
      emitToParent(USER_CLOSED_EVENT, { x: pos.x, y: pos.y });
    } catch { /* best effort */ }
    void win.close();
  }
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

async function setupListeners(): Promise<void> {
  if (!tauri) return;

  const webview = tauri.webview.getCurrentWebview();
  const win = tauri.window.getCurrentWindow();

  // Listen for pane updates from parent window
  const unlisten = await webview.listen<PanesUpdatePayload>(PANES_EVENT, (e) => {
    render(e.payload.panes);
  });

  // Track window position changes and report to parent for persistence
  const unlistenMoved = await win.listen<PhysicalPosition>('tauri://move', (e) => {
    emitToParent(MOVED_EVENT, { x: e.payload.x, y: e.payload.y });
  });

  // Notify parent that we are ready to receive events
  emitToParent(READY_EVENT);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    unlisten();
    unlistenMoved();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setupListeners().catch(() => {});

// ---------------------------------------------------------------------------
// Parent heartbeat — close self if parent window is gone
// ---------------------------------------------------------------------------

function startParentHeartbeat(): void {
  if (!tauri || !parentLabel) return;
  const interval = setInterval(() => {
    tauri.webviewWindow.WebviewWindow.getByLabel(parentLabel)
      .then((parent) => {
        if (!parent) {
          clearInterval(interval);
          void tauri.window.getCurrentWindow().close();
        }
      })
      .catch(() => {});
  }, 1000);
}

startParentHeartbeat();

// Initial empty render to set window size
render([]);
