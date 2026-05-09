// Hook-script alert strategy: fires shell commands when alerts start and stop.
//
// Delegates script execution to the Tauri backend via `alert_hook_run`, which
// spawns the command in a detached process. Errors are logged but never
// propagated — a broken hook must not break the alert system.

import type { HookScriptAlertConfig } from './pane-alert-modes';
import type { PaneAlertStrategy } from './pane-alert-breathing-mask';

export interface HookAlertDeps {
  runHook: (payload: { command: string; shellProfileId: string | null }) => Promise<void>;
}

export function createHookScriptAlert(
  config: HookScriptAlertConfig,
  deps: HookAlertDeps,
): PaneAlertStrategy {
  return {
    attach() {},

    setAlerted(_paneEl: HTMLElement, alerted: boolean): void {
      const command = alerted ? config.onStartCommand : config.onStopCommand;
      if (!command) return;
      deps.runHook({ command, shellProfileId: config.shellProfileId }).catch((err) => {
        console.error('[alert-hook] execution failed:', err);
      });
    },
  };
}
