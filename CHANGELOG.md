# Changelog

## [Unreleased]

### Added

- **Layout hotkeys and Quake mode settings UI** (VIB-314):
  - Settings schema extended with `layoutHotkeys` and `quakeMode` fields.
  - Layout Hotkeys configuration modal with hotkey recording and conflict detection.
  - Quake mode settings: enabled toggle, animation duration (100-500ms), position (top/bottom), height (30-100%).
  - New module: `src/layout-hotkeys-ui.ts`.
  - Settings page UI updated in `src/index.html` and `src/settings.ts`.

- **Theme data layer**: JSON-driven theme files with Windows Terminal color scheme compatibility.
  - `src/themes/default-dark.json` — existing default theme as data.
  - `src/themes/red-tint.json` — red tinted background (production identifier).
  - `src/themes/blue-tint.json` — blue tinted background (test environment identifier).
  - `src/themes/green-tint.json` — green tinted background.
  - `src/domain/theme-presets.ts` — `loadBuiltinThemes()` to register all built-in presets.
  - `parseTheme(data)` — parse Windows Terminal scheme JSON into a `Theme` instance.
  - `loadThemeFromFile(path)` — async fetch-based theme loader.
  - `replaceTheme(theme)` / `hasTheme(id)` — registry helpers.
  - `src/domain/theme.test.ts` — 17 unit tests covering parsing, terminal theme generation, registry, and backward compatibility.
  - Vitest test runner (`npm test`).

### Changed

- `Theme.terminalTheme(accent?)` — accent parameter is now optional. Themes without an accent use their default `cursorColor`.
- `Theme` interface — added optional `tags` field for UI grouping.
- `src/domain/theme.ts` — refactored from hardcoded object to JSON-driven `parseTheme` + registry.
- `src/renderer.ts` — calls `loadBuiltinThemes()` during initialization.

### Deprecated

- None.

### Removed

- None.

### Fixed

- **Layout theme picker** (VIB-331):
  - Fixed theme selection not persisting - removed unnecessary modal re-render that was destroying the custom-select element during selection.
  - Fixed label wrapping in layout editor - constrained custom-select width to prevent overflow.

- **Layout-level default theme priority chain** (VIB-334):
  - Fixed layout modal theme changes incorrectly affecting the current window when editing a different layout. Now only updates runtime theme when editing the window's bound layout.
  - Fixed theme re-application after layout theme change by using direct `render()` callback instead of hacky `dispatch(pane.setTheme)` on a potentially stale pane ID.
  - Fixed context menu theme submenu to correctly mark the effective theme (pane override → layout default → global default) as selected, instead of always defaulting to `default-dark`.

### Security

- None.
