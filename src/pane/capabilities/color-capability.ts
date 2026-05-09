/**
 * Color Capability — pane accent color management
 *
 * Syncs accent color state changes to the DOM and terminal theme.
 *
 * @module pane/capabilities/color-capability
 */

import type { PaneCapability, PaneContext } from '../types';
import type { DomCapabilityApi } from './dom-capability';
import type { TerminalCapabilityApi } from './terminal-capability';

export interface ColorBehaviorDeps {
  getDom: () => DomCapabilityApi | undefined;
  getTerminal: () => TerminalCapabilityApi | undefined;
}

export interface ColorCapabilityApi {
  setAccent(color: string): void;
  clearCustomColor(): void;
  applyCurrent(): void;
}

export function createColorBehavior(deps: ColorBehaviorDeps): PaneCapability<ColorCapabilityApi> {
  return {
    name: 'color',
    open(ctx: PaneContext): ColorCapabilityApi {
      const applyColor = (): void => {
        const accent = ctx.getState('customColor') || ctx.getState('accent') || '';
        const dom = deps.getDom();
        if (dom) dom.setAccent(accent);
        const term = deps.getTerminal();
        if (term) term.setTheme(accent);
      };

      return {
        setAccent(color: string): void {
          ctx.setState({ customColor: color });
          applyColor();
        },
        clearCustomColor(): void {
          ctx.setState({ customColor: undefined });
          applyColor();
        },
        applyCurrent(): void {
          applyColor();
        },
      };
    },
  };
}
