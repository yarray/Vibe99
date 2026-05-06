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
import { createDomBehavior } from '../pane/capabilities/dom-capability.js';
import { createTerminalBehavior, type TerminalCapability } from '../pane/capabilities/terminal-capability.js';
import { createPtyBehavior, type PtyCapability, type PtyBehaviorContext } from '../pane/capabilities/pty-capability.js';
import { createActivityBehavior, type ActivityCapability } from '../pane/capabilities/activity-capability.js';
import { createClipboardBehavior } from '../pane/capabilities/clipboard-capability.js';
import { createColorBehavior } from '../pane/capabilities/color-capability.js';
import { createShellBehavior } from '../pane/capabilities/shell-capability.js';
import { createPaneActivityWatcher } from '../pane-activity-watcher.js';
import { getDefaultFontFamily } from '../settings.js';
import type { Backend } from '../backend.js';
import type { PaneAlertStrategy } from '../pane-alert-breathing-mask.js';
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
// Pty adapter — bridges PaneHandle to PtyBehaviorContext
// ---------------------------------------------------------------------------

function createPtyAdapter(
  ptyBehavior: ReturnType<typeof createPtyBehavior>,
  defaultCwd: string,
): PaneBehavior {
  return {
    name: 'pty',
    open(handle: PaneHandle): PtyCapability {
      const ctx: PtyBehaviorContext = {
        id: handle.id,
        getCwd: () => (handle.getState<string>('cwd') as string | undefined) ?? defaultCwd,
        getShellProfileId: () => handle.getState<string>('shellProfileId') ?? null,
        onOutput: (data: string) => {
          handle.capability<TerminalCapability>('terminal')?.write(data);
        },
        capability: handle.capability,
      };
      return ptyBehavior.open(ctx);
    },
    close(): void {
      ptyBehavior.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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

  // Shared activity watcher. Global onAlert/onClear callbacks dispatch to the
  // per-pane activity capability API via pane.capability().
  const watcher = createPaneActivityWatcher({
    onAlert: (paneId) => {
      const pane = panes.get(paneId);
      if (!pane) return;
      const activityApi = pane.capability<ActivityCapability>('activity');
      const domApi = pane.capability<DomCapabilityApi>('dom');
      if (activityApi && domApi) {
        activityApi.setAlerted(domApi.root, true);
      }
    },
    onClear: (paneId) => {
      const pane = panes.get(paneId);
      if (!pane) return;
      const activityApi = pane.capability<ActivityCapability>('activity');
      const domApi = pane.capability<DomCapabilityApi>('dom');
      if (activityApi && domApi) {
        activityApi.setAlerted(domApi.root, false);
      }
    },
  });

  const notify = (): void => { onStateChange?.(); };
  const genId = (): string => `p${nextPaneNumber++}`;
  const getNextAccent = (): string => {
    const used = new Set(Array.from(panes.values()).map((p) => (p.getState<string>('accent') || '#61afef').toLowerCase()));
    return getAccentPalette().find((c) => !used.has(c.toLowerCase())) ?? getAccentPalette()[(nextPaneNumber - 1) % getAccentPalette().length];
  };

  const get = (paneId: string): Pane | null => panes.get(paneId) ?? null;
  const getAll = (): Pane[] => Array.from(panes.values());
  const getActive = (): Pane | null => (activePaneId ? panes.get(activePaneId) ?? null : null);
  const getActiveId = (): string | null => activePaneId;
  const size = (): number => panes.size;

  const create = (initialState: PaneInitialState): Pane => {
    const paneId = initialState.paneId ?? genId();
    const accent = initialState.accent ?? getNextAccent();
    const state: Record<string, unknown> = {
      accent,
      title: initialState.title ?? null,
      cwd: initialState.cwd ?? defaultCwd,
      customColor: initialState.customColor,
      shellProfileId: initialState.shellProfileId ?? null,
      breathingMonitor: initialState.breathingMonitor ?? false,
      terminalTitle: defaultTabTitle,
    };

    const pane = createPane({ id: paneId, initialState: state });

    pane.use(createDomBehavior({
      paneAlert,
      onPaneClick,
      onTerminalContextMenu,
    }) as unknown as PaneBehavior);

    // 2. terminal — xterm.js lifecycle
    pane.use(createTerminalBehavior({
      getFontFamily: () => getDefaultFontFamily(backend.platform),
      getFontSize: () => 13,
      getAccent: () => pane.getState<string>('accent') ?? '#61afef',
      onData: (data) => {
        pane.capability<PtyCapability>('pty')?.write(data);
      },
      onTitleChange: (title) => {
        pane.setState({ terminalTitle: title });
      },
      onSelectionChange: () => {
        // Clipboard capability handles auto-copy via its own terminal hooks
      },
    }) as unknown as PaneBehavior);

    // 3. pty — backend PTY session lifecycle (adapter bridges PaneHandle → PtyBehaviorContext)
    const ptyBehavior = createPtyBehavior({
      backend,
      onExit: (event) => {
        console.warn(`PTY exited for pane ${event.paneId}: code=${event.exitCode} reason=${event.reason}`);
      },
    });
    pane.use(createPtyAdapter(ptyBehavior, defaultCwd));

    // 4. activity — pane-activity-watcher integration
    pane.use(createActivityBehavior({ watcher, alert: paneAlert }) as unknown as PaneBehavior);

    // 5. clipboard — auto-copy + OSC 52
    pane.use(createClipboardBehavior({ backend }) as unknown as PaneBehavior);

    // 6. color — accent color management
    pane.use(createColorBehavior({
      getAccent: () => pane.getState<string>('accent') ?? '#61afef',
      setCustomColor: (_paneId: string, _color: string) => {
        // DOM update handled by render loop watching state changes
      },
      clearCustomColor: (_paneId: string) => {
        // DOM update handled by render loop watching state changes
      },
      scheduleWindowLayoutSave: () => onStateChange?.(),
    }) as unknown as PaneBehavior);

    // 7. shell — shell profile switching
    pane.use(createShellBehavior({
      scheduleWindowLayoutSave: () => onStateChange?.(),
    }) as unknown as PaneBehavior);

    pane.open();

    void pane.capability<PtyCapability>('pty')?.create(80, 24);

    panes.set(paneId, pane);
    activePaneId = paneId;
    notify();
    return pane;
  };

  const destroy = (paneId: string): boolean => {
    const pane = panes.get(paneId);
    if (!pane || panes.size === 1) return false;
    pane.close();
    panes.delete(paneId);
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
    for (const paneId of panes.keys()) { panes.get(paneId)?.close(); }
    panes.clear();
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
