/**
 * Color Capability — accent color management.
 * Extracts color logic from pane-renderer.ts.
 * Behavior factory: `createColorBehavior(deps)` → `{ name: 'color', open(ctx), close() }`
 * @module pane/capabilities/color-capability
 */

export interface ColorBehaviorContext {
  id: string;
  getState: <K extends string>(key: K) => unknown;
  capability: <T>(name: string) => T | undefined;
  setState: (key: string, value: unknown) => void;
  emit: (event: string, payload?: unknown) => void;
}

export interface ColorBehaviorDeps {
  getAccent: () => string;
  setCustomColor: (paneId: string, color: string) => void;
  clearCustomColor: (paneId: string) => void;
  scheduleWindowLayoutSave: () => void;
}

export interface ColorCapability {
  getAccent(): string;
  setCustomColor(color: string): void;
  clearCustomColor(): void;
}

export function createColorBehavior(deps: ColorBehaviorDeps): {
  name: 'color';
  open(ctx: ColorBehaviorContext): ColorCapability;
  close(): void;
} {
  return {
    name: 'color' as const,
    open(ctx: ColorBehaviorContext): ColorCapability {
      return {
        getAccent(): string {
          const custom = ctx.getState('customColor') as string | null;
          return custom ?? deps.getAccent();
        },
        setCustomColor(color: string): void {
          ctx.setState('customColor', color);
          deps.setCustomColor(ctx.id, color);
          deps.scheduleWindowLayoutSave();
        },
        clearCustomColor(): void {
          ctx.setState('customColor', null);
          deps.clearCustomColor(ctx.id);
          deps.scheduleWindowLayoutSave();
        },
      };
    },
    close(): void { /* stateless */ },
  };
}

// Sync helpers — render loop calls terminal.setTheme(theme) and dom.setAccent(color)
// when it detects customColor state changes via getAccent() comparison.
function syncTerminal(_accent: string): void { /* handled by render loop */ }
function syncDom(_accent: string): void { /* handled by render loop */ }