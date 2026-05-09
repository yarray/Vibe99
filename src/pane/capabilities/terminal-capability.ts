import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { PaneCapability, PaneContext } from '../types';
import { getDefaultFontFamily } from '../../settings';

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalBehaviorDeps {
  getTerminalHost: () => HTMLElement;
  platform: string;
  fontFamily: string;
  fontSize: number;
  onLinkActivate: (event: MouseEvent, uri: string) => void;
}

export interface TerminalCapabilityApi {
  readonly instance: Terminal;
  readonly fitAddon: FitAddon;
  write(data: string): void;
  focus(): void;
  blur(): void;
  fit(): void;
  resize(cols: number, rows: number): void;
  setTheme(accent: string): void;
  hasSelection(): boolean;
  getSelection(): string;
  selectAll(): void;
  writeln(text: string): void;
  clear(): void;
  dispose(): void;
}

function createTerminalTheme(accent: string): TerminalTheme {
  return {
    background: '#11111100', foreground: '#d9d4c7', cursor: accent, cursorAccent: '#111111',
    selectionBackground: `${accent}44`, black: '#111111', red: '#ff6b57', green: '#98c379',
    yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d9d4c7',
    brightBlack: '#5a6374', brightRed: '#ff8578', brightGreen: '#b0d98b', brightYellow: '#f0d58a',
    brightBlue: '#7eb7ff', brightMagenta: '#d9a5e8', brightCyan: '#7fd8e6', brightWhite: '#ffffff',
  };
}

function createTerminalOptions(fontFamily: string, fontSize: number, accent: string, platform: string): Terminal {
  return new Terminal({
    allowProposedApi: true, allowTransparency: true, convertEol: false, customGlyphs: true,
    cursorBlink: true, disableStdin: false, drawBoldTextInBrightColors: false,
    fontFamily: fontFamily || getDefaultFontFamily(platform), fontSize, lineHeight: 1.2,
    scrollback: 5000, theme: createTerminalTheme(accent),
  });
}

export function createTerminalApi(deps: TerminalBehaviorDeps, ctx: PaneContext, accent: string): TerminalCapabilityApi {
  const terminalHost = deps.getTerminalHost();
  const instance = createTerminalOptions(deps.fontFamily, deps.fontSize, accent, deps.platform);
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon(deps.onLinkActivate);

  instance.loadAddon(fitAddon);
  instance.loadAddon(webLinksAddon);
  instance.loadAddon(new Unicode11Addon());
  instance.unicode.activeVersion = '11';
  instance.open(terminalHost);

  try { instance.loadAddon(new WebglAddon()); } catch { /* WebGL not supported */ }

  instance.onData((data: string) => ctx.emit('terminalInput', data));
  instance.onTitleChange((title: string) => { const trimmed = title.trim(); if (trimmed) ctx.emit('titleChanged', trimmed); });
  instance.onSelectionChange(() => ctx.emit('selectionChanged'));

  return {
    instance, fitAddon,
    write: (data: string) => instance.write(data),
    focus: () => instance.focus(),
    blur: () => instance.blur(),
    fit: () => fitAddon.fit(),
    resize: (cols: number, rows: number) => instance.resize(cols, rows),
    setTheme: (nextAccent: string) => { instance.options.theme = createTerminalTheme(nextAccent); },
    hasSelection: () => instance.hasSelection(),
    getSelection: () => instance.getSelection(),
    selectAll: () => instance.selectAll(),
    writeln: (text: string) => instance.writeln(text),
    clear: () => instance.clear(),
    dispose: () => instance.dispose(),
  };
}

export function createTerminalBehavior(deps: TerminalBehaviorDeps): PaneCapability<TerminalCapabilityApi> {
  return {
    name: 'terminal',
    open(ctx: PaneContext): TerminalCapabilityApi {
      const accent = ctx.getState('customColor') || ctx.getState('accent') || '';
      return createTerminalApi(deps, ctx, accent);
    },
    close(_ctx: PaneContext, api: TerminalCapabilityApi): void {
      api.dispose();
    },
  };
}
