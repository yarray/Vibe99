/**
 * Clipboard Capability — terminal selection auto-copy and OSC 52 clipboard access.
 * Extracts clipboard logic from pane-renderer.ts.
 * @module pane/capabilities/clipboard-capability
 */

import type { Backend } from '../../backend';

export interface ClipboardBehaviorContext {
  id: string;
  capability: <T>(name: string) => T | undefined;
}

export interface ClipboardBehaviorDeps {
  backend: Backend;
}

export interface ClipboardCapability {
  paste(text: string): boolean;
  readClipboard(): Promise<string>;
  snapshot(): Promise<{ text: string; hasImage: boolean }>;
}

export function createClipboardBehavior(deps: ClipboardBehaviorDeps) {
  const { backend } = deps;
  let ctx: ClipboardBehaviorContext | null = null;

  return {
    name: 'clipboard' as const,

    open(context: ClipboardBehaviorContext): void {
      ctx = context;
      const termCap = ctx.capability<{
        instance: {
          onSelectionChange: (cb: () => void) => void;
          getSelection: () => string;
          parser: { registerOscHandler: (n: number, cb: (data: string) => boolean) => boolean };
          sessionReady: boolean;
        };
      }>('terminal');
      const terminal = termCap?.instance;
      if (!terminal) return;

      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) void backend.clipboard.write(selection);
      });

      terminal.parser.registerOscHandler(52, (data) => {
        const semicolon = data.indexOf(';');
        if (semicolon === -1) return true;
        const base64Text = data.slice(semicolon + 1);
        if (!base64Text || base64Text === '?') return true;
        try {
          const text = new TextDecoder().decode(
            Uint8Array.from(atob(base64Text), (c) => c.charCodeAt(0)),
          );
          void backend.clipboard.write(text);
        } catch { /* invalid base64 */ }
        return true;
      });
    },

    close(): void {
      ctx = null;
    },

    paste(text: string): boolean {
      if (!ctx) return false;
      const termCap = ctx.capability<{
        instance: { paste: (text: string) => void; sessionReady: boolean };
      }>('terminal');
      const terminal = termCap?.instance;
      if (!terminal?.sessionReady) return false;
      if (backend.platform === 'win32') {
        terminal.paste(text);
      } else {
        void backend.terminal.write({ paneId: ctx.id, data: text });
      }
      return true;
    },

    readClipboard(): Promise<string> {
      return backend.clipboard.read();
    },

    snapshot(): Promise<{ text: string; hasImage: boolean }> {
      return backend.clipboard.snapshot();
    },
  };
}
