// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCursorBlinkPolicy } from './cursor-blink-policy';

/**
 * Unit tests for VIB-391: an idle, focused terminal must stop blinking its
 * cursor. Blinking is a continuous repaint, so leaving it on forever keeps the
 * whole app from ever going idle.
 */

const IDLE_MS = 5000;

function createPolicy(overrides: Parameters<typeof createCursorBlinkPolicy>[0] = {}) {
  const onChange = vi.fn();
  const policy = createCursorBlinkPolicy({
    idleMs: IDLE_MS,
    onChange,
    prefersReducedMotion: () => false,
    ...overrides,
  });
  return { policy, onChange };
}

describe('createCursorBlinkPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blinks right after activity and goes solid once the idle window lapses', () => {
    const { policy, onChange } = createPolicy();

    policy.noteActivity();
    expect(policy.blinking()).toBe(true);

    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(policy.blinking()).toBe(true);
    expect(onChange).not.toHaveBeenCalledWith(false);

    vi.advanceTimersByTime(1);
    expect(policy.blinking()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('restarts the idle window on every new activity', () => {
    const { policy, onChange } = createPolicy();

    policy.noteActivity();
    vi.advanceTimersByTime(IDLE_MS - 1000);
    policy.noteActivity(); // e.g. the next keystroke

    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(policy.blinking()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(policy.blinking()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('reports the transition back on when activity resumes', () => {
    const { policy, onChange } = createPolicy();

    policy.noteActivity();
    vi.advanceTimersByTime(IDLE_MS);
    expect(policy.blinking()).toBe(false);
    onChange.mockClear();

    policy.noteActivity();
    expect(policy.blinking()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('never blinks while the window is inactive and stays solid on reactivation', () => {
    const { policy, onChange } = createPolicy();

    policy.noteActivity();
    expect(policy.blinking()).toBe(true);

    policy.setWindowActive(false);
    expect(policy.blinking()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);

    vi.advanceTimersByTime(IDLE_MS * 3);
    policy.setWindowActive(true);
    // The idle window lapsed while the user was elsewhere: no blink on return.
    expect(policy.blinking()).toBe(false);
  });

  it('blinks for one idle window after the window regains focus', () => {
    const { policy } = createPolicy();

    policy.setWindowActive(false);
    vi.advanceTimersByTime(IDLE_MS * 3);

    // The host calls noteActivity() together with setWindowActive(true) when
    // the window is focused again.
    policy.setWindowActive(true);
    policy.noteActivity();
    expect(policy.blinking()).toBe(true);

    vi.advanceTimersByTime(IDLE_MS);
    expect(policy.blinking()).toBe(false);
  });

  it('never blinks when the user prefers reduced motion', () => {
    const { policy, onChange } = createPolicy({ prefersReducedMotion: () => true });

    policy.noteActivity();
    expect(policy.blinking()).toBe(false);

    vi.advanceTimersByTime(IDLE_MS);
    expect(policy.blinking()).toBe(false);
    expect(onChange).not.toHaveBeenCalledWith(true);
  });

  it('arms no timer while idle, so a settled app schedules no wakeups', () => {
    const { policy } = createPolicy();

    policy.noteActivity();
    vi.advanceTimersByTime(IDLE_MS);
    expect(vi.getTimerCount()).toBe(0);

    policy.noteActivity();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops the timer on dispose', () => {
    const { policy } = createPolicy();

    policy.noteActivity();
    policy.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
