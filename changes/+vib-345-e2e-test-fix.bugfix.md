fix: always include layoutHotkeys and quakeLayouts in sanitized settings output

When settings are reset via E2E tests, the sanitized settings would not include
`layoutHotkeys` and `quakeLayouts` fields because they weren't present in the
reset payload. The Rust `sanitize_ui_config` function now always includes these
fields with empty objects when not present in the input, matching the frontend
schema's default({}) behavior.

This fixes E2E test failures where `settings.ui.layoutHotkeys` and
`settings.ui.quakeLayouts` were undefined after `resetSettings()`.
