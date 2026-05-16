Add floating window mode showing compact color blocks for each pane.

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
