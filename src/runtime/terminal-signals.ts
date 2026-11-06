// terminal-signals.ts — Route explicit "look at me" signals to the activity watcher
//
// xterm surfaces several in-band notification forms that are distinct from
// passive output: the terminal bell (BEL 0x07) and the OSC notification
// sequences used by iTerm2 growl (OSC 9), xterm notify (OSC 777) and kitty
// notifications (OSC 99). These mean "attention now", so they fire the
// breathing alert immediately instead of waiting out the quiet-period
// heuristic (VIB-375). OSC 9/777/99 have no default xterm rendering, so
// claiming them here also keeps the raw sequence out of the scrollback.

import type { Terminal } from '@xterm/xterm';

/** Minimal activity-watcher surface this module needs. */
export interface ActivitySignalWatcher {
  noteSignal: (paneId: string) => void;
}

/**
 * Wire a terminal's bell and OSC notification handlers to the watcher's
 * `noteSignal` path. Call this once per terminal session, after `terminal`
 * is constructed.
 */
export function registerActivitySignals(
  terminal: Terminal,
  activityWatcher: ActivitySignalWatcher,
  paneId: string,
): void {
  const noteSignal = (): boolean => {
    activityWatcher.noteSignal(paneId);
    return true;
  };

  terminal.onBell(() => {
    activityWatcher.noteSignal(paneId);
  });
  terminal.parser.registerOscHandler(9, noteSignal);
  terminal.parser.registerOscHandler(777, noteSignal);
  terminal.parser.registerOscHandler(99, noteSignal);
}
