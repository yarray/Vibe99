/**
 * Hint Bar — mode-aware keyboard shortcut hints
 *
 * Displays relevant keyboard shortcuts for the current mode in the status bar.
 */

/**
 * Render the hint bar based on current mode and settings.
 *
 * @param {Array} keymap - The keymap from ShortcutsRegistry.getActiveKeymap()
 * @param {string} currentMode - The current mode ('terminal' or 'nav')
 * @param {string} focusedPaneLabel - The label of the focused pane (for terminal mode)
 * @param {boolean} isMinimal - Whether to show minimal hints (compact mode)
 * @param {string} platform - The platform ('linux', 'darwin', 'win32')
 * @returns {object} - { modeLabel: string, hintsHtml: string }
 */
export function renderHintBar(keymap, currentMode, focusedPaneLabel, isMinimal = false, platform = 'linux') {
  // Filter keymap entries for current mode
  let entries = keymap.filter(entry =>
    (entry.mode === currentMode) || (currentMode === 'terminal' && entry.mode === '*')
  );

  // Special handling: merge Ctrl+Tab and Ctrl+Shift+Tab hints
  if (currentMode === 'terminal') {
    const hasCycleRecent = entries.some(e => e.action === 'cycleRecent');
    const hasCycleRecentReverse = entries.some(e => e.action === 'cycleRecentReverse');
    if (hasCycleRecent && hasCycleRecentReverse) {
      entries = entries.filter(e => e.action !== 'cycleRecentReverse');
      const cycleEntry = entries.find(e => e.action === 'cycleRecent');
      if (cycleEntry) {
        cycleEntry.hint = 'Ctrl+Tab recent';
      }
    }
  }

  // For nav mode, prioritize VIB-33 hints and remove redundant ones
  if (currentMode === 'nav') {
    // Remove redundant h/l hints (have arrow equivalents)
    entries = entries.filter(e => e.action !== 'focusPrev' || !e.id?.startsWith('nav-'));
    entries = entries.filter(e => e.action !== 'focusNext' || !e.id?.startsWith('nav-'));

    // Prioritize: keep only entries with hints, then take first 6
    const priorityOrder = ['cancelNav', 'commitFocus', 'jumpTo', 'newPane', 'closePane', 'renamePane', 'showKeymapHelp', 'focusFirst', 'focusLast'];
    entries.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a.action);
      const bIndex = priorityOrder.indexOf(b.action);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
  }

  // Show at most 6 items; only show entries with hint text
  const visible = entries.filter(entry => entry.hint).slice(0, 6);

  // Build hints HTML
  let hintsHtml = '';
  if (isMinimal) {
    // Minimal mode: just show mode name and "?"
    hintsHtml = '<span class="hint-minimal">?</span>';
  } else {
    // Normal mode: show all hints
    hintsHtml = visible
      .map(entry => {
        // For nav mode, wrap in kbd for emphasis
        if (currentMode === 'nav' && entry.mode === 'nav') {
          return `<span class="hint"><kbd>${entry.hint}</kbd></span>`;
        }
        const chord = formatChordForHint(entry.chord, platform);
        return `<span class="hint"><kbd>${chord}</kbd> ${entry.hint}</span>`;
      })
      .join('<span class="hint-sep">·</span>');
  }

  // Determine mode label
  let modeLabel;
  if (currentMode === 'nav') {
    modeLabel = 'Navigation Mode';
  } else {
    modeLabel = focusedPaneLabel || 'Terminal';
  }

  return { modeLabel, hintsHtml };
}

/**
 * Format a chord string for display in the hint bar.
 * Uses the first alternative if there are multiple.
 * Prefers single characters over arrow key names.
 */
function formatChordForHint(chord, platform) {
  // Handle special chord patterns: '1..9' displays as '1-9'
  if (chord === '1..9') {
    return '1-9';
  }

  const alternatives = chord.split('|');

  // Prefer single character alternatives (like 'h', 'l') over arrow keys (like 'ArrowLeft')
  const singleCharAlt = alternatives.find(alt => {
    const parts = alt.trim().split('+');
    const key = parts[parts.length - 1].trim();
    return key.length === 1 && /^[a-zA-Z]$/.test(key);
  });

  const altToFormat = singleCharAlt || alternatives[0];
  const parts = altToFormat.split('+').map(p => p.trim());

  // Extract modifiers and key
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map(m => m.toLowerCase());

  const isMac = platform === 'darwin';
  const modSymbols = [];

  if (modifiers.includes('ctrl') || modifiers.includes('cmd') || modifiers.includes('meta')) {
    modSymbols.push(isMac ? '⌘' : 'Ctrl');
  }
  if (modifiers.includes('shift')) {
    modSymbols.push(isMac ? '⇧' : 'Shift');
  }
  if (modifiers.includes('alt') || modifiers.includes('option')) {
    modSymbols.push(isMac ? '⌥' : 'Alt');
  }

  // Format key for display
  let displayKey = key;
  if (key === ' ') {
    displayKey = 'Space';
  } else if (key === 'Home') {
    displayKey = 'Home';
  } else if (key === 'End') {
    displayKey = 'End';
  } else if (key === '?') {
    displayKey = '?';
  } else if (key.length === 1) {
    displayKey = key.toUpperCase();
  }

  return [...modSymbols, displayKey].join(isMac ? '' : '+');
}
