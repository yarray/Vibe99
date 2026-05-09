Extracted pane activity and clipboard logic into dedicated capabilities.

- `src/pane/capabilities/activity-capability.ts`: per-pane activity watcher with `noteOutput()`, `setEnabled()`, and `setAlerted()` APIs. Watcher `onAlert`/`onClear` callbacks close over `PaneContext` to access the DOM capability.
- `src/pane/capabilities/clipboard-capability.ts`: clipboard behavior with auto-copy on selection change, OSC 52 handler, and `paste()`, `readClipboard()`, `snapshot()` APIs.
