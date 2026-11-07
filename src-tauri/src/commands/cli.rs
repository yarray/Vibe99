/**
 * CLI Server — Event Passthrough Bridge (Plan B)
 *
 * Listens on a Unix Domain Socket (or Named Pipe on Windows) for JSON-RPC 2.0
 * requests from the `vibe99ctl` CLI binary. Requests are either:
 *
 * - **Passthrough**: forwarded to the TypeScript frontend via
 *   `app.emit_to(window, "vibe99:cli-request", { id, method, params })`, which
 *   calls `dispatch()` and returns the result via `invoke("cli_respond", { id, result })`.
 *   The target window comes from the `windowId` param (default `"main"`), so
 *   pane/layout state is read from a deterministic window instead of racing
 *   every open one.
 * - **Direct**: handled entirely in Rust by calling existing Tauri command logic.
 *   `terminal.send-keys` / `terminal.resize` resolve the owning window from the
 *   `windowId` param, then from the PTY session map, then fall back to `"main"`.
 *
 * Both kinds accept a `timeoutMs` request param bounding the passthrough wait
 * (default 5s, capped at 120s); routing metadata is stripped before dispatch.
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
            | "pane.list"
            | "pane.info"
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
            | "layout.active"
            | "terminal.restart"
            | "terminal.changeShell"
    )
}

/// Look up a dotted key path (e.g. `"theme.editor.bg"`) in a settings value.
fn select_key(config: &Value, key: &str) -> Result<Value, String> {
    let mut current = config;
    for part in key.split('.') {
        current = current
            .get(part)
            .ok_or_else(|| format!("key not found: {key}"))?;
    }
    Ok(current.clone())
}

/// Extract and validate the `settings` object from a `settings.set` request.
fn settings_updates_from_params(params: &Value) -> Result<Value, String> {
    let updates = params
        .get("settings")
        .cloned()
        .ok_or("missing 'settings' param")?;
    if !updates.is_object() {
        return Err("'settings' must be a JSON object".to_string());
    }
    Ok(updates)
}

/// Resolve the window label that owns `pane_id` for direct PTY access.
///
/// An explicit `windowId` param wins; otherwise the PTY session map is the
/// source of truth for which window the pane lives in. When the pane is not
/// running anywhere, fall back to `"main"` so the subsequent write/resize
/// reports the familiar "no session for pane" error.
fn pick_window_label(
    explicit: Option<&str>,
    live_labels: &[String],
    pane_id: &str,
) -> Result<String, String> {
    if let Some(label) = explicit {
        return Ok(label.to_string());
    }
    match live_labels {
        [] => Ok("main".to_string()),
        [only] => Ok(only.clone()),
        many => Err(format!(
            "pane {pane_id} is live in multiple windows ({}); pass windowId",
            many.join(", ")
        )),
    }
}

fn resolve_pty_window(app: &AppHandle, params: &Value, pane_id: &str) -> Result<String, String> {
    let explicit = params.get("windowId").and_then(|v| v.as_str());
    let live_labels = app
        .state::<super::terminal::AppState>()
        .pty
        .window_labels_for_pane(pane_id);
    pick_window_label(explicit, &live_labels, pane_id)
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
            match params.get("key").and_then(|v| v.as_str()) {
                Some(key) => select_key(&config, key),
                None => Ok(config),
            }
        }
        "settings.set" => {
            let updates = settings_updates_from_params(&params)?;
            let current = super::settings::settings_load(app.clone())?;
            let merged = deep_merge(current, updates);
            super::settings::settings_save(app.clone(), merged)
        }
        "settings.schema" => Ok(settings_schema()),
        "layout.list" => {
            super::layout::layouts_list(app.clone())
                .map(|v| serde_json::json!({"ok": true, "value": v}))
        }
        "shell.list" => {
            super::shell_profile::shell_profiles_list(app.clone())
                .map(|v| serde_json::json!({"ok": true, "value": v}))
        }
        "terminal.send-keys" => {
            let pane_id = params.get("paneId").and_then(|v| v.as_str()).ok_or("missing 'paneId'")?;
            let text = params.get("text").and_then(|v| v.as_str()).ok_or("missing 'text'")?;
            let window_label = resolve_pty_window(app, &params, pane_id)?;
            let app_state = app.state::<super::terminal::AppState>();
            app_state.pty.write(&window_label, pane_id, text.as_bytes())?;
            Ok(serde_json::json!({"ok": true}))
        }
        "terminal.resize" => {
            let pane_id = params.get("paneId").and_then(|v| v.as_str()).ok_or("missing 'paneId'")?;
            let cols = params.get("cols").and_then(|v| v.as_u64()).ok_or("missing 'cols'")? as u16;
            let rows = params.get("rows").and_then(|v| v.as_u64()).ok_or("missing 'rows'")? as u16;
            let window_label = resolve_pty_window(app, &params, pane_id)?;
            let app_state = app.state::<super::terminal::AppState>();
            app_state.pty.resize(&window_label, pane_id, cols, rows)?;
            Ok(serde_json::json!({"ok": true}))
        }
        _ => Err(format!("unknown direct method: {method}")),
    }
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
    // Windows Named Pipe resolves its own path inside run_named_pipe_server().
    #[cfg(unix)]
    let sock_path = socket_path()?;

    #[cfg(unix)]
    {
        if let Some(parent) = sock_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create socket dir: {e}"))?;
        }
        // Clean up stale socket from a previous run.
        let _ = std::fs::remove_file(&sock_path);
    }

    // Write PID file so the CLI binary can discover us.
    write_pid_file()?;

    let pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>> =
        app.state::<CliState>().pending.clone();

    // Spawn the server loop inside the Tokio runtime via tauri::async_runtime.
    // UnixListener::bind() and tokio::spawn() both require a Tokio reactor,
    // which is not available in Tauri's .setup() callback on the main thread.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        #[cfg(unix)]
        {
            let listener = match tokio::net::UnixListener::bind(&sock_path) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[cli] failed to bind UDS at {}: {e}", sock_path.display());
                    return;
                }
            };

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
        }

        #[cfg(windows)]
        {
            run_named_pipe_server(&app_clone, pending).await;
        }
    });

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

    let pipe_name = match socket_path() {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(e) => {
            eprintln!("[cli] pipe path error: {e}");
            return;
        }
    };

    loop {
        let server = match ServerOptions::new()
            .access_inbound(true)
            .access_outbound(true)
            .create(&*pipe_name)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[cli] failed to create named pipe: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                continue;
            }
        };

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

/// Default wait for a passthrough response when the request carries no
/// `timeoutMs` (older clients).
const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Upper bound for a caller-requested passthrough timeout.
const MAX_TIMEOUT_MS: u64 = 120_000;

/// Extract the caller-requested passthrough timeout and remove it from
/// `params` so routing metadata never leaks into the dispatched command.
fn passthrough_timeout_ms(params: &mut Value) -> u64 {
    params
        .as_object_mut()
        .and_then(|obj| obj.remove("timeoutMs"))
        .and_then(|v| v.as_u64())
        .map(|ms| ms.clamp(1, MAX_TIMEOUT_MS))
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

/// Remove a routing-metadata key from an object-shaped `params`.
fn strip_param(params: &mut Value, key: &str) {
    if let Some(obj) = params.as_object_mut() {
        obj.remove(key);
    }
}

/// Format a timeout for the JSON-RPC error message.
fn format_timeout(ms: u64) -> String {
    if ms % 1000 == 0 {
        format!("{}s", ms / 1000)
    } else {
        format!("{ms}ms")
    }
}

async fn process_request(
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
    request: JsonRpcRequest,
) -> JsonRpcResponse {
    let id = request.id.clone();
    let method = request.method.clone();
    let mut params = request.params.clone().unwrap_or(Value::Object(serde_json::Map::new()));

    if is_passthrough(&method) {
        // Pane and layout state live in a specific window; route the request
        // there instead of broadcasting (every renderer would answer and the
        // fastest, not the correct, one would win).
        let window_label = params
            .get("windowId")
            .and_then(|v| v.as_str())
            .unwrap_or("main")
            .to_string();
        let timeout_ms = passthrough_timeout_ms(&mut params);
        strip_param(&mut params, "windowId");

        if app.get_webview_window(&window_label).is_none() {
            return err_response(id, -32603, format!("window not found: {window_label}"));
        }

        // Generate a unique request ID.
        let request_id = uuid::Uuid::new_v4().to_string();

        // Create oneshot channel for the response.
        let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
        {
            let mut map = pending.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }

        // Emit the request to the target window's TypeScript frontend.
        let payload = serde_json::json!({
            "id": request_id,
            "method": method,
            "params": params,
        });

        if let Err(e) = app.emit_to(&window_label, "vibe99:cli-request", payload) {
            // Remove the pending entry.
            let mut map = pending.lock().unwrap();
            map.remove(&request_id);
            return err_response(id, -32603, format!("emit error: {e}"));
        }

        // Wait for the response with a timeout.
        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), rx).await {
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
                err_response(
                    id,
                    -32603,
                    format!("request timed out ({})", format_timeout(timeout_ms)),
                )
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // --- settings.get key lookup ---

    #[test]
    fn select_key_top_level() {
        let config = json!({"fontSize": 13});
        assert_eq!(select_key(&config, "fontSize").unwrap(), json!(13));
    }

    #[test]
    fn select_key_nested() {
        let config = json!({"quakeLayouts": {"abc": {"position": "top"}}});
        assert_eq!(
            select_key(&config, "quakeLayouts.abc.position").unwrap(),
            json!("top")
        );
    }

    #[test]
    fn select_key_missing_leaf() {
        let config = json!({"fontSize": 13});
        assert_eq!(
            select_key(&config, "fontSize.bogus").unwrap_err(),
            "key not found: fontSize.bogus"
        );
    }

    #[test]
    fn select_key_missing_root() {
        let config = json!({"fontSize": 13});
        assert!(select_key(&config, "nope").is_err());
    }

    // --- settings.set updates validation ---

    #[test]
    fn settings_updates_accepts_object() {
        let params = json!({"settings": {"fontSize": 14}});
        assert_eq!(
            settings_updates_from_params(&params).unwrap(),
            json!({"fontSize": 14})
        );
    }

    #[test]
    fn settings_updates_rejects_missing_param() {
        let params = json!({});
        assert_eq!(
            settings_updates_from_params(&params).unwrap_err(),
            "missing 'settings' param"
        );
    }

    #[test]
    fn settings_updates_rejects_non_object() {
        for bad in [json!([1, 2]), json!("fontSize"), json!(13)] {
            let params = json!({"settings": bad});
            assert_eq!(
                settings_updates_from_params(&params).unwrap_err(),
                "'settings' must be a JSON object"
            );
        }
    }

    // --- deep_merge ---

    #[test]
    fn deep_merge_nested_objects() {
        let base = json!({"editor": {"fontSize": 13, "family": "mono"}});
        let over = json!({"editor": {"fontSize": 15}});
        assert_eq!(
            deep_merge(base, over),
            json!({"editor": {"fontSize": 15, "family": "mono"}})
        );
    }

    #[test]
    fn deep_merge_scalar_overrides_object() {
        let base = json!({"editor": {"fontSize": 13}});
        let over = json!({"editor": null});
        assert_eq!(deep_merge(base, over), json!({"editor": null}));
    }

    #[test]
    fn deep_merge_adds_new_key() {
        let base = json!({"fontSize": 13});
        let over = json!({"fontFamily": "Menlo"});
        assert_eq!(
            deep_merge(base, over),
            json!({"fontSize": 13, "fontFamily": "Menlo"})
        );
    }

    // --- window label resolution for direct PTY methods ---

    #[test]
    fn explicit_window_beats_pty_lookup() {
        let live = vec!["other".to_string()];
        assert_eq!(
            pick_window_label(Some("main"), &live, "p1").unwrap(),
            "main"
        );
    }

    #[test]
    fn unresolved_pane_falls_back_to_main() {
        assert_eq!(pick_window_label(None, &[], "p1").unwrap(), "main");
    }

    #[test]
    fn single_live_window_wins() {
        let live = vec!["layout-abc".to_string()];
        assert_eq!(pick_window_label(None, &live, "p1").unwrap(), "layout-abc");
    }

    #[test]
    fn ambiguous_pane_requires_window_id() {
        let live = vec!["main".to_string(), "layout-abc".to_string()];
        let err = pick_window_label(None, &live, "p1").unwrap_err();
        assert!(err.contains("pass windowId"), "unexpected error: {err}");
        assert!(err.contains("main, layout-abc"), "unexpected error: {err}");
    }

    // --- passthrough timeout param ---

    #[test]
    fn timeout_defaults_when_absent() {
        let mut params = json!({"paneId": "p1"});
        assert_eq!(passthrough_timeout_ms(&mut params), DEFAULT_TIMEOUT_MS);
        assert_eq!(params, json!({"paneId": "p1"}));
    }

    #[test]
    fn timeout_is_honored_and_stripped() {
        let mut params = json!({"paneId": "p1", "timeoutMs": 30000});
        assert_eq!(passthrough_timeout_ms(&mut params), 30000);
        assert_eq!(params, json!({"paneId": "p1"}));
    }

    #[test]
    fn timeout_is_clamped_to_max() {
        let mut params = json!({"timeoutMs": 999999});
        assert_eq!(passthrough_timeout_ms(&mut params), MAX_TIMEOUT_MS);
    }

    #[test]
    fn non_object_params_keep_default_timeout() {
        let mut params = json!(null);
        assert_eq!(passthrough_timeout_ms(&mut params), DEFAULT_TIMEOUT_MS);
    }

    #[test]
    fn window_id_is_stripped_from_params() {
        let mut params = json!({"paneId": "p1", "windowId": "layout-abc"});
        strip_param(&mut params, "windowId");
        assert_eq!(params, json!({"paneId": "p1"}));
    }

    #[test]
    fn format_timeout_uses_seconds_when_whole() {
        assert_eq!(format_timeout(5000), "5s");
        assert_eq!(format_timeout(1500), "1500ms");
    }
}
