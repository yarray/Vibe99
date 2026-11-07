/**
 * CLI Method Registry — the single source of truth for the `vibe99ctl` surface.
 *
 * Every callable method of the Vibe99 CLI bridge is declared exactly once in
 * [`METHODS`]. The JSON-RPC server routes on this table and `vibe99ctl describe`
 * renders it as machine-readable JSON, so an agent can discover the whole
 * capability set (methods, parameters, examples) without reading the source.
 *
 * This module is deliberately free of Tauri types: the server
 * (`src/commands/cli.rs`) and the standalone `vibe99ctl` binary both embed it,
 * so the CLI stays a lightweight tool that does not link the desktop app.
 *
 * @module cli_registry
 */

use serde_json::{json, Map, Value};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/// JSON-RPC parse error — the request line was not valid JSON.
pub const CODE_PARSE_ERROR: i32 = -32700;
/// The requested method is not registered in [`METHODS`].
pub const CODE_METHOD_NOT_FOUND: i32 = -32601;
/// The method exists but a parameter is missing or malformed.
pub const CODE_INVALID_PARAMS: i32 = -32602;
/// The method exists but failed while executing.
pub const CODE_INTERNAL_ERROR: i32 = -32603;

/// One documented JSON-RPC error code.
pub struct ErrorCode {
    /// Numeric JSON-RPC error code.
    pub code: i32,
    /// Stable machine-readable name.
    pub name: &'static str,
    /// What the code means and what an agent should do about it.
    pub meaning: &'static str,
}

/// Every error code the CLI server can return.
pub static ERROR_CODES: &[ErrorCode] = &[
    ErrorCode {
        code: CODE_PARSE_ERROR,
        name: "parse_error",
        meaning: "The request was not a valid JSON line.",
    },
    ErrorCode {
        code: CODE_METHOD_NOT_FOUND,
        name: "method_not_found",
        meaning: "The method is not registered. Run `vibe99ctl describe` for the catalogue.",
    },
    ErrorCode {
        code: CODE_INVALID_PARAMS,
        name: "invalid_params",
        meaning: "A required parameter is missing or has the wrong type.",
    },
    ErrorCode {
        code: CODE_INTERNAL_ERROR,
        name: "internal_error",
        meaning: "The method exists but failed while executing (frontend timeout, IO error, ...).",
    },
];

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/// How a method is executed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Route {
    /// Handled entirely in Rust, without involving the frontend.
    Direct,
    /// Forwarded to the frontend workbench through the Tauri event bridge.
    Passthrough,
}

impl Route {
    /// Wire name of the route, as reported by `describe`.
    pub fn as_str(self) -> &'static str {
        match self {
            Route::Direct => "direct",
            Route::Passthrough => "passthrough",
        }
    }
}

/// A single method parameter.
pub struct ParamSpec {
    /// Parameter name as it appears in the `params` object.
    pub name: &'static str,
    /// JSON type: `string`, `integer`, `number`, `boolean`, `object`, `array`.
    pub ty: &'static str,
    /// Whether the parameter must be supplied.
    pub required: bool,
    /// Whether `null` is an accepted value.
    pub nullable: bool,
    /// What the parameter means.
    pub description: &'static str,
    /// Allowed values, empty when unconstrained.
    pub enum_values: &'static [&'static str],
}

/// One callable method.
pub struct MethodSpec {
    /// Method name, as used in the JSON-RPC `method` field.
    pub name: &'static str,
    /// Whether the method runs in Rust or is forwarded to the frontend.
    pub route: Route,
    /// One-line description of what the method does.
    pub summary: &'static str,
    /// Parameter list.
    pub params: &'static [ParamSpec],
    /// JSON text of a representative `params` object.
    pub example_params: &'static str,
    /// The equivalent `vibe99ctl` invocation, when the CLI has a shortcut for it.
    pub cli: Option<&'static str>,
    /// What the method returns.
    pub returns: &'static str,
}

/// Declare a parameter (the common case: plain, non-nullable, unconstrained).
macro_rules! param {
    ($name:literal, $ty:literal, $required:literal, $desc:literal $(,)?) => {
        ParamSpec {
            name: $name,
            ty: $ty,
            required: $required,
            nullable: false,
            description: $desc,
            enum_values: &[],
        }
    };
}

/// Declare a method.
macro_rules! method {
    ($name:literal, $route:ident, $summary:literal, [$($param:expr),* $(,)?], $example:literal, $cli:expr, $returns:literal $(,)?) => {
        MethodSpec {
            name: $name,
            route: Route::$route,
            summary: $summary,
            params: &[$($param),*],
            example_params: $example,
            cli: $cli,
            returns: $returns,
        }
    };
}

/// Every callable method of the CLI bridge.
///
/// The server routes on this table (a method that is not listed here is
/// rejected with [`CODE_METHOD_NOT_FOUND`]), and `vibe99ctl describe` renders
/// it as JSON. Adding a method means adding one entry here plus its handler.
pub static METHODS: &[MethodSpec] = &[
    // -----------------------------------------------------------------------
    // Direct — handled in Rust
    // -----------------------------------------------------------------------
    method!(
        "settings.get",
        Direct,
        "Read the Vibe99 settings.",
        [param!("key", "string", false, "Dotted path of a single setting, e.g. \"fontSize\". Omit to read the whole settings object.")],
        r#"{"key":"fontSize"}"#,
        Some("vibe99ctl settings get fontSize"),
        "The whole settings object, or the value at `key`."
    ),
    method!(
        "settings.set",
        Direct,
        "Update the Vibe99 settings by deep-merging the given object into the current ones.",
        [param!("settings", "object", true, "Settings object to merge, e.g. {\"fontSize\":14}.")],
        r#"{"settings":{"fontSize":14}}"#,
        Some("vibe99ctl settings set fontSize 14"),
        "The settings object after the merge."
    ),
    method!(
        "settings.schema",
        Direct,
        "Describe the writable settings fields: type, range, default and meaning.",
        [],
        "{}",
        Some("vibe99ctl settings schema"),
        "An object with a `fields` map of setting name to field schema."
    ),
    method!(
        "layout.list",
        Direct,
        "List the saved layouts.",
        [],
        "{}",
        Some("vibe99ctl layout list"),
        "The list of saved layouts, each with an id, a name and its panes."
    ),
    method!(
        "layout.active",
        Passthrough,
        "Return the layout currently active in a window.",
        [],
        "{}",
        Some("vibe99ctl layout active"),
        "The active layout object, or null when no layout exists."
    ),
    method!(
        "pane.list",
        Passthrough,
        "List the panes currently live in a window (runtime state, not the saved layout).",
        [],
        "{}",
        Some("vibe99ctl pane list"),
        "The list of panes, each with an id, title, cwd, shell profile and theme."
    ),
    method!(
        "pane.info",
        Passthrough,
        "Return a single live pane by id.",
        [param!("paneId", "string", true, "Id of the pane to look up.")],
        r#"{"paneId":"pane-1"}"#,
        Some("vibe99ctl pane info pane-1"),
        "The pane object, or null when the id is unknown."
    ),
    method!(
        "shell.list",
        Direct,
        "List the shell profiles: auto-detected ones (shells, WSL) and user-defined ones.",
        [],
        "{}",
        Some("vibe99ctl shell list"),
        "The list of shell profiles, each with an id, a name and a command."
    ),
    method!(
        "profile.list",
        Direct,
        "List the shell profiles (alias of `shell.list`).",
        [],
        "{}",
        Some("vibe99ctl profile list"),
        "The list of shell profiles, each with an id, a name and a command."
    ),
    method!(
        "profile.create",
        Direct,
        "Create a shell profile. The id defaults to a slug of `name`.",
        [
            param!("name", "string", false, "Display name; also used to derive the id when `id` is omitted."),
            param!("command", "string", true, "Shell executable (e.g. ssh, /bin/zsh, docker)."),
            param!("id", "string", false, "Explicit profile id."),
            param!("args", "string", false, "Raw argument string for the command, e.g. `-t host \"tmux new -A -s work\"`."),
        ],
        r#"{"name":"work","command":"ssh","args":"-t host \"tmux new -A -s work\""}"#,
        Some("vibe99ctl profile create --name work --command ssh --args -t host \"tmux new -A -s work\""),
        "An object with the created `profile`, the full `profiles` list and `defaultProfile`."
    ),
    method!(
        "profile.update",
        Direct,
        "Update a shell profile; omitted fields keep their current value. Auto-detected profiles are read-only.",
        [
            param!("id", "string", true, "Id of the profile to update."),
            param!("name", "string", false, "New display name."),
            param!("command", "string", false, "New shell executable."),
            param!("args", "string", false, "Replacement raw argument string."),
        ],
        r#"{"id":"work","command":"ssh"}"#,
        Some("vibe99ctl profile update work --command ssh"),
        "An object with the updated `profile`, the full `profiles` list and `defaultProfile`."
    ),
    method!(
        "profile.delete",
        Direct,
        "Delete a shell profile. Auto-detected profiles are read-only.",
        [param!("id", "string", true, "Id of the profile to delete.")],
        r#"{"id":"work"}"#,
        Some("vibe99ctl profile delete work"),
        "An object with the deleted `profile`, the full `profiles` list and `defaultProfile`."
    ),
    method!(
        "terminal.send-keys",
        Direct,
        "Write text into a pane's terminal, as if it had been typed.",
        [
            param!("paneId", "string", true, "Id of the target pane."),
            param!("text", "string", true, "Text to write. Use \"\\n\" for a newline."),
        ],
        r#"{"paneId":"pane-1","text":"ls\n"}"#,
        Some("vibe99ctl terminal send-keys pane-1 'ls'"),
        "An object with `ok: true`."
    ),
    method!(
        "terminal.resize",
        Direct,
        "Resize the PTY grid of a pane.",
        [
            param!("paneId", "string", true, "Id of the target pane."),
            param!("cols", "integer", true, "New column count."),
            param!("rows", "integer", true, "New row count."),
        ],
        r#"{"paneId":"pane-1","cols":120,"rows":40}"#,
        Some("vibe99ctl terminal resize pane-1 120 40"),
        "An object with `ok: true`."
    ),
    // -----------------------------------------------------------------------
    // Passthrough — forwarded to the frontend workbench
    // -----------------------------------------------------------------------
    method!(
        "pane.create",
        Passthrough,
        "Create a new pane, optionally starting a specific shell profile in it.",
        [param!("shellProfileId", "string", false, "Id of the shell profile to run. Omit to use the default profile.")],
        r#"{"shellProfileId":"ssh-prod"}"#,
        Some("vibe99ctl pane create --shell ssh-prod"),
        "The id of the new pane."
    ),
    method!(
        "pane.close",
        Passthrough,
        "Close a pane.",
        [param!("paneId", "string", true, "Id of the pane to close.")],
        r#"{"paneId":"pane-1"}"#,
        Some("vibe99ctl pane close pane-1"),
        "Ok, or `ok:false` with reason `last-pane` when it is the only pane left."
    ),
    method!(
        "pane.focus",
        Passthrough,
        "Focus a pane.",
        [
            param!("paneId", "string", true, "Id of the pane to focus."),
            param!("focusTerminal", "boolean", false, "Also move keyboard focus into the terminal. Defaults to true."),
        ],
        r#"{"paneId":"pane-1"}"#,
        Some("vibe99ctl pane focus pane-1"),
        "Ok."
    ),
    method!(
        "pane.move",
        Passthrough,
        "Move a pane to another position in the tab order.",
        [
            param!("paneId", "string", true, "Id of the pane to move."),
            param!("index", "integer", true, "Target index in the tab order."),
        ],
        r#"{"paneId":"pane-1","index":2}"#,
        None,
        "Ok."
    ),
    method!(
        "pane.rename.start",
        Passthrough,
        "Start the interactive rename of a pane tab.",
        [param!("paneId", "string", true, "Id of the pane to rename.")],
        r#"{"paneId":"pane-1"}"#,
        None,
        "Ok."
    ),
    method!(
        "pane.rename.commit",
        Passthrough,
        "Commit a pane tab rename.",
        [
            param!("paneId", "string", true, "Id of the renamed pane."),
            ParamSpec {
                name: "title",
                ty: "string",
                required: true,
                nullable: true,
                description: "New tab title. Use null to clear the custom title.",
                enum_values: &[],
            },
        ],
        r#"{"paneId":"pane-1","title":"build"}"#,
        None,
        "Ok, or `ok:false` with reason `not-found` when the pane is unknown."
    ),
    method!(
        "pane.setColor",
        Passthrough,
        "Set the custom accent color of a pane.",
        [
            param!("paneId", "string", true, "Id of the pane."),
            param!("color", "string", true, "CSS color, e.g. \"#ff8800\"."),
        ],
        r##"{"paneId":"pane-1","color":"#ff8800"}"##,
        None,
        "Ok."
    ),
    method!(
        "pane.clearColor",
        Passthrough,
        "Clear the custom accent color of a pane.",
        [param!("paneId", "string", true, "Id of the pane.")],
        r#"{"paneId":"pane-1"}"#,
        None,
        "Ok."
    ),
    method!(
        "pane.toggleActivityAlert",
        Passthrough,
        "Toggle the breathing activity alert of a pane.",
        [param!("paneId", "string", true, "Id of the pane.")],
        r#"{"paneId":"pane-1"}"#,
        None,
        "The new activity-alert state of the pane (boolean)."
    ),
    method!(
        "pane.setTheme",
        Passthrough,
        "Set the terminal theme of a pane.",
        [
            param!("paneId", "string", true, "Id of the pane."),
            ParamSpec {
                name: "themeId",
                ty: "string",
                required: true,
                nullable: true,
                description: "Id of the theme. Use null to fall back to the app default.",
                enum_values: &[],
            },
        ],
        r#"{"paneId":"pane-1","themeId":"dracula"}"#,
        None,
        "Ok."
    ),
    method!(
        "pane.requestClose",
        Passthrough,
        "Ask the UI to close a pane — the confirmation prompt is shown to the user.",
        [param!("paneId", "string", true, "Id of the pane.")],
        r#"{"paneId":"pane-1"}"#,
        None,
        "Ok."
    ),
    method!(
        "focus.next",
        Passthrough,
        "Focus the next pane in MRU order.",
        [],
        "{}",
        None,
        "Ok, or `ok:false` when there is no other pane."
    ),
    method!(
        "focus.prev",
        Passthrough,
        "Focus the previous pane in MRU order.",
        [],
        "{}",
        None,
        "Ok, or `ok:false` when there is no other pane."
    ),
    method!(
        "focus.left",
        Passthrough,
        "Focus the pane to the left of the focused one.",
        [],
        "{}",
        None,
        "Ok."
    ),
    method!(
        "focus.right",
        Passthrough,
        "Focus the pane to the right of the focused one.",
        [],
        "{}",
        None,
        "Ok."
    ),
    method!(
        "focus.recent",
        Passthrough,
        "Focus the most recently used pane.",
        [param!("reverse", "boolean", false, "Walk the MRU history backwards. Defaults to false.")],
        r#"{"reverse":false}"#,
        None,
        "The id of the focused pane, or `ok:false` when there is no other pane."
    ),
    method!(
        "focus.nextLit",
        Passthrough,
        "Focus the next pane that has a pending activity alert.",
        [],
        "{}",
        None,
        "Ok, or `ok:false` with reason `no-lit` when no pane is alerting."
    ),
    method!(
        "focus.at",
        Passthrough,
        "Focus the pane at a given index.",
        [param!("index", "integer", true, "Zero-based index of the pane.")],
        r#"{"index":0}"#,
        None,
        "Ok, or `ok:false` with reason `out-of-range`."
    ),
    method!(
        "focus.blur",
        Passthrough,
        "Blur the focused terminal, so keyboard input goes to the app instead.",
        [],
        "{}",
        None,
        "Ok."
    ),
    method!(
        "focus.refocus",
        Passthrough,
        "Give keyboard focus back to the focused terminal.",
        [],
        "{}",
        None,
        "Ok, or `ok:false` with reason `no-focus`."
    ),
    method!(
        "focus.commit",
        Passthrough,
        "Commit the current pane cycle selection.",
        [],
        "{}",
        None,
        "Ok."
    ),
    method!(
        "mode.set",
        Passthrough,
        "Switch the workbench mode: `terminal` (default) or `nav` (navigation mode).",
        [ParamSpec {
            name: "mode",
            ty: "string",
            required: true,
            nullable: false,
            description: "Target workbench mode.",
            enum_values: &["terminal", "nav"],
        }],
        r#"{"mode":"nav"}"#,
        None,
        "Ok."
    ),
    method!(
        "layout.save",
        Passthrough,
        "Persist the current window layout.",
        [],
        "{}",
        Some("vibe99ctl layout save"),
        "Ok."
    ),
    method!(
        "layout.activate",
        Passthrough,
        "Open a saved layout: focus its window when it is already open, otherwise open a new one.",
        [param!("layoutId", "string", true, "Id of the layout to activate.")],
        r#"{"layoutId":"default"}"#,
        Some("vibe99ctl layout activate default"),
        "Ok."
    ),
    method!(
        "terminal.restart",
        Passthrough,
        "Restart the shell process of a pane.",
        [param!("paneId", "string", true, "Id of the pane.")],
        r#"{"paneId":"pane-1"}"#,
        None,
        "Ok."
    ),
    method!(
        "terminal.changeShell",
        Passthrough,
        "Switch a pane to a different shell profile.",
        [
            param!("paneId", "string", true, "Id of the pane."),
            param!("profileId", "string", true, "Id of the shell profile to run."),
        ],
        r#"{"paneId":"pane-1","profileId":"bash"}"#,
        None,
        "Ok."
    ),
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/// Find a method by name.
pub fn find(name: &str) -> Option<&'static MethodSpec> {
    METHODS.iter().find(|m| m.name == name)
}

// ---------------------------------------------------------------------------
// Runtime paths
// ---------------------------------------------------------------------------

/// Resolve the directory that holds CLI-related files (PID, socket).
///
/// Unix  : `$XDG_RUNTIME_DIR/vibe99/` (fallback `/tmp/vibe99-$UID/`)
/// Windows: `%APPDATA%\vibe99\`
pub fn cli_runtime_dir() -> Result<PathBuf, String> {
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
        Ok(cli_runtime_dir()?.join("vibe99.sock"))
    }
    #[cfg(windows)]
    {
        // Named pipes live in kernel space; we use a conventional path string.
        Ok(PathBuf::from(r"\\.\pipe\vibe99"))
    }
}

/// Resolve the PID file path.
pub fn pid_file_path() -> Result<PathBuf, String> {
    Ok(cli_runtime_dir()?.join("vibe99.pid"))
}

/// Read the PID of the running Vibe99 instance, if any.
pub fn running_pid() -> Option<u32> {
    let path = pid_file_path().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    raw.trim().parse::<u32>().ok()
}

/// Whether a Vibe99 instance is currently reachable.
///
/// On Unix the socket file has to exist; on Windows only the PID file is
/// available, so the PID file alone is used as the signal.
pub fn is_running() -> bool {
    #[cfg(unix)]
    {
        if !socket_path().map(|p| p.exists()).unwrap_or(false) {
            return false;
        }
    }
    #[cfg(windows)]
    {
        if running_pid().is_none() {
            return false;
        }
    }

    match running_pid() {
        Some(pid) => process_alive(pid),
        None => false,
    }
}

/// Whether a process with the given PID is alive.
#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    // Signal 0 performs the permission and existence checks without
    // delivering anything to the process.
    if unsafe { libc::kill(pid as i32, 0) } == 0 {
        return true;
    }
    // EPERM means the process exists, but belongs to another user.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Whether a process with the given PID is alive.
#[cfg(windows)]
fn process_alive(_pid: u32) -> bool {
    // No cheap, dependency-free liveness probe on Windows: the PID file is
    // removed when the app exits, so its presence is the best signal.
    true
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// Render the JSON schema of a method's parameters.
pub fn params_schema(spec: &MethodSpec) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();

    for param in spec.params {
        let mut prop = Map::new();
        if param.nullable {
            prop.insert(
                "type".to_string(),
                json!([param.ty, "null"]),
            );
        } else {
            prop.insert("type".to_string(), json!(param.ty));
        }
        prop.insert("description".to_string(), json!(param.description));
        if !param.enum_values.is_empty() {
            prop.insert(
                "enum".to_string(),
                json!(param.enum_values),
            );
        }
        properties.insert(param.name.to_string(), Value::Object(prop));

        if param.required {
            required.push(json!(param.name));
        }
    }

    json!({
        "type": "object",
        "properties": Value::Object(properties),
        "required": Value::Array(required),
    })
}

/// Render a single method as JSON.
pub fn method_json(spec: &MethodSpec) -> Value {
    let example_params: Value = serde_json::from_str(spec.example_params)
        .unwrap_or_else(|_| Value::Object(Map::new()));

    let mut example = Map::new();
    example.insert("params".to_string(), example_params);
    if let Some(cli) = spec.cli {
        example.insert("cli".to_string(), json!(cli));
    }

    json!({
        "name": spec.name,
        "route": spec.route.as_str(),
        "summary": spec.summary,
        "params": params_schema(spec),
        "example": Value::Object(example),
        "returns": spec.returns,
    })
}

/// Render the transport/runtime section as JSON.
pub fn transport_json() -> Value {
    json!({
        "kind": if cfg!(windows) { "named-pipe" } else { "unix-domain-socket" },
        "socket": socket_path()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        "pidFile": pid_file_path()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        "pid": running_pid(),
        "running": is_running(),
    })
}

/// Render the error-code table as JSON.
pub fn error_codes_json() -> Value {
    Value::Array(
        ERROR_CODES
            .iter()
            .map(|e| {
                json!({
                    "code": e.code,
                    "name": e.name,
                    "meaning": e.meaning,
                })
            })
            .collect(),
    )
}

/// Render the full capability catalogue as JSON.
pub fn describe_all() -> Value {
    let methods: Vec<Value> = METHODS.iter().map(method_json).collect();

    json!({
        "schemaVersion": SCHEMA_VERSION,
        "app": {
            "name": "Vibe99",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "cli": {
            "name": "vibe99ctl",
            "version": env!("CARGO_PKG_VERSION"),
            "protocol": "jsonrpc-2.0",
        },
        "transport": transport_json(),
        "errorCodes": error_codes_json(),
        "examples": [
            json!({
                "description": "Read the whole capability catalogue",
                "cli": "vibe99ctl describe",
            }),
            json!({
                "description": "Read the details of one method",
                "cli": "vibe99ctl describe --method pane.create",
            }),
            json!({
                "description": "Call any registered method with explicit JSON params",
                "cli": "vibe99ctl call pane.create --params '{\"shellProfileId\":\"ssh-prod\"}'",
            }),
            json!({
                "description": "Talk to the socket directly (newline-delimited JSON-RPC 2.0)",
                "request": {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "pane.list",
                    "params": {},
                },
            }),
        ],
        "methods": Value::Array(methods),
    })
}

/// Render the details of a single method as JSON.
pub fn describe_method(name: &str) -> Option<Value> {
    find(name).map(method_json)
}

/// Version of the `describe` JSON shape. Bumped when the shape changes.
pub const SCHEMA_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn method_names_are_unique() {
        let mut seen = BTreeSet::new();
        for spec in METHODS {
            assert!(
                seen.insert(spec.name),
                "duplicate method in registry: {}",
                spec.name
            );
        }
    }

    #[test]
    fn every_method_is_documented() {
        for spec in METHODS {
            assert!(!spec.summary.is_empty(), "{} has no summary", spec.name);
            assert!(
                !spec.returns.is_empty(),
                "{} has no return description",
                spec.name
            );
            assert!(
                !spec.example_params.is_empty(),
                "{} has no example",
                spec.name
            );
        }
    }

    #[test]
    fn examples_are_valid_and_match_the_declared_params() {
        for spec in METHODS {
            let example: Value = serde_json::from_str(spec.example_params)
                .unwrap_or_else(|e| panic!("{}: invalid example JSON: {e}", spec.name));
            let obj = example
                .as_object()
                .unwrap_or_else(|| panic!("{}: example is not an object", spec.name));

            let declared: BTreeSet<&str> = spec.params.iter().map(|p| p.name).collect();
            for key in obj.keys() {
                assert!(
                    declared.contains(key.as_str()),
                    "{}: example uses undeclared param `{key}`",
                    spec.name
                );
            }
            for param in spec.params {
                if param.required {
                    assert!(
                        obj.contains_key(param.name),
                        "{}: example is missing required param `{}`",
                        spec.name,
                        param.name
                    );
                }
            }
        }
    }

    #[test]
    fn describe_shape_is_stable() {
        let describe = describe_all();

        let mut top_level: Vec<&str> = describe
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        top_level.sort_unstable();
        assert_eq!(
            top_level,
            vec![
                "app",
                "cli",
                "errorCodes",
                "examples",
                "methods",
                "schemaVersion",
                "transport",
            ]
        );

        let methods = describe["methods"].as_array().unwrap();
        assert_eq!(methods.len(), METHODS.len());

        let mut method_keys: Vec<&str> = methods[0]
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        method_keys.sort_unstable();
        assert_eq!(
            method_keys,
            vec!["example", "name", "params", "returns", "route", "summary"]
        );

        let mut param_keys: Vec<&str> = methods[0]["params"]
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        param_keys.sort_unstable();
        assert_eq!(param_keys, vec!["properties", "required", "type"]);
    }

    #[test]
    fn describe_method_returns_one_entry() {
        let spec = find("pane.create").expect("pane.create is registered");
        let json = describe_method(spec.name).expect("pane.create has a description");
        assert_eq!(json["name"], json!("pane.create"));
        assert_eq!(json["route"], json!("passthrough"));
        assert!(json["params"]["properties"]["shellProfileId"].is_object());

        assert!(describe_method("does.not.exist").is_none());
    }

    #[test]
    fn error_codes_are_unique_and_named() {
        let mut seen = BTreeSet::new();
        for err in ERROR_CODES {
            assert!(seen.insert(err.code), "duplicate error code {}", err.code);
            assert!(!err.name.is_empty());
            assert!(!err.meaning.is_empty());
        }
    }
}
