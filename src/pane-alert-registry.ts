import type { PaneAlertStrategy } from './pane-alert-breathing-mask';

export interface PaneAlertRegistry {
  /** Register a strategy. Its `attach()` is called immediately. */
  register(strategy: PaneAlertStrategy): void;
  /** Unregister a strategy by id. Its `destroy()` is called. */
  unregister(id: string): void;
  /** Forward the alert state to all enabled strategies. */
  setAlerted(paneEl: HTMLElement, alerted: boolean): void;
  /** Dynamically enable or disable a strategy by id. */
  setEnabled(id: string, enabled: boolean): void;
  /** Clean up all registered strategies. */
  destroy(): void;
}

export function createPaneAlertRegistry(): PaneAlertRegistry {
  const strategies = new Map<string, PaneAlertStrategy>();

  function register(strategy: PaneAlertStrategy): void {
    if (strategies.has(strategy.id)) {
      // eslint-disable-next-line no-console
      console.warn(`PaneAlertStrategy with id "${strategy.id}" is already registered. Overwriting.`);
    }
    strategies.set(strategy.id, strategy);
    strategy.attach();
  }

  function unregister(id: string): void {
    const strategy = strategies.get(id);
    if (strategy) {
      try {
        strategy.destroy();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`PaneAlertStrategy "${id}" failed in destroy:`, error);
      }
      strategies.delete(id);
    }
  }

  function setAlerted(paneEl: HTMLElement, alerted: boolean): void {
    for (const strategy of strategies.values()) {
      if (!strategy.enabled) {
        continue;
      }
      try {
        strategy.setAlerted(paneEl, alerted);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`PaneAlertStrategy "${strategy.id}" failed in setAlerted:`, error);
      }
    }
  }

  function setEnabled(id: string, enabled: boolean): void {
    const strategy = strategies.get(id);
    if (strategy) {
      strategy.enabled = enabled;
    }
  }

  function destroy(): void {
    for (const strategy of strategies.values()) {
      try {
        strategy.destroy();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`PaneAlertStrategy "${strategy.id}" failed in destroy:`, error);
      }
    }
    strategies.clear();
  }

  return {
    register,
    unregister,
    setAlerted,
    setEnabled,
    destroy,
  };
}
