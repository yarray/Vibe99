use std::sync::Arc;
use tauri::{AppHandle, State, Window};

use crate::pty::PtyManager;

pub struct AppState {
    pub pty: Arc<PtyManager>,
}

#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    pane_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    shell_profile_id: Option<String>,
) -> Result<(), String> {
    state.pty.spawn(
        app,
        &pane_id,
        cols,
        rows,
        cwd.as_deref(),
        shell_profile_id.as_deref(),
        window.label(),
    )
}

#[tauri::command]
pub fn terminal_write(
    window: Window,
    state: State<'_, AppState>,
    pane_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64_decode(&data).map_err(|e| format!("invalid base64 data: {e}"))?;
    state.pty.write(window.label(), &pane_id, &bytes)
}

#[tauri::command]
pub fn terminal_resize(
    window: Window,
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(window.label(), &pane_id, cols, rows)
}

#[tauri::command]
pub fn terminal_destroy(window: Window, state: State<'_, AppState>, pane_id: String) {
    state.pty.destroy(window.label(), &pane_id);
}

pub fn destroy_all_terminals(state: &AppState) {
    state.pty.destroy_all();
}

pub fn destroy_terminals_for_window(state: &AppState, window_label: &str) {
    state.pty.destroy_for_window(window_label);
}

#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("failed to get cwd: {e}"))
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("{e}"))
}
