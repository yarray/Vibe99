/**
 * Shell Capability — shell profile switching.
 * Extracts shell-change logic from pane-renderer.ts.
 * Behavior factory: `createShellBehavior(deps)` → `{ name: 'shell', open(ctx), close() }`
 * @module pane/capabilities/shell-capability
 */

export interface ShellBehaviorContext {
  id: string;
  getState: <K extends string>(key: K) => unknown;
  setState: (key: string, value: unknown) => void;
  capability: <T>(name: string) => T | undefined;
  emit: (event: string, payload?: unknown) => void;
}

export interface ShellBehaviorDeps {
  scheduleWindowLayoutSave: () => void;
}

export interface ShellCapability {
  changeProfile(profileId: string): Promise<void>;
}

export function createShellBehavior(deps: ShellBehaviorDeps): {
  name: 'shell';
  open(ctx: ShellBehaviorContext): ShellCapability;
  close(): void;
} {
  return {
    name: 'shell' as const,

    open(ctx: ShellBehaviorContext): ShellCapability {
      return {
        async changeProfile(profileId: string): Promise<void> {
          const pty = ctx.capability<{
            beginShellChange(): void;
            endShellChange(): void;
            create(cols: number, rows: number): Promise<void>;
            destroy(): void;
            sessionReady: boolean;
          }>('pty');
          const term = ctx.capability<{
            instance: { clear(): void; dispose(): void; cols: number; rows: number };
          }>('terminal');

          const prevProfileId = ctx.getState<string>('shellProfileId') ?? null;
          ctx.setState('shellProfileId', profileId);
          deps.scheduleWindowLayoutSave();

          pty?.beginShellChange();
          term?.instance?.clear();

          try {
            await pty?.create(
              term?.instance?.cols ?? 80,
              term?.instance?.rows ?? 24,
            );
          } catch {
            ctx.setState('shellProfileId', prevProfileId);
            deps.scheduleWindowLayoutSave();
          } finally {
            pty?.endShellChange();
          }
        },
      };
    },

    close(): void { /* no-op */ },
  };
}