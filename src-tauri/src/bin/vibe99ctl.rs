use clap::{Parser, Subcommand};
use serde_json::{json, Value};
#[cfg(unix)]
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "vibe99ctl")]
#[command(about = "CLI control for Vibe99 terminal workspace")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[arg(long, global = true)]
    socket: Option<String>,

    #[arg(long, global = true, default_value = "5")]
    timeout: u64,

    /// Target window label ("main" or a layout id). Defaults to "main".
    #[arg(long, global = true)]
    window: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    Pane {
        #[command(subcommand)]
        action: PaneAction,
    },
    Layout {
        #[command(subcommand)]
        action: LayoutAction,
    },
    Settings {
        #[command(subcommand)]
        action: SettingsAction,
    },
    Shell {
        #[command(subcommand)]
        action: ShellAction,
    },
    /// Create, update and delete shell profiles
    Profile {
        #[command(subcommand)]
        action: ProfileAction,
    },
    Terminal {
        #[command(subcommand)]
        action: TerminalAction,
    },
}

#[derive(Subcommand)]
enum PaneAction {
    List,
    Info {
        id: String,
    },
    Create {
        /// Shell profile id to start the pane with
        #[arg(long = "profile", visible_alias = "shell", value_name = "ID")]
        profile: Option<String>,
    },
    Close {
        id: String,
    },
    Focus {
        id: String,
    },
}

#[derive(Subcommand)]
enum LayoutAction {
    List,
    Active,
    Activate { id: String },
    Save,
}

#[derive(Subcommand)]
enum SettingsAction {
    /// Print all settings, or the value of one key
    ///
    /// A key is either a writable field name (`fontSize`) or a dotted path
    /// into the config (`shell.defaultProfile`).
    Get {
        key: Option<String>,
    },
    /// Set one writable field, or merge a JSON object of settings
    Set {
        /// Writable field name (e.g. `fontSize`) or a JSON object of settings
        settings: String,
        /// Value for the field. Omit when passing a JSON object instead
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        value: Vec<String>,
        /// Parse the value as JSON instead of passing it as text
        ///
        /// Needed for values that are JSON objects or must keep a JSON type
        /// (e.g. `settings set quakeLayouts --json '{"layout-1":{"height":50}}'`).
        #[arg(long)]
        json: bool,
    },
    /// Print every writable setting with its type, range and default
    Schema,
}

#[derive(Subcommand)]
enum ShellAction {
    List,
}

#[derive(Subcommand)]
enum ProfileAction {
    /// List shell profiles (alias of `shell list`)
    List,
    /// Create a profile. The id defaults to a slug of --name.
    Create {
        /// Display name; also used to derive the id when --id is omitted
        #[arg(long)]
        name: Option<String>,
        /// Shell executable (e.g. ssh, /bin/zsh, docker)
        #[arg(long)]
        command: String,
        /// Explicit profile id (default: slugified --name)
        #[arg(long)]
        id: Option<String>,
        /// Open a new pane with the created profile
        #[arg(long)]
        open: bool,
        /// Arguments for the command, passed through verbatim.
        ///
        /// Consumes everything that follows, so put other flags before it. Quote
        /// the whole value to keep an embedded quoted remote command intact:
        ///   --args '-t host "tmux new -A -s work"'
        #[arg(
            long,
            allow_hyphen_values = true,
            num_args = 1..,
            value_name = "ARG..."
        )]
        args: Vec<String>,
    },
    /// Update an existing profile; omitted fields keep their current value
    Update {
        /// Profile id to update
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        command: Option<String>,
        /// Replacement arguments. Pass --args "" to clear them.
        #[arg(
            long,
            allow_hyphen_values = true,
            num_args = 1..,
            value_name = "ARG..."
        )]
        args: Vec<String>,
    },
    /// Delete a profile (auto-detected profiles are read-only)
    Delete {
        /// Profile id to delete
        id: String,
    },
}

#[derive(Subcommand)]
enum TerminalAction {
    SendKeys { id: String, text: String },
    Resize { id: String, cols: u16, rows: u16 },
}

fn resolve_socket_path(cli_socket: &Option<String>) -> Result<PathBuf, String> {
    if let Some(s) = cli_socket {
        return Ok(PathBuf::from(s));
    }

    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        let runtime_dir =
            std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| format!("/tmp/vibe99-{uid}"));
        Ok(PathBuf::from(runtime_dir)
            .join("vibe99")
            .join("vibe99.sock"))
    }
    #[cfg(windows)]
    {
        Ok(PathBuf::from(r"\\.\pipe\vibe99"))
    }
}

fn send_request(
    socket_path: &PathBuf,
    method: &str,
    params: Value,
    timeout_secs: u64,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let mut stream = std::os::unix::net::UnixStream::connect(socket_path)
            .map_err(|e| format!("cannot connect to Vibe99 at {}: {e}", socket_path.display()))?;

        stream
            // One extra second of grace so the server's structured timeout
            // error arrives instead of an opaque local read failure.
            .set_read_timeout(Some(std::time::Duration::from_secs(timeout_secs + 1)))
            .map_err(|e| format!("set timeout: {e}"))?;

        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });

        let mut out = serde_json::to_string(&request).unwrap_or_default();
        out.push('\n');
        stream
            .write_all(out.as_bytes())
            .map_err(|e| format!("write error: {e}"))?;

        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| format!("read error: {e}"))?;

        let response: Value =
            serde_json::from_str(&line).map_err(|e| format!("invalid response: {e}"))?;

        Ok(response)
    }

    #[cfg(windows)]
    {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        use tokio::net::windows::named_pipe::ClientOptions;

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .build()
            .map_err(|e| format!("failed to create tokio runtime: {e}"))?;

        rt.block_on(async {
            let mut client = ClientOptions::new().open(socket_path).map_err(|e| {
                format!("cannot connect to Vibe99 at {}: {e}", socket_path.display())
            })?;

            let request = json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            });

            let mut out = serde_json::to_string(&request).unwrap_or_default();
            out.push('\n');
            client
                .write_all(out.as_bytes())
                .await
                .map_err(|e| format!("write error: {e}"))?;

            let mut reader = tokio::io::BufReader::new(client);
            let mut line = String::new();
            tokio::time::timeout(
                std::time::Duration::from_secs(timeout_secs + 1),
                reader.read_line(&mut line)
            ).await
            .map_err(|_| "read timeout".to_string())?
            .map_err(|e| format!("read error: {e}"))?;

            let response: Value =
                serde_json::from_str(&line).map_err(|e| format!("invalid response: {e}"))?;

            Ok(response)
        })
    }
}

/// Re-serialize the `--args` tokens into the raw argument string stored on a
/// profile.
///
/// clap has already removed the shell's quoting, so a multi-token invocation
/// has to be quoted again before `ShellProfile.args` (which the PTY parses with
/// quote-aware splitting) can round-trip it. A single token is passed through
/// verbatim: that is the lossless form for arguments that themselves contain
/// quotes, e.g. `--args '-t host "tmux new -A -s work"'`.
fn join_args(tokens: &[String]) -> String {
    if tokens.len() == 1 {
        return tokens[0].clone();
    }
    tokens
        .iter()
        .map(|token| quote_arg_token(token))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_arg_token(token: &str) -> String {
    if !token.chars().any(char::is_whitespace) {
        return token.to_string();
    }
    if !token.contains('"') {
        return format!("\"{token}\"");
    }
    if !token.contains('\'') {
        return format!("'{token}'");
    }
    // Not representable for the quote-aware parser; leave it as-is rather than
    // silently dropping content.
    token.to_string()
}

/// Print a JSON value to stdout.
fn print_json(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

/// Unwrap a JSON-RPC response: report a server error and exit, or return the
/// `result.value` envelope used by direct (Rust-side) methods.
fn unwrap_result(response: Value) -> Value {
    if let Some(error) = response.get("error") {
        let msg = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        eprintln!("Error: {msg}");
        std::process::exit(1);
    }

    let result = response.get("result").cloned().unwrap_or(Value::Null);

    // Passthrough failures arrive as a CommandResult, not a JSON-RPC error.
    if result.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let reason = result.get("reason").and_then(|v| v.as_str()).unwrap_or("unknown error");
        eprintln!("Error: {reason}");
        std::process::exit(1);
    }

    match result.get("value") {
        Some(inner) => inner.clone(),
        None => result,
    }
}

/// Build a nested object from a dotted key so `settings set ui.fontSize 15`
/// becomes `{"ui":{"fontSize":15}}` — the config is nested, and the server's
/// deep-merge lands the value in the right block. A flat `"ui.fontSize"` key
/// would be silently dropped by config sanitization.
fn build_nested_setting(key: &str, value: Value) -> Value {
    let mut root = Value::Object(serde_json::Map::new());
    let mut cursor = &mut root;
    for part in key.split('.') {
        cursor = cursor
            .as_object_mut()
            .expect("walked levels are always freshly created objects")
            .entry(part.to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
    }
    *cursor = value;
    root
}

fn main() {
    let cli = Cli::parse();

    let socket_path = match resolve_socket_path(&cli.socket) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    if !socket_path.exists() && cfg!(unix) {
        eprintln!(
            "Error: Vibe99 is not running (socket not found at {})",
            socket_path.display()
        );
        std::process::exit(1);
    }

    let open_after_create = matches!(
        &cli.command,
        Commands::Profile {
            action: ProfileAction::Create { open: true, .. }
        }
    );

    let (method, params) = match &cli.command {
        Commands::Pane { action } => match action {
            PaneAction::List => ("pane.list".to_string(), json!({})),
            PaneAction::Info { id } => ("pane.info".to_string(), json!({"paneId": id})),
            PaneAction::Create { profile } => (
                "pane.create".to_string(),
                json!({"shellProfileId": profile}),
            ),
            PaneAction::Close { id } => ("pane.close".to_string(), json!({"paneId": id})),
            PaneAction::Focus { id } => ("pane.focus".to_string(), json!({"paneId": id})),
        },
        Commands::Layout { action } => match action {
            LayoutAction::List => ("layout.list".to_string(), json!({})),
            LayoutAction::Active => ("layout.active".to_string(), json!({})),
            LayoutAction::Activate { id } => {
                ("layout.activate".to_string(), json!({"layoutId": id}))
            }
            LayoutAction::Save => ("layout.save".to_string(), json!({})),
        },
        Commands::Settings { action } => match action {
            SettingsAction::Get { key } => ("settings.get".to_string(), json!({"key": key})),
            SettingsAction::Set { settings, value, json: as_json } => {
                if value.is_empty() {
                    let parsed: Value = serde_json::from_str(settings)
                        .unwrap_or_else(|e| {
                            eprintln!("Error: invalid JSON — {e}");
                            eprintln!("Usage: vibe99ctl settings set <json-object>");
                            eprintln!("   or: vibe99ctl settings set <key> <value> [--json]");
                            std::process::exit(1);
                        });
                    if !parsed.is_object() {
                        eprintln!("Error: settings must be a JSON object");
                        std::process::exit(1);
                    }
                    ("settings.set".to_string(), json!({"settings": parsed}))
                } else {
                    let raw = value.join(" ");
                    // Without --json the value is passed as text and the server
                    // parses it per the field's type, so `set fontSize 15` and
                    // `set fontFamily 999` both do the obvious thing.
                    let parsed: Value = if *as_json {
                        serde_json::from_str(&raw).unwrap_or_else(|e| {
                            eprintln!("Error: --json value is not valid JSON — {e}");
                            std::process::exit(1);
                        })
                    } else {
                        Value::String(raw)
                    };
                    // Dotted keys address one leaf of a map-typed field
                    // (e.g. `quakeLayouts.<id>.position`); nest them so the
                    // server-side objectMap validation can check the leaf.
                    let payload = if settings.contains('.') {
                        build_nested_setting(settings, parsed)
                    } else {
                        let mut obj = serde_json::Map::new();
                        obj.insert(settings.clone(), parsed);
                        Value::Object(obj)
                    };
                    ("settings.set".to_string(), json!({"settings": payload}))
                }
            }
            SettingsAction::Schema => ("settings.schema".to_string(), json!({})),
        },
        Commands::Shell { action } => match action {
            ShellAction::List => ("shell.list".to_string(), json!({})),
        },
        Commands::Profile { action } => match action {
            ProfileAction::List => ("profile.list".to_string(), json!({})),
            ProfileAction::Create {
                name,
                command,
                id,
                open: _,
                args,
            } => {
                let mut payload = json!({"name": name, "command": command, "id": id});
                if !args.is_empty() {
                    payload["args"] = json!(join_args(args));
                }
                ("profile.create".to_string(), payload)
            }
            ProfileAction::Update {
                id,
                name,
                command,
                args,
            } => {
                let mut payload = json!({"id": id, "name": name, "command": command});
                if !args.is_empty() {
                    payload["args"] = json!(join_args(args));
                }
                ("profile.update".to_string(), payload)
            }
            ProfileAction::Delete { id } => ("profile.delete".to_string(), json!({"id": id})),
        },
        Commands::Terminal { action } => match action {
            TerminalAction::SendKeys { id, text } => (
                "terminal.send-keys".to_string(),
                json!({"paneId": id, "text": text}),
            ),
            TerminalAction::Resize { id, cols, rows } => (
                "terminal.resize".to_string(),
                json!({"paneId": id, "cols": cols, "rows": rows}),
            ),
        },
    };

    // Routing metadata: which window executes the command, and how long the
    // server may wait on the frontend before giving up.
    let mut params = params;
    if let Some(window) = &cli.window {
        params["windowId"] = json!(window);
    }
    params["timeoutMs"] = json!(cli.timeout.saturating_mul(1000));

    let response = match send_request(&socket_path, &method, params, cli.timeout) {
        Ok(response) => response,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };
    let result = unwrap_result(response);

    // `profile create --open` chains a pane.create with the id the server
    // derived, so the caller never has to parse the id out and issue a second
    // command.
    if open_after_create {
        let profile_id = match result
            .get("profile")
            .and_then(|p| p.get("id"))
            .and_then(Value::as_str)
        {
            Some(id) => id.to_string(),
            None => {
                eprintln!("Error: create response did not include a profile id");
                std::process::exit(1);
            }
        };

        let pane_response = match send_request(
            &socket_path,
            "pane.create",
            json!({"shellProfileId": profile_id}),
            cli.timeout,
        ) {
            Ok(response) => response,
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        };
        let pane = unwrap_result(pane_response);
        print_json(&json!({"profile": result.get("profile"), "pane": pane}));
        std::process::exit(0);
    }

    print_json(&result);
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(tokens: &[&str]) -> Vec<String> {
        tokens.iter().map(|t| t.to_string()).collect()
    }

    #[test]
    fn single_token_is_passed_through_verbatim() {
        assert_eq!(
            join_args(&args(&["-t host \"tmux new -A -s work\""])),
            "-t host \"tmux new -A -s work\""
        );
    }

    #[test]
    fn tokens_with_spaces_are_quoted_for_the_profile_parser() {
        assert_eq!(
            join_args(&args(&["-t", "host", "tmux new -A -s work"])),
            "-t host \"tmux new -A -s work\""
        );
    }

    #[test]
    fn tokens_without_spaces_are_left_alone() {
        assert_eq!(join_args(&args(&["-il", "-c"])), "-il -c");
    }

    #[test]
    fn empty_args_stay_empty() {
        assert_eq!(join_args(&args(&[""])), "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn single_key_stays_top_level() {
        assert_eq!(build_nested_setting("fontSize", json!(15)), json!({"fontSize": 15}));
    }

    #[test]
    fn dotted_key_nests_into_config_blocks() {
        assert_eq!(
            build_nested_setting("ui.fontSize", json!(15)),
            json!({"ui": {"fontSize": 15}})
        );
    }

    #[test]
    fn deeply_dotted_key_nests_all_levels() {
        assert_eq!(
            build_nested_setting("quakeLayouts.abc.position", json!("top")),
            json!({"quakeLayouts": {"abc": {"position": "top"}}})
        );
    }

    #[test]
    fn object_value_replaces_leaf() {
        assert_eq!(
            build_nested_setting("ui", json!({"fontSize": 15})),
            json!({"ui": {"fontSize": 15}})
        );
    }
}
