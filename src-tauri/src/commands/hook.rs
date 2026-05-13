// Hook management — global event-to-command hooks stored in settings.json.
//
// Hooks let users configure command-line actions that fire on specific
// application events (e.g. alert.start, alert.stop). The hook config is
// persisted alongside other settings, and commands are executed via the
// Tauri shell plugin (spawn API).
//
// Data flow:
//   Frontend emits event → HookManager matches enabled hooks →
//   bridge.hookExecute(command) → Tauri invoke → hook_execute_command
//   → tauri_plugin_shell::spawn

use super::settings::{sanitize_config, settings_path, SettingsState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

// ----------------------------------------------------------------
// Hook types
// ----------------------------------------------------------------

/// A single hook: binds an event to a command-line action.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hook {
    /// Unique identifier (user-defined or auto-generated).
    pub id: String,
    /// Human-readable name shown in the UI.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// The event type to listen for (e.g. "alert.start", "alert.stop").
    pub event: String,
    /// The command line to execute when the event fires.
    pub command: String,
    /// Whether this hook is currently enabled.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

/// Result type for commands that return the full hooks list.
#[derive(serde::Serialize)]
pub struct HooksResult {
    hooks: Vec<Hook>,
}

impl Hook {
    /// Validate and sanitize a raw hook from arbitrary JSON.
    ///
    /// - `id` must be non-empty; whitespace is trimmed.
    /// - `name` is optional; whitespace is trimmed.
    /// - `event` must be non-empty; whitespace is trimmed.
    /// - `command` must be non-empty; whitespace is trimmed.
    /// - `enabled` defaults to true if absent.
    ///
    /// Returns `None` if the hook lacks a usable id, event, or command.
    pub fn sanitize(candidate: &Value) -> Option<Self> {
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
            .unwrap_or("")
            .to_string();
        let event = obj
            .get("event")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        let command = obj
            .get("command")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        let enabled = obj
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        Some(Self {
            id: id.to_string(),
            name,
            event: event.to_string(),
            command: command.to_string(),
            enabled,
        })
    }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/// Read hooks from the settings file, applying full sanitization.
fn read_hooks_config(app: &AppHandle) -> Result<(Value, Vec<Hook>), String> {
    let path = settings_path(app)?;

    let raw = if path.exists() {
        let contents =
            std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;
        serde_json::from_str(&contents).unwrap_or(Value::Null)
    } else {
        Value::Null
    };

    let sanitized = sanitize_config(&raw);
    let hooks = extract_hooks(&sanitized);

    Ok((sanitized, hooks))
}

/// Extract hooks from the sanitized config.
fn extract_hooks(config: &Value) -> Vec<Hook> {
    config
        .get("hooks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| Hook::sanitize(item))
                .collect()
        })
        .unwrap_or_default()
}

/// Write the full config (with hooks replaced) back to disk.
fn write_config(app: &AppHandle, config: &Value) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))
}

// ----------------------------------------------------------------
// Tauri commands
// ----------------------------------------------------------------

/// List all configured hooks.
#[tauri::command]
pub fn hooks_list(app: AppHandle) -> Result<HooksResult, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (_, hooks) = read_hooks_config(&app)?;
    Ok(HooksResult { hooks })
}

/// Add a new hook. If a hook with the same `id` already exists, it is replaced.
#[tauri::command]
pub fn hook_add(app: AppHandle, hook: Value) -> Result<HooksResult, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (mut config, mut hooks) = read_hooks_config(&app)?;

    let new_hook =
        Hook::sanitize(&hook).ok_or("invalid hook: 'id', 'event', and 'command' are required")?;

    // Upsert: replace existing hook with the same id, or append.
    if let Some(existing) = hooks.iter_mut().find(|h| h.id == new_hook.id) {
        *existing = new_hook;
    } else {
        hooks.push(new_hook);
    }

    // Patch the hooks array in the config and re-sanitize for consistency.
    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "hooks".to_string(),
            serde_json::to_value(&hooks).unwrap_or(Value::Array(vec![])),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(&app, &sanitized)?;

    Ok(HooksResult {
        hooks: extract_hooks(&sanitized),
    })
}

/// Remove a hook by `id`.
#[tauri::command]
pub fn hook_remove(app: AppHandle, hook_id: String) -> Result<HooksResult, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (mut config, mut hooks) = read_hooks_config(&app)?;

    let before_len = hooks.len();
    hooks.retain(|h| h.id != hook_id);

    if hooks.len() == before_len {
        return Err(format!("hook not found: {hook_id}"));
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "hooks".to_string(),
            serde_json::to_value(&hooks).unwrap_or(Value::Array(vec![])),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(&app, &sanitized)?;

    Ok(HooksResult {
        hooks: extract_hooks(&sanitized),
    })
}

/// Update an existing hook (partial update: only provided fields are changed).
#[tauri::command]
pub fn hook_update(app: AppHandle, hook_id: String, updates: Value) -> Result<HooksResult, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (mut config, mut hooks) = read_hooks_config(&app)?;

    let hook = hooks
        .iter_mut()
        .find(|h| h.id == hook_id)
        .ok_or_else(|| format!("hook not found: {hook_id}"))?;

    // Apply partial updates
    if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
        hook.name = name.trim().to_string();
    }
    if let Some(event) = updates.get("event").and_then(|v| v.as_str()) {
        let trimmed = event.trim();
        if trimmed.is_empty() {
            return Err("event must not be empty".to_string());
        }
        hook.event = trimmed.to_string();
    }
    if let Some(command) = updates.get("command").and_then(|v| v.as_str()) {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("command must not be empty".to_string());
        }
        hook.command = trimmed.to_string();
    }
    if let Some(enabled) = updates.get("enabled").and_then(|v| v.as_bool()) {
        hook.enabled = enabled;
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "hooks".to_string(),
            serde_json::to_value(&hooks).unwrap_or(Value::Array(vec![])),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(&app, &sanitized)?;

    Ok(HooksResult {
        hooks: extract_hooks(&sanitized),
    })
}

/// Execute a hook command. Spawns the command as a detached process via
/// the Tauri shell plugin. Does not wait for completion; fire-and-forget.
///
/// The `command` string is passed to `sh -c` on Unix or `cmd /C` on Windows.
/// Template placeholders `{key}` are replaced with shell-escaped values
/// from `params`.
#[tauri::command]
pub async fn hook_execute(
    app: AppHandle,
    command: String,
    params: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let resolved = resolve_templates(&command, params.unwrap_or_default());

    let shell = app.shell();

    #[cfg(target_os = "windows")]
    let result = shell.command("cmd").args(["/C", &resolved]).spawn();

    #[cfg(not(target_os = "windows"))]
    let result = shell.command("sh").args(["-c", &resolved]).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("failed to execute hook command: {e}"))
}

fn resolve_templates(template: &str, params: std::collections::HashMap<String, String>) -> String {
    let mut result = template.to_string();
    for (key, value) in &params {
        let pattern = format!("{{{key}}}");
        if result.contains(&pattern) {
            let escaped = shell_escape(value);
            result = result.replace(&pattern, &escaped);
        }
    }
    result
}

fn shell_escape(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    let safe = s
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'/');
    if safe {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}
