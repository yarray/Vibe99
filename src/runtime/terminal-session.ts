/**
 * Terminal Session
 *
 * Complete abstraction of a single pane's DOM + xterm + PTY lifecycle.
 * Owns the terminal widget, handles input/output events, clipboard
 * integration, OSC handlers, and shell restart.
 *
 * TerminalSession reads the corresponding Pane's current snapshot
 * but does NOT own pane data.
 *
 * @module runtime/terminal-session
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { getDefaultFontFamily } from '../settings';
import type { Bridge } from '../bridge';
import type { Pane } from '../pane-state';
import type { SettingsManager } from '../settings';
import type { TerminalTheme, Theme } from '../domain/theme';
import { getTheme, getDefaultTheme } from '../domain/theme';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Callback used by TerminalSession to notify about terminal title changes. */
export type TitleChangeCallback = (paneId: string, title: string) => void;

/** Callback used by TerminalSession to notify about cwd changes (OSC 7). */
export type CwdChangeCallback = (paneId: string, cwd: string) => void;

/** Callback used by TerminalSession for pane click events. */
export type PaneClickCallback = (paneId: string, options?: { focusTerminal?: boolean }) => void;

/** Callback used by TerminalSession for context menu events. */
export type ContextMenuCallback = (
  session: TerminalSession,
  event: MouseEvent,
) => Promise<void> | void;

/** Callback used by TerminalSession when a title change may require a tab bar refresh. */
export type TabRefreshCallback = (paneId: string) => void;

/** Activity watcher interface used by TerminalSession. */
export interface TerminalActivityWatcher {
  noteResize: (paneId: string) => void;
  noteData: (paneId: string) => void;
  forget: (paneId: string) => void;
}

/** Dependencies injected into `createTerminalSession`. */
export interface TerminalSessionDeps {
  bridge: Bridge;
  settingsManager: SettingsManager;
  activityWatcher: TerminalActivityWatcher;
  reportError: (error: unknown) => void;
  getPaneSnapshot: () => Pane | null;
  onPaneClick: PaneClickCallback;
  onTitleChange: TitleChangeCallback;
  onContextMenu: ContextMenuCallback;
  onCwdChanged: CwdChangeCallback;
  onTabRefreshNeeded: TabRefreshCallback;
  onSessionReadyChange?: (paneId: string, ready: boolean) => void;
  /** Function to create terminal theme with given accent color. */
  terminalTheme: (accent: string) => TerminalTheme;
}

/** The full public API surface returned by `createTerminalSession`. */
export interface TerminalSession {
  /** Unique pane identifier this session belongs to. */
  readonly paneId: string;

  /** Root DOM element for the pane. */
  readonly root: HTMLElement;

  /** Current working directory. */
  cwd: string;

  // -- Lifecycle -----------------------------------------------------------------

  /**
   * Finish PTY initialization after the DOM is attached.
   * Creates the PTY process via the bridge and fits the terminal.
   */
  initializePty(): Promise<void>;

  /**
   * Fully close this session: dispose xterm, remove DOM, optionally kill PTY.
   */
  close(options?: { destroyPty?: boolean }): void;

  // -- I/O -----------------------------------------------------------------------

  /** Write raw data to the terminal widget. */
  write(data: string): void;

  /** Write a line of text to the terminal widget. */
  writeLine(text: string): void;

  // -- Focus & state -------------------------------------------------------------

  /** Focus the terminal widget (via requestAnimationFrame). */
  focus(): void;

  /** Blur the terminal widget. */
  blur(): void;

  /** Clear the terminal buffer. */
  clear(): void;

  // -- Sizing --------------------------------------------------------------------

  /**
   * Fit the terminal to its container and notify the PTY of any size change.
   * Updates font settings from SettingsManager.
   */
  fit(options?: { force?: boolean }): void;

  // -- Clipboard & selection -----------------------------------------------------

  /** Copy the current selection to the clipboard. Returns false if no selection. */
  copySelection(): boolean;

  /**
   * Paste clipboard content into the terminal.
   * Accepts an optional pre-fetched clipboard snapshot to avoid re-reading.
   */
  paste(options?: { clipboardSnapshot?: { text: string; hasImage: boolean } }): Promise<boolean>;

  /**
   * Paste image from clipboard into the terminal (sends Ctrl+V escape).
   * Accepts an optional pre-fetched clipboard snapshot.
   */
  pasteImage(options?: { clipboardSnapshot?: { text: string; hasImage: boolean } }): Promise<boolean>;

  /** Select all text in the terminal. */
  selectAll(): boolean;

  /** Check if there is a text selection. */
  hasSelection(): boolean;

  // -- Shell management ----------------------------------------------------------

  /** Restart the PTY process (keeping the same shell profile). */
  restart(): void;

  /**
   * Change the shell profile and restart the PTY.
   * Reverts to the previous profile on failure.
   */
  changeShell(profileId: string, previousProfileId?: string | null): void;

  // -- Visual state --------------------------------------------------------------

  /** Update the accent color (terminal theme + CSS variable). */
  setAccent(color: string): void;

  /** Update the terminal theme. */
  setTheme(themeId: string | null): void;

  /** Toggle the alert breathing state. */
  setAlerted(alerted: boolean): void;

  // -- DOM helpers ---------------------------------------------------------------

  /** Check whether the session's root element contains the given node. */
  contains(node: Node): boolean;

  // -- State queries -------------------------------------------------------------

  /** Whether the PTY session is ready for input. */
  isReady(): boolean;

  /** Whether a shell change is currently in progress. */
  isShellChanging(): boolean;

  /** Timestamp of the most recent shell change, or null. */
  shellChangeTime(): number | null;

  /** Whether the terminal needs a refit on next render. */
  needsFit(): boolean;

  /** Set whether the terminal needs a refit. */
  setNeedsFit(needs: boolean): void;

  /** Get recent terminal output as a string. */
  getRecentOutput(maxLines?: number): string;

  /** Set the session-ready flag and notify. */
  setReady(ready: boolean): void;

  // -- Exited state --------------------------------------------------------------

  /** Whether the terminal process has exited and is showing the exited overlay. */
  isExited(): boolean;

  /**
   * Show the exited/crashed overlay on top of the terminal.
   * Preserves terminal buffer content for diagnostic purposes.
   * Idempotent — calling multiple times with different options updates the overlay.
   */
  showExitedState(options: ExitedStateOptions): void;

  /**
   * Hide the exited overlay and reset exited state.
   * Called before restarting the terminal.
   */
  hideExitedState(): void;
}

/** Options for showing the terminal exited state overlay. */
export interface ExitedStateOptions {
  /** Process exit code. */
  exitCode: number;
  /** Exit reason from the backend (e.g. "exited", "killed"). */
  reason: string;
}

/**
 * Internal interface that extends the public TerminalSession with
 * implementation details needed only within terminal-session.ts.
 *
 * This interface is NOT exported and should only be used internally
 * by the factory function.
 */
interface InternalTerminalSession extends TerminalSession {
  /** Terminal host element (contains the xterm canvas). Internal use only. */
  terminalHost: HTMLElement & { _xterm?: Terminal };

  /** Underlying xterm.js Terminal instance. Internal use only. */
  terminal: Terminal;

  /** FitAddon instance. Internal use only. */
  fitAddon: FitAddon;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPathFromOsc7(data: string): string | null {
  const prefix = 'file://';
  if (!data.startsWith(prefix)) {
    return null;
  }
  const afterPrefix = data.slice(prefix.length);
  const slashIndex = afterPrefix.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  let encodedPath = afterPrefix.slice(slashIndex);
  if (/^\/[A-Za-z]:\//.test(encodedPath)) {
    encodedPath = encodedPath.slice(1);
  }
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

function isWindowsCtrlVPasteHotkey(
  event: KeyboardEvent,
  platform: string,
): boolean {
  return (
    platform === 'win32' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'v'
  );
}

function isLinkOpenModifierPressed(
  event: MouseEvent | KeyboardEvent,
  platform: string,
): boolean {
  return event.ctrlKey || (platform === 'darwin' && event.metaKey);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a terminal session that owns the full DOM + xterm + PTY lifecycle
 * for a single pane.
 *
 * @param deps - Injected dependencies
 * @returns TerminalSession instance
 */
export function createTerminalSession(deps: TerminalSessionDeps): TerminalSession {
  const {
    bridge,
    settingsManager,
    activityWatcher,
    reportError,
    getPaneSnapshot,
    onPaneClick,
    onTitleChange,
    onContextMenu,
    onCwdChanged,
    onTabRefreshNeeded,
    terminalTheme,
  } = deps;

  const pane = getPaneSnapshot();
  const paneId = pane!.id;
  const accentColor = pane!.customColor || pane!.accent;
  let _cwd = pane!.cwd;

  // -- Internal state --
  let _sessionReady = false;
  let _sizeKey = '';
  let _needsFit = true;
  let _accent = accentColor;
  let _shellChanging = false;
  let _shellChangeTime: number | undefined;
  let _exited = false;
  let _exitOverlay: HTMLElement | null = null;

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  const paneEl = document.createElement('article');
  paneEl.className = 'pane';
  paneEl.style.setProperty('--pane-accent', accentColor);
  paneEl.addEventListener('click', () => {
    onPaneClick(paneId);
  });

  const shell = document.createElement('div');
  shell.className = 'pane-shell';

  const body = document.createElement('div');
  body.className = 'pane-body';

  const surface = document.createElement('div');
  surface.className = 'pane-surface';

  const terminalHost = document.createElement('div') as HTMLElement & { _xterm?: Terminal };
  terminalHost.className = 'terminal-host';
  surface.append(terminalHost);
  body.append(surface);
  shell.append(body);
  paneEl.append(shell);

  // ---------------------------------------------------------------------------
  // xterm setup
  // ---------------------------------------------------------------------------

  const terminal = new Terminal({
    allowProposedApi: true,
    allowTransparency: true,
    convertEol: false,
    customGlyphs: true,
    cursorBlink: true,
    disableStdin: false,
    drawBoldTextInBrightColors: false,
    fontFamily: settingsManager.settings.fontFamily || getDefaultFontFamily(bridge.platform),
    fontSize: settingsManager.settings.fontSize,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: terminalTheme(accentColor),
  });

  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon((event: MouseEvent, uri: string) => {
    if (!isLinkOpenModifierPressed(event, bridge.platform)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void Promise.resolve(bridge.openExternalUrl(uri)).catch(reportError);
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  terminal.open(terminalHost);
  terminalHost._xterm = terminal;

  if (settingsManager.settings.webglEnabled) {
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {}
  }

  // -- Custom key event handler --
  terminal.attachCustomKeyEventHandler((event) => {
    if (
      event.type === 'keydown' &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.code === 'Tab'
    ) {
      return false;
    }
    if (
      event.type === 'keydown' &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'C' || event.key === 'c' || event.key === 'V' || event.key === 'v')
    ) {
      return false;
    }
    if (
      event.type === 'keydown' &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.code === 'ArrowLeft' || event.code === 'ArrowRight')
    ) {
      return false;
    }
    if (!isWindowsCtrlVPasteHotkey(event, bridge.platform)) {
      return true;
    }
    return false;
  });

  // ---------------------------------------------------------------------------
  // xterm event handlers
  // ---------------------------------------------------------------------------

  terminalHost.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    onPaneClick(paneId, { focusTerminal: false });
    void onContextMenu(session, event);
  });

  terminal.onData((data) => {
    if (_sessionReady) {
      bridge.writeTerminal({ paneId, data });
    }
  });

  terminal.onTitleChange((nextTitle) => {
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) {
      return;
    }
    onTitleChange(paneId, trimmedTitle);
    onTabRefreshNeeded(paneId);
  });

  terminal.onSelectionChange(() => {
    const selection = terminal.getSelection();
    if (selection) {
      bridge.writeClipboardText(selection);
    }
  });

  // -- OSC 52: clipboard write --
  terminal.parser.registerOscHandler(52, (data) => {
    const semicolon = data.indexOf(';');
    if (semicolon === -1) {
      return true;
    }
    const base64Text = data.slice(semicolon + 1);
    if (!base64Text || base64Text === '?') {
      return true;
    }
    try {
      const bytes = atob(base64Text);
      const text = new TextDecoder().decode(
        Uint8Array.from(bytes, (c) => c.charCodeAt(0)),
      );
      bridge.writeClipboardText(text);
    } catch {}
    return true;
  });

  // -- OSC 7: cwd change --
  terminal.parser.registerOscHandler(7, (data) => {
    const newCwd = extractPathFromOsc7(data);
    if (newCwd) {
      _cwd = newCwd;
      onCwdChanged(paneId, newCwd);
    }
    return true;
  });

  // -- Visible activity fingerprint --
  // Only note activity if the visible buffer actually changes. This prevents
  // spurious alerts from non-visible output (e.g., escape sequences, cursor
  // movements) while still catching real content changes.
  const snapshot = (): string[] => {
    const { active: buf } = terminal.buffer;
    const y = buf.viewportY;
    return Array.from({ length: terminal.rows }, (_, i) => {
      const line = buf.getLine(y + i);
      return line ? `${line.isWrapped ? 1 : 0}:${line.translateToString(true)}` : '';
    });
  };

  let last = snapshot();

  function noteVisibleTerminalActivity(): void {
    const next = snapshot();
    if (next.length === last.length && !next.some((l, i) => l !== last[i])) return;
    last = next;
    activityWatcher.noteData(paneId);
  }

  // ---------------------------------------------------------------------------
  // Session implementation
  // ---------------------------------------------------------------------------

  function fitInternal(force = false): void {
    terminal.options.fontSize = settingsManager.settings.fontSize;
    terminal.options.fontFamily =
      settingsManager.settings.fontFamily || getDefaultFontFamily(bridge.platform);
    fitAddon.fit();

    const cols = Math.max(20, terminal.cols || 80);
    const rows = Math.max(8, terminal.rows || 24);
    const nextSizeKey = `${cols}x${rows}`;

    if (_sessionReady && nextSizeKey !== _sizeKey) {
      bridge.resizeTerminal({ paneId, cols, rows });
      activityWatcher.noteResize(paneId);
    }

    _sizeKey = nextSizeKey;
    _needsFit = false;
  }

  async function initializePty(requestedProfileId?: string | null): Promise<void> {
    fitInternal(true);
    // Use the requested profileId if provided, otherwise read from pane snapshot
    const profileId = requestedProfileId ?? getPaneSnapshot()?.shellProfileId ?? null;
    try {
      await bridge.createTerminal({
        paneId,
        cols: terminal.cols,
        rows: terminal.rows,
        cwd: _cwd,
        shellProfileId: profileId,
      });
      _sessionReady = true;
      _sizeKey = '';
      fitInternal();
      deps.onSessionReadyChange?.(paneId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminal.writeln(
        `\x1b[38;5;204mFailed to start shell${profileId ? ` "${profileId}"` : ''}: ${message}\x1b[0m`,
      );
    }
  }

  function close(options: { destroyPty?: boolean } = {}): void {
    const { destroyPty = true } = options;
    if (destroyPty) {
      activityWatcher.forget(paneId);
      bridge.destroyTerminal({ paneId });
    }
    terminal.dispose();
    paneEl.remove();
  }

  function write(data: string): void {
    terminal.write(data, noteVisibleTerminalActivity);
  }

  function writeLine(text: string): void {
    terminal.writeln(text);
  }

  function focus(): void {
    requestAnimationFrame(() => {
      terminal.focus();
    });
  }

  function blur(): void {
    terminal.blur();
  }

  function clear(): void {
    terminal.clear();
  }

  function fit(options: { force?: boolean } = {}): void {
    fitInternal(options.force);
  }

  function copySelection(): boolean {
    const selection = terminal.getSelection();
    if (!selection) {
      return false;
    }
    bridge.writeClipboardText(selection);
    return true;
  }

  async function getClipboardSnapshot(): Promise<{ text: string; hasImage: boolean }> {
    try {
      return (await bridge.getClipboardSnapshot?.()) ?? { text: '', hasImage: false };
    } catch {
      return { text: '', hasImage: false };
    }
  }

  async function paste(
    options: { clipboardSnapshot?: { text: string; hasImage: boolean } } = {},
  ): Promise<boolean> {
    if (!_sessionReady) {
      return false;
    }

    const text =
      options.clipboardSnapshot?.text ?? (await bridge.readClipboardText());
    if (!text) {
      return false;
    }

    if (bridge.platform === 'win32') {
      terminal.paste(text);
    } else {
      bridge.writeTerminal({ paneId, data: text });
    }
    return true;
  }

  async function pasteImage(
    options: { clipboardSnapshot?: { text: string; hasImage: boolean } } = {},
  ): Promise<boolean> {
    if (!_sessionReady) {
      return false;
    }

    const clipboardSnapshot =
      options.clipboardSnapshot ?? (await getClipboardSnapshot());
    if (!clipboardSnapshot.hasImage) {
      return false;
    }

    bridge.writeTerminal({ paneId, data: '\u0016' });
    return true;
  }

  function selectAll(): boolean {
    terminal.selectAll();
    return true;
  }

  function hasSelection(): boolean {
    return terminal.hasSelection();
  }

  function restart(): void {
    const currentProfileId = getPaneSnapshot()?.shellProfileId ?? null;

    _shellChanging = true;
    _shellChangeTime = Date.now();
    _sessionReady = false;
    hideExitedState();
    terminal.clear();
    initializePty(currentProfileId).finally(() => {
      _shellChanging = false;
    });
  }

  function changeShell(profileId: string, previousProfileId?: string | null): void {
    const prevProfileId =
      previousProfileId ?? getPaneSnapshot()?.shellProfileId ?? null;

    _shellChanging = true;
    _shellChangeTime = Date.now();
    _sessionReady = false;
    hideExitedState();
    terminal.clear();
    initializePty(profileId).finally(() => {
      _shellChanging = false;
      if (!_sessionReady) {
        // PTY failed to start - caller should handle state revert
        // The error message was already written to the terminal
      }
    });
  }

  function setAccent(color: string): void {
    if (_accent === color) {
      return;
    }
    _accent = color;
    paneEl.style.setProperty('--pane-accent', color);
    terminal.options.theme = terminalTheme(color);
  }

  function setTheme(themeId: string | null): void {
    const theme = themeId ? getTheme(themeId) : null;
    const themeFn = theme ? ((accent: string) => theme.terminalTheme(accent)) : terminalTheme;
    const newTheme = themeFn(_accent);

    // Check if background is transparent (alpha channel is 00)
    const bgColor = newTheme.background;
    const isTransparent = bgColor.length === 9 && bgColor.slice(7) === '00';

    // Update allowTransparency based on theme background
    // When allowTransparency is true, xterm.js ignores the theme background color
    // and renders the canvas transparently. For opaque themes, we need to set it to false.
    terminal.options.allowTransparency = isTransparent;
    terminal.options.theme = newTheme;

    // Update pane-surface background to match theme background
    const surface = paneEl.querySelector('.pane-surface') as HTMLElement | null;
    if (surface) {
      if (isTransparent) {
        // Use default surface background for transparent themes
        surface.style.background = '';
      } else {
        // Use theme background color (strip alpha if present for opacity handling)
        surface.style.background = bgColor.slice(0, 7);
      }
    }

    // Force xterm.js to re-render the entire buffer with the new theme
    terminal.refresh(0, terminal.rows);
  }

  function setAlerted(_alerted: boolean): void {
    // Alert state is managed externally via paneAlert; this is a hook.
    // The actual implementation is handled by pane-renderer because it
    // needs access to the PaneAlertStrategy.
  }

  function contains(node: Node): boolean {
    return paneEl.contains(node);
  }

  function isReady(): boolean {
    return _sessionReady;
  }

  function isShellChanging(): boolean {
    return _shellChanging;
  }

  function shellChangeTime(): number | null {
    return _shellChangeTime ?? null;
  }

  function needsFit(): boolean {
    return _needsFit;
  }

  function setNeedsFit(needs: boolean): void {
    _needsFit = needs;
  }

  function getRecentOutput(maxLines = 20): string {
    const buf = terminal.buffer.active;
    return Array.from(
      { length: Math.min(maxLines, buf.length) },
      (_, i) =>
        buf.getLine(buf.length - maxLines + i)?.translateToString(true) ?? '',
    ).join('\n');
  }

  function setReady(ready: boolean): void {
    _sessionReady = ready;
  }

  function isExited(): boolean {
    return _exited;
  }

  function showExitedState(options: ExitedStateOptions): void {
    _exited = true;
    paneEl.classList.add('is-exited');

    if (_exitOverlay) {
      _exitOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'terminal-exit-overlay';

    const card = document.createElement('div');
    card.className = 'terminal-exit-card';

    const title = document.createElement('div');
    title.className = 'terminal-exit-title';
    title.textContent = 'Terminal exited';

    const message = document.createElement('div');
    message.className = 'terminal-exit-message';
    message.textContent = `The shell or remote session ended (exit code ${options.exitCode}).`;

    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'terminal-exit-restart-btn';
    restartBtn.textContent = 'Restart Terminal';
    restartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      restart();
    });

    card.append(title, message, restartBtn);
    overlay.append(card);

    surface.append(overlay);
    _exitOverlay = overlay;
  }

  function hideExitedState(): void {
    _exited = false;
    paneEl.classList.remove('is-exited');

    if (_exitOverlay) {
      _exitOverlay.remove();
      _exitOverlay = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const session: InternalTerminalSession = {
    paneId,
    root: paneEl,
    terminalHost,
    terminal,
    fitAddon,
    get cwd() {
      return _cwd;
    },
    set cwd(value: string) {
      _cwd = value;
    },

    // Lifecycle
    initializePty,
    close,

    // I/O
    write,
    writeLine,

    // Focus & state
    focus,
    blur,
    clear,

    // Sizing
    fit,

    // Clipboard & selection
    copySelection,
    paste,
    pasteImage,
    selectAll,
    hasSelection,

    // Shell management
    restart,
    changeShell,

    // Visual state
    setAccent,
    setTheme,
    setAlerted,

    // DOM helpers
    contains,

    // State queries
    isReady,
    isShellChanging,
    shellChangeTime,
    needsFit,
    setNeedsFit,
    getRecentOutput,
    setReady,

    // Exited state
    isExited,
    showExitedState,
    hideExitedState,
  };

  return session;
}
