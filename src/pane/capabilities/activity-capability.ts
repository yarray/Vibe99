/**
 * Activity Capability — pane-level activity tracking
 *
 * Bridges a pane to the PaneActivityWatcher, providing resize/data
 * forwarding and per-pane enable/disable control.
 *
 * @module pane/capabilities/activity-capability
 */

import type { PaneCapability, PaneContext } from '../types';

export interface ActivityBehaviorDeps {
  watcher: {
    noteResize: (paneId: string) => void;
    noteData: (paneId: string) => void;
    setFocus: (paneId: string | null) => void;
    forget: (paneId: string) => void;
    setPaneEnabled: (paneId: string, enabled: boolean) => void;
  };
}

export interface ActivityCapabilityApi {
  noteResize(): void;
  noteData(): void;
  setEnabled(enabled: boolean): void;
}

export function createActivityBehavior(deps: ActivityBehaviorDeps): PaneCapability<ActivityCapabilityApi> {
  return {
    name: 'activity',
    open(ctx: PaneContext): ActivityCapabilityApi {
      deps.watcher.setPaneEnabled(ctx.id, true);

      return {
        noteResize(): void {
          deps.watcher.noteResize(ctx.id);
        },
        noteData(): void {
          deps.watcher.noteData(ctx.id);
        },
        setEnabled(next: boolean): void {
          deps.watcher.setPaneEnabled(ctx.id, next);
        },
      };
    },
    close(ctx: PaneContext): void {
      deps.watcher.forget(ctx.id);
    },
  };
}
