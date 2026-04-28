# Changelog

<!-- towncrier release notes start -->

## [Unreleased]

### Improved

- Layout dropdown (`.layouts-dropdown`): unified visual style with context-menu — matching background color (`#1e1e1e`), box-shadow, font, padding, hover effect, and separator margin (VIB-89).
- Status bar shortcut hints: merged Ctrl+← and Ctrl+→ pane navigation into single compact hint `Ctrl+←→ change pane` (VIB-72).

- ESC key: unified close behavior — closes the topmost modal/panel (settings panel, color picker, shell profiles modal, keyboard shortcuts modal), without affecting fullscreen state. Fullscreen exit is now only via the fullscreen button or F11 (VIB-67).

### Added

- Layout Manager Modal UI: two-column modal for viewing, creating, renaming, deleting, and switching between saved pane layouts. Accessible from Settings panel, mirrors Shell Profiles Modal design (VIB-62).
- Tab bar Layout dropdown button (▦) with menu listing all saved layouts, active layout highlighting with ✓, "Save Current Layout…" action, and "Manage Layouts…" action (VIB-63).
- Frontend Layout bridge and core logic: `listLayouts`, `saveLayout`, `deleteLayout`, `renameLayout` bridge methods; `saveCurrentLayout`, `switchLayout`, `deleteLayoutById`, `renameLayoutById` functions; layout state variables; settings payload now includes `activeLayoutId` (VIB-61).
- Command Palette (Ctrl+Shift+P) with curated actions: Change profile, Change color, Rename pane, Profile settings, Shortcuts settings (VIB-52).
- OSC 7 cwd tracking for session restore (VIB-28-impl-1):
  - Frontend captures shell's current working directory changes via xterm.js OSC 7 handler
  - Debounced (5s) auto-save of cwd changes to settings
  - Restores panes to their last working directory on application restart
- Rust backend: Layout data types (`Layout`, `LayoutPane`) and settings schema v5 upgrade (VIB-59).
  - `sanitize_layouts()` validates saved layout arrays (deduplicated by id).
  - `sanitize_active_layout_id()` ensures the active layout reference is valid.
  - `settings_save()` preserves existing layouts from disk when the frontend omits them.
- Rust backend: Layout CRUD Tauri commands (VIB-60).
  - `layouts_list` — returns all saved layouts and the active layout id.
  - `layout_save` — upserts a layout (add or replace by id), returns full settings.
  - `layout_delete` — removes a layout and clears `activeLayoutId` if it pointed to the deleted one.
  - `layout_rename` — updates the name of an existing layout.
- Layout Manager Modal enhancements (VIB-94):
  - "Set as Default" button in layout editor panel — sets a layout to be automatically restored on application startup
  - Pane details display in layout editor — shows each pane's title, working directory (shortened), and shell profile
  - "Open in New Window" button (⎆) in layout list — currently switches layout in place (fallback until Sub-4/VIB-92 is complete)
  - Visual indicator (★) for default layout in the layout list
  - Rust backend: `defaultLayoutId` field in settings schema with sanitization
  - Startup logic now restores `defaultLayoutId` before falling back to `activeLayoutId`

### Improved

- Color picker panel now supports keyboard navigation (VIB-65):
  - Arrow keys with 2D grid navigation (Left/Right for columns, Up/Down for rows)
  - Enter/Space to confirm selection
  - Escape to cancel and close panel
  - Panel auto-closes after selection, focus returns to current pane

### Improved
- Navigation mode enhancements (VIB-33):
  - Number shortcuts (1-9) for jumping to specific panes
  - Home/End keys for jumping to first/last pane
  - Editing actions: n (new pane), x (close pane), r (rename pane)
  - Help system with ? key to open keyboard shortcuts modal
  - Two-step close confirmation with visual feedback
  - Number badges in tabs during navigation mode
  - Proper focus management (exit nav mode after close/rename, return focus to terminal)
- Command Palette: switching pane profile now auto-focuses the pane and closes the palette (VIB-66).

## 0.7.2 - 2026-04-27

### Improved

- Replaced pane default color palette with Okabe-Ito-based divergent colors (VIB-41). Adjacent colors are now visually distinct across the full hue circle, with alternating luminance for stronger separation. Covers accentPalette, presetPaneColors, and initialPanes.

## 0.7.1 - 2026-04-26

### Misc

- Updated changelog to cover the 0.6.0 and 0.7.0 releases.
- Improved README with new shortcuts and features.


## 0.7.0 - 2026-04-26

### Added

- Command palette for tab switching (VIB-16).
- Keyboard shortcut editing interface with configurable defaults.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` pane cycling.
- `Ctrl+Left` / `Ctrl+Right` spatial navigation between panes.
- Breathing mask pulse on backgrounded panes with settled output (VIB-8).
- Activity alert with global and per-pane toggles accessible from the pane context menu.
- Complex settings (shell profiles, keyboard shortcuts) moved to independent modal dialogs.

### Fixed

- Build on Ubuntu 20.04: added setup script for Tauri v2 system dependencies (webkit2gtk-4.1, libsoup-3.0, glib >= 2.70) which are not available in default repos (VIB-69).
- Quotes are now preserved in shell profile arguments round-trip.
- BG mask opacity range extended to the full 0–1 range in both UI controls and settings sanitization.
- Removed dead shell profile rendering code from an incomplete refactoring.

### Misc

- Extracted command palette into its own module.
- Modularized keyboard shortcuts into separate files.


## 0.6.0 - 2026-04-25

### Added

- Custom pane colors — each pane can have its own accent color visible on the tab and mask overlay (VIB-10).
- Fullscreen toggle button in the toolbar.
- Color mask overlay on background panes using the pane accent color.
- Focused tab is filled with its theme color for better visibility.

### Fixed

- Terminal rendering glitches resolved with improved UTF-8 handling and batched writes per animation frame.
- Clipboard: normal copy/paste, Shift+selection for edit mode, and OSC52 support.
- Terminal links now open on click without a modifier key.
- Tab rename error handling and re-entrant render race condition.
- Race condition that could make keyboard input impossible in SSH sessions.
- Linux GitHub Actions build and local dev setup.
- Switched from deprecated `shell.open` to the opener plugin.


## 0.5.0 - 2026-04-25

### Added

- Rewrote the app with Tauri 2 (Rust backend + vanilla JS frontend), replacing the previous Electron stack. The app now launches faster, uses significantly less memory, and produces native installers (.msi/.exe on Windows, .deb/.AppImage on Linux).
- WSL integration now auto-detects all installed distributions and creates a shell profile for each one. Distribution names are correctly decoded from UTF-16LE output.
- Shell profiles are fully editable: users can create, modify, and switch profiles per pane via the right-click context menu. All profiles (auto-detected and user-created) support editing.
- Session state (pane layout, directories, shell profiles, tab titles) is now restored on app restart.
- Added font family selection in settings, allowing users to pick any installed monospace font.
- Terminal rendering now uses the WebGL renderer for crisp, properly aligned box-drawing characters and better performance.

### Misc

- Added `scripts/bump-version.mjs` to synchronize version numbers across package.json, tauri.conf.json, and Cargo.toml from a single command.


## 0.4.5 - 2026-04-20

### Fixed

- On Windows, Codex and Typeless paste now route text and image paste correctly, the launched app uses the correct icon, and tabs close automatically when their terminal process exits.
- Windows local packaging now produces a self-contained portable Electron Builder build while keeping macOS and Linux npm workflows unchanged.


## 0.4.4 - 2026-04-13

### Fixed

- Restored Linux `.deb` release packaging in the GitHub release workflow while keeping the fixed AppImage packaging path.


## 0.4.3 - 2026-04-13

### Fixed

- Fixed Linux release packaging so the published AppImage launches correctly and the GitHub release workflow ships the portable Linux artifacts by default.


## 0.4.2 - 2026-04-13

### Fixed

- Linux release builds now use a Forge-compatible AppImage maker implementation instead of the outdated adapter that failed during `npm run make`.


## 0.4.1 - 2026-04-13

### Added

- Linux releases now publish an AppImage alongside the `.deb` and `.zip`, while macOS release artifacts are paused until signing and notarization are worth the cost.


## 0.4.0 - 2026-04-13

### Added

- Linux releases now include a `.deb` package built in GitHub Actions, making Ubuntu and Debian installs part of the standard release flow instead of a local-only packaging path.

### Fixed

- Linux development runs and packaged builds now restore the PTY native module correctly under Electron 36, fixing the startup crash that was falling back to a missing `build/Release/pty.node` binary.
- Native runtime preparation no longer uses a shared temporary Electron ABI probe file, preventing concurrent `npm run` flows from failing with a missing-module error during startup or packaging.
- Terminal panes now detect web links and open them on modifier-click, preserving normal click and selection behavior for non-activated links.
- Vibe99 now ships with the new branded application icon across packaged app assets and installer output.

### Misc

- Local packaging commands now fail fast on unsupported Node versions, and the repo pins Node 22 so macOS release builds use a known-good toolchain.


## 0.3.0 - 2026-04-11

### Fixed

- Display settings now persist across app restarts instead of resetting to the defaults every time Vibe99 launches.
- Right-click menus now work for terminals and tabs, and terminal copy and paste shortcuts follow the usual platform conventions.

### Misc

- Repository structure cleanup.


## 0.2.0 - 2026-04-11

### Added

- The first packaged macOS release is now available, with DMG and ZIP artifacts produced by Electron Forge.

### Fixed

- Closing the last application window now quits the app instead of leaving Vibe99 running in the background.
- Packaged builds now spawn terminal sessions correctly by using a prebuilt multi-architecture PTY dependency and unpacking its macOS helper binary.
