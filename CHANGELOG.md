# Changelog

<!-- towncrier release notes start -->

## [Unreleased]

### Added



- **E2E Pane Navigation / Tab Reorder (VIB-255):** Added 6 new tests to `e2e/tests/pane-management.spec.js` covering rename via navigation mode (title persistence, empty-title fallback, Escape cancel), Home/End focus jumps, and digit-key pane jumps (1–9, with out-of-bounds safety). Added 1 new test to `e2e/tests/tab-management.spec.js` covering tab drag reorder via synthetic pointer events, verifying tab order change and pane z-index alignment.


- **E2E Layout extended tests (VIB-254):** Added 8 new E2E test cases for Layout window geometry persistence, Set as Default UI, Open in New Window editor button, and Layout Focus Notice event handling. Covers geometry save/restore verification, default layout button interaction in editor panel, and focus notice CSS class / timeout behavior.



- **E2E Hook system tests (VIB-249):** Added `e2e/tests/hooks.spec.js` with 22 test cases covering hook modal open/close (5), hook CRUD — create (4), edit (3), delete (2) — enable/disable toggle (3), `{{var}}` template rendering with variable hints (3), and event trigger integration (2).

### Fixed

- **Knip configuration cleanup (VIB-286):** Removed redundant knip entries (`src/renderer.ts`, unnecessary `ignoreDependencies`/`ignoreBinaries`) after verifying they are auto-detected. Replaced `@tauri-apps/api/webviewWindow` type import in `src/bridge.ts` with minimal local interfaces (`TauriWebviewWindow`, `TauriWebviewWindowClass`) to eliminate implicit external type dependency. `npm run knip` now outputs zero issues.

- **E2E Dockerfile: replace git clone with COPY and npm ci with npm install (VIB-274):** Changed `RUN git clone https://github.com/yarray/Vibe99.git` to `COPY . /app/Vibe99` so the image uses the local build context instead of fetching remote source. Replaced all `npm ci` with `npm install` to avoid failures when `package-lock.json` is absent in the build context.
- **E2E Docker image bloat reduction (VIB-276):** Merged cleanup steps into the same RUN layers to reduce image size: clean npm cache after each `npm install`, remove Cargo registry cache and target incremental/build/fingerprint intermediates after `tauri:build-dev`. Added `.gitattributes`, `.github/` to `.dockerignore` (`.git/` is intentionally kept — needed for `git fetch`/`git checkout` at test time). Target: < 3 GB.
- **Activity alert debounce non-numeric input (VIB-273):** `<input type="number">` sanitises non-numeric values to `""`, which `Number("")` converts to `0` (not `NaN`). The debounce change handler now treats `0` and negative values as invalid, reverting the field to the current setting instead of clamping to the 3 s minimum.
- **E2E Dockerfile: use debug build and remove stale release binary (VIB-257):** Changed `tauri:build` to `tauri:build-dev` and removed the precompiled `src-tauri/target/debug/vibe99` from the image so that test runs always build incrementally from the mounted source.


### Fixed

- **E2E Layout tests (VIB-254):** Fixed 14 E2E layout test assertions that failed due to `clearAllLayouts()` now recreating a default layout. Tests now search dropdown/modal items by content rather than assuming index positions. Window geometry tests rewritten to verify at frontend JS level (via `layoutManager`) since Rust backend `sanitize_layout()` strips `windowGeometry`. Star indicator test now finds the `is-default` item instead of assuming `items[0]`. Focus notice test checks `document.body.dataset` instead of status label text. Added refresh/delay steps to open-in-new-window test for DOM update timing.

- **E2E font settings test (VIB-206):** Fixed `settings.spec.js` font size and font family assertions that were checking CSS vars `--app-font-size` and `--app-font-family` on `document.documentElement`. Font settings are applied to the xterm terminal via `pane-renderer.ts` (`node.terminal.options.fontSize` / `node.terminal.options.fontFamily`), not CSS vars. Tests now query `terminal.options` directly via the `_xterm` property on `.terminal-host` elements.

- **E2E settings.spec.js (VIB-225):** Removed TypeScript type assertions (`as HTMLElement`, `as {...}`) from `e2e/tests/settings.spec.js` browser.execute() callbacks — these are plain `.js` files with no TypeScript transpilation in the WebdriverIO test runner.

- **Context menu Activity toggle (VIB-143):** Fixed "Background activity alert" context menu item displaying raw SVG text instead of a visual indicator. Replaced broken `icon('check', 12)` approach with `toggleActive` property that renders a yellow dot (using `--status-highlight`) consistent with the settings menu style (VIB-127). Added `MenuEntryItem.toggleActive` interface property and `.context-menu-toggle-dot` CSS class.

### Added

- **E2E settings tests (VIB-252):** Added 7 new E2E test cases in `e2e/tests/settings.spec.js`:
  - Activity Alert Debounce: input existence, seconds-to-ms conversion, lower/upper clamping (3s–300s), `paneActivityWatcher.setSettleMs` integration
  - Float Window Toggle: element existence, `is-active` class state sync
  - Debounce Input: non-numeric input handling, persistence after panel close/reopen
  - Exposed `paneActivityWatcher`, `settingsManager`, `floatWindowManager`, and `settings` on `window` in `src/renderer.ts` for E2E access

### Changed

- **Docker e2e workflow (VIB-198):** Updated `e2e/README.md` to document the correct workflow — use `git fetch` inside the container for incremental builds (not volume mounts, which bypass the pre-compiled Cargo cache). Added e2e testing reference in main `README.md`.

- **CSS architecture (VIB-146):** Split `src/styles.css` (2344 lines) into 8 purpose-oriented files under `src/styles/`: `base.css` (CSS variables, resets, app-shell), `tabs.css` (tabs panel & actions), `panes.css` (stage, pane, terminal, status bar), `settings-modal.css` (settings panel, keyboard shortcuts), `shell-profiles.css` (shell profiles list & editor), `overlays.css` (context menu, color picker), `layouts.css` (layout manager modal, layouts dropdown), `animations.css` (keyframes, reduced-motion). All rules preserved; no behavior change.
- **Rust pty.rs module split (VIB-147):**
  - Split `src-tauri/src/pty.rs` (1005 lines) into `src-tauri/src/pty/mod.rs` (574 lines) and `src-tauri/src/pty/shell_resolver.rs` (433 lines).
  - `mod.rs` contains `PtyManager` core, `PtySession`, reader/exit threads, and `shell_candidates()` entry point.
  - `shell_resolver.rs` contains shell discovery, command building, working directory resolution, WSL integration, and settings config loading.
  - Pure structural refactoring — no functional logic changes.
- **Pane renderer extraction (VIB-151):**
  - Extracted terminal rendering and DOM management from `renderer.js` into new `pane-renderer.js` module (~612 lines)
  - Factory function `createPaneRenderer()` accepts dependencies: `bridge`, `paneState`, `settingsManager`, `paneAlert`, `paneActivityWatcher`, `reportError`, `stageEl`, `getMode`, `onPaneClick`, `onTerminalTitleChange`, `onTerminalContextMenu`, `scheduleWindowLayoutSave`, `tabBar`, `getPaneLabel`, `onPaneCwdChanged`
  - Returned API includes: `ensurePaneNodes`, `renderPanes`, `fitTerminal`, `getNode`, `write`, `copySelection`, `pasteInto`, `selectAll`, `focusTerminal`, `blurTerminal`, `clearTerminal`, `writeln`, `changePaneShell`, `entryNeedsTabRefresh`, `setAlerted`, `rootContains`, `hasSelection`, `isSessionReady`, `setSessionReady`, `getShellChangeTime`, `isShellChanging`, `destroyPane`
  - `paneNodeMap` ownership moved to `pane-renderer.js`; no longer exposed to external modules
  - All xterm.js imports (`Terminal`, `FitAddon`, `WebLinksAddon`, `WebglAddon`, `Unicode11Addon`) moved to `pane-renderer.js`
  - `renderer.js` updated to use `paneRenderer` methods instead of direct `paneNodeMap` access

- **Pane state management extraction (VIB-150):**
  - Extracted pane state management from `renderer.js` into new `pane-state.js` module
  - New module provides pure logic for pane state, collection operations, and session persistence
  - Factory function `createPaneState()` accepts dependencies: `defaultCwd`, `defaultTabTitle`, `getAccentPalette`, `onStateChange`
  - Returned API includes read operations (`getPanes`, `getFocusedPaneId`, `getPaneById`, `getPaneIndex`, `getFocusedIndex`), write operations (`addPane`, `closePane`, `focusPane`, `moveFocus`, `navigateLeft`, `navigateRight`, `reorderPane`), MRU operations (`cycleToRecentPane`, `commitPaneCycle`, `recordPaneVisit`), property modification (`setPaneTitle`, `setPaneCwd`, `setPaneColor`, `clearPaneColor`, `setPaneShellProfile`, `setPaneTerminalTitle`, `togglePaneBreathingMonitor`), and session operations (`buildSessionData`, `restoreSession`)
  - `pane-state.js` is ~400 lines, under the 600 line requirement, with zero DOM operations

- **Multi-window architecture refactor (VIB-104):**
  - PTY sessions now keyed by `(window_label, pane_id)` compound address (`PaneRef`) instead of `pane_id` alone, preventing cross-window collisions when multiple windows use the same sequential pane IDs.
  - Layout window creation moved from Rust (`layout_open_window`, `layout_open_in_new_window`) to frontend using Tauri's `WebviewWindow` API. Window creation is now UI navigation owned by the frontend.
  - Layout windows no longer write `settings.session` or `activeLayoutId` to disk. Only the main window persists session state.
  - `WindowContext` introduced via URL `?layoutId=xxx` to distinguish main vs layout windows at startup.
  - Terminal exit events now include a `reason` field (`"exited"` / `"killed"`). Killed sessions (backend cleanup) no longer auto-close UI panes.
  - Window cleanup (`destroy_for_window`) is now non-blocking: sessions are removed from the registry under lock, then killed in a background thread to avoid blocking the Tauri window event thread.
  - Removed `layout_open_window` and `layout_open_in_new_window` Rust commands from the backend.
  - Added `core:webview:allow-create-webview-window` capability.

### Fixed

- **WSL detection no longer hangs on Windows without WSL (VIB-170):**
  - `is_wsl_available()` now reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` via the registry (microsecond-fast) instead of invoking `wsl.exe --list --quiet`, which could hang for seconds or fail to return on machines without WSL installed.
  - `list_distributions()` and `detect_wsl_default_shell()` cache an in-process "unavailable" flag after their first failed detection, so subsequent calls return instantly without touching `wsl.exe`.
- Shell profile e2e test "switches terminal shell from context menu" no longer times out in Docker+Xvfb. Replaced unreliable `moveTo()` hover (CSS `:hover` doesn't fire in headless WebKitGTK) with direct JS submenu display (VIB-167).
- Layout "Open in New Window" (⎆ button) no longer causes the new window to white-screen and freeze. PTY events (`terminal-data`, `terminal-exit`) are now scoped to the owning window, and closing a secondary layout window no longer kills terminals in other windows (VIB-96).
- Status bar overflow when terminal titles are too long (VIB-163):
  - `.status-bar` now has `overflow: hidden` to prevent content overflow
  - `.status-hint` is now shrinkable (`flex: 0 1 auto`) with `min-width: 0` and text truncation (`text-overflow: ellipsis`)
  - Terminal titles >64 characters are truncated to keep the tail (e.g., "...powershell.exe")

### Added

- **Restart Terminal context menu item (VIB-233):**
  - Added "Restart Terminal" option to the pane right-click context menu.
  - Kills the current PTY process and recreates it in the same pane with the same shell profile.
  - Clears the terminal and starts a fresh shell session, useful when a terminal hangs or becomes unresponsive.
  - Added `restartPaneTerminal` function to `pane-renderer.ts` that follows the same pattern as `changePaneShell` but preserves the current shell profile.
- **WSL re-detect button in Shell Profiles modal (VIB-170):**
  - Added a refresh button (↻) next to the "Add Profile" button in the Shell Profiles modal.
  - Clicking it clears the cached WSL-unavailable flag and re-runs profile auto-detection, allowing users who install WSL after launching Vibe99 to discover WSL shells without restarting the app.
- E2E tests for Settings panel (VIB-113):
  - Settings panel toggle tests (open/close via button, click outside to close)
  - Font settings tests (font size with limits 10-24, font family)
  - Pane size settings tests (pane width with limits 520-2000)
  - Pane transparency settings tests (pane opacity with limits 0.55-1)
  - BG mask transparency settings tests (mask opacity with limits 0-1)
  - Breathing alert toggle tests (checkbox state, persistence)
  - Settings persistence tests (individual and multiple settings)
- Layout edit panel enhancements (VIB-88):
  - "Set as Default" button to set a layout as the default layout (loaded on application startup)
  - Visual indicator (★) for default layouts in the layout list
  - Enhanced layout info display with pane list preview showing shell type and working directory for each pane
  - `defaultLayoutId` field in settings schema to persist the default layout

### Improved

- Layout dropdown (`.layouts-dropdown`): unified visual style with context-menu — matching background color (`#1e1e1e`), box-shadow, font, padding, hover effect, and separator margin (VIB-89).
- Replaced all Layout-related `window.prompt()` calls with inline DOM inputs for layout operations — popover inputs near the trigger element for Save Current Layout and direct inline inputs in Layout Manager Modal for Add/Rename, matching the existing design (dark theme, Enter/Esc shortcuts, auto-focus) (VIB-77/VIB-90).
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
