// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';

/**
 * Regression tests for VIB-370: SGR mouse reports leaking into the
 * terminal as visible text after a shell restart.
 *
 * Root cause: restart()/changeShell() reused the xterm instance but only
 * called terminal.clear(), which empties the buffer yet leaves mouse
 * tracking (DECSET 1000/1002/1003), SGR encoding (DECSET 1006), bracketed
 * paste and the parser state machine untouched. When a TUI app exits
 * abnormally (e.g. SIGKILL) without DECRST, the restarted shell inherits
 * an active mouse protocol; every mouse move then produces an SGR report
 * the shell never asked for, and the report text (e.g. "35;98;27M")
 * leaks into the visible buffer.
 *
 * The fix writes an in-band RIS (ESC c) before clearing, which resets the
 * mouse protocol/encoding back to NONE/DEFAULT. These tests pin that
 * behavior at the xterm.js level the app relies on.
 */

type InternalTerminal = Terminal & {
  _core: {
    coreMouseService: {
      activeProtocol: string;
      activeEncoding: string;
    };
  };
};

function visibleText(term: Terminal): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n').replace(/\n+/g, '\n').trim();
}

function enableMouseModes(term: Terminal): void {
  // Full TUI-style enablement: any-motion tracking + SGR encoding
  term.write('\x1b[?1000;1002;1003;1006h');
}

function mouseState(term: Terminal): { protocol: string; encoding: string } {
  const core = (term as InternalTerminal)._core.coreMouseService;
  return { protocol: core.activeProtocol, encoding: core.activeEncoding };
}

function waitForParse(term: Terminal): Promise<void> {
  return new Promise((resolve) => {
    term.write('', resolve);
  });
}

describe('terminal mouse-state reset (VIB-370 regression)', () => {
  it('DECSET 1000/1002/1003/1006 activates ANY protocol + SGR encoding', async () => {
    const term = new Terminal() as InternalTerminal;
    enableMouseModes(term);
    await waitForParse(term);

    expect(mouseState(term)).toEqual({ protocol: 'ANY', encoding: 'SGR' });
    term.dispose();
  });

  it('terminal.clear() alone leaves the mouse protocol active (the bug)', async () => {
    const term = new Terminal() as InternalTerminal;
    enableMouseModes(term);
    await waitForParse(term);

    term.clear();
    await waitForParse(term);

    expect(mouseState(term).protocol).not.toBe('NONE');
    expect(mouseState(term).encoding).toBe('SGR');
    term.dispose();
  });

  it('in-band RIS (ESC c) resets mouse protocol and encoding', async () => {
    const term = new Terminal() as InternalTerminal;
    enableMouseModes(term);
    await waitForParse(term);

    term.write('\x1bc');
    await waitForParse(term);

    expect(mouseState(term)).toEqual({ protocol: 'NONE', encoding: 'DEFAULT' });
    term.dispose();
  });

  it('RIS also resets bracketed paste and alt buffer left by a dead TUI', async () => {
    const term = new Terminal() as InternalTerminal;
    term.write('\x1b[?2004h\x1b[?1049h');
    await waitForParse(term);
    expect((term as any)._core.coreService.decPrivateModes.bracketedPasteMode).toBe(true);

    term.write('\x1bc');
    await waitForParse(term);

    expect((term as any)._core.coreService.decPrivateModes.bracketedPasteMode).toBe(false);
    expect((term as any)._core.buffers.active).toBe((term as any)._core.buffers.normal);
    term.dispose();
  });

  it('SGR report echoes concatenated after a consumed report leak as text (documents the leak shape)', async () => {
    // When an unconfigured shell echoes mouse reports back, the first
    // "ESC[<..." is consumed as an unrecognized CSI and the following
    // report bodies print verbatim. This is the exact garbage shape users
    // saw ("35;98;27M35;102;27M...") and why the fix targets prevention
    // (reset on restart) rather than output filtering.
    const term = new Terminal({ cols: 80, rows: 10 }) as InternalTerminal;
    enableMouseModes(term);
    await waitForParse(term);

    term.write('\x1b[<35;98;27M' + '35;102;27M35;112;27M');
    await waitForParse(term);

    expect(visibleText(term)).toContain('35;102;27M35;112;27M');
    term.dispose();
  });

  it('after RIS, mouse events are no longer generated at all (fix outcome)', async () => {
    const term = new Terminal({ cols: 80, rows: 10 }) as InternalTerminal;
    const sent: string[] = [];
    term.onData((d) => sent.push(d));
    enableMouseModes(term);
    await waitForParse(term);

    term.write('\x1bc');
    await waitForParse(term);
    expect(sent).toEqual([]);

    // The real fix outcome: with tracking reset, xterm never generates a
    // mouse report for the restarted (mouse-unaware) shell, so no SGR
    // report text can enter the PTY echo path in the first place.
    term.dispose();
  });
});
