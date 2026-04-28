Fix `activeLayoutId` not being persisted after saving or switching layouts.

- Backend `layout_save` now updates `activeLayoutId` to the saved layout's id.
- Frontend `switchLayout` now awaits immediate `saveSettings` instead of debounced `scheduleSettingsSave`, ensuring the active layout is persisted before the dropdown/modal reopens.
