Added comprehensive E2E tests for Float Window feature (VIB-250):

- New `e2e/tests/float-window.spec.js` with 10 test cases covering:
  - Settings panel float-window-toggle UI (row click toggles dot state and checkbox)
  - Float window state persistence via settings save/load
  - Position data storage and multi-layout float state handling
  - float_window_state_save backend command verification
  - Graceful handling of empty float window state
- Tests use `browser.execute()` to access Tauri API internals and verify persisted state, since the float window runs as a separate WebviewWindow.
