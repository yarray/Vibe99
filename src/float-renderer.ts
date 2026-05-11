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

interface TauriWindow {
  label: string;
  setSize: (size: { type: string; width: number; height: number }) => Promise<void>;
  startDragging: () => Promise<void>;
  close: () => Promise<void>;
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
const MIN_WIDTH = 56;
const HEIGHT = BLOCK_SIZE + PADDING_Y * 2;

const PANES_EVENT = 'vibe99:float-panes';
const FOCUS_PANE_EVENT = 'vibe99:float-focus-pane';
const READY_EVENT = 'vibe99:float-ready';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const containerEl = document.getElementById('float-container')!;
const closeBtnEl = document.getElementById('float-close-btn')!;
const params = new URLSearchParams(window.location.search);
const parentLabel = params.get('label') ?? '';

let currentPanes: FloatPaneInfo[] = [];
let dragStarted = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeWidth(paneCount: number): number {
  if (paneCount === 0) return MIN_WIDTH;
  return paneCount * BLOCK_SIZE + (paneCount - 1) * BLOCK_GAP + PADDING_X * 2;
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
  const existing = Array.from(containerEl.children).filter(
    (el) => el !== closeBtnEl,
  ) as HTMLElement[];
  const targetCount = panes.length;

  for (let i = 0; i < targetCount; i++) {
    const pane = panes[i];
    let block = existing[i];
    if (!block) {
      block = document.createElement('div');
      block.className = 'float-block';
      block.addEventListener('click', () => handleBlockClick(pane.id));
      containerEl.append(block);
    }
    block.style.backgroundColor = pane.accent;
    block.style.setProperty('--block-glow', pane.accent);
    block.classList.toggle('is-alerted', pane.alerted);
    block.title = pane.id;
  }

  // Remove excess blocks
  while (containerEl.children.length > targetCount + 1) {
    const last = containerEl.lastElementChild;
    if (last && last !== closeBtnEl) {
      last.remove();
    } else if (last === closeBtnEl && containerEl.children.length > 2) {
      // Move close button before removing the block, then put it back
      const beforeClose = closeBtnEl.previousElementSibling;
      if (beforeClose && beforeClose !== closeBtnEl) {
        beforeClose.remove();
      }
    } else {
      break;
    }
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

containerEl.addEventListener('mousedown', (event) => {
  // Only start drag on non-block areas or on the container padding.
  // Clicks on blocks themselves are handled by block click handlers.
  if (event.target === containerEl) {
    dragStarted = true;
    if (tauri) {
      void tauri.window.getCurrentWindow().startDragging();
    }
  }
});

window.addEventListener('mouseup', () => {
  dragStarted = false;
});

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

closeBtnEl.addEventListener('click', (event) => {
  event.stopPropagation();
  if (tauri) {
    void tauri.window.getCurrentWindow().close();
  }
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

async function setupListeners(): Promise<void> {
  if (!tauri) return;

  const webview = tauri.webview.getCurrentWebview();

  // Listen for pane updates from parent window
  const unlisten = await webview.listen<PanesUpdatePayload>(PANES_EVENT, (e) => {
    render(e.payload.panes);
  });

  // Notify parent that we are ready to receive events
  emitToParent(READY_EVENT);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    unlisten();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setupListeners().catch(() => {});

// Initial empty render to set window size
render([]);
