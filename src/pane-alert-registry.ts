/**
 * Pane Alert Registry
 *
 * Manages multiple `PaneAlertStrategy` instances so that several alert
 * renderers can coexist. Each strategy is independently enable-able;
 * a failure in one strategy does not break the others.
 */

import type { PaneAlertStrategy } from './pane-alert-breathing-mask';

export interface PaneAlertRegistry {
  /** Register a strategy. Its `attach()` method is called immediately. */
  register(strategy: PaneAlertStrategy): void;
  /** Remove a strategy by id and call its `destroy()`. */
  unregister(id: string): void;
  /** Register a pane element so strategies can do per-pane setup if needed. */
  registerPane(paneId: string, paneEl: HTMLElement): void;
  /** Unregister a pane element so strategies can do per-pane teardown. */
  unregisterPane(paneId: string): void;
  /** Forward the alert state to every enabled strategy. */
  setAlerted(paneEl: HTMLElement, alerted: boolean): void;
  /** Enable or disable a strategy by id. */
  setEnabled(id: string, enabled: boolean): void;
  /** Tear down every strategy and clear all state. */
  destroy(): void;
}

export function createPaneAlertRegistry(): PaneAlertRegistry {
  const strategies = new Map<string, PaneAlertStrategy>();
  const paneElements = new Map<string, HTMLElement>();

  return {
    register(strategy: PaneAlertStrategy): void {
      if (strategies.has(strategy.id)) {
        console.warn(
          `PaneAlertStrategy with id "${strategy.id}" is already registered. Overwriting.`,
        );
      }
      strategies.set(strategy.id, strategy);
      try {
        strategy.attach();
      } catch (error) {
        console.error(`PaneAlertStrategy "${strategy.id}" failed in attach:`, error);
      }
    },

    unregister(id: string): void {
      const strategy = strategies.get(id);
      if (strategy) {
        try {
          strategy.destroy();
        } catch (error) {
          console.error(`PaneAlertStrategy "${id}" failed in destroy:`, error);
        }
        strategies.delete(id);
      }
    },

    registerPane(paneId: string, paneEl: HTMLElement): void {
      paneElements.set(paneId, paneEl);
    },

    unregisterPane(paneId: string): void {
      paneElements.delete(paneId);
    },

    setAlerted(paneEl: HTMLElement, alerted: boolean): void {
      for (const strategy of strategies.values()) {
        if (!strategy.enabled) continue;
        try {
          strategy.setAlerted(paneEl, alerted);
        } catch (error) {
          // One strategy failing must not break others.
          console.error(
            `PaneAlertStrategy "${strategy.id}" failed in setAlerted:`,
            error,
          );
        }
      }
    },

    setEnabled(id: string, enabled: boolean): void {
      const strategy = strategies.get(id);
      if (strategy) {
        strategy.enabled = enabled;
      }
    },

    destroy(): void {
      for (const strategy of strategies.values()) {
        try {
          strategy.destroy();
        } catch (error) {
          console.error(
            `PaneAlertStrategy "${strategy.id}" failed in destroy:`,
            error,
          );
        }
      }
      strategies.clear();
      paneElements.clear();
    },
  };
}
