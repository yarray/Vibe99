use super::settings::{sanitize_config, sanitize_layout, settings_path, SettingsState};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Read the raw settings file and return the sanitized config.
fn read_settings(app: &AppHandle) -> Result<Value, String> {
    let path = settings_path(app)?;

    let raw = if path.exists() {
        let contents =
            std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;
        serde_json::from_str(&contents).unwrap_or(Value::Null)
    } else {
        Value::Null
    };

    Ok(sanitize_config(&raw))
}

/// Persist the sanitized config back to disk.
fn write_settings(app: &AppHandle, config: &Value) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))
}

/// Extract the layouts array from sanitized config.
fn extract_layouts(config: &Value) -> Vec<Value> {
    config
        .get("layouts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

/// Extract the active layout id from sanitized config.
fn extract_active_layout_id(config: &Value) -> String {
    config
        .get("activeLayoutId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ----------------------------------------------------------------
// Tauri commands
// ----------------------------------------------------------------

/// List all saved layouts and the current active layout id.
#[tauri::command]
pub fn layouts_list(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let config = read_settings(&app)?;
    Ok(serde_json::json!({
        "layouts": extract_layouts(&config),
        "activeLayoutId": extract_active_layout_id(&config),
    }))
}

/// Save a layout (add new or update existing by `id`).
///
/// The layout is sanitized before storage. Returns the updated full settings.
#[tauri::command]
pub fn layout_save(app: AppHandle, layout: Value) -> Result<Value, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let mut config = read_settings(&app)?;

    let sanitized_layout = sanitize_layout(&layout)
        .ok_or("invalid layout: 'id', 'name', and at least one valid pane are required")?;

    let layout_id = sanitized_layout
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut layouts = extract_layouts(&config);

    // Upsert: replace existing layout with the same id, or append.
    if let Some(existing) = layouts
        .iter_mut()
        .find(|l| l.get("id").and_then(|v| v.as_str()).unwrap_or("") == layout_id)
    {
        *existing = sanitized_layout;
    } else {
        layouts.push(sanitized_layout);
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert("layouts".into(), Value::Array(layouts));
    }

    let sanitized = sanitize_config(&config);
    write_settings(&app, &sanitized)?;

    Ok(sanitized)
}

/// Delete a layout by `layout_id`.
///
/// If the removed layout was the active one, `activeLayoutId` is cleared.
/// Returns the updated full settings.
#[tauri::command]
pub fn layout_delete(app: AppHandle, layout_id: String) -> Result<Value, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let mut config = read_settings(&app)?;

    let mut layouts = extract_layouts(&config);
    let before_len = layouts.len();

    layouts.retain(|l| l.get("id").and_then(|v| v.as_str()).unwrap_or("") != layout_id);

    if layouts.len() == before_len {
        return Err(format!("layout not found: {layout_id}"));
    }

    let active_is_deleted = extract_active_layout_id(&config) == layout_id;

    if let Some(obj) = config.as_object_mut() {
        if layouts.is_empty() {
            obj.remove("layouts");
        } else {
            obj.insert("layouts".into(), Value::Array(layouts));
        }

        if active_is_deleted {
            obj.insert("activeLayoutId".into(), Value::String(String::new()));
        }
    }

    let sanitized = sanitize_config(&config);
    write_settings(&app, &sanitized)?;

    Ok(sanitized)
}

/// Rename a layout by `layout_id`.
///
/// Returns the updated full settings.
#[tauri::command]
pub fn layout_rename(app: AppHandle, layout_id: String, new_name: String) -> Result<Value, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let mut config = read_settings(&app)?;

    let mut layouts = extract_layouts(&config);
    let new_name = new_name.trim();

    let layout = layouts
        .iter_mut()
        .find(|l| l.get("id").and_then(|v| v.as_str()).unwrap_or("") == layout_id)
        .ok_or_else(|| format!("layout not found: {layout_id}"))?;

    if new_name.is_empty() {
        return Err("new name must not be empty".to_string());
    }

    if let Some(obj) = layout.as_object_mut() {
        obj.insert("name".into(), Value::String(new_name.to_string()));
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert("layouts".into(), Value::Array(layouts));
    }

    let sanitized = sanitize_config(&config);
    write_settings(&app, &sanitized)?;

    Ok(sanitized)
}
