/**
 * Shell Capability — pane shell profile management
 *
 * Manages shell profile switching with graceful teardown and
 * re-creation of the PTY session.
 *
 * @module pane/capabilities/shell-capability
 */

import type { PaneCapability, PaneContext } from '../types';
import type { PtyCapabilityApi } from './pty-capability';
import type { TerminalCapabilityApi } from './terminal-capability';

export interface ShellBehaviorDeps {
  getPty: () => PtyCapabilityApi | undefined;
  getTerminal: () => TerminalCapabilityApi | undefined;
}

export interface ShellCapabilityApi {
  changeProfile(profileId: string): Promise<void>;
}

export function createShellBehavior(deps: ShellBehaviorDeps): PaneCapability<ShellCapabilityApi> {
  return {
    name: 'shell',
    open(_ctx: PaneContext): ShellCapabilityApi {
      return {
        async changeProfile(profileId: string): Promise<void> {
          const pty = deps.getPty();
          const term = deps.getTerminal();
          if (!pty || !term) return;

          pty.beginShellChange();
          term.clear();

          const cols = Math.max(20, term.instance.cols || 80);
          const rows = Math.max(8, term.instance.rows || 24);
          await pty.create(cols, rows);

          pty.endShellChange();
        },
      };
    },
  };
}
