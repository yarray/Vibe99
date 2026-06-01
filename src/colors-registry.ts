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
 *
 * Color groups (organized by hue for better UX):
 * - Purples: violet, lavender
 * - Reds: pink, magenta (use sparingly for alerts)
 * - Oranges: orange, amber
 * - Blues: sky, royal
 * - Warm: coral
 * - Greens: mint, emerald
 * - Neutrals: gray, sage
 * - Yellow: gold
 */
export const PRESET_PANE_COLORS: ColorPalette = [
  // Purples
  '#9b5de5', '#a29bfe',
  // Reds/Pinks (kept for legacy, but positioned after cooler colors)
  '#ef476f', '#C71585',
  // Oranges/Yellows
  '#fdab0f', '#e6b100', '#fdcb6e', '#e65100',
  // Blues/Cyans
  '#5cc8ff', '#00bcd4', '#0097a7', '#0050a0',
  // Warm tones
  '#e17055',
  // Greens
  '#55efc4', '#2e7d32', '#7bd389', '#00c853',
  // Neutrals
  '#636e72', '#b2bec3',
  // White (for clean, minimalist alert look)
  '#ffffff',
] as const;

/**
 * Default accent palette for newly created panes.
 */
export const ACCENT_PALETTE: ColorPalette = PRESET_PANE_COLORS;
