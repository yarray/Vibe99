/**
 * Command Dispatcher — translates AppCommand values into side effects.
 *
 * This is the single point where domain commands meet the runtime
 * infrastructure (PaneState, PaneRenderer, Bridge, etc.).
 * UI modules dispatch commands; they never call PaneState or
 * PaneRenderer directly.
 *
 * @module runtime/command-dispatcher
 */

import type { AppCommand, CommandResult } from '../domain/commands.js';
import type { PaneState, Pane } from '../pane-state.js';
import type { PaneRenderer } from '../pane-renderer.js';
import type { TabBar, TabBarLocalState } from '../tab-bar.js';
import type { Bridge } from '../bridge.js';

export interface CommandDispatcherDeps {
  paneState: PaneState;
  paneRenderer: PaneRenderer | null;
  tabBar: TabBar;
  setMode: (mode: string) => void;
  getCurrentMode: () => string;
  scheduleSave: () => void;
  state: TabBarLocalState;
  bridge: Bridge;
  render: (refit?: boolean) => void;
  setPaneActivityAlertEnabled: (paneId: string, enabled: boolean) => void;
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
  const { paneState, paneRenderer, tabBar, setMode, getCurrentMode, scheduleSave, state, bridge, render, setPaneActivityAlertEnabled } = deps;

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

      case 'pane.rename': {
        const idx = paneState.getPaneIndex(command.paneId);
        if (idx !== -1) {
          if (getCurrentMode() === 'nav') setMode('terminal');
          tabBar.beginRenamePane(idx);
        }
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
        setPaneActivityAlertEnabled(command.paneId, next);
        scheduleSave();
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
        const node = paneRenderer?.getNode(command.paneId);
        if (!node) return fail('not-found');
        const selection = node.terminal.getSelection();
        if (!selection) return fail('no-selection');
        bridge.writeClipboardText(selection);
        return ok();
      }

      case 'terminal.paste': {
        const session = paneRenderer?.getNode(command.paneId);
        if (!session?.sessionReady) return fail('not-ready');
        void (async () => {
          const text = await bridge.readClipboardText();
          if (!text) return;
          if (bridge.platform === 'win32') {
            session.terminal.paste(text);
          } else {
            bridge.writeTerminal({ paneId: command.paneId, data: text });
          }
        })();
        return ok();
      }

      case 'terminal.pasteImage': {
        const imgSession = paneRenderer?.getNode(command.paneId);
        if (!imgSession?.sessionReady) return fail('not-ready');
        void (async () => {
          const snapshot = await bridge.getClipboardSnapshot();
          if (!snapshot.hasImage) return;
          bridge.writeTerminal({ paneId: command.paneId, data: '\x16' });
        })();
        return ok();
      }

      case 'terminal.selectAll': {
        const selNode = paneRenderer?.getNode(command.paneId);
        if (!selNode) return fail('not-found');
        selNode.terminal.selectAll();
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
        const hasSelection = paneRenderer?.hasSelection(command.paneId) ?? false;
        return ok(hasSelection);
      }

      case 'query.terminal.isReady': {
        const isReady = paneRenderer?.isSessionReady(command.paneId) ?? false;
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
        const panes = paneState.getPanes();
        const litIds = panes
          .map((p: Pane) => p.id)
          .filter((id: string) => paneRenderer?.getNode(id)?.root.classList.contains('has-pending-activity'));
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
