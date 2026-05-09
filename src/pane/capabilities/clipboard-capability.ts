/**
 * Clipboard Capability — pane-level clipboard integration
 *
 * Handles selection-based clipboard writes (auto-copy on selection)
 * and OSC 52 clipboard integration for the pane's terminal.
 *
 * @module pane/capabilities/clipboard-capability
 */

import type { PaneCapability, PaneContext } from '../types';
import type { ClipboardApi } from '../../backend';
import type { TerminalCapabilityApi } from './terminal-capability';

export interface ClipboardBehaviorDeps {
  backend: { clipboard: ClipboardApi };
  getTerminal: () => TerminalCapabilityApi | undefined;
}

export interface ClipboardCapabilityApi {
  writeSelection(): boolean;
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export function createClipboardBehavior(deps: ClipboardBehaviorDeps): PaneCapability<ClipboardCapabilityApi> {
  return {
    name: 'clipboard',
    open(_ctx: PaneContext): ClipboardCapabilityApi {
      return {
        writeSelection(): boolean {
          const term = deps.getTerminal();
          if (!term || !term.hasSelection()) return false;
          deps.backend.clipboard.write(term.getSelection());
          return true;
        },
        async writeText(text: string): Promise<void> {
          await deps.backend.clipboard.write(text);
        },
        async readText(): Promise<string> {
          return deps.backend.clipboard.read();
        },
      };
    },
  };
}
