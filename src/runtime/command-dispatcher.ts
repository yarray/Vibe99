/**
 * Command Dispatcher — translates AppCommand values into side effects.
 *
 * This is the single point where domain commands meet the runtime
 * infrastructure (PaneState, Layout, Workbench, Bridge, etc.).
 * UI modules dispatch commands; they never call PaneState or
 * PaneRenderer directly.
 *
 * @module runtime/command-dispatcher
 */

import type { AppCommand, CommandResult, WorkbenchMode } from '../domain/commands.js';
import type { PaneState, Pane } from '../pane-state.js';
import type { PaneRenderer } from '../pane-renderer.js';
import type { TabBar, TabBarLocalState } from '../tab-bar.js';
import type { Bridge } from '../bridge.js';
import type { TerminalSession } from './terminal-session.js';

export interface CommandDispatcherDeps {
  paneState: PaneState;
  paneRenderer: PaneRenderer | null;
  tabBar: TabBar;
  setMode: (mode: WorkbenchMode) => void;
  getCurrentMode: () => WorkbenchMode;
  scheduleSave: () => void;
  state: TabBarLocalState;
  bridge: Bridge;
  render: (refit?: boolean) => void;
  setPaneActivityAlertEnabled: (paneId: string, enabled: boolean) => void;
  /** Get a terminal session by pane ID */
  getSession: (paneId: string) => TerminalSession | null;
  /** Query whether a pane is currently in the alerted state */
  isAlerted: (paneId: string) => boolean;
}

function ok(value?: unknown): CommandResult {
  return { ok: true, value };
}

function fail(reason?: string): CommandResult {
  return { ok: false, reason };
}

export function createCommandDispatcher(deps: CommandDispatcherDeps): {
  dispatch: (command: AppCommand) => CommandResult;
} {
  const { paneState, paneRenderer, tabBar, setMode, getCurrentMode, scheduleSave, state, bridge, render, setPaneActivityAlertEnabled, getSession, isAlerted } = deps;

  function dispatch(command: AppCommand): CommandResult {
    switch (command.type) {
      // -- Pane commands --------------------------------------------------------

      case 'pane.create': {
        const newPaneId = paneState.addPane(command.shellProfileId ?? null);
        setMode('terminal');
        document.body.classList.remove('is-navigation-mode');
        render(true);
        return ok(newPaneId);
      }

      case 'pane.close': {
        const currentPanes = paneState.getPanes();
        if (currentPanes.length === 1) return fail('last-pane');
        const index = paneState.getPaneIndex(command.paneId);
        if (index === -1) return fail('not-found');

        const closingPane = currentPanes[index];
        if (closingPane.id === state.renamingPaneId) state.renamingPaneId = null;
        if (closingPane.id === state.dragState?.paneId) {
          state.dragState = null;
          document.body.classList.remove('is-dragging-tabs');
        }
        if (closingPane.id === state.pendingTabFocus?.paneId) {
          window.clearTimeout(state.pendingTabFocus.timerId);
          state.pendingTabFocus = null;
        }

        paneRenderer?.closeSession(command.paneId, { destroyPty: true });

        const wasFocused = closingPane.id === paneState.getFocusedPaneId();
        paneState.closePane(index);
        render(true);

        if (wasFocused) {
          const newFocusedPaneId = paneState.getFocusedPaneId();
          if (newFocusedPaneId) {
            requestAnimationFrame(() => {
              setMode('terminal');
              paneRenderer?.focusTerminal(newFocusedPaneId);
            });
          }
        }
        return ok();
      }

      case 'pane.focus': {
        const { focusTerminal = true } = command;
        paneState.focusPane(command.paneId);
        setMode('terminal');
        render();
        paneRenderer?.setAlerted(command.paneId, false);
        if (focusTerminal) {
          paneRenderer?.focusTerminal(command.paneId);
        }
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
        tabBar.commitRenamePane(command.paneId, command.title ?? '');
        return ok();
      }

      case 'pane.move': {
        paneState.reorderPane(command.paneId, command.index);
        render();
        return ok();
      }

      case 'pane.setColor': {
        paneState.setPaneColor(command.paneId, command.color);
        scheduleSave();
        render();
        return ok();
      }

      case 'pane.clearColor': {
        paneState.clearPaneColor(command.paneId);
        scheduleSave();
        render();
        return ok();
      }

      case 'pane.toggleActivityAlert': {
        const next = paneState.togglePaneBreathingMonitor(command.paneId);
        scheduleSave();
        setPaneActivityAlertEnabled(command.paneId, next);
        return ok(next);
      }

      case 'pane.requestClose': {
        if (state.pendingClosePaneId === command.paneId) {
          const index = paneState.getPaneIndex(command.paneId);
          if (index !== -1) {
            state.pendingClosePaneId = null;
            dispatch({ type: 'pane.close', paneId: command.paneId });
            const currentPanes = paneState.getPanes();
            if (getCurrentMode() === 'nav' && currentPanes.length > 0) {
              const focusedId = paneState.getFocusedPaneId();
              if (focusedId) dispatch({ type: 'pane.focus', paneId: focusedId, focusTerminal: true });
            }
          }
        } else {
          state.pendingClosePaneId = command.paneId;
          render();
        }
        return ok();
      }

      // -- Terminal commands ----------------------------------------------------

      case 'terminal.copy': {
        const session = getSession(command.paneId);
        if (!session) return fail('not-found');
        const success = session.copySelection();
        if (!success) return fail('no-selection');
        return ok();
      }

      case 'terminal.paste': {
        const session = getSession(command.paneId);
        if (!session) return fail('not-found');
        void session.paste();
        return ok();
      }

      case 'terminal.pasteImage': {
        const session = getSession(command.paneId);
        if (!session) return fail('not-found');
        void session.pasteImage();
        return ok();
      }

      case 'terminal.selectAll': {
        const session = getSession(command.paneId);
        if (!session) return fail('not-found');
        session.selectAll();
        return ok();
      }

      case 'terminal.restart': {
        paneRenderer?.restartPaneTerminal(command.paneId);
        return ok();
      }

      case 'terminal.changeShell': {
        paneRenderer?.changePaneShell(command.paneId, command.profileId);
        return ok();
      }

      // -- Query commands -------------------------------------------------------

      case 'query.terminal.hasSelection': {
        const session = getSession(command.paneId);
        const hasSelection = session?.hasSelection() ?? false;
        return ok(hasSelection);
      }

      case 'query.terminal.isReady': {
        const session = getSession(command.paneId);
        const isReady = session?.isReady() ?? false;
        return ok(isReady);
      }

      // -- Focus commands ------------------------------------------------------

      case 'focus.next': {
        paneState.moveFocus(1);
        render();
        return ok();
      }

      case 'focus.prev': {
        paneState.moveFocus(-1);
        render();
        return ok();
      }

      case 'focus.left': {
        const panes = paneState.getPanes();
        if (panes.length === 0) return fail('too-few');
        const nextIndex = paneState.getFocusedIndex() - 1;
        if (nextIndex < 0) return ok();
        paneState.focusPane(panes[nextIndex].id);
        render();
        return ok();
      }

      case 'focus.right': {
        const panes = paneState.getPanes();
        if (panes.length === 0) return fail('too-few');
        const nextIndex = paneState.getFocusedIndex() + 1;
        if (nextIndex >= panes.length) return ok();
        paneState.focusPane(panes[nextIndex].id);
        render();
        return ok();
      }

      case 'focus.recent': {
        const currentPanes = paneState.getPanes();
        if (currentPanes.length < 2) return fail('too-few');
        const targetId = paneState.cycleToRecentPane({ reverse: command.reverse });
        if (!targetId) return fail('no-target');
        setMode('terminal');
        render();
        paneRenderer?.focusTerminal(targetId);
        return ok(targetId);
      }

      case 'focus.nextLit': {
        const ALERTED_CLASS = 'has-pending-activity';
        const panes = paneState.getPanes();
        const litIds = panes
          .map((p: Pane) => p.id)
          .filter((id: string) => {
            // Primary: check activity watcher's internal state
            if (isAlerted(id)) return true;
            // Fallback: check DOM class for edge cases (e.g., E2E testing,
            // scenarios where DOM class is set directly but watcher state lags)
            const node = paneRenderer?.getNode(id);
            return node?.root.classList.contains(ALERTED_CLASS) ?? false;
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
        render();
        return ok();
      }

      case 'focus.blur': {
        const paneId = paneState.getFocusedPaneId();
        if (paneId) paneRenderer?.blurTerminal(paneId);
        return ok();
      }

      case 'focus.refocus': {
        const paneId = paneState.getFocusedPaneId();
        if (!paneId) return fail('no-focus');
        setMode('terminal');
        paneRenderer?.focusTerminal(paneId);
        return ok();
      }

      case 'focus.commit': {
        paneState.commitPaneCycle();
        return ok();
      }

      // -- Mode commands -------------------------------------------------------

      case 'mode.set': {
        setMode(command.mode);
        return ok();
      }

      // -- Layout commands -----------------------------------------------------

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

  return { dispatch };
}
