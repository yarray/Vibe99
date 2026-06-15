/**
 * Local echo for terminal input.
 *
 * On some platforms (notably Linux + Tauri/WebkitGTK) the round-trip from
 * frontend keystroke → backend PTY → frontend render can be ~90 ms, which
 * makes typing feel sluggish. Local echo writes predictable keystrokes to
 * the terminal immediately and later reconciles them with the real PTY output
 * so characters are not rendered twice.
 *
 * Safety design:
 * - Only short, printable input is echoed. Control sequences, arrow keys,
 *   Tab, Enter, paste bursts, etc. are never echoed locally.
 * - Echoed characters live in a pending buffer. When the real PTY output
 *   arrives we strip the matching prefix and render only the remainder.
 * - If the PTY does not confirm a character within `maxAgeMs`, we roll the
 *   local echo back by emitting backspace sequences. This handles password
 *   prompts and other non-echoing shell states.
 *
 * The feature is opt-in via settings. When disabled the module is a pass-through.
 *
 * @module terminal-local-echo
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LocalEchoOptions {
  /** Return whether local echo is currently enabled. Called on every input. */
  getEnabled: () => boolean;
  /**
   * How long a locally echoed character waits for PTY confirmation before
   * being rolled back. Default: 150 ms.
   */
  maxAgeMs?: number;
}

export interface LocalEchoDeps {
  /** Called when the module needs to write rollback backspaces to the terminal. */
  onFlush: (data: string) => void;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface LocalEcho {
  /**
   * Process user input. Returns the data that should be written to the
   * terminal immediately, or `null` if nothing was echoed locally.
   */
  handleInput(input: string): string | null;
  /**
   * Process data coming back from the PTY. Returns the data that should be
   * rendered after removing any locally echoed prefix.
   */
  handleBackendData(data: string): string | null;
  /** Forcefully roll back any unconfirmed local echo and clear the buffer. */
  flush(): string | null;
  /** Current unconfirmed local echo buffer (exposed for tests). */
  readonly pending: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Longest input we will echo locally. Longer data is treated as paste/sequence. */
const MAX_ECHO_LENGTH = 4;

/** Default time to wait for PTY confirmation before rolling back. */
const DEFAULT_MAX_AGE_MS = 150;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPrintableCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  // Printable ASCII, including space.
  if (code >= 0x20 && code <= 0x7e) {
    return true;
  }
  // DEL is not printable.
  if (code === 0x7f) {
    return false;
  }
  // Reject C0 controls explicitly (they fall outside 0x20-0x7e).
  if (code <= 0x1f) {
    return false;
  }
  // For the rest of Unicode, reject control/format characters conservatively.
  return !/\p{Cc}|\p{Cf}/u.test(char);
}

/**
 * Decide whether a chunk of input is safe to echo locally.
 *
 * We echo only short, printable text. Anything that looks like an escape
 * sequence, control character, newline, tab, or paste burst is sent to the
 * shell without local echo and rendered only when the shell sends it back.
 */
export function shouldEchoInput(input: string): boolean {
  if (input.length === 0 || input.length > MAX_ECHO_LENGTH) {
    return false;
  }
  // Escape sequences (arrow keys, function keys, etc.) start with ESC.
  if (input.charCodeAt(0) === 0x1b) {
    return false;
  }
  for (const char of input) {
    if (!isPrintableCharacter(char)) {
      return false;
    }
  }
  return true;
}

/**
 * Build a string of backspace sequences that removes `count` displayed
 * characters from the terminal. Each character is erased with "\b \b".
 */
function buildRollback(count: number): string {
  return '\b \b'.repeat(Math.max(0, count));
}

/**
 * Length of the longest common prefix between two strings.
 */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) {
    i += 1;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLocalEcho(deps: LocalEchoDeps, options: LocalEchoOptions): LocalEcho {
  const getEnabled = options.getEnabled;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush(): string | null {
    clearTimer();
    if (pending.length === 0) {
      return null;
    }
    const rollback = buildRollback(pending.length);
    pending = '';
    return rollback;
  }

  function armTimer(): void {
    clearTimer();
    timer = setTimeout(() => {
      const rollback = flush();
      if (rollback !== null) {
        deps.onFlush(rollback);
      }
    }, maxAgeMs);
  }

  return {
    handleInput(input: string): string | null {
      if (!getEnabled() || !shouldEchoInput(input)) {
        // If the feature was just disabled, roll back any pending echo.
        if (pending.length > 0) {
          const rollback = flush();
          if (rollback !== null) {
            deps.onFlush(rollback);
          }
        }
        return null;
      }
      pending += input;
      armTimer();
      return input;
    },

    handleBackendData(data: string): string | null {
      if (!getEnabled()) {
        const rollback = flush();
        if (rollback !== null) {
          deps.onFlush(rollback);
        }
        return data.length > 0 ? data : null;
      }

      if (pending.length === 0) {
        return data.length > 0 ? data : null;
      }

      const matched = commonPrefixLength(pending, data);
      if (matched === 0) {
        // The PTY returned something unrelated; abandon our pending echo.
        clearTimer();
        pending = '';
        return data.length > 0 ? data : null;
      }

      pending = pending.slice(matched);
      if (pending.length === 0) {
        clearTimer();
      } else {
        // Part of the echo was confirmed; keep the timer running for the rest.
        armTimer();
      }
      const remainder = data.slice(matched);
      return remainder.length > 0 ? remainder : null;
    },

    flush,

    get pending(): string {
      return pending;
    },
  };
}
