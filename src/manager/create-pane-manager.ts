/**
 * Pane Manager — Collection CRUD, Focus Management, Layout Coordination
 *
 * Manages multiple Pane instances, focus state, and session persistence.
 * Integrates with backend for PTY creation/destruction.
 *
 * Capability mounting order: dom → terminal → pty → activity → clipboard → color → shell
 * Lifecycle: pane.use(behavior) × N → pane.open() → all behaviors opened in order
 *
 * @module manager/create-pane-manager
 */

import { createPane, type Pane, type PaneBehavior, type PaneHandle } from '../pane/create-pane.js';
import { createDomBehavior, type DomCapabilityApi } from '../pane/capabilities/dom-capability.js';
import { createTerminalBehavior, type TerminalCapability } from '../pane/capabilities/terminal-capability.js';
import { createPtyBehavior, type PtyCapability, type PtyBehaviorContext } from '../pane/capabilities/pty-capability.js';
import { createActivityBehavior, type ActivityCapability } from '../pane/capabilities/activity-capability.js';
import { createClipboardBehavior } from '../pane/capabilities/clipboard-capability.js';
import { createColorBehavior, type ColorCapability } from '../pane/capabilities/color-capability.js';
import { createShellBehavior, type ShellCapability } from '../pane/capabilities/shell-capability.js';
import { createPaneActivityWatcher } from '../pane-activity-watcher.js';
import { getDefaultFontFamily } from '../settings.js';
import type { Backend } from '../backend.js';
import type { PaneAlertStrategy } from '../pane-alert-breathing-mask.js';

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
  setLayout(paneId: string, layout: { left: number; height: number; zIndex: number }): void;
  setFocused(paneId: string, isFocused: boolean, isNavTarget: boolean): void;
  setAccent(paneId: string, color: string): void;
  closeAll(): void;
  isFocused(paneId: string): boolean;
  getFocusedIndex(): number;
  getPaneIndex(paneId: string): number;
  getPaneIdAt(index: number): string | null;
  changePaneShell(paneId: string, profileId: string): Promise<void>;
  getPaneAccent(paneId: string): string;
  setPaneCustomColor(paneId: string, color: string): void;
  clearPaneCustomColor(paneId: string): void;
  getPaneState<K extends string>(paneId: string, key: K): unknown;
  setPaneState<K extends string>(paneId: string, key: K, value: unknown): void;
  getPaneTitle(paneId: string): string | null;
  setPaneTitle(paneId: string, title: string): void;
  togglePaneBreathingMonitor(paneId: string): boolean;
}

// Pty adapter bridges PaneHandle to PtyBehaviorContext
function createPtyAdapter(ptyBehavior: ReturnType<typeof createPtyBehavior>, defaultCwd: string): PaneBehavior {
  return {
    name: 'pty',
    open(handle: PaneHandle): PtyCapability {
      const ctx: PtyBehaviorContext = {
        id: handle.id,
        getCwd: () => (handle.getState<string>('cwd') as string | undefined) ?? defaultCwd,
        getShellProfileId: () => handle.getState<string>('shellProfileId') ?? null,
        onOutput: (data: string) => { handle.capability<TerminalCapability>('terminal')?.write(data); },
        capability: handle.capability,
      };
      return ptyBehavior.open(ctx);
    },
    close(): void { ptyBehavior.close(); },
  };
}

// Factory
export function createPaneManager(deps: PaneManagerDeps): PaneManager {
  const {
    backend,
    paneAlert,
    onPaneClick,
    onTerminalContextMenu,
    onStateChange,
    defaultCwd = backend.defaultCwd,
    defaultTabTitle = backend.defaultTabTitle,
    getAccentPalette = () => ['#61afef', '#98c379', '#e5c07b', '#c678dd', '#e06c75'],
  } = deps;

  const panes = new Map<string, Pane>();
  let activePaneId: string | null = null;
  let nextPaneNumber = 1;

  const notify = (): void => { onStateChange?.(); };
  const genId = (): string => `p${nextPaneNumber++}`;
  const ids = () => Array.from(panes.keys());
  const getPane = (paneId: string) => panes.get(paneId);

  // Shared activity watcher
  const watcher = createPaneActivityWatcher({
    onAlert: (paneId) => {
      const pane = getPane(paneId);
      const activityApi = pane?.capability<ActivityCapability>('activity');
      const domApi = pane?.capability<DomCapabilityApi>('dom');
      if (activityApi && domApi) activityApi.setAlerted(domApi.root, true);
    },
    onClear: (paneId) => {
      const pane = getPane(paneId);
      const activityApi = pane?.capability<ActivityCapability>('activity');
      const domApi = pane?.capability<DomCapabilityApi>('dom');
      if (activityApi && domApi) activityApi.setAlerted(domApi.root, false);
    },
  });

  const get = (paneId: string): Pane | null => getPane(paneId) ?? null;
  const getAll = (): Pane[] => Array.from(panes.values());
  const getActive = (): Pane | null => (activePaneId ? getPane(activePaneId) ?? null : null);
  const getActiveId = (): string | null => activePaneId;
  const size = (): number => panes.size;

  const create = (initialState: PaneInitialState): Pane => {
    const paneId = initialState.paneId ?? genId();
    const accent = initialState.accent ?? (() => {
      const used = new Set(getAll().map((p) => (p.getState<string>('accent') || '#61afef').toLowerCase()));
      return getAccentPalette().find((c) => !used.has(c.toLowerCase())) ?? getAccentPalette()[(nextPaneNumber - 1) % getAccentPalette().length];
    })();
    const state: Record<string, unknown> = {
      accent, title: initialState.title ?? null, cwd: initialState.cwd ?? defaultCwd,
      customColor: initialState.customColor, shellProfileId: initialState.shellProfileId ?? null,
      breathingMonitor: initialState.breathingMonitor ?? false, terminalTitle: defaultTabTitle,
    };

    const pane = createPane({ id: paneId, initialState: state });

    // Mount capabilities
    pane.use(createDomBehavior({ paneAlert, onPaneClick, onTerminalContextMenu }) as unknown as PaneBehavior);
    pane.use(createTerminalBehavior({
      getFontFamily: () => getDefaultFontFamily(backend.platform),
      getFontSize: () => 13,
      getAccent: () => pane.getState<string>('accent') ?? '#61afef',
      onData: (data) => { pane.capability<PtyCapability>('pty')?.write(data); },
      onTitleChange: (title) => { pane.setState({ terminalTitle: title }); },
      onSelectionChange: () => {},
    }) as unknown as PaneBehavior);

    const ptyBehavior = createPtyBehavior({ backend, onExit: (event) => { console.warn(`PTY exited for pane ${event.paneId}: code=${event.exitCode} reason=${event.reason}`); } });
    pane.use(createPtyAdapter(ptyBehavior, defaultCwd));
    pane.use(createActivityBehavior({ watcher, alert: paneAlert }) as unknown as PaneBehavior);
    pane.use(createClipboardBehavior({ backend }) as unknown as PaneBehavior);
    pane.use(createColorBehavior({
      getAccent: () => pane.getState<string>('accent') ?? '#61afef',
      setCustomColor: () => {},
      clearCustomColor: () => {},
      scheduleWindowLayoutSave: () => onStateChange?.(),
    }) as unknown as PaneBehavior);
    pane.use(createShellBehavior({ scheduleWindowLayoutSave: () => onStateChange?.() }) as unknown as PaneBehavior);

    pane.open();
    void pane.capability<PtyCapability>('pty')?.create(80, 24);
    panes.set(paneId, pane);
    activePaneId = paneId;
    notify();
    return pane;
  };

  const destroy = (paneId: string): boolean => {
    const pane = getPane(paneId);
    if (!pane || panes.size === 1) return false;
    pane.close();
    panes.delete(paneId);
    if (activePaneId === paneId) activePaneId = ids()[0] ?? null;
    notify();
    return true;
  };

  const setActive = (paneId: string): boolean => {
    if (!panes.has(paneId)) return false;
    activePaneId = paneId;
    notify();
    return true;
  };

  const serializeAll = (): SessionPaneEntry[] => getAll().map((pane) => {
    const s = pane.serialize().state;
    return { paneId: pane.id, title: (s.title as string | null) ?? null, cwd: (s.cwd as string) ?? defaultCwd, accent: (s.accent as string) ?? '#61afef', customColor: s.customColor as string | undefined, shellProfileId: (s.shellProfileId as string | null) ?? null, breathingMonitor: (s.breathingMonitor as boolean) ?? false };
  });

  const restoreSession = (entries: SessionPaneEntry[], focusedPaneIndex: number): void => {
    for (const paneId of ids()) { getPane(paneId)?.close(); }
    panes.clear();
    nextPaneNumber = 1;
    activePaneId = null;
    for (const entry of entries) {
      create({ paneId: entry.paneId, title: entry.title, cwd: entry.cwd, accent: entry.accent, customColor: entry.customColor, shellProfileId: entry.shellProfileId, breathingMonitor: entry.breathingMonitor });
      nextPaneNumber = Math.max(nextPaneNumber, parseInt(entry.paneId.slice(1)) + 1);
    }
    if (ids().length > 0) activePaneId = ids()[Math.max(0, Math.min(focusedPaneIndex, ids().length - 1))];
    notify();
  };

  const setLayout = (paneId: string, layout: { left: number; height: number; zIndex: number }): void => {
    getPane(paneId)?.capability<DomCapabilityApi>('dom')?.setLayout(layout);
  };

  const setFocused = (paneId: string, isFocused: boolean, isNavTarget: boolean): void => {
    getPane(paneId)?.capability<DomCapabilityApi>('dom')?.setFocused(isFocused, isNavTarget);
  };

  const setAccent = (paneId: string, color: string): void => {
    getPane(paneId)?.capability<DomCapabilityApi>('dom')?.setAccent(color);
  };

  const closeAll = (): void => {
    for (const paneId of ids()) { getPane(paneId)?.close(); }
    panes.clear();
    activePaneId = null;
    notify();
  };

  const isFocused = (paneId: string): boolean => activePaneId === paneId;
  const getFocusedIndex = (): number => activePaneId ? ids().indexOf(activePaneId) : 0;
  const getPaneIndex = (paneId: string): number => ids().indexOf(paneId);
  const getPaneIdAt = (index: number): string | null => ids()[index] ?? null;

  const changePaneShell = async (paneId: string, profileId: string): Promise<void> => {
    await getPane(paneId)?.capability<ShellCapability>('shell')?.changeProfile(profileId);
  };

  const getPaneAccent = (paneId: string): string => getPane(paneId)?.capability<ColorCapability>('color')?.getAccent() ?? '#61afef';
  const setPaneCustomColor = (paneId: string, color: string): void => { getPane(paneId)?.capability<ColorCapability>('color')?.setCustomColor(color); };
  const clearPaneCustomColor = (paneId: string): void => { getPane(paneId)?.capability<ColorCapability>('color')?.clearCustomColor(); };

  const getPaneState = <K extends string>(paneId: string, key: K): unknown => getPane(paneId)?.getState(key);
  const setPaneState = <K extends string>(paneId: string, key: K, value: unknown): void => { getPane(paneId)?.setState({ [key]: value }); };
  const getPaneTitle = (paneId: string): string | null => (getPane(paneId)?.getState('title') as string | null) ?? null;
  const setPaneTitle = (paneId: string, title: string): void => { getPane(paneId)?.setState({ title }); };

  const togglePaneBreathingMonitor = (paneId: string): boolean => {
    const pane = getPane(paneId);
    if (!pane) return false;
    const current = pane.getState<boolean>('breathingMonitor') ?? false;
    pane.setState({ breathingMonitor: !current });
    const next = !current;
    pane.capability<ActivityCapability>('activity')?.setEnabled(next);
    watcher.setPaneEnabled(paneId, next);
    return next;
  };

  return {
    get, getAll, getActive, getActiveId, size, create, destroy, setActive, serializeAll, restoreSession,
    setLayout, setFocused, setAccent, closeAll, isFocused, getFocusedIndex, getPaneIndex, getPaneIdAt,
    changePaneShell, getPaneAccent, setPaneCustomColor, clearPaneCustomColor,
    getPaneState, setPaneState, getPaneTitle, setPaneTitle, togglePaneBreathingMonitor,
  };
}
