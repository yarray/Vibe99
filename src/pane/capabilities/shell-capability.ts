/**
 * Shell Capability — Shell 切换管理
 *
 * 负责切换 pane 的 shell profile，协调 PTY 会话的销毁和重建。
 * 从 pane-renderer.ts 提取的 shell 切换逻辑。
 *
 * @module pane/capabilities/shell-capability
 */

import type { PaneCapability, PaneContext } from '../types';
import type { PtyCapabilityApi } from './pty-capability';
import type { TerminalCapabilityApi } from './terminal-capability';

/** Shell capability 的依赖注入 */
export interface ShellBehaviorDeps {
  getPty: () => PtyCapabilityApi | undefined;
  getTerminal: () => TerminalCapabilityApi | undefined;
  scheduleWindowLayoutSave: () => void;
}

/** Shell capability 的公共 API */
export interface ShellCapabilityApi {
  changeProfile(profileId: string): Promise<void>;
}

/** 创建 Shell capability */
export function createShellBehavior(deps: ShellBehaviorDeps): PaneCapability<ShellCapabilityApi> {
  return {
    name: 'shell',
    open(ctx: PaneContext): ShellCapabilityApi {
      return {
        async changeProfile(profileId: string): Promise<void> {
          const pty = deps.getPty();
          const term = deps.getTerminal();
          if (!pty || !term) { return; }

          const prevProfileId = ctx.getState('shellProfileId') ?? null;
          ctx.setState({ shellProfileId: profileId });
          deps.scheduleWindowLayoutSave();

          pty.beginShellChange();
          term.clear();

          try {
            await pty.create(term.instance.cols, term.instance.rows);
            ctx.emit('shellChanged', { profileId, previousProfileId: prevProfileId });
          } catch (error) {
            ctx.setState({ shellProfileId: prevProfileId });
            deps.scheduleWindowLayoutSave();
            const message = error instanceof Error ? error.message : String(error);
            term.writeln(`\x1b[38;5;204mFailed to start shell "${profileId}": ${message}\x1b[0m`);
            throw error;
          } finally {
            pty.endShellChange();
          }
        },
      };
    },
    close(_ctx: PaneContext, _api: ShellCapabilityApi): void {
      // No cleanup needed
    },
  };
}
