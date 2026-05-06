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
  open(ctx: ActivityBehaviorContext): void;
  close(ctx: ActivityBehaviorContext): void;
} & ActivityCapability;

export function createActivityBehavior(deps: ActivityBehaviorDeps): ActivityBehavior {
  const { watcher, alert } = deps;

  return {
    name: 'activity' as const,

    open(ctx: ActivityBehaviorContext): void {
      const breathingMonitor: boolean = ctx.getState<boolean>('breathingMonitor') ?? false;
      watcher.setPaneEnabled(ctx.id, breathingMonitor);

      watcher.onAlert?.(ctx.id, () => {
        const dom = ctx.capability<{ root: HTMLElement }>('dom');
        if (breathingMonitor) alert.setAlerted(dom?.root as HTMLElement, true);
        ctx.emit('activity-alert', { paneId: ctx.id });
      });

      watcher.onClear?.(ctx.id, () => {
        const dom = ctx.capability<{ root: HTMLElement }>('dom');
        alert.setAlerted(dom?.root as HTMLElement, false);
        ctx.emit('activity-clear', { paneId: ctx.id });
      });
    },

    close(ctx: ActivityBehaviorContext): void {
      watcher.forget(ctx.id);
    },

    noteOutput(): void { /* caller uses watcher.noteData directly */ },

    setEnabled(enabled: boolean): void {
      watcher.setPaneEnabled(ctx.id, enabled);
    },

    setAlerted(root: HTMLElement, alerted: boolean): void {
      alert.setAlerted(root, alerted);
    },
  };
}
