# E2E Test Report — Windows/WebView2

**Date**: 2026-04-30  
**Platform**: Windows 11, WebView2 (Edge 147.0.3912.86)  
**Result**: 1/14 specs passed, smoke test fully green

## Environment Setup Completed

| Item | Status |
|------|--------|
| Tauri binary (release) | Built via `npx tauri build` |
| tauri-driver (v2.0.5) | Installed via `cargo install tauri-driver` |
| msedgedriver.exe | Downloaded to `e2e/bin/`, matching Edge 147.0.3912.86 |
| wdio.conf.js | Adapted for Windows (binaryExt, skip Xvfb, --native-driver, beforeSession cleanup) |
| terminal-helpers.js | Added Tauri bridge mode for WebGL-rendered terminals |
| smoke.spec.js | Updated to use bridge approach |
| npm dependencies | Installed in e2e/ |

## Key Discovery: xterm.js WebGL Rendering

On Windows/WebView2, xterm.js uses the **WebGL addon** for rendering. Terminal content is rendered to `<canvas>` elements, NOT to DOM (`.xterm-rows > div`). The DOM rows are completely empty (`totalRows: 0`).

All tests that read terminal text via DOM (`getTerminalText`, `waitForTerminalOutput`) fail because the DOM has no content.

**Fix applied**: `terminal-helpers.js` now detects WebGL rendering and falls back to:
1. Listening to `vibe99:terminal-data` Tauri events to capture PTY output
2. Writing to PTY via `invoke('terminal_write', ...)` with base64-encoded data
3. New exports: `writeToTerminal(paneIndex, data)`, `clearCapturedOutput(paneIndex)`

## Failure Categories

### 1. Tests still using old DOM-based terminal interaction
**Files affected**: Most test files (pty-lifecycle, clipboard, context-menu, activity-alert, shell-profile, etc.)
**Root cause**: Tests call `typeInTerminal()` or `sendKeyToTerminal()` which use `setValue`/`addValue` on the xterm textarea. These don't trigger xterm's keydown handlers on WebView2.
**Fix needed**: Update each test to use `writeToTerminal()` and `getTerminalText()` (bridge mode) instead.

### 2. `classList` returned as array (not DOMTokenList) on WebView2
**Error**: `cls.contains is not a function`
**Files**: shortcuts-modal-stack-fullscreen.spec.js (lines 153, 282, 376)
**Root cause**: WebView2's `getElementProperty('classList')` returns an array `['class1', 'class2']` instead of a DOMTokenList. Calls to `.contains()` fail.
**Fix needed**: Use `element.getAttribute('class')` and check with `.includes()` or split+includes.

### 3. `element click intercepted` by settings modal overlay
**Error**: `Other element would receive the click: <div class="settings-modal-overlay">`
**Files**: shortcuts-modal-stack-fullscreen.spec.js, settings.spec.js
**Root cause**: Previous test left settings modal open. The `after`/`afterEach` cleanup doesn't properly close modals between tests.
**Fix needed**: Improve cleanup in afterEach hooks to dismiss all overlays (Escape key, click overlay).

### 4. Double-click doesn't trigger rename mode on WebView2
**Error**: `.tab-input` not found
**Files**: tab-management.spec.js
**Root cause**: WebView2's `doubleClick()` action may not trigger the same DOM event sequence as WebKitGTK. The app's double-click handler on tabs might not fire.
**Fix needed**: Use `browser.execute()` to dispatch dblclick event directly.

### 5. F11 fullscreen doesn't work via WebDriver
**Error**: Expected `true`, Received `false` for `document.fullscreenElement`
**Files**: shortcuts-modal-stack-fullscreen.spec.js
**Root cause**: F11 in WebView2 toggles the Edge browser fullscreen, not the WebView content fullscreen. The WebDriver `performActions` with F11 key goes to the browser, not the app.
**Fix needed**: Use `browser.execute()` to call `document.documentElement.requestFullscreen()` or click the fullscreen button instead of F11.

### 6. State leaks between tests within same spec
**Error**: `waitForAppReady` timeout after settings/tab changes from previous test
**Files**: tab-management.spec.js, settings.spec.js
**Root cause**: `beforeSession` only cleans settings before each spec file. Tests within the same spec share the app session and accumulate state changes.
**Fix needed**: Add `afterEach` cleanup that resets app state, or `beforeEach` that restores defaults.

### 7. Linux/Unix-specific assumptions in tests
- `session-persistence.spec.js` uses `cwd: '/'` (Unix path)
- `pty-lifecycle.spec.js` uses `cd /tmp` and assumes OSC 7 support
- `shell-profile.spec.js` tests with `/bin/bash`, `/bin/zsh`, `/bin/sh`

## Potential Code Bugs (not test bugs)

1. **`cargo build` doesn't embed frontend assets**: Only `npx tauri build` properly embeds the frontend. `cargo build --release` in `src-tauri/` produces a binary that loads `about:blank` in WebView2. This could confuse users building manually.

2. **Double-click rename sensitivity**: May be a real issue on Windows — the double-click detection might need tuning for WebView2's event timing.
