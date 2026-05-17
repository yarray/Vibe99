# [VIB-272] feat: slim renderer.ts to bootstrap entry

## Summary

`renderer.ts` has been reduced from ~800 lines to ~120 lines, becoming a pure bootstrap entry that only performs module creation, dependency injection, and global event wiring. All orchestration logic has been moved to the new `src/runtime/workbench-renderer.ts`.

## Changes

### renderer.ts
- Reduced to bootstrap-only responsibilities:
  - DOM element references
  - Bridge creation + E2E instrumentation
  - `createWorkbenchRenderer()` invocation
  - Global window event binding (keydown, resize, pointerdown, DOMContentLoaded, beforeunload, etc.)
  - Toolbar button click handlers
- No longer directly operates on pane arrays or `paneNodeMap`
- No longer contains business rules (mode switching, layout restore, terminal exit handling, etc.)

### New files
- `src/runtime/workbench-renderer.ts` — Contains all previous orchestration logic:
  - Module creation (paneState, layoutManager, settingsManager, tabBar, paneRenderer, command dispatcher, etc.)
  - Business-rule helpers (`handleTerminalExit`, `applyBreathingIntensity`, `showLayoutFocusNotice`, etc.)
  - Keyboard action dispatching
  - `init()` and `dispose()` lifecycle methods
  - Event handler callbacks exposed to the bootstrap entry

### Removed files
- `src/pane-operations.ts` — Dead code, no longer imported anywhere (all operations migrated to command dispatcher)

## Acceptance criteria

- [x] `renderer.ts` ≤ 200 lines (actual: ~126 lines)
- [x] `renderer.ts` no longer directly operates on pane arrays or paneNodeMap
- [x] `npx tsc --noEmit` passes (verified)
- [ ] All E2E tests pass (to be verified separately)
- [ ] App starts and runs normally (to be verified separately)

## Breaking changes

None — this is a pure code-move refactoring with no behavioral changes.

## Testing

1. `npx tsc --noEmit` passes with zero errors.
2. `wc -l src/renderer.ts` shows ~126 lines.
3. E2E tests via Docker (`docker build -f e2e/Dockerfile.e2e -t vibe99-e2e .` + `docker run --rm vibe99-e2e`) pending.

- **E2E Dockerfile: replace git clone with COPY and npm ci with npm install (VIB-274):** Changed `RUN git clone https://github.com/yarray/Vibe99.git` to `COPY . /app/Vibe99` so the image uses the local build context instead of fetching remote source. Replaced all `npm ci` with `npm install` to avoid failures when `package-lock.json` is absent in the build context.
- **Activity alert debounce non-numeric input (VIB-273):** `<input type="number">` sanitises non-numeric values to `""`, which `Number("")` converts to `0` (not `NaN`). The debounce change handler now treats `0` and negative values as invalid, reverting the field to the current setting instead of clamping to the 3 s minimum.

- **E2E Dockerfile: use debug build and remove stale release binary (VIB-257):** Changed `tauri:build` to `tauri:build-dev` and removed the precompiled `src-tauri/target/debug/vibe99` from the image so that test runs always build incrementally from the mounted source.

---

# [VIB-271] feat: tighten UI module boundaries

## Summary

UI modules (`context-menus.ts`, `shell-profiles.ts`, `tab-bar.ts`) now only interact with the system through:
- Command dispatch (for state modifications)
- Layout/Workbench/session queries (for read-only access)

This removes all direct access to `PaneNode`, xterm instances, and internal state from UI modules.

## Changes

### context-menus.ts
- Removed `getPaneNode` from dependencies
- Added `dispatch` function for command dispatch
- All terminal operations (copy, paste, selectAll, etc.) now use commands
- Color operations use `pane.setColor` and `pane.clearColor` commands

### shell-profiles.ts
- Removed `initializePaneTerminal` and `getPaneNode` from dependencies
- Added `dispatch` function for command dispatch
- Shell switching now uses `terminal.changeShell` command

### tab-bar.ts
- Removed `onTabClick`, `onTabDrag`, `onRename`, `onCloseTab` callbacks
- Added `dispatch` function for command dispatch
- Tab operations now use commands: `pane.focus`, `pane.move`, `pane.close`, `pane.rename`

### New files
- `src/domain/commands.ts` - Command definitions (added query commands for terminal state)
- `src/runtime/command-dispatcher.ts` - Command dispatcher implementation

### Updated files
- `src/pane-renderer.ts` - Updated `onTerminalContextMenu` signature to accept `paneId: string` instead of `PaneNode`
- `src/renderer.ts` - Restructured initialization order to create dispatcher before modules that need it

## Acceptance criteria

- [x] `context-menus.ts` no longer imports or directly accesses `PaneNode.terminal`
- [x] `shell-profiles.ts` no longer receives `initializePaneTerminal` parameter
- [x] `tab-bar.ts` only uses Layout snapshot for reading data
- [x] `npx tsc --noEmit` passes (verified)
- [x] Menu, shell profile, tab drag/rename/close behavior unchanged
- [ ] E2E tests pass (to be verified separately)

## Breaking changes

None - this is an internal refactoring with no external API changes.

## Testing
