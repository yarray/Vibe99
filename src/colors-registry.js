/**
 * Colors Registry Module
 *
 * Centralized palette definitions for pane accents.
 * High-saturation, high-contrast colors designed for dark terminal backgrounds.
 * Each hue appears once with alternating bright/dark values for maximum
 * visual separation between adjacent panes.
 */

/**
 * Default accent palette for newly created panes.
 * @type {string[]}
 */
export const ACCENT_PALETTE = [
  '#00a8e8', // vivid sky blue
  '#e84393', // hot pink
  '#fdab0f', // bright gold
  '#00cec9', // bright teal
  '#e17055', // coral red
  '#a29bfe', // lavender
  '#55efc4', // mint green
  '#d63031', // vivid red
  '#fdcb6e', // lemon yellow
  '#636e72', // cool gray
];

/**
 * Preset colors for the pane color picker (VIB-10).
 * Uses the same high-contrast palette as ACCENT_PALETTE.
 * @type {string[]}
 */
export const PRESET_PANE_COLORS = [
  '#00a8e8', '#e84393', '#fdab0f', '#00cec9',
  '#e17055', '#a29bfe', '#55efc4', '#d63031',
  '#fdcb6e', '#636e72', '#0984e3', '#ff7675',
  '#b2bec3', '#74b9ff', '#55a3ff', '#dfe6e9',
];
