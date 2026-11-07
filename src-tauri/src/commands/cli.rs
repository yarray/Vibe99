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
 * The set of callable methods lives in `crate::cli_registry` — the single
 * source of truth shared with `vibe99ctl describe`. A method that is not
 * registered there is rejected with `-32601` (method not found).
 *
 * Lifecycle:
 * - Started in `main.rs` `.setup()` via `start_cli_server()`.
 * - Cleaned up automatically when the process exits (socket + PID file removed).
 *
 * @module commands/cli
 */

use crate::cli_registry::{self, Route};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use super::settings::ShellProfile;
use super::shell_profile::ShellConfig;

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

// The socket, PID file and runtime directory are resolved by
// `crate::cli_registry`, so the server and the CLI always agree on them.

// ---------------------------------------------------------------------------
// PID file management
// ---------------------------------------------------------------------------

fn write_pid_file() -> Result<(), String> {
    let path = cli_registry::pid_file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("failed to create PID dir: {e}"))?;
    }
    let pid = std::process::id();
    std::fs::write(&path, pid.to_string()).map_err(|e| format!("failed to write PID file: {e}"))?;
    Ok(())
}

fn remove_pid_file() {
    if let Ok(path) = cli_registry::pid_file_path() {
        let _ = std::fs::remove_file(path);
    }
}

fn remove_socket_file() {
    #[cfg(unix)]
    {
        if let Ok(path) = cli_registry::socket_path() {
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

/// Event emitted after settings are written by a CLI request.
///
/// The frontend listens for it and re-applies the payload, so
/// `vibe99ctl settings set …` takes effect without restarting the app. The
/// payload is the sanitized config, identical in shape to what `settings_load`
/// returns.
pub const SETTINGS_CHANGED_EVENT: &str = "vibe99:settings-changed";

/// A `settings.set` payload split into the parts that must be merged at
/// different depths of `settings.json`.
#[derive(Debug)]
struct SettingsUpdate {
    /// Validated writable fields, merged into the `ui` block.
    ui: serde_json::Map<String, Value>,
    /// Other top-level config sections (`shell`, `layouts`, …), merged as-is.
    top_level: serde_json::Map<String, Value>,
    /// Canonical values applied, echoed back to the caller.
    changed: serde_json::Map<String, Value>,
}

/// Tell the renderer that a profile write happened outside its own bridge
/// call, so its cached list (used by the "Change Profile" menu and the profile
/// pickers) is reloaded instead of staying stale until the next restart.
fn notify_shell_profiles_changed(app: &AppHandle) {
    let _ = app.emit("vibe99:shell-profiles-changed", ());
}

/// Shape a profile write result for the CLI: the affected profile plus the
/// full sanitized list, so a caller can verify the write in one round trip.
fn profile_write_result(profile: &ShellProfile, config: ShellConfig) -> Value {
    let config = serde_json::to_value(&config).unwrap_or(Value::Null);
    serde_json::json!({
        "ok": true,
        "value": {
            "profile": serde_json::to_value(profile).unwrap_or(Value::Null),
            "profiles": config.get("profiles").cloned().unwrap_or(Value::Null),
            "defaultProfile": config.get("defaultProfile").cloned().unwrap_or(Value::Null),
        }
    })
}

/// A method failure, carrying the JSON-RPC error code to report.
pub struct RpcError {
    /// JSON-RPC error code (see `cli_registry::ERROR_CODES`).
    pub code: i32,
    /// Human-readable failure description.
    pub message: String,
}

impl RpcError {
    /// The method exists but its parameters are missing or malformed.
    fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: cli_registry::CODE_INVALID_PARAMS,
            message: message.into(),
        }
    }

    /// The method exists but failed while executing.
    fn internal(message: impl Into<String>) -> Self {
        Self {
            code: cli_registry::CODE_INTERNAL_ERROR,
            message: message.into(),
        }
    }
}

/// A method implemented in Rust, without involving the frontend.
type DirectHandler = fn(&AppHandle, Value) -> Result<Value, RpcError>;

/// The direct methods, keyed by the name declared in the registry.
///
/// The unit tests below keep this table and `cli_registry::METHODS` in sync.
static DIRECT_HANDLERS: &[(&str, DirectHandler)] = &[
    ("settings.get", handle_settings_get),
    ("settings.set", handle_settings_set),
    ("settings.schema", handle_settings_schema),
    ("layout.list", handle_layout_list),
    ("shell.list", handle_shell_list),
    ("profile.list", handle_profile_list),
    ("profile.create", handle_profile_create),
    ("profile.update", handle_profile_update),
    ("profile.delete", handle_profile_delete),
    ("terminal.send-keys", handle_terminal_send_keys),
    ("terminal.resize", handle_terminal_resize),
];

/// Find the Rust implementation of a direct method.
fn direct_handler(method: &str) -> Option<DirectHandler> {
    DIRECT_HANDLERS
        .iter()
        .find(|(name, _)| *name == method)
        .map(|(_, handler)| *handler)
}

fn handle_settings_get(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let config = super::settings::settings_load(app.clone()).map_err(RpcError::internal)?;
    match params.get("key").and_then(|v| v.as_str()) {
        Some(key) => lookup_setting(&config, key).cloned().ok_or_else(|| {
            RpcError::invalid_params(format!(
                "unknown setting `{key}` — run `vibe99ctl settings schema` to list writable keys"
            ))
        }),
        None => Ok(sort_json_keys(config)),
    }
}

fn handle_settings_set(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let updates = params
        .get("settings")
        .cloned()
        .ok_or_else(|| RpcError::invalid_params("missing 'settings' param"))?;
    let updates = updates
        .as_object()
        .ok_or_else(|| RpcError::invalid_params("'settings' must be a JSON object"))?
        .clone();
    let plan = plan_settings_update(&updates).map_err(RpcError::invalid_params)?;

    let current = super::settings::settings_load(app.clone()).map_err(RpcError::internal)?;
    let current_ui = current.get("ui").cloned().unwrap_or_else(|| Value::Object(Default::default()));
    let merged_ui = deep_merge(current_ui, Value::Object(plan.ui));
    let mut merged = if plan.top_level.is_empty() {
        current
    } else {
        deep_merge(current, Value::Object(plan.top_level))
    };
    if let Some(object) = merged.as_object_mut() {
        object.insert("ui".into(), merged_ui);
    }

    let saved = super::settings::settings_save(app.clone(), merged).map_err(RpcError::internal)?;

    // Persisted; now tell every open window to reload and re-apply.
    // A missing window is not an error (e.g. headless CLI use).
    if let Err(e) = app.emit(SETTINGS_CHANGED_EVENT, &saved) {
        eprintln!("[cli] failed to emit {SETTINGS_CHANGED_EVENT}: {e}");
    }

    Ok(serde_json::json!({"ok": true, "changed": Value::Object(plan.changed)}))
}

fn handle_settings_schema(_app: &AppHandle, _params: Value) -> Result<Value, RpcError> {
    Ok(super::settings_schema::schema_document())
}

fn handle_layout_list(app: &AppHandle, _params: Value) -> Result<Value, RpcError> {
    super::layout::layouts_list(app.clone())
        .map(|v| serde_json::json!({"ok": true, "value": v}))
        .map_err(RpcError::internal)
}

fn handle_shell_list(app: &AppHandle, _params: Value) -> Result<Value, RpcError> {
    super::shell_profile::shell_profiles_list(app.clone())
        .map(|v| serde_json::json!({"ok": true, "value": v}))
        .map_err(RpcError::internal)
}

fn handle_profile_list(app: &AppHandle, _params: Value) -> Result<Value, RpcError> {
    handle_shell_list(app, _params)
}

fn handle_profile_create(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let (profile, config) = super::shell_profile::profile_create(app.clone(), &params)
        .map_err(RpcError::invalid_params)?;
    notify_shell_profiles_changed(app);
    Ok(profile_write_result(&profile, config))
}

fn handle_profile_update(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let profile_id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::invalid_params("missing 'id' param"))?;
    let (profile, config) =
        super::shell_profile::profile_update(app.clone(), profile_id, &params)
            .map_err(RpcError::invalid_params)?;
    notify_shell_profiles_changed(app);
    Ok(profile_write_result(&profile, config))
}

fn handle_profile_delete(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let profile_id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::invalid_params("missing 'id' param"))?;
    let (profile, config) = super::shell_profile::profile_delete(app.clone(), profile_id)
        .map_err(RpcError::invalid_params)?;
    notify_shell_profiles_changed(app);
    Ok(profile_write_result(&profile, config))
}

fn handle_terminal_send_keys(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let pane_id = params
        .get("paneId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::invalid_params("missing 'paneId'"))?;
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::invalid_params("missing 'text'"))?;
    let window_label =
        resolve_pty_window(app, &params, pane_id).map_err(RpcError::invalid_params)?;
    let app_state = app.state::<super::terminal::AppState>();
    app_state
        .pty
        .write(&window_label, pane_id, text.as_bytes())
        .map_err(RpcError::internal)?;
    Ok(serde_json::json!({"ok": true}))
}

fn handle_terminal_resize(app: &AppHandle, params: Value) -> Result<Value, RpcError> {
    let pane_id = params
        .get("paneId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::invalid_params("missing 'paneId'"))?;
    let cols = params
        .get("cols")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| RpcError::invalid_params("missing 'cols'"))? as u16;
    let rows = params
        .get("rows")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| RpcError::invalid_params("missing 'rows'"))? as u16;
    let window_label =
        resolve_pty_window(app, &params, pane_id).map_err(RpcError::invalid_params)?;
    let app_state = app.state::<super::terminal::AppState>();
    app_state
        .pty
        .resize(&window_label, pane_id, cols, rows)
        .map_err(RpcError::internal)?;
    Ok(serde_json::json!({"ok": true}))
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

/// Top-level `settings.json` sections a `settings.set` payload may merge.
///
/// Everything else that is not a writable field is rejected: `sanitize_config`
/// only persists these sections, so accepting a typo would report success while
/// silently dropping the value.
const TOP_LEVEL_SECTIONS: [&str; 6] = [
    "version",
    "shell",
    "layouts",
    "defaultLayoutId",
    "hooks",
    "floatWindows",
];

/// Split a `settings.set` payload into the levels it must be merged at.
///
/// Writable fields (see `settings schema`) live in the `ui` block — that is
/// where the app reads them — so a bare key like `fontSize` is routed there and
/// callers never need to know the nesting. Everything else (`shell`, `layouts`,
/// `defaultLayoutId`, …) keeps merging at the top level, and an explicit `ui`
/// object from the caller is folded into the same block.
///
/// Every writable value is validated up front; all rejection messages are
/// returned together so one call reports every bad field.
fn plan_settings_update(
    updates: &serde_json::Map<String, Value>,
) -> Result<SettingsUpdate, String> {
    let mut plan = SettingsUpdate {
        ui: serde_json::Map::new(),
        top_level: serde_json::Map::new(),
        changed: serde_json::Map::new(),
    };
    let mut errors = Vec::new();

    for (key, value) in updates {
        if super::settings_schema::is_field(key) {
            apply_field(&mut plan, &mut errors, key, value);
        } else if key == "ui" {
            match value.as_object() {
                Some(ui) => {
                    for (field, field_value) in ui {
                        if super::settings_schema::is_field(field) {
                            apply_field(&mut plan, &mut errors, field, field_value);
                        } else {
                            // Not a writable field (`shortcuts`, deprecated
                            // flags, …) — merge it through untouched.
                            plan.ui.insert(field.clone(), field_value.clone());
                        }
                    }
                }
                None => errors.push("ui: expected object".to_string()),
            }
        } else if TOP_LEVEL_SECTIONS.contains(&key.as_str()) {
            plan.top_level.insert(key.clone(), value.clone());
            plan.changed.insert(key.clone(), value.clone());
        } else {
            errors.push(format!(
                "unknown setting `{key}` — run `vibe99ctl settings schema` to list writable keys"
            ));
        }
    }

    if errors.is_empty() {
        Ok(plan)
    } else {
        // Sorted so the same bad payload always produces the same message.
        errors.sort();
        Err(errors.join("; "))
    }
}

fn apply_field(plan: &mut SettingsUpdate, errors: &mut Vec<String>, key: &str, value: &Value) {
    match super::settings_schema::validate(key, value) {
        Ok(valid) => {
            plan.changed.insert(key.to_string(), valid.clone());
            plan.ui.insert(key.to_string(), valid);
        }
        Err(message) => errors.push(message),
    }
}

/// Resolve `settings get <key>`.
///
/// Writable fields resolve inside the `ui` block (bare name or `ui.<field>`);
/// anything else is a dotted path into the config.
fn lookup_setting<'a>(config: &'a Value, key: &str) -> Option<&'a Value> {
    if super::settings_schema::is_field(key) {
        return config.get("ui").and_then(|ui| ui.get(key));
    }
    let mut current = config;
    for part in key.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

/// Recursively sort object keys so `settings get` output is stable.
///
/// `serde_json` is ordered by default, but a dependency can enable its
/// `preserve_order` feature crate-wide; sorting here makes the CLI contract
/// independent of that.
fn sort_json_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, sort_json_keys(value)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_json_keys).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deep_merge_recurses_into_objects_and_replaces_leaves() {
        let base = json!({
            "ui": {"fontSize": 13, "quakeLayouts": {"a": {"height": 60}}},
            "version": 6
        });
        let update = json!({
            "ui": {"fontSize": 16, "quakeLayouts": {"b": {"height": 40}}}
        });

        assert_eq!(
            deep_merge(base, update),
            json!({
                "ui": {
                    "fontSize": 16,
                    "quakeLayouts": {"a": {"height": 60}, "b": {"height": 40}}
                },
                "version": 6
            })
        );
    }

    #[test]
    fn deep_merge_replaces_arrays_and_scalars() {
        assert_eq!(
            deep_merge(json!({"layouts": [1, 2]}), json!({"layouts": [3]})),
            json!({"layouts": [3]})
        );
        assert_eq!(
            deep_merge(json!({"defaultLayoutId": "a"}), json!({"defaultLayoutId": "b"})),
            json!({"defaultLayoutId": "b"})
        );
    }

    #[test]
    fn settings_update_routes_writable_fields_into_ui() {
        let plan = plan_settings_update(
            json!({"fontSize": 15, "defaultLayoutId": "work"})
                .as_object()
                .unwrap(),
        )
        .expect("valid update");

        assert_eq!(plan.ui, json!({"fontSize": 15}).as_object().unwrap().clone());
        assert_eq!(
            plan.top_level,
            json!({"defaultLayoutId": "work"}).as_object().unwrap().clone()
        );
        assert_eq!(
            plan.changed,
            json!({"fontSize": 15, "defaultLayoutId": "work"})
                .as_object()
                .unwrap()
                .clone()
        );
    }

    #[test]
    fn settings_update_accepts_text_values_from_the_cli() {
        let plan = plan_settings_update(
            json!({"fontSize": "18", "webglEnabled": "false"})
                .as_object()
                .unwrap(),
        )
        .expect("text values are parsed by field type");
        assert_eq!(plan.ui["fontSize"], json!(18));
        assert_eq!(plan.ui["webglEnabled"], json!(false));
    }

    #[test]
    fn settings_update_folds_an_explicit_ui_block_into_the_same_level() {
        let plan = plan_settings_update(
            json!({"ui": {"fontSize": 16, "shortcuts": {"newPane": "Ctrl+T"}}})
                .as_object()
                .unwrap(),
        )
        .expect("valid update");

        assert_eq!(plan.ui["fontSize"], json!(16));
        assert_eq!(plan.ui["shortcuts"], json!({"newPane": "Ctrl+T"}));
        assert!(plan.top_level.is_empty());
    }

    #[test]
    fn settings_update_reports_every_invalid_field() {
        let error = plan_settings_update(
            json!({"fontSize": 99, "breathingIntensity": "loud", "webglEnabled": true})
                .as_object()
                .unwrap(),
        )
        .expect_err("both values are invalid");

        assert_eq!(
            error,
            "breathingIntensity: expected one of none|mild|intense, got \"loud\"; \
             fontSize: expected integer 10-24, got 99"
        );
    }

    #[test]
    fn settings_update_rejects_an_unknown_key() {
        let error = plan_settings_update(json!({"fontSizes": 15}).as_object().unwrap())
            .expect_err("unknown key");
        assert!(error.starts_with("unknown setting `fontSizes`"), "{error}");
    }

    #[test]
    fn lookup_resolves_writable_fields_and_dotted_paths() {
        let config = json!({
            "version": 6,
            "ui": {"fontSize": 13, "quakeLayouts": {}},
            "shell": {"defaultProfile": "bash"}
        });

        assert_eq!(lookup_setting(&config, "fontSize"), Some(&json!(13)));
        assert_eq!(lookup_setting(&config, "ui.fontSize"), Some(&json!(13)));
        assert_eq!(
            lookup_setting(&config, "shell.defaultProfile"),
            Some(&json!("bash"))
        );
        assert_eq!(lookup_setting(&config, "nope"), None);
    }

    #[test]
    fn sorted_output_is_stable_at_every_depth() {
        let sorted = sort_json_keys(json!({"b": {"z": 1, "a": 2}, "a": 3}));
        let rendered = serde_json::to_string(&sorted).unwrap();
        assert_eq!(rendered, r#"{"a":3,"b":{"a":2,"z":1}}"#);
    }
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
    let sock_path = cli_registry::socket_path()?;

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
                let resp = err_response(
                    Value::Null,
                    cli_registry::CODE_PARSE_ERROR,
                    format!("parse error: {e}"),
                );
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

    let pipe_name = match cli_registry::socket_path() {
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
                        let resp = err_response(
                    Value::Null,
                    cli_registry::CODE_PARSE_ERROR,
                    format!("parse error: {e}"),
                );
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

    // The registry is the single source of truth: an unregistered method is
    // rejected instead of silently falling through to a handler.
    let spec = match cli_registry::find(&method) {
        Some(spec) => spec,
        None => {
            return err_response(
                id,
                cli_registry::CODE_METHOD_NOT_FOUND,
                format!("method not found: {method}"),
            );
        }
    };

    if spec.route == Route::Passthrough {
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
            return err_response(
                id,
                cli_registry::CODE_INTERNAL_ERROR,
                format!("window not found: {window_label}"),
            );
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
            return err_response(
                id,
                cli_registry::CODE_INTERNAL_ERROR,
                format!("emit error: {e}"),
            );
        }

        // Wait for the response with a timeout.
        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(result)) => ok_response(id, result),
            Ok(Err(_)) => {
                // Sender was dropped without sending (shouldn't happen normally).
                let mut map = pending.lock().unwrap();
                map.remove(&request_id);
                err_response(
                    id,
                    cli_registry::CODE_INTERNAL_ERROR,
                    "response channel closed".to_string(),
                )
            }
            Err(_) => {
                // Timeout.
                let mut map = pending.lock().unwrap();
                map.remove(&request_id);
                err_response(
                    id,
                    cli_registry::CODE_INTERNAL_ERROR,
                    format!("request timed out ({})", format_timeout(timeout_ms)),
                )
            }
        }
    } else {
        // Direct handling in Rust.
        match direct_handler(spec.name) {
            Some(handler) => match handler(app, params) {
                Ok(result) => ok_response(id, result),
                Err(e) => err_response(id, e.code, e.message),
            },
            None => err_response(
                id,
                cli_registry::CODE_INTERNAL_ERROR,
                format!("method {method} is registered as direct but has no handler"),
            ),
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
pub fn cli_respond(app: AppHandle, id: String, result: Value) -> Result<(), String> {
    let state = app.state::<CliState>();
    let mut map = state
        .pending
        .lock()
        .map_err(|e| format!("lock error: {e}"))?;
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
    use std::collections::BTreeSet;

    // --- registry <-> handler sync ---

    /// The direct handlers and the registry must describe the same methods:
    /// every direct method in the registry has a handler, and every handler is
    /// registered as a direct method.
    #[test]
    fn direct_handlers_match_the_registry() {
        let registered: BTreeSet<&str> = cli_registry::METHODS
            .iter()
            .filter(|m| m.route == Route::Direct)
            .map(|m| m.name)
            .collect();
        let handled: BTreeSet<&str> = DIRECT_HANDLERS.iter().map(|(name, _)| *name).collect();

        assert_eq!(
            registered, handled,
            "the direct handler table and the method registry drifted apart"
        );
    }

    #[test]
    fn every_registered_direct_method_resolves_to_a_handler() {
        for spec in cli_registry::METHODS.iter() {
            if spec.route != Route::Direct {
                continue;
            }
            assert!(
                direct_handler(spec.name).is_some(),
                "no handler registered for direct method {}",
                spec.name
            );
        }
    }

    /// Passthrough methods are forwarded to the frontend, which dispatches them
    /// as `AppCommand`s. Every one of them must exist in the frontend command
    /// union, otherwise the frontend would answer `unknown-command`.
    #[test]
    fn passthrough_methods_exist_in_the_frontend_command_union() {
        let commands_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/domain/commands.ts");
        let source = std::fs::read_to_string(&commands_path).unwrap_or_else(|e| {
            panic!(
                "cannot read {}: {e}",
                commands_path.to_string_lossy()
            )
        });

        for spec in cli_registry::METHODS.iter() {
            if spec.route != Route::Passthrough {
                continue;
            }
            assert!(
                source.contains(&format!("'{}'", spec.name)),
                "passthrough method {} has no AppCommand in src/domain/commands.ts",
                spec.name
            );
        }
    }

    #[test]
    fn unregistered_methods_are_rejected() {
        assert!(cli_registry::find("does.not.exist").is_none());
        assert!(direct_handler("does.not.exist").is_none());
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
