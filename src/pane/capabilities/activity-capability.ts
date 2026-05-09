import type { PaneCapability, PaneContext } from '../types';
import type { PaneAlertStrategy } from '../../pane-alert-breathing-mask';
import { createPaneActivityWatcher, type PaneActivityWatcher } from '../../pane-activity-watcher';
import type { DomCapabilityApi } from './dom-capability';

export interface ActivityBehaviorDeps {
  paneAlert: PaneAlertStrategy;
}

export interface ActivityCapabilityApi {
  noteOutput(): void;
  setEnabled(enabled: boolean): void;
  setAlerted(root: HTMLElement, isAlerted: boolean): void;
}

const watcherMap = new WeakMap<ActivityCapabilityApi, PaneActivityWatcher>();

export function createActivityBehavior(deps: ActivityBehaviorDeps): PaneCapability<ActivityCapabilityApi> {
  return {
    name: 'activity',
    open(ctx: PaneContext): ActivityCapabilityApi {
      const watcher = createPaneActivityWatcher({
        onAlert: () => {
          const dom = ctx.capability<DomCapabilityApi>('dom');
          if (dom) deps.paneAlert.setAlerted(dom.root, true);
        },
        onClear: () => {
          const dom = ctx.capability<DomCapabilityApi>('dom');
          if (dom) deps.paneAlert.setAlerted(dom.root, false);
        },
      });
      const api: ActivityCapabilityApi = {
        noteOutput: () => watcher.noteData(ctx.id),
        setEnabled: (enabled) => watcher.setPaneEnabled(ctx.id, enabled),
        setAlerted: (root, isAlerted) => deps.paneAlert.setAlerted(root, isAlerted),
      };
      watcherMap.set(api, watcher);
      return api;
    },
    close(ctx: PaneContext, api: ActivityCapabilityApi): void {
      const watcher = watcherMap.get(api);
      if (watcher) {
        watcher.forget(ctx.id);
        watcherMap.delete(api);
      }
    },
  };
}
