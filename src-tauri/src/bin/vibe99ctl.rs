use clap::{Parser, Subcommand};
use serde_json::{json, Value};
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
    Terminal {
        #[command(subcommand)]
        action: TerminalAction,
    },
}

#[derive(Subcommand)]
enum PaneAction {
    List,
    Info { id: String },
    Create {
        #[arg(long)]
        shell: Option<String>,
    },
    Close { id: String },
    Focus { id: String },
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
    Get {
        key: Option<String>,
    },
    Set {
        settings: String,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        value: Vec<String>,
    },
    Schema,
}

#[derive(Subcommand)]
enum ShellAction {
    List,
}

#[derive(Subcommand)]
enum TerminalAction {
    SendKeys {
        id: String,
        text: String,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
    },
}

fn resolve_socket_path(cli_socket: &Option<String>) -> Result<PathBuf, String> {
    if let Some(s) = cli_socket {
        return Ok(PathBuf::from(s));
    }

    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
            .unwrap_or_else(|_| format!("/tmp/vibe99-{uid}"));
        Ok(PathBuf::from(runtime_dir).join("vibe99").join("vibe99.sock"))
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
            .set_read_timeout(Some(std::time::Duration::from_secs(timeout_secs)))
            .map_err(|e| format!("set timeout: {e}"))?;

        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });

        let mut out = serde_json::to_string(&request).unwrap_or_default();
        out.push('\n');
        stream.write_all(out.as_bytes())
            .map_err(|e| format!("write error: {e}"))?;

        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line)
            .map_err(|e| format!("read error: {e}"))?;

        let response: Value = serde_json::from_str(&line)
            .map_err(|e| format!("invalid response: {e}"))?;

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
            let mut client = ClientOptions::new()
                .open(socket_path)
                .map_err(|e| format!("cannot connect to Vibe99 at {}: {e}", socket_path.display()))?;

            let request = json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            });

            let mut out = serde_json::to_string(&request).unwrap_or_default();
            out.push('\n');
            client.write_all(out.as_bytes()).await
                .map_err(|e| format!("write error: {e}"))?;

            let mut reader = tokio::io::BufReader::new(client);
            let mut line = String::new();
            tokio::time::timeout(
                std::time::Duration::from_secs(timeout_secs),
                reader.read_line(&mut line)
            ).await
            .map_err(|_| "read timeout".to_string())?
            .map_err(|e| format!("read error: {e}"))?;

            let response: Value = serde_json::from_str(&line)
                .map_err(|e| format!("invalid response: {e}"))?;

            Ok(response)
        })
    }
}

fn print_result(response: Value) -> ! {
    if let Some(error) = response.get("error") {
        let msg = error.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        eprintln!("Error: {msg}");
        std::process::exit(1);
    }

    let result = response.get("result").cloned().unwrap_or(Value::Null);

    if let Some(inner) = result.get("value") {
        println!("{}", serde_json::to_string_pretty(inner).unwrap_or_default());
    } else if result.is_object() && result.get("ok").is_some() {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    }

    std::process::exit(0);
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
        eprintln!("Error: Vibe99 is not running (socket not found at {})", socket_path.display());
        std::process::exit(1);
    }

    let (method, params) = match &cli.command {
        Commands::Pane { action } => match action {
            PaneAction::List => ("pane.list".to_string(), json!({})),
            PaneAction::Info { id } => ("pane.info".to_string(), json!({"paneId": id})),
            PaneAction::Create { shell } => ("pane.create".to_string(), json!({"shellProfileId": shell})),
            PaneAction::Close { id } => ("pane.close".to_string(), json!({"paneId": id})),
            PaneAction::Focus { id } => ("pane.focus".to_string(), json!({"paneId": id})),
        },
        Commands::Layout { action } => match action {
            LayoutAction::List => ("layout.list".to_string(), json!({})),
            LayoutAction::Active => ("layout.active".to_string(), json!({})),
            LayoutAction::Activate { id } => ("layout.activate".to_string(), json!({"layoutId": id})),
            LayoutAction::Save => ("layout.save".to_string(), json!({})),
        },
        Commands::Settings { action } => match action {
            SettingsAction::Get { key } => ("settings.get".to_string(), json!({"key": key})),
            SettingsAction::Set { settings, value } => {
                if value.is_empty() {
                    let parsed: Value = serde_json::from_str(settings)
                        .unwrap_or_else(|e| {
                            eprintln!("Error: invalid JSON — {e}");
                            eprintln!("Usage: vibe99ctl settings set <json-object>");
                            eprintln!("   or: vibe99ctl settings set <key> <value>");
                            std::process::exit(1);
                        });
                    ("settings.set".to_string(), json!({"settings": parsed}))
                } else {
                    let val: Value = serde_json::from_str(&value.join(" "))
                        .unwrap_or_else(|_| json!(value.join(" ")));
                    let mut obj = serde_json::Map::new();
                    obj.insert(settings.clone(), val);
                    ("settings.set".to_string(), json!({"settings": Value::Object(obj)}))
                }
            }
            SettingsAction::Schema => ("settings.schema".to_string(), json!({})),
        },
        Commands::Shell { action } => match action {
            ShellAction::List => ("shell.list".to_string(), json!({})),
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

    match send_request(&socket_path, &method, params, cli.timeout) {
        Ok(response) => print_result(response),
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
}
