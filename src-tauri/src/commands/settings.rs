use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const CURRENT_CONFIG_VERSION: u8 = 6;

/// Global lock for all settings file operations.
///
/// `settings.json` is read and written by multiple commands
/// (`settings_load`, `settings_save`, `layout_save`, `shell_profile_add`, …).
/// Tauri commands may execute concurrently, so a shared mutex prevents
/// interleaved reads/writes that could produce corrupted or stale data.
pub struct SettingsState {
    pub lock: Mutex<()>,
}

const DEFAULT_FONT_SIZE: u32 = 13;
const DEFAULT_PANE_OPACITY: f64 = 0.8;
const DEFAULT_PANE_WIDTH: u32 = 720;

// ----------------------------------------------------------------
// Shell profile types
// ----------------------------------------------------------------

/// A named shell configuration that users can select as their default
/// terminal shell. The profile is a pure data record — all behavior
/// (spawning, argument handling) is derived from these fields by the
/// PTY layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    /// Unique identifier (e.g. "bash", "zsh", "pwsh"). Must be non-empty.
    pub id: String,
    /// Human-readable label shown in the UI. Falls back to `id` if empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// Absolute path to the shell executable.
    pub command: String,
    /// Arguments passed to the shell (e.g. ["-il"]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
}

impl ShellProfile {
    /// Return the display name, falling back to the id.
    pub fn display_name(&self) -> &str {
        if self.name.is_empty() {
            &self.id
        } else {
            &self.name
        }
    }

    /// Validate and sanitize a raw profile into a canonical form.
    ///
    /// - `id` must be non-empty; whitespace is trimmed.
    /// - `command` must be non-empty; whitespace is trimmed.
    /// - `name` is optional; whitespace is trimmed.
    /// - `args` are kept as-is (they are user-specified).
    ///
    /// Returns `None` if the profile lacks a usable id or command.
    pub fn sanitize(candidate: &Value) -> Option<Self> {
        let obj = candidate.as_object()?;

        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        let command = obj
            .get("command")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        let name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let args = obj
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Some(Self {
            id: id.to_string(),
            name,
            command: command.to_string(),
            args,
        })
    }
}

/// Sanitize a list of shell profiles, deduplicating by id.
/// Profiles with invalid id or command are silently dropped.
fn sanitize_shell_profiles(profiles: Option<&Value>) -> Vec<ShellProfile> {
    let arr = profiles.and_then(|v| v.as_array());
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    if let Some(arr) = arr {
        for item in arr {
            if let Some(p) = ShellProfile::sanitize(item) {
                if seen.insert(p.id.clone()) {
                    result.push(p);
                }
            }
        }
    }

    result
}

/// Sanitize the `shell` block of a config.
///
/// Ensures `defaultProfile` refers to an existing profile. If the
/// referenced id is missing or the field is absent, falls back to
/// the first profile's id (or an empty string if no profiles exist).
fn sanitize_shell_config(shell: Option<&Value>, profiles: &[ShellProfile]) -> Value {
    let raw_default = shell
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("defaultProfile"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");

    let default_id = if !raw_default.is_empty() && profiles.iter().any(|p| p.id == raw_default) {
        raw_default.to_string()
    } else {
        profiles.first().map(|p| p.id.clone()).unwrap_or_default()
    };

    serde_json::json!({
        "profiles": profiles,
        "defaultProfile": default_id,
    })
}

// ----------------------------------------------------------------
// Layout types
// ----------------------------------------------------------------

/// A single pane inside a saved layout.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPane {
    pub title: Option<String>,
    pub cwd: String,
    pub accent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_profile_id: Option<String>,
}

/// A named arrangement of panes that users can save and restore.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub id: String,
    pub name: String,
    pub panes: Vec<LayoutPane>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused_pane_index: Option<usize>,
}

/// Validate that an `accent` value is a 7-char hex color (`#RRGGBB`).
fn is_valid_accent(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.starts_with('#') && s.len() == 7 && s[1..].chars().all(|c| c.is_ascii_hexdigit())
    })
}

/// Sanitize a raw layout pane into a canonical form.
///
/// - `cwd` must be non-empty.
/// - `accent` must be a valid hex color (`#RRGGBB`).
/// - `title` is optional.
/// - `customColor` and `shellProfileId` are optional.
pub(crate) fn sanitize_layout_pane(candidate: &Value) -> Option<Value> {
    let obj = candidate.as_object()?;

    let cwd = obj
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if !is_valid_accent(obj.get("accent")?) {
        return None;
    }

    let mut result = serde_json::json!({
        "cwd": cwd,
        "accent": obj.get("accent").unwrap(),
    });

    let result_obj = result.as_object_mut().unwrap();

    if let Some(title) = obj.get("title").and_then(|v| v.as_str()).map(str::trim) {
        if !title.is_empty() {
            result_obj.insert("title".into(), Value::String(title.to_string()));
        }
    }

    if let Some(custom_color) = obj
        .get("customColor")
        .and_then(|v| v.as_str())
        .map(str::trim)
    {
        if !custom_color.is_empty() {
            result_obj.insert(
                "customColor".into(),
                Value::String(custom_color.to_string()),
            );
        }
    }

    if let Some(shell_profile_id) = obj
        .get("shellProfileId")
        .and_then(|v| v.as_str())
        .map(str::trim)
    {
        if !shell_profile_id.is_empty() {
            result_obj.insert(
                "shellProfileId".into(),
                Value::String(shell_profile_id.to_string()),
            );
        }
    }

    Some(result)
}

/// Sanitize a raw layout into a canonical form.
///
/// - `id` must be non-empty.
/// - `name` must be non-empty.
/// - `panes` must be a non-empty array of valid panes.
/// - `focusedPaneIndex` is clamped to the valid pane range.
pub(crate) fn sanitize_layout(candidate: &Value) -> Option<Value> {
    let obj = candidate.as_object()?;

    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;

    let panes = obj
        .get("panes")
        .and_then(|v| v.as_array())
        .filter(|arr| !arr.is_empty())?;

    let valid_panes: Vec<Value> = panes
        .iter()
        .filter_map(|p| sanitize_layout_pane(p))
        .collect();
    if valid_panes.is_empty() {
        return None;
    }

    let focused_pane_index = obj
        .get("focusedPaneIndex")
        .and_then(|v| v.as_u64())
        .map(|i| (i as usize).min(valid_panes.len() - 1))
        .unwrap_or(0);

    Some(serde_json::json!({
        "id": id,
        "name": name,
        "panes": valid_panes,
        "focusedPaneIndex": focused_pane_index,
    }))
}

/// Sanitize a list of layouts, deduplicating by id.
/// Layouts with invalid id, name, or panes are silently dropped.
pub(crate) fn sanitize_layouts(value: Option<&Value>) -> Vec<Value> {
    let arr = value.and_then(|v| v.as_array());
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    if let Some(arr) = arr {
        for item in arr {
            if let Some(layout) = sanitize_layout(item) {
                let id = layout
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if !id.is_empty() && seen.insert(id) {
                    result.push(layout);
                }
            }
        }
    }

    result
}

/// Sanitize the default layout id.
///
/// Ensures the id refers to an existing layout. Returns an empty string
/// if the referenced id is missing or the field is absent.
pub(crate) fn sanitize_default_layout_id(value: Option<&Value>, layouts: &[Value]) -> String {
    sanitize_layout_id(value, layouts)
}

/// Shared sanitization for layout id fields.
fn sanitize_layout_id(value: Option<&Value>, layouts: &[Value]) -> String {
    let raw = value.and_then(|v| v.as_str()).map(str::trim).unwrap_or("");

    if raw.is_empty() {
        return String::new();
    }

    if layouts
        .iter()
        .any(|l| l.get("id").and_then(|v| v.as_str()) == Some(raw))
    {
        raw.to_string()
    } else {
        String::new()
    }
}

/// Resolve the path to `settings.json` inside the app data directory.
pub(super) fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
        .map(|p: std::path::PathBuf| p.join("settings.json"))
}

/// Clamp a UI field from an arbitrary JSON value, falling back to `default`.
fn get_number(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key)
        .and_then(|n| n.as_f64())
        .filter(|n| n.is_finite())
        .unwrap_or(default)
}

/// Sanitize the `ui` block of a config, clamping all values to valid ranges.
fn sanitize_ui_config(ui: Option<&Value>) -> Value {
    let ui = ui.unwrap_or(&Value::Null);

    let font_size = get_number(ui, "fontSize", DEFAULT_FONT_SIZE as f64);
    let font_size = font_size.round().clamp(10.0, 24.0) as u32;

    let pane_opacity = get_number(ui, "paneOpacity", DEFAULT_PANE_OPACITY);
    let pane_opacity = ((pane_opacity * 100.0).round() / 100.0).clamp(0.55, 1.0);

    let pane_mask_opacity = get_number(ui, "paneMaskOpacity", 0.25);
    let pane_mask_opacity = ((pane_mask_opacity * 100.0).round() / 100.0).clamp(0.0, 1.0);

    let pane_width = get_number(ui, "paneWidth", DEFAULT_PANE_WIDTH as f64);
    let pane_width = ((pane_width / 10.0).round() * 10.0).clamp(520.0, 2000.0) as u32;

    let breathing_alert_enabled = ui
        .get("breathingAlertEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let font_family = ui
        .get("fontFamily")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");

    let mut result = serde_json::json!({
        "fontSize": font_size,
        "paneOpacity": pane_opacity,
        "paneMaskOpacity": pane_mask_opacity,
        "paneWidth": pane_width,
        "breathingAlertEnabled": breathing_alert_enabled,
    });

    if !font_family.is_empty() {
        result
            .as_object_mut()
            .unwrap()
            .insert("fontFamily".into(), Value::String(font_family.to_string()));
    }

    // Preserve keyboard shortcuts if present
    if let Some(shortcuts) = ui.get("shortcuts").and_then(|v| v.as_object()) {
        result
            .as_object_mut()
            .unwrap()
            .insert("shortcuts".into(), Value::Object(shortcuts.clone()));
    }

    result
}

/// Sanitize an arbitrary config value into the current schema.
///
/// Handles:
/// - Current versioned format (`{ version: 6, ui: { ... }, shell: { ... } }`)
/// - Version 1 format (`{ version: 1, ui: { ... } }`) → promoted to current
/// - Legacy flat format (`{ fontSize, paneOpacity, paneWidth }` without version/ui)
/// - Null / invalid input → defaults
pub(crate) fn sanitize_config(candidate: &Value) -> Value {
    let version = candidate
        .as_object()
        .and_then(|o| o.get("version"))
        .and_then(|v| v.as_u64());

    match version {
        Some(v) if v >= 2 => {
            // Version 2+ format: sanitize ui, shell, layouts, and default layout.
            let obj = candidate.as_object().unwrap();
            let profiles =
                sanitize_shell_profiles(obj.get("shell").and_then(|s| s.get("profiles")));
            let layouts = sanitize_layouts(obj.get("layouts"));
            let default_layout_id =
                sanitize_default_layout_id(obj.get("defaultLayoutId"), &layouts);

            let mut result = serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": sanitize_ui_config(obj.get("ui")),
                "shell": sanitize_shell_config(obj.get("shell"), &profiles),
            });

            if !layouts.is_empty() {
                result
                    .as_object_mut()
                    .unwrap()
                    .insert("layouts".into(), Value::Array(layouts));
            }

            result
                .as_object_mut()
                .unwrap()
                .insert("defaultLayoutId".into(), Value::String(default_layout_id));

            result
        }
        Some(v) if v == 1 => {
            // Version 1 → current migration: preserve ui, add empty shell block.
            let obj = candidate.as_object().unwrap();
            serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": sanitize_ui_config(obj.get("ui")),
                "shell": {
                    "profiles": [],
                    "defaultProfile": "",
                },
                "defaultLayoutId": "",
            })
        }
        _ => {
            // Check for legacy flat format (fields at top level, no version/ui nesting)
            if candidate.as_object().is_some_and(|obj| {
                obj.keys()
                    .any(|k| ["fontSize", "paneOpacity", "paneWidth"].contains(&k.as_str()))
            }) {
                return serde_json::json!({
                    "version": CURRENT_CONFIG_VERSION,
                    "ui": sanitize_ui_config(Some(candidate)),
                    "shell": {
                        "profiles": [],
                        "defaultProfile": "",
                    },
                    "defaultLayoutId": "",
                });
            }

            // Null, non-object, or unrecognized format → defaults
            serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": {
                    "fontSize": DEFAULT_FONT_SIZE,
                    "paneOpacity": DEFAULT_PANE_OPACITY,
                    "paneMaskOpacity": 0.25,
                    "paneWidth": DEFAULT_PANE_WIDTH,
                    "breathingAlertEnabled": true,
                },
                "shell": {
                    "profiles": [],
                    "defaultProfile": "",
                },
                "defaultLayoutId": "",
            })
        }
    }
}

/// Load the application settings from disk.
///
/// Returns the sanitized config. If the file does not exist or cannot be
/// parsed, the default config is returned instead.
#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let path = settings_path(&app)?;

    if !path.exists() {
        return Ok(sanitize_config(&Value::Null));
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;

    let parsed: Value =
        serde_json::from_str(&contents).unwrap_or_else(|_| sanitize_config(&Value::Null));

    Ok(sanitize_config(&parsed))
}

/// Save application settings to disk.
///
/// The input is sanitized before writing, so the returned value is the
/// canonical representation that was persisted.
#[tauri::command]
pub fn settings_save(app: AppHandle, mut settings: Value) -> Result<Value, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let path = settings_path(&app)?;

    // Create parent directory if it doesn't exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }

    // The frontend may send a partial payload (only version and ui)
    // without the `shell` block. Preserve the existing `shell` block from
    // disk so that user-edited profiles are not silently wiped.
    if settings.get("shell").is_none() && path.exists() {
        let shell = std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<Value>(&c).ok())
            .and_then(|v| v.get("shell").cloned());
        if let (Some(shell), Some(obj)) = (shell, settings.as_object_mut()) {
            obj.insert("shell".into(), shell);
        }
    }

    // Similarly, preserve the existing `layouts` block from disk if the
    // frontend does not send it.
    if settings.get("layouts").is_none() && path.exists() {
        let layouts = std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<Value>(&c).ok())
            .and_then(|v| v.get("layouts").cloned());
        if let (Some(layouts), Some(obj)) = (layouts, settings.as_object_mut()) {
            obj.insert("layouts".into(), layouts);
        }
    }

    // Preserve the existing `defaultLayoutId` from disk if the frontend does not send it.
    if settings.get("defaultLayoutId").is_none() && path.exists() {
        let default_layout_id = std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<Value>(&c).ok())
            .and_then(|v| v.get("defaultLayoutId").cloned());
        if let (Some(default_layout_id), Some(obj)) = (default_layout_id, settings.as_object_mut())
        {
            obj.insert("defaultLayoutId".into(), default_layout_id);
        }
    }

    let sanitized = sanitize_config(&settings);
    let serialized = serde_json::to_string_pretty(&sanitized)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;

    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))?;

    Ok(sanitized)
}
