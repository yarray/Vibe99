/**
 * Pane Manager — collection CRUD, focus management, layout coordination,
 * and session persistence for PaneHandle instances.
 *
 * The manager owns the ordered collection of live PaneHandle objects.
 * Capabilities are injected — the manager does not hardcode which
 * capabilities to mount, avoiding stubs for not-yet-implemented ones.
 *
 * Satisfies the PaneManager interface required by createFocusController.
 *
 * @module manager/create-pane-manager
 */

import { createPane } from '../pane/create-pane';
import type { PaneCapability, PaneDeps, PaneHandle, PaneState } from '../pane/types';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Dependencies injected into createPaneManager. */
export interface PaneManagerDeps {
  /** Ordered capabilities to mount on every new pane. */
  capabilities: readonly PaneCapability[];
  /**
   * Names of capabilities that must be present.
   * If provided, create() validates that all required capabilities are
   * available and throws if any are missing.
   */
  requiredCapabilityNames?: readonly string[];
  /** Called after a pane is created and opened. */
  onPaneCreated?: (pane: PaneHandle) => void;
  /** Called before a pane is closed and destroyed. */
  onPaneDestroying?: (pane: PaneHandle) => void;
  /** Called when the focused pane changes. */
  onFocusChange?: (paneId: string | null) => void;
  /** External event handler forwarded to each pane's PaneDeps. */
  onPaneEvent?: PaneDeps['onEvent'];
}

/** Lightweight readonly view of a managed pane. */
export interface PaneView {
  readonly id: string;
}

/** The full public API surface returned by createPaneManager. */
export interface PaneManager {
  // CRUD
  create(initialState?: Partial<PaneState>): PaneHandle;
  destroy(paneId: string): boolean;
  get(paneId: string): PaneHandle | null;
  getAll(): readonly PaneHandle[];
  getActive(): PaneHandle | null;
  getActiveId(): string | null;
  setActive(paneId: string): boolean;
  size(): number;

  // FocusController-compatible interface
  getFocusedPaneId(): string | null;
  getPanes(): readonly PaneView[];
  getPaneIndex(paneId: string): number;
  focusPane(paneId: string, opts?: { focusTerminal?: boolean }): boolean;

  // Serialization
  serializeAll(): readonly { id: string; state: PaneState }[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ManagedPane {
  handle: PaneHandle;
  index: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a pane manager.
 *
 * @param deps - Dependencies including capabilities, callbacks, and event handler.
 * @returns PaneManager interface for pane collection management.
 *
 * The caller decides which capabilities to mount. When all VIB-211~VIB-215
 * capabilities land, the caller adds them to the `capabilities` array:
 *
 * ```ts
 * const manager = createPaneManager({
 *   capabilities: [
 *     createDomBehavior(domDeps),
 *     createTerminalBehavior(terminalDeps),
 *     // pty, activity, clipboard, color, shell — added as they land
 *   ],
 * });
 * ```
 */
export function createPaneManager(deps: PaneManagerDeps): PaneManager {
  const { capabilities, onPaneCreated, onPaneDestroying, onFocusChange, onPaneEvent } = deps;

  // Ordered collection — preserves insertion order for layout rendering.
  let panes: PaneHandle[] = [];
  let focusedPaneId: string | null = null;
  let nextPaneNumber = 1;

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  const validateCapabilities = (): void => {
    if (!deps.requiredCapabilityNames) return;
    const available = new Set(capabilities.map((c) => c.name));
    const missing = deps.requiredCapabilityNames.filter((n) => !available.has(n));
    if (missing.length > 0) {
      throw new Error(
        `PaneManager: missing required capabilities: ${missing.join(', ')}. ` +
        'Ensure all prerequisite capability modules are loaded.',
      );
    }
  };

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  const create = (initialState?: Partial<PaneState>): PaneHandle => {
    validateCapabilities();

    const id = `p${nextPaneNumber++}`;
    const paneDeps: PaneDeps = {
      onEvent: onPaneEvent,
    };

    const pane = createPane({ id, initialState, deps: paneDeps });

    // Mount all capabilities in the caller-provided order.
    for (const capability of capabilities) {
      pane.use(capability);
    }

    pane.open();

    panes = [...panes, pane];
    focusedPaneId = id;

    onPaneCreated?.(pane);
    onFocusChange?.(id);

    return pane;
  };

  const destroy = (paneId: string): boolean => {
    const index = panes.findIndex((p) => p.id === paneId);
    if (index === -1) return false;

    const [pane] = panes.splice(index, 1);
    onPaneDestroying?.(pane);

    pane.close();

    // Deterministic focus fallback: prefer neighbor, then any remaining.
    if (focusedPaneId === paneId) {
      const fallbackIndex = Math.min(index, panes.length - 1);
      focusedPaneId = panes[fallbackIndex]?.id ?? null;
      onFocusChange?.(focusedPaneId);
    }

    return true;
  };

  const get = (paneId: string): PaneHandle | null =>
    panes.find((p) => p.id === paneId) ?? null;

  const getAll = (): readonly PaneHandle[] => panes;

  const getActive = (): PaneHandle | null =>
    focusedPaneId !== null ? get(focusedPaneId) : null;

  const getActiveId = (): string | null => focusedPaneId;

  const setActive = (paneId: string): boolean => {
    if (!panes.some((p) => p.id === paneId)) return false;
    focusedPaneId = paneId;
    onFocusChange?.(paneId);
    return true;
  };

  const size = (): number => panes.length;

  // ---------------------------------------------------------------------------
  // FocusController-compatible interface
  // ---------------------------------------------------------------------------

  const getFocusedPaneId = (): string | null => focusedPaneId;

  const getPanes = (): readonly PaneView[] =>
    panes.map((p) => ({ id: p.id }));

  const getPaneIndex = (paneId: string): number =>
    panes.findIndex((p) => p.id === paneId);

  const focusPane = (paneId: string, _opts?: { focusTerminal?: boolean }): boolean => {
    const pane = get(paneId);
    if (!pane) return false;
    focusedPaneId = paneId;
    onFocusChange?.(paneId);
    return true;
  };

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  const serializeAll = (): readonly { id: string; state: PaneState }[] =>
    panes.map((p) => p.serialize());

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    create,
    destroy,
    get,
    getAll,
    getActive,
    getActiveId,
    setActive,
    size,

    getFocusedPaneId,
    getPanes,
    getPaneIndex,
    focusPane,

    serializeAll,
  };
}
