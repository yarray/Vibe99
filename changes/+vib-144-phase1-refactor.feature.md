## Summary

Phase 1 refactor: split large files (renderer.js, styles.css, pty.rs) into ≤600-line modules without changing data models or abstractions.

## Motivation

- renderer.js (4262 lines), styles.css (2344 lines), pty.rs (1005 lines) far exceed maintainable size
- No behavior change; purely structural reorganization
- Pave the way for Phase 2 (Pane Entity) without redesigning abstractions

## Scope

### Frontend (renderer.js → 8 modules)
- bridge.js (~250L) — IPC bridge
- pane-state.js (~300L) — pane state + collection operations
- pane-renderer.js (~400L) — xterm + DOM rendering
- tab-bar.js (~350L) — tab bar
- shell-profiles.js (~450L) — shell profile management
- context-menus.js (~400L) — context menus + color picker
- settings.js (~200L) — app settings
- renderer.js (~300L) — orchestration entry point

### CSS (styles.css → 6 files)
- base.css, tabs.css, panes.css, settings-modal.css, overlays.css, animations.css

### Rust (pty.rs → 2 files)
- mod.rs (~300L) — PtyManager core
- shell_resolver.rs (~500L) — shell discovery

## Constraints

- No changes to data models or abstraction layers
- All new modules use `createXxx(deps)` factory pattern with deps injection
- No direct cross-module access to `panes[]` / `paneNodeMap`; use injected callbacks
- All target files ≤ 600 lines

## Acceptance Criteria

- All target files ≤ 600 lines
- All existing functionality unchanged
- Consistent `createXxx(deps)` factory pattern
- Bridge internally grouped by domain
- E2E tests runnable on GitHub CI (manual trigger)