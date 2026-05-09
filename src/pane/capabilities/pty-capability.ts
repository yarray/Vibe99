/**
 * PTY Capability — PTY 会话生命周期管理
 *
 * 负责创建、写入、调整大小、销毁 PTY 会话，以及处理 PTY 数据和退出事件。
 * 从 pane-renderer.ts 提取的 PTY 会话管理逻辑。
 *
 * @module pane/capabilities/pty-capability
 */

import type { PaneCapability, PaneContext } from '../types';
import type { Backend } from '../../backend';
import type { TerminalCapabilityApi } from './terminal-capability';

/** PTY capability 的依赖注入 */
export interface PtyBehaviorDeps {
  backend: Backend;
  getTerminal: () => TerminalCapabilityApi | undefined;
}

/** PTY capability 的公共 API */
export interface PtyCapabilityApi {
  readonly sessionReady: boolean;
  readonly isShellChanging: boolean;
  readonly recentShellChange: number | null;
  create(cols: number, rows: number): Promise<void>;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  destroy(): void;
  beginShellChange(): void;
  endShellChange(): void;
}

/** 创建 PTY capability */
export function createPtyBehavior(deps: PtyBehaviorDeps): PaneCapability<PtyCapabilityApi> {
  return {
    name: 'pty',
    open(ctx: PaneContext): PtyCapabilityApi {
      let sessionReady = false;
      let isShellChanging = false;
      let shellChangeTime: number | null = null;

      const handleData = (e: { paneId: string; data: string }): void => {
        if (e.paneId === ctx.id && sessionReady && !isShellChanging) {
          const term = deps.getTerminal();
          if (term) { term.write(e.data); ctx.emit('ptyData'); }
        }
      };

      const handleExit = (e: { paneId: string; exitCode: number; reason: string }): void => {
        if (e.paneId === ctx.id) {
          const term = deps.getTerminal();
          if (term) term.writeln(`\x1b[38;5;204mShell exited: code ${e.exitCode}${e.reason ? ` (${e.reason})` : ''}\x1b[0m`);
          sessionReady = false;
          ctx.emit('ptyExit', { exitCode: e.exitCode, reason: e.reason });
        }
      };

      const unlisteners = [
        deps.backend.terminal.onData(handleData),
        deps.backend.terminal.onExit(handleExit),
      ];

      return {
        get sessionReady(): boolean { return sessionReady; },
        get isShellChanging(): boolean { return isShellChanging; },
        get recentShellChange(): number | null { return shellChangeTime; },

        async create(cols: number, rows: number): Promise<void> {
          await deps.backend.terminal.create({
            paneId: ctx.id,
            cols,
            rows,
            cwd: ctx.getState('cwd') || '.',
            shellProfileId: ctx.getState('shellProfileId') ?? null,
          });
          sessionReady = true;
          ctx.emit('ptyCreated');
        },

        async write(data: string): Promise<void> {
          if (sessionReady && !isShellChanging) {
            await deps.backend.terminal.write({ paneId: ctx.id, data });
          }
        },

        async resize(cols: number, rows: number): Promise<void> {
          if (sessionReady) {
            await deps.backend.terminal.resize({ paneId: ctx.id, cols, rows });
            ctx.emit('ptyResized', { cols, rows });
          }
        },

        destroy(): void {
          if (sessionReady) {
            deps.backend.terminal.destroy({ paneId: ctx.id });
            sessionReady = false;
            ctx.emit('ptyDestroyed');
          }
        },

        beginShellChange(): void {
          isShellChanging = true;
          shellChangeTime = Date.now();
          sessionReady = false;
          ctx.emit('shellChangeBegin');
        },

        endShellChange(): void {
          isShellChanging = false;
          ctx.emit('shellChangeEnd');
        },
      };
    },
    close(_ctx: PaneContext, api: PtyCapabilityApi): void {
      api.destroy();
    },
  };
}
