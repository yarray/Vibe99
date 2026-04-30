# E2E Windows/WebView2 Status

**Date**: 2026-04-30
**Branch**: `autoproj/e2e-tests`
**Platform**: Windows 11 / WebView2
**Test Runner**: WebdriverIO + tauri-driver + msedgedriver.exe

## Current Result

The previously reported Windows/WebView2 failures have been resolved.

| Scope | Result |
| --- | --- |
| Formerly failing specs | 6/6 passing |
| Formerly failing tests | 14/14 resolved |
| Verification run | 72 passing, 0 failing |
| Excluded known specs | `clipboard.spec.js`, `layout.spec.js` |

Verification command:

```powershell
cd e2e
npm test -- --spec ./tests/activity-alert.spec.js --spec ./tests/pane-management.spec.js --spec ./tests/session-persistence.spec.js --spec ./tests/settings.spec.js --spec ./tests/shell-profile.spec.js --spec ./tests/tab-management.spec.js --logLevel error
```

## Resolved Issues

### Synthetic Events on WebView2

WebView2 does not reliably route synthetic `KeyboardEvent`, `PointerEvent`, or `MouseEvent` instances dispatched from `browser.execute`. Tests now avoid depending on untrusted events for core UI behavior.

Changes:

- `Ctrl+\`` activity navigation uses `browser.keys()`.
- Tab rename uses native WebDriver double-click actions.
- Rename field edits use the native input setter plus the app's existing keyboard handler.
- Context-menu label collection avoids WDIO array quirks on WebView2.

### Test State Leaks

Specs that close panes down to one pane no longer poison later tests. `cleanupApp()` now dismisses overlays and restores the pane count to three when possible. `waitForAppReady()` also accepts a minimum pane count for tests that intentionally start from a one-pane state.

### Settings Persistence Mismatches

The app now exposes `--app-font-family` when applying font settings, and the Rust settings sanitizer preserves `ui.breathingAlertEnabled`. This aligns the saved settings schema with the renderer's UI settings payload.

### Activity Alert Clearing

Focusing a pane now clears its pending activity class at the renderer level. This keeps the visible pane state correct even when activity state is reached through test setup or fallback paths.

### Navigation-Mode New Pane Behavior

Creating a new pane from navigation mode now exits navigation mode, matching the existing close and rename navigation-mode flows.

### Shell Profile Default Test

The default-profile test now creates an existing default profile first, then verifies that a second profile can be promoted to default. This avoids assuming the first user-created profile will show a star button.

## Verification

Commands run:

```powershell
npm run vite:build
$env:CARGO_TARGET_DIR='target-codex'; cargo check
npm run tauri:build
cd e2e
npm test -- --spec ./tests/activity-alert.spec.js --logLevel error
npm test -- --spec ./tests/tab-management.spec.js --logLevel error
npm test -- --spec ./tests/pane-management.spec.js --logLevel error
npm test -- --spec ./tests/settings.spec.js --logLevel error
npm test -- --spec ./tests/session-persistence.spec.js --logLevel error
npm test -- --spec ./tests/shell-profile.spec.js --logLevel error
npm test -- --spec ./tests/activity-alert.spec.js --spec ./tests/pane-management.spec.js --spec ./tests/session-persistence.spec.js --spec ./tests/settings.spec.js --spec ./tests/shell-profile.spec.js --spec ./tests/tab-management.spec.js --logLevel error
```

Notes:

- Plain `cargo check` against `src-tauri/target` failed on Windows with `os error 5` access-denied writes. Verification used `CARGO_TARGET_DIR=target-codex`.
- `tauri:build` and WDIO runs required elevated process-spawn permissions in this environment.
