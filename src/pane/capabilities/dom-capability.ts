import type { PaneCapability, PaneContext } from '../types';
import type { PaneAlertStrategy } from '../../pane-alert-breathing-mask';

export interface DomBehaviorDeps {
  onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  onTerminalContextMenu: (paneId: string, event: MouseEvent) => Promise<void> | void;
  paneAlert: PaneAlertStrategy;
}

export interface DomCapabilityApi {
  root: HTMLElement;
  terminalHost: HTMLElement;
  mount(container: HTMLElement): void;
  unmount(): void;
  setLayout(options: { left: number; height: number; zIndex: number }): void;
  setFocused(isFocused: boolean, isNavTarget: boolean): void;
  setAccent(color: string): void;
  dispose(): void;
}

export function createDomApi(deps: DomBehaviorDeps, paneId: string, accent: string): DomCapabilityApi {
  const root = document.createElement('article');
  root.className = 'pane';
  root.style.setProperty('--pane-accent', accent);

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

  const handleClick = (): void => {
    deps.onPaneClick(paneId);
  };

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    deps.onPaneClick(paneId, { focusTerminal: false });
    void deps.onTerminalContextMenu(paneId, event);
  };

  root.addEventListener('click', handleClick);
  terminalHost.addEventListener('contextmenu', handleContextMenu);

  return {
    root,
    terminalHost,
    mount(container: HTMLElement): void {
      container.append(root);
    },
    unmount(): void {
      root.remove();
    },
    setLayout({ left, height, zIndex }: { left: number; height: number; zIndex: number }): void {
      root.style.left = `${left}px`;
      root.style.zIndex = String(zIndex);
      root.style.height = `${height}px`;
    },
    setFocused(isFocused: boolean, isNavTarget: boolean): void {
      root.classList.toggle('is-focused', isFocused);
      root.classList.toggle('is-navigation-target', isNavTarget);
    },
    setAccent(color: string): void {
      root.style.setProperty('--pane-accent', color);
    },
    dispose(): void {
      root.removeEventListener('click', handleClick);
      terminalHost.removeEventListener('contextmenu', handleContextMenu);
      root.remove();
    },
  };
}

export function createDomBehavior(deps: DomBehaviorDeps): PaneCapability<DomCapabilityApi> {
  return {
    name: 'dom',
    open(ctx: PaneContext): DomCapabilityApi {
      const accent = ctx.getState('customColor') || ctx.getState('accent') || '';
      const api = createDomApi(deps, ctx.id, accent);
      deps.paneAlert.attach();
      return api;
    },
    close(_ctx: PaneContext, api: DomCapabilityApi): void {
      api.dispose();
    },
  };
}
