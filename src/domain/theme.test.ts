import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseTheme,
  registerTheme,
  replaceTheme,
  getTheme,
  hasTheme,
  getDefaultTheme,
  createDefaultTerminalTheme,
  getDefaultCssTokens,
  getDefaultAnimationTokens,
} from './theme';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const minimalThemeData = {
  name: 'Test Theme',
  background: '#111111',
  foreground: '#cccccc',
  black: '#000000',
  red: '#ff0000',
  green: '#00ff00',
  yellow: '#ffff00',
  blue: '#0000ff',
  purple: '#ff00ff',
  cyan: '#00ffff',
  white: '#ffffff',
  brightBlack: '#555555',
  brightRed: '#ff5555',
  brightGreen: '#55ff55',
  brightYellow: '#ffff55',
  brightBlue: '#5555ff',
  brightPurple: '#ff55ff',
  brightCyan: '#55ffff',
  brightWhite: '#bbbbbb',
};

const fullThemeData = {
  name: 'Full Theme',
  background: '#1a1a1a',
  foreground: '#e0e0e0',
  cursorColor: '#ff6b57',
  selectionBackground: '#ff6b5744',
  black: '#000000',
  red: '#ff0000',
  green: '#00ff00',
  yellow: '#ffff00',
  blue: '#0000ff',
  purple: '#ff00ff',
  cyan: '#00ffff',
  white: '#ffffff',
  brightBlack: '#555555',
  brightRed: '#ff5555',
  brightGreen: '#55ff55',
  brightYellow: '#ffff55',
  brightBlue: '#5555ff',
  brightPurple: '#ff55ff',
  brightCyan: '#55ffff',
  brightWhite: '#bbbbbb',
  vibe99: {
    id: 'full-theme',
    tags: ['dark', 'test'],
    cssTokens: {
      'pane-opacity': '0.9',
    },
    animationTokens: {
      'breathing-glow': 'none',
    },
  },
};

// ---------------------------------------------------------------------------
// parseTheme
// ---------------------------------------------------------------------------

describe('parseTheme', () => {
  it('parses a minimal Windows Terminal scheme without vibe99', () => {
    const theme = parseTheme(minimalThemeData);

    expect(theme.id).toBe('test-theme');
    expect(theme.name).toBe('Test Theme');
    expect(theme.tags).toBeUndefined();
    expect(theme.cssTokens()).toHaveProperty('pane-opacity', '0.8');
    expect(theme.animationTokens()).toHaveProperty('breathing-glow');
  });

  it('parses a scheme with vibe99 extension', () => {
    const theme = parseTheme(fullThemeData);

    expect(theme.id).toBe('full-theme');
    expect(theme.name).toBe('Full Theme');
    expect(theme.tags).toEqual(['dark', 'test']);
    expect(theme.cssTokens()).toHaveProperty('pane-opacity', '0.9');
    expect(theme.animationTokens()).toHaveProperty('breathing-glow', 'none');
  });

  it('throws on non-object data', () => {
    expect(() => parseTheme(null)).toThrow('must be an object');
    expect(() => parseTheme('string')).toThrow('must be an object');
  });

  it('throws when required fields are missing', () => {
    const badData = { name: 'Bad', background: '#111' };
    expect(() => parseTheme(badData)).toThrow('missing required field');
  });
});

// ---------------------------------------------------------------------------
// terminalTheme generation
// ---------------------------------------------------------------------------

describe('Theme.terminalTheme', () => {
  it('uses accent color when provided', () => {
    const theme = parseTheme(fullThemeData);
    const t = theme.terminalTheme('#aabbcc');

    expect(t.cursor).toBe('#aabbcc');
    expect(t.selectionBackground).toBe('#aabbcc44');
  });

  it('falls back to cursorColor when accent is omitted', () => {
    const theme = parseTheme(fullThemeData);
    const t = theme.terminalTheme();

    expect(t.cursor).toBe('#ff6b57');
    expect(t.selectionBackground).toBe('#ff6b5744');
  });

  it('falls back to foreground when cursorColor is absent', () => {
    const theme = parseTheme(minimalThemeData);
    const t = theme.terminalTheme();

    expect(t.cursor).toBe('#cccccc');
    expect(t.selectionBackground).toBe('#cccccc44');
  });

  it('derives cursorAccent from background without alpha', () => {
    const theme = parseTheme({ ...minimalThemeData, background: '#12345678' });
    const t = theme.terminalTheme();

    expect(t.cursorAccent).toBe('#123456');
  });

  it('maps purple to magenta', () => {
    const theme = parseTheme(minimalThemeData);
    const t = theme.terminalTheme();

    expect(t.magenta).toBe('#ff00ff');
    expect(t.brightMagenta).toBe('#ff55ff');
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('Theme Registry', () => {
  beforeEach(() => {
    // Clear all non-default themes for isolation
    const allIds = Array.from(
      (getTheme as unknown as { _map?: Map<string, unknown> })._map?.keys() ?? [],
    );
    // We can't easily clear the internal map, so we use replaceTheme for known ids
  });

  it('registers and retrieves a theme', () => {
    const theme = parseTheme({ ...minimalThemeData, name: 'Registry Test' });
    registerTheme(theme);

    expect(getTheme('registry-test')).toBe(theme);
  });

  it('throws when registering a duplicate id', () => {
    const theme = parseTheme({ ...minimalThemeData, name: 'Duplicate' });
    registerTheme(theme);

    expect(() => registerTheme(theme)).toThrow('already registered');
  });

  it('replaceTheme overwrites existing theme', () => {
    const themeA = parseTheme({ ...minimalThemeData, name: 'Replaceable' });
    const themeB = parseTheme({
      ...minimalThemeData,
      name: 'Replaceable',
      foreground: '#999999',
    });
    registerTheme(themeA);

    const previous = replaceTheme(themeB);

    expect(previous).toBe(themeA);
    expect(getTheme('replaceable')).toBe(themeB);
  });

  it('hasTheme returns correct state', () => {
    expect(hasTheme('default-dark')).toBe(true);
    expect(hasTheme('nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe('Backward compatibility', () => {
  it('getDefaultTheme returns default-dark', () => {
    const theme = getDefaultTheme();
    expect(theme.id).toBe('default-dark');
  });

  it('createDefaultTerminalTheme uses accent color', () => {
    const t = createDefaultTerminalTheme('#ff0000');
    expect(t.cursor).toBe('#ff0000');
    expect(t.selectionBackground).toBe('#ff000044');
  });

  it('getDefaultCssTokens returns expected keys', () => {
    const tokens = getDefaultCssTokens();
    expect(tokens).toHaveProperty('pane-opacity');
    expect(tokens).toHaveProperty('pane-bg-mask-opacity');
    expect(tokens).toHaveProperty('pane-width');
  });

  it('getDefaultAnimationTokens returns expected keys', () => {
    const tokens = getDefaultAnimationTokens();
    expect(tokens).toHaveProperty('breathing-glow');
    expect(tokens).toHaveProperty('breathing-intense');
  });
});
