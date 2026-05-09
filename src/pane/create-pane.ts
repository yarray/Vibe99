import type {
  PaneCapability,
  PaneContext,
  PaneDeps,
  PaneHandle,
  PaneLifecycleEvent,
  PaneState,
} from './types';

export type { PaneCapability, PaneContext, PaneDeps, PaneHandle, PaneLifecycleEvent, PaneState };

export function createPane({ id, initialState, deps }: {
  id: string;
  initialState?: Partial<PaneState>;
  deps?: PaneDeps;
}): PaneHandle {
  const behaviors: PaneCapability[] = [];
  const capabilities = new Map<string, unknown>();
  const listeners: Record<string, ((e: PaneLifecycleEvent) => void)[]> = {};
  let state: PaneState = { id, accent: '', cwd: '', shellProfileId: null, ...initialState };
  let isOpen = false;
  let isClosed = false;

  const emit = (e: PaneLifecycleEvent): void => {
    deps?.onEvent?.(e, id);
    for (const h of listeners[e.type] ?? []) h(e);
    for (const h of listeners['lifecycle'] ?? []) h(e);
  };

  const ctx: PaneContext = {
    id,
    getState: <K extends keyof PaneState>(key: K): PaneState[K] | undefined => state[key],
    setState: (patch: Partial<PaneState>): void => {
      state = { ...state, ...patch };
      for (const k of Object.keys(patch)) emit({ type: 'state-change', key: k });
    },
    emit: (event: string, payload?: unknown): void => {
      for (const h of listeners[event] ?? []) h({ type: event } as PaneLifecycleEvent);
      deps?.onEvent?.({ type: event } as PaneLifecycleEvent, id);
    },
    capability: <T>(name: string): T | undefined => capabilities.get(name) as T | undefined,
    deps: deps ?? {},
  };

  const use = (b: PaneCapability): void => {
    if (!isClosed) behaviors.push(b);
  };

  const open = (): PaneHandle => {
    if (isOpen || isClosed) return handle;
    isOpen = true;
    for (const b of behaviors) {
      const api = b.open(ctx);
      capabilities.set(b.name, api);
    }
    emit({ type: 'open' });
    return handle;
  };

  const command = (name: string, payload?: unknown): void => {
    emit({ type: 'command', name, payload });
    ctx.emit(`command:${name}`, payload);
  };

  const capability = <T>(name: string): T | undefined =>
    capabilities.get(name) as T | undefined;

  const getState = <K extends keyof PaneState>(key: K): PaneState[K] | undefined =>
    state[key];

  const setState = (patch: Partial<PaneState>): void => {
    state = { ...state, ...patch };
    for (const k of Object.keys(patch)) emit({ type: 'state-change', key: k });
  };

  const close = (): void => {
    if (isClosed) return;
    isClosed = true;
    for (let i = behaviors.length - 1; i >= 0; i--) {
      const b = behaviors[i];
      if (b.close) b.close(ctx, capabilities.get(b.name));
    }
    capabilities.clear();
    emit({ type: 'close' });
  };

  const on = (event: string, handler: (e: PaneLifecycleEvent) => void): (() => void) => {
    (listeners[event] ??= []).push(handler);
    return (): void => {
      const list = listeners[event];
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  };

  const serialize = (): { id: string; state: PaneState } => ({ id, state: { ...state } });

  const handle: PaneHandle = {
    id, use, open, command, capability, getState, setState, close, on, serialize,
  };
  return handle;
}
