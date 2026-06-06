# Changelog

## [Unreleased]

### Fixed

- **Shell Profile copy creates duplicate on save** (VIB-357):
  - Fixed `createShellProfileManager` save handler to use `originalId` when saving a cloned profile, preventing duplicate profile creation.
  - Added unit tests in `src/shell-profiles.test.ts` covering clone-and-save, clone-without-changes, clone-with-ID-edit, and new-profile paths.
  - Corrected test names and comments to accurately describe behavior instead of referencing bug fix IDs.

- **Layout UI override E2E test failures** (VIB-344):
  - Fixed `createOverrideRow()` to call `renderFn()` after enabling override so the toggle updates to "Custom" and inputs become enabled.
  - Fixed text input override to save on `input` event in addition to `change`, ensuring compatibility with WebKitGTK programmatic value changes.
  - Fixed empty global value for text-type overrides: when fontFamily default is empty, skip the stripped-by-backend `onSave('')` and directly enable the input.
  - Fixed breathing intensity E2E test selector to find the correct container with segmented buttons.
  - Fixed font family E2E test to use direct DOM queries via `browser.execute` avoiding stale WDIO element references.

- **Layout UI override toggle bug** (VIB-342):
  - Fixed `createOverrideRow()` function in `src/layout-modal.ts` to properly handle toggle state changes.
  - Added `onClear` callback to properly delete overrides when switching from "Custom" to "Use Global".
  - Fixed input change event handlers to use `!input.disabled` instead of stale `isOverridden` closure value.
  - Fixed Breathing Intensity toggle to enable override when switching from "Use Global" to "Custom".

- **README and e2e test updates for Auto-start on boot feature** (VIB-342):
  - Updated README to reflect "Auto-start on boot" toggle instead of "Set as Default" button.
  - Updated e2e test `layout.spec.js` to test "Auto-start on boot" toggle functionality.
  - The "Set as Default" button was intentionally replaced with "Auto-start on boot" toggle in commit b9f1e83 to support multiple autostart layouts.

### Added

- **Settings panel layout-level UI override write and pin hint** (VIB-341):
  - Settings inputs now route writes to `layout.uiOverrides` when an override exists for that key, preventing the "bounce back" bug.
  - Added `getResolvedSettings()` to `SettingsManager` to expose layout-resolved values.
  - Pin icon indicator (`settings-pin`) shown next to overridden settings in the settings panel.
  - `terminal-session.ts` uses resolved `fontSize`/`fontFamily` for xterm.js.
  - `pane-renderer.ts` uses resolved `paneWidth` for pane layout calculations.
  - CSS variables (`--pane-opacity`, `--pane-bg-mask-opacity`, `--pane-width`) are updated with resolved values during init.

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

- **E2E test failures** (VIB-342):
  - Fixed syntax error in `layout-quake-hotkey.spec.js` - removed TypeScript `as` type assertions from `.js` file
  - Updated `layout.spec.js` tests to use bridge API for setting default layout (removed "Set as Default" button tests)
  - Fixed UI override toggle bug in `layout-modal.ts` - clicking "Use Global" now correctly enables override mode
- **E2E Docker image build** (VIB-339):
  - Added `--no-bundle` flag to `tauri build` in Dockerfile.e2e to skip AppImage bundling (avoids network download issues, reduces image size).
  - Dockerfile.gif retains bundling for GIF recording functionality.

- **Layout theme picker** (VIB-331):
  - Fixed theme selection not persisting - removed unnecessary modal re-render that was destroying the custom-select element during selection.
  - Fixed label wrapping in layout editor - constrained custom-select width to prevent overflow.

### Security

- None.
