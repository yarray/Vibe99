## 0.23.0 - 2026-11-18

### Added

- # VIB-91: Fix switchLayout activeLayoutId persistence

  ### Summary
  Fixed the issue where `activeLayoutId` was not correctly persisted after switching layouts due to race conditions with the debounced save mechanism.

  ### Changes

  #### `src/renderer.js`

  1. **`switchLayout()`**: Changed from `scheduleSettingsSave()` to `flushSettingsSave()` to ensure immediate save of `activeLayoutId`, preventing race conditions with other operations.

  2. **`saveCurrentLayout()`**: 
     - Only updates `activeLayoutId` if the backend confirms it (has `config.activeLayoutId`)
     - Changed to use `flushSettingsSave()` instead of `scheduleSettingsSave()`
     - Added call to `updateLayoutsIndicator()` to refresh UI

  3. **`deleteLayoutById()`**: 
     - Now uses backend's `activeLayoutId` directly for consistency
     - Changed to use `flushSettingsSave()` instead of `scheduleSettingsSave()`
     - Added call to `updateLayoutsIndicator()` to refresh UI

  4. **Added `updateLayoutsIndicator()` function**: Updates the layouts button's `aria-label` to show the current layout name for better accessibility and user feedback.

  5. **Initialization**: Added calls to `updateLayoutsIndicator()` during startup to ensure the layout indicator is correct on load.

  ### Acceptance Criteria Met

  - ✅ Switching layout now immediately saves `activeLayoutId` to prevent race conditions
  - ✅ `saveCurrentLayout` only updates `activeLayoutId` when backend confirms it
  - ✅ Settings file `activeLayoutId` is correctly persisted after layout switch
  - ✅ Layout indicator (button aria-label) is updated after layout operations
- ## Color Picker E2E Tests

  Added comprehensive end-to-end tests for the color picker feature (VIB-118).

  - Opens color picker via terminal right-click and tab right-click context menus
  - Verifies all 16 preset color swatches render correctly
  - Tests preset color click → pane accent color update
  - Tests custom color input updates pane color
  - Tests keyboard navigation (Arrow keys move focus among presets)
  - Tests Enter key confirms focused color
  - Tests Escape cancels and closes picker without changing color
  - Tests Clear Color button restores default accent
  - Tests color persistence across settings save
  - Tests tab context menu opens color picker
- ## Layout E2E Tests

  Added comprehensive end-to-end tests for Layout CRUD, dropdown menu, modal management, and persistence (VIB-115).

  - Tests layout dropdown open/close, empty state, and outside-click dismissal
  - Tests saving layouts via dropdown "Save Layout As…"
  - Tests layout switching and active layout checkmark (✓) in dropdown
  - Tests Layout Manager Modal opened from dropdown and settings panel
  - Tests modal layout: left sidebar list + right editor panel
  - Tests adding, renaming, and deleting layouts in modal
  - Tests switching layout via modal "Open in New Window" button
  - Tests renaming layout via editor panel and confirming with ✓
  - Tests layout persistence across page reload
  - Tests active layout persistence across page reload
  - Tests Default layout auto-creation on startup when no layouts exist
  - Adds `layout-helpers.js` with reusable helpers for dropdown, modal, and bridge operations
- **Added:**

  - **Quake mode dropdown animation**: Added `src/quake-animation.ts` module with smooth slide-in/slide-out animations for Layout windows.
  - **Quake mode settings**: Extended settings schema with `quakeMode` (enabled, animationDuration, screenPosition, heightPercent) and `layoutHotkeys` (layoutId → shortcut mapping).
  - **Hotkey handler**: Added `src/hotkey-handler.ts` module to integrate global hotkey events with Quake animations. Listens for `hotkey:pressed` Tauri events and toggles Layout windows with optional animations.
- **Layout aggregate root (VIB-267):** Created `src/domain/layout.ts` with `LayoutSnapshot`, `Layout` interface, and `createLayout()` factory. The Layout aggregate manages pane collection order, focus, MRU, and cycle state with no knowledge of DOM, xterm, PTY, or rendering state. Refactored `pane-state.ts` to be a compatibility facade that delegates collection/focus/MRU/cycle operations to `Layout` internally while preserving the complete public API for backward compatibility.
- +[VIB-121] feat: add E2E tests for activity alert (breathing mask) and pane cycling
- +[VIB-256] feat: add E2E tests for activity alert advanced scenarios (resize suppression, ignoreFocus, hook events) and keyboard shortcuts actual dispatch verification
- - **Float Window E2E tests (VIB-250):** Added comprehensive E2E test suite for the floating indicator window in `e2e/tests/float-window.spec.js`. Covers settings toggle integration, open/close/toggle API, alert state (breathing), persisted state, and parent-closing state preservation. Added `window.__floatWindowManager` test exposure in renderer.ts.
- Add "New Panel with Profile" command to Command Palette and shortcut Ctrl+Shift+N to create a new pane with a selected shell profile via fuzzy search.
- Add Ctrl+` shortcut to cycle focus through panes with breathing (activity) alerts. The shortcut is customizable via the keyboard shortcuts settings.
- Add E2E tests for Shell Profile management, including CRUD operations, default profile setting, auto-detection, and per-pane shell switching via context menu.
- Add GitHub Actions E2E test workflow (`e2e.yml`) with `workflow_dispatch` and weekly schedule triggers. The workflow builds the Tauri app, installs `tauri-driver`, and runs the full E2E test suite on Linux. Build bundles and failure screenshots are uploaded as artifacts.
- Add `actions/cache` steps to GitHub Actions workflows for Node modules and Rust build artifacts, speeding up CI builds on cache hits.
- Add a "3D acceleration" toggle in settings to control whether the WebGL renderer is used. Disabling it falls back to the canvas renderer, which avoids CJK glyph-atlas rendering glitches on some systems.
- Add floating window mode showing compact color blocks for each pane.

  - New `float.html` + `float-renderer.ts` lightweight entry point (no xterm,
    ~1.3 KB) renders pane accent colors as clickable blocks.
  - Breathing animation on alerted panes, matching the existing
    `pane-alert-breathing-mask` visual language.
  - `createFloatWindowManager` factory (per-window float, label =
    `float-{parentLabel}`) manages lifecycle and state sync via Tauri events.
  - Dynamic window size adjusts to pane count.
  - Clicking a block restores and focuses the parent window on the target pane.
  - Toggle via `Ctrl+Shift+M` or Command Palette "Toggle float window".
  - Requires new Tauri window permissions: `set-size`, `start-dragging`, `close`,
    `set-position`.
- Add global Hook system: configure command-line actions that fire on application events (alert.start, alert.stop). Hook configuration modal accessible from Settings panel, with CRUD operations and enable/disable toggle per hook. Hooks are persisted in settings.json alongside existing configuration.
- Add pane with profile selection: click the ▼ arrow next to the + button to open a dropdown of shell profiles and create a new pane using the selected profile. The + button itself still creates a pane with the default profile. (VIB-53)
- Added AppCommand dispatcher (domain/commands.ts + runtime/command-dispatcher.ts) with 25 command types. All user actions in renderer.ts now go through `dispatch(command)` instead of direct `paneOps` method calls. Pane operations module no longer imported by renderer.
- Added Ctrl+Left Arrow and Ctrl+Right Arrow shortcuts to switch between adjacent panes by spatial position. These shortcuts stop at boundaries (no cycling), complementing the existing cycling navigation.
- Added Docker-based GIF recording infrastructure for feature demos. Use `docker build -f e2e/Dockerfile.gif -t vibe99-recorder .` to build the recorder image, then `./scripts/record-gifs.sh <feature>` to record specific features or `./scripts/record-gifs.sh all` for all features. See `e2e/RECORDING.md` for details.
- Added E2E tests for Restart Terminal and Paste Image context menu actions: verifies Restart Terminal appears in the menu, triggers PTY session recreation while keeping the pane alive, and validates Paste Image enabled/disabled states with mocked clipboard snapshots and bridge call interception.
- Added E2E tests for Tab management: double-click rename (Enter confirm, Esc cancel, empty-value fallback), close button, single-tab close disable, and right-click context menu (Change Color, Rename Tab, Close Tab).
- Added E2E tests for Terminal/PTY lifecycle: creation, I/O, resize, destroy, exit handling, last-pane window close, and OSC 7 CWD tracking.
- Added E2E tests for layout Quake Mode and Global Hotkey features (VIB-327):
  - Quake Mode toggle enable/disable and persistence in settings
  - Quake position (top/bottom) selection
  - Quake height (30-100%) via range slider and number input
  - Global Hotkey assignment, display, clearing, and persistence
- Added E2E tests for layout UI overrides feature (VIB-335):
  - UI Overrides section visibility in layout modal editor
  - Toggle between "Use Global" and "Custom" states for each override setting
  - Persist font size, font family, pane width, pane opacity, and pane mask opacity overrides
  - Clear override by clicking "Use Global" toggle
  - Persist breathing intensity override with segmented button selection
- Added E2E tests for pane management and navigation. Covers pane lifecycle (add, close, close-last-disabled), focus switching via tabs, navigation mode (Ctrl+B, h/l, Enter/Esc), MRU cycling (Ctrl+Tab/Ctrl+Shift+Tab), spatial navigation (Ctrl+ArrowLeft/Right), and nav-mode editing (n, x, r). (VIB-111)
- Added E2E tests for right-click context menu and clipboard operations: terminal context menu (Copy, Paste, Paste Image, Change Color, Background activity alert, Select All, Change Profile), tab context menu (Change Color, Rename Tab, Close Tab), and keyboard shortcuts (Ctrl+Shift+C for copy, Ctrl+Shift+V for paste).
- Added E2E tests for session persistence: pane count, focus, tab title, custom color, and settings restoration across app restarts.
- Added E2E tests for shell profile drag reorder and icon buttons (VIB-327):
  - Drag-and-drop reorder of user profiles with visual and persistence verification
  - Clone, star (set default), and delete icon button presence and behavior
  - Detected profile guards (no drag, no delete) and user profile draggable attribute
  - Redetect WSL and Add Profile header buttons existence
- Added Rust-side global hotkey support via tauri-plugin-global-shortcut. New commands: `hotkey_register`, `hotkey_unregister`, `hotkey_list`, `hotkey_register_all`. Shortcut presses emit `hotkey:pressed` events with `shortcut` and `layoutId` payload.
- Added Settings schema validation system using zod (`src/domain/settings-schema.ts`). Settings are now automatically validated and sanitized on load, with invalid values auto-repaired to valid defaults. Replaced manual `Number.isFinite()`/`Math.max/min` checks with zod schema-based validation for fontSize, fontFamily, paneOpacity, paneMaskOpacity, paneWidth, webglEnabled, breathingIntensity, and activityAlertDebounceMs. Added `ValidationReporter` interface with `ConsoleValidationReporter` and `SilentValidationReporter` for user notification control. Legacy field migrations (`paneMaskAlpha`, `breathingAlertEnabled`) are cleanly separated via `migrateLegacySettings()` preprocessing step, eliminating the Legacy type anti-pattern.
- Added Workbench session coordination layer (`src/runtime/workbench.ts`) with `Workbench` interface and `createWorkbench()` factory for coordinating Layout and TerminalSession lifecycle. The Workbench owns the active Layout and TerminalSession collection for a single window, providing `layout()`, `session(paneId)`, `ensureSessions()`, `closeSession()`, and `render()` methods. Added `ensureSessions()` and `closeSession()` methods to `PaneRenderer` interface as new API names for `ensurePaneNodes()` and `destroyPane()`.
- Added `Ctrl+Tab` to cycle to the most recently visited pane (browser-style). Hold `Ctrl` and press `Tab` again to step further back through pane history; add `Shift` to cycle in reverse.
- Added `src/domain/theme.ts` with a Theme contract for CSS tokens, terminal colors, and animation tokens. Terminal theme creation has been moved out of `terminal-session.ts` into the theme domain, and `TerminalSessionDeps` now accepts a `terminalTheme` function for theme injection.
- Added `vibe99ctl describe`, a machine-readable catalogue of every callable CLI method — names, parameters, examples and error codes — so agents can discover Vibe99's capabilities without reading the source. The method registry is now the single source of truth shared by the server and the CLI, unknown methods are rejected with `-32601`, and `vibe99ctl call` reaches any registered method. See `docs/agents.md`.
- Added `vibe99ctl` CLI for external control of a running Vibe99 instance via JSON-RPC 2.0 over Unix Domain Socket. Supports pane management, layout operations, settings queries, shell profile listing, and terminal I/O. Implements Event Passthrough Bridge (Plan B): passthrough commands are forwarded to the TypeScript `dispatch()` via Tauri events, direct commands are handled in Rust.
- Added a color overlay on background panes to make foreground/background distinction obvious without dimming the terminal text; mask color and alpha are configurable in settings.
- Added an "Install CLI" panel (command palette → Install CLI, or Settings → Install CLI) that explains how to put `vibe99ctl` on your PATH on Windows, Linux and WSL, with a one-click copy button for every command.
- Added comprehensive E2E tests for Command Palette functionality. Tests cover Tab Switcher (Ctrl+Shift+O) with pane selection and keyboard navigation, Command List (Ctrl+Shift+P) with command execution, and Fuzzy Search with filtering and highlighting. Tests verify palette opening/closing, item selection, arrow key navigation, Enter/Esc key handling, search filtering, match highlighting, empty results, and search clearing.
- Added font family selection in settings, allowing users to pick any installed monospace font.
- Added independent Profile button (▥) next to the + button in the tab bar, opening Command Palette with searchable profile list for new pane creation. The + button now only adds a default pane (no dropdown). The Layout dropdown icon changed to 🗔 (U+1F5D4). Ctrl+Shift+N also triggers the new pane with profile action (VIB-133).
- Background panes now light up immediately when the running program sends an explicit notification (terminal bell, or iTerm2/xterm/kitty OSC notifications), instead of waiting for the 30-second quiet period.
- Breathing alert intensity is now configurable with three levels (None / Mild / Intense) instead of a simple toggle. The segmented control replaces the previous on/off dot in the settings panel.
- Extend the Layout Manager Modal with default layout support, "Open in New Window" action, and per-pane detail display (cwd, shell profile). Adds `defaultLayoutId` to settings with backend sanitization.
- Extended Command Palette E2E tests to cover New Pane Profile Picker (Ctrl+Shift+N) and Float Window Toggle command. New tests verify: (1) Ctrl+Shift+N opens the profile picker with all available shell profiles, (2) selecting a profile creates a new pane, (3) Escape cancels without creating a pane, (4) "Toggle float window" command appears in the command list when searching for "float" or "toggle", (5) executing the toggle command closes the palette and triggers the float window action. All tests use the sendShortcut() helper and verify expected palette behavior. (VIB-253)
- Extract layout manager, layout modal, modal stack, fullscreen manager, pane operations, and command palette entries into dedicated modules. Slim renderer.js from ~3100 lines to ~590 lines, making it a pure orchestration layer: module creation, dependency injection, global event binding, and thin coordination functions only.
- Extracted settings management from `renderer.js` into a new `src/settings.js` module. `createSettingsManager` factory handles settings object, DOM application, persistence, debounced save, and all input event listeners. Reduces `renderer.js` complexity and centralizes settings logic.
- Extracted tab bar rendering, drag-and-drop reordering, and inline renaming logic from `renderer.js` into a new `tab-bar.js` module (VIB-152). This is part of the ongoing frontend refactoring to improve code organization and maintainability.
- Float Window breathing animation now uses luminance-based white mixing to ensure consistent visual prominence across all colors. Low-luminance colors (like purple and dark blue) get more white mixed into their glow while high-luminance colors (>= 0.5) keep their pure accent color glow unchanged. This fixes the issue where some color blocks in the Float Window were barely visible during activity alerts.
- Frontend hotkey event handling: listen to `hotkey:pressed` Tauri events, toggle layout window show/hide on bound shortcut press. On startup, restore all saved `layoutHotkeys` bindings from settings. Sync hotkey registrations when settings change.
- GitHub releases now publish both the Windows portable executable and a Windows zip archive alongside the Linux release artifacts.
- Hook parameter system refactor: typed event payloads (`AlertStartPayload`, `AlertStopPayload`, `HookEventMap`), safe mustache-style template rendering with cross-platform shell escaping via [shescape](https://github.com/ericcornelissen/shescape) (bash, zsh, sh, cmd.exe, PowerShell), and on-demand terminal buffer reading via `PaneRenderer.getRecentOutput()`. Hook commands now support `{% raw %}{{paneId}}{% endraw %}`, `{% raw %}{{paneTitle}}{% endraw %}`, and `{% raw %}{{recentOutput}}{% endraw %}` variables.
- Implemented E2E testing infrastructure using WebDriverIO + tauri-driver (Tauri 2.0's official WebDriver approach). Created `e2e/` directory with WebdriverIO config, test helpers for app lifecycle, terminal interaction, settings management, and a smoke test verifying app launch with 3 default panes. Added `npm run test:e2e` script.
- Improved the shell profiles editing interface with a modern two-column layout (VIB-36).

  ### Added

  - **Two-column modal layout**: Left sidebar displays the profile list, right panel shows the editor for the selected profile.
  - **Profile cloning**: Duplicate any profile with a single click; cloned profiles are automatically named "Profile Name (副本)".
  - **Drag-and-drop reordering**: Reorder profiles by dragging them in the left sidebar; the new order persists across sessions.
  - **Visual feedback**: Selected profiles are highlighted, dragging provides visual feedback, and hover states improve interactivity.

  ### Changed

  - **Wider modal**: The modal is now wider (600px min, 800px max) and taller (70vh) to accommodate the two-column layout.
  - **Elegant add button**: The add button is now an elegant + icon button in the sidebar header instead of a full-width button at the bottom.
  - **Improved editor**: The editor panel has a cleaner header with a close button, better field styling, and compact action buttons.
  - **Better navigation**: Click on a profile in the left sidebar to edit it in the right panel; the editor persists until closed or another profile is selected.

  ### Removed

  - Removed the footer "Add Profile" button; profiles are now created from the sidebar header button.
  - Removed the modal footer entirely as the editor panel provides all necessary actions.
- Increase Layout sidebar item action button icon size from 12px to 14px and add `aria-label` attributes, matching the Profile editing panel icon button style from VIB-200. Buttons now use `icon()` directly (consistent with Profile panel) instead of `setIcon()`.
- Integrate Layout commands into the Command Palette and add Default layout auto-creation on first launch.

  - New Command Palette items: "Layout: Save Current Layout", "Layout: Switch to Default", "Layout: Switch to <name>", and "Layout: Manage Layouts"
  - `Ctrl+Shift+L` keyboard shortcut opens the Layouts modal
  - On startup, if no layouts exist and session panes are present, a "Default" layout is automatically created and saved
- Integrate `Workbench` as the session map owner. `createWorkbench` is now used in `workbench-renderer.ts`, eliminating the knip "unused" warning. `PaneRenderer` delegates all session operations (create, close, lookup) to `Workbench` when provided, removing its own `sessionMap` in that path. The `paneNodeToSession` adapter in `workbench-renderer.ts` is replaced with direct `workbench.session()` calls. `WorkbenchDeps.layout` accepts a thunk `() => Layout` to support dynamic layout replacement during session restore. `PaneState.getLayout()` exposes the internal Layout aggregate root for Workbench coordination.
- Keyboard Shortcuts UI improvements (VIB-43):

  - Nav-mode shortcuts now display a "Nav" badge in the settings modal,
    making it clear they only work in navigation mode.
  - Fixed case display: single-letter keys (h, l, n, x, r) now show
    lowercase as intended, instead of uppercase (H, L, N, X, R).
  - Added missing action names and descriptions for all nav-mode
    customizable shortcuts (focus-first, focus-last, new-pane,
    close-pane, rename-pane).
  - Hidden non-customizable "jump-to" (1-9) shortcut from the settings
    modal, as digit-range bindings cannot be remapped.
  - Fixed close-pane shortcut: changed from `c` to `x` to match the
    intended navigation-mode key binding documented in the changelog.
- Layout Manager Modal UI: two-column modal for viewing, creating, renaming, deleting, and switching between saved pane layouts. Accessible from Settings panel, mirrors Shell Profiles Modal design (VIB-62).
- Layout config now has a per-layout "Auto-start on boot" toggle instead of a single global default layout. Multiple layouts can be set to auto-start simultaneously; each opens in its own window when the app is launched with the `--autostart` CLI flag (intended for system boot). Manual app launch always loads only the default layout. Existing `defaultLayoutId` is automatically migrated to the new `autostart` boolean on first load.

  System-level autostart registration uses `tauri-plugin-autostart`: any layout with autostart enabled registers the app with the OS (Windows registry, Linux `.desktop`, macOS LaunchAgent). Disabling the last autostart layout removes the OS registration. Startup self-healing re-syncs OS state with layout state to prevent stale registrations.
- Layout editing page now automatically polls for updates every 3 seconds
  and refreshes the display when changes are detected from other windows.
- Layout editor now automatically loads and displays the current window's layout in the right preview panel when opened. Previously, users had to manually click a layout in the sidebar to see its details; now the active layout is selected immediately if one exists.
- Layout switching now opens a new window instead of replacing panes in the current window. The target layout is passed via URL query parameter (`?layoutId=...`) so the new window loads it automatically on startup. Updated dropdown tooltips, Command Palette labels, and Layout Manager modal to reflect the new behavior.
- Layouts can now override global UI settings (fontSize, fontFamily, paneOpacity, paneMaskOpacity, paneWidth, breathingIntensity). The three-level fallback priority is: pane → layout.uiOverrides → global settings. Layout-level overrides are configurable in the Layout Manager modal.
- Merge `command-dispatcher.ts` into `workbench.ts` so `Workbench.dispatch(command)` becomes the unified command entry point. All PaneRenderer dependencies in command handlers replaced with direct TerminalSession/Layout calls. Deleted `src/runtime/command-dispatcher.ts`.
- Merge main (b7ef33c) into autoproj/phase1-refactor, bringing in E2E terminal helper await fixes, smoke test polling improvements, and VIB-156 changelog entry.
- Merge the two pane-switch shortcut hints (Ctrl+← pane and Ctrl+→ pane) into a single compact `Ctrl+←→ change pane` hint in the status bar. Implemented via declarative merge groups instead of ad-hoc special cases.
- Moved the active layout checkmark (✓) from the left side to the right side in both the layouts dropdown and modal layout list to better align with common UI conventions (similar to macOS sidebar selection indicators).
- Navigation mode now displays mode-specific keyboard hints in the status bar. Press `Esc` to exit navigation mode and return focus to the source pane.
- Press Ctrl+Shift+O (Cmd+Shift+O on macOS) to open a command palette and jump to any pane by fuzzy-matching its tab title — arrow keys to move, Enter to focus, Esc to dismiss.
- Press Ctrl+Shift+P (Cmd+Shift+P on macOS) to open a command palette with curated actions: Change profile, Change color, Rename pane, Profile settings, Shortcuts settings. Selecting "Change profile" opens a second palette listing shell profiles for the focused pane.
- Profile drag-and-drop reordering now persists correctly: moved profiles retain their new order after app restart thanks to a dedicated backend reorder command.
- Refactor AppCommand vocabulary: split `pane.rename` into `pane.rename.start` and `pane.rename.commit`, add `WorkbenchMode` union type, and route command palette actions through the dispatcher instead of calling business objects directly.
- Refactor `command-dispatcher.ts` to operate through domain interfaces instead of directly accessing xterm instances or DOM classes. Terminal commands now use `TerminalSession` methods via a session accessor, and `focus.nextLit` uses runtime alert state queries from `PaneActivityWatcher` instead of reading DOM classes.
- Replace all `window.prompt()` calls with inline input components for a native app experience.

  - Dropdown "Save Current Layout…" now shows an inline popover input next to the layouts button
  - Layout Manager Modal "+" button now inserts an inline input at the top of the layout list
  - Layout Manager Modal rename (✎) now uses in-place editing within the layout item
  - Enter confirms, Escape cancels, blur confirms across all three inputs
- Replace all toolbar and modal Unicode character icons with inline Lucide-style SVG icons for consistent cross-platform rendering. Added `src/icons.js` as an offline icon library (no CDN dependency).
- Rewrote the app with Tauri 2 (Rust backend + vanilla JS frontend), replacing the previous Electron stack. The app now launches faster, uses significantly less memory, and produces native installers (.msi/.exe on Windows, .deb/.AppImage on Linux).
- Session state (pane layout, directories, shell profiles, tab titles) is now restored on app restart.
- Settings UI reorganized with section titles: "Appearance" groups font/pane/display settings, "Alert Settings" groups breathing alert and debounce options. Row spacing increased from 8px to 12px for better readability.
- Settings global breathing switch + per-pane disable (VIB-235)

  - Settings "Activity alert" toggle now controls only the full-pane breathing mask visual effect.
  - When the global switch is OFF, breathing masks don't light up, but the activity watcher, hooks, and floating window consumers continue to work normally.
  - New panes default to having activity monitor enabled (breathingMonitor undefined/true treated as ON).
  - Context menu shows "Disable Alert" (when enabled) or "Enable Alert" (when disabled) per pane.
  - Right-click "Disable Alert" disables ALL alert effects for that pane by calling `watcher.setPaneEnabled(paneId, false)`.
  - Fixed `togglePaneBreathingMonitor` to correctly toggle from the default-ON state on first click.
- Shell Profiles 弹出层去掉外层 Done 按钮，保留右上角 × 关闭叉号即可。内层编辑器已有独立的 Cancel/Save 逻辑，外层按钮视觉冗余。
- Shell profiles are fully editable: users can create, modify, and switch profiles per pane via the right-click context menu. All profiles (auto-detected and user-created) support editing.
- Support `--layout <id>` command-line argument to launch Vibe99 with a specific layout on all platforms. The Rust backend parses the flag and appends it as a URL query parameter (`layoutId`), which the frontend reads on startup. If the requested layout does not exist, a console warning is emitted and the app falls back to the last active layout or default session.
- Support `--layout <id>` command-line argument to launch Vibe99 with a specific layout. The Rust backend parses the flag and appends it as a URL query parameter, which the frontend reads on startup to switch to the requested layout instead of restoring the last session.
- Support layout-level default theme that applies to all panes in the layout, with per-pane theme override. New panes inherit the layout's default theme, and individual panes can override it. Theme resolution priority: per-pane theme > layout default theme > global default. (VIB-331)
- Terminal rendering now uses the WebGL renderer for crisp, properly aligned box-drawing characters and better performance.
- The `vibe99ctl describe` catalogue now lists the routing parameters every method accepts — `windowId` (which window runs the command) and `timeoutMs` (how long the server waits for the frontend) — under `request.params` and in each method's parameter schema, so an agent can target a window and bound the wait without reading the source.
- Unified scrollbar styling across the entire application. All scrollable areas — including the add-pane profile popup, Command Palette list, settings modals, and layout/shell-profile editor panels — now share the same subtle dark scrollbar appearance (6px width, semi-transparent thumb with hover state, thin Firefox scrollbar). Replaced scattered per-component scrollbar rules with global `*`-scoped styles for consistency and easier maintenance (VIB-74).
- Unify the visual appearance of the three top-right dropdown menus (Profile, Layout, Settings):
  - Row spacing is now consistent across all three menus
  - Vertical alignment is based on the Settings panel position
  - Highlight color is unified to the status bar highlight color (#ffd166)
  - Active layout checkmark is replaced with a theme-colored dot
  - Hover effects are unified to the same background highlight
  - Settings panel now shares the same border-radius, shadow, and background as the dropdowns
- WSL integration now auto-detects all installed distributions and creates a shell profile for each one. Distribution names are correctly decoded from UTF-16LE output.
- When a backgrounded pane has settled output you haven't seen yet, the mask now pulses with a brighter accent-tinted breathing glow that stays readable at any "BG mask opacity" value, and switching back to the pane stops it immediately. You can disable the alert globally from Settings → "Background activity alert", or per-pane via the tab context menu.
- ```release-note
  E2E tests for keyboard shortcuts, modal stack, and fullscreen functionality
- `vibe99ctl enhance install claude-code` wires Claude Code's Stop and Notification hooks into Vibe99's breathing activity alert, so a finished turn lights its pane. Installs are backed up, idempotent, documented in `vibe99ctl enhance list`, and reversible with `enhance uninstall`.
- `vibe99ctl settings` now validates every change against a shared schema and applies it to the running app immediately — no restart needed. `settings schema` lists every writable key with its type, range and default, and invalid values are rejected with the field name and accepted range (e.g. `fontSize: expected integer 10-24, got 99`).
- `vibe99ctl` can now create, update and delete shell profiles, so an agent can set up an SSH + tmux/zellij resume profile and open a pane with it in one command (`vibe99ctl profile create ... --open`, or `vibe99ctl pane create --profile <id>`). Writes go through the same settings path as the UI and notify the renderer, so a new profile appears immediately in `shell list`, the Shell Profiles modal and the Change Profile menu. Auto-detected profiles stay read-only, and duplicate ids or display names are rejected instead of silently overwritten.
- `vibe99ctl` now ships with every install — Tauri bundles all bin targets, so the `.deb` puts it on PATH at `/usr/bin/vibe99ctl`, and the AppImage and Windows installers embed it (`--appimage-extract` reaches it in the AppImage). `vibe99ctl install-cli` copies the CLI to `~/.local/bin` and adds it to the user PATH on Windows. Linux/Windows CI artifacts and GitHub Releases now include the bare `vibe99ctl` binary, and `vibe99ctl --version` always matches the app version.

### Fixed

- # Context menu shortcuts now adapt to platform

  The right-click context menu in terminal was always showing Mac-style keyboard shortcuts (⌘) regardless of the operating system.

  Fix: added platform-aware helper functions that return the correct modifier key symbol based on `bridge.platform`, matching the status hint bar formatting:
  - macOS (darwin): Shows ⌘
  - Windows/Linux (win32/linux): Shows ⌃ (Ctrl symbol)

  Affected shortcuts:
  - Copy: ⇧⌘C (macOS) / ⇧⌃C (Windows/Linux)
  - Paste: ⇧⌘V (macOS) / ⇧⌃V (Windows/Linux)
  - Select All: ⌘A (macOS) / ⌃A (Windows/Linux)
- # Terminal display horizontal squeeze fix

  The `.pane-surface` element was covering the full width of the pane including the `6px` horizontal padding baked into `.terminal-host`. This caused xterm.js to count its columns based on a narrower available width, making terminal content appear horizontally compressed.

  Fix: give `.pane-surface` the same `inset: 0 6px` as `.terminal-host` so the terminal host has the same effective width as the full pane.
- # Terminal theme not visually updating

  When changing the theme via right-click menu, the theme state was updated but the terminal display didn't change visually. This was because xterm.js doesn't automatically re-render the buffer when `terminal.options.theme` is changed.

  Fixed by calling `terminal.refresh(0, terminal.rows)` after setting the theme to force xterm.js to re-render the entire buffer with the new colors.
- # Windows shortcut --layout parameter origin fix

  When starting Vibe99 via a Windows shortcut with the `--layout` parameter (e.g. `vibe99.exe --layout my-layout`), the application window would open but the pane would fail to load with the error:
  ```
  http://ipc.localhost/plugin%3Awebview%7Cinternal_toggle_devtools:1 Failed to load resource: the server responded with a status of 500 (Internal Server Error)
  Uncaught (in promise) Origin header is not a valid URL
  ```

  The root cause was in the Rust startup code where the layout ID was appended to the window URL using `url.query_pairs_mut().append_pair()`. This approach could cause URL encoding issues and invalidate the webview's origin header.

  Fix: Use `url.set_query()` with proper percent-encoding of the layout ID parameter to ensure the URL is correctly formatted and the webview's origin remains valid.
- ## Fix e2e tests for Lucide icon migration in shell-profile.spec.js

  Update `clickProfileAction` calls to match button text labels (`'Delete'`, `'Clone'`, `'Set as default'`) instead of Unicode symbols (`'✕'`, `'⧉'`, `'★'`) that are no longer used after Lucide icon migration. The `clickProfileAction` helper already supports `title.includes(label)` matching, so the helper function itself required no changes.
- +[VIB-280] fix: sync per-pane activity alert watcher state on toggle, default new panes to alert enabled
- - **Terminal exit no longer closes pane (VIB-287):** When the terminal process exits (shell crash, SSH disconnect, remote session end), the pane is now preserved instead of being removed. An error-state overlay shows the exit code and a "Restart Terminal" button. Terminal buffer content is preserved for diagnostic purposes. Pane configuration (cwd, shell profile) persists across app restarts via the existing layout save mechanism.
- Activity alert debounce input now clamps out-of-range values (below 3s → 3s, above 300s → 300s) instead of reverting to the default 30s.
- Activity alerts now properly respect OS window focus when float window is open, only fire on visible buffer changes (ignoring escape sequences and cursor movements), and clear when new content arrives after the alert has fired. Breathing intensity setting now immediately toggles global activity alert detection.
- Add missing `webkit2gtk-driver` package to the E2E test CI workflow so that `tauri-driver` can find `WebKitWebDriver` on Ubuntu runners.
- Add missing global-shortcut plugin permissions to `src-tauri/capabilities/default.json` to enable Global Hotkey and Quake Mode features in Settings UI.
- Add node_modules/.bin to PATH in e2e Dockerfiles to fix tauri CLI not found errors during Docker image builds and e2e test execution.
- Background activity alerts no longer pulse for a pane when its visible content is unchanged — resizing and the resulting line rewraps, and TUI apps redrawing the same frame, no longer count as new activity.
- Breathing light now cancels and restarts when new content arrives after the alert has fired. Resize-induced redraws still don't cancel the alert (consistent with VIB-29's resize quiet logic), so only genuine new content can dismiss the breathing animation.
- CJK characters now consume two cells in the terminal grid, matching what modern CLI apps (Claude Code, Ink-based UIs) assume. Lines with Chinese, Japanese, or Korean input no longer drift left when the app redraws after IME composition.
- Changing any UI setting (font size, opacity, etc.) no longer resets floating window state. The settings save previously rebuilt the file without the saved float window data.
- Closing a layout window (including the main/default layout window) no longer kills PTY sessions belonging to other layout windows. Previously, closing the main window called `destroy_all_terminals`, which destroyed all PTY sessions globally regardless of which window they belonged to.
- Closing a tab via the close button (×) now correctly transfers focus to the adjacent pane. Previously, focus remained on the closed tab's terminal, requiring manual click to continue typing.
- Comprehensive fix for persistent high GPU usage (80-95%) during idle. Removes `will-change: left` from `.pane` (replaced with `contain: layout style paint`), fixes xterm `allowTransparency` initialization, centralizes cursorBlink control in `renderPanes()` with visibility awareness, and pauses breathing CSS animations when window is hidden.
- Cursor blink is now disabled on unfocused terminals and when the window is hidden, significantly reducing idle GPU usage caused by the xterm WebGL renderer's continuous re-render loop.
- Default terminal font now includes a CJK fallback per platform (PingFang SC on macOS, Microsoft YaHei on Windows, Noto Sans CJK SC on Linux), reducing the wide-character glyph glitches that appeared when relying on opaque OS font substitution.
- Filter IME composition events from keyboard dispatcher to prevent character duplication on Linux/Tauri with WebkitGTK. Events with `isComposing===true`, `keyCode===229`, or `key==="Process"` are now skipped, allowing Chinese input methods (Fcitx5, iBus) to work correctly without accumulating duplicate characters in xterm.js's hidden textarea.
- Fix Ctrl+Arrow / navigation focus not transferring keyboard input to target pane. `focus.left`, `focus.right`, `focus.next`, `focus.prev`, and `focus.at` handlers now call `focusSession()` and `setMode('terminal')`, matching the behavior of `pane.focus` and `focus.recent`.
- Fix E2E layout tests by ensuring clearAllLayouts() recreates the default layout after deleting all layouts. The app expects a default layout to exist for consistent behavior across tests. Also fix test to use 'Default' (capitalized) instead of 'default' when clicking the default layout in the dropdown. (VIB-244)
- Fix E2E test runner to automatically rebuild the Tauri application binary when frontend source files are newer than the existing binary. This ensures Docker E2E environments (e.g. vibe99-builder) always test against the latest frontend code instead of a stale pre-built binary.
- Fix Layout modal "Add" button to create a new default three-pane layout instead of saving the current window state as a new layout. The new layout is no longer auto-selected; users must manually switch to it. (VIB-239)
- Fix Windows build error: `to_string_lossy()` on String type and unused variable on Windows in CLI server.
- Fix bug where copying a Shell Profile and then editing/saving it would create a duplicate profile instead of updating the copied one. The fix adds an `originalId` field to track the original profile ID during clone operations, ensuring the save operation updates the correct profile.
- Fix e2e test runner on Ubuntu 20.04 with jammy webkit but without linuxbrew glibc: use run-app.sh shim to set LD_LIBRARY_PATH for the app, and strip custom library paths from the environment before launching Xvfb and tauri-driver so they use system glibc. Also fix WebKitGTK compatibility: getTextSafe for tab labels, dispatched mouse events for submenu clicks, Ctrl+C before commands to clear stale state, pane count assertion for last-pane exit test, and remove bridge.closeWindow() on last pane exit.
- Fix float window breathing animation glow not rendering due to invalid CSS color-mix() percentage value (missing % suffix).
- Fix layout theme picker to use the same `createCustomSelect` component as shell profiles, removing custom inline picker implementation. Refresh terminal themes immediately when layout theme changes by dispatching `pane.setTheme(null)` for all panes without explicit themes.
- Fix layout.spec.js e2e failures: update test helpers to match current UI (rename via editor panel, correct delete button index), revert clearAllLayouts() default layout recreation that broke empty-state tests, and create default layout via bridge in the test that needs it. (VIB-247)
- Fix regression in `focus.nextLit` command where panes with alerted DOM state but uninitialized activity watcher state were not being detected. The command now checks both the activity watcher's internal state (primary) and the DOM class (fallback) to handle edge cases like E2E testing scenarios where the DOM class is set directly.
- Fix session-persistence E2E test by disabling auto-save during test saves. The previous flush() approach was causing additional saves that overwrote the test's explicit layout data.
- Fixed "switches terminal shell from context menu" e2e test timeout in Docker/Xvfb by replacing unreliable `moveTo()` hover with JS-forced submenu display (CSS `:hover` doesn't fire in headless WebKitGTK).
- Fixed E2E smoke test keyboard input case failing on CI by replacing the brittle `browser.pause(1000)` with `waitForTerminalOutput`, which polls until the terminal text appears. This handles slower PTY initialization in webkit2gtk headless environments.
- Fixed ESC key regression where several modals and popups could not be closed with Escape:

  - Layout Manager modal now registers with the modal stack and closes on ESC.
  - Layouts dropdown now closes on ESC.
  - Add-pane profile popup now closes on ESC.
  - Context menu now closes on ESC.
  - Confirm dialog in keyboard shortcuts modal now closes on ESC.
  - Command palette ESC handler now stops propagation to prevent double-closing.
  - Global ESC handler now calls `preventDefault()` to stop the browser from exiting fullscreen.
  - `closeTopModal()` only returns focus to the terminal when the last modal is closed, preserving focus in layered modal scenarios.
  - Inline tab rename now stops propagation on ESC to avoid triggering modal closing.
  - `closeKeyboardShortcutsModal()` and the Layouts modal's `closeModal()` now properly unregister themselves from the modal stack.
- Fixed PowerShell sessions failing with `cargo metadata` OS error 448 when the saved working directory is a WSL UNC path (`\\wsl.localhost\...`) or POSIX path (`/home/...`). These paths are now rejected during cwd resolution for native Windows shells, falling back to the system cwd or home directory instead.
- Fixed PowerShell sessions still failing with `cargo metadata` OS error 448 when the saved working directory is a forward-slash WSL UNC path (`//wsl.localhost/...`) or a Windows junction/symlink that resolves into the WSL filesystem. The cwd resolver now normalizes path separators before checking and canonicalizes accepted paths to detect indirect references to WSL mounts.
- Fixed a race condition in `clearAllLayouts()` E2E helper that caused layout count mismatches in `layout.spec.js`. The helper now flushes pending frontend layout saves and resets the window layout binding before deleting backend layouts, preventing stale `windowLayoutId` from recreating a deleted layout.
- Fixed a race condition where settings could occasionally load stale values after toggling the settings panel. Added a `SettingsState` mutex to serialize all `settings.json` read/write operations on the backend, and ensured the settings UI is refreshed from in-memory state every time the panel is opened.
- Fixed font settings (family & size) leaking from terminal to UI menus, toolbar, and settings panel. Font settings now only affect the xterm terminal display.
- Fixed last pane exit incorrectly closing the application window instead of keeping it open.
- Fixed layout "Open in New Window" causing the new window to show a white screen and freeze. PTY terminal-data and terminal-exit events are now scoped to the owning window via `emit_to`, and window destroy cleanup is per-window instead of destroying all sessions globally.
- Fixed layout list not refreshing immediately after saving a layout in the Layout Manager Modal. Replaced debounced `scheduleSettingsSave()` with immediate `flushSettingsSave()` after `saveLayout` to prevent stale pending saves from overwriting settings, and added `updateLayoutsIndicator()` to keep the layouts button aria-label in sync. This aligns the modal save behavior with `saveCurrentLayout`, `switchLayout`, and `deleteLayoutById`.
- Fixed layout new-window white screen: PTY `spawn()` now only destroys sessions in the same window (preventing cross-window pane ID collisions), `layout_open_window` uses URL query params instead of `initialization_script` for reliable layout detection, and init failures now show a visible error instead of a blank page.
- Fixed missing `getTabCount` import in `command-palette.spec.js`. The function was being called in tests but was not imported from `app-launch.js`, causing E2E test failures with "ReferenceError: getTabCount is not defined".
- Fixed new panes being assigned the same color as an existing pane when the existing pane had a custom color. The color deduplication logic now considers both `customColor` and `accent` when building the used-colors set.
- Fixed pane content loss when switching layouts: `restoreSession()` now preserves original pane IDs instead of renumbering, preventing `ensureSessions()` from destroying and recreating TerminalSessions with empty buffers. Also fixed `refreshActivitySnapshots` crash when workbench manages sessions. Replaced sequential pane ID scheme (`p1`, `p2`, …) with `crypto.randomUUID()` — eliminates the need for a `nextPaneNumber` counter and its serialization plumbing. Removed dead `sessionMap` legacy path from pane-renderer (workbench is always provided).
- Fixed shell profile switching to fail explicitly when a requested profile is invalid, rather than silently falling back to a default shell and polluting the layout with the bad profile ID.

  Backend: Modified `shell_candidates()` in `src-tauri/src/pty/mod.rs` to only try the exact requested profile when `shell_profile_id` is `Some(id)` - no fallback to detected shells. The spawn() call now returns a clear error when the requested profile doesn't exist or has an invalid command.

  Frontend: Modified `changePaneShell()` in `src/pane-renderer.ts` to only update `paneState.shellProfileId` and save the layout after the PTY starts successfully. The `initializePty()` function in `src/runtime/terminal-session.ts` now accepts an optional `requestedProfileId` parameter to use the requested profile directly instead of reading from the pane snapshot.
- Fixed stale element reference in tab drag E2E test. `renderTabs()` calls `replaceChildren()` during drag, invalidating element references in the WebDriver action chain. The `dragTab` helper now uses viewport coordinates instead of element references.
- Fixed style conflict between terminal exit overlay and non-focus pane mask. The restart terminal overlay now properly overrides the breathing alert animation when a terminal exits, ensuring consistent visual behavior regardless of the pane's focus or activity state.
- Fixed terminal theme changes from the right-click menu so selecting a theme immediately updates the active xterm instance and preserves that selected theme across later accent/layout renders.
- Fixed toolbar settings button (gear icon) being visually lower than the other toolbar buttons (+tab, fullscreen). Changed `.tabs-actions` from `align-items: stretch` to `align-items: center`, and added `vertical-align: middle` + `line-height: 1` to all three icon buttons for consistent vertical alignment.
- Float Window breathing glow now keeps its pure accent color on warm-hue blocks (red/orange, hue ~0-30°). The previous luminance-based white mix produced a pinkish or peach tone for those hues that no longer matched the block body; cool and yellow accents are unchanged.
- Float window pane blocks now correctly resolve click targets via delegated event handling (data-pane-id), fixing a bug where reusing DOM blocks after a mid-array pane insertion left stale click handlers referencing the wrong pane.
- Float window position persistence now uses logical coordinates converted by the float window's own devicePixelRatio instead of the parent window's DPI. This fixes position jumping when the float window is on a different monitor than the parent window in multi-monitor setups with different DPI scales.
- Follow OSC 8 embedded hyperlinks on Ctrl+click by opening them through the opener plugin. The app only wired plain-text URLs (WebLinksAddon); for OSC 8 hyperlinks xterm fell back to its default activation, which calls `window.confirm()` — a global that tauri-plugin-dialog's init script overrides with the `plugin:dialog|confirm` IPC command. That command is not in the app's capability set (`dialog:default` grants only message/save/open), so release builds rejected it with "Command plugin:dialog|confirm not allowed by ACL", the rejection surfaced in the status bar via the unhandledrejection handler, and the link never opened. A `TerminalOptions.linkHandler` now routes OSC 8 activation through the same bridge path as WebLinksAddon, with no confirm prompt.
- Fullscreen now uses the Tauri window fullscreen API when running in the desktop app, so Esc no longer exits fullscreen; F11 toggles fullscreen explicitly.
- Keyboard shortcut settings UI now shows proper names and descriptions for all shortcuts, including "New Pane with Profile" and "Open Layouts". Fixed inconsistent terminology (Tab vs Pane) and improved clarity of navigation mode labels.
- Move Global Hotkey and Quake Mode settings from standalone settings panel into Layout Editor inline fields. Quake mode is now per-layout (stored as `quakeLayouts` Record keyed by layout ID) instead of a global toggle. The standalone Layout Hotkeys modal is replaced by inline hotkey recording in each layout's editor panel.
- Per-pane terminal themes now survive an app restart. Previously the theme picked via right-click → Change Theme was saved in memory but stripped when the layout was written to disk, so panes fell back to the default (or layout) theme after relaunch. The per-pane background-activity-alert toggle now persists the same way.
- Quake window now hides on blur (focus loss), handles rapid hotkey presses correctly with debounce and serialized toggle, and refits terminal content when DPI/scale changes across monitors.

  #### Toggle race condition fix (revised)

  The previous fix only let the main window handle layout toggles, which breaks when no main window exists. Revised to a per-window ownership model: each layout window handles its own toggle (works standalone), while the main window only creates new layout windows (avoids double-toggle). Quake repositioning is now also applied in the self-toggle path.
- Quake window now opens on the monitor where the cursor is instead of always following the main window. Terminal content also refits correctly after viewport changes.
- Remove dead shell profile rendering code that was left after VIB-14 moved shell profiles to modal dialogs. The code referenced a non-existent `shell-profile-list` DOM element and was never called.
- Removed the red border on exited terminal panes so the pane border stays consistent with other panes. The restart terminal overlay still appears when focused.
- Replace box-shadow animation with static box-shadow + opacity-only keyframe animation in breathing light. box-shadow cannot be GPU-composited and forces full repaints every frame (38-50% GPU). Now only opacity is animated (GPU-compositable), reducing GPU usage to near-zero during breathing.
- Reset xterm mouse tracking state (in-band RIS, `ESC c`) on shell restart and profile switch, and join the PTY reader thread when a pane session is destroyed. Previously `terminal.clear()` only emptied the buffer: if a TUI app exited abnormally without DECRST, the restarted shell inherited active mouse tracking (DECSET 1000/1002/1003 + SGR 1006), and mouse events were encoded as SGR reports the shell never asked for — leaking as visible garbage like `35;98;27M`. The backend fix also prevents a replacement PTY from inheriting the old session's in-flight output for the same pane id.
- Resizing the window no longer makes background panes pulse. The PTY redraw burst that follows a SIGWINCH was being treated as fresh output; it's now ignored until the pane has been silent for a beat, so even heavy multiplexer redraws (zellij, tmux) don't trip the alert.
- Restore "Set as Default" button in Layout Manager. This button was incorrectly removed in VIB-338; "Set as Default" (sets the layout template for new windows) and "Auto-start on boot" (auto-opens layouts at system boot) are separate features that should both be available.
- Restored icon buttons (star, copy, delete) in the Shell Profiles editing panel sidebar. Buttons now render as SVG icons with `aria-label` and `title` tooltips instead of plain text labels.
- Restored the original breathing alert (the color card fades to transparent and back while a background pane waits) and fixed the states that left panes stuck without a card. The breathing glow had been silently dead for a long time — its style token referenced the per-pane accent color from :root, where that variable does not exist, so the pulse was the only thing ever rendered. An exited pane with a lingering alert also froze at the transparent trough permanently, reading as a vanished color card; exited panes now drop the alert and return to their resting card, and unfocused exited panes keep the card behind the restart overlay.
- Saved layouts now remember their window position and size. The geometry written by "Save Layout As…" was silently dropped when the layout was written to disk, so reopening a layout in a window never restored where it used to be.
- Shell Profile drag-and-drop reordering is fixed: user-created profiles can now actually be reordered by dragging. The "forbidden" cursor and no-op drops were caused by the dragover/drop handlers being attached only to individual rows (gaps between rows showed the no-drop cursor and swallowed the drop) and by the `draggable` attribute being set only via the IDL property, which some WebKit builds ignore on dynamically created elements. Detected profiles now also show a `not-allowed` cursor so their immutability is visible.
- Standardized input heights across settings UI (26px), removed !important overuse from button styles, unified gap/spacing values for layout manager modal, settings panel, shell profiles, and form controls.
- Store shell profile args as raw string instead of parsed array, preserving user input exactly (including quotes and spaces). Legacy `string[]` format is automatically migrated on load. Args are parsed into `Vec<String>` only at PTY spawn time.
- The Rust backend builds again: a stray brace and duplicated test modules — leftovers from the `describe` refactor — broke the compile of `src-tauri/src/commands/cli.rs` and `src-tauri/src/bin/vibe99ctl.rs` after it landed on `main`.
- The Windows installer now leaves `vibe99ctl` ready to use: it copies the CLI to `%USERPROFILE%\.local\bin` and appends that directory to your user PATH, so a newly opened terminal finds the command without running `install-cli` yourself. `install-cli` is safe to re-run and now reports a PATH update it could not perform instead of exiting successfully.
- WSL+zsh: Ctrl+ArrowLeft/Right no longer sends garbage characters (e.g. `5D`) to the terminal. These sequences are now intercepted in xterm.js's `attachCustomKeyEventHandler` and returned false so the event reaches the window-level dispatcher for pane navigation (VIB-71).
- When xterm.js has `allowTransparency=true`, it ignores the theme's background
  color and renders the canvas transparently even if the theme specifies an opaque
  color (e.g., `#ffffff` for light themes).

  Fixed by dynamically setting `allowTransparency` based on whether the theme's
  background color has transparency:
  - Transparent themes (background like `#11111100`) → `allowTransparency=true`
  - Opaque themes (background like `#ffffff`) → `allowTransparency=false`

  This allows light themes to actually show a white background instead of
  remaining transparent.
- fix: always include layoutHotkeys and quakeLayouts in sanitized settings output

  When settings are reset via E2E tests, the sanitized settings would not include
  `layoutHotkeys` and `quakeLayouts` fields because they weren't present in the
  reset payload. The Rust `sanitize_ui_config` function now always includes these
  fields with empty objects when not present in the input, matching the frontend
  schema's default({}) behavior.

  This fixes E2E test failures where `settings.ui.layoutHotkeys` and
  `settings.ui.quakeLayouts` were undefined after `resetSettings()`.
- fix: include layoutHotkeys and quakeLayouts in default settings

  When settings are initialized with defaults (file not exists or invalid), the
  sanitize_config function was creating the ui object directly without calling
  sanitize_ui_config. This meant that layoutHotkeys and quakeLayouts fields were
  missing from the default settings, causing E2E tests to fail when accessing
  settings.ui.layoutHotkeys or settings.ui.quakeLayouts.

  The default case now calls sanitize_ui_config(None) to ensure these fields are
  always present with empty objects, matching the behavior of the other migration
  paths.
- fix: navigation mode exited prematurely by focus.next/prev/at, E2E test race condition and shortcut name mismatch (#VIB-329)

  Three E2E test failures fixed:
  - `pane-management.spec.js`: focus.next/prev/at called setMode('terminal')
    which exited nav mode; now only exits when not already in nav mode
  - `shortcuts-modal-stack-fullscreen.spec.js`: shortcut renamed "New Tab"
    to "New Pane" but test still searched for "New Tab"
  - `session-persistence.spec.js`: debounced layout auto-save overwrote
    test's 4-pane layout with current window's 3-pane layout between
    assertions; disabled auto-save for the full test duration
- vibe99ctl now reports live runtime state: `pane list` sees panes created after launch, `pane info` and `layout active` return the running window's current pane/layout, and `terminal send-keys`/`resize` reach panes in any window (new global `--window` flag). Failed commands exit non-zero, and the server honors the CLI's `--timeout` instead of a fixed 5s wait.
- 修复 `resetSettings()` E2E helper 中的竞态条件：未 await `settings_load()` 的 Promise，导致前一个测试的 debounce 值残留到下一个测试，引发 `Expected: 30, Received: 3` 断言失败。
- 修复 `resetSettings()` 中 `settings_save` 未 await 的竞态条件，并更新呼吸灯测试以适配 VIB-260 的分段按钮 UI。解决 `Expected: 30, Received: 3` 和 `Expected: true, Received: false` 两个断言失败。

### Documentation

- Add Dockerfile.e2e and usage documentation for building and running e2e tests in Docker. Make context-menu tests Docker-robust by replacing keyboard shortcuts with DOM button clicks.
- Added comprehensive feature documentation in `docs/features/` covering multi-pane layouts, layouts system, float window, quake mode, shell profiles, activity alerts, keyboard shortcuts, and breathing light effects. Includes GIF recording guide in `docs/gifs/` with tool recommendations and production guidelines.
- Added design document for session restore upgrade (VIB-28): shell-cwd persistence via OSC 7, versioned SessionState, 5s debounce auto-save, edge case handling, and Zellij alignment.
- Added the WSL design document `docs/design/wsl-cli.md`: evaluation of interop-wrapper vs loopback-TCP vs pipe-bridge options, the security-model analysis (no-auth socket, WSL boundary, token scope), the client transport resolution order, distribution plan, phased implementation and a risk table.
- Expanded README with installation guide, keyboard shortcuts reference, layout management, shell profiles, project structure, and platform-specific notes.
- README Controls table now matches the actual key bindings: new pane is `Ctrl+N` (not `Ctrl+T`), and the command palette and copy/paste shortcuts are listed.

### Removed

- Remove `terminalHost`, `terminal`, and `fitAddon` from the exported `TerminalSession` interface. These xterm.js implementation details are now internal to `terminal-session.ts`. External code uses only the public domain methods (I/O, clipboard, sizing, shell management, state queries).
- Remove legacy hotkey/quake code that was never shipped:
  - Delete dead `layout-hotkeys-ui.ts` (standalone modal, replaced by inline fields in layout editor)
  - Delete dead `quake-animation.ts` (used old schema with screenPosition/heightPercent, never imported)
  - Remove `LegacyQuakeMode` interface (migration type for never-shipped global quakeMode)
  - Remove quakeMode migration from `migrateLegacySettings()` 
  - Rename `quakeModePositionSchema` → `quakePositionSchema` (drop legacy "Mode" naming)
- Removed `PaneRenderer.getNode()`, `PaneNode` type, and direct terminal manipulation methods (`copySelection`, `pasteInto`, `selectAll`, `initializePaneTerminal`). All call sites now access sessions through the `Workbench` or `TerminalSession` directly.
- Removed all session runtime operations from `PaneRenderer`: `ensurePaneNodes`, `destroyPane`, `focusTerminal`, `blurTerminal`, `restartPaneTerminal`, `changePaneShell`, `setSessionReady`, `getShellChangeTime`, `isShellChanging`. Callers now use `Workbench.session()` / `TerminalSession` methods directly.
- UI modules (tab-bar, context-menus, command-palette-entries) now only read state through read-only getters and execute business actions through `dispatch()`. Removed direct `PaneState` and `PaneRenderer` dependencies from UI layer; keyboard copy/paste now dispatches `terminal.copy`/`terminal.paste` instead of calling session methods directly.

### Misc

- Added `scripts/bump-version.mjs` to synchronize version numbers across package.json, tauri.conf.json, and Cargo.toml from a single command.
- Added e2e test for "Save As Layout" behavior. Test verifies that clicking "default" in the layouts dropdown after using "Save Layout As..." opens a new window with the default layout instead of reusing the main window (VIB-205).
- Docker E2E builder now preserves incremental compilation cache between builds, avoiding the need for a full 10+ minute recompilation on every image rebuild.
- Merge `main` branch into `autoproj/phase2-domain-refactor` branch to resolve merge conflicts:

  - **E2E test fixes from main:**
    - VIB-273: Fix handling of non-numeric debounce input
    - VIB-274: Improve Dockerfile.e2e with COPY instead of git clone
    - VIB-264: Fix settings_save await in resetSettings

  - **Resolved merge conflicts:**
    - `CHANGELOG.md`: Took main's version with consolidated entries
    - `e2e/helpers/settings-helpers.js`: Merged async error handling from main
    - `e2e/tests/settings.spec.js`: Merged breathing intensity test updates

  The phase2 branch is now up-to-date with main and ready for E2E testing.
- Upgraded GitHub Actions to Node.js 24 compatible versions:
  `actions/checkout@v4` → `v5`, `actions/setup-node@v4` → `v5`,
  `actions/upload-artifact@v4` → `v6`, `actions/setup-python@v5` → `v6`.

Changelog

### [Unreleased]

## 0.22.5

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
