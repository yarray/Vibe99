use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub shortcut: String,
    #[serde(rename = "layoutId")]
    pub layout_id: String,
}

#[derive(Default)]
pub struct HotkeyState {
    pub bindings: Mutex<HashMap<String, String>>,
}

#[tauri::command]
pub fn hotkey_register(app: AppHandle, shortcut: String, layout_id: String) -> Result<(), String> {
    let state = app.state::<HotkeyState>();
    let mut bindings = state
        .bindings
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    let parsed = Shortcut::from_str(&shortcut)
        .map_err(|e| format!("invalid shortcut '{shortcut}': {e}"))?;

    app.global_shortcut()
        .register(parsed)
        .map_err(|e| format!("failed to register shortcut: {e}"))?;

    bindings.insert(shortcut, layout_id);
    Ok(())
}

#[tauri::command]
pub fn hotkey_unregister(app: AppHandle, shortcut: String) -> Result<(), String> {
    let state = app.state::<HotkeyState>();
    let mut bindings = state
        .bindings
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    let parsed = Shortcut::from_str(&shortcut)
        .map_err(|e| format!("invalid shortcut '{shortcut}': {e}"))?;

    app.global_shortcut()
        .unregister(parsed)
        .map_err(|e| format!("failed to unregister shortcut: {e}"))?;

    bindings.remove(&shortcut);
    Ok(())
}

#[tauri::command]
pub fn hotkey_list(app: AppHandle) -> Result<Vec<HotkeyBinding>, String> {
    let state = app.state::<HotkeyState>();
    let bindings = state
        .bindings
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    Ok(bindings
        .iter()
        .map(|(shortcut, layout_id)| HotkeyBinding {
            shortcut: shortcut.clone(),
            layout_id: layout_id.clone(),
        })
        .collect())
}

#[tauri::command]
pub fn hotkey_register_all(app: AppHandle, bindings: Vec<HotkeyBinding>) -> Result<(), String> {
    let state = app.state::<HotkeyState>();
    let mut state_bindings = state
        .bindings
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("failed to unregister all shortcuts: {e}"))?;

    state_bindings.clear();

    for binding in &bindings {
        let parsed = Shortcut::from_str(&binding.shortcut)
            .map_err(|e| format!("invalid shortcut '{}': {e}", binding.shortcut))?;
        app.global_shortcut()
            .register(parsed)
            .map_err(|e| format!("failed to register '{}': {e}", binding.shortcut))?;
        state_bindings.insert(binding.shortcut.clone(), binding.layout_id.clone());
    }

    Ok(())
}
