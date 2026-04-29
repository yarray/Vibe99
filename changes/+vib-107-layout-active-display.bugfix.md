Fixed the layout switcher in the top-right corner always showing "Default" as checked instead of the actual current layout. The root cause was a race condition where `toggleLayoutsDropdown()` and `openLayoutsModal()` reloaded `activeLayoutId` from the backend, which could be stale due to debounced saves. Changes:

- `switchLayout()` now uses `flushSettingsSave()` for immediate persistence instead of the debounced `scheduleSettingsSave()`.
- `saveCurrentLayout()` and modal "Add/Save Layout" handlers no longer overwrite the local `activeLayoutId` with a potentially stale backend value.
- `deleteLayoutById()` now trusts the backend's returned `activeLayoutId` and uses `flushSettingsSave()`.
- `toggleLayoutsDropdown()` and `openLayoutsModal()` no longer overwrite the local `activeLayoutId`; the local value is the source of truth for the current window.
