/**
 * Keyboard Shortcuts Registry
 *
 * Tracks user overrides on top of the keymap table (`input/keymap.ts`).
 * Overrides are stored as chord strings (e.g. `"Ctrl+Shift+C"`) — the same
 * format used by the keymap — so no format conversion is needed.
 *
 * The dispatcher reads its keymap through `getActiveKeymap()` so overrides
 * are picked up without rebinding event listeners.
 */

import { KEYMAP, parseChord, KeymapEntry } from './input/keymap';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CustomizableRow extends KeymapEntry {
  id: string;
}

// Customizable rows are those with an `id` field. Non-customizable rows
// (palette, cycle-recent, digit ranges like 1..9) live in the keymap but are
// not exposed for customization.
function customizableRows(): CustomizableRow[] {
  return KEYMAP.filter(
    (row): row is CustomizableRow =>
      typeof row.id === 'string' && !row.chord.includes('..')
  );
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const _DEFAULT_CHORDS: Record<string, string> = {};
for (const row of customizableRows()) {
  _DEFAULT_CHORDS[row.id] = row.chord;
}
const DEFAULT_CHORDS: Readonly<Record<string, string>> = _DEFAULT_CHORDS;

// ---------------------------------------------------------------------------
// Overrides & active keymap
// ---------------------------------------------------------------------------

let overrides: Record<string, string> = {};

/**
 * The active keymap, with user overrides applied. Re-computed whenever
 * overrides change so the dispatcher's parsed-chord cache invalidates.
 */
let activeKeymap: KeymapEntry[] = computeActiveKeymap();

function computeActiveKeymap(): KeymapEntry[] {
  return KEYMAP.map((row) => {
    if (!row.id) return row;
    const override = overrides[row.id];
    if (!override) return row;

    // If the override matches the current default, keep the original chord
    // to preserve multi-alternative entries (e.g. "ArrowLeft|h").
    if (override === DEFAULT_CHORDS[row.id]) return row;

    return { ...row, chord: override };
  });
}

function refreshActiveKeymap(): void {
  activeKeymap = computeActiveKeymap();
}

/**
 * Returns the active keymap (defaults + overrides). Used by the dispatcher.
 * Returns a new array reference whenever overrides change.
 */
export function getActiveKeymap(): KeymapEntry[] {
  return activeKeymap;
}

// ---------------------------------------------------------------------------
// Override management
// ---------------------------------------------------------------------------

/**
 * Set a shortcut override. `chord` is a chord string like `"Ctrl+N"`.
 * Silently ignores unknown ids.
 */
export function setShortcutOverride(id: string, chord: string): void {
  if (!(id in DEFAULT_CHORDS)) return;
  overrides[id] = chord;
  refreshActiveKeymap();
}

export function resetShortcutsToDefaults(): void {
  overrides = {};
  refreshActiveKeymap();
}

/**
 * Load overrides from persisted settings. Expects `{ id: chordString }`.
 * Skips entries that match the current default (so stale saved defaults
 * don't block keymap updates).
 *
 * For backward compatibility, also accepts the legacy `{ id: { key, modifiers } }`
 * format and converts it to chord strings on the fly.
 */
export function loadShortcutsFromSettings(settings: Record<string, unknown>): void {
  overrides = {};
  if (!settings || typeof settings.shortcuts !== 'object' || settings.shortcuts === null) {
    refreshActiveKeymap();
    return;
  }

  const map = settings.shortcuts as Record<string, unknown>;
  for (const [id, value] of Object.entries(map)) {
    if (!(id in DEFAULT_CHORDS)) continue;

    let chord: string | undefined;

    if (typeof value === 'string') {
      // New format: chord string
      chord = value;
    } else if (value && typeof value === 'object') {
      // Legacy format: { key, modifiers }
      const legacy = value as { key?: string; modifiers?: string[] };
      if (typeof legacy.key === 'string' && Array.isArray(legacy.modifiers)) {
        const tokens: string[] = [];
        if (legacy.modifiers.includes('ctrl'))  tokens.push('Ctrl');
        if (legacy.modifiers.includes('shift')) tokens.push('Shift');
        if (legacy.modifiers.includes('alt'))   tokens.push('Alt');
        const k = legacy.key.length === 1 ? legacy.key.toLowerCase() : legacy.key;
        tokens.push(k);
        chord = tokens.join('+');
      }
    }

    if (!chord) continue;

    // Skip entries that match the current default
    if (chord === DEFAULT_CHORDS[id]) continue;

    overrides[id] = chord;
  }
  refreshActiveKeymap();
}

/**
 * Returns overrides for persistence. Format: `{ id: chordString }`.
 */
export function getShortcutsForSave(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, chord] of Object.entries(overrides)) {
    out[id] = chord;
  }
  return out;
}

/**
 * Get the active chord for a given shortcut id.
 * Returns the override if set, otherwise the default from KEYMAP.
 */
export function getChordForId(id: string): string | undefined {
  return overrides[id] ?? DEFAULT_CHORDS[id];
}

/**
 * Get all customizable shortcut ids with their current (active) chords.
 */
export function getAllShortcuts(): Readonly<Record<string, { chord: string; action: string; mode?: string }>> {
  const out: Record<string, { chord: string; action: string; mode?: string }> = {};
  for (const row of customizableRows()) {
    out[row.id] = {
      chord: overrides[row.id] ?? row.chord,
      action: row.action,
      mode: row.mode,
    };
  }
  return out;
}

/**
 * Check whether a chord conflicts with any existing shortcut.
 * Returns the id of the conflicting shortcut, or null if no conflict.
 */
export function findConflict(chord: string, excludeId?: string | null): string | null {
  const [newAlt] = parseChord(chord);
  const all = getAllShortcuts();
  for (const [id, entry] of Object.entries(all)) {
    if (id === excludeId) continue;
    const [existingAlt] = parseChord(entry.chord);
    // Two chords conflict when they produce the same ParsedChord
    if (
      newAlt.key.toLowerCase() === existingAlt.key.toLowerCase() &&
      newAlt.ctrl === existingAlt.ctrl &&
      newAlt.shift === existingAlt.shift &&
      newAlt.alt === existingAlt.alt
    ) {
      return id;
    }
  }
  return null;
}
