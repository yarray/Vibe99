Added extended E2E tests for Layout Window Geometry, Set as Default, and Open in New Window (VIB-254):

- 10 new test cases in `e2e/tests/layout.spec.js` covering:
  - Window geometry persistence: saves and restores position, size, fullscreen state
  - Set as Default: button visibility, click action, and disabled state for already-default layouts
  - Open in New Window: button visibility in layout modal editor, multi-window creation via Tauri
  - Layout Focus Notice: LAYOUT_FOCUS_NOTICE_EVENT emission and 1400ms timing verification
- Tests use `browser.execute()` for backend IPC calls and `window.__TAURI__` event emission.
