/**
 * Colors Registry Module
 *
 * Centralized palette definitions for pane accents.
 * High-saturation, high-contrast colors designed for dark terminal backgrounds.
 * Each hue appears once with alternating bright/dark values for maximum
 * visual separation between adjacent panes.
 */

/**
 * Unified palette for pane accents — used both for auto-assignment (cycles
 * through this array) and as the preset list in the color picker.
 * @type {string[]}
 */
export const PALETTE = [
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
  '#5e35b1', // deep purple
  '#27ae60', // medium green
  '#7b1fa2', // medium purple
  '#e65100', // deep orange
  '#0050a0', // dark blue
  '#2e7d32', // forest green
];

/** @type {string[]} Alias for auto-assignment (cycles through PALETTE). */
export const ACCENT_PALETTE = PALETTE;

/** @type {string[]} Alias for the color picker preset list. */
export const PRESET_PANE_COLORS = PALETTE;
