// terminal-links.ts — Shared link activation for plain-text and OSC 8 hyperlinks
//
// xterm surfaces two kinds of links: plain-text URLs (handled by
// WebLinksAddon via its handler argument) and OSC 8 embedded hyperlinks
// (handled by TerminalOptions.linkHandler). Both must open through the
// bridge's openExternalUrl (opener plugin); neither may fall through to
// xterm's default activation, which calls window.confirm() — overridden by
// tauri-plugin-dialog's init script to the plugin:dialog|confirm IPC
// command that our capability set does not allow, so the link never opens
// and the status bar shows an ACL error (VIB-373).

import type { IBufferRange } from '@xterm/xterm';

export interface TerminalLinkDeps {
  /** Platform identifier as reported by the bridge ('darwin' vs others). */
  platform: string;
  /** Opens a URL in the system browser. */
  openExternalUrl: (uri: string) => Promise<void> | void;
  /** Reports a failed open to the status bar. */
  reportError: (error: unknown) => void;
}

export interface TerminalLinkHandler {
  activate: (event: MouseEvent, text: string, range: IBufferRange) => void;
}

function isLinkOpenModifierPressed(event: MouseEvent, platform: string): boolean {
  return event.ctrlKey || (platform === 'darwin' && event.metaKey);
}

/**
 * Creates the activation callback shared by WebLinksAddon and the OSC 8
 * linkHandler. Clicks without the open modifier are ignored so they keep
 * reaching the shell (mouse-reporting TUIs); modifier clicks open the URI
 * in the system browser without any confirm prompt.
 */
export function createTerminalLinkActivation(
  deps: TerminalLinkDeps,
): (event: MouseEvent, uri: string) => void {
  return (event: MouseEvent, uri: string): void => {
    if (!isLinkOpenModifierPressed(event, deps.platform)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void Promise.resolve(deps.openExternalUrl(uri)).catch(deps.reportError);
  };
}

/** TerminalOptions.linkHandler value routing OSC 8 links to the bridge. */
export function createTerminalLinkHandler(deps: TerminalLinkDeps): TerminalLinkHandler {
  const activate = createTerminalLinkActivation(deps);
  return { activate };
}
