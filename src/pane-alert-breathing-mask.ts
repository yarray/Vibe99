// Breathing-mask alert strategy: drives opacity pulsing via
// requestAnimationFrame instead of CSS animation. This avoids WebKitGTK
// compositor-layer promotion (`will-change` + CSS `animation`) that causes
// integrated-GPU spikes to 100% — even when the window is unfocused.
//
// Why RAF instead of CSS animation:
//   1. CSS `animation` + `will-change: opacity` promotes each `::after` to
//      its own compositor layer in WebKitGTK. Multiple alerted panes =
//      multiple layers = GPU memory bandwidth saturation on iGPU.
//   2. `animation-play-state: paused` keeps compositor layers alive — the
//      GPU cost doesn't actually drop to zero.
//   3. RAF gives us precise lifecycle control: stop the loop completely when
//      the window is hidden/minimized/unfocused, and resume only when visible.
//   4. No `will-change` needed — we write `style.opacity` directly, which
//      the compositor can handle inline without a dedicated layer.
//
// The pane root carries the state class so CSS can also style siblings
// (e.g. tab indicator) off the same selector if needed later.

import './pane-alert-breathing-mask.css';

const ALERTED_CLASS = 'has-pending-activity';
const REDUCED_MOTION_MEDIA = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface PaneAlertStrategy {
  attach(): void;
  setAlerted(paneEl: HTMLElement, alerted: boolean): void;
  destroy(): void;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

interface AnimEntry {
  el: HTMLElement;
  phase: number;
}

export function createBreathingMaskAlert(): PaneAlertStrategy {
  const entries = new Map<HTMLElement, AnimEntry>();
  let rafId = 0;
  let running = false;
  let attached = false;
  let prefersReducedMotion = REDUCED_MOTION_MEDIA.matches;
  let windowVisible = true;
  let windowFocused = true;

  function tick(): void {
    if (!running || entries.size === 0) {
      running = false;
      return;
    }

    const docStyle = getComputedStyle(document.documentElement);
    const durationStr = docStyle.getPropertyValue('--breathing-duration').trim();
    const durationMs = durationStr ? parseFloat(durationStr) * 1000 : 2400;
    const peakStr = docStyle.getPropertyValue('--breathing-peak-opacity').trim();
    // CSS calc() can't be resolved at runtime; parse numeric fallback.
    const peakOpacity = peakStr ? parseFloat(peakStr) : 0.7;
    const dt = 16;

    for (const [, entry] of entries) {
      entry.phase = (entry.phase + dt / durationMs) % 1;
      const t = entry.phase <= 0.5
        ? easeInOutSine(entry.phase * 2)
        : easeInOutSine((1 - entry.phase) * 2);
      entry.el.style.opacity = String(t * peakOpacity);
    }

    rafId = requestAnimationFrame(tick);
  }

  function startLoop(): void {
    if (running || entries.size === 0) return;
    if (!windowVisible || !windowFocused) return;
    if (prefersReducedMotion) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function updateRunningState(): void {
    const shouldRun = windowVisible && windowFocused && !prefersReducedMotion;
    if (shouldRun && entries.size > 0) {
      startLoop();
    } else {
      stopLoop();
      // Snap to 0 so panes don't freeze at a mid-pulse value.
      if (!shouldRun) {
        for (const [, entry] of entries) {
          entry.el.style.opacity = '0';
        }
      }
    }
  }

  function onVisibilityChange(): void {
    windowVisible = document.visibilityState === 'visible';
    updateRunningState();
  }

  function onWindowFocus(): void {
    windowFocused = true;
    updateRunningState();
  }

  function onWindowBlur(): void {
    windowFocused = false;
    updateRunningState();
  }

  function onReducedMotionChange(e: MediaQueryListEvent): void {
    prefersReducedMotion = e.matches;
    if (prefersReducedMotion) {
      stopLoop();
      const docStyle = getComputedStyle(document.documentElement);
      const peakStr = docStyle.getPropertyValue('--breathing-peak-opacity').trim();
      const peakOpacity = peakStr ? parseFloat(peakStr) : 0.7;
      for (const [, entry] of entries) {
        entry.el.style.opacity = String(peakOpacity);
      }
    } else {
      updateRunningState();
    }
  }

  return {
    attach(): void {
      if (attached) return;
      attached = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onWindowFocus);
      window.addEventListener('blur', onWindowBlur);
      REDUCED_MOTION_MEDIA.addEventListener('change', onReducedMotionChange);
      windowVisible = document.visibilityState === 'visible';
      windowFocused = document.hasFocus();
    },

    setAlerted(paneEl: HTMLElement, alerted: boolean): void {
      const afterEl = paneEl.querySelector<HTMLElement>(':scope > .alert-overlay')
        ?? createOverlay(paneEl);

      if (alerted) {
        paneEl.classList.add(ALERTED_CLASS);
        if (!entries.has(paneEl)) {
          entries.set(paneEl, { el: afterEl, phase: 0 });
          const docStyle = getComputedStyle(document.documentElement);
          const glow = docStyle.getPropertyValue('--breathing-glow').trim();
          if (glow) afterEl.style.boxShadow = glow;
        }
        startLoop();
      } else {
        paneEl.classList.remove(ALERTED_CLASS);
        entries.delete(paneEl);
        afterEl.style.opacity = '0';
        afterEl.style.boxShadow = '';
        if (entries.size === 0) stopLoop();
      }
    },

    destroy(): void {
      stopLoop();
      if (attached) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onWindowFocus);
        window.removeEventListener('blur', onWindowBlur);
        REDUCED_MOTION_MEDIA.removeEventListener('change', onReducedMotionChange);
        attached = false;
      }
      for (const [paneEl, entry] of entries) {
        paneEl.classList.remove(ALERTED_CLASS);
        entry.el.style.opacity = '0';
        entry.el.style.boxShadow = '';
      }
      entries.clear();
    },
  };
}

// We use a dedicated child element (`.alert-overlay`) instead of `::after`
// because `::after` is already consumed by the pane's background-mask overlay
// (see `panes.css`), and we need JS to directly set `style.opacity` on the
// animated element without CSS `will-change` compositor-layer promotion.

const OVERLAY_CLASS = 'alert-overlay';

function createOverlay(paneEl: HTMLElement): HTMLElement {
  let overlay = paneEl.querySelector<HTMLElement>(`:scope > .${OVERLAY_CLASS}`);
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;
  paneEl.appendChild(overlay);
  return overlay;
}
