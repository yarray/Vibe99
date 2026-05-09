/**
 * PaneManager — pane collection CRUD, focus management, and session persistence.
 *
 * @module manager/create-pane-manager
 */

import { createPane } from '../pane/create-pane';
import type { PaneHandle, PaneState } from '../pane/create-pane';
import type { Backend } from '../backend';
import type { PaneAlertStrategy } from '../pane-alert-breathing-mask';
import type { PaneActivityWatcher } from '../pane-activity-watcher';

import { createDomBehavior } from '../pane/capabilities/dom-capability';
import { createTerminalBehavior } from '../pane/capabilities/terminal-capability';
import { createPtyBehavior } from '../pane/capabilities/pty-capability';
import { createActivityBehavior } from '../pane/capabilities/activity-capability';
import { createClipboardBehavior } from '../pane/capabilities/clipboard-capability';
import { createColorBehavior } from '../pane/capabilities/color-capability';
import { createShellBehavior } from '../pane/capabilities/shell-capability';

import { ACCENT_PALETTE } from '../colors-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaneManagerDeps {
  backend: Backend;
  container: HTMLElement;
  paneAlert: PaneAlertStrategy;
  activityWatcher: PaneActivityWatcher;
  fontFamily: string;
  fontSize: number;
  onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  onTerminalContextMenu: (paneId: string, event: MouseEvent) => Promise<void> | void;
  onStateChange?: () => void;
}

export interface SerializedPane {
  id: string;
  state: PaneState;
}

export interface PaneManager {
  create(initialState?: Partial<PaneState>): string;
  destroy(paneId: string): boolean;
  get(paneId: string): PaneHandle | null;
  getAll(): ReadonlyArray<PaneHandle>;
  getActive(): PaneHandle | null;
  getActiveId(): string | null;
  setActive(paneId: string): boolean;
  size(): number;
  serializeAll(): SerializedPane[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaneManager(deps: PaneManagerDeps): PaneManager {
  const panes = new Map<string, PaneHandle>();
  let activeId: string | null = null;

  const allocateAccent = (): string => {
    const used = new Set<string>();
    for (const p of panes.values()) {
      const custom = p.getState('customColor');
      const accent = p.getState('accent');
      if (custom) used.add(custom.toLowerCase());
      else if (accent) used.add(accent.toLowerCase());
    }
    return ACCENT_PALETTE.find((c) => !used.has(c.toLowerCase()))
      || ACCENT_PALETTE[panes.size % ACCENT_PALETTE.length];
  };

  const nextPaneNumber = (): number => {
    let max = 0;
    for (const p of panes.values()) {
      const num = parseInt(p.id.slice(1), 10);
      if (num > max) max = num;
    }
    return max + 1;
  };

  const notify = (): void => { deps.onStateChange?.(); };

  const create = (initialState?: Partial<PaneState>): string => {
    const accent = initialState?.accent || allocateAccent();
    const id = `p${nextPaneNumber()}`;

    const pane = createPane({
      id,
      initialState: { ...initialState, accent },
      deps: {
        onEvent: (event, paneId) => {
          if (event.type === 'state-change' && paneId === id) notify();
        },
      },
    });

    // Mount capabilities in fixed order: dom → terminal → pty → activity → clipboard → color → shell
    pane.use(createDomBehavior({
      onPaneClick: deps.onPaneClick,
      onTerminalContextMenu: deps.onTerminalContextMenu,
      paneAlert: deps.paneAlert,
    }));

    pane.use(createTerminalBehavior({
      getTerminalHost: () => {
        const dom = pane.capability<import('../pane/capabilities/dom-capability').DomCapabilityApi>('dom');
        return dom?.terminalHost ?? document.createElement('div');
      },
      platform: deps.backend.platform,
      fontFamily: deps.fontFamily,
      fontSize: deps.fontSize,
      onLinkActivate: (event: MouseEvent, uri: string): void => {
        if (!event.ctrlKey && !(deps.backend.platform === 'darwin' && event.metaKey)) return;
        event.preventDefault();
        event.stopPropagation();
        void deps.backend.window.openUrl(uri);
      },
    }));

    pane.use(createPtyBehavior({
      backend: deps.backend,
      getTerminal: () => pane.capability<import('../pane/capabilities/terminal-capability').TerminalCapabilityApi>('terminal'),
    }));

    pane.use(createActivityBehavior({
      watcher: deps.activityWatcher,
    }));

    pane.use(createClipboardBehavior({
      backend: deps.backend,
      getTerminal: () => pane.capability<import('../pane/capabilities/terminal-capability').TerminalCapabilityApi>('terminal'),
    }));

    pane.use(createColorBehavior({
      getDom: () => pane.capability<import('../pane/capabilities/dom-capability').DomCapabilityApi>('dom'),
      getTerminal: () => pane.capability<import('../pane/capabilities/terminal-capability').TerminalCapabilityApi>('terminal'),
    }));

    pane.use(createShellBehavior({
      getPty: () => pane.capability<import('../pane/capabilities/pty-capability').PtyCapabilityApi>('pty'),
      getTerminal: () => pane.capability<import('../pane/capabilities/terminal-capability').TerminalCapabilityApi>('terminal'),
    }));

    // Open — initialises all capabilities
    pane.open();

    // Mount DOM
    const dom = pane.capability<import('../pane/capabilities/dom-capability').DomCapabilityApi>('dom');
    if (dom) dom.mount(deps.container);

    panes.set(id, pane);
    activeId = id;

    // Spawn PTY session
    const term = pane.capability<import('../pane/capabilities/terminal-capability').TerminalCapabilityApi>('terminal');
    const pty = pane.capability<import('../pane/capabilities/pty-capability').PtyCapabilityApi>('pty');
    if (term && pty) {
      const cols = Math.max(20, term.instance.cols || 80);
      const rows = Math.max(8, term.instance.rows || 24);
      pty.create(cols, rows).catch(() => {});
    }

    notify();
    return id;
  };

  const destroy = (paneId: string): boolean => {
    const pane = panes.get(paneId);
    if (!pane) return false;

    const dom = pane.capability<import('../pane/capabilities/dom-capability').DomCapabilityApi>('dom');
    if (dom) dom.unmount();

    pane.close();
    panes.delete(paneId);

    if (activeId === paneId) {
      const remaining = [...panes.keys()];
      activeId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

    notify();
    return true;
  };

  const get = (paneId: string): PaneHandle | null => panes.get(paneId) ?? null;

  const getAll = (): ReadonlyArray<PaneHandle> => [...panes.values()];

  const getActive = (): PaneHandle | null => {
    if (activeId === null) return null;
    return panes.get(activeId) ?? null;
  };

  const getActiveId = (): string | null => activeId;

  const setActive = (paneId: string): boolean => {
    if (!panes.has(paneId)) return false;
    activeId = paneId;
    notify();
    return true;
  };

  const size = (): number => panes.size;

  const serializeAll = (): SerializedPane[] => {
    const result: SerializedPane[] = [];
    for (const pane of panes.values()) {
      result.push(pane.serialize());
    }
    return result;
  };

  return { create, destroy, get, getAll, getActive, getActiveId, setActive, size, serializeAll };
}
