// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { initCliBridge, type CliBridgeDeps } from './cli-bridge';
import type { AppCommand, CommandResult } from './domain/commands';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface Harness {
  dispatch: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
  /** Fire a `vibe99:cli-request` payload at the registered handler. */
  emit: (payload: unknown) => void;
  stop: () => void;
}

function makeHarness(overrides: Partial<CliBridgeDeps> = {}): Harness {
  // The bridge registers a CliRequest-typed handler; `any` sidesteps strict
  // contravariance so the harness can feed it arbitrary test payloads.
  let handler: ((payload: any) => void) | null = null;
  const dispatch = vi.fn((_command: AppCommand): CommandResult => ({ ok: true, value: 42 }));
  const invoke = vi.fn(async () => {});

  const stop = initCliBridge({
    dispatch,
    listen: (_event, registered) => {
      handler = registered;
      return () => {
        handler = null;
      };
    },
    invoke: invoke as unknown as CliBridgeDeps['invoke'],
    ...overrides,
  });

  return {
    dispatch,
    invoke,
    emit: (payload: unknown) => handler?.(payload),
    stop,
  };
}

function respondArgs(invoke: Harness['invoke'], callIndex = 0) {
  return invoke.mock.calls[callIndex] as [string, { id: string; result: CommandResult }];
}

// ---------------------------------------------------------------------------
// method → command mapping
// ---------------------------------------------------------------------------

describe('cli-bridge method mapping', () => {
  it('maps a method with object params onto a typed command', () => {
    const h = makeHarness();
    h.emit({ id: 'r1', method: 'pane.focus', params: { paneId: 'p1' } });

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'pane.focus', paneId: 'p1' });
    expect(respondArgs(h.invoke)).toEqual([
      'cli_respond',
      { id: 'r1', result: { ok: true, value: 42 } },
    ]);
  });

  it('maps a query method without params onto a bare command', () => {
    const h = makeHarness();
    h.emit({ id: 'r2', method: 'layout.active', params: {} });

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'layout.active' });
  });

  it('treats an absent params field as no params', () => {
    const h = makeHarness();
    h.emit({ id: 'r3', method: 'pane.list' });

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'pane.list' });
  });

  it('spreads every param key onto the command', () => {
    const h = makeHarness();
    h.emit({
      id: 'r4',
      method: 'terminal.changeShell',
      params: { paneId: 'p2', profileId: 'ssh-box' },
    });

    expect(h.dispatch).toHaveBeenCalledWith({
      type: 'terminal.changeShell',
      paneId: 'p2',
      profileId: 'ssh-box',
    });
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('cli-bridge error handling', () => {
  it('answers a primitive-params request as an unknown method without dispatching', () => {
    const h = makeHarness();
    h.emit({ id: 'r5', method: 'bogus.method', params: 'text' });

    expect(h.dispatch).not.toHaveBeenCalled();
    expect(respondArgs(h.invoke)).toEqual([
      'cli_respond',
      { id: 'r5', result: { ok: false, reason: 'unknown-cli-method: bogus.method' } },
    ]);
  });

  it('forwards a failed dispatch result back to Rust', () => {
    const h = makeHarness({
      dispatch: vi.fn((): CommandResult => ({ ok: false, reason: 'not-found' })),
    });
    h.emit({ id: 'r6', method: 'pane.info', params: { paneId: 'ghost' } });

    expect(respondArgs(h.invoke)).toEqual([
      'cli_respond',
      { id: 'r6', result: { ok: false, reason: 'not-found' } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('cli-bridge lifecycle', () => {
  it('stops listening after the returned unsubscribe runs', () => {
    const h = makeHarness();
    h.stop();
    h.emit({ id: 'r7', method: 'pane.list', params: {} });

    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
