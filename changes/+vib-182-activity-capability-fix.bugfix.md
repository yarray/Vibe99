Fixed three runtime bugs in `activity-capability.ts`:
- `setEnabled()` no longer references an out-of-scope `ctx` variable; the capability API is now returned by `open(ctx)` via closure.
- Removed incorrect `watcher.onAlert`/`watcher.onClear` calls (these are constructor options, not methods). The pane manager now passes global `onAlert`/`onClear` callbacks when creating the watcher and dispatches to the per-pane activity capability API.
- `noteOutput()` now correctly calls `watcher.noteData(ctx.id)` instead of being an empty stub.
