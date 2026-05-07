/**
 * PTY Capability — backend pseudo-terminal session lifecycle.
 * Extracts PTY create/write/resize/destroy + shell-change tracking from pane-renderer.ts.
 * @module pane/capabilities/pty-capability
 */

import type { Backend, TerminalDataEvent, TerminalExitEvent } from '../../backend';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface PtyBehaviorDeps {
  backend: Backend;
  onExit: (event: TerminalExitEvent) => void;
}

export interface PtyBehaviorContext {
  id: string;
  getCwd: () => string;
  getShellProfileId: () => string | null;
  /** Called with backend → terminal data (e.g. terminal.write). */
  onOutput: (data: string) => void;
  capability: <T>(name: string) => T | undefined;
}

export interface PtyCapability {
  readonly sessionReady: boolean;
  readonly isShellChanging: boolean;
  readonly recentShellChange: number | null;
  create(cols: number, rows: number): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  destroy(): void;
  beginShellChange(): void;
  endShellChange(): void;
  close(): void;
}

export type PtyBehavior = {
  name: 'pty';
  open(ctx: PtyBehaviorContext): PtyCapability;
  close(): void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPtyBehavior(deps: PtyBehaviorDeps): PtyBehavior {
  const { backend, onExit } = deps;
  const sessions: PtyCapability[] = [];

  return {
    name: 'pty' as const,

    open(ctx: PtyBehaviorContext): PtyCapability {
      let sessionReady = false;
      let shellChanging = false;
      let shellChangeTime: number | null = null;

      const unsubData = backend.terminal.onData((event: TerminalDataEvent) => {
        if (event.paneId === ctx.id) ctx.onOutput(event.data);
      });

      const unsubExit = backend.terminal.onExit((event: TerminalExitEvent) => {
        if (event.paneId === ctx.id) onExit(event);
      });

      const cap: PtyCapability = {
        get sessionReady() { return sessionReady; },
        get isShellChanging() { return shellChanging; },
        get recentShellChange() { return shellChangeTime; },

        async create(cols: number, rows: number): Promise<void> {
          await backend.terminal.create({
            paneId: ctx.id,
            cols,
            rows,
            cwd: ctx.getCwd(),
            shellProfileId: ctx.getShellProfileId(),
          });
          sessionReady = true;
        },

        write(data: string): void {
          if (sessionReady) backend.terminal.write({ paneId: ctx.id, data });
        },

        resize(cols: number, rows: number): void {
          if (sessionReady) backend.terminal.resize({ paneId: ctx.id, cols, rows });
        },

        destroy(): void {
          backend.terminal.destroy({ paneId: ctx.id });
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

        close(): void {
          cap.destroy();
          unsubData();
          unsubExit();
          const idx = sessions.indexOf(cap);
          if (idx !== -1) sessions.splice(idx, 1);
        },
      };

      sessions.push(cap);
      return cap;
    },

    close(): void {
      for (const s of [...sessions]) s.close();
    },
  };
}
