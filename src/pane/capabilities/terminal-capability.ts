import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { getDefaultFontFamily } from '../../settings';

export interface TerminalBehaviorDeps {
  getFontFamily: () => string;
  getFontSize: () => number;
  getAccent: () => string;
  onData: (data: string) => void;
  onTitleChange: (title: string) => void;
  onSelectionChange: () => void;
}

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  [colorName: string]: string;
}

export interface TerminalCapability {
  readonly instance: Terminal;
  readonly fitAddon: FitAddon;
  write(data: string): void;
  focus(): void;
  blur(): void;
  fit(): void;
  resize(cols: number, rows: number): void;
  setTheme(theme: TerminalTheme): void;
  hasSelection(): boolean;
  getSelection(): string;
  selectAll(): void;
  writeln(text: string): void;
  clear(): void;
  dispose(): void;
}

const BASE_THEME = { background: '#11111100', foreground: '#d9d4c7', cursorAccent: '#111111' };
const ANSI_COLORS = { black: '#111111', red: '#ff6b57', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d9d4c7' };
const BRIGHT_ANSI_COLORS = { brightBlack: '#5a6374', brightRed: '#ff8578', brightGreen: '#b0d98b', brightYellow: '#f0d58a', brightBlue: '#7eb7ff', brightMagenta: '#d9a5e8', brightCyan: '#7fd8e6', brightWhite: '#ffffff' };

function createTerminalTheme(accent: string): TerminalTheme {
  return { ...BASE_THEME, cursor: accent, selectionBackground: `${accent}44`, ...ANSI_COLORS, ...BRIGHT_ANSI_COLORS };
}

function shouldBlockKeyEvent(e: KeyboardEvent): boolean {
  const isCtrl = e.ctrlKey && !e.metaKey && !e.altKey;
  return (
    (isCtrl && e.code === 'Tab') ||
    (isCtrl && e.shiftKey && /^[CV]$/.test(e.key)) ||
    (isCtrl && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) ||
    (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'v')
  );
}

export function createTerminalBehavior(deps: TerminalBehaviorDeps) {
  const { getFontFamily, getFontSize, getAccent, onData, onTitleChange, onSelectionChange } = deps;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;

  function open(ctx: { id: string; capability: (name: string) => unknown; emit?: (event: string, payload: unknown) => void }): TerminalCapability {
    const dom = ctx.capability<{ terminalHost: HTMLElement }>('dom');
    if (!dom?.terminalHost) throw new Error('dom capability with terminalHost is required');

    terminal = new Terminal({
      allowProposedApi: true, allowTransparency: true, convertEol: false, customGlyphs: true,
      cursorBlink: true, disableStdin: false, drawBoldTextInBrightColors: false,
      fontFamily: getFontFamily(), fontSize: getFontSize(), lineHeight: 1.2, scrollback: 5000,
      theme: createTerminalTheme(getAccent()),
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((uri, e) => {
      if (e.ctrlKey || (window.navigator.platform === 'Darwin' && e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        ctx.emit?.('openExternal', { uri });
      }
    }));
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(dom.terminalHost);
    (dom.terminalHost as { _xterm?: Terminal })._xterm = terminal;
    try { terminal.loadAddon(new WebglAddon()); } catch {}

    terminal.attachCustomKeyEventHandler((e) => !shouldBlockKeyEvent(e));
    terminal.onData(onData);
    terminal.onTitleChange((t) => onTitleChange(t.trim()));
    terminal.onSelectionChange(onSelectionChange);

    return {
      get instance() { if (!terminal) throw new Error('Terminal not initialized'); return terminal; },
      get fitAddon() { if (!fitAddon) throw new Error('FitAddon not initialized'); return fitAddon; },
      write: (d) => terminal?.write(d),
      focus: () => requestAnimationFrame(() => terminal?.focus()),
      blur: () => terminal?.blur(),
      fit: () => { if (terminal && fitAddon) { terminal.options.fontSize = getFontSize(); terminal.options.fontFamily = getFontFamily(); fitAddon.fit(); } },
      resize: (c, r) => terminal?.resize(c, r),
      setTheme: (t) => { if (terminal) terminal.options.theme = t; },
      hasSelection: () => terminal?.hasSelection() ?? false,
      getSelection: () => terminal?.getSelection() ?? '',
      selectAll: () => terminal?.selectAll(),
      writeln: (t) => terminal?.writeln(t),
      clear: () => terminal?.clear(),
      dispose: () => { terminal?.dispose(); terminal = null; fitAddon = null; },
    };
  }

  function close(): void {
    terminal?.dispose();
    terminal = null;
    fitAddon = null;
  }

  return { name: 'terminal', open, close };
}
