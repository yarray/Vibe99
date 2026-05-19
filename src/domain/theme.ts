/**
 * Theme Domain Contract
 *
 * Defines the theme abstraction for CSS tokens, terminal colors, and animations.
 * Supports loading from Windows Terminal color scheme JSON files with optional
 * vibe99 extension block.
 *
 * @module domain/theme
 */

import defaultDarkData from '../themes/default-dark.json';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Terminal color theme compatible with xterm.js ITerminalTheme.
 */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Theme contract for CSS tokens, terminal colors, and animation tokens.
 * Provides a single source of truth for visual styling.
 */
export interface Theme {
  /** Unique theme identifier. */
  id: string;

  /** Human-readable theme name. */
  name: string;

  /**
   * CSS custom properties for this theme.
   * Key is the CSS variable name (without '--'), value is the CSS value.
   */
  cssTokens(): Record<string, string>;

  /**
   * Terminal color theme with the given accent color.
   * @param accent - Optional accent color (hex string) for cursor and highlights.
   *   If omitted, uses the theme's default cursor color.
   */
  terminalTheme(accent?: string): TerminalTheme;

  /**
   * Animation-related CSS custom properties.
   * Key is the CSS variable name (without '--'), value is the CSS value.
   */
  animationTokens(): Record<string, string>;

  /**
   * Theme classification tags for UI grouping.
   * Optional — themes without tags are shown in a "Custom" group.
   */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Theme file format (Windows Terminal color scheme + vibe99 extension)
// ---------------------------------------------------------------------------

/** vibe99 extension block in a theme JSON file. */
interface Vibe99Extension {
  id: string;
  tags?: string[];
  cssTokens?: Record<string, string>;
  animationTokens?: Record<string, string>;
}

/** Raw theme data as read from a JSON file (Windows Terminal scheme compatible). */
interface ThemeFileData {
  name: string;
  background: string;
  foreground: string;
  cursorColor?: string;
  selectionBackground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  purple: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightPurple: string;
  brightCyan: string;
  brightWhite: string;
  vibe99?: Vibe99Extension;
}

// ---------------------------------------------------------------------------
// Default tokens
// ---------------------------------------------------------------------------

const defaultCssTokens: Record<string, string> = {
  'pane-opacity': '0.8',
  'pane-bg-mask-opacity': '0.75',
  'pane-width': '720px',
};

const defaultAnimationTokens: Record<string, string> = {
  'breathing-glow': 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)',
  'breathing-intense': 'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)',
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Required color keys in a Windows Terminal scheme file. */
const requiredColorKeys: (keyof ThemeFileData)[] = [
  'name',
  'background',
  'foreground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'purple',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightPurple',
  'brightCyan',
  'brightWhite',
];

/**
 * Validate that the parsed data has all required fields.
 */
function validateThemeData(data: Record<string, unknown>): void {
  for (const key of requiredColorKeys) {
    if (typeof data[key] !== 'string') {
      throw new Error(`Theme data missing required field: ${key}`);
    }
  }
}

/**
 * Derive a cursorAccent color from the background color.
 * Uses the background without alpha channel, or falls back to black.
 */
function deriveCursorAccent(background: string): string {
  if (background.length >= 7 && background.startsWith('#')) {
    return background.slice(0, 7);
  }
  return '#000000';
}

/**
 * Convert a human-readable name to a kebab-case identifier.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse a raw theme JSON object into a Theme instance.
 *
 * Accepts Windows Terminal color scheme JSON with an optional `vibe99`
 * extension block. Fields are mapped directly to xterm.js TerminalTheme
 * (purple → magenta, cursorColor → cursor).
 *
 * @param data - Parsed JSON object from a theme file.
 * @returns A Theme instance.
 * @throws Error if required fields are missing or data is malformed.
 */
export function parseTheme(data: unknown): Theme {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Theme data must be an object');
  }

  const record = data as Record<string, unknown>;
  validateThemeData(record);

  // After validation we know all required string fields exist.
  const fileData = record as unknown as ThemeFileData;

  const vibe99 = fileData.vibe99;

  const id = vibe99?.id ?? slugify(fileData.name);
  const cssTokens = vibe99?.cssTokens ?? { ...defaultCssTokens };
  const animationTokens = vibe99?.animationTokens ?? { ...defaultAnimationTokens };
  const tags = vibe99?.tags;

  const cursorColor = fileData.cursorColor ?? fileData.foreground;
  const selectionBg = fileData.selectionBackground ?? `${cursorColor}44`;

  return {
    id,
    name: fileData.name,
    tags,

    cssTokens(): Record<string, string> {
      return { ...cssTokens };
    },

    terminalTheme(accent?: string): TerminalTheme {
      const cursor = accent ?? cursorColor;
      const selectionBackground = accent ? `${accent}44` : selectionBg;
      return {
        background: fileData.background,
        foreground: fileData.foreground,
        cursor,
        cursorAccent: deriveCursorAccent(fileData.background),
        selectionBackground,
        black: fileData.black,
        red: fileData.red,
        green: fileData.green,
        yellow: fileData.yellow,
        blue: fileData.blue,
        magenta: fileData.purple,
        cyan: fileData.cyan,
        white: fileData.white,
        brightBlack: fileData.brightBlack,
        brightRed: fileData.brightRed,
        brightGreen: fileData.brightGreen,
        brightYellow: fileData.brightYellow,
        brightBlue: fileData.brightBlue,
        brightMagenta: fileData.brightPurple,
        brightCyan: fileData.brightCyan,
        brightWhite: fileData.brightWhite,
      };
    },

    animationTokens(): Record<string, string> {
      return { ...animationTokens };
    },
  };
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

/**
 * Load a theme from a JSON file via fetch.
 *
 * @param path - URL or path to the theme JSON file.
 * @returns A Promise resolving to the loaded Theme.
 * @throws Error if the fetch fails or the data is invalid.
 */
export async function loadThemeFromFile(path: string): Promise<Theme> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load theme from ${path}: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return parseTheme(data);
}

// ---------------------------------------------------------------------------
// Theme Registry
// ---------------------------------------------------------------------------

const themes = new Map<string, Theme>();

/**
 * Register a theme in the global registry.
 * @throws Error if a theme with the same id already exists.
 */
export function registerTheme(theme: Theme): void {
  if (themes.has(theme.id)) {
    throw new Error(`Theme with id "${theme.id}" is already registered.`);
  }
  themes.set(theme.id, theme);
}

/**
 * Replace a theme in the global registry.
 * @returns The previous theme, or undefined if none existed.
 */
export function replaceTheme(theme: Theme): Theme | undefined {
  const previous = themes.get(theme.id);
  themes.set(theme.id, theme);
  return previous;
}

/**
 * Check whether a theme with the given id is already registered.
 */
export function hasTheme(id: string): boolean {
  return themes.has(id);
}

/**
 * Get a theme by id.
 * @returns The theme, or undefined if not found.
 */
export function getTheme(id: string): Theme | undefined {
  return themes.get(id);
}

/**
 * Get the default theme (id = "default-dark").
 * @throws Error if the default theme is not registered.
 */
export function getDefaultTheme(): Theme {
  const theme = themes.get('default-dark');
  if (!theme) {
    throw new Error('Default theme "default-dark" is not registered.');
  }
  return theme;
}

// Initialize with the default theme loaded from JSON
registerTheme(parseTheme(defaultDarkData));

// ---------------------------------------------------------------------------
// Convenience Functions (backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Create a terminal theme with the given accent color using the default theme.
 * This is a convenience function for backward compatibility.
 *
 * @param accent - The accent color (hex string).
 * @returns A TerminalTheme instance.
 */
export function createDefaultTerminalTheme(accent: string): TerminalTheme {
  return getDefaultTheme().terminalTheme(accent);
}

/**
 * Get CSS tokens for the default theme.
 * This is a convenience function for applying theme CSS variables.
 *
 * @returns Record of CSS variable names to values.
 */
export function getDefaultCssTokens(): Record<string, string> {
  return getDefaultTheme().cssTokens();
}

/**
 * Get animation tokens for the default theme.
 * This is a convenience function for applying animation CSS variables.
 *
 * @returns Record of CSS variable names to values.
 */
export function getDefaultAnimationTokens(): Record<string, string> {
  return getDefaultTheme().animationTokens();
}
