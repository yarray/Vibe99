Fixed shell profile switching to fail explicitly when a requested profile is invalid, rather than silently falling back to a default shell and polluting the layout with the bad profile ID.

Backend: Modified `shell_candidates()` in `src-tauri/src/pty/mod.rs` to only try the exact requested profile when `shell_profile_id` is `Some(id)` - no fallback to detected shells. The spawn() call now returns a clear error when the requested profile doesn't exist or has an invalid command.

Frontend: Modified `changePaneShell()` in `src/pane-renderer.ts` to only update `paneState.shellProfileId` and save the layout after the PTY starts successfully. The `initializePty()` function in `src/runtime/terminal-session.ts` now accepts an optional `requestedProfileId` parameter to use the requested profile directly instead of reading from the pane snapshot.
