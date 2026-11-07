// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { registerActivitySignals } from './terminal-signals';

/**
 * Unit tests for the xterm signal wiring of VIB-375 layer 1: BEL and the OSC
 * notification forms (iTerm2 growl OSC 9, xterm notify OSC 777, kitty OSC 99)
 * must be routed to the activity watcher's immediate `noteSignal` path, and
 * the OSC sequences must not leak into the scrollback.
 */

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve);
  });
}

function visibleText(term: Terminal): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

describe('registerActivitySignals', () => {
  it('routes BEL (0x07) to noteSignal', async () => {
    const noteSignal = vi.fn();
    const term = new Terminal();
    registerActivitySignals(term, { noteSignal }, 'p1');

    await write(term, '\x07');

    expect(noteSignal).toHaveBeenCalledTimes(1);
    expect(noteSignal).toHaveBeenCalledWith('p1');
    term.dispose();
  });

  it('routes OSC 9 (iTerm2 growl) to noteSignal', async () => {
    const noteSignal = vi.fn();
    const term = new Terminal();
    registerActivitySignals(term, { noteSignal }, 'p1');

    await write(term, '\x1b]9;hello\x1b\\');

    expect(noteSignal).toHaveBeenCalledTimes(1);
    expect(noteSignal).toHaveBeenCalledWith('p1');
    term.dispose();
  });

  it('routes OSC 777 (notify) and OSC 99 (kitty notification) to noteSignal', async () => {
    const noteSignal = vi.fn();
    const term = new Terminal();
    registerActivitySignals(term, { noteSignal }, 'p1');

    await write(term, '\x1b]777;notify;title;body\x1b\\');
    await write(term, '\x1b]99;hello\x1b\\');

    expect(noteSignal).toHaveBeenCalledTimes(2);
    expect(noteSignal).toHaveBeenCalledWith('p1');
    term.dispose();
  });

  it('keeps OSC notification sequences out of the scrollback', async () => {
    const noteSignal = vi.fn();
    const term = new Terminal({ cols: 40, rows: 4 });
    registerActivitySignals(term, { noteSignal }, 'p1');

    await write(term, 'ok\x1b]9;hidden-payload\x1b\\');

    const text = visibleText(term);
    expect(text).toContain('ok');
    expect(text).not.toContain('hidden-payload');
    term.dispose();
  });
});
