/**
 * Built-in Theme Presets
 *
 * Loads and registers the built-in theme JSON files.
 * Call {@link loadBuiltinThemes} during app initialization to make all
 * built-in presets available.
 *
 * @module domain/theme-presets
 */

import { parseTheme, registerTheme, replaceTheme, hasTheme } from './theme';
import redTintData from '../themes/red-tint.json';
import blueTintData from '../themes/blue-tint.json';
import greenTintData from '../themes/green-tint.json';
import defaultDarkData from '../themes/default-dark.json';

/** Built-in theme JSON data in registration order. */
const builtinThemes = [
  defaultDarkData,
  redTintData,
  blueTintData,
  greenTintData,
];

/**
 * Load and register all built-in themes.
 *
 * Replaces the already-registered `default-dark` theme (loaded at module
 * init in theme.ts) with the JSON file version, and registers the tinted
 * variants (red-tint, blue-tint, green-tint).
 *
 * Safe to call multiple times — subsequent calls are no-ops for themes
 * that are already registered.
 */
export function loadBuiltinThemes(): void {
  for (const data of builtinThemes) {
    const theme = parseTheme(data);
    if (hasTheme(theme.id)) {
      replaceTheme(theme);
    } else {
      registerTheme(theme);
    }
  }
}
