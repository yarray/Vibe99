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

import { matchesChord, parseChord, KeymapEntry, ParsedChord } from './keymap';
import { ActionsTable } from './actions';

interface ParsedKeymapEntry extends KeymapEntry {
  parsedChord: ParsedChord[];
}

export interface DispatcherDeps {
  getKeymap: () => KeymapEntry[];
  actions: ActionsTable;
  getMode: () => string;
  isInputFocused: () => boolean;
  isCommandPaletteOpen: () => boolean;
}

export type DispatchFn = (event: KeyboardEvent) => void;

export function createDispatcher({
  getKeymap,
  actions,
  getMode,
  isInputFocused,
  isCommandPaletteOpen,
}: DispatcherDeps): DispatchFn {
  let cachedKeymap: KeymapEntry[] | null = null;
  let parsedKeymap: ParsedKeymapEntry[] | null = null;
  function getParsed(): ParsedKeymapEntry[] {
    const km = getKeymap();
    if (km !== cachedKeymap) {
      parsedKeymap = km.map((entry: KeymapEntry): ParsedKeymapEntry => ({
        ...entry,
        parsedChord: parseChord(entry.chord),
      }));
      cachedKeymap = km;
    }
    return parsedKeymap!;
  }

  /**
   * Check if a keyboard event is part of an IME composition sequence.
   * IME events must be filtered out to avoid:
   * - Interfering with composition in xterm.js's hidden textarea
   * - Accumulating duplicate input on WebkitGTK (Linux/Tauri)
   *
   * See: VIB-362
   */
  function isImeEvent(event: KeyboardEvent): boolean {
    return (
      event.isComposing === true ||
      event.keyCode === 229 ||
      event.key === 'Process'
    );
  }

  return function dispatch(event: KeyboardEvent): void {
    // Skip IME composition events entirely
    if (isImeEvent(event)) {
      return;
    }

    const mode = getMode();
    const inputFocused = isInputFocused();
    const paletteOpen = isCommandPaletteOpen();

    for (const entry of getParsed()) {
      if (entry.mode !== '*' && entry.mode !== mode) continue;
      if (paletteOpen && entry.action !== 'toggleCommandPalette' && entry.action !== 'toggleCommandList') continue;
      if (!matchesChord(event, entry.parsedChord)) continue;
      if (inputFocused && entry.skipInInput) continue;

      const handler = actions[entry.action as keyof ActionsTable];
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
