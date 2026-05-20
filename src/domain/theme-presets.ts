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
import defaultDarkData from '../themes/default-dark.json';
import lightTintData from '../themes/light-tint.json';
import solarizedDarkData from '../themes/solarized-dark.json';
import solarizedLightData from '../themes/solarized-light.json';
import draculaData from '../themes/dracula.json';
import catppuccinMochaData from '../themes/catppuccin-mocha.json';
import atomOneLightData from '../themes/atom-one-light.json';
import githubLightData from '../themes/github-light.json';

/** Built-in theme JSON data in registration order. */
const builtinThemes = [
  defaultDarkData,
  lightTintData,
  solarizedDarkData,
  solarizedLightData,
  draculaData,
  catppuccinMochaData,
  atomOneLightData,
  githubLightData,
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
