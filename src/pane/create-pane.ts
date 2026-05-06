/**
 * Pane Core Lifecycle & Capability Registry
 * Pure logic — no DOM, no IPC.
 */
export interface PaneBehavior {
  name: string;
  open?: (h: PaneHandle) => unknown;
  close?: (h: PaneHandle) => void | Promise<void>;
  command?: (h: PaneHandle, payload: unknown) => unknown;
}

export interface PaneHandle {
  id: string;
  getState: <T>(k: string) => T | undefined;
  capability: <T>(name: string) => T | undefined;
  emit: (event: string, payload?: unknown) => void;
}
export interface PaneDeps { onEvent?: (e: PaneLifecycleEvent, paneId: string) => void; }

export type PaneLifecycleEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'command'; name: string; payload: unknown }
  | { type: 'state-change'; key: string };

export interface Pane {
  id: string;
  use(b: PaneBehavior): void;
  open(): Pane;
  command<T = unknown>(name: string, payload?: unknown): T | undefined;
  capability<T = unknown>(name: string): T | undefined;
  getState<T>(key: string): T | undefined;
  setState(patch: Record<string, unknown>): void;
  close(): void;
  on(event: 'lifecycle' | string, handler: (e: PaneLifecycleEvent) => void): () => void;
  serialize(): { id: string; state: Record<string, unknown> };
}

export function createPane({ id, initialState = {}, deps = {} }: {
  id: string;
  initialState?: Record<string, unknown>;
  deps?: PaneDeps;
}): Pane {
  const behaviors: PaneBehavior[] = [];
  const capabilities = new Map<string, unknown>();
  let isOpen = false, isClosed = false;
  let state: Record<string, unknown> = { ...initialState };

  const handle: PaneHandle = {
    id,
    getState: <T>(k: string): T | undefined => state[k] as T,
    capability: <T>(name: string): T | undefined => capabilities.get(name) as T | undefined,
    emit: (event: string, payload?: unknown): void => {
      for (const h of listeners[event] ?? []) h({ type: event } as PaneLifecycleEvent);
      deps.onEvent?.({ type: event } as PaneLifecycleEvent, id);
    },
  };

  const listeners: Record<string, ((e: PaneLifecycleEvent) => void)[]> = {};

  const emit = (e: PaneLifecycleEvent): void => {
    deps.onEvent?.(e, id);
    for (const h of listeners[e.type] ?? []) h(e);
    for (const h of listeners['lifecycle'] ?? []) h(e);
  };

  const use = (b: PaneBehavior): void => { if (!isClosed) behaviors.push(b); };

  const open = (): Pane => {
    if (isOpen || isClosed) return pane;
    isOpen = true;
    for (const b of behaviors) {
      const api = b.open?.(handle);
      if (api !== undefined) capabilities.set(b.name, api);
    }
    emit({ type: 'open' });
    return pane;
  };

  const command = <T = unknown>(name: string, payload?: unknown): T | undefined => {
    for (const b of behaviors) {
      if (typeof b.command === 'function') {
        const r = b.command(handle, payload);
        if (r !== undefined) { emit({ type: 'command', name, payload }); return r as T; }
      }
    }
    emit({ type: 'command', name, payload });
    return undefined;
  };

  const capability = <T = unknown>(name: string): T | undefined => {
    return capabilities.get(name) as T | undefined;
  };

  const getState = <T>(key: string): T | undefined => state[key] as T;

  const setState = (patch: Record<string, unknown>): void => {
    state = { ...state, ...patch };
    for (const k of Object.keys(patch)) emit({ type: 'state-change', key: k });
  };

  const close = (): void => {
    if (isClosed) return;
    isClosed = true;
    for (let i = behaviors.length - 1; i >= 0; i--) behaviors[i].close?.(handle);
    emit({ type: 'close' });
  };

  const on = (event: string, handler: (e: PaneLifecycleEvent) => void): (() => void) => {
    (listeners[event] ??= []).push(handler);
    return (): void => { const l = listeners[event]; if (l) { const i = l.indexOf(handler); if (i !== -1) l.splice(i, 1); } };
  };

  const serialize = (): { id: string; state: Record<string, unknown> } => ({ id, state: { ...state } });

  const pane: Pane = { id, use, open, command, capability, getState, setState, close, on, serialize };
  return pane;
}
