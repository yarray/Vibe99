use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const CURRENT_CONFIG_VERSION: u8 = 5;

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
        if self.name.is_empty() { &self.id } else { &self.name }
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

        let id = obj.get("id").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())?;
        let command = obj.get("command").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())?;
        let name = obj.get("name").and_then(|v| v.as_str()).map(str::trim).unwrap_or("").to_string();
        let args = obj
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Some(Self { id: id.to_string(), name, command: command.to_string(), args })
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

// ----------------------------------------------------------------
// Layout types
// ----------------------------------------------------------------

/// A single pane within a layout. Mirrors the shape of a session pane
/// but carries an optional `shellProfileId` so the pane can be pinned
/// to a specific shell profile.
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

impl LayoutPane {
    /// Validate and sanitize a raw pane value into a canonical `LayoutPane`.
    ///
    /// - `cwd` must be non-empty; whitespace is trimmed.
    /// - `accent` must be a valid `#RRGGBB` hex color.
    /// - `title` and `custom_color` are optional; whitespace trimmed.
    /// - `shell_profile_id` is passed through as-is.
    ///
    /// Returns `None` if the pane lacks a usable cwd or accent.
    pub fn sanitize(candidate: &Value) -> Option<Self> {
        let obj = candidate.as_object()?;

        let cwd = obj.get("cwd").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())?;
        let accent = obj
            .get("accent")
            .and_then(|v| v.as_str())
            .filter(|s| s.starts_with('#') && s.len() == 7 && s[1..].chars().all(|c| c.is_ascii_hexdigit()))?;

        let title = obj.get("title").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
        let custom_color = obj.get("customColor").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
        let shell_profile_id = obj.get("shellProfileId").and_then(|v| v.as_str()).map(str::trim).map(String::from);

        Some(Self { title, cwd: cwd.to_string(), accent: accent.to_string(), custom_color, shell_profile_id })
    }
}

/// A named layout composed of multiple panes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub id: String,
    pub name: String,
    pub panes: Vec<LayoutPane>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused_pane_index: Option<usize>,
}

/// Sanitize the `layouts` array from the config.
///
/// Returns a vector of sanitized `Layout`s. Layouts with invalid or
/// duplicate ids are silently dropped. Panes within each layout are
/// sanitized via `LayoutPane::sanitize`; layouts with no valid panes
/// are dropped.
fn sanitize_layouts(layouts: Option<&Value>) -> Vec<Value> {
    let arr = layouts.and_then(|v| v.as_array());
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    if let Some(arr) = arr {
        for item in arr {
            let obj = match item.as_object() {
                Some(o) => o,
                None => continue,
            };

            let id = obj.get("id").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
            let name = obj.get("name").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());

            let id = match id {
                Some(s) => s,
                None => continue,
            };

            if !seen.insert(id.to_string()) {
                continue;
            }

            let panes: Vec<LayoutPane> = obj
                .get("panes")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(LayoutPane::sanitize).collect())
                .unwrap_or_default();

            if panes.is_empty() {
                continue;
            }

            let focused_pane_index = obj
                .get("focusedPaneIndex")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .filter(|&i| i < panes.len());

            result.push(serde_json::json!({
                "id": id,
                "name": name.unwrap_or(id),
                "panes": panes,
                "focusedPaneIndex": focused_pane_index,
            }));
        }
    }

    result
}

/// Sanitize the `activeLayoutId` field.
///
/// Returns the id string if it refers to an existing layout; otherwise
/// returns an empty string (signalling no active layout / traditional
/// session restore).
fn sanitize_active_layout_id(value: Option<&Value>, layouts: &[Value]) -> String {
    let raw = value.and_then(|v| v.as_str()).map(str::trim).unwrap_or("");

    if raw.is_empty() {
        return String::new();
    }

    let exists = layouts.iter().any(|l| {
        l.as_object().and_then(|o| o.get("id")).and_then(|v| v.as_str()) == Some(raw)
    });

    if exists {
        raw.to_string()
    } else {
        String::new()
    }
}

/// Sanitize the `shell` block of a config.
///
/// Ensures `defaultProfile` refers to an existing profile. If the
/// referenced id is missing or the field is absent, falls back to
/// the first profile's id (or an empty string if no profiles exist).
fn sanitize_shell_config(
    shell: Option<&Value>,
    profiles: &[ShellProfile],
) -> Value {
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
    });

    if !font_family.is_empty() {
        result.as_object_mut().unwrap().insert(
            "fontFamily".into(),
            Value::String(font_family.to_string()),
        );
    }

    // Preserve keyboard shortcuts if present
    if let Some(shortcuts) = ui.get("shortcuts").and_then(|v| v.as_object()) {
        result.as_object_mut().unwrap().insert(
            "shortcuts".into(),
            Value::Object(shortcuts.clone()),
        );
    }

    result
}

/// Sanitize the `session` block of a config.
///
/// Validates that each pane entry has a valid `accent` hex color.
/// Returns `Value::Null` if the session is missing, empty, or has no valid panes.
fn sanitize_session(session: Option<&Value>) -> Value {
    let panes = match session
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("panes"))
        .and_then(|p| p.as_array())
    {
        Some(arr) => arr,
        None => return Value::Null,
    };

    let valid: Vec<Value> = panes
        .iter()
        .filter(|p| {
            p.get("accent")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s.starts_with('#') && s.len() == 7 && s[1..].chars().all(|c| c.is_ascii_hexdigit()))
        })
        .cloned()
        .collect();

    if valid.is_empty() {
        return Value::Null;
    }

    let focused_index = session
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("focusedPaneIndex"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    let focused_index = focused_index.min(valid.len() - 1);

    serde_json::json!({
        "panes": valid,
        "focusedPaneIndex": focused_index,
    })
}

/// Sanitize an arbitrary config value into the current schema.
///
/// Handles:
/// - Current versioned format (`{ version: 2, ui: { ... }, shell: { ... } }`)
/// - Version 1 format (`{ version: 1, ui: { ... } }`) → promoted to v2
/// - Legacy flat format (`{ fontSize, paneOpacity, paneWidth }` without version/ui)
/// - Null / invalid input → defaults
pub(crate) fn sanitize_config(candidate: &Value) -> Value {
    let version = candidate
        .as_object()
        .and_then(|o| o.get("version"))
        .and_then(|v| v.as_u64());

    match version {
        Some(v) if v >= 2 => {
            // Version 2+ format: sanitize ui, shell, and optionally session blocks.
            let obj = candidate.as_object().unwrap();
            let profiles = sanitize_shell_profiles(obj.get("shell").and_then(|s| s.get("profiles")));
            let session = sanitize_session(obj.get("session"));
            let layouts = sanitize_layouts(obj.get("layouts"));
            let active_layout_id = sanitize_active_layout_id(obj.get("activeLayoutId"), &layouts);

            let mut result = serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": sanitize_ui_config(obj.get("ui")),
                "shell": sanitize_shell_config(obj.get("shell"), &profiles),
            });

            if !session.is_null() {
                result.as_object_mut().unwrap().insert("session".into(), session);
            }

            if !layouts.is_empty() {
                result.as_object_mut().unwrap().insert("layouts".into(), Value::Array(layouts));
                if !active_layout_id.is_empty() {
                    result.as_object_mut().unwrap().insert("activeLayoutId".into(), Value::String(active_layout_id));
                }
            }

            result
        }
        Some(v) if v == 1 => {
            // Version 1 → 2 migration: preserve ui, add empty shell block.
            let obj = candidate.as_object().unwrap();
            serde_json::json!({
                "version": CURRENT_CONFIG_VERSION,
                "ui": sanitize_ui_config(obj.get("ui")),
                "shell": {
                    "profiles": [],
                    "defaultProfile": "",
                },
            })
        }
        _ => {
            // Check for legacy flat format (fields at top level, no version/ui nesting)
            if candidate.as_object().is_some_and(|obj| {
                obj.keys().any(|k| ["fontSize", "paneOpacity", "paneWidth"].contains(&k.as_str()))
            }) {
                return serde_json::json!({
                    "version": CURRENT_CONFIG_VERSION,
                    "ui": sanitize_ui_config(Some(candidate)),
                    "shell": {
                        "profiles": [],
                        "defaultProfile": "",
                    },
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
                },
                "shell": {
                    "profiles": [],
                    "defaultProfile": "",
                },
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
    let path = settings_path(&app)?;

    // Create parent directory if it doesn't exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }

    // The frontend may send a partial payload (only version, ui, session)
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

    // Similarly preserve the `layouts` block if not sent by the frontend.
    if settings.get("layouts").is_none() && path.exists() {
        let layouts = std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<Value>(&c).ok())
            .and_then(|v| v.get("layouts").cloned());
        if let (Some(layouts), Some(obj)) = (layouts, settings.as_object_mut()) {
            obj.insert("layouts".into(), layouts);
        }
    }

    let sanitized = sanitize_config(&settings);
    let serialized =
        serde_json::to_string_pretty(&sanitized).map_err(|e| format!("failed to serialize settings: {e}"))?;

    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))?;

    Ok(sanitized)
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_pane() -> Value {
        serde_json::json!({
            "cwd": "/home/user",
            "accent": "#3b82f6",
            "title": "main",
            "customColor": "#ff0000",
            "shellProfileId": "bash",
        })
    }

    fn valid_layout() -> Value {
        serde_json::json!({
            "id": "layout-1",
            "name": "Main Layout",
            "panes": [valid_pane()],
            "focusedPaneIndex": 0,
        })
    }

    #[test]
    fn test_sanitize_layouts_drops_invalid_and_keeps_valid() {
        let input = serde_json::json!([
            valid_layout(),
            { "id": "", "name": "Bad", "panes": [] },
            { "name": "Missing ID", "panes": [valid_pane()] },
            valid_layout(), // duplicate
        ]);

        let result = sanitize_layouts(Some(&input));
        assert_eq!(result.len(), 1);
        let obj = result[0].as_object().unwrap();
        assert_eq!(obj.get("id").and_then(|v| v.as_str()), Some("layout-1"));
        assert_eq!(obj.get("name").and_then(|v| v.as_str()), Some("Main Layout"));
    }

    #[test]
    fn test_sanitize_active_layout_id_valid() {
        let layouts = serde_json::json!([
            { "id": "layout-1", "name": "L1", "panes": [valid_pane()] },
            { "id": "layout-2", "name": "L2", "panes": [valid_pane()] },
        ]);
        let layouts_val = sanitize_layouts(Some(&layouts));

        let result = sanitize_active_layout_id(Some(&Value::String("layout-2".into())), &layouts_val);
        assert_eq!(result, "layout-2");
    }

    #[test]
    fn test_sanitize_active_layout_id_invalid_returns_empty() {
        let layouts = serde_json::json!([
            { "id": "layout-1", "name": "L1", "panes": [valid_pane()] },
        ]);
        let layouts_val = sanitize_layouts(Some(&layouts));

        let result = sanitize_active_layout_id(Some(&Value::String("nonexistent".into())), &layouts_val);
        assert_eq!(result, "");
    }

    #[test]
    fn test_sanitize_active_layout_id_empty_returns_empty() {
        let layouts: Vec<Value> = vec![];
        let result = sanitize_active_layout_id(Some(&Value::String("".into())), &layouts);
        assert_eq!(result, "");
    }

    #[test]
    fn test_sanitize_config_v2_with_layouts() {
        let input = serde_json::json!({
            "version": 2,
            "ui": { "fontSize": 14 },
            "shell": { "profiles": [], "defaultProfile": "" },
            "layouts": [valid_layout()],
            "activeLayoutId": "layout-1",
        });

        let result = sanitize_config(&input);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("version").and_then(|v| v.as_u64()), Some(5));
        let layouts = obj.get("layouts").and_then(|v| v.as_array()).unwrap();
        assert_eq!(layouts.len(), 1);
        assert_eq!(obj.get("activeLayoutId").and_then(|v| v.as_str()), Some("layout-1"));
    }

    #[test]
    fn test_sanitize_config_v2_invalid_active_layout_id_dropped() {
        let input = serde_json::json!({
            "version": 2,
            "ui": { "fontSize": 14 },
            "shell": { "profiles": [], "defaultProfile": "" },
            "layouts": [valid_layout()],
            "activeLayoutId": "nonexistent",
        });

        let result = sanitize_config(&input);
        let obj = result.as_object().unwrap();
        assert!(obj.get("activeLayoutId").is_none());
    }
}
