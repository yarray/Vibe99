/**
 * Workbench Session Coordination
 *
 * Workbench owns the active Layout and the TerminalSession collection for a
 * single window. It coordinates session lifecycle with Layout state and
 * orchestrates rendering.
 *
 * Workbench is a window-level entity, not a global application state.
 *
 * @module runtime/workbench
 */

import type { Layout } from '../domain/layout.js';
import type { Pane as PaneEntity } from '../domain/pane.js';
import type { Pane } from '../pane-state';
import type { TerminalSession } from './terminal-session.js';
import { createTerminalSession, type TerminalSessionDeps } from './terminal-session.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Render options for Workbench.render()
 */
export interface WorkbenchRenderOptions {
  /** Force refit all terminals */
  refit?: boolean;
}

/**
 * Session close options
 */
export interface CloseSessionOptions {
  /** Whether to destroy the PTY process */
  destroyPty?: boolean;
}

/**
 * Dependencies injected into `createWorkbench`.
 */
export interface WorkbenchDeps {
  /** The active Layout aggregate root */
  layout: Layout;

  /** Terminal session dependencies (passed through to createTerminalSession) */
  terminalSessionDeps: Omit<
    TerminalSessionDeps,
    'getPaneSnapshot' | 'onPaneClick' | 'onTitleChange' | 'onContextMenu' | 'onCwdChanged' | 'onTabRefreshNeeded'
  > & {
    /** Get pane snapshot - returns legacy Pane type for compatibility with terminal-session */
    getPaneSnapshot: (paneId: string) => Pane | null;
    onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
    onTitleChange: (paneId: string, title: string) => void;
    onCwdChanged: (paneId: string, cwd: string) => void;
    onTabRefreshNeeded: (paneId: string) => void;
    onContextMenu: (session: TerminalSession, event: MouseEvent) => Promise<void> | void;
  };

  /** Stage element for appending pane DOM */
  stageEl: HTMLElement;

  /** Activity watcher interface */
  paneActivityWatcher: {
    noteResize: (paneId: string) => void;
    noteData: (paneId: string) => void;
    setFocus: (paneId: string | null) => void;
    setPaneEnabled: (paneId: string, enabled: boolean) => void;
    isAlerted: (paneId: string) => boolean;
    alertedPaneIds: () => string[];
  };

  /** Pane alert strategy */
  paneAlert: {
    attach: () => void;
  };

  /** Tab bar for refresh coordination */
  tabBar: {
    renderTabs: () => void;
  };

  /** Helper to check if entry needs tab refresh */
  entryNeedsTabRefresh: (paneId: string) => boolean;
}

/**
 * Workbench interface - coordinates Layout and TerminalSession collection.
 */
export interface Workbench {
  /**
   * Get the active Layout.
   */
  layout(): Layout;

  /**
   * Get a TerminalSession by pane ID.
   */
  session(paneId: string): TerminalSession | null;

  /**
   * Ensure sessions are synchronized with Layout's pane collection.
   * Creates sessions for new panes, closes sessions for removed panes.
   */
  ensureSessions(): void;

  /**
   * Close a session for a specific pane.
   */
  closeSession(paneId: string, options?: CloseSessionOptions): void;

  /**
   * Render all panes - coordinate DOM, focus state, and terminal fit.
   */
  render(options?: WorkbenchRenderOptions): void;

  /**
   * Query whether a pane is currently in the alerted state.
   */
  isAlerted(paneId: string): boolean;

  /**
   * Get all pane IDs that are currently in the alerted state.
   */
  alertedPaneIds(): string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if a pane session needs a tab bar refresh.
 */
function needsTabRefresh(pane: PaneEntity, entryNeedsTabRefresh: (paneId: string) => boolean): boolean {
  return entryNeedsTabRefresh(pane.id);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Workbench that coordinates Layout and TerminalSession lifecycle.
 *
 * @param deps - Workbench dependencies
 * @returns Workbench instance
 */
export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const { layout, terminalSessionDeps, stageEl, paneActivityWatcher, paneAlert, tabBar, entryNeedsTabRefresh } = deps;

  // Internal session map: paneId -> TerminalSession
  const sessionMap = new Map<string, TerminalSession>();

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  function createSessionForPane(pane: PaneEntity): TerminalSession {
    paneAlert.attach();

    const session = createTerminalSession({
      ...terminalSessionDeps,
      getPaneSnapshot: () => {
        // Get legacy Pane from deps and convert to domain Pane snapshot
        const legacyPane = terminalSessionDeps.getPaneSnapshot(pane.id);
        if (!legacyPane) return null;
        // For now, return the legacy Pane - terminal-session works with it
        return legacyPane;
      },
      onPaneClick: terminalSessionDeps.onPaneClick,
      onTitleChange: terminalSessionDeps.onTitleChange,
      onContextMenu: terminalSessionDeps.onContextMenu,
      onCwdChanged: terminalSessionDeps.onCwdChanged,
      onTabRefreshNeeded: (paneId: string) => {
        if (needsTabRefresh(pane, entryNeedsTabRefresh)) {
          tabBar.renderTabs();
        }
      },
    });

    return session;
  }

  function ensureSessions(): void {
    const currentPanes = layout.panes();
    const activeIds = new Set(currentPanes.map((pane) => pane.id));

    // Close sessions for panes that no longer exist in Layout
    for (const [paneId, session] of sessionMap.entries()) {
      if (!activeIds.has(paneId)) {
        session.close({ destroyPty: true });
        sessionMap.delete(paneId);
      }
    }

    // Create sessions for new panes
    for (const pane of currentPanes) {
      if (!sessionMap.has(pane.id)) {
        const session = createSessionForPane(pane);
        sessionMap.set(pane.id, session);
        stageEl.append(session.root);
        paneActivityWatcher.setPaneEnabled(pane.id, pane.breathingMonitorEnabled() !== false);
        requestAnimationFrame(() => {
          session.initializePty();
        });
      }
    }
  }

  function closeSession(paneId: string, options: CloseSessionOptions = {}): void {
    const session = sessionMap.get(paneId);
    if (!session) return;

    const { destroyPty = true } = options;
    session.close({ destroyPty });
    sessionMap.delete(paneId);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function render(options: WorkbenchRenderOptions = {}): void {
    const { refit = false } = options;

    ensureSessions();
    paneActivityWatcher.setFocus(layout.focusedPaneId());

    const currentPanes = layout.panes();
    const focusedPaneId = layout.focusedPaneId();
    const focusedIndex = currentPanes.findIndex((p) => p.id === focusedPaneId);

    // Update each session's visual state
    currentPanes.forEach((pane, index) => {
      const session = sessionMap.get(pane.id);
      if (!session) return;

      const isFocused = index === focusedIndex;
      const accentColor = pane.customColor() || pane.accent();

      session.root.classList.toggle('is-focused', isFocused);
      session.setAccent(accentColor);

      if (refit || session.needsFit()) {
        session.fit({ force: true });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    layout(): Layout {
      return layout;
    },

    session(paneId: string): TerminalSession | null {
      return sessionMap.get(paneId) ?? null;
    },

    ensureSessions,
    closeSession,
    render,

    isAlerted(paneId: string): boolean {
      return paneActivityWatcher.isAlerted(paneId);
    },

    alertedPaneIds(): string[] {
      return paneActivityWatcher.alertedPaneIds();
    },
  };
}
