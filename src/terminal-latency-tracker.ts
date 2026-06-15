/**
 * Terminal input latency tracker.
 *
 * Measures the round-trip from a frontend keystroke being sent to the PTY
 * backend until the corresponding echo data arrives back from the backend.
 * This is the "backendToFrontendMs" path that the issue identifies as the
 * source of perceived typing lag on Linux + Tauri/WebkitGTK.
 *
 * The tracker is intentionally separate from local echo:
 *   - It works whether local echo is enabled or disabled, so it can quantify
 *     the raw backend latency and the effective latency improvement.
 *   - It only measures characters that the backend actually echoes back.
 *     Password prompts, escape sequences, and unrelated PTY output do not
 *     pollute the samples.
 *
 * Implementation notes:
 *   - Inputs are kept in a short FIFO ordered by send time. When backend data
 *     arrives we try to match its leading characters against the oldest pending
 *     inputs. A match produces one latency sample per character.
 *   - A mismatch stops matching for that backend chunk. This avoids attributing
 *     unrelated PTY output (e.g. shell prompts, multiplexer redraws) to typed
 *     characters.
 *   - Pending entries expire after `maxAgeMs` and the buffer is bounded by
 *     `maxPending` to keep memory usage flat during bursts or idle periods.
 *
 * @module terminal-latency-tracker
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single latency sample. */
export interface LatencySample {
  /** Round-trip latency in milliseconds. */
  ms: number;
  /** The input character that was matched. */
  input: string;
  /** The output character that confirmed it. */
  output: string;
}

/** Aggregated latency statistics. */
export interface LatencyStats {
  /** Number of collected samples. */
  count: number;
  /** Most recent sample, in milliseconds, or null if none. */
  last: number | null;
  /** Minimum sample, in milliseconds, or null if none. */
  min: number | null;
  /** Maximum sample, in milliseconds, or null if none. */
  max: number | null;
  /** Average sample, in milliseconds, or null if none. */
  avg: number | null;
}

/** Dependencies injected into `createLatencyTracker`. */
export interface LatencyTrackerDeps {
  /** Called whenever a new sample is collected. */
  onSample?: (sample: LatencySample) => void;
}

/** Options for `createLatencyTracker`. */
export interface LatencyTrackerOptions {
  /**
   * Maximum number of pending input characters to track at once.
   * Default: 256.
   */
  maxPending?: number;
  /**
   * Pending inputs older than this are discarded, in milliseconds.
   * Default: 5000.
   */
  maxAgeMs?: number;
  /**
   * Maximum number of recent samples to retain.
   * Default: 100.
   */
  maxSamples?: number;
}

/** The public API returned by `createLatencyTracker`. */
export interface LatencyTracker {
  /** Record input being sent to the PTY backend. */
  noteInput(input: string): void;
  /** Record data arriving from the PTY backend. */
  noteBackendData(data: string): void;
  /** Return aggregated statistics for collected samples. */
  getStats(): LatencyStats;
  /** Return the most recent `n` samples, oldest first. */
  getRecentSamples(n?: number): LatencySample[];
  /** Clear all pending inputs and collected samples. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PENDING = 256;
const DEFAULT_MAX_AGE_MS = 5000;
const DEFAULT_MAX_SAMPLES = 100;

interface PendingChar {
  char: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLatencyTracker(
  deps: LatencyTrackerDeps = {},
  options: LatencyTrackerOptions = {},
): LatencyTracker {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;

  let pending: PendingChar[] = [];
  const samples: LatencySample[] = [];

  function now(): number {
    return performance.now();
  }

  function trimExpired(limitTs: number): void {
    const cutoff = limitTs - maxAgeMs;
    const firstValid = pending.findIndex((p) => p.ts >= cutoff);
    if (firstValid <= 0) {
      if (firstValid === -1) {
        pending = [];
      }
      return;
    }
    pending = pending.slice(firstValid);
  }

  function enforceCapacity(): void {
    if (pending.length > maxPending) {
      pending = pending.slice(-maxPending);
    }
  }

  function recordSample(sample: LatencySample): void {
    samples.push(sample);
    if (samples.length > maxSamples) {
      samples.shift();
    }
    deps.onSample?.(sample);
  }

  return {
    noteInput(input: string): void {
      const ts = now();
      for (const char of input) {
        pending.push({ char, ts });
      }
      trimExpired(ts);
      enforceCapacity();
    },

    noteBackendData(data: string): void {
      const ts = now();
      trimExpired(ts);

      for (const char of data) {
        if (pending.length === 0) {
          break;
        }
        const next = pending[0];
        if (next.char !== char) {
          // Backend returned something unrelated to our typed input; stop
          // matching this chunk so we don't attribute unrelated output to
          // pending keystrokes.
          break;
        }
        pending.shift();
        recordSample({ ms: ts - next.ts, input: next.char, output: char });
      }
    },

    getStats(): LatencyStats {
      if (samples.length === 0) {
        return { count: 0, last: null, min: null, max: null, avg: null };
      }
      const values = samples.map((s) => s.ms);
      const sum = values.reduce((a, b) => a + b, 0);
      return {
        count: samples.length,
        last: values[values.length - 1],
        min: Math.min(...values),
        max: Math.max(...values),
        avg: sum / values.length,
      };
    },

    getRecentSamples(n = Infinity): LatencySample[] {
      if (n <= 0) return [];
      if (n >= samples.length) return samples.slice();
      return samples.slice(-n);
    },

    reset(): void {
      pending = [];
      samples.length = 0;
    },
  };
}
