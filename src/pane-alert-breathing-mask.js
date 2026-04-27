// Breathing-mask alert strategy: animates the existing `.pane::after` overlay
// so its opacity pulses between fully transparent and the user's overlay
// strength. No extra DOM element needed.
//
// API:
//   - `attach()`                   no-op (animation targets ::after directly).
//   - `setAlerted(paneEl, alerted)` toggle the pulsing state on the pane.

import './pane-alert-breathing-mask.css';

const ALERTED_CLASS = 'has-pending-activity';

export function createBreathingMaskAlert() {
  return {
    /** No-op: the animation targets `.pane::after` via CSS. */
    attach() {},

    setAlerted(paneEl, alerted) {
      paneEl.classList.toggle(ALERTED_CLASS, alerted);
    },
  };
}
