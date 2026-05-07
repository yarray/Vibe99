# Changelog

<!-- towncrier release notes start -->

## [Unreleased]

### Removed

- **Remove pane-state.ts and pane-renderer.ts (VIB-194):** Deleted the legacy `src/pane-state.ts` (488 lines) and `src/pane-renderer.ts` (616 lines). All consumers have been migrated to the new PaneManager-based architecture. Fixed last remaining import in `shell-profiles.ts` (PaneNode now imported from `./pane/types`) and removed stale `import('../pane-state')` references in `pane/types.ts`. `tsc --noEmit` passes with zero errors.

### Changed

- **Layout 编辑界面按钮改用文字标签 (VIB-196):** 将 Layout 编辑界面左侧 item 的操作按钮从 12px SVG 图标改为文字标签 (`link`/`edit`/`x`)，与 Profile 编辑面板的 `createProfileActionButton` 文字标签风格保持一致。CSS 无需变动，两者使用相同的 `.settings-btn` 样式（20x20px, font-size: 12px）。

- **renderer.ts PaneManager integration +瘦身到 ≤250 行 (VIB-193):** Migrated `renderer.ts` to use `PaneManager` directly, removing all dependencies on `pane-state` and `pane-renderer`. Created `shell-profile-adapter.ts` to bridge `PaneManager` to the `ShellProfileState` interface required by `shell-profiles` module. Inlined `getTextColorForBackground` utility function. File size reduced from 662 lines to 225 lines (66% reduction). All pane operations now go through `paneManager` API; `focusController` receives `paneManager` directly instead of adapter. `tsc --noEmit` passes with zero errors.
- **Pane types extraction (VIB-189):** Extracted shared types (`PaneNode`, `Pane`, `PaneState`, `PaneRenderer`, `PaneRendererDeps`, `SessionData`, `SessionPaneEntry`, `PaneStateDeps`) from `pane-renderer.ts` and `pane-state.ts` into `src/pane/types.ts`. Both files re-export from `pane/types.ts` for backward compatibility. No runtime behavior change.
- **pane-operations.ts migration to PaneManager (VIB-191):** Replaced all `paneState`/`paneRenderer` dependencies with `paneManager` + capability API. `PaneOperationsDeps` now takes `paneManager: PaneManager` instead of `paneState`/`paneRenderer`. All pane CRUD goes through `paneManager.getAll()`/`create()`/`destroy()`. All terminal/DOM/activity/PTY operations go through `pane.capability('terminal'|'dom'|'activity'|'pty')`. `getPaneLabel` accepts structural type `{ title, terminalTitle }` for compatibility with both old and new Pane types. No imports from `pane-state` or `pane-renderer` remain.

### Added

- **renderer.ts first real PaneManager integration (VIB-184):** Added PaneManager instance to `renderer.ts` (38 net new lines). The "add pane" button now creates panes through `PaneManager.create()` — proving the Phase 2 system works end-to-end (terminal renders, PTY connects, input works). Old system continues as fallback. PaneManager panes use `pm`-prefixed IDs to avoid collision with old pane IDs. Added guards to `terminal.onData`/`onExit` listeners to skip PaneManager-managed panes. Also fixed TS errors in `terminal-capability.ts` (PaneHandle signature, WebLinksAddon callback param order), `clipboard-capability.ts` (onSelectionChange type), and `renderer.ts` (context menu type bridge).

### Changed

- **PaneManager lifecycle fix + real capabilities (VIB-183):** Replaced 4 stub capabilities (terminal, pty, color, shell) with real implementations in `create-pane-manager.ts`. Now uses `pane.use(behavior) × N → pane.open()` lifecycle instead of manually calling `behavior.open()` before `pane.open()`. Removed `capabilityApis` Map in favor of `pane.capability(name)` lookup. Added `setState(key, value)` to `PaneHandle` interface so color/shell capabilities can mutate pane state through the handle. Created `createPtyAdapter()` to bridge `PaneHandle` → `PtyBehaviorContext` (adapts `getCwd`/`getShellProfileId` from `getState`, routes `onOutput` through `capability('terminal').write()`). Activity watcher dispatch now uses `pane.capability()` instead of separate API map.

### Added

- **PaneManager full API surface (VIB-190):** Extended `create-pane-manager.ts` with all methods required by `pane-operations.ts` and `renderer.ts`. New layout methods: `setLayout(paneId, layout)`, `setFocused(paneId, isFocused, isNavTarget)`, `setAccent(paneId, color)`. Bulk operations: `closeAll()`. Focus queries: `isFocused(paneId)`, `getFocusedIndex()`, `getPaneIndex(paneId)`, `getPaneIdAt(index)`. Shell capability access: `changePaneShell(paneId, profileId)`. Color capability access: `getPaneAccent(paneId)`, `setPaneCustomColor(paneId, color)`, `clearPaneCustomColor(paneId)`. State helpers: `getPaneState()`, `setPaneState()`, `getPaneTitle()`, `setPaneTitle()`, `togglePaneBreathingMonitor()`. All methods properly typed with explicit return types. File size: 287 lines (under 350 limit).

- **PTY capability module (VIB-175):** Created `src/pane/capabilities/pty-capability.ts` (119 lines) extracting PTY session lifecycle from `pane-renderer.ts`. Factory `createPtyBehavior(deps)` returns `{ name: 'pty', open(ctx), close() }`. `open(ctx)` registers per-pane backend event listeners (onData/onExit filtered by paneId) and returns self-contained session API: `sessionReady`/`isShellChanging`/`recentShellChange` getters; `create()`/`write()`/`resize()`/`destroy()`/`beginShellChange()`/`endShellChange()`/`close()` methods. No xterm dependency — pure backend session management.

- **DOM capability extraction (VIB-173):** Extracted DOM creation and lifecycle from `pane-renderer.ts` into new `src/pane/capabilities/dom-capability.ts` (~174 lines). Factory `createDomBehavior(deps)` returns `{ name: 'dom', open(ctx), close(ctx, api) }`. open() creates DOM tree: root(article.pane) > shell > body > surface > terminalHost. API includes: `root`/`terminalHost` refs, `mount(container)`/`unmount()`, `setLayout({ left, height, zIndex })`, `setFocused(isFocused, isNavTarget)`, `setAccent(color)`, `dispose()`. Integrates breathing mask alert strategy and registers click-focus and right-click context menu events. All class names preserved from existing implementation.
- **Pane manager (VIB-178):** Created `src/manager/create-pane-manager.ts` (~188 lines) for Pane collection CRUD, focus management, layout coordination, and session persistence. Factory `createPaneManager(deps)` returns manager with: `create(initialState)` creates pane mounting capabilities in order (dom→terminal→pty→activity→clipboard→color→shell) then calls `pane.open()`, `destroy(paneId)` calls `pane.close()` + removes from collection + destroys PTY, `get(paneId)`/`getAll()`/`getActive()`/`getActiveId()` for read access, `setActive(paneId)` sets active pane, `size()` returns pane count, `serializeAll()` serializes all panes for session persistence, `restoreSession()` restores panes from serialized entries. Integrates with `bridge.terminal` for PTY creation/destruction. Uses stub capabilities for terminal/pty/activity/clipboard/color/shell (to be implemented in follow-up tasks).
- **Focus controller (VIB-179):** Created `src/manager/create-focus-controller.ts` (~170 lines) extracting MRU order, pane cycling, and navigation mode logic from `pane-state.ts` and `renderer.ts`. Factory `createFocusController(paneManager, deps)` returns controller with: `getMode()`/`setMode()`/`enterNavigationMode()`/`cancelNavigationMode()` for navigation mode state management including `enterNavSourcePaneId` tracking, `recordPaneVisit()`/`cycleToRecentPane()`/`commitPaneCycle()`/`hasActivePaneCycle()` for MRU-based Ctrl+Tab cycling, `focusPane()`/`moveFocus()`/`navigateLeft()`/`navigateRight()`/`focusPaneAt()` for focus movement with appropriate MRU updates, `getPaneCount()`/`getPaneIdAt()` for pane indexing. Integrates with `PaneManager` via `paneManager.getAll()`/`getActiveId()`/`setActive()`/`size()`. Delegates DOM/rendering side effects to `onModeChange`/`onFocusChange` callbacks.

### Changed

- **Backend/Bridge unification (VIB-186):**
  - Added flat alias properties (e.g., `createTerminal`, `writeTerminal`, `readClipboardText`, `writeClipboardText`) to `Backend` interface in `src/backend.ts` to match the full `Bridge` interface
  - Switched Phase 2 files `src/pane/capabilities/clipboard-capability.ts` and `src/manager/create-pane-manager.ts` to import `Backend` from `backend.ts` instead of `Bridge` from `bridge.ts`
  - `bridge.ts` is preserved unchanged for backward compatibility with existing code
  - No functional changes; Phase 2 code now consistently uses the new `backend.ts` module

- **Backend API domain grouping (VIB-171):**
  - Created new `src/backend.ts` (~540 lines) that exports `createBackend(tauri)` function with domain-grouped APIs
  - Grouped APIs by domain: `terminal` (create, write, resize, destroy, onData, onExit), `clipboard` (read, write, snapshot), `settings` (load, save), `shell` (list, add, remove, setDefault, detect), `window` (close, openUrl, showMenu), `layouts` (list, save, delete, rename, openWindow, openInNewWindow, isFullscreen, setFullscreen, setAsDefault)
  - Exported shared utilities: `basename`, `clearLayoutWindowBinding`, `getBoundLayoutWindowLabel`, `readLayoutWindowBindings`, `writeLayoutWindowBindings`, `LAYOUT_FOCUS_NOTICE_EVENT`, `getRuntimePlatform`
  - Removed flat alias methods (e.g., `createTerminal`, `writeTerminal`, `readClipboardText`) in favor of domain-grouped calls (e.g., `backend.terminal.create()`, `backend.clipboard.read()`)
  - Updated all call sites in: `renderer.ts`, `context-menus.ts`, `layout-manager.ts`, `shell-profiles.ts`, `command-palette-entries.ts`, `layout-modal.ts`, `pane-renderer.ts`, `settings.ts`, `fullscreen-manager.ts`
  - Preserved all existing functionality; no behavioral changes

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

- Shell profile e2e test "switches terminal shell from context menu" no longer times out in Docker+Xvfb. Replaced unreliable `moveTo()` hover (CSS `:hover` doesn't fire in headless WebKitGTK) with direct JS submenu display (VIB-167).
- Layout "Open in New Window" (⎆ button) no longer causes the new window to white-screen and freeze. PTY events (`terminal-data`, `terminal-exit`) are now scoped to the owning window, and closing a secondary layout window no longer kills terminals in other windows (VIB-96).
- Status bar overflow when terminal titles are too long (VIB-163):
  - `.status-bar` now has `overflow: hidden` to prevent content overflow
  - `.status-hint` is now shrinkable (`flex: 0 1 auto`) with `min-width: 0` and text truncation (`text-overflow: ellipsis`)
  - Terminal titles >64 characters are truncated to keep the tail (e.g., "...powershell.exe")

### Added

- **Terminal capability (VIB-174):** Created `src/pane/capabilities/terminal-capability.ts` (122 lines) to manage xterm.js instance and addons lifecycle. Extracts terminal creation logic from `pane-renderer.ts`. Provides `createTerminalBehavior(deps)` factory function with xterm instance creation, addon loading (FitAddon, WebLinksAddon, Unicode11Addon, WebglAddon), event registration (onData, onTitleChange, onSelectionChange), and mounting to dom capability's terminalHost. API includes: instance, fitAddon, write, focus, blur, fit, resize, setTheme, hasSelection, getSelection, selectAll, writeln, clear, dispose.

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
