// Alert strategy factory: creates the right PaneAlertStrategy from an
// AlertModeConfig. The factory is the single point where mode selection
// maps to a concrete strategy implementation.

import type { PaneAlertStrategy } from './pane-alert-breathing-mask';
import { createBreathingMaskAlert } from './pane-alert-breathing-mask';
import type { AlertModeConfig } from './pane-alert-modes';
import { createHookScriptAlert } from './pane-alert-hook';
import type { HookAlertDeps } from './pane-alert-hook';

export interface AlertFactoryDeps extends HookAlertDeps {}

// No-op strategy used when alerts are globally disabled.
const NO_OP_STRATEGY: PaneAlertStrategy = {
  attach() {},
  setAlerted() {},
};

export function createNoOpAlert(): PaneAlertStrategy {
  return NO_OP_STRATEGY;
}

export function createAlertFromConfig(
  config: AlertModeConfig,
  deps: AlertFactoryDeps,
): PaneAlertStrategy {
  switch (config.mode) {
    case 'css-animation':
      return createBreathingMaskAlert();
    case 'hook-script':
      return createHookScriptAlert(config, deps);
  }
}
