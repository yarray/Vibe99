Extended Pane model with `themeId` support and wired per-pane theming through the full stack.

- `PaneSnapshot` / `Pane` now carry `themeId?: string` with `setTheme(themeId: string | null)` mutator.
- Added `pane.setTheme` and `pane.clearTheme` commands to the `AppCommand` union.
- `TerminalSession` gained `setTheme(themeId: string | null)` (idempotent) and accepts an optional `getTheme` dependency. On creation it applies the pane's theme if present; `setAccent` collaborates with the active theme by overriding only `cursor` and `selectionBackground`.
- `pane-renderer` tracks last-seen `themeId` per pane and calls `session.setTheme()` on change.
- `Workbench.dispatch` handles the two new commands; `Workbench.render` applies pane themes before accents.
- `pane-state` serializes and restores `themeId` in session data, and exposes `setPaneTheme` / `clearPaneTheme`.
- `Layout.updatePane` now supports patching `themeId`.
