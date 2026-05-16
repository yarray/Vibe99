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

- All type checks pass
- Manual testing of right-click menus, shell profile switching, and tab operations recommended
