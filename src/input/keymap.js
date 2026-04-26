/**
 * Keymap — declarative single source of truth for keyboard shortcuts.
 *
 * Each entry is a triple of:
 *   - mode   The mode the chord is active in. `'*'` matches every mode;
 *            other values match only when `getMode()` returns the same string.
 *   - chord  A human-readable key combination. Multiple alternative chords for
 *            the same action are joined by `|` (e.g. `'ArrowLeft|h'`).
 *   - action The string name handed to the actions table at dispatch time.
 *            Actions live in `actions.js` and never look at key state — the
 *            keymap is the only thing that knows about keys.
 *
 * Optional flags:
 *   - hint            One-line description used by future surfaces (status bar,
 *                     command palette, settings UI). Static at the row level.
 *   - skipInInput     When true, the chord is ignored while focus is in an
 *                     `<input>` (so typing in the settings dialog doesn't fire
 *                     terminal shortcuts).
 *   - stopPropagation When true, the dispatcher calls `event.stopPropagation()`
 *                     in addition to `preventDefault()`. Needed for chords that
 *                     would otherwise reach xterm (Tab) or the palette overlay.
 *
 * The order of rows is the priority order: first match wins.
 */

export const KEYMAP = [
  // Global
  { mode: '*',   chord: 'Ctrl+Shift+O',    action: 'toggleCommandPalette',  hint: 'palette',          stopPropagation: true },
  { mode: '*',   chord: 'Ctrl+Tab',        action: 'cycleRecent',           hint: 'recent',           skipInInput: true, stopPropagation: true },
  { mode: '*',   chord: 'Ctrl+Shift+Tab',  action: 'cycleRecentReverse',    hint: 'recent (rev)',     skipInInput: true, stopPropagation: true },
  { id: 'navigation-mode', mode: '*',   chord: 'Ctrl+B',          action: 'enterNav',              hint: 'navigate',         skipInInput: true, stopPropagation: true },
  { id: 'new-tab',         mode: '*',   chord: 'Ctrl+N',          action: 'newPane',               hint: 'new pane' },
  { id: 'navigate-left',   mode: '*',   chord: 'Ctrl+ArrowLeft',  action: 'navigateLeft',          hint: '← pane' },
  { id: 'navigate-right',  mode: '*',   chord: 'Ctrl+ArrowRight', action: 'navigateRight',         hint: '→ pane' },
  { id: 'copy',            mode: '*',   chord: 'Ctrl+Shift+C',    action: 'copyTerminalSelection', hint: 'copy',             skipInInput: true },
  { id: 'paste',           mode: '*',   chord: 'Ctrl+Shift+V',    action: 'pasteIntoTerminal',     hint: 'paste',            skipInInput: true },

  // Navigation mode
  { id: 'move-left',       mode: 'nav', chord: 'ArrowLeft|h',     action: 'focusPrev',             hint: '←/h prev',       stopPropagation: true },
  { id: 'move-right',      mode: 'nav', chord: 'ArrowRight|l',    action: 'focusNext',             hint: '→/l next',       stopPropagation: true },
  { id: 'focus-terminal',  mode: 'nav', chord: 'Enter',           action: 'commitFocus',           hint: '↵ focus',        stopPropagation: true },
  { mode: 'nav', chord: 'Escape', action: 'cancelNav', hint: 'esc cancel', stopPropagation: true },
];

// ---------------------------------------------------------------------------
// Chord parsing
//
// A chord like "Ctrl+Shift+C" is split into one or more *alternatives* (joined
// by `|`) and each alternative is split on `+`. The last token is the key,
// the rest are modifiers. We treat `Cmd`/`Meta` as `Ctrl` so a chord written
// `Ctrl+B` fires for both `Ctrl+B` on Linux/Windows and `Cmd+B` on macOS —
// matching the legacy behavior of `shortcuts-registry.js`.
// ---------------------------------------------------------------------------

const MOD_TOKENS = new Set(['ctrl', 'cmd', 'meta', 'shift', 'alt', 'option']);

/**
 * Parse a chord string into an array of alternatives.
 * @param {string} chord
 * @returns {Array<{key: string, ctrl: boolean, shift: boolean, alt: boolean}>}
 */
export function parseChord(chord) {
  return chord.split('|').map(parseChordAlt);
}

function parseChordAlt(alt) {
  const tokens = alt.trim().split('+').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`Empty chord alternative: ${alt}`);
  }
  const key = tokens[tokens.length - 1];
  const mods = tokens.slice(0, -1).map((t) => t.toLowerCase());
  for (const m of mods) {
    if (!MOD_TOKENS.has(m)) {
      throw new Error(`Unknown modifier "${m}" in chord ${alt}`);
    }
  }
  return {
    key,
    ctrl: mods.includes('ctrl') || mods.includes('cmd') || mods.includes('meta'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt') || mods.includes('option'),
  };
}

/**
 * Whether a keyboard event matches any of the parsed chord alternatives.
 *
 * Tab is matched on `event.code` so the binding is keyboard-layout-agnostic,
 * and auto-repeats are dropped (one press = one step). Single-character keys
 * are compared case-insensitively so chord `Ctrl+Shift+C` fires regardless of
 * whether Shift causes the browser to deliver `c` or `C`.
 */
export function matchesChord(event, parsedAlts) {
  for (const alt of parsedAlts) {
    if (matchesChordAlt(event, alt)) return true;
  }
  return false;
}

function matchesChordAlt(event, alt) {
  if (alt.key === 'Tab') {
    if (event.code !== 'Tab') return false;
    if (event.repeat) return false;
  } else {
    if (normalizeKey(event.key) !== normalizeKey(alt.key)) return false;
  }
  const ctrlHeld = Boolean(event.ctrlKey || event.metaKey);
  if (alt.ctrl !== ctrlHeld) return false;
  if (alt.shift !== Boolean(event.shiftKey)) return false;
  if (alt.alt !== Boolean(event.altKey)) return false;
  return true;
}

function normalizeKey(key) {
  if (typeof key !== 'string') return key;
  return key.length === 1 ? key.toLowerCase() : key;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format a chord for display in UI (settings modal, status bar).
 * For multi-alternative chords, only the first alternative is shown.
 */
export function formatChord(chord, platform = 'linux') {
  const [first] = parseChord(chord);
  const isMac = platform === 'darwin';
  const parts = [];
  if (first.ctrl)  parts.push(isMac ? '⌘' : 'Ctrl');
  if (first.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (first.alt)   parts.push(isMac ? '⌥' : 'Alt');
  parts.push(formatKeyForDisplay(first.key));
  return parts.join(isMac ? '' : '+');
}

function formatKeyForDisplay(key) {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}
