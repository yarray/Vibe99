/**
 * Script-hook alert strategy: executes a user-configured script when a pane
 * is alerted. The script receives the pane id and title as context.
 *
 * - Scripts run non-blocking (fire-and-forget).
 * - Errors are caught locally so they never break other strategies.
 * - A pane that is already alerted will not re-trigger the script (debounce).
 */

import type { PaneAlertStrategy } from './pane-alert-breathing-mask';

export interface ScriptHookAlertDeps {
  bridge: {
    executeAlertScript: (script: string, paneId: string, paneTitle: string) => Promise<void>;
  };
  /** Resolve the display title for a given pane id. */
  getPaneTitle: (paneId: string) => string;
  /** Return the current script payload from settings. */
  getScript: () => string;
}

export function createScriptHookAlert(deps: ScriptHookAlertDeps): PaneAlertStrategy {
  const { bridge, getPaneTitle, getScript } = deps;
  const alertedPanes = new Set<string>();

  return {
    id: 'script-hook',
    enabled: false, // disabled by default until user configures it
    attach() {},

    setAlerted(paneEl: HTMLElement, alerted: boolean): void {
      const paneId = paneEl.dataset.paneId;
      if (!paneId) return;

      if (alerted) {
        // Debounce: don't re-execute while this pane is already alerted.
        if (alertedPanes.has(paneId)) return;
        alertedPanes.add(paneId);

        const script = getScript().trim();
        if (!script) return;

        const title = getPaneTitle(paneId);

        // Non-blocking execution; errors are isolated.
        bridge.executeAlertScript(script, paneId, title).catch((error: unknown) => {
          console.error(`Script hook alert failed for pane ${paneId}:`, error);
        });
      } else {
        alertedPanes.delete(paneId);
      }
    },

    destroy(): void {
      alertedPanes.clear();
    },
  };
}
