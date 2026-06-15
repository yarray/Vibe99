import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLocalEcho, shouldEchoInput, type LocalEchoDeps } from './terminal-local-echo';

// ---------------------------------------------------------------------------
// shouldEchoInput
// ---------------------------------------------------------------------------

describe('shouldEchoInput', () => {
  it('echoes single printable ASCII characters', () => {
    expect(shouldEchoInput('a')).toBe(true);
    expect(shouldEchoInput('A')).toBe(true);
    expect(shouldEchoInput(' ')).toBe(true);
    expect(shouldEchoInput('~')).toBe(true);
  });

  it('echoes short unicode text', () => {
    expect(shouldEchoInput('中')).toBe(true);
    expect(shouldEchoInput('é')).toBe(true);
  });

  it('rejects control characters', () => {
    expect(shouldEchoInput('\t')).toBe(false);
    expect(shouldEchoInput('\n')).toBe(false);
    expect(shouldEchoInput('\r')).toBe(false);
    expect(shouldEchoInput('\b')).toBe(false);
    expect(shouldEchoInput('\x7f')).toBe(false);
  });

  it('rejects escape sequences', () => {
    expect(shouldEchoInput('\x1b[A')).toBe(false); // arrow up
    expect(shouldEchoInput('\x1b[3~')).toBe(false); // delete
  });

  it('rejects empty and too-long input', () => {
    expect(shouldEchoInput('')).toBe(false);
    expect(shouldEchoInput('hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLocalEcho
// ---------------------------------------------------------------------------

describe('createLocalEcho', () => {
  let enabled: boolean;
  let flushed: string[];
  let deps: LocalEchoDeps;

  beforeEach(() => {
    enabled = true;
    flushed = [];
    deps = {
      onFlush: (data) => flushed.push(data),
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function create() {
    return createLocalEcho(deps, { getEnabled: () => enabled, maxAgeMs: 100 });
  }

  it('is a pass-through when disabled', () => {
    enabled = false;
    const echo = create();
    expect(echo.handleInput('a')).toBeNull();
    expect(echo.handleBackendData('abc')).toBe('abc');
    expect(echo.pending).toBe('');
  });

  it('echoes safe input and reconciles matching backend data', () => {
    const echo = create();

    expect(echo.handleInput('a')).toBe('a');
    expect(echo.pending).toBe('a');

    expect(echo.handleBackendData('abc')).toBe('bc');
    expect(echo.pending).toBe('');
  });

  it('reconciles split backend responses', () => {
    const echo = create();

    echo.handleInput('abc');
    expect(echo.pending).toBe('abc');

    expect(echo.handleBackendData('a')).toBeNull();
    expect(echo.pending).toBe('bc');

    expect(echo.handleBackendData('bc')).toBeNull();
    expect(echo.pending).toBe('');
  });

  it('abandons pending echo when backend data does not match', () => {
    const echo = create();

    echo.handleInput('a');
    expect(echo.handleBackendData('x')).toBe('x');
    expect(echo.pending).toBe('');
  });

  it('rolls back pending echo after maxAgeMs', () => {
    const echo = create();

    echo.handleInput('ab');
    expect(echo.pending).toBe('ab');

    vi.advanceTimersByTime(100);

    expect(flushed).toEqual(['\b \b\b \b']);
    expect(echo.pending).toBe('');
  });

  it('refreshes the rollback timer on new input', () => {
    const echo = create();

    echo.handleInput('a');
    vi.advanceTimersByTime(60);
    echo.handleInput('b');
    vi.advanceTimersByTime(60);

    // Timer was reset by the second input, so no flush yet.
    expect(flushed).toEqual([]);
    expect(echo.pending).toBe('ab');

    vi.advanceTimersByTime(50);
    expect(flushed.length).toBe(1);
  });

  it('does not echo unsafe input', () => {
    const echo = create();

    expect(echo.handleInput('\t')).toBeNull();
    expect(echo.handleInput('\x1b[A')).toBeNull();
    expect(echo.handleInput('hello')).toBeNull();
    expect(echo.pending).toBe('');
  });

  it('flushes pending echo when disabled', () => {
    const echo = create();

    echo.handleInput('a');
    enabled = false;
    expect(echo.handleInput('b')).toBeNull();

    expect(flushed).toEqual(['\b \b']);
    expect(echo.pending).toBe('');
  });

  it('renders safe input immediately, bypassing backend latency', () => {
    const echo = create();

    const rendered = echo.handleInput('a');
    expect(rendered).toBe('a');

    // Even if the backend takes a long time to echo back, the character has
    // already been rendered locally, so effective latency is zero.
    vi.advanceTimersByTime(90);
    expect(echo.handleBackendData('a')).toBeNull();
    expect(echo.pending).toBe('');
  });
});
