/**
 * Pane Core Type Definitions
 *
 * @module pane/types
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Mutable state shape for a single pane. */
export interface PaneState {
  id: string;
  accent: string;
  customColor?: string;
  cwd: string;
  shellProfileId: string | null;
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/**
 * Generic capability factory.
 *
 * `open()` is called during pane initialisation and returns the capability's
 * public API object (stored by name in the pane's capability map).
 * `close()` is called in reverse order during teardown, receiving the same
 * API object that `open()` produced.
 */
export interface PaneCapability<T = unknown> {
  name: string;
  open(ctx: PaneContext): T;
  close?(ctx: PaneContext, api: T): void;
}

// ---------------------------------------------------------------------------
// Context (internal handle passed to capabilities)
// ---------------------------------------------------------------------------

/** Context object handed to each capability's `open` / `close`. */
export interface PaneContext {
  id: string;
  getState: <K extends keyof PaneState>(key: K) => PaneState[K] | undefined;
  setState: (patch: Partial<PaneState>) => void;
  emit: (event: string, payload?: unknown) => void;
  capability: <T>(name: string) => T | undefined;
  deps: PaneDeps;
}

// ---------------------------------------------------------------------------
// Handle (public API returned by createPane)
// ---------------------------------------------------------------------------

/** The full public surface of a pane instance. */
export interface PaneHandle {
  readonly id: string;
  use: (behavior: PaneCapability) => void;
  open: () => PaneHandle;
  command: (name: string, payload?: unknown) => void;
  capability: <T>(name: string) => T | undefined;
  getState: <K extends keyof PaneState>(key: K) => PaneState[K] | undefined;
  setState: (patch: Partial<PaneState>) => void;
  close: () => void;
  on: (event: string, handler: (e: PaneLifecycleEvent) => void) => () => void;
  serialize: () => { id: string; state: PaneState };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/** Discriminated command vocabulary emitted by `command()`. */
export type PaneCommand =
  | { type: 'command'; name: string; payload: unknown };

// ---------------------------------------------------------------------------
// Lifecycle event
// ---------------------------------------------------------------------------

export type PaneLifecycleEvent =
  | { type: 'open' }
  | { type: 'close' }
  | PaneCommand
  | { type: 'state-change'; key: string };

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

/** External dependencies injected at creation time. */
export interface PaneDeps {
  onEvent?: (event: PaneLifecycleEvent, paneId: string) => void;
}
