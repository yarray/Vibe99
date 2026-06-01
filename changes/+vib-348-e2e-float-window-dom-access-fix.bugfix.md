## Fix E2E Test Failures for Float Window Glow Coordination Tests

Fixed the VIB-348 E2E tests that were failing because they tried to access the float window's DOM elements (`.float-block`) from the main window context.

**Problem:**
The float window is a separate Tauri window with its own DOM context. The original tests tried to access `.float-block` using `document.querySelector('.float-block')` from the main window, which returned `null` and caused all three glow coordination tests to fail.

**Solution:**
Added helper functions `switchToFloatWindow()` and `switchToMainWindow()` to properly switch window contexts using WebdriverIO's `getWindowHandles()` and `switchToWindow()` APIs before accessing the float window's DOM elements.

**Tests fixed:**
1. `verifies glow color matches block color` - Now correctly reads `--block-glow` CSS variable from float window
2. `verifies low-luminance colors get white-mixed glow for visibility` - Now correctly reads `--breath-glow-mix` from float window
3. `verifies breathing animation timing matches spec (2s duration)` - Now correctly reads animation duration from float window
