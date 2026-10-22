// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Terminal } from '@xterm/xterm';
import {
  createTerminalLinkActivation,
  createTerminalLinkHandler,
} from './terminal-links';

/**
 * Regression tests for VIB-373: clicking an OSC 8 hyperlink failed with
 * "Command plugin:dialog|confirm not allowed by ACL" and never opened.
 *
 * Root cause: the app only wired WebLinksAddon (plain-text URLs). For OSC 8
 * embedded hyperlinks xterm falls back to its default activation, which
 * calls window.confirm() — and tauri-plugin-dialog's init script overrides
 * window.confirm to invoke plugin:dialog|confirm, a command the app's
 * capability set (dialog:default = message/save/open) does not allow. The
 * rejected promise surfaced as an unhandledrejection in the status bar and
 * the link stayed closed.
 *
 * The fix supplies TerminalOptions.linkHandler so OSC 8 activation opens
 * through the bridge's openExternalUrl (opener plugin), gated on the same
 * modifier as WebLinksAddon. These tests pin that behavior at the xterm
 * level the app relies on.
 */

interface FakeMouseEventInit {
  ctrlKey?: boolean;
  metaKey?: boolean;
}

function fakeMouse(init: FakeMouseEventInit = {}): MouseEvent {
  return {
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent;
}

function writeOsc8Link(term: Terminal, uri: string, label: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(`\x1b]8;;${uri}\x07${label}\x1b]8;;\x07`, resolve);
  });
}

interface OscLink {
  text: string;
  activate: (e: MouseEvent, uri: string) => void;
}

type InternalTerminal = Terminal & {
  _core: {
    _linkProviderService: {
      linkProviders: Array<{
        provideLinks: (line: number, cb: (links: OscLink[] | undefined) => void) => void;
      }>;
    };
  };
};

/** The first registered provider is xterm's built-in OscLinkProvider. */
function oscLinkProvider(term: Terminal): {
  provideLinks: (line: number, cb: (links: OscLink[] | undefined) => void) => void;
} {
  const providers = (term as InternalTerminal)._core._linkProviderService.linkProviders;
  expect(providers.length).toBeGreaterThan(0);
  return providers[0]!;
}

function provideOsc8Links(term: Terminal): Promise<OscLink[]> {
  return new Promise<OscLink[]>((resolve) => {
    oscLinkProvider(term).provideLinks(1, (links) => resolve(links ?? []));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTerminalLinkActivation', () => {
  it('opens the URI when the open modifier is pressed', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const reportError = vi.fn();
    const activation = createTerminalLinkActivation({
      platform: 'linux',
      openExternalUrl,
      reportError,
    });

    const event = fakeMouse({ ctrlKey: true });
    activation(event, 'https://example.com/docs');

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs');
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(reportError).not.toHaveBeenCalled());
  });

  it('uses the platform modifier on darwin (meta opens like ctrl)', () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const activation = createTerminalLinkActivation({
      platform: 'darwin',
      openExternalUrl,
      reportError: vi.fn(),
    });

    activation(fakeMouse({ metaKey: true }), 'https://example.com');
    expect(openExternalUrl).toHaveBeenCalledTimes(1);

    openExternalUrl.mockClear();
    activation(fakeMouse(), 'https://example.com');
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('ignores clicks without the modifier so they reach the shell', () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const activation = createTerminalLinkActivation({
      platform: 'linux',
      openExternalUrl,
      reportError: vi.fn(),
    });

    const event = fakeMouse();
    activation(event, 'https://example.com');

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('reports open failures instead of leaking an unhandled rejection', async () => {
    const reportError = vi.fn();
    const activation = createTerminalLinkActivation({
      platform: 'linux',
      openExternalUrl: vi.fn().mockRejectedValue(new Error('boom')),
      reportError,
    });

    activation(fakeMouse({ ctrlKey: true }), 'https://example.com');
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.any(Error)));
  });
});

describe('Terminal linkHandler wiring (OSC 8 hyperlinks)', () => {
  it('routes OSC 8 activation to the bridge instead of window.confirm', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const term = new Terminal({
      linkHandler: createTerminalLinkHandler({
        platform: 'linux',
        openExternalUrl,
        reportError: vi.fn(),
      }),
    });
    await writeOsc8Link(term, 'https://example.com/pr/402', 'PR 402');

    const links = await provideOsc8Links(term);
    expect(links).toHaveLength(1);
    expect(links[0]!.text).toBe('https://example.com/pr/402');

    const confirmSpy = vi.fn();
    vi.stubGlobal('confirm', confirmSpy);
    links[0]!.activate(fakeMouse({ ctrlKey: true }), links[0]!.text);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/pr/402');
    term.dispose();
    vi.unstubAllGlobals();
  });

  it('demonstrates the default activation path goes through confirm()', async () => {
    // Pins the pre-fix behavior this fix works around: without linkHandler,
    // xterm's default OSC 8 activation calls window.confirm() — the exact
    // call tauri-plugin-dialog turns into the ACL-denied IPC.
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    const term = new Terminal();
    await writeOsc8Link(term, 'https://example.com/pr/402', 'PR 402');

    const links = await provideOsc8Links(term);
    links[0]!.activate(fakeMouse({ ctrlKey: true }), links[0]!.text);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('https://example.com/pr/402'));
    term.dispose();
    vi.unstubAllGlobals();
  });
});
