/**
 * Keydown dispatcher.
 *
 * Walks a keymap (default + user overrides) row by row. The first row whose
 * mode matches and whose chord matches the event wins, and its action is
 * invoked through the actions table.
 *
 * Filters applied in order:
 *   1. IME composition — events flagged as part of an IME composition
 *      (`isComposing`, `keyCode === 229`, or `key === 'Process'`) are
 *      dropped entirely: firing a shortcut on them would both swallow the
 *      composition and duplicate input on WebKitGTK.
 *   2. Mode — `'*'` matches everything; otherwise must equal `getMode()`.
 *   3. Palette open — when the command palette is open, only the
 *      `toggleCommandPalette` action is allowed; everything else falls through
 *      to the palette's own input field.
 *   4. Chord — see `matchesChord`.
 *   5. INPUT focus — entries flagged `skipInInput` are passed through when an
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
      parsedKeymap = km.map((entry) => ({
        ...entry,
        parsedChord: parseChord(entry.chord),
      }));
      cachedKeymap = km;
    }
    return parsedKeymap;
  }

  // Check if a keyboard event is part of an IME composition sequence. IME
  // events must be filtered out to avoid interfering with composition in
  // xterm.js's hidden textarea and accumulating duplicate input on WebKitGTK.
  function isImeEvent(event) {
    return event.isComposing === true || event.keyCode === 229 || event.key === 'Process';
  }

  return function dispatch(event) {
    if (isImeEvent(event)) {
      return;
    }

    const mode = getMode();
    const inputFocused = isInputFocused();
    const paletteOpen = isCommandPaletteOpen();

    for (const entry of getParsed()) {
      if (entry.mode !== '*' && entry.mode !== mode) continue;
      if (paletteOpen && entry.action !== 'toggleCommandPalette') continue;
      if (!matchesChord(event, entry.parsedChord)) continue;
      if (inputFocused && entry.skipInInput) continue;

      const handler = actions[entry.action];
      if (!handler) continue;

      event.preventDefault();
      if (entry.stopPropagation) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      handler(event);
      return;
    }
  };
}
