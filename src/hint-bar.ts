/**
 * Hint Bar — mode-aware keyboard shortcut hints
 *
 * Displays relevant keyboard shortcuts for the current mode in the status bar.
 */

import { parseChord, KeymapEntry, ParsedChord } from './input/keymap';

export interface HintBarResult {
  modeLabel: string;
  hintsHtml: string;
}

/** Keymap entry extended with merge-related metadata for hint rendering. */
interface HintEntry extends KeymapEntry {
  _mergedKeys?: string;
}

/** Internal merge info stored per action in MERGE_MAP. */
interface MergeInfo {
  partner: string;
  keys: string;
  desc: string;
  isPrimary: boolean;
}

/** Internal accumulator used when merging nav-mode hints by action. */
interface NavMergeData {
  action: string;
  hint?: string;
  mode: string;
  chord: string;
  keys: string[];
  description: string;
}

const MODIFIER_SYMBOLS = new Set<string>(['⌃', '⇧', '⌥', '⌘']);

/**
 * Format a chord as styled HTML for the hint bar.
 * Modifier symbols get wrapped in <span class="mod"> for individual styling.
 */
function formatChordHtml(chord: string, platform: string): string {
  const [first]: ParsedChord[] = parseChord(chord);
  const isMac = platform === 'darwin';
  const parts: Array<{ mod: boolean; ch: string }> = [];
  if (first.ctrl)  parts.push({ mod: true, ch: isMac ? '⌘' : '⌃' });
  if (first.shift) parts.push({ mod: true, ch: '⇧' });
  if (first.alt)   parts.push({ mod: true, ch: '⌥' });
  const key = first.key === ' ' ? 'Space' : first.key;
  parts.push({ mod: false, ch: key });
  return parts.map(p => p.mod ? `<span class="mod">${p.ch}</span>` : p.ch).join('');
}

/**
 * Wrap modifier symbols in a merged key string with <span class="mod">.
 */
function wrapMergedKeys(keys: string): string {
  return [...keys].map(ch =>
    MODIFIER_SYMBOLS.has(ch) ? `<span class="mod">${ch}</span>` : ch
  ).join('');
}

/**
 * Pairs of actions whose hints should be merged into a single combined hint.
 * Format: [action1, action2, mergedDisplayKeys, mergedDescription]
 */
const MERGE_GROUPS: Array<[string, string, string, string]> = [
  ['navigateLeft', 'navigateRight', '⌃←→', 'switch pane'],
  ['cycleRecent', 'cycleRecentReverse', '⌃Tab', 'recent'],
];

/**
 * Build a map for quick lookup of merge groups.
 */
const MERGE_MAP = new Map<string, MergeInfo>(
  MERGE_GROUPS.flatMap(([a1, a2, keys, desc]: [string, string, string, string]): Array<[string, MergeInfo]> => [
    [a1, { partner: a2, keys, desc, isPrimary: true }],
    [a2, { partner: a1, keys, desc, isPrimary: false }],
  ])
);

/**
 * Render the hint bar based on current mode and settings.
 */
export function renderHintBar(
  keymap: KeymapEntry[],
  currentMode: string,
  focusedPaneLabel: string,
  platform: string = 'linux'
): HintBarResult {
  // Filter keymap entries for current mode
  let entries: HintEntry[] = keymap.filter((entry: KeymapEntry) =>
    (entry.mode === currentMode) || (currentMode === 'terminal' && entry.mode === '*')
  );

  // Apply merge transformations for terminal mode
  if (currentMode === 'terminal') {
    entries = applyMerges(entries);
  }

  // For nav mode, merge entries with same action (e.g., 'h prev' and '← prev' → 'h/← prev')
  if (currentMode === 'nav') {
    entries = mergeNavModeHints(entries);
  }

  // Show all entries with hint text
  const visible = entries.filter((entry: HintEntry) => entry.hint);

  // Build hints HTML
  const hintsHtml = visible
    .map((entry: HintEntry) => renderHint(entry, currentMode, platform))
    .join('<span class="hint-sep">·</span>');

  // Determine mode label
  const modeLabel = currentMode === 'nav' ? 'Navigation Mode' : (focusedPaneLabel || 'Terminal');

  return { modeLabel, hintsHtml };
}

/**
 * Apply merge transformations to keymap entries.
 * Returns a new array with merged hints replacing pairs.
 */
function applyMerges(entries: HintEntry[]): HintEntry[] {
  const result: HintEntry[] = [];
  const mergedActions = new Set<string>();

  for (const entry of entries) {
    if (mergedActions.has(entry.action)) continue;

    const mergeInfo = MERGE_MAP.get(entry.action);
    if (mergeInfo && mergeInfo.isPrimary) {
      // Check if partner exists
      const hasPartner = entries.some((e: HintEntry) => e.action === mergeInfo.partner);
      if (hasPartner) {
        // Create merged entry
        result.push({
          ...entry,
          _mergedKeys: mergeInfo.keys,
          hint: mergeInfo.desc,
        });
        mergedActions.add(entry.action);
        mergedActions.add(mergeInfo.partner);
        continue;
      }
    }

    // No merge or not primary, keep original
    result.push(entry);
  }

  return result;
}

/**
 * Render a single hint as HTML.
 */
function renderHint(entry: HintEntry, currentMode: string, platform: string): string {
  // Merged entry: use pre-formatted keys with styled modifiers
  if (entry._mergedKeys) {
    return `<span class="hint"><kbd>${wrapMergedKeys(entry._mergedKeys)}</kbd> ${entry.hint}</span>`;
  }

  // Nav mode hint: "key description" format (key already separated)
  if (currentMode === 'nav' && entry.mode === 'nav') {
    const parts = entry.hint!.split(' ');
    if (parts.length >= 2) {
      const keys = parts[0];
      const desc = parts.slice(1).join(' ');
      return `<span class="hint"><kbd>${keys}</kbd> ${desc}</span>`;
    }
    return `<span class="hint">${entry.hint}</span>`;
  }

  // Default: format chord as styled HTML
  return `<span class="hint"><kbd>${formatChordHtml(entry.chord, platform)}</kbd> ${entry.hint}</span>`;
}

/**
 * Merge nav mode hints that have the same action.
 * For example, 'h prev' and '← prev' become 'h/← prev'.
 */
function mergeNavModeHints(entries: HintEntry[]): HintEntry[] {
  const actionMap = new Map<string, NavMergeData>();

  for (const entry of entries) {
    if (!entry.hint) continue;

    const parts = entry.hint.split(' ');
    if (parts.length < 2) {
      if (!actionMap.has(entry.action)) {
        actionMap.set(entry.action, { ...entry, keys: [], description: '' });
      }
      continue;
    }

    const key = parts[0];
    const desc = parts.slice(1).join(' ');

    if (!actionMap.has(entry.action)) {
      actionMap.set(entry.action, { ...entry, keys: [key], description: desc });
    } else {
      const existing = actionMap.get(entry.action)!;
      existing.keys.push(key);
    }
  }

  // Rebuild entries with merged hints
  const merged: HintEntry[] = [];
  for (const [, data] of actionMap) {
    if (data.keys.length > 0) {
      data.hint = `${data.keys.join('/')} ${data.description}`;
    }
    const { keys: _k, description: _d, ...rest } = data;
    void _k; void _d;
    merged.push(rest);
  }

  // Keep original order (first occurrence of each action)
  const ordered: HintEntry[] = [];
  const seenActions = new Set<string>();
  for (const entry of entries) {
    if (!entry.hint || !entry.action) continue;
    if (seenActions.has(entry.action)) continue;
    seenActions.add(entry.action);
    const mergedEntry = merged.find((e: HintEntry) => e.action === entry.action);
    if (mergedEntry) {
      ordered.push(mergedEntry);
    }
  }

  return ordered;
}
