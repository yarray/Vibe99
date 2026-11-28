// A blinking terminal cursor is a continuous repaint: while `cursorBlink` is
// on, xterm redraws the cursor twice a second for as long as the option stays
// on. On machines without GPU acceleration (VMs, remote desktops, Xvfb) those
// repaints are rasterized on the CPU, so a focused pane used to keep the app
// at roughly one busy core with no input and no output (VIB-391).
//
// A blinking cursor only carries information while the user is working in the
// terminal — it says "input goes here". Once the user has stopped typing, a
// solid cursor says the same thing for free. So blink for `idleMs` after the
// last key, click or scroll, then leave the cursor solid until the next
// activity. Reduced-motion users never get a blinking cursor.
//
// The policy owns no DOM: the host feeds it activity and window-focus events
// and re-applies the decision when `onChange` fires.

const DEFAULT_IDLE_MS = 5000;

export interface CursorBlinkPolicyOptions {
  /** How long the cursor keeps blinking after the last user activity (ms). */
  idleMs?: number;
  /** Called when the blink decision changes; `true` = start blinking. */
  onChange?: (blinking: boolean) => void;
  /** Test seam for the reduced-motion media query. */
  prefersReducedMotion?: () => boolean;
}

export interface CursorBlinkPolicy {
  /** Whether the focused terminal's cursor should blink right now. */
  blinking: () => boolean;
  /**
   * The window gained or lost focus, or became hidden or visible. A window
   * that is not active never blinks — the user is looking somewhere else.
   */
  setWindowActive: (active: boolean) => void;
  /** Record user activity: a key, click or scroll. */
  noteActivity: () => void;
  dispose: () => void;
}

function defaultPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createCursorBlinkPolicy(options: CursorBlinkPolicyOptions = {}): CursorBlinkPolicy {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const prefersReducedMotion = options.prefersReducedMotion ?? defaultPrefersReducedMotion;

  let windowActive = typeof document === 'undefined' || document.visibilityState === 'visible';
  // A freshly opened window blinks for the first stretch, like any terminal.
  let lastActivityAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reported = false;

  function blinkingNow(): boolean {
    return windowActive
      && !prefersReducedMotion()
      && Date.now() - lastActivityAt < idleMs;
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Wake up exactly when the current blink window ends. No timer runs while
  // the cursor is solid, so an idle app schedules no repaints at all.
  function armExpiry(): void {
    clearTimer();
    if (!blinkingNow()) return;
    const remaining = Math.max(0, lastActivityAt + idleMs - Date.now());
    timer = setTimeout(() => {
      timer = null;
      sync();
    }, remaining);
  }

  function sync(): void {
    if (blinkingNow()) {
      armExpiry();
      if (!reported) {
        reported = true;
        options.onChange?.(true);
      }
      return;
    }
    clearTimer();
    if (reported) {
      reported = false;
      options.onChange?.(false);
    }
  }

  reported = blinkingNow();
  armExpiry();

  return {
    blinking: blinkingNow,

    setWindowActive(active: boolean): void {
      const next = Boolean(active);
      if (windowActive === next) return;
      windowActive = next;
      sync();
    },

    noteActivity(): void {
      lastActivityAt = Date.now();
      sync();
    },

    dispose(): void {
      clearTimer();
    },
  };
}
