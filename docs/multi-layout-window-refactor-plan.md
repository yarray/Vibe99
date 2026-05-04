# Multi-Layout Window Refactor Plan

## Goal

Make opening a saved layout in a new window reliable by treating each window as an explicit runtime workspace, instead of patching the original single-window architecture.

The refactor should guarantee:

- A saved layout can open in a new window without white-screening or freezing.
- Main-window panes and layout-window panes are isolated.
- PTY sessions are scoped by window and pane.
- Layout windows do not overwrite global `activeLayoutId` or `settings.session`.
- Window creation has one clear owner and one clear async model.
- Cleanup cannot block the Tauri window event thread.

## Design Principles

This plan follows the local `~/coding-taste-guide` principles:

- **P1: restrained modeling**: keep a small set of concepts instead of adding ad hoc helpers.
- **P3: make errors structurally hard**: cross-window PTY mistakes should be impossible by key design.
- **P7: layered abstraction**: frontend owns UI window navigation; backend owns persisted data and PTY resources.
- **P9: contract first**: define window/session ownership before changing implementation.

## Current Architecture Problem

The existing app was designed around a single-window assumption:

- `renderer.js` has process-global `panes`, `paneNodeMap`, `activeLayoutId`, and `session`.
- `PtyManager` originally keyed sessions by `pane_id`, assuming pane IDs are globally unique.
- `settings.json` stores one global `session` and one global `activeLayoutId`.
- Layout-window support was added without redefining which window owns global session persistence.

Multi-layout windows break those assumptions. A secondary window can currently run the same boot and save logic as the main window, which means it can write global session state or active layout state. That is an architecture bug, not just a missing `await` or `emit_to`.

## Target Model

Introduce these domain concepts:

- `LayoutRepository`: persisted saved layouts and layout metadata.
- `WorkspaceWindow`: a runtime window instance with `windowLabel`, `kind`, and optional `layoutId`.
- `TerminalRegistry`: runtime PTY sessions keyed by `(windowLabel, paneId)`.
- `SettingsStore`: global user settings and the main window's restorable session.

Window kinds:

```ts
type WindowKind = 'main' | 'layout';

type WindowContext =
  | { kind: 'main' }
  | { kind: 'layout'; layoutId: string };
```

Rules:

- Main window may read and write `settings.session`.
- Main window may read and write `activeLayoutId`.
- Layout windows read their target layout and create runtime panes.
- Layout windows must not write `settings.session`.
- Layout windows must not write `activeLayoutId`.
- Every terminal command operates on the calling Tauri window.
- The frontend never passes `windowLabel` to terminal commands.

## Phase 0: Clean Up Experimental Changes

Before implementing the refactor, clean up local experimental changes:

- Remove the Rust `run_on_main_thread` fire-and-forget layout window creation.
- Remove hand-written query encoding and window-label helpers from Rust layout commands if window creation moves to the frontend.
- Keep the idea of PTY compound keys, but formalize it cleanly.
- Keep `switchLayout` as a synchronous function unless it actually awaits something.
- Keep `capabilities.default.windows = ["*"]`.
- Review pure `cargo fmt` churn and revert unrelated formatting if it is not part of the refactor.

## Phase 1: Add Window Context

Add a small frontend helper:

```js
function getWindowContext() {
  const params = new URLSearchParams(window.location.search);
  const layoutId = params.get('layoutId');
  return layoutId ? { kind: 'layout', layoutId } : { kind: 'main' };
}
```

Store it once during module initialization:

```js
const windowContext = getWindowContext();
const isMainWindow = windowContext.kind === 'main';
```

Use this context to control initialization and persistence.

## Phase 2: Move Layout Window Creation to the Frontend

Window creation is UI navigation. It should not be a Rust layout command.

Implement a frontend bridge method using Tauri's `WebviewWindow` API:

```js
function openLayoutWindow(layout) {
  const label = `layout-${safeWindowLabel(layout.id)}-${Date.now()}`;
  const url = `index.html?layoutId=${encodeURIComponent(layout.id)}`;
  const win = new WebviewWindow(label, {
    url,
    title: `Vibe99 - ${layout.name || layout.id}`,
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    center: true,
  });
  return waitForWindowCreatedOrError(win);
}
```

All layout-open UI paths should use this single frontend helper:

- layout dropdown
- layouts modal
- command palette

Remove or deprecate Rust commands:

- `layout_open_window`
- `layout_open_in_new_window`

Update:

- `src-tauri/src/main.rs` invoke handler
- `createTauriBridge()`
- unavailable bridge fallback
- command palette actions
- layouts UI actions

Capability update:

```json
"core:webview:allow-create-webview-window"
```

Keep `windows: ["*"]` so child windows can use the same command/event permissions.

## Phase 3: Stop Layout Windows from Persisting Main Session

Split persistence by ownership.

Main window can persist:

- UI settings
- `settings.session`
- `activeLayoutId`

Layout windows can persist:

- ideally nothing automatically
- or only UI settings if that is intentionally global

Change these paths:

- `scheduleSettingsSave()`
- `flushSettingsSave()`
- `beforeunload`
- `switchLayout()`
- startup default/active layout selection

Suggested shape:

```js
function buildSettingsPayloadForCurrentWindow() {
  const payload = {
    version: 5,
    ui: buildUiSettings(),
  };

  if (isMainWindow) {
    payload.session = buildSessionData();
    payload.activeLayoutId = activeLayoutId;
  }

  return payload;
}
```

For layout windows:

- loading `layoutId` should not assign global `activeLayoutId`.
- closing the window should not flush `session`.

## Phase 4: Formalize PTY Compound Addressing

Backend PTY sessions must be keyed by window and pane:

```rust
#[derive(Clone, Eq, Hash, PartialEq)]
struct PaneRef {
    window_label: String,
    pane_id: String,
}
```

`PtyManager` should expose operations in this form:

```rust
spawn(app, window_label, pane_id, ...)
write(window_label, pane_id, data)
resize(window_label, pane_id, cols, rows)
destroy(window_label, pane_id)
destroy_window(window_label)
```

Tauri commands should take `Window` and derive the label internally:

```rust
#[tauri::command]
pub fn terminal_write(window: Window, state: State<AppState>, pane_id: String, data: String) {
    state.pty.write(window.label(), &pane_id, data)
}
```

Rules:

- Frontend sends only `paneId`.
- Backend derives `window.label()`.
- Events are emitted with `emit_to(window_label, ...)`.
- Cross-window same-pane IDs are valid.

## Phase 5: Make PTY Exit Semantics Explicit

Currently a `terminal-exit` event means "close the pane" in the renderer. That conflates natural shell exit with intentional backend cleanup.

Add an exit reason:

```rust
enum TerminalExitReason {
    Exited,
    Killed,
}
```

Payload:

```json
{
  "paneId": "p1",
  "exitCode": 0,
  "reason": "exited"
}
```

Renderer behavior:

- `reason === "exited"`: show exit message and close pane/window according to existing behavior.
- `reason === "killed"`: ignore for UI auto-close, or show only if useful for diagnostics.

This prevents pane cleanup, shell switching, and window destruction from being interpreted as user-visible shell exits.

## Phase 6: Non-Blocking Window Cleanup

`on_window_event(WindowEvent::Destroyed)` must not block the Tauri window event thread.

Rules:

- Remove owned PTY sessions from the registry under lock.
- Release the lock.
- Kill sessions.
- Do not synchronously wait in the window event callback.
- If joining reader/exit threads is necessary, do it in a background cleanup thread.

Suggested shape:

```rust
pub fn destroy_for_window(&self, window_label: &str) {
    let sessions = self.take_sessions_for_window(window_label);
    std::thread::spawn(move || {
        for session in sessions {
            session.kill();
            session.join_best_effort();
        }
    });
}
```

No `join()` while holding the PTY registry lock.

## Phase 7: Simplify Renderer Initialization

Make startup a single clear async sequence:

1. `await bridge.cwdReady`
2. `const savedSettings = await bridge.loadSettings()`
3. apply UI settings
4. load shell profiles
5. `const layoutConfig = await bridge.listLayouts()`
6. derive `windowContext`
7. select session source:
   - layout window: target saved layout from `layoutId`
   - main window: default layout, active layout, saved session, or initial panes
8. `restoreSession(source)`
9. `render(true)`
10. `sessionRestoreComplete = true`

Rules:

- Await every real async operation.
- Do not mark sync functions `async`.
- Initialization errors must render visible DOM feedback.
- `reportError()` should tolerate partially initialized DOM.

## Phase 8: Slim Rust Layout Commands

After frontend owns window creation, Rust layout commands should only manage data:

- `layouts_list`
- `layout_save`
- `layout_delete`
- `layout_rename`
- `layout_set_default`

Remove Rust layout window commands from:

- `src-tauri/src/commands/layout.rs`
- `src-tauri/src/main.rs`
- frontend bridge
- fallback bridge

This makes the backend contract simpler and removes the WebView build/invoke startup loop.

## Phase 9: Tests and Verification

Static checks:

```powershell
$env:CARGO_TARGET_DIR='target-codex'; cargo check
npm run vite:build
```

Manual verification:

- Open main window.
- Open layout A in a child window.
- Child window renders panes and starts terminals.
- Main and child can both have `p1`.
- Typing in child `p1` does not affect main `p1`.
- Resizing child panes does not resize main PTY.
- Closing child window does not close main PTY.
- Closing child window does not change `settings.session`.
- Closing child window does not change `activeLayoutId`.
- Opening the same layout multiple times creates distinct windows.
- Shell natural exit still closes pane/window according to existing behavior.

Minimal automated tests to add if practical:

- `getWindowContext('?layoutId=abc')` returns layout context.
- `getWindowContext('')` returns main context.
- layout-window settings payload does not include `session`.
- layout-window settings payload does not include `activeLayoutId`.
- Rust `PaneRef { window: A, pane: p1 } != PaneRef { window: B, pane: p1 }`.

## Implementation Order for the Next Session

1. Clean current experimental diff.
2. Add frontend `WindowContext`.
3. Prevent layout windows from persisting main session and active layout.
4. Move layout window creation to frontend `WebviewWindow`.
5. Remove Rust layout window creation commands.
6. Formalize PTY `PaneRef`.
7. Make cleanup non-blocking.
8. Add exit reason if needed to prevent killed sessions from closing UI.
9. Run static checks.
10. Manual test the multi-window scenarios.

## Key Decision

Do not model "open layout in new window" as a Rust layout command.

It is frontend UI navigation. Rust should provide persisted layout data and terminal resources; the frontend should create and initialize windows using Tauri's standard window API.
