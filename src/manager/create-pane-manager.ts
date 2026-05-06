/**
 * Pane Manager — Collection CRUD, Focus Management, Layout Coordination
 *
 * Manages multiple Pane instances, focus state, and session persistence.
 * Integrates with backend for PTY creation/destruction.
 *
 * Capability mounting order: dom → terminal → pty → activity → clipboard → color → shell
 *
 * @module manager/create-pane-manager
 */

import { createPane, type Pane, type PaneDeps, type PaneBehavior } from '../pane/create-pane.js';
import { createDomBehavior } from '../pane/capabilities/dom-capability.js';
import { createActivityBehavior } from '../pane/capabilities/activity-capability.js';
import { createClipboardBehavior } from '../pane/capabilities/clipboard-capability.js';
import { createPaneActivityWatcher } from '../pane-activity-watcher.js';
import type { Backend } from '../backend.js';
import type { PaneAlertStrategy } from '../pane-alert-breathing-mask.js';
import type { ActivityCapability } from '../pane/capabilities/activity-capability.js';
import type { DomCapabilityApi } from '../pane/capabilities/dom-capability.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionPaneEntry {
  paneId: string;
  title: string | null;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor: boolean;
}

export interface PaneInitialState {
  paneId?: string;
  title: string | null;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor?: boolean;
}

export interface PaneManagerDeps {
  backend: Backend;
  paneAlert: PaneAlertStrategy;
  onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  onTerminalContextMenu: (node: { paneId: string; root: HTMLElement; terminalHost: HTMLElement }, event: MouseEvent) => Promise<void> | void;
  onStateChange?: () => void;
  defaultCwd?: string;
  defaultTabTitle?: string;
  getAccentPalette?: () => string[];
}

export interface PaneManager {
  get(paneId: string): Pane | null;
  getAll(): Pane[];
  getActive(): Pane | null;
  getActiveId(): string | null;
  size(): number;
  create(initialState: PaneInitialState): Pane;
  destroy(paneId: string): boolean;
  setActive(paneId: string): boolean;
  serializeAll(): SessionPaneEntry[];
  restoreSession(entries: SessionPaneEntry[], focusedPaneIndex: number): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaneManager(deps: PaneManagerDeps): PaneManager {
  const { backend, paneAlert, onPaneClick, onTerminalContextMenu, onStateChange, defaultCwd = backend.defaultCwd, defaultTabTitle = backend.defaultTabTitle, getAccentPalette = () => ['#61afef', '#98c379', '#e5c07b', '#c678dd', '#e06c75'], } = deps;

  const panes = new Map<string, Pane>();
  const capabilityApis = new Map<string, Map<string, unknown>>();
  let activePaneId: string | null = null;
  let nextPaneNumber = 1;

  // Shared activity watcher. Global onAlert/onClear callbacks dispatch to the
  // per-pane activity capability API.
  const watcher = createPaneActivityWatcher({
    onAlert: (paneId) => {
      const apis = capabilityApis.get(paneId);
      const activityApi = apis?.get('activity') as ActivityCapability | undefined;
      const domApi = apis?.get('dom') as DomCapabilityApi | undefined;
      if (activityApi && domApi) {
        activityApi.setAlerted(domApi.root, true);
      }
    },
    onClear: (paneId) => {
      const apis = capabilityApis.get(paneId);
      const activityApi = apis?.get('activity') as ActivityCapability | undefined;
      const domApi = apis?.get('dom') as DomCapabilityApi | undefined;
      if (activityApi && domApi) {
        activityApi.setAlerted(domApi.root, false);
      }
    },
  });

  // Capability factories: dom → terminal → pty → activity → clipboard → color → shell
  const stub = (name: string) => ({ name, create: () => ({ name, open: () => ({ stub: true }), close: () => {} }) });
  const capabilityFactories = [
    { name: 'dom', create: (d: unknown) => createDomBehavior(d as Parameters<typeof createDomBehavior>[0]) },
    stub('terminal'), stub('pty'),
    { name: 'activity', create: () => createActivityBehavior({ watcher, alert: paneAlert }) },
    { name: 'clipboard', create: () => createClipboardBehavior({ backend }) },
    stub('color'), stub('shell'),
  ];

  const notify = (): void => { onStateChange?.(); };
  const genId = (): string => `p${nextPaneNumber++}`;
  const getNextAccent = (): string => {
    const used = new Set(Array.from(panes.values()).map((p) => (p.getState<string>('accent') || '#61afef').toLowerCase()));
    return getAccentPalette().find((c) => !used.has(c.toLowerCase())) ?? getAccentPalette()[(nextPaneNumber - 1) % getAccentPalette().length];
  };

  const createPty = async (paneId: string, cwd: string, shellProfileId: string | null): Promise<void> => {
    try { await backend.terminal.create({ paneId, cols: 80, rows: 24, cwd, shellProfileId: shellProfileId ?? undefined }); }
    catch (e) { console.error(`Failed to create PTY for ${paneId}:`, e); }
  };
  const destroyPty = async (paneId: string): Promise<void> => {
    try { await backend.terminal.destroy({ paneId }); }
    catch (e) { console.error(`Failed to destroy PTY for ${paneId}:`, e); }
  };

  const get = (paneId: string): Pane | null => panes.get(paneId) ?? null;
  const getAll = (): Pane[] => Array.from(panes.values());
  const getActive = (): Pane | null => (activePaneId ? panes.get(activePaneId) ?? null : null);
  const getActiveId = (): string | null => activePaneId;
  const size = (): number => panes.size;

  const create = (initialState: PaneInitialState): Pane => {
    const paneId = initialState.paneId ?? genId();
    const state: Record<string, unknown> = {
      accent: initialState.accent ?? getNextAccent(),
      title: initialState.title ?? null,
      cwd: initialState.cwd ?? defaultCwd,
      customColor: initialState.customColor,
      shellProfileId: initialState.shellProfileId ?? null,
      breathingMonitor: initialState.breathingMonitor ?? false,
      terminalTitle: defaultTabTitle,
    };
    const pane = createPane({
      id: paneId,
      initialState: state,
      deps: { onEvent: (e, id) => { if (e.type === 'close') capabilityApis.delete(id); } },
    });

    const apis = new Map<string, unknown>();
    const domDeps = { paneAlert, onPaneClick, onTerminalContextMenu };
    for (const factory of capabilityFactories) {
      const behavior = factory.name === 'dom' ? factory.create(domDeps) : factory.create(null);
      pane.use(behavior as unknown as PaneBehavior);
      const api = (behavior as { open: (ctx: unknown) => unknown }).open({ id: paneId, getState: pane.getState, emit: () => {}, capability: pane.capability.bind(pane) });
      if (api && typeof api === 'object') apis.set(factory.name, api);
    }
    capabilityApis.set(paneId, apis);
    pane.open();
    void createPty(paneId, initialState.cwd ?? defaultCwd, initialState.shellProfileId ?? null);
    panes.set(paneId, pane);
    activePaneId = paneId;
    notify();
    return pane;
  };

  const destroy = (paneId: string): boolean => {
    const pane = panes.get(paneId);
    if (!pane || panes.size === 1) return false;
    void destroyPty(paneId);
    pane.close();
    panes.delete(paneId);
    capabilityApis.delete(paneId);
    if (activePaneId === paneId) activePaneId = Array.from(panes.keys())[0] ?? null;
    notify();
    return true;
  };

  const setActive = (paneId: string): boolean => {
    if (!panes.has(paneId)) return false;
    activePaneId = paneId;
    notify();
    return true;
  };

  const serializeAll = (): SessionPaneEntry[] => Array.from(panes.values()).map((pane) => {
    const s = pane.serialize().state;
    return {
      paneId: pane.id,
      title: (s.title as string | null) ?? null,
      cwd: (s.cwd as string) ?? defaultCwd,
      accent: (s.accent as string) ?? '#61afef',
      customColor: s.customColor as string | undefined,
      shellProfileId: (s.shellProfileId as string | null) ?? null,
      breathingMonitor: (s.breathingMonitor as boolean) ?? false,
    };
  });

  const restoreSession = (entries: SessionPaneEntry[], focusedPaneIndex: number): void => {
    for (const paneId of panes.keys()) { void destroyPty(paneId); panes.get(paneId)?.close(); }
    panes.clear();
    capabilityApis.clear();
    nextPaneNumber = 1;
    activePaneId = null;
    for (const entry of entries) {
      create({ paneId: entry.paneId, title: entry.title, cwd: entry.cwd, accent: entry.accent, customColor: entry.customColor, shellProfileId: entry.shellProfileId, breathingMonitor: entry.breathingMonitor });
      nextPaneNumber = Math.max(nextPaneNumber, parseInt(entry.paneId.slice(1)) + 1);
    }
    const ids = Array.from(panes.keys());
    if (ids.length > 0) activePaneId = ids[Math.max(0, Math.min(focusedPaneIndex, ids.length - 1))];
    notify();
  };

  return { get, getAll, getActive, getActiveId, size, create, destroy, setActive, serializeAll, restoreSession };
}
