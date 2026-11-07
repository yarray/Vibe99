//! `vibe99ctl enhance` — wire Vibe99's attention signal into agent CLIs.
//!
//! Vibe99 lights a pane's breathing alert the moment it sees BEL or an OSC
//! notification arrive on that pane's terminal (VIB-375). Agent CLIs do not
//! emit those on their own, so `enhance install <agent>` merges a hook into
//! the agent's own settings: when the agent finishes a turn (or waits for
//! input) the hook writes the signal to the pane's terminal, and Vibe99
//! lights up while you are looking at something else.
//!
//! This command edits files Vibe99 does not own, so these rules are
//! load-bearing, not niceties:
//!
//! * The user's file is read, merged, and written back. Unrelated keys keep
//!   their values; only the hook entries we own are ever added or removed.
//! * A file that does not parse, or whose shape is not what we expect, is
//!   reported and left untouched. We never "repair" user config.
//! * Every write is preceded by a `<file>.bak-<unix-seconds>` copy; only the
//!   most recent [`BACKUP_RETENTION`] copies are kept.
//! * Re-running `install` on an already-enhanced file changes nothing and
//!   writes nothing — no rewrite, no extra backup.
//! * `--dry-run` runs the whole merge and reports it without touching disk.
//!
//! Every agent is a registry entry ([`Agent`]): its settings path plus the
//! signals it should emit. Supporting codex or gemini-cli is adding data to
//! [`AGENTS`], not adding code.

use clap::{Subcommand, ValueEnum};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many `<file>.bak-*` copies to keep next to the modified file.
pub const BACKUP_RETENTION: usize = 5;

/// Substring that marks a hook command as ours. Uninstall and idempotency
/// match on this marker rather than the exact command so they still work
/// after the binary has been moved or upgraded.
const HOOK_MARKER: &str = "enhance notify --event";

/// Terminal signals an agent can emit, and the hook events that carry them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum HookEvent {
    /// The agent finished a turn.
    Stop,
    /// The agent is waiting for input or permission.
    Notification,
}

impl HookEvent {
    pub const ALL: [HookEvent; 2] = [HookEvent::Stop, HookEvent::Notification];

    /// Stable identifier used in JSON output and in `--event`.
    pub const fn slug(self) -> &'static str {
        match self {
            HookEvent::Stop => "stop",
            HookEvent::Notification => "notification",
        }
    }

    /// The event name the agent's settings file uses under `hooks`.
    const fn config_key(self) -> &'static str {
        match self {
            HookEvent::Stop => "Stop",
            HookEvent::Notification => "Notification",
        }
    }

    /// Message shown by terminals that render OSC 9 notifications.
    const fn default_message(self) -> &'static str {
        match self {
            HookEvent::Stop => "Agent finished",
            HookEvent::Notification => "Agent needs your input",
        }
    }
}

/// One signal an agent should emit through its hook system.
#[derive(Debug)]
pub struct Signal {
    pub event: HookEvent,
    pub purpose: &'static str,
}

/// One agent integration. Everything install/uninstall needs is data.
#[derive(Debug)]
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    pub summary: &'static str,
    /// Path components relative to the user's home directory.
    pub config_path: &'static [&'static str],
    pub signals: &'static [Signal],
}

pub const CLAUDE_CODE: Agent = Agent {
    id: "claude-code",
    name: "Claude Code",
    summary: "Lights the pane when a Claude Code turn finishes or awaits your input.",
    config_path: &[".claude", "settings.json"],
    signals: &[
        Signal {
            event: HookEvent::Stop,
            purpose: "A turn finished — light the pane.",
        },
        Signal {
            event: HookEvent::Notification,
            purpose: "Claude Code is waiting for input or permission.",
        },
    ],
};

/// Every agent `enhance` knows how to wire up.
pub const AGENTS: &[Agent] = &[CLAUDE_CODE];

pub fn find_agent(id: &str) -> Result<&'static Agent, String> {
    AGENTS.iter().find(|agent| agent.id == id).ok_or_else(|| {
        format!("unknown agent \"{id}\"; run `vibe99ctl enhance list` to see the supported ones")
    })
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            "cannot determine the home directory (HOME/USERPROFILE is not set)".to_string()
        })
}

fn config_path(agent: &Agent, home: &Path) -> PathBuf {
    agent
        .config_path
        .iter()
        .fold(home.to_path_buf(), |path, part| path.join(part))
}

/// What an install/uninstall would do to the file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanKind {
    /// The file does not exist yet and will be created.
    Create,
    /// The file exists and will be rewritten.
    Update,
    /// Nothing to do; the file is already in the requested state.
    Unchanged,
}

impl PlanKind {
    pub const fn slug(self) -> &'static str {
        match self {
            PlanKind::Create => "create",
            PlanKind::Update => "update",
            PlanKind::Unchanged => "unchanged",
        }
    }
}

/// The result of merging the wanted state into a settings file, before it is
/// written. Keeping the plan separate from [`apply`] is what makes
/// `--dry-run` trustworthy: it is the same computation, minus the write.
#[derive(Debug)]
pub struct Plan {
    pub file: PathBuf,
    pub kind: PlanKind,
    /// Human-readable descriptions of each change, in application order.
    pub changes: Vec<String>,
    /// The file as it was, or `None` if it did not exist.
    pub before: Option<Value>,
    pub after: Value,
}

/// Build the plan for installing `agent`'s hooks into `file`, with the hook
/// commands pointing at `exe`.
pub fn plan_install(agent: &Agent, exe: &Path, file: &Path) -> Result<Plan, String> {
    let file = &resolve_target(file);
    let before = read_document(file)?;
    let mut after = before.clone().unwrap_or_else(|| json!({}));
    let mut changes = Vec::new();
    apply_install(&mut after, exe, agent, &mut changes)?;

    let kind = if changes.is_empty() {
        PlanKind::Unchanged
    } else if before.is_some() {
        PlanKind::Update
    } else {
        PlanKind::Create
    };

    Ok(Plan {
        file: file.to_path_buf(),
        kind,
        changes,
        before,
        after,
    })
}

/// Build the plan for removing the hooks Vibe99 added to `file`. Hooks the
/// user wrote themselves are never touched.
pub fn plan_uninstall(agent: &Agent, file: &Path) -> Result<Plan, String> {
    let file = &resolve_target(file);
    let before = read_document(file)?;
    let Some(mut after) = before.clone() else {
        return Ok(Plan {
            file: file.to_path_buf(),
            kind: PlanKind::Unchanged,
            changes: Vec::new(),
            before: None,
            after: json!({}),
        });
    };

    let mut changes = Vec::new();
    apply_uninstall(&mut after, agent, &mut changes)?;

    Ok(Plan {
        file: file.to_path_buf(),
        kind: if changes.is_empty() {
            PlanKind::Unchanged
        } else {
            PlanKind::Update
        },
        changes,
        before,
        after,
    })
}

/// The file after a successful [`apply`].
pub struct Outcome {
    pub plan: Plan,
    /// Where the pre-write copy went, if there was something to back up.
    pub backup: Option<PathBuf>,
    /// Non-fatal problems (e.g. an old backup that could not be removed).
    pub warnings: Vec<String>,
}

/// Write a plan to disk. `dry_run` returns the plan unchanged without
/// creating directories, backups, or the file itself.
pub fn apply(plan: Plan, dry_run: bool) -> Result<Outcome, String> {
    if dry_run || plan.kind == PlanKind::Unchanged {
        return Ok(Outcome {
            plan,
            backup: None,
            warnings: Vec::new(),
        });
    }

    let mut warnings = Vec::new();
    if let Some(parent) = plan.file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }

    // Back up before serializing: if anything below fails, the user still has
    // the original.
    let backup = match plan.before {
        Some(_) => Some(create_backup(&plan.file, &mut warnings)?),
        None => None,
    };

    let mut text = serde_json::to_string_pretty(&plan.after)
        .map_err(|e| format!("cannot serialize settings: {e}"))?;
    text.push('\n');
    write_atomic(&plan.file, text.as_bytes())?;

    Ok(Outcome {
        plan,
        backup,
        warnings,
    })
}

/// Command line shape of `vibe99ctl enhance`.
#[derive(Subcommand)]
pub enum Command {
    /// List the agents enhance can wire up, with their signals (JSON)
    List,
    /// Merge Vibe99's notification hooks into an agent's settings
    Install {
        /// Agent id, e.g. `claude-code`
        agent: String,
        /// Print the exact changes without touching any file
        #[arg(long)]
        dry_run: bool,
    },
    /// Remove the hooks Vibe99 added, leaving everything else in place
    Uninstall {
        /// Agent id, e.g. `claude-code`
        agent: String,
        /// Print the exact changes without touching any file
        #[arg(long)]
        dry_run: bool,
    },
    /// Check that Vibe99 is reachable and the installed hooks are usable
    Doctor {
        /// Only check this agent (default: every supported agent)
        #[arg(long)]
        agent: Option<String>,
    },
    /// Emit the attention signal on the current terminal (used by hooks)
    Notify {
        /// Which signal to emit
        #[arg(long, value_enum, default_value = "stop")]
        event: HookEvent,
        /// Override the OSC 9 message
        #[arg(long)]
        message: Option<String>,
    },
}

/// Entry point. Returns the process exit code; the caller exits with it.
pub fn run(command: &Command, socket: Option<&Path>) -> i32 {
    let result = match command {
        Command::List => Ok(list()),
        Command::Install { agent, dry_run } => install(agent, *dry_run),
        Command::Uninstall { agent, dry_run } => uninstall(agent, *dry_run),
        Command::Notify { event, message } => {
            return match notify(*event, message.as_deref()) {
                // Hooks run this; success is silent so no output pollutes the
                // agent's turn.
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("Error: {error}");
                    1
                }
            };
        }
        Command::Doctor { agent } => return doctor(socket, agent.as_deref()),
    };

    match result {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_default()
            );
            0
        }
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

fn list() -> Value {
    json!({
        "agents": AGENTS
            .iter()
            .map(|agent| json!({
                "id": agent.id,
                "name": agent.name,
                "summary": agent.summary,
                "configFile": format!("~/{}", agent.config_path.join("/")),
                "signals": agent
                    .signals
                    .iter()
                    .map(|signal| json!({
                        "event": signal.event.slug(),
                        "hook": signal.event.config_key(),
                        "purpose": signal.purpose,
                    }))
                    .collect::<Vec<_>>(),
            }))
            .collect::<Vec<_>>(),
    })
}

fn install(agent_id: &str, dry_run: bool) -> Result<Value, String> {
    let agent = find_agent(agent_id)?;
    let file = config_path(agent, &home_dir()?);
    let exe = current_exe()?;
    let plan = plan_install(agent, &exe, &file)?;

    if dry_run {
        return Ok(json!({
            "agent": agent.id,
            "file": plan.file.display().to_string(),
            "action": plan.kind.slug(),
            "dryRun": true,
            "changes": plan.changes,
            "after": plan.after,
        }));
    }

    let outcome = apply(plan, false)?;
    Ok(json!({
        "agent": agent.id,
        "file": outcome.plan.file.display().to_string(),
        "action": outcome.plan.kind.slug(),
        "changes": outcome.plan.changes,
        "backup": outcome.backup.map(|path| path.display().to_string()),
        "warnings": outcome.warnings,
    }))
}

fn uninstall(agent_id: &str, dry_run: bool) -> Result<Value, String> {
    let agent = find_agent(agent_id)?;
    let file = config_path(agent, &home_dir()?);
    let plan = plan_uninstall(agent, &file)?;

    if dry_run {
        return Ok(json!({
            "agent": agent.id,
            "file": plan.file.display().to_string(),
            "action": plan.kind.slug(),
            "dryRun": true,
            "changes": plan.changes,
            "after": plan.after,
        }));
    }

    let outcome = apply(plan, false)?;
    Ok(json!({
        "agent": agent.id,
        "file": outcome.plan.file.display().to_string(),
        "action": outcome.plan.kind.slug(),
        "changes": outcome.plan.changes,
        "backup": outcome.backup.map(|path| path.display().to_string()),
        "warnings": outcome.warnings,
    }))
}

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("cannot locate the vibe99ctl executable: {e}"))
}

/// Emit the attention signal on the terminal this process is attached to.
///
/// The signal carries both an OSC 9 message (terminals that render it show
/// the text) and a BEL (terminals that ignore OSC 9 still beep). Vibe99
/// treats either as "light this pane".
pub fn notify(event: HookEvent, message: Option<&str>) -> Result<(), String> {
    write_terminal(signal_sequence(event, message).as_bytes())
}

fn signal_sequence(event: HookEvent, message: Option<&str>) -> String {
    let text: String = message
        .unwrap_or(event.default_message())
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    format!("\x1b]9;{text}\x07\x07")
}

/// Hook stdout is usually captured by the agent CLI, so aim at the
/// controlling terminal and only fall back to stdout when there is none
/// (e.g. `notify` run from a script with no tty).
fn write_terminal(bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    let terminal = fs::OpenOptions::new().write(true).open("/dev/tty");
    #[cfg(windows)]
    let terminal = fs::OpenOptions::new().write(true).open("CONOUT$");

    match terminal {
        Ok(mut tty) => tty
            .write_all(bytes)
            .and_then(|_| tty.flush())
            .map_err(|e| format!("cannot write the signal to the terminal: {e}")),
        Err(_) => {
            let mut stdout = std::io::stdout();
            stdout
                .write_all(bytes)
                .and_then(|_| stdout.flush())
                .map_err(|e| format!("cannot write the signal: {e}"))
        }
    }
}

fn doctor(socket: Option<&Path>, only: Option<&str>) -> i32 {
    let home = match home_dir() {
        Ok(home) => home,
        Err(error) => {
            eprintln!("Error: {error}");
            return 1;
        }
    };
    let exe = match current_exe() {
        Ok(exe) => exe,
        Err(_) => PathBuf::new(),
    };

    match doctor_checks(socket, &home, &exe, only) {
        Ok((report, healthy)) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_default()
            );
            if healthy {
                0
            } else {
                1
            }
        }
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

/// Build the doctor report. Returns the report and whether every check that
/// could be evaluated passed.
fn doctor_checks(
    socket: Option<&Path>,
    home: &Path,
    exe: &Path,
    only: Option<&str>,
) -> Result<(Value, bool), String> {
    let agents: Vec<&Agent> = match only {
        Some(id) => vec![find_agent(id)?],
        None => AGENTS.iter().collect(),
    };

    let mut checks: Vec<Value> = Vec::new();
    let mut healthy = true;

    match socket {
        Some(path) => {
            let ok = path.exists();
            healthy &= ok;
            checks.push(json!({
                "name": "vibe99 socket",
                "ok": ok,
                "detail": path.display().to_string(),
            }));
        }
        None => checks.push(json!({
            "name": "vibe99 socket",
            "ok": null,
            "detail": "not checkable on this platform",
        })),
    }

    for agent in agents {
        let file = config_path(agent, home);
        let document = read_document(&file);

        let (settings_ok, settings_detail) = match &document {
            Ok(Some(_)) => (true, file.display().to_string()),
            Ok(None) => (
                false,
                format!(
                    "{} does not exist — run `vibe99ctl enhance install {}`",
                    file.display(),
                    agent.id
                ),
            ),
            Err(error) => (false, error.clone()),
        };
        healthy &= settings_ok;
        checks.push(json!({
            "name": format!("{} settings", agent.id),
            "ok": settings_ok,
            "detail": settings_detail,
        }));

        let mut missing = Vec::new();
        let mut stale = Vec::new();
        for signal in agent.signals {
            let installed = document
                .as_ref()
                .ok()
                .and_then(|document| document.as_ref())
                .and_then(|document| installed_command(document, signal.event));
            match installed {
                Some(command) => {
                    if let Some(binary) = command_executable(command) {
                        if !Path::new(binary).exists() {
                            stale.push(binary.to_string());
                        }
                    }
                }
                None => missing.push(signal.event.config_key()),
            }
        }

        let hooks_ok =
            document.as_ref().map(|doc| doc.is_some()).unwrap_or(false) && missing.is_empty();
        let hooks_detail = if !hooks_ok {
            if missing.is_empty() {
                "settings file is not readable".to_string()
            } else {
                format!(
                    "missing {} — run `vibe99ctl enhance install {}`",
                    missing.join(", "),
                    agent.id
                )
            }
        } else {
            format!(
                "{} of {} signals installed",
                agent.signals.len(),
                agent.signals.len()
            )
        };
        healthy &= hooks_ok;
        checks.push(json!({
            "name": format!("{} hooks", agent.id),
            "ok": hooks_ok,
            "detail": hooks_detail,
        }));

        let binary_ok = stale.is_empty();
        healthy &= binary_ok;
        checks.push(json!({
            "name": format!("{} hook binary", agent.id),
            "ok": binary_ok,
            "detail": if binary_ok {
                exe.display().to_string()
            } else {
                format!("hook points at a missing executable: {}", stale.join(", "))
            },
        }));
    }

    Ok((json!({ "ok": healthy, "checks": checks }), healthy))
}

/// Resolve a symlinked settings file to its target. Writing through a temp
/// file and renaming would otherwise replace the user's dotfile symlink with
/// a regular file, leaving the real file stale.
fn resolve_target(file: &Path) -> PathBuf {
    match fs::symlink_metadata(file) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            fs::canonicalize(file).unwrap_or_else(|_| file.to_path_buf())
        }
        _ => file.to_path_buf(),
    }
}

/// Read a settings document. `Ok(None)` means "no usable content": the file
/// is absent or empty. Anything that exists but does not parse is an error
/// the caller must surface — never a document to repair.
fn read_document(file: &Path) -> Result<Option<Value>, String> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("cannot read {}: {error}", file.display())),
    };
    if text.trim().is_empty() {
        return Ok(None);
    }

    let value: Value = serde_json::from_str(&text).map_err(|error| {
        format!(
            "{} is not valid JSON ({error}); refusing to modify it",
            file.display()
        )
    })?;
    if !value.is_object() {
        return Err(format!(
            "{} must contain a JSON object; refusing to modify it",
            file.display()
        ));
    }
    Ok(Some(value))
}

fn hook_command(exe: &Path, event: HookEvent) -> String {
    format!(
        "\"{}\" enhance notify --event {}",
        exe.display(),
        event.slug()
    )
}

fn apply_install(
    document: &mut Value,
    exe: &Path,
    agent: &Agent,
    changes: &mut Vec<String>,
) -> Result<(), String> {
    let root = document
        .as_object_mut()
        .ok_or_else(|| "the settings root must be a JSON object".to_string())?;
    let hooks = child_object(root, "hooks")?;

    for signal in agent.signals {
        let key = signal.event.config_key();
        let command = hook_command(exe, signal.event);
        let entries = child_array(hooks, key)?;

        match own_command_slot(entries, signal.event) {
            Some(slot) => {
                if slot.as_str() != command {
                    *slot = command.clone();
                    changes.push(format!("update {key} hook -> {command}"));
                }
            }
            None => {
                entries.push(json!({
                    "hooks": [{ "type": "command", "command": command }],
                }));
                changes.push(format!("add {key} hook -> {command}"));
            }
        }
    }

    Ok(())
}

fn apply_uninstall(
    document: &mut Value,
    agent: &Agent,
    changes: &mut Vec<String>,
) -> Result<(), String> {
    let root = document
        .as_object_mut()
        .ok_or_else(|| "the settings root must be a JSON object".to_string())?;
    let Some(hooks_value) = root.get_mut("hooks") else {
        return Ok(());
    };
    let hooks = hooks_value.as_object_mut().ok_or_else(|| {
        "\"hooks\" in the settings file is not a JSON object; refusing to modify it".to_string()
    })?;

    for signal in agent.signals {
        let key = signal.event.config_key();
        let Some(value) = hooks.get_mut(key) else {
            continue;
        };
        let entries = value.as_array_mut().ok_or_else(|| {
            format!("\"hooks.{key}\" in the settings file is not an array; refusing to modify it")
        })?;

        let removed = remove_own_hooks(entries);
        if removed > 0 {
            changes.push(format!("remove {removed} {key} hook(s)"));
            // Drop the container too when we emptied it, so uninstalling from
            // a file that only held our hooks restores the original shape.
            if entries.is_empty() {
                hooks.remove(key);
            }
        }
    }

    if hooks.is_empty() {
        root.remove("hooks");
    }
    Ok(())
}

/// Get or create `parent[key]` as an object.
fn child_object<'a>(
    parent: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Map<String, Value>, String> {
    if !parent.contains_key(key) {
        parent.insert(key.to_string(), Value::Object(Map::new()));
    }
    parent
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            format!("\"{key}\" in the settings file is not a JSON object; refusing to modify it")
        })
}

/// Get or create `parent[key]` as an array.
fn child_array<'a>(
    parent: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Vec<Value>, String> {
    if !parent.contains_key(key) {
        parent.insert(key.to_string(), Value::Array(Vec::new()));
    }
    parent
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            format!("\"hooks.{key}\" in the settings file is not an array; refusing to modify it")
        })
}

fn is_our_command(command: &str, event: Option<HookEvent>) -> bool {
    if !command.contains(HOOK_MARKER) {
        return false;
    }
    match event {
        None => true,
        Some(event) => command.contains(&format!("{HOOK_MARKER} {}", event.slug())),
    }
}

fn hook_is_ours(hook: &Value, event: Option<HookEvent>) -> bool {
    let Some(object) = hook.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) != Some("command") {
        return false;
    }
    object
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| is_our_command(command, event))
}

/// Find the command of the hook we own for `event`, for rewriting in place.
fn own_command_slot(entries: &mut [Value], event: HookEvent) -> Option<&mut String> {
    for entry in entries.iter_mut() {
        let Some(hooks) = entry.get_mut("hooks").and_then(Value::as_array_mut) else {
            continue;
        };
        for hook in hooks.iter_mut() {
            let Some(object) = hook.as_object_mut() else {
                continue;
            };
            let matches = object.get("type").and_then(Value::as_str) == Some("command")
                && object
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|command| is_our_command(command, Some(event)));
            if matches {
                return match object.get_mut("command") {
                    Some(Value::String(command)) => Some(command),
                    _ => None,
                };
            }
        }
    }
    None
}

/// Remove every hook Vibe99 owns, plus the matcher groups we emptied.
/// Returns how many hooks were removed.
fn remove_own_hooks(entries: &mut Vec<Value>) -> usize {
    let mut removed = 0;
    let mut emptied = Vec::new();

    for (index, entry) in entries.iter_mut().enumerate() {
        let Some(hooks) = entry.get_mut("hooks").and_then(Value::as_array_mut) else {
            continue;
        };
        let before = hooks.len();
        hooks.retain(|hook| !hook_is_ours(hook, None));
        let removed_here = before - hooks.len();
        if removed_here > 0 && hooks.is_empty() {
            emptied.push(index);
        }
        removed += removed_here;
    }

    for index in emptied.into_iter().rev() {
        entries.remove(index);
    }
    removed
}

/// The command we installed for `event`, if it is present.
fn installed_command(document: &Value, event: HookEvent) -> Option<&str> {
    let entries = document.get("hooks")?.get(event.config_key())?.as_array()?;

    for entry in entries {
        let Some(hooks) = entry.get("hooks").and_then(Value::as_array) else {
            continue;
        };
        for hook in hooks {
            let Some(object) = hook.as_object() else {
                continue;
            };
            if object.get("type").and_then(Value::as_str) != Some("command") {
                continue;
            }
            if let Some(command) = object.get("command").and_then(Value::as_str) {
                if is_our_command(command, Some(event)) {
                    return Some(command);
                }
            }
        }
    }
    None
}

/// The executable at the start of a hook command, handling quoted paths.
fn command_executable(command: &str) -> Option<&str> {
    let command = command.trim();
    let executable = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => command.split_whitespace().next()?,
    };
    (!executable.is_empty()).then_some(executable)
}

fn create_backup(file: &Path, warnings: &mut Vec<String>) -> Result<PathBuf, String> {
    let backup = free_backup_path(file)?;
    fs::copy(file, &backup).map_err(|e| {
        format!(
            "cannot back up {} to {}: {e}",
            file.display(),
            backup.display()
        )
    })?;
    prune_backups(file, warnings);
    Ok(backup)
}

/// `<file>.bak-<unix-seconds>`, plus a `-<n>` suffix when two operations land
/// in the same second — a backup must never overwrite an earlier one.
fn free_backup_path(file: &Path) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let name = file
        .file_name()
        .ok_or_else(|| format!("{} has no file name", file.display()))?;

    for ordinal in 0..1000u32 {
        let mut candidate = name.to_os_string();
        candidate.push(format!(".bak-{stamp}"));
        if ordinal > 0 {
            candidate.push(format!("-{ordinal}"));
        }
        let path = file.with_file_name(candidate);
        if !path.exists() {
            return Ok(path);
        }
    }
    Err(format!(
        "cannot find a free backup name for {}",
        file.display()
    ))
}

fn prune_backups(file: &Path, warnings: &mut Vec<String>) {
    let Some(directory) = file.parent() else {
        return;
    };
    let Some(name) = file.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let prefix = format!("{name}.bak-");
    let Ok(listing) = fs::read_dir(directory) else {
        return;
    };

    let mut backups: Vec<((u64, u64), PathBuf)> = listing
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().into_string().ok()?;
            let rest = file_name.strip_prefix(&prefix)?;
            let (stamp, ordinal) = match rest.split_once('-') {
                Some((stamp, ordinal)) => (stamp.parse().ok()?, ordinal.parse().ok()?),
                None => (rest.parse().ok()?, 0),
            };
            Some(((stamp, ordinal), entry.path()))
        })
        .collect();
    backups.sort_by_key(|(key, _)| *key);

    let excess = backups.len().saturating_sub(BACKUP_RETENTION);
    for (_, path) in backups.into_iter().take(excess) {
        if let Err(error) = fs::remove_file(&path) {
            warnings.push(format!(
                "could not remove old backup {}: {error}",
                path.display()
            ));
        }
    }
}

/// Write through a sibling temp file so a failed write cannot leave the
/// user's settings truncated, and keep the original file mode.
fn write_atomic(file: &Path, contents: &[u8]) -> Result<(), String> {
    let directory = file
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", file.display()))?;
    let mut name = file
        .file_name()
        .ok_or_else(|| format!("{} has no file name", file.display()))?
        .to_os_string();
    name.push(format!(".tmp-{}", std::process::id()));

    let temp = directory.join(name);
    fs::write(&temp, contents).map_err(|e| format!("cannot write {}: {e}", temp.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(file) {
            let mode = metadata.permissions().mode();
            let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(mode));
        }
    }
    #[cfg(windows)]
    let _ = fs::remove_file(file);

    fs::rename(&temp, file).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("cannot replace {}: {error}", file.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);

    /// A throwaway directory so tests never touch a real home directory.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> TempDir {
            let id = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("vibe99-enhance-test-{}-{id}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn settings(&self) -> PathBuf {
            self.0.join(".claude").join("settings.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn exe() -> PathBuf {
        PathBuf::from("/opt/vibe99/bin/vibe99ctl")
    }

    fn write(path: &Path, document: &Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_string_pretty(document).unwrap()).unwrap();
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    fn backups(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".bak-"))
            })
            .collect()
    }

    #[test]
    fn install_creates_the_file_and_both_hooks() {
        let temp = TempDir::new();
        let file = temp.settings();

        let outcome = apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();
        assert_eq!(outcome.plan.kind, PlanKind::Create);
        assert!(outcome.backup.is_none(), "nothing existed to back up");

        let document = read(&file);
        assert!(installed_command(&document, HookEvent::Stop).is_some());
        assert!(installed_command(&document, HookEvent::Notification).is_some());
    }

    #[test]
    fn install_preserves_unrelated_settings() {
        let temp = TempDir::new();
        let file = temp.settings();
        write(
            &file,
            &json!({
                "model": "opus",
                "permissions": { "allow": ["Bash(ls:*)"] },
                "hooks": {
                    "Stop": [{ "hooks": [{ "type": "command", "command": "echo done" }] }]
                }
            }),
        );

        apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();

        let document = read(&file);
        assert_eq!(document["model"], "opus");
        assert_eq!(document["permissions"]["allow"][0], "Bash(ls:*)");
        let stop = document["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "the user's own Stop group stays");
        assert_eq!(stop[0]["hooks"][0]["command"], "echo done");
        assert!(installed_command(&document, HookEvent::Stop).is_some());
    }

    #[test]
    fn install_is_idempotent() {
        let temp = TempDir::new();
        let file = temp.settings();

        apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();
        let first = fs::read(&file).unwrap();
        let first_backups = backups(file.parent().unwrap()).len();

        let second_plan = plan_install(&CLAUDE_CODE, &exe(), &file).unwrap();
        assert_eq!(second_plan.kind, PlanKind::Unchanged);
        assert!(second_plan.changes.is_empty());

        let outcome = apply(second_plan, false).unwrap();
        assert!(outcome.backup.is_none());
        assert_eq!(fs::read(&file).unwrap(), first, "file is not rewritten");
        assert_eq!(backups(file.parent().unwrap()).len(), first_backups);
    }

    #[cfg(unix)]
    #[test]
    fn install_follows_a_symlinked_settings_file() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new();
        let real = temp.path().join("dotfiles-settings.json");
        write(&real, &json!({ "model": "opus" }));
        let file = temp.settings();
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        symlink(&real, &file).unwrap();

        let plan = plan_install(&CLAUDE_CODE, &exe(), &file).unwrap();
        assert_eq!(plan.file, fs::canonicalize(&real).unwrap());
        apply(plan, false).unwrap();

        assert!(
            fs::symlink_metadata(&file)
                .unwrap()
                .file_type()
                .is_symlink(),
            "the user's symlink is preserved"
        );
        assert!(installed_command(&read(&real), HookEvent::Stop).is_some());
        assert!(installed_command(&read(&file), HookEvent::Stop).is_some());
    }

    #[test]
    fn install_rejects_a_broken_file_without_touching_it() {
        let temp = TempDir::new();
        let file = temp.settings();
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "{ not json").unwrap();

        let error = plan_install(&CLAUDE_CODE, &exe(), &file).unwrap_err();
        assert!(error.contains("is not valid JSON"), "{error}");
        assert_eq!(fs::read_to_string(&file).unwrap(), "{ not json");
        assert!(backups(file.parent().unwrap()).is_empty());
    }

    #[test]
    fn install_rejects_a_non_object_root() {
        let temp = TempDir::new();
        let file = temp.settings();
        write(&file, &json!(["not", "an", "object"]));

        let error = plan_install(&CLAUDE_CODE, &exe(), &file).unwrap_err();
        assert!(error.contains("must contain a JSON object"), "{error}");
    }

    #[test]
    fn install_rejects_unexpected_hook_shapes() {
        let temp = TempDir::new();
        let file = temp.settings();
        write(&file, &json!({ "hooks": [] }));

        let error = plan_install(&CLAUDE_CODE, &exe(), &file).unwrap_err();
        assert!(error.contains("\"hooks\""), "{error}");

        write(&file, &json!({ "hooks": { "Stop": {} } }));
        let error = plan_install(&CLAUDE_CODE, &exe(), &file).unwrap_err();
        assert!(error.contains("hooks.Stop"), "{error}");
    }

    #[test]
    fn install_refreshes_the_command_when_the_binary_moves() {
        let temp = TempDir::new();
        let file = temp.settings();

        let first = PathBuf::from("/old/bin/vibe99ctl");
        let second = PathBuf::from("/new/bin/vibe99ctl");
        apply(plan_install(&CLAUDE_CODE, &first, &file).unwrap(), false).unwrap();
        let plan = plan_install(&CLAUDE_CODE, &second, &file).unwrap();

        assert_eq!(plan.kind, PlanKind::Update);
        assert_eq!(
            installed_command(&plan.after, HookEvent::Stop),
            Some(hook_command(&second, HookEvent::Stop).as_str())
        );
        apply(plan, false).unwrap();
        assert_eq!(
            read(&file)["hooks"]["Stop"].as_array().unwrap().len(),
            1,
            "the stale entry was replaced, not duplicated"
        );
    }

    #[test]
    fn uninstall_restores_the_original_file() {
        let temp = TempDir::new();
        let file = temp.settings();
        let original = json!({
            "model": "opus",
            "permissions": { "allow": ["Bash(git status)"] },
        });
        write(&file, &original);

        apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();
        assert_ne!(read(&file), original);

        apply(plan_uninstall(&CLAUDE_CODE, &file).unwrap(), false).unwrap();
        assert_eq!(read(&file), original);
    }

    #[test]
    fn uninstall_keeps_the_users_own_hooks() {
        let temp = TempDir::new();
        let file = temp.settings();
        let user_hook = json!({
            "hooks": [{ "type": "command", "command": "/usr/bin/notify-send done" }]
        });
        write(
            &file,
            &json!({ "hooks": { "Stop": [user_hook.clone()] }, "model": "opus" }),
        );

        apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();
        apply(plan_uninstall(&CLAUDE_CODE, &file).unwrap(), false).unwrap();

        let document = read(&file);
        assert_eq!(document["hooks"]["Stop"], json!([user_hook]));
        assert_eq!(document["model"], "opus");
    }

    #[test]
    fn uninstall_of_a_fresh_file_is_a_noop() {
        let temp = TempDir::new();
        let file = temp.settings();

        let plan = plan_uninstall(&CLAUDE_CODE, &file).unwrap();
        assert_eq!(plan.kind, PlanKind::Unchanged);
        assert!(!file.exists(), "uninstall never creates the file");
    }

    #[test]
    fn uninstall_reports_unchanged_when_nothing_is_installed() {
        let temp = TempDir::new();
        let file = temp.settings();
        write(&file, &json!({ "model": "opus" }));

        let plan = plan_uninstall(&CLAUDE_CODE, &file).unwrap();
        assert_eq!(plan.kind, PlanKind::Unchanged);
        assert_eq!(read(&file), json!({ "model": "opus" }));
    }

    #[test]
    fn dry_run_writes_nothing() {
        let temp = TempDir::new();
        let file = temp.settings();

        let outcome = apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), true).unwrap();

        assert!(outcome.backup.is_none());
        assert!(!file.exists());
        assert!(!file.parent().unwrap().exists());
    }

    #[test]
    fn install_backs_up_the_previous_content() {
        let temp = TempDir::new();
        let file = temp.settings();
        let original = json!({ "model": "opus" });
        write(&file, &original);

        let outcome = apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();
        let backup = outcome.backup.expect("a backup was created");
        assert_eq!(read(&backup), original);
        assert!(
            backup
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("settings.json.bak-"),
            "backup keeps the original name plus a timestamp"
        );
    }

    #[test]
    fn backups_made_in_the_same_second_do_not_overwrite_each_other() {
        let temp = TempDir::new();
        let file = temp.settings();
        let original = json!({ "model": "opus" });
        write(&file, &original);

        let first = apply(
            plan_install(&CLAUDE_CODE, Path::new("/a/vibe99ctl"), &file).unwrap(),
            false,
        )
        .unwrap()
        .backup
        .expect("first backup");
        let second = apply(
            plan_install(&CLAUDE_CODE, Path::new("/b/vibe99ctl"), &file).unwrap(),
            false,
        )
        .unwrap()
        .backup
        .expect("second backup");

        assert_ne!(first, second);
        assert_eq!(
            read(&first),
            original,
            "the first backup keeps the pre-install content"
        );
        assert!(read(&second)["hooks"]["Stop"].is_array());
    }

    #[test]
    fn backups_are_pruned_to_the_retention_limit() {
        let temp = TempDir::new();
        let file = temp.settings();
        write(&file, &json!({ "model": "opus" }));
        for stamp in 1..=10u64 {
            fs::write(
                file.with_file_name(format!("settings.json.bak-{stamp}")),
                "{}",
            )
            .unwrap();
        }

        apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();

        let remaining = backups(file.parent().unwrap());
        assert_eq!(remaining.len(), BACKUP_RETENTION);
        assert!(
            remaining
                .iter()
                .any(|path| path.to_string_lossy().ends_with("bak-10")),
            "the newest of the old backups survives"
        );
        assert!(
            !remaining
                .iter()
                .any(|path| path.to_string_lossy().ends_with("bak-1")),
            "the oldest backups are removed"
        );
    }

    #[test]
    fn hook_command_quotes_the_executable() {
        let command = hook_command(Path::new("/home/a b/vibe99ctl"), HookEvent::Stop);
        assert_eq!(
            command,
            "\"/home/a b/vibe99ctl\" enhance notify --event stop"
        );
        assert_eq!(command_executable(&command), Some("/home/a b/vibe99ctl"));
    }

    #[test]
    fn signal_sequence_carries_osc9_and_bell() {
        let signal = signal_sequence(HookEvent::Stop, Some("hello"));
        assert_eq!(signal, "\x1b]9;hello\x07\x07");
    }

    #[test]
    fn signal_sequence_strips_control_characters() {
        let signal = signal_sequence(HookEvent::Notification, Some("bad\x07\x1b[31m text"));
        assert_eq!(signal, "\x1b]9;bad[31m text\x07\x07");
        assert_eq!(signal.matches('\x07').count(), 2);
    }

    #[test]
    fn list_describes_the_registry() {
        let listed = list();
        let agents = listed["agents"].as_array().unwrap();
        assert_eq!(agents.len(), AGENTS.len());
        assert_eq!(agents[0]["id"], "claude-code");
        assert_eq!(agents[0]["configFile"], "~/.claude/settings.json");
        assert_eq!(agents[0]["signals"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn unknown_agents_are_rejected() {
        let error = find_agent("gemini-cli").unwrap_err();
        assert!(error.contains("unknown agent"), "{error}");
    }

    #[test]
    fn doctor_flags_a_missing_install() {
        let temp = TempDir::new();
        let (report, healthy) =
            doctor_checks(None, temp.path(), Path::new("/bin/sh"), None).unwrap();

        assert!(!healthy);
        assert_eq!(report["ok"], false);
        let checks = report["checks"].as_array().unwrap();
        let hooks = checks
            .iter()
            .find(|check| check["name"] == "claude-code hooks")
            .unwrap();
        assert_eq!(hooks["ok"], false);
        assert!(hooks["detail"].as_str().unwrap().contains("missing Stop"));
    }

    #[test]
    fn doctor_accepts_a_healthy_install() {
        let temp = TempDir::new();
        let file = temp.settings();
        // Point the hooks at a binary that exists so the doctor can find it.
        let exe = temp.path().join("vibe99ctl");
        fs::write(&exe, "").unwrap();
        apply(plan_install(&CLAUDE_CODE, &exe, &file).unwrap(), false).unwrap();

        let (report, healthy) = doctor_checks(None, temp.path(), &exe, None).unwrap();
        assert!(healthy, "{report}");
        assert_eq!(report["ok"], true);
    }

    #[test]
    fn doctor_reports_a_stale_hook_binary() {
        let temp = TempDir::new();
        let file = temp.settings();
        apply(plan_install(&CLAUDE_CODE, &exe(), &file).unwrap(), false).unwrap();

        let (report, healthy) =
            doctor_checks(None, temp.path(), &exe(), Some("claude-code")).unwrap();
        assert!(!healthy);
        let checks = report["checks"].as_array().unwrap();
        let binary = checks
            .iter()
            .find(|check| check["name"] == "claude-code hook binary")
            .unwrap();
        assert_eq!(binary["ok"], false);
        assert!(binary["detail"]
            .as_str()
            .unwrap()
            .contains("/opt/vibe99/bin/vibe99ctl"));
    }
}
