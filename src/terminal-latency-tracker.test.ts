import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLatencyTracker, type LatencyTracker, type LatencySample } from './terminal-latency-tracker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function advanceMs(ms: number): void {
  vi.advanceTimersByTime(ms);
}

// ---------------------------------------------------------------------------
// createLatencyTracker
// ---------------------------------------------------------------------------

describe('createLatencyTracker', () => {
  let tracker: LatencyTracker;
  let sampleSpy: (sample: LatencySample) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sampleSpy = vi.fn() as (sample: LatencySample) => void;
    tracker = createLatencyTracker(
      { onSample: sampleSpy },
      { maxPending: 16, maxAgeMs: 1000, maxSamples: 10 },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty stats before any data', () => {
    expect(tracker.getStats()).toEqual({
      count: 0,
      last: null,
      min: null,
      max: null,
      avg: null,
    });
    expect(tracker.getRecentSamples()).toEqual([]);
  });

  it('measures latency for a single echoed character', () => {
    tracker.noteInput('a');
    advanceMs(90);
    tracker.noteBackendData('a');

    const stats = tracker.getStats();
    expect(stats.count).toBe(1);
    expect(stats.last).toBe(90);
    expect(stats.min).toBe(90);
    expect(stats.max).toBe(90);
    expect(stats.avg).toBe(90);
    expect(sampleSpy).toHaveBeenCalledTimes(1);
    expect(sampleSpy).toHaveBeenCalledWith({ ms: 90, input: 'a', output: 'a' });
  });

  it('measures latency for multiple echoed characters in one chunk', () => {
    tracker.noteInput('ab');
    advanceMs(87);
    tracker.noteBackendData('ab');

    const stats = tracker.getStats();
    expect(stats.count).toBe(2);
    expect(stats.last).toBe(87);
    expect(stats.min).toBe(87);
    expect(stats.max).toBe(87);
    expect(stats.avg).toBe(87);
    expect(sampleSpy).toHaveBeenCalledTimes(2);
  });

  it('measures latency for characters echoed in split chunks', () => {
    tracker.noteInput('abc');

    advanceMs(50);
    tracker.noteBackendData('a');
    expect(tracker.getStats().count).toBe(1);

    advanceMs(30);
    tracker.noteBackendData('bc');
    const stats = tracker.getStats();
    expect(stats.count).toBe(3);
    expect(stats.last).toBe(80);
  });

  it('ignores backend data that does not match pending input', () => {
    tracker.noteInput('a');
    advanceMs(90);
    tracker.noteBackendData('x');

    expect(tracker.getStats().count).toBe(0);
    expect(sampleSpy).not.toHaveBeenCalled();
  });

  it('stops matching when backend data diverges from pending input', () => {
    tracker.noteInput('ab');
    advanceMs(90);
    tracker.noteBackendData('ax');

    const stats = tracker.getStats();
    expect(stats.count).toBe(1);
    expect(stats.last).toBe(90);
  });

  it('handles interleaved input and backend data', () => {
    tracker.noteInput('a');
    advanceMs(90);
    tracker.noteBackendData('a');

    tracker.noteInput('b');
    advanceMs(20);
    tracker.noteBackendData('b');

    const stats = tracker.getStats();
    expect(stats.count).toBe(2);
    expect(stats.last).toBe(20);
    expect(stats.min).toBe(20);
    expect(stats.max).toBe(90);
  });

  it('drops pending inputs that exceed max age', () => {
    tracker.noteInput('a');
    advanceMs(2000);
    tracker.noteBackendData('a');

    expect(tracker.getStats().count).toBe(0);
  });

  it('caps the number of retained samples', () => {
    for (let i = 0; i < 20; i += 1) {
      tracker.noteInput(String(i));
      advanceMs(1);
      tracker.noteBackendData(String(i));
    }

    expect(tracker.getStats().count).toBe(10);
    expect(tracker.getRecentSamples(5).length).toBe(5);
  });

  it('resets all state', () => {
    tracker.noteInput('a');
    advanceMs(90);
    tracker.noteBackendData('a');
    expect(tracker.getStats().count).toBe(1);

    tracker.reset();
    expect(tracker.getStats().count).toBe(0);
    expect(tracker.getRecentSamples()).toEqual([]);
  });

  it('handles unicode characters correctly', () => {
    tracker.noteInput('中');
    advanceMs(90);
    tracker.noteBackendData('中');

    expect(tracker.getStats().count).toBe(1);
  });
});
