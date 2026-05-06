/**
 * Colors Registry Module
 *
 * Centralized palette definitions for pane accents.
 * High-saturation, high-contrast colors designed for dark terminal backgrounds.
 * Each hue appears once with alternating bright/dark values for maximum
 * visual separation between adjacent panes.
 */

/** A hex color string (e.g. '#9b5de5'). */
export type HexColor = string;

/** Read-only tuple of preset color hex strings. */
export type ColorPalette = readonly HexColor[];

/**
 * Preset colors for the pane color picker (VIB-10).
 * Uses the same high-contrast palette as ACCENT_PALETTE.
 */
export const PRESET_PANE_COLORS: ColorPalette = [
  '#9b5de5', '#ef476f', '#fdab0f', '#5cc8ff',
  '#e17055', '#a29bfe', '#55efc4', '#C71585',
  '#fdcb6e', '#636e72', '#2e7d32', '#e65100',
  '#b2bec3', '#e6b100', '#7bd389', '#0050a0',
] as const;

/**
 * Default accent palette for newly created panes.
 */
export const ACCENT_PALETTE: ColorPalette = PRESET_PANE_COLORS;
