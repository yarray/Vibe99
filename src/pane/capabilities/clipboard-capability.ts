import type { IDisposable } from '@xterm/xterm';
import type { PaneCapability, PaneContext } from '../types';
import type { Bridge } from '../../compat/bridge-compat';
import type { TerminalCapabilityApi } from './terminal-capability';

export interface ClipboardBehaviorDeps {
  bridge: Bridge;
}

export interface ClipboardCapabilityApi {
  paste(text: string): void;
  readClipboard(): Promise<string>;
  snapshot(): Promise<{ text: string; hasImage: boolean }>;
}

const disposablesMap = new WeakMap<ClipboardCapabilityApi, IDisposable[]>();

export function createClipboardBehavior(deps: ClipboardBehaviorDeps): PaneCapability<ClipboardCapabilityApi> {
  return {
    name: 'clipboard',
    open(ctx: PaneContext): ClipboardCapabilityApi {
      const terminal = ctx.capability<TerminalCapabilityApi>('terminal');
      if (!terminal) {
        throw new Error('clipboard capability requires terminal capability');
      }

      const disposables: IDisposable[] = [];

      disposables.push(
        terminal.instance.onSelectionChange(() => {
          const selection = terminal.instance.getSelection();
          if (selection) {
            deps.bridge.clipboard.write(selection);
          }
        })
      );

      disposables.push(
        terminal.instance.parser.registerOscHandler(52, (data) => {
          const semicolon = data.indexOf(';');
          if (semicolon === -1) return true;
          const base64Text = data.slice(semicolon + 1);
          if (!base64Text || base64Text === '?') return true;
          try {
            const bytes = atob(base64Text);
            const text = new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
            deps.bridge.clipboard.write(text);
          } catch {}
          return true;
        })
      );

      const api: ClipboardCapabilityApi = {
        paste: (text) => {
          if (deps.bridge.platform === 'win32') {
            terminal.instance.paste(text);
          } else {
            deps.bridge.terminal.write({ paneId: ctx.id, data: text });
          }
        },
        readClipboard: () => deps.bridge.clipboard.read(),
        snapshot: () => deps.bridge.clipboard.snapshot(),
      };

      disposablesMap.set(api, disposables);
      return api;
    },
    close(_ctx: PaneContext, api: ClipboardCapabilityApi): void {
      const disposables = disposablesMap.get(api);
      if (disposables) {
        for (const d of disposables) d.dispose();
        disposablesMap.delete(api);
      }
    },
  };
}
