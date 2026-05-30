/**
 * CLI Bridge — Event Passthrough for External CLI Control
 *
 * Listens for CLI requests forwarded from Rust (via Tauri events),
 * dispatches them through the workbench, and returns results to Rust.
 *
 * @module cli-bridge
 */

import type { AppCommand, CommandResult } from './domain/commands.js';

export interface CliBridgeDeps {
  dispatch: (command: AppCommand) => CommandResult;
  listen: <T = unknown>(event: string, handler: (payload: T) => void) => () => void;
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<void>;
}

interface CliRequest {
  id: string;
  method: string;
  params?: unknown;
}

export function initCliBridge(deps: CliBridgeDeps): () => void {
  const { dispatch, listen, invoke } = deps;

  const unsubscribe = listen<CliRequest>('vibe99:cli-request', (payload) => {
    const { id, method, params } = payload;
    const command = cliMethodToCommand(method, params);

    if (!command) {
      void invoke('cli_respond', {
        id,
        result: { ok: false, reason: `unknown-cli-method: ${method}` },
      });
      return;
    }

    const result = dispatch(command);
    void invoke('cli_respond', { id, result });
  });

  return unsubscribe;
}

function cliMethodToCommand(method: string, params: unknown): AppCommand | null {
  if (params === undefined || params === null) {
    return { type: method } as AppCommand;
  }

  if (typeof params === 'object') {
    return { type: method, ...(params as Record<string, unknown>) } as unknown as AppCommand;
  }

  return null;
}
