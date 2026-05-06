import type { Terminal } from '@xterm/xterm';
import type { Backend, TerminalDataEvent, TerminalExitEvent } from '../../backend';

export interface PtyBehaviorDeps {
  backend: Backend;
  onExit: (event: TerminalExitEvent) => void | boolean;
  onError?: (error: unknown) => void;
}

export interface PtyBehaviorContext {
  id: string;
  terminal: Terminal;
  getCwd: () => string;
  getShellProfileId: () => string | null;
}

export interface PtyCapability {
  readonly sessionReady: boolean;
  create(cols: number, rows: number): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  destroy(): void;
  beginShellChange(): void;
  endShellChange(): void;
  readonly isShellChanging: boolean;
  readonly recentShellChange: number | null;
  close(): void;
}

export function createPtyBehavior(deps: PtyBehaviorDeps) {
  return {
    name: 'pty' as const,

    open(ctx: PtyBehaviorContext): PtyCapability {
      let sessionReady = false;
      let shellChanging = false;
      let shellChangeTime: number | null = null;

      const removeDataListener = deps.backend.terminal.onData((event: TerminalDataEvent) => {
        if (event.paneId === ctx.id) {
          ctx.terminal.write(event.data);
        }
      });

      const removeExitListener = deps.backend.terminal.onExit((event: TerminalExitEvent) => {
        if (event.paneId === ctx.id) {
          deps.onExit(event);
        }
      });

      const onDataDisposable = ctx.terminal.onData((data: string) => {
        if (sessionReady) {
          void deps.backend.terminal.write({ paneId: ctx.id, data });
        }
      });

      return {
        get sessionReady() {
          return sessionReady;
        },

        async create(cols: number, rows: number): Promise<void> {
          try {
            await deps.backend.terminal.create({
              paneId: ctx.id,
              cols,
              rows,
              cwd: ctx.getCwd(),
              shellProfileId: ctx.getShellProfileId(),
            });
            sessionReady = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const profileId = ctx.getShellProfileId();
            ctx.terminal.writeln(
              `\x1b[38;5;204mFailed to start shell${profileId ? ` "${profileId}"` : ''}: ${message}\x1b[0m`
            );
            throw error;
          }
        },

        write(data: string): void {
          if (sessionReady) {
            void deps.backend.terminal.write({ paneId: ctx.id, data });
          }
        },

        resize(cols: number, rows: number): void {
          if (sessionReady) {
            void deps.backend.terminal.resize({ paneId: ctx.id, cols, rows });
          }
        },

        destroy(): void {
          void deps.backend.terminal.destroy({ paneId: ctx.id });
          sessionReady = false;
        },

        beginShellChange(): void {
          shellChanging = true;
          shellChangeTime = Date.now();
          sessionReady = false;
        },

        endShellChange(): void {
          shellChanging = false;
        },

        get isShellChanging() {
          return shellChanging;
        },

        get recentShellChange() {
          return shellChangeTime;
        },

        close(): void {
          removeDataListener();
          removeExitListener();
          onDataDisposable.dispose();
          void deps.backend.terminal.destroy({ paneId: ctx.id });
          sessionReady = false;
        },
      };
    },

    close(): void {
      // Per-pane cleanup is handled by the capability instance's close() method.
    },
  };
}
