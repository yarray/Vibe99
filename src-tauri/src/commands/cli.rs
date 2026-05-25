/**
 * CLI Server — Event Passthrough Bridge (Plan B)
 *
 * Listens on a Unix Domain Socket (or Named Pipe on Windows) for JSON-RPC 2.0
 * requests from the `vibe99ctl` CLI binary. Requests are either:
 *
 * - **Passthrough**: forwarded to the TypeScript frontend via
 *   `app.emit("vibe99:cli-request", { id, method, params })`, which calls
 *   `dispatch()` and returns the result via `invoke("cli_respond", { id, result })`.
 * - **Direct**: handled entirely in Rust by calling existing Tauri command logic.
 *
 * Lifecycle:
 * - Started in `main.rs` `.setup()` via `start_cli_server()`.
 * - Cleaned up automatically when the process exits (socket + PID file removed).
 *
 * @module commands/cli
 */

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Shared state for the CLI server.
///
/// `pending` holds oneshot senders keyed by request ID.
/// When the TypeScript frontend calls `cli_respond`, the matching sender
/// is popped and the result is delivered to the waiting connection handler.
pub struct CliState {
    pub pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
}

impl Default for CliState {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Resolve the directory that holds CLI-related files (PID, socket).
///
/// Unix  : `$XDG_RUNTIME_DIR/vibe99/` (fallback `/tmp/vibe99-$UID/`)
/// Windows: `%APPDATA%\vibe99\`
fn cli_runtime_dir() -> Result<PathBuf, String> {
    #[cfg(unix)]
    {
        let base = std::env::var("XDG_RUNTIME_DIR").ok().or_else(|| {
            let uid = unsafe { libc::getuid() };
            Some(format!("/tmp/vibe99-{uid}"))
        });
        let base = base.ok_or("cannot determine runtime directory")?;
        Ok(PathBuf::from(base).join("vibe99"))
    }
    #[cfg(windows)]
    {
        let appdata = std::env::var("APPDATA").map_err(|e| format!("APPDATA not set: {e}"))?;
        Ok(PathBuf::from(appdata).join("vibe99"))
    }
}

/// Resolve the Unix Domain Socket path (or Named Pipe name on Windows).
pub fn socket_path() -> Result<PathBuf, String> {
    #[cfg(unix)]
    {
        let dir = cli_runtime_dir()?;
        Ok(dir.join("vibe99.sock"))
    }
    #[cfg(windows)]
    {
        // Named pipes live in kernel space; we use a conventional path string.
        Ok(PathBuf::from(r"\\.\pipe\vibe99"))
    }
}

/// Resolve the PID file path.
pub fn pid_file_path() -> Result<PathBuf, String> {
    let dir = cli_runtime_dir()?;
    Ok(dir.join("vibe99.pid"))
}

// ---------------------------------------------------------------------------
// PID file management
// ---------------------------------------------------------------------------

fn write_pid_file() -> Result<(), String> {
    let path = pid_file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create PID dir: {e}"))?;
    }
    let pid = std::process::id();
    std::fs::write(&path, pid.to_string())
        .map_err(|e| format!("failed to write PID file: {e}"))?;
    Ok(())
}

fn remove_pid_file() {
    if let Ok(path) = pid_file_path() {
        let _ = std::fs::remove_file(path);
    }
}

fn remove_socket_file() {
    #[cfg(unix)]
    {
        if let Ok(path) = socket_path() {
            let _ = std::fs::remove_file(path);
        }
    }
}

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Value,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

fn ok_response(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn err_response(id: Value, code: i32, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError { code, message }),
    }
}

// ---------------------------------------------------------------------------
// Method routing
// ---------------------------------------------------------------------------

/// Methods that must be forwarded to the TypeScript frontend (passthrough).
fn is_passthrough(method: &str) -> bool {
    matches!(
        method,
        "pane.create"
            | "pane.close"
            | "pane.focus"
            | "pane.move"
            | "pane.rename.start"
            | "pane.rename.commit"
            | "pane.setColor"
            | "pane.clearColor"
            | "pane.toggleActivityAlert"
            | "pane.setTheme"
            | "pane.requestClose"
            | "focus.next"
            | "focus.prev"
            | "focus.left"
            | "focus.right"
            | "focus.recent"
            | "focus.nextLit"
            | "focus.at"
            | "focus.blur"
            | "focus.refocus"
            | "focus.commit"
            | "mode.set"
            | "layout.save"
            | "layout.activate"
            | "terminal.restart"
            | "terminal.changeShell"
    )
}

/// Handle a "direct" method entirely in Rust without touching the frontend.
async fn handle_direct(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "settings.get" => {
            let config = super::settings::settings_load(app.clone())?;
            if let Some(key) = params.get("key").and_then(|v| v.as_str()) {
                let mut current = &config;
                for part in key.split('.') {
                    current = current.get(part).ok_or_else(|| {
                        format!("key not found: {key}")
                    })?;
                }
                Ok(current.clone())
            } else {
                Ok(config)
            }
        }
        "settings.set" => {
            let updates = params.get("settings").cloned().ok_or("missing 'settings' param")?;
            if !updates.is_object() {
                return Err("'settings' must be a JSON object".to_string());
            }
            let current = super::settings::settings_load(app.clone())?;
            let merged = deep_merge(current, updates);
            super::settings::settings_save(app.clone(), merged)
        }
        "settings.schema" => Ok(settings_schema()),
        "layout.list" => {
            super::layout::layouts_list(app.clone())
                .map(|v| serde_json::json!({"ok": true, "value": v}))
        }
        "pane.list" => {
            // Pane list comes from the current layout in settings.
            // Read settings and extract the active layout's panes.
            let config = super::settings::settings_load(app.clone())?;
            let layouts = config.get("layouts").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let default_id = config.get("defaultLayoutId").and_then(|v| v.as_str()).unwrap_or("");
            let active = layouts.iter().find(|l| {
                l.get("id").and_then(|v| v.as_str()).unwrap_or("") == default_id
            }).or_else(|| layouts.first());
            let panes = active
                .and_then(|l| l.get("panes"))
                .cloned()
                .unwrap_or(Value::Array(vec![]));
            Ok(serde_json::json!({"ok": true, "value": panes}))
        }
        "shell.list" => {
            super::shell_profile::shell_profiles_list(app.clone())
                .map(|v| serde_json::json!({"ok": true, "value": v}))
        }
        "terminal.send-keys" => {
            let pane_id = params.get("paneId").and_then(|v| v.as_str()).ok_or("missing 'paneId'")?;
            let text = params.get("text").and_then(|v| v.as_str()).ok_or("missing 'text'")?;
            let bytes = base64_encode(text);
            let bytes = base64_decode(&bytes)?;
            let app_state = app.state::<super::terminal::AppState>();
            app_state.pty.write("main", pane_id, &bytes)?;
            Ok(serde_json::json!({"ok": true}))
        }
        "terminal.resize" => {
            let pane_id = params.get("paneId").and_then(|v| v.as_str()).ok_or("missing 'paneId'")?;
            let cols = params.get("cols").and_then(|v| v.as_u64()).ok_or("missing 'cols'")? as u16;
            let rows = params.get("rows").and_then(|v| v.as_u64()).ok_or("missing 'rows'")? as u16;
            let app_state = app.state::<super::terminal::AppState>();
            app_state.pty.resize("main", pane_id, cols, rows)?;
            Ok(serde_json::json!({"ok": true}))
        }
        _ => Err(format!("unknown direct method: {method}")),
    }
}

fn base64_encode(text: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("invalid base64: {e}"))
}

fn deep_merge(base: Value, override_val: Value) -> Value {
    match (base, override_val) {
        (Value::Object(mut base_map), Value::Object(over_map)) => {
            for (k, v) in over_map {
                let merged = if let Some(base_v) = base_map.remove(&k) {
                    deep_merge(base_v, v)
                } else {
                    v
                };
                base_map.insert(k, merged);
            }
            Value::Object(base_map)
        }
        (_, over) => over,
    }
}

fn settings_schema() -> Value {
    serde_json::json!({
        "fields": {
            "fontSize": {
                "type": "integer",
                "min": 10,
                "max": 24,
                "default": 13,
                "description": "Terminal font size in pixels"
            },
            "fontFamily": {
                "type": "string",
                "default": "",
                "description": "Font family name. Empty string uses platform default"
            },
            "paneOpacity": {
                "type": "number",
                "min": 0.55,
                "max": 1.0,
                "default": 0.8,
                "description": "Pane background opacity"
            },
            "paneMaskOpacity": {
                "type": "number",
                "min": 0.0,
                "max": 1.0,
                "default": 0.75,
                "description": "Mask overlay opacity for inactive panes"
            },
            "paneWidth": {
                "type": "integer",
                "min": 520,
                "max": 2000,
                "default": 720,
                "multipleOf": 10,
                "description": "Default pane width in pixels"
            },
            "webglEnabled": {
                "type": "boolean",
                "default": true,
                "description": "Enable WebGL renderer for terminal canvas"
            },
            "breathingIntensity": {
                "type": "string",
                "enum": ["none", "mild", "intense"],
                "default": "mild",
                "description": "Activity breathing animation intensity"
            },
            "activityAlertDebounceMs": {
                "type": "integer",
                "min": 3000,
                "max": 300000,
                "default": 30000,
                "description": "Debounce interval for activity alerts (ms)"
            },
            "layoutHotkeys": {
                "type": "object",
                "additionalProperties": { "type": "string" },
                "default": {},
                "description": "Keyboard shortcuts per layout. Key=layoutId, Value=shortcut string (e.g. 'F1', 'Ctrl+Shift+T')"
            },
            "quakeLayouts": {
                "type": "object",
                "default": {},
                "description": "Per-layout quake-mode config. Key=layoutId",
                "properties": {
                    "position": { "type": "string", "enum": ["top", "bottom"], "default": "top" },
                    "height": { "type": "integer", "min": 30, "max": 100, "default": 60 }
                }
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/// Start the CLI server in a background tokio task.
///
/// This should be called once during app `.setup()`.
pub fn start_cli_server(app: AppHandle) -> Result<(), String> {
    // Ensure parent directory exists.
    let sock_path = socket_path()?;
    if let Some(parent) = sock_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create socket dir: {e}"))?;
    }

    // Clean up stale socket from a previous run.
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(&sock_path);
    }

    // Write PID file so the CLI binary can discover us.
    write_pid_file()?;

    let pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>> =
        app.state::<CliState>().pending.clone();

    #[cfg(unix)]
    {
        let listener = {
            use tokio::net::UnixListener;
            UnixListener::bind(&sock_path)
                .map_err(|e| format!("failed to bind UDS at {}: {e}", sock_path.display()))?
        };

        let app_clone = app.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _addr)) => {
                        let app = app_clone.clone();
                        let pending = pending.clone();
                        tokio::spawn(async move {
                            handle_connection_unix(stream, app, pending).await;
                        });
                    }
                    Err(e) => {
                        eprintln!("[cli] accept error: {e}");
                        // Back off briefly to avoid spinning.
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                }
            }
        });
    }

    #[cfg(windows)]
    {
        let app_clone = app.clone();
        tokio::spawn(async move {
            run_named_pipe_server(&app_clone, pending).await;
        });
    }

    Ok(())
}

/// Clean up CLI server resources (socket, PID file).
pub fn cleanup_cli_server() {
    remove_socket_file();
    remove_pid_file();
}

// ---------------------------------------------------------------------------
// Connection handler (Unix)
// ---------------------------------------------------------------------------

#[cfg(unix)]
async fn handle_connection_unix(
    stream: tokio::net::UnixStream,
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let resp = err_response(Value::Null, -32700, format!("parse error: {e}"));
                if let Ok(s) = serde_json::to_string(&resp) {
                    let _ = writer.write_all(format!("{s}\n").as_bytes()).await;
                }
                continue;
            }
        };

        let response = process_request(&app, &pending, request).await;
        let mut out = serde_json::to_string(&response).unwrap_or_default();
        out.push('\n');
        if writer.write_all(out.as_bytes()).await.is_err() {
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Connection handler (Windows Named Pipe)
// ---------------------------------------------------------------------------

#[cfg(windows)]
async fn run_named_pipe_server(
    app: &AppHandle,
    pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_path = match socket_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[cli] pipe path error: {e}");
            return;
        }
    };

    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(false)
            .create(&pipe_path)
            .expect("failed to create named pipe");

        // Wait for a client to connect.
        if let Err(e) = server.connect().await {
            eprintln!("[cli] pipe connect error: {e}");
            continue;
        }

        let app = app.clone();
        let pending = pending.clone();
        tokio::spawn(async move {
            let (reader, mut writer) = tokio::io::split(server);
            let mut lines = BufReader::new(reader).lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let request: JsonRpcRequest = match serde_json::from_str(&line) {
                    Ok(r) => r,
                    Err(e) => {
                        let resp = err_response(Value::Null, -32700, format!("parse error: {e}"));
                        if let Ok(s) = serde_json::to_string(&resp) {
                            let _ = writer.write_all(format!("{s}\n").as_bytes()).await;
                        }
                        continue;
                    }
                };

                let response = process_request(&app, &pending, request).await;
                if let Ok(s) = serde_json::to_string(&response) {
                    if writer.write_all(format!("{s}\n").as_bytes()).await.is_err() {
                        break;
                    }
                }
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Request processing
// ---------------------------------------------------------------------------

async fn process_request(
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
    request: JsonRpcRequest,
) -> JsonRpcResponse {
    let id = request.id.clone();
    let method = request.method.clone();
    let params = request.params.clone().unwrap_or(Value::Object(serde_json::Map::new()));

    if is_passthrough(&method) {
        // Generate a unique request ID.
        let request_id = uuid::Uuid::new_v4().to_string();

        // Create oneshot channel for the response.
        let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
        {
            let mut map = pending.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }

        // Emit the request to the TypeScript frontend.
        let payload = serde_json::json!({
            "id": request_id,
            "method": method,
            "params": params,
        });

        if let Err(e) = app.emit("vibe99:cli-request", payload) {
            // Remove the pending entry.
            let mut map = pending.lock().unwrap();
            map.remove(&request_id);
            return err_response(id, -32603, format!("emit error: {e}"));
        }

        // Wait for the response with a timeout.
        match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => ok_response(id, result),
            Ok(Err(_)) => {
                // Sender was dropped without sending (shouldn't happen normally).
                let mut map = pending.lock().unwrap();
                map.remove(&request_id);
                err_response(id, -32603, "response channel closed".to_string())
            }
            Err(_) => {
                // Timeout.
                let mut map = pending.lock().unwrap();
                map.remove(&request_id);
                err_response(id, -32603, "request timed out (5s)".to_string())
            }
        }
    } else {
        // Direct handling in Rust.
        match handle_direct(app, &method, params).await {
            Ok(result) => ok_response(id, result),
            Err(e) => err_response(id, -32603, e),
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri command: cli_respond
// ---------------------------------------------------------------------------

/// Called by the TypeScript frontend to return a passthrough command result.
///
/// The frontend calls `invoke("cli_respond", { id, result })` after
/// `dispatch(command)` completes.
#[tauri::command]
pub fn cli_respond(
    app: AppHandle,
    id: String,
    result: Value,
) -> Result<(), String> {
    let state = app.state::<CliState>();
    let mut map = state.pending.lock().map_err(|e| format!("lock error: {e}"))?;
    if let Some(sender) = map.remove(&id) {
        let _ = sender.send(result);
    }
    Ok(())
}
