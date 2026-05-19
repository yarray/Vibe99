/**
 * Theme Domain Contract
 *
 * Defines the theme abstraction for CSS tokens, terminal colors, and animations.
 * Provides a single entry point for all visual styling, decoupling rendering
 * from hardcoded color values.
 *
 * @module domain/theme
 */

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
   * @param accent - The accent color (hex string) for cursor and highlights.
   */
  terminalTheme(accent: string): TerminalTheme;

  /**
   * Animation-related CSS custom properties.
   * Key is the CSS variable name (without '--'), value is the CSS value.
   */
  animationTokens(): Record<string, string>;
}

/**
 * Light theme for Vibe99.
 */
const lightTheme: Theme = {
  id: 'light',
  name: 'Light',

  cssTokens(): Record<string, string> {
    return {
      'pane-opacity': '0.95',
      'pane-bg-mask-opacity': '0.9',
      'pane-width': '720px',
    };
  },

  terminalTheme(accent: string): TerminalTheme {
    return {
      background: '#ffffff00',
      foreground: '#333333',
      cursor: accent,
      cursorAccent: '#ffffff',
      selectionBackground: `${accent}44`,
      black: '#000000',
      red: '#cd3131',
      green: '#00bc00',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#14ce14',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5',
    };
  },

  animationTokens(): Record<string, string> {
    return {
      'breathing-glow': 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)',
      'breathing-intense': 'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)',
    };
  },
};

/**
 * Blue-tinted theme for production servers.
 */
const blueTheme: Theme = {
  id: 'blue',
  name: 'Blue',

  cssTokens(): Record<string, string> {
    return {
      'pane-opacity': '0.85',
      'pane-bg-mask-opacity': '0.8',
      'pane-width': '720px',
    };
  },

  terminalTheme(accent: string): TerminalTheme {
    return {
      background: '#0a1f3300',
      foreground: '#d9d4c7',
      cursor: accent,
      cursorAccent: '#0a1f33',
      selectionBackground: `${accent}44`,
      black: '#0a1f33',
      red: '#ff6b57',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d9d4c7',
      brightBlack: '#1a3a5c',
      brightRed: '#ff8578',
      brightGreen: '#b0d98b',
      brightYellow: '#f0d58a',
      brightBlue: '#7eb7ff',
      brightMagenta: '#d9a5e8',
      brightCyan: '#7fd8e6',
      brightWhite: '#ffffff',
    };
  },

  animationTokens(): Record<string, string> {
    return {
      'breathing-glow': 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)',
      'breathing-intense': 'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)',
    };
  },
};

/**
 * Green-tinted theme for testing environments.
 */
const greenTheme: Theme = {
  id: 'green',
  name: 'Green',

  cssTokens(): Record<string, string> {
    return {
      'pane-opacity': '0.85',
      'pane-bg-mask-opacity': '0.8',
      'pane-width': '720px',
    };
  },

  terminalTheme(accent: string): TerminalTheme {
    return {
      background: '#0a2a1a00',
      foreground: '#d9d4c7',
      cursor: accent,
      cursorAccent: '#0a2a1a',
      selectionBackground: `${accent}44`,
      black: '#0a2a1a',
      red: '#ff6b57',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d9d4c7',
      brightBlack: '#1a4a2a',
      brightRed: '#ff8578',
      brightGreen: '#b0d98b',
      brightYellow: '#f0d58a',
      brightBlue: '#7eb7ff',
      brightMagenta: '#d9a5e8',
      brightCyan: '#7fd8e6',
      brightWhite: '#ffffff',
    };
  },

  animationTokens(): Record<string, string> {
    return {
      'breathing-glow': 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)',
      'breathing-intense': 'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)',
    };
  },
};

/**
 * Red-tinted theme for production servers (alert).
 */
const redTheme: Theme = {
  id: 'red',
  name: 'Red',

  cssTokens(): Record<string, string> {
    return {
      'pane-opacity': '0.85',
      'pane-bg-mask-opacity': '0.8',
      'pane-width': '720px',
    };
  },

  terminalTheme(accent: string): TerminalTheme {
    return {
      background: '#2a0a0a00',
      foreground: '#d9d4c7',
      cursor: accent,
      cursorAccent: '#2a0a0a',
      selectionBackground: `${accent}44`,
      black: '#2a0a0a',
      red: '#ff6b57',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d9d4c7',
      brightBlack: '#4a1a1a',
      brightRed: '#ff8578',
      brightGreen: '#b0d98b',
      brightYellow: '#f0d58a',
      brightBlue: '#7eb7ff',
      brightMagenta: '#d9a5e8',
      brightCyan: '#7fd8e6',
      brightWhite: '#ffffff',
    };
  },

  animationTokens(): Record<string, string> {
    return {
      'breathing-glow': 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)',
      'breathing-intense': 'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)',
    };
  },
};

// ---------------------------------------------------------------------------
// Default Theme Implementation
// ---------------------------------------------------------------------------

/**
 * Default dark theme for Vibe99.
 * Uses the existing One Dark-inspired color palette.
 */
const defaultTheme: Theme = {
  id: 'default-dark',
  name: 'Default Dark',

  cssTokens(): Record<string, string> {
    return {
      'pane-opacity': '0.8',
      'pane-bg-mask-opacity': '0.75',
      'pane-width': '720px',
    };
  },

  terminalTheme(accent: string): TerminalTheme {
    return {
      background: '#11111100',
      foreground: '#d9d4c7',
      cursor: accent,
      cursorAccent: '#111111',
      selectionBackground: `${accent}44`,
      black: '#111111',
      red: '#ff6b57',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d9d4c7',
      brightBlack: '#5a6374',
      brightRed: '#ff8578',
      brightGreen: '#b0d98b',
      brightYellow: '#f0d58a',
      brightBlue: '#7eb7ff',
      brightMagenta: '#d9a5e8',
      brightCyan: '#7fd8e6',
      brightWhite: '#ffffff',
    };
  },

  animationTokens(): Record<string, string> {
    return {
      'breathing-glow': 'inset 0 0 14px 2px color-mix(in srgb, var(--pane-accent) 50%, transparent)',
      'breathing-intense': 'inset 0 0 0 3px color-mix(in srgb, var(--pane-accent) 90%, white), inset 0 0 28px 6px color-mix(in srgb, var(--pane-accent) 80%, transparent)',
    };
  },
};

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
 * Get a theme by id.
 * @returns The theme, or undefined if not found.
 */
export function getTheme(id: string): Theme | undefined {
  return themes.get(id);
}

/**
 * Get the default theme.
 */
export function getDefaultTheme(): Theme {
  return defaultTheme;
}

// Initialize with default themes
registerTheme(defaultTheme);
registerTheme(lightTheme);
registerTheme(blueTheme);
registerTheme(greenTheme);
registerTheme(redTheme);

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Get all registered themes.
 * @returns Array of all registered themes.
 */
export function listThemes(): Theme[] {
  return Array.from(themes.values());
}

/**
 * Create a terminal theme with the given accent color using the default theme.
 * This is a convenience function for backward compatibility.
 *
 * @param accent - The accent color (hex string).
 * @returns A TerminalTheme instance.
 */
export function createDefaultTerminalTheme(accent: string): TerminalTheme {
  return defaultTheme.terminalTheme(accent);
}

/**
 * Get CSS tokens for the default theme.
 * This is a convenience function for applying theme CSS variables.
 *
 * @returns Record of CSS variable names to values.
 */
export function getDefaultCssTokens(): Record<string, string> {
  return defaultTheme.cssTokens();
}

/**
 * Get animation tokens for the default theme.
 * This is a convenience function for applying animation CSS variables.
 *
 * @returns Record of CSS variable names to values.
 */
export function getDefaultAnimationTokens(): Record<string, string> {
  return defaultTheme.animationTokens();
}
