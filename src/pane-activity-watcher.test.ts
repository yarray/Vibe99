// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPaneActivityWatcher, fingerprintVisibleContent, type VisibleLine } from './pane-activity-watcher';

const SETTLE_MS = 1000;

function line(text: string, wrapped = false): VisibleLine {
  return { text, wrapped };
}

function fp(lines: VisibleLine[]): string {
  return fingerprintVisibleContent(lines);
}

function makeWatcher() {
  const alerts: string[] = [];
  const clears: string[] = [];
  const watcher = createPaneActivityWatcher({
    settleMs: SETTLE_MS,
    resizeSettleMs: 50,
    onAlert: (paneId) => alerts.push(paneId),
    onClear: (paneId) => clears.push(paneId),
  });
  return { watcher, alerts, clears };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fingerprintVisibleContent', () => {
  it('is invariant to line wrapping', () => {
    const reflowed = fp([line('hello w'), line('orld', true)]);
    const unwrapped = fp([line('hello world')]);
    expect(reflowed).toBe(unwrapped);
  });

  it('collapses consecutive whitespace', () => {
    expect(fp([line('a   b'), line('  c ')])).toBe('a b c');
  });

  it('preserves a genuine newline as a separator', () => {
    // "ab\ncd" differs from "abcd" — the real line break is content.
    expect(fp([line('ab'), line('cd')])).not.toBe(fp([line('abcd')]));
  });

  it('distinguishes real content changes', () => {
    expect(fp([line('hello world')])).not.toBe(fp([line('hello worlt')]));
  });
});

describe('createPaneActivityWatcher fingerprint gating', () => {
  it('does not alert on a reflow that only changes wrapping', () => {
    const { watcher, alerts } = makeWatcher();

    // User watches the pane while it shows "hello world", then switches away.
    watcher.setFocus('a');
    watcher.noteData('a', 11, fp([line('hello world')]));
    watcher.setFocus('b');

    // The layout reflow rewraps the same content onto two lines.
    watcher.noteData('a', 11, fp([line('hello w'), line('orld', true)]));
    vi.advanceTimersByTime(SETTLE_MS + 1);

    expect(alerts).toEqual([]);
  });

  it('does not alert when a TUI redraws the same frame repeatedly', () => {
    const { watcher, alerts } = makeWatcher();
    const frame = fp([line('idle tui frame')]);

    // User focuses the pane while it shows the frame, then switches away.
    watcher.setFocus('a');
    watcher.noteData('a', 10, frame);
    watcher.setFocus('b');

    // Each identical redraw resets the quiet timer, but on expiry the
    // content still matches what the user last saw.
    for (let i = 0; i < 5; i++) {
      watcher.noteData('a', 10, frame);
      vi.advanceTimersByTime(200);
    }
    vi.advanceTimersByTime(SETTLE_MS + 1);

    expect(alerts).toEqual([]);
  });

  it('alerts when genuinely new output arrives after focus', () => {
    const { watcher, alerts } = makeWatcher();

    watcher.setFocus('a');
    watcher.noteData('a', 3, fp([line('old')]));
    watcher.setFocus('b');

    watcher.noteData('a', 3, fp([line('new')]));
    vi.advanceTimersByTime(SETTLE_MS + 1);

    expect(alerts).toEqual(['a']);
  });

  it('updates lastSeen on focus so an old change does not re-alert', () => {
    const { watcher, alerts } = makeWatcher();
    const done = fp([line('done')]);

    watcher.setFocus('a');
    watcher.setFocus('b');
    watcher.noteData('a', 4, done);
    vi.advanceTimersByTime(SETTLE_MS + 1);
    expect(alerts).toEqual(['a']);

    // Focusing the pane clears the alert and marks the content as seen.
    watcher.setFocus('a');
    expect(watcher.isAlerted('a')).toBe(false);

    // A reflow/redraw of that same content must not re-alert.
    watcher.setFocus('b');
    watcher.noteData('a', 4, done);
    vi.advanceTimersByTime(SETTLE_MS + 1);

    expect(alerts).toEqual(['a']);
  });

  it('falls back to alerting on settled output when no fingerprint is supplied', () => {
    const { watcher, alerts } = makeWatcher();

    watcher.setFocus('a');
    watcher.setFocus('b');
    watcher.noteData('a', 5);
    vi.advanceTimersByTime(SETTLE_MS + 1);

    expect(alerts).toEqual(['a']);
  });
});

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
