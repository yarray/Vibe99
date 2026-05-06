/**
 * Activity Capability — pane-activity-watcher integration with breathing mask.
 * Extracts watcher interactions from pane-renderer.ts.
 * @module pane/capabilities/activity-capability
 */

import type { PaneActivityWatcher } from '../../pane-activity-watcher';
import type { PaneAlertStrategy } from '../../pane-alert-breathing-mask';

export interface ActivityBehaviorContext {
  id: string;
  getState: <K extends string>(key: K) => unknown;
  emit: (event: string, payload?: unknown) => void;
  capability: <T>(name: string) => T | undefined;
}

export interface ActivityBehaviorDeps {
  watcher: PaneActivityWatcher;
  alert: PaneAlertStrategy;
}

export interface ActivityCapability {
  noteOutput(): void;
  setEnabled(enabled: boolean): void;
  setAlerted(root: HTMLElement, alerted: boolean): void;
}

export type ActivityBehavior = {
  name: 'activity';
  open(ctx: ActivityBehaviorContext): ActivityCapability;
  close(ctx: ActivityBehaviorContext): void;
};

export function createActivityBehavior(deps: ActivityBehaviorDeps): ActivityBehavior {
  const { watcher, alert } = deps;

  return {
    name: 'activity' as const,

    open(ctx: ActivityBehaviorContext): ActivityCapability {
      const breathingMonitor: boolean = (ctx.getState('breathingMonitor') as boolean | undefined) ?? false;
      watcher.setPaneEnabled(ctx.id, breathingMonitor);

      return {
        noteOutput(): void {
          watcher.noteData(ctx.id);
        },

        setEnabled(enabled: boolean): void {
          watcher.setPaneEnabled(ctx.id, enabled);
        },

        setAlerted(root: HTMLElement, alerted: boolean): void {
          alert.setAlerted(root, alerted);
        },
      };
    },

    close(ctx: ActivityBehaviorContext): void {
      watcher.forget(ctx.id);
    },
  };
}
