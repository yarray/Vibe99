// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createPaneActivityWatcher } from './pane-activity-watcher';

/**
 * Unit tests for the signal-driven alert path (VIB-375 layer 1).
 *
 * The watcher's `noteSignal` is the "immediate" twin of `noteData`: it fires
 * `onAlert` right away instead of arming the quiet-period timer, but only
 * after passing the same suppression gates (global/per-pane enabled, pane
 * has been focused at least once, pane not currently focused unless
 * `ignoreFocus` is set). These tests pin that contract at the watcher level;
 * the xterm wiring (BEL / OSC 9 / 777 / 99 → noteSignal) is covered in
 * `runtime/terminal-signals.test.ts`.
 */

function createWatcher(overrides: Partial<Parameters<typeof createPaneActivityWatcher>[0]> = {}) {
  const onAlert = vi.fn();
  const onClear = vi.fn();
  const watcher = createPaneActivityWatcher({ onAlert, onClear, ...overrides });
  return { watcher, onAlert, onClear };
}

/** Focus a pane (marking it as seen) and then move focus away. */
function focusThenUnfocus(
  watcher: ReturnType<typeof createPaneActivityWatcher>,
  paneId: string,
): void {
  watcher.setFocus(paneId);
  watcher.setFocus(null);
}

describe('pane-activity-watcher noteSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onAlert immediately instead of waiting for the quiet period', () => {
    const { watcher, onAlert, onClear } = createWatcher({ settleMs: 30000 });
    focusThenUnfocus(watcher, 'p1');

    watcher.noteSignal('p1');

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith('p1');
    expect(onClear).not.toHaveBeenCalled();
  });

  it('does not fire for the currently focused pane', () => {
    const { watcher, onAlert } = createWatcher();
    watcher.setFocus('p1');

    watcher.noteSignal('p1');

    expect(onAlert).not.toHaveBeenCalled();
  });

  it('fires on the focused pane when ignoreFocus is set', () => {
    const { watcher, onAlert } = createWatcher();
    watcher.setFocus('p1');
    watcher.setIgnoreFocus(true);

    watcher.noteSignal('p1');

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith('p1');
  });

  it('is suppressed when the per-pane switch is off', () => {
    const { watcher, onAlert } = createWatcher();
    focusThenUnfocus(watcher, 'p1');
    watcher.setPaneEnabled('p1', false);

    watcher.noteSignal('p1');

    expect(onAlert).not.toHaveBeenCalled();
  });

  it('is suppressed when the global switch is off', () => {
    const { watcher, onAlert } = createWatcher();
    focusThenUnfocus(watcher, 'p1');
    watcher.setGlobalEnabled(false);

    watcher.noteSignal('p1');

    expect(onAlert).not.toHaveBeenCalled();
  });

  it('ignores a pane that has never been focused', () => {
    const { watcher, onAlert } = createWatcher();

    watcher.noteSignal('p1');

    expect(onAlert).not.toHaveBeenCalled();
  });

  it('does not fire a duplicate alert while the pane is already alerted', () => {
    const { watcher, onAlert } = createWatcher();
    focusThenUnfocus(watcher, 'p1');

    watcher.noteSignal('p1');
    watcher.noteSignal('p1');

    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it('lets subsequent output clear the signal alert and re-arm the quiet timer', () => {
    const { watcher, onAlert, onClear } = createWatcher();
    focusThenUnfocus(watcher, 'p1');

    watcher.noteSignal('p1');
    expect(watcher.isAlerted('p1')).toBe(true);

    watcher.noteData('p1', 5);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledWith('p1');
    expect(watcher.isAlerted('p1')).toBe(false);
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it('focusing the pane clears a signal alert', () => {
    const { watcher, onClear } = createWatcher();
    focusThenUnfocus(watcher, 'p1');

    watcher.noteSignal('p1');
    expect(watcher.isAlerted('p1')).toBe(true);

    watcher.setFocus('p1');

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(watcher.isAlerted('p1')).toBe(false);
  });

  it('clears any pending quiet timer before firing the signal alert', () => {
    const { watcher, onAlert } = createWatcher({ settleMs: 30000 });
    focusThenUnfocus(watcher, 'p1');

    // Arm a settle timer via passive output, then fire a signal before it
    // expires. The signal must win immediately and only fire once.
    watcher.noteData('p1', 3);
    watcher.noteSignal('p1');

    expect(onAlert).toHaveBeenCalledTimes(1);

    // Advancing past the settle time must not fire a second alert.
    vi.advanceTimersByTime(30000);
    expect(onAlert).toHaveBeenCalledTimes(1);
  });
});
