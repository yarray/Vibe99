import type { Bridge } from './bridge';
import type { PaneAlertStrategy } from './pane-alert-breathing-mask';

export interface ScriptHookAlertDeps {
  bridge: Bridge;
  /** Resolve the display title for a given pane id. */
  getPaneTitle: (paneId: string) => string;
}

/**
 * Script-hook alert strategy: executes a user-configured script via the
 * bridge whenever a pane transitions to the alerted state. Re-alerting the
 * same pane while it is already alerted is suppressed (debounce).
 */
export function createScriptHookAlert(deps: ScriptHookAlertDeps): PaneAlertStrategy {
  const { bridge, getPaneTitle } = deps;
  const alertedPaneIds = new Set<string>();

  return {
    id: 'script-hook',
    enabled: true,

    attach() {
      // No-op: nothing to attach to the DOM.
    },

    setAlerted(paneEl: HTMLElement, alerted: boolean): void {
      const paneId = paneEl.dataset.paneId;
      if (!paneId) {
        return;
      }

      if (!alerted) {
        alertedPaneIds.delete(paneId);
        return;
      }

      // Debounce: don't re-execute for a pane that is already alerted.
      if (alertedPaneIds.has(paneId)) {
        return;
      }
      alertedPaneIds.add(paneId);

      const paneTitle = getPaneTitle(paneId);
      try {
        bridge.executeAlertScript?.({ paneId, paneTitle }).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('Script hook alert failed:', error);
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Script hook alert failed:', error);
      }
    },

    destroy() {
      alertedPaneIds.clear();
    },
  };
}
