fix: include layoutHotkeys and quakeLayouts in default settings

When settings are initialized with defaults (file not exists or invalid), the
sanitize_config function was creating the ui object directly without calling
sanitize_ui_config. This meant that layoutHotkeys and quakeLayouts fields were
missing from the default settings, causing E2E tests to fail when accessing
settings.ui.layoutHotkeys or settings.ui.quakeLayouts.

The default case now calls sanitize_ui_config(None) to ensure these fields are
always present with empty objects, matching the behavior of the other migration
paths.
