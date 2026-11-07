/**
 * vibe99ctl — CLI control for a running Vibe99 instance.
 *
 * The binary speaks JSON-RPC 2.0 over a Unix Domain Socket (a Named Pipe on
 * Windows). `vibe99ctl describe` prints the machine-readable catalogue of
 * every callable method — its parameters, its route and an example — so an
 * agent can discover the whole surface without reading the source.
 *
 * @module vibe99ctl
 */

use clap::{Parser, Subcommand};
use serde_json::{json, Value};
#[cfg(unix)]
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use vibe99_lib::enhance;

/// The method registry — the single source of truth shared with the server.
///
/// It is included by path so that `vibe99ctl` stays a standalone binary that
/// does not link the desktop app.
#[path = "../cli_registry.rs"]
mod cli_registry;

#[derive(Parser)]
#[command(name = "vibe99ctl")]
#[command(about = "CLI control for Vibe99 terminal workspace")]
#[command(long_about = "CLI control for Vibe99 terminal workspace.\n\nRun `vibe99ctl describe` for the machine-readable catalogue of every callable method, its parameters and an example call.")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[arg(long, global = true)]
    /// Override the socket path
    socket: Option<String>,

    #[arg(long, global = true, default_value = "5")]
    /// Response timeout in seconds
    timeout: u64,

    /// Target window label ("main" or a layout id). Defaults to "main".
    #[arg(long, global = true)]
    window: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Print the catalogue of callable methods as JSON.
    Describe {
        /// Print the details of a single method instead of the whole catalogue.
        #[arg(long)]
        method: Option<String>,
    },
    /// Call any registered method with explicit JSON params.
    Call {
        /// Method name, as listed by `vibe99ctl describe`.
        method: String,
        /// JSON object with the method params.
        #[arg(long, default_value = "{}")]
        params: String,
    },
    /// Manage panes
    Pane {
        #[command(subcommand)]
        action: PaneAction,
    },
    /// Manage layouts
    Layout {
        #[command(subcommand)]
        action: LayoutAction,
    },
    /// Read or write settings
    Settings {
        #[command(subcommand)]
        action: SettingsAction,
    },
    /// List shell profiles
    Shell {
        #[command(subcommand)]
        action: ShellAction,
    },
    /// Create, update and delete shell profiles
    Profile {
        #[command(subcommand)]
        action: ProfileAction,
    },
    /// Send keys or resize a terminal
    Terminal {
        #[command(subcommand)]
        action: TerminalAction,
    },
    /// Copy this binary to ~/.local/bin so it stays on PATH (idempotent;
    /// on Windows also adds that directory to the user PATH)
    InstallCli,
    /// Install Vibe99's attention signal into agent CLIs (does not need the app running)
    Enhance {
        #[command(subcommand)]
        action: enhance::Command,
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

    cli_registry::socket_path()
}

/// Print the capability catalogue, or the details of a single method.
///
/// Works without a running Vibe99: the catalogue is static data.
fn describe(method: Option<&str>) -> ! {
    match method {
        Some(name) => match cli_registry::describe_method(name) {
            Some(details) => {
                println!("{}", serde_json::to_string_pretty(&details).unwrap_or_default());
                std::process::exit(0);
            }
            None => {
                let error = json!({
                    "error": {
                        "code": cli_registry::CODE_METHOD_NOT_FOUND,
                        "message": format!("method not found: {name}"),
                    }
                });
                println!("{}", serde_json::to_string_pretty(&error).unwrap_or_default());
                std::process::exit(1);
            }
        },
        None => {
            let catalogue = cli_registry::describe_all();
            println!(
                "{}",
                serde_json::to_string_pretty(&catalogue).unwrap_or_default()
            );
            std::process::exit(0);
        }
    }
}

/// Map a parsed command line to the method it calls.
fn resolve_command(cli: &Cli) -> Result<(String, Value), String> {
    match &cli.command {
        Commands::Describe { .. } => Err("`describe` is answered locally".to_string()),
        Commands::Enhance { .. } => Err("`enhance` is answered locally".to_string()),
        Commands::InstallCli => Err("`install-cli` is answered locally".to_string()),
        Commands::Call { method, params } => {
            let parsed: Value = serde_json::from_str(params)
                .map_err(|e| format!("invalid JSON params: {e}"))?;
            if !parsed.is_object() {
                return Err("params must be a JSON object".to_string());
            }
            Ok((method.clone(), parsed))
        }
        Commands::Pane { action } => match action {
            PaneAction::List => Ok(("pane.list".to_string(), json!({}))),
            PaneAction::Info { id } => Ok(("pane.info".to_string(), json!({"paneId": id}))),
            PaneAction::Create { profile } => Ok((
                "pane.create".to_string(),
                json!({"shellProfileId": profile}),
            )),
            PaneAction::Close { id } => Ok(("pane.close".to_string(), json!({"paneId": id}))),
            PaneAction::Focus { id } => Ok(("pane.focus".to_string(), json!({"paneId": id}))),
        },
        Commands::Layout { action } => match action {
            LayoutAction::List => Ok(("layout.list".to_string(), json!({}))),
            LayoutAction::Active => Ok(("layout.active".to_string(), json!({}))),
            LayoutAction::Activate { id } => {
                Ok(("layout.activate".to_string(), json!({"layoutId": id})))
            }
            LayoutAction::Save => Ok(("layout.save".to_string(), json!({}))),
        },
        Commands::Settings { action } => match action {
            SettingsAction::Get { key } => Ok(("settings.get".to_string(), json!({"key": key}))),
            SettingsAction::Set {
                settings,
                value,
                json: as_json,
            } => {
                if value.is_empty() {
                    let parsed: Value = serde_json::from_str(settings).map_err(|e| {
                        format!("invalid JSON — {e}\nUsage: vibe99ctl settings set <json-object>\n   or: vibe99ctl settings set <key> <value> [--json]")
                    })?;
                    if !parsed.is_object() {
                        return Err("settings must be a JSON object".to_string());
                    }
                    Ok(("settings.set".to_string(), json!({"settings": parsed})))
                } else {
                    let raw = value.join(" ");
                    // Without --json the value is passed as text and the server
                    // parses it per the field's type, so `set fontSize 15` and
                    // `set fontFamily 999` both do the obvious thing.
                    let parsed: Value = if *as_json {
                        serde_json::from_str(&raw)
                            .map_err(|e| format!("--json value is not valid JSON — {e}"))?
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
                    Ok(("settings.set".to_string(), json!({"settings": payload})))
                }
            }
            SettingsAction::Schema => Ok(("settings.schema".to_string(), json!({}))),
        },
        Commands::Shell { action } => match action {
            ShellAction::List => Ok(("shell.list".to_string(), json!({}))),
        },
        Commands::Profile { action } => match action {
            ProfileAction::List => Ok(("profile.list".to_string(), json!({}))),
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
                Ok(("profile.create".to_string(), payload))
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
                Ok(("profile.update".to_string(), payload))
            }
            ProfileAction::Delete { id } => Ok(("profile.delete".to_string(), json!({"id": id}))),
        },
        Commands::Terminal { action } => match action {
            TerminalAction::SendKeys { id, text } => Ok((
                "terminal.send-keys".to_string(),
                json!({"paneId": id, "text": text}),
            )),
            TerminalAction::Resize { id, cols, rows } => Ok((
                "terminal.resize".to_string(),
                json!({"paneId": id, "cols": cols, "rows": rows}),
            )),
        },
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
        let code = error.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
        eprintln!("Error [{code}]: {msg}");
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

/// Install this binary into `~/.local/bin` (creating the directory if
/// needed) so it stays on PATH regardless of how Vibe99 itself was
/// installed. Overwrites any previous copy, so re-running is safe.
fn install_cli() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot locate current executable: {e}"))?;

    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("cannot determine home directory (HOME/USERPROFILE not set)")?;
    let bin_dir = PathBuf::from(home).join(".local").join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("cannot create {}: {e}", bin_dir.display()))?;

    #[cfg(windows)]
    let file_name = "vibe99ctl.exe";
    #[cfg(not(windows))]
    let file_name = "vibe99ctl";

    let dest = bin_dir.join(file_name);
    if exe != dest {
        let tmp = bin_dir.join(format!(".{file_name}.tmp"));
        std::fs::copy(&exe, &tmp).map_err(|e| format!("cannot copy executable: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(&tmp, perms).map_err(|e| format!("chmod: {e}"))?;
        }
        std::fs::rename(&tmp, &dest).map_err(|e| format!("cannot move into place: {e}"))?;
    }

    #[cfg(windows)]
    let path_note = match add_to_user_path(&bin_dir) {
        Ok(note) => note,
        Err(e) => {
            eprintln!("Warning: {e}");
            format!("\nnote: add {} to your PATH to use vibe99ctl", bin_dir.display())
        }
    };
    #[cfg(not(windows))]
    let path_note = String::new();

    Ok(format!("vibe99ctl {} installed to {}{path_note}", env!("CARGO_PKG_VERSION"), dest.display()))
}

/// Append `bin_dir` to the user PATH (HKCU\Environment) if not already
/// present. Existing processes keep their old environment, so the caller
/// is told to open a new terminal.
#[cfg(windows)]
fn add_to_user_path(bin_dir: &std::path::Path) -> Result<String, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (env, _) = hkcu
        .create_subkey("Environment")
        .map_err(|e| format!("cannot open user environment: {e}"))?;

    let dir = bin_dir.display().to_string();
    let raw = env.get_raw_value("Path").ok();
    // REG_SZ/REG_EXPAND_SZ payloads are UTF-16LE, NUL-terminated.
    let current = raw
        .as_ref()
        .map(|v| {
            let units: Vec<u16> = v
                .bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&units)
                .trim_end_matches('\0')
                .to_string()
        })
        .unwrap_or_default();

    let present = current
        .split(';')
        .any(|entry| entry.trim_end_matches('\\').eq_ignore_ascii_case(&dir));
    if present {
        return Ok(String::new());
    }

    let new_value = if current.is_empty() {
        dir.clone()
    } else {
        format!("{current};{dir}")
    };
    let new_raw = winreg::RegValue {
        vtype: raw.map(|v| v.vtype).unwrap_or(REG_SZ),
        bytes: new_value
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(|c| c.to_le_bytes())
            .collect(),
    };
    env.set_raw_value("Path", &new_raw)
        .map_err(|e| format!("cannot update user PATH: {e}"))?;

    Ok("\nnote: ~/.local/bin was added to your user PATH; open a new terminal to use vibe99ctl".to_string())
}

fn main() {
    let cli = Cli::parse();

    // `describe` is static data: it works without a running Vibe99.
    if let Commands::Describe { method } = &cli.command {
        describe(method.as_deref());
    }

    // `enhance` edits the user's agent settings, not Vibe99 state, so it must
    // work whether or not the app is running. Everything else needs the socket.
    if let Commands::Enhance { action } = &cli.command {
        let socket = resolve_socket_path(&cli.socket).ok();
        std::process::exit(enhance::run(action, socket.as_deref()));
    }

    if matches!(&cli.command, Commands::InstallCli) {
        std::process::exit(match install_cli() {
            Ok(message) => {
                println!("{message}");
                0
            }
            Err(e) => {
                eprintln!("Error: {e}");
                1
            }
        });
    }

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

    let (method, params) = match resolve_command(&cli) {
        Ok(resolved) => resolved,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    // Refuse to call a method the server does not know about.
    if cli_registry::find(&method).is_none() {
        let error = json!({
            "error": {
                "code": cli_registry::CODE_METHOD_NOT_FOUND,
                "message": format!("method not found: {method}"),
            }
        });
        println!("{}", serde_json::to_string_pretty(&error).unwrap_or_default());
        std::process::exit(1);
    }

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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

    /// Every CLI shortcut must call a method that the registry knows about.
    #[test]
    fn cli_shortcuts_target_registered_methods() {
        let cases: &[(&[&str], &str)] = &[
            (&["pane", "list"], "pane.list"),
            (&["pane", "info", "pane-1"], "pane.info"),
            (&["pane", "create"], "pane.create"),
            (&["pane", "create", "--shell", "bash"], "pane.create"),
            (&["pane", "close", "pane-1"], "pane.close"),
            (&["pane", "focus", "pane-1"], "pane.focus"),
            (&["layout", "list"], "layout.list"),
            (&["layout", "active"], "layout.active"),
            (&["layout", "activate", "default"], "layout.activate"),
            (&["layout", "save"], "layout.save"),
            (&["settings", "get"], "settings.get"),
            (&["settings", "get", "fontSize"], "settings.get"),
            (&["settings", "set", "fontSize", "14"], "settings.set"),
            (&["settings", "schema"], "settings.schema"),
            (&["shell", "list"], "shell.list"),
            (&["profile", "list"], "profile.list"),
            (
                &["profile", "create", "--name", "work", "--command", "ssh"],
                "profile.create",
            ),
            (
                &["profile", "update", "work", "--command", "ssh"],
                "profile.update",
            ),
            (&["profile", "delete", "work"], "profile.delete"),
            (&["terminal", "send-keys", "pane-1", "ls"], "terminal.send-keys"),
            (&["terminal", "resize", "pane-1", "120", "40"], "terminal.resize"),
        ];

        for (args, expected) in cases {
            let argv: Vec<&str> = std::iter::once("vibe99ctl").chain(args.iter().copied()).collect();
            let cli = Cli::parse_from(argv);
            let (method, _) = resolve_command(&cli)
                .unwrap_or_else(|e| panic!("{args:?} did not resolve: {e}"));
            assert_eq!(method, *expected);
            assert!(
                cli_registry::find(&method).is_some(),
                "{method} is not registered in the method registry"
            );
        }
    }

    /// `call` accepts any registered method and passes the params through.
    #[test]
    fn call_passes_params_through() {
        let cli = Cli::parse_from([
            "vibe99ctl",
            "call",
            "pane.create",
            "--params",
            r#"{"shellProfileId":"ssh-prod"}"#,
        ]);
        let (method, params) = resolve_command(&cli).expect("call resolves");
        assert_eq!(method, "pane.create");
        assert_eq!(params["shellProfileId"], json!("ssh-prod"));
        assert!(cli_registry::find(&method).is_some());
    }
}

#[cfg(test)]
mod tests {
    /// `--version` reports the Cargo package version, which is the same
    /// source the Tauri bundle uses. This test fails if a version bump
    /// updates one without the other.
    #[test]
    fn version_matches_tauri_config() {
        let config_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json");
        let config = std::fs::read_to_string(config_path).expect("read tauri.conf.json");
        let config: serde_json::Value = serde_json::from_str(&config).expect("parse tauri.conf.json");
        let tauri_version = config["version"].as_str().expect("tauri.conf.json has a version");
        assert_eq!(env!("CARGO_PKG_VERSION"), tauri_version);
    }
}
