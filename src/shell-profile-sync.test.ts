import { describe, expect, it, vi } from 'vitest';
import { initShellProfileSync, SHELL_PROFILES_CHANGED_EVENT } from './shell-profile-sync';

describe('initShellProfileSync', () => {
  it('reloads the profile cache when the CLI reports a profile write', () => {
    const listeners = new Map<string, (payload: unknown) => void>();

    function listen<T>(event: string, handler: (payload: T) => void): () => void {
      listeners.set(event, handler as (payload: unknown) => void);
      return () => {};
    }

    const reload = vi.fn().mockResolvedValue(undefined);

    initShellProfileSync({ listen, reload });

    expect(listeners.has(SHELL_PROFILES_CHANGED_EVENT)).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    listeners.get(SHELL_PROFILES_CHANGED_EVENT)!({});
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('returns the unsubscribe function from the listener', () => {
    const unsubscribe = vi.fn();
    function listen<T>(_event: string, _handler: (payload: T) => void): () => void {
      return unsubscribe;
    }

    const dispose = initShellProfileSync({ listen, reload: () => {} });

    expect(dispose).toBe(unsubscribe);
  });
});
