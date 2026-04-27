/**
 * Keydown dispatcher.
 *
 * Walks a keymap (default + user overrides) row by row. The first row whose
 * mode matches and whose chord matches the event wins, and its action is
 * invoked through the actions table.
 *
 * Filters applied in order:
 *   1. Mode — `'*'` matches everything; otherwise must equal `getMode()`.
 *   2. Palette open — when the command palette is open, only the
 *      `toggleCommandPalette` action is allowed; everything else falls through
 *      to the palette's own input field.
 *   3. Chord — see `matchesChord`.
 *   4. INPUT focus — entries flagged `skipInInput` are passed through when an
 *      `<input>` has focus, so users typing in the settings modal don't
 *      accidentally fire terminal-level shortcuts.
 *
 * `getKeymap()` is called on every dispatch so settings-driven overrides take
 * effect without rebinding the listener. Parsed-chord caching keeps that cheap.
 */

import { matchesChord, parseChord } from './keymap.js';

export function createDispatcher({
  getKeymap,
  actions,
  getMode,
  isInputFocused,
  isCommandPaletteOpen,
}) {
  let cachedKeymap = null;
  let parsedKeymap = null;
  function getParsed() {
    const km = getKeymap();
    if (km !== cachedKeymap) {
      console.log('[Dispatcher] Cache invalidated, rebuilding parsed keymap');
      console.log('[Dispatcher] Keymap entries:', km.map(e => ({ action: e.action, chord: e.chord, mode: e.mode })));
      parsedKeymap = km.map((entry) => ({
        ...entry,
        parsedChord: parseChord(entry.chord),
      }));
      cachedKeymap = km;
      console.log('[Dispatcher] Parsed keymap:', parsedKeymap.map(e => ({
        action: e.action,
        chord: e.chord,
        parsedChord: e.parsedChord
      })));
    }
    return parsedKeymap;
  }

  return function dispatch(event) {
    const mode = getMode();
    const inputFocused = isInputFocused();
    const paletteOpen = isCommandPaletteOpen();

    // Debug logging for single character keys in nav mode
    if (mode === 'nav' && event.key.length === 1) {
      console.log('[Dispatch] Nav mode key:', event.key, 'event:', {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    }

    for (const entry of getParsed()) {
      if (entry.mode !== '*' && entry.mode !== mode) continue;
      if (paletteOpen && entry.action !== 'toggleCommandPalette') continue;

      // Debug: show which nav mode entries are being checked
      if (mode === 'nav' && event.key.length === 1 && /^[hl]$/.test(event.key)) {
        console.log('[Dispatch] Checking entry:', {
          action: entry.action,
          chord: entry.chord,
          parsedChord: entry.parsedChord,
        });
      }

      if (!matchesChord(event, entry.parsedChord)) continue;
      if (inputFocused && entry.skipInInput) continue;

      const handler = actions[entry.action];
      if (!handler) continue;

      if (mode === 'nav' && event.key.length === 1) {
        console.log('[Dispatch] Matched entry:', entry.action, entry.chord);
      }

      event.preventDefault();
      if (entry.stopPropagation) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      handler();
      return;
    }

    if (mode === 'nav' && event.key.length === 1) {
      console.log('[Dispatch] No match found for key:', event.key);
    }
  };
}
