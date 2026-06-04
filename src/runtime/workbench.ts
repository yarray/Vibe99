/**
 * Workbench Session Coordination + Command Dispatch
 *
 * Workbench owns the active Layout and the TerminalSession collection for a
 * single window. It coordinates session lifecycle with Layout state and
 * orchestrates rendering. It also serves as the single entry point for all
 * user-intent commands via `dispatch()`.
 *
 * Workbench is a window-level entity, not a global application state.
 *
 * @module runtime/workbench
 */

import type { AppCommand, CommandResult, WorkbenchMode } from '../domain/commands.js';
import type { Layout } from '../domain/layout.js';
import type { Pane as PaneEntity } from '../domain/pane.js';
import type { PaneState, Pane } from '../pane-state';
import type { TabBar, TabBarLocalState } from '../tab-bar.js';
import type { Bridge } from '../bridge.js';
import type { TerminalSession } from './terminal-session.js';
import { createTerminalSession, type TerminalSessionDeps } from './terminal-session.js';
import { createDefaultTerminalTheme } from '../domain/theme.js';

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

export interface WorkbenchDeps {
  layout: Layout | (() => Layout);

  terminalSessionDeps: Omit<
    TerminalSessionDeps,
    'getPaneSnapshot' | 'onPaneClick' | 'onTitleChange' | 'onContextMenu' | 'onCwdChanged' | 'onTabRefreshNeeded' | 'getLayoutThemeId'
  > & {
    getPaneSnapshot: (paneId: string) => Pane | null;
    onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
    onTitleChange: (paneId: string, title: string) => void;
    onCwdChanged: (paneId: string, cwd: string) => void;
    onTabRefreshNeeded: (paneId: string) => void;
    onContextMenu: (session: TerminalSession, event: MouseEvent) => Promise<void> | void;
  };

  stageEl: HTMLElement;

  paneActivityWatcher: {
    noteResize: (paneId: string) => void;
    noteData: (paneId: string, byteSize?: number) => void;
    setFocus: (paneId: string | null) => void;
    setPaneEnabled: (paneId: string, enabled: boolean) => void;
    isAlerted: (paneId: string) => boolean;
    alertedPaneIds: () => string[];
  };

  paneAlert: {
    attach: () => void;
    setAlerted: (root: HTMLElement, alerted: boolean) => void;
  };

  tabBar: TabBar;
  tabBarState: TabBarLocalState;
  entryNeedsTabRefresh: (paneId: string) => boolean;

  paneState: PaneState;
  setMode: (mode: WorkbenchMode) => void;
  getCurrentMode: () => WorkbenchMode;
  scheduleSave: () => void;
  bridge: Bridge;
  render: (refit?: boolean) => void;
  setPaneActivityAlertEnabled: (paneId: string, enabled: boolean) => void;
  getShellProfiles: () => { id: string; themeId?: string }[];
}

export interface Workbench {
  layout(): Layout;

  session(paneId: string): TerminalSession | null;

  ensureSessions(): void;

  closeSession(paneId: string, options?: CloseSessionOptions): void;

  render(options?: WorkbenchRenderOptions): void;

  isAlerted(paneId: string): boolean;

  alertedPaneIds(): string[];

  dispatch(command: AppCommand): CommandResult;
}

// ---------------------------------------------------------------------------
// Command result helpers
// ---------------------------------------------------------------------------

function ok(value?: unknown): CommandResult {
  return { ok: true, value };
}

function fail(reason?: string): CommandResult {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function needsTabRefresh(pane: PaneEntity, entryNeedsTabRefresh: (paneId: string) => boolean): boolean {
  return entryNeedsTabRefresh(pane.id);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const {
    layout: layoutInput, terminalSessionDeps, stageEl, paneActivityWatcher,
    paneAlert, tabBar, tabBarState, entryNeedsTabRefresh,
    paneState, setMode, getCurrentMode, scheduleSave, bridge, render: externalRender, setPaneActivityAlertEnabled,
    getShellProfiles,
  } = deps;

  const resolveLayout = typeof layoutInput === 'function'
    ? (layoutInput as () => Layout)
    : () => layoutInput;

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
      terminalTheme: createDefaultTerminalTheme,
      getLayoutThemeId: () => resolveLayout().snapshot().themeId,
    });

    return session;
  }

  function ensureSessions(): void {
    const layout = resolveLayout();
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
    const layout = resolveLayout();

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
      session.setTheme(pane.themeId());
      session.setCursorBlink(isFocused && document.visibilityState === 'visible');

      if (refit || session.needsFit()) {
        session.fit({ force: true });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Command dispatch
  // ---------------------------------------------------------------------------

  function changePaneShell(paneId: string, profileId: string): void {
    const session = sessionMap.get(paneId);
    if (!session) return;
    const prevProfileId = paneState.getPaneById(paneId)?.shellProfileId ?? null;
    session.changeShell(profileId, prevProfileId);
    const checkResult = (): void => {
      requestAnimationFrame(() => {
        if (!session.isShellChanging()) {
          if (session.isReady()) {
            paneState.setPaneShellProfile(paneId, profileId);
            scheduleSave();
          }
        } else {
          checkResult();
        }
      });
    };
    checkResult();
  }

  function focusSession(paneId: string): void {
    const session = sessionMap.get(paneId);
    if (session) session.focus();
  }

  function blurSession(paneId: string): void {
    const session = sessionMap.get(paneId);
    if (session) session.blur();
  }

  function setSessionAlerted(paneId: string, alerted: boolean): void {
    const session = sessionMap.get(paneId);
    if (session) paneAlert.setAlerted(session.root, alerted);
  }

  function hasSessionAlertClass(paneId: string): boolean {
    const session = sessionMap.get(paneId);
    return session?.root.classList.contains('has-pending-activity') ?? false;
  }

  function dispatch(command: AppCommand): CommandResult {
    switch (command.type) {
      case 'pane.create': {
        const newPaneId = paneState.addPane(command.shellProfileId ?? null);

        // Set themeId from profile if specified
        if (command.shellProfileId) {
          const profiles = getShellProfiles();
          const profile = profiles.find((p) => p.id === command.shellProfileId);
          if (profile?.themeId) {
            paneState.setPaneTheme(newPaneId, profile.themeId);
          }
        }

        setMode('terminal');
        document.body.classList.remove('is-navigation-mode');
        externalRender(true);
        return ok(newPaneId);
      }

      case 'pane.close': {
        const currentPanes = paneState.getPanes();
        if (currentPanes.length === 1) return fail('last-pane');
        const index = paneState.getPaneIndex(command.paneId);
        if (index === -1) return fail('not-found');

        const closingPane = currentPanes[index];
        if (closingPane.id === tabBarState.renamingPaneId) tabBarState.renamingPaneId = null;
        if (closingPane.id === tabBarState.dragState?.paneId) {
          tabBarState.dragState = null;
          document.body.classList.remove('is-dragging-tabs');
        }
        if (closingPane.id === tabBarState.pendingTabFocus?.paneId) {
          window.clearTimeout(tabBarState.pendingTabFocus.timerId);
          tabBarState.pendingTabFocus = null;
        }

        closeSession(command.paneId, { destroyPty: true });

        const wasFocused = closingPane.id === paneState.getFocusedPaneId();
        paneState.closePane(index);
        externalRender(true);

        if (wasFocused) {
          const newFocusedPaneId = paneState.getFocusedPaneId();
          if (newFocusedPaneId) {
            requestAnimationFrame(() => {
              setMode('terminal');
              focusSession(newFocusedPaneId);
            });
          }
        }
        return ok();
      }

      case 'pane.focus': {
        const { focusTerminal = true } = command;
        paneState.focusPane(command.paneId);
        setMode('terminal');
        externalRender();
        setSessionAlerted(command.paneId, false);
        if (focusTerminal) focusSession(command.paneId);
        return ok();
      }

      case 'pane.rename.start': {
        const idx = paneState.getPaneIndex(command.paneId);
        if (idx !== -1) {
          if (getCurrentMode() === 'nav') setMode('terminal');
          tabBar.beginRenamePane(idx);
        }
        return ok();
      }

      case 'pane.rename.commit': {
        const idx = paneState.getPaneIndex(command.paneId);
        if (idx === -1) return fail('not-found');
        paneState.setPaneTitle(command.paneId, command.title ?? null);
        tabBarState.renamingPaneId = null;
        tabBar.renderTabs();
        dispatch({ type: 'pane.focus', paneId: command.paneId, focusTerminal: true });
        return ok();
      }

      case 'pane.move': {
        paneState.reorderPane(command.paneId, command.index);
        externalRender();
        return ok();
      }

      case 'pane.setColor': {
        paneState.setPaneColor(command.paneId, command.color);
        scheduleSave();
        externalRender();
        return ok();
      }

      case 'pane.clearColor': {
        paneState.clearPaneColor(command.paneId);
        scheduleSave();
        externalRender();
        return ok();
      }

      case 'pane.toggleActivityAlert': {
        const next = paneState.togglePaneBreathingMonitor(command.paneId);
        scheduleSave();
        setPaneActivityAlertEnabled(command.paneId, next);
        return ok(next);
      }

      case 'pane.setTheme': {
        paneState.setPaneTheme(command.paneId, command.themeId);
        scheduleSave();
        externalRender();
        return ok();
      }

      case 'pane.requestClose': {
        if (tabBarState.pendingClosePaneId === command.paneId) {
          const index = paneState.getPaneIndex(command.paneId);
          if (index !== -1) {
            tabBarState.pendingClosePaneId = null;
            dispatch({ type: 'pane.close', paneId: command.paneId });
            const currentPanes = paneState.getPanes();
            if (getCurrentMode() === 'nav' && currentPanes.length > 0) {
              const focusedId = paneState.getFocusedPaneId();
              if (focusedId) dispatch({ type: 'pane.focus', paneId: focusedId, focusTerminal: true });
            }
          }
        } else {
          tabBarState.pendingClosePaneId = command.paneId;
          externalRender();
        }
        return ok();
      }

      case 'terminal.copy': {
        const session = sessionMap.get(command.paneId);
        if (!session) return fail('not-found');
        const success = session.copySelection();
        if (!success) return fail('no-selection');
        return ok();
      }

      case 'terminal.paste': {
        const session = sessionMap.get(command.paneId);
        if (!session) return fail('not-found');
        void session.paste();
        return ok();
      }

      case 'terminal.pasteImage': {
        const session = sessionMap.get(command.paneId);
        if (!session) return fail('not-found');
        void session.pasteImage();
        return ok();
      }

      case 'terminal.selectAll': {
        const session = sessionMap.get(command.paneId);
        if (!session) return fail('not-found');
        session.selectAll();
        return ok();
      }

      case 'terminal.restart': {
        const session = sessionMap.get(command.paneId);
        if (session) session.restart();
        return ok();
      }

      case 'terminal.changeShell': {
        changePaneShell(command.paneId, command.profileId);
        return ok();
      }

      case 'query.terminal.hasSelection': {
        const session = sessionMap.get(command.paneId);
        const hasSelection = session?.hasSelection() ?? false;
        return ok(hasSelection);
      }

      case 'query.terminal.isReady': {
        const session = sessionMap.get(command.paneId);
        const isReady = session?.isReady() ?? false;
        return ok(isReady);
      }

      case 'focus.next': {
        const moved = paneState.moveFocus(1);
        if (moved && getCurrentMode() !== 'nav') {
          const id = paneState.getFocusedPaneId();
          if (id) { setMode('terminal'); focusSession(id); }
        }
        externalRender();
        return ok();
      }

      case 'focus.prev': {
        const moved = paneState.moveFocus(-1);
        if (moved && getCurrentMode() !== 'nav') {
          const id = paneState.getFocusedPaneId();
          if (id) { setMode('terminal'); focusSession(id); }
        }
        externalRender();
        return ok();
      }

      case 'focus.left': {
        const panes = paneState.getPanes();
        if (panes.length === 0) return fail('too-few');
        const nextIndex = paneState.getFocusedIndex() - 1;
        if (nextIndex < 0) return ok();
        paneState.focusPane(panes[nextIndex].id);
        setMode('terminal');
        focusSession(panes[nextIndex].id);
        externalRender();
        return ok();
      }

      case 'focus.right': {
        const panes = paneState.getPanes();
        if (panes.length === 0) return fail('too-few');
        const nextIndex = paneState.getFocusedIndex() + 1;
        if (nextIndex >= panes.length) return ok();
        paneState.focusPane(panes[nextIndex].id);
        setMode('terminal');
        focusSession(panes[nextIndex].id);
        externalRender();
        return ok();
      }

      case 'focus.recent': {
        const currentPanes = paneState.getPanes();
        if (currentPanes.length < 2) return fail('too-few');
        const targetId = paneState.cycleToRecentPane({ reverse: command.reverse });
        if (!targetId) return fail('no-target');
        setMode('terminal');
        externalRender();
        focusSession(targetId);
        return ok(targetId);
      }

      case 'focus.nextLit': {
        const panes = paneState.getPanes();
        const litIds = panes
          .map((p: Pane) => p.id)
          .filter((id: string) => {
            if (paneActivityWatcher.isAlerted(id)) return true;
            return hasSessionAlertClass(id);
          });
        if (litIds.length === 0) return fail('no-lit');
        const focusedId = paneState.getFocusedPaneId();
        const focusedIndex = focusedId !== null ? litIds.indexOf(focusedId) : -1;
        const nextIndex = focusedIndex >= 0 ? (focusedIndex + 1) % litIds.length : 0;
        return dispatch({ type: 'pane.focus', paneId: litIds[nextIndex] });
      }

      case 'focus.at': {
        const panes = paneState.getPanes();
        if (panes.length === 0 || command.index < 0 || command.index >= panes.length) return fail('out-of-range');
        paneState.focusPane(panes[command.index].id);
        if (getCurrentMode() !== 'nav') {
          setMode('terminal');
          focusSession(panes[command.index].id);
        }
        externalRender();
        return ok();
      }

      case 'focus.blur': {
        const paneId = paneState.getFocusedPaneId();
        if (paneId) blurSession(paneId);
        return ok();
      }

      case 'focus.refocus': {
        const paneId = paneState.getFocusedPaneId();
        if (!paneId) return fail('no-focus');
        setMode('terminal');
        focusSession(paneId);
        return ok();
      }

      case 'focus.commit': {
        paneState.commitPaneCycle();
        return ok();
      }

      case 'mode.set': {
        setMode(command.mode);
        return ok();
      }

      case 'layout.save': {
        scheduleSave();
        return ok();
      }

      case 'layout.activate': {
        void bridge.openLayoutWindow(command.layoutId).catch(() => {});
        return ok();
      }

      default: {
        const _exhaustive: never = command;
        return fail(`unknown-command: ${(_exhaustive as AppCommand).type}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    layout(): Layout {
      return resolveLayout();
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

    dispatch,
  };
}
