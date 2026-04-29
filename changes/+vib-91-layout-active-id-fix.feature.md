# VIB-91: Fix switchLayout activeLayoutId persistence

## Summary
Fixed the issue where `activeLayoutId` was not correctly persisted after switching layouts due to race conditions with the debounced save mechanism.

## Changes

### `src/renderer.js`

1. **`switchLayout()`**: Changed from `scheduleSettingsSave()` to `flushSettingsSave()` to ensure immediate save of `activeLayoutId`, preventing race conditions with other operations.

2. **`saveCurrentLayout()`**: 
   - Only updates `activeLayoutId` if the backend confirms it (has `config.activeLayoutId`)
   - Changed to use `flushSettingsSave()` instead of `scheduleSettingsSave()`
   - Added call to `updateLayoutsIndicator()` to refresh UI

3. **`deleteLayoutById()`**: 
   - Now uses backend's `activeLayoutId` directly for consistency
   - Changed to use `flushSettingsSave()` instead of `scheduleSettingsSave()`
   - Added call to `updateLayoutsIndicator()` to refresh UI

4. **Added `updateLayoutsIndicator()` function**: Updates the layouts button's `aria-label` to show the current layout name for better accessibility and user feedback.

5. **Initialization**: Added calls to `updateLayoutsIndicator()` during startup to ensure the layout indicator is correct on load.

## Acceptance Criteria Met

- ✅ Switching layout now immediately saves `activeLayoutId` to prevent race conditions
- ✅ `saveCurrentLayout` only updates `activeLayoutId` when backend confirms it
- ✅ Settings file `activeLayoutId` is correctly persisted after layout switch
- ✅ Layout indicator (button aria-label) is updated after layout operations
