/**
 * Hint Bar — mode-aware keyboard shortcut hints
 *
 * Displays relevant keyboard shortcuts for the current mode in the status bar.
 */

import { formatChord, parseChord } from './input/keymap.js';

const MODIFIER_SYMBOLS = new Set(['⌃', '⇧', '⌥', '⌘']);

/**
 * Format a chord as styled HTML for the hint bar.
 * Modifier symbols get wrapped in <span class="mod"> for individual styling.
 */
function formatChordHtml(chord, platform) {
  const [first] = parseChord(chord);
  const isMac = platform === 'darwin';
  const parts = [];
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
function wrapMergedKeys(keys) {
  return [...keys].map(ch =>
    MODIFIER_SYMBOLS.has(ch) ? `<span class="mod">${ch}</span>` : ch
  ).join('');
}

/**
 * Pairs of actions whose hints should be merged into a single combined hint.
 * Format: [action1, action2, mergedDisplayKeys, mergedDescription]
 */
const MERGE_GROUPS = [
  ['navigateLeft', 'navigateRight', '⌃←→', 'switch pane'],
  ['cycleRecent', 'cycleRecentReverse', '⌃Tab', 'recent'],
];

/**
 * Build a map for quick lookup of merge groups.
 */
const MERGE_MAP = new Map(
  MERGE_GROUPS.map(([a1, a2, keys, desc]) => [
    [a1, { partner: a2, keys, desc, isPrimary: true }],
    [a2, { partner: a1, keys, desc, isPrimary: false }],
  ]).flat()
);

/**
 * Render the hint bar based on current mode and settings.
 *
 * @param {Array} keymap - The keymap from ShortcutsRegistry.getActiveKeymap()
 * @param {string} currentMode - The current mode ('terminal' or 'nav')
 * @param {string} focusedPaneLabel - The label of the focused pane (for terminal mode)
 * @param {string} platform - The platform ('linux', 'darwin', 'win32')
 * @returns {object} - { modeLabel: string, hintsHtml: string }
 */
export function renderHintBar(keymap, currentMode, focusedPaneLabel, platform = 'linux') {
  // Filter keymap entries for current mode
  let entries = keymap.filter(entry =>
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
  const visible = entries.filter(entry => entry.hint);

  // Build hints HTML
  const hintsHtml = visible
    .map(entry => renderHint(entry, currentMode, platform))
    .join('<span class="hint-sep">·</span>');

  // Determine mode label
  const modeLabel = currentMode === 'nav' ? 'Navigation Mode' : (focusedPaneLabel || 'Terminal');

  return { modeLabel, hintsHtml };
}

/**
 * Apply merge transformations to keymap entries.
 * Returns a new array with merged hints replacing pairs.
 */
function applyMerges(entries) {
  const result = [];
  const mergedActions = new Set();

  for (const entry of entries) {
    if (mergedActions.has(entry.action)) continue;

    const mergeInfo = MERGE_MAP.get(entry.action);
    if (mergeInfo && mergeInfo.isPrimary) {
      // Check if partner exists
      const hasPartner = entries.some(e => e.action === mergeInfo.partner);
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
function renderHint(entry, currentMode, platform) {
  // Merged entry: use pre-formatted keys with styled modifiers
  if (entry._mergedKeys) {
    return `<span class="hint"><kbd>${wrapMergedKeys(entry._mergedKeys)}</kbd> ${entry.hint}</span>`;
  }

  // Nav mode hint: "key description" format (key already separated)
  if (currentMode === 'nav' && entry.mode === 'nav') {
    const parts = entry.hint.split(' ');
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
function mergeNavModeHints(entries) {
  const actionMap = new Map();

  for (const entry of entries) {
    if (!entry.hint) continue;

    const parts = entry.hint.split(' ');
    if (parts.length < 2) {
      if (!actionMap.has(entry.action)) {
        actionMap.set(entry.action, { ...entry, keys: [] });
      }
      continue;
    }

    const key = parts[0];
    const desc = parts.slice(1).join(' ');

    if (!actionMap.has(entry.action)) {
      actionMap.set(entry.action, { ...entry, keys: [key], description: desc });
    } else {
      const existing = actionMap.get(entry.action);
      existing.keys.push(key);
    }
  }

  // Rebuild entries with merged hints
  const merged = [];
  for (const [action, data] of actionMap) {
    if (data.keys.length > 0) {
      data.hint = `${data.keys.join('/')} ${data.description}`;
    }
    delete data.keys;
    delete data.description;
    merged.push(data);
  }

  // Keep original order (first occurrence of each action)
  const ordered = [];
  const seenActions = new Set();
  for (const entry of entries) {
    if (!entry.hint || !entry.action) continue;
    if (seenActions.has(entry.action)) continue;
    seenActions.add(entry.action);
    const mergedEntry = merged.find(e => e.action === entry.action);
    if (mergedEntry) {
      ordered.push(mergedEntry);
    }
  }

  return ordered;
}
