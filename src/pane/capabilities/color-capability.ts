/**
 * Color Capability — 颜色管理
 *
 * 负责管理 pane 的颜色状态，包括获取当前颜色、设置自定义颜色、清除自定义颜色。
 * 从 pane-renderer.ts 提取的颜色管理逻辑。
 *
 * @module pane/capabilities/color-capability
 */

import type { PaneCapability, PaneContext } from '../types';
import type { TerminalCapabilityApi } from './terminal-capability';
import type { DomCapabilityApi } from './dom-capability';

/** Color capability 的依赖注入 */
export interface ColorBehaviorDeps {
  getTerminal: () => TerminalCapabilityApi | undefined;
  getDom: () => DomCapabilityApi | undefined;
}

/** Color capability 的公共 API */
export interface ColorCapabilityApi {
  getAccent(): string;
  setCustomColor(color: string): void;
  clearCustomColor(): void;
}

/** 创建 Color capability */
export function createColorBehavior(deps: ColorBehaviorDeps): PaneCapability<ColorCapabilityApi> {
  return {
    name: 'color',
    open(ctx: PaneContext): ColorCapabilityApi {
      return {
        getAccent(): string {
          return ctx.getState('customColor') || ctx.getState('accent') || '';
        },

        setCustomColor(color: string): void {
          ctx.setState({ customColor: color });
          const term = deps.getTerminal();
          const dom = deps.getDom();
          if (term) { term.setTheme(color); }
          if (dom) { dom.setAccent(color); }
          ctx.emit('colorChanged', color);
        },

        clearCustomColor(): void {
          ctx.setState({ customColor: undefined });
          const term = deps.getTerminal();
          const dom = deps.getDom();
          const fallback = ctx.getState('accent') || '';
          if (term) { term.setTheme(fallback); }
          if (dom) { dom.setAccent(fallback); }
          ctx.emit('colorCleared');
        },
      };
    },
    close(_ctx: PaneContext, _api: ColorCapabilityApi): void {
      // No cleanup needed
    },
  };
}
