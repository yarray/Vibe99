/**
 * DOM Capability — manages the pane's DOM subtree.
 *
 * Extracts DOM creation and lifecycle logic from pane-renderer.ts.
 *
 * Behavior factory: `createDomBehavior(deps)`
 * Returns: `{ name: 'dom', open(ctx), close(ctx, api) }`
 *
 * DOM structure: root(article.pane) > shell > body > surface > terminalHost
 *
 * @module pane/capabilities/dom-capability
 */

import type { PaneAlertStrategy } from '../../pane-alert-breathing-mask';

// ---------------------------------------------------------------------------
// Context shape (set by create-pane.ts)
// ---------------------------------------------------------------------------

export interface DomBehaviorContext {
  id: string;
  getState: <K extends string>(key: K) => unknown;
  emit: (event: string, payload?: unknown) => void;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface DomBehaviorDeps {
  paneAlert: PaneAlertStrategy;
  onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  onTerminalContextMenu: (node: DomPaneNode, event: MouseEvent) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Public API returned by open(ctx)
// ---------------------------------------------------------------------------

export interface DomPaneNode {
  paneId: string;
  root: HTMLElement;
  terminalHost: HTMLElement;
}

export interface DomCapabilityApi {
  /** DOM element references */
  root: HTMLElement;
  terminalHost: HTMLElement;

  /** Mount the pane root into a container element */
  mount(container: HTMLElement): void;

  /** Remove the pane root from its current parent */
  unmount(): void;

  /**
   * Apply layout positioning.
   * @param layout.left  px from container left edge
   * @param layout.height  px height (full stage height)
   * @param layout.zIndex  stacking order
   */
  setLayout(layout: { left: number; height: number; zIndex: number }): void;

  /**
   * Toggle focus / navigation-target CSS classes.
   * @param isFocused  pane is the active pane
   * @param isNavTarget  in navigation mode and is the target
   */
  setFocused(isFocused: boolean, isNavTarget: boolean): void;

  /** Set the --pane-accent CSS custom property on root */
  setAccent(color: string): void;

  /** Full cleanup: remove element, detach breathing mask */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Behavior factory
// ---------------------------------------------------------------------------

export function createDomBehavior(deps: DomBehaviorDeps) {
  return {
    name: 'dom' as const,

    open(ctx: DomBehaviorContext): DomCapabilityApi {
      const paneId = ctx.id;
      const accentColor = (ctx.getState('accent') as string | undefined) ?? '#61afef';

      // ── DOM tree ──────────────────────────────────────────────────────────
      const root = document.createElement('article');
      root.className = 'pane';
      root.style.setProperty('--pane-accent', accentColor);

      const shell = document.createElement('div');
      shell.className = 'pane-shell';

      const body = document.createElement('div');
      body.className = 'pane-body';

      const surface = document.createElement('div');
      surface.className = 'pane-surface';

      const terminalHost = document.createElement('div');
      terminalHost.className = 'terminal-host';
      surface.append(terminalHost);
      body.append(surface);
      shell.append(body);
      root.append(shell);

      // ── Breathing mask integration ─────────────────────────────────────────
      deps.paneAlert.attach();

      // ── Event registration ─────────────────────────────────────────────────
      root.addEventListener('click', () => {
        deps.onPaneClick(paneId);
      });

      terminalHost.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        deps.onPaneClick(paneId, { focusTerminal: false });
        void deps.onTerminalContextMenu({ paneId, root, terminalHost }, event);
      });

      // ── Internal state ────────────────────────────────────────────────────
      let disposed = false;

      // ── API ────────────────────────────────────────────────────────────────
      return {
        root,
        terminalHost,

        mount(container: HTMLElement): void {
          if (disposed) return;
          container.append(root);
        },

        unmount(): void {
          if (disposed) return;
          root.remove();
        },

        setLayout({ left, height, zIndex }: { left: number; height: number; zIndex: number }): void {
          if (disposed) return;
          root.style.left = `${left}px`;
          root.style.height = `${height}px`;
          root.style.zIndex = String(zIndex);
        },

        setFocused(isFocused: boolean, isNavTarget: boolean): void {
          if (disposed) return;
          root.classList.toggle('is-focused', isFocused);
          root.classList.toggle('is-navigation-target', isNavTarget);
        },

        setAccent(color: string): void {
          if (disposed) return;
          root.style.setProperty('--pane-accent', color);
        },

        dispose(): void {
          if (disposed) return;
          disposed = true;
          root.remove();
        },
      };
    },

    close(_ctx: DomBehaviorContext, api: DomCapabilityApi | undefined): void {
      api?.dispose();
    },
  };
}
