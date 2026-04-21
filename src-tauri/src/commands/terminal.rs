use tauri::{AppHandle, Emitter, State};

use crate::pty::PtyManager;

/// Managed state holding the PTY session manager.
pub struct AppState {
    pub pty: PtyManager,
}

/// Create a new PTY session for a terminal pane.
///
/// If a session already exists for the given `pane_id` it is destroyed
/// before the new one is spawned.
///
/// PTY output is forwarded to the frontend via the `pty-output` event:
/// ```json
/// { "pane_id": "...", "data": "<base64>" }
/// ```
///
/// When the child process exits, a `pty-exit` event is emitted:
/// ```json
/// { "pane_id": "...", "exit_code": 0 }
/// ```
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> Result<(), String> {
    state.pty.spawn(
        &pane_id,
        cols,
        rows,
        cwd.as_deref(),
        move |data| {
            let payload = PtyOutputPayload {
                pane_id: pane_id.clone(),
                data: base64_encode(&data),
            };
            let _ = app.emit("pty-output", payload);
        },
        move |exit_code| {
            let payload = PtyExitPayload {
                pane_id: pane_id.clone(),
                exit_code,
            };
            let _ = app.emit("pty-exit", payload);
        },
    )
}

/// Write raw bytes to the PTY for the given pane.
///
/// `data` is expected to be a base64-encoded string of the bytes to write.
#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    pane_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64_decode(&data).map_err(|e| format!("invalid base64 data: {e}"))?;
    state.pty.write(&pane_id, &bytes)
}

/// Resize the PTY for the given pane.
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(&pane_id, cols, rows)
}

/// Destroy the PTY session for the given pane.
#[tauri::command]
pub fn terminal_destroy(state: State<'_, AppState>, pane_id: String) {
    state.pty.destroy(&pane_id);
}

/// Destroy all active PTY sessions.
///
/// Called during application shutdown to ensure child processes are cleaned up.
pub fn destroy_all_terminals(state: &AppState) {
    state.pty.destroy_all();
}

// ----------------------------------------------------------------
// Event payloads
// ----------------------------------------------------------------

#[derive(serde::Serialize)]
struct PtyOutputPayload {
    pane_id: String,
    data: String,
}

#[derive(serde::Serialize)]
struct PtyExitPayload {
    pane_id: String,
    exit_code: u32,
}

// ----------------------------------------------------------------
// Base64 helpers (no external dependency)
// ----------------------------------------------------------------

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::engine::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("{e}"))
}
