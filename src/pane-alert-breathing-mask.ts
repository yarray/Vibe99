// Breathing-mask alert strategy: animates the existing `.pane::after` overlay
// so its opacity pulses between fully transparent and the user's overlay
// strength. This is one possible UI for `pane-activity-watcher`'s alert
// signal — swap it out for a different module (border flash, tab badge,
// …) without touching detection logic.
//
// API:
//   - `attach()`                   no-op (animation targets ::after directly).
//   - `setAlerted(paneEl, alerted)` toggle the pulsing state on the pane.
//
// The pane root carries the state class so CSS can also style siblings
// (e.g. tab indicator) off the same selector if needed later.

import './pane-alert-breathing-mask.css';

const ALERTED_CLASS = 'has-pending-activity';

export interface PaneAlertStrategy {
  /** No-op: the animation targets `.pane::after` via CSS. */
  attach(): void;
  /** Toggle the pulsing alert state on the given pane element. */
  setAlerted(paneEl: HTMLElement, alerted: boolean): void;
}

export function createBreathingMaskAlert(): PaneAlertStrategy {
  return {
    /** No-op: the animation targets `.pane::after` via CSS. */
    attach() {},

    /**
     * Toggle the pulsing alert state on the pane element.
     */
    setAlerted(paneEl: HTMLElement, alerted: boolean): void {
      paneEl.classList.toggle(ALERTED_CLASS, alerted);
    },
  };
}
