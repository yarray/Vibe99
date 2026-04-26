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
  const entries = keymap.filter(entry =>
    (entry.mode === currentMode) || (currentMode === 'terminal' && entry.mode === '*')
  );

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
        const chord = formatChordForHint(entry.chord, platform);
        return `<span class="hint"><kbd>${chord}</kbd> ${entry.hint}</span>`;
      })
      .join('<span class="hint-sep">·</span>');
  }

  // Determine mode label
  let modeLabel;
  if (currentMode === 'nav') {
    modeLabel = 'NAV';
  } else {
    modeLabel = focusedPaneLabel || 'Terminal';
  }

  return { modeLabel, hintsHtml };
}

/**
 * Format a chord string for display in the hint bar.
 * Uses the first alternative if there are multiple.
 */
function formatChordForHint(chord, platform) {
  const [firstAlt] = chord.split('|');
  const parts = firstAlt.split('+').map(p => p.trim());

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
  } else if (key.length === 1) {
    displayKey = key.toUpperCase();
  }

  return [...modSymbols, displayKey].join(isMac ? '' : '+');
}
