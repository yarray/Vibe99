use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::wsl;

/// Compound key for PTY session lookup: (window_label, pane_id).
///
/// Using a composite key prevents cross-window collisions when multiple
/// windows restore layouts that generate the same sequential pane IDs
/// (p1, p2, …). The frontend never passes `windowLabel` explicitly —
/// Tauri commands derive it from the `Window` parameter automatically.
#[derive(Clone, Eq, Hash, PartialEq)]
struct PaneRef {
    window_label: String,
    pane_id: String,
}

impl std::fmt::Display for PaneRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.window_label, self.pane_id)
    }
}

/// Minimum column count for a PTY session.
const MIN_COLS: u16 = 20;

/// Minimum row count for a PTY session.
const MIN_ROWS: u16 = 8;

/// Default column count when none is specified.
const DEFAULT_COLS: u16 = 80;

/// Default row count when none is specified.
const DEFAULT_ROWS: u16 = 24;

/// A shell candidate for the fallback chain.
pub struct ShellCandidate {
    pub shell: PathBuf,
    pub args: Vec<String>,
    /// Optional display override used to derive unique profile id and name.
    pub display_name: Option<String>,
}

/// Derive a slug-style id from a display name.
///
/// `"WSL (Ubuntu)"` → `"wsl-ubuntu"`, `"PowerShell"` → `"powershell"`.
/// Non-alphanumeric runs become a single `-`; leading/trailing dashes are stripped.
pub fn display_name_to_id(name: &str) -> String {
    use regex::Regex;
    let re = Regex::new(r"[^a-z0-9]+").unwrap();
    re.replace_all(&name.to_lowercase(), "-")
        .trim_matches('-')
        .to_string()
}

/// Payload emitted on `vibe99:terminal-data`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataPayload {
    pane_id: String,
    data: String,
}

/// Returns the index of the last complete UTF-8 character boundary in
/// `buf`. Bytes after this point form an incomplete multi-byte sequence
/// and should be carried over to the next read. Returns `buf.len()` when
/// the buffer already ends on a complete boundary.
fn utf8_safe_cut(buf: &[u8]) -> usize {
    let len = buf.len();
    if len == 0 {
        return 0;
    }

    // Walk backwards past continuation bytes (10xxxxxx) to find the leading byte.
    let mut i = len - 1;
    while i > 0 && buf[i] & 0xC0 == 0x80 {
        i -= 1;
    }

    let expected: usize = match buf[i] {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => return len, // invalid leading byte – flush as-is
    };

    let actual = len - i;
    if actual >= expected {
        len
    } else {
        i
    }
}

/// Payload emitted on `vibe99:terminal-exit`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    pane_id: String,
    exit_code: u32,
    reason: String,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    _reader_thread: std::thread::JoinHandle<()>,
    exit_thread: std::thread::JoinHandle<()>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<PaneRef, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(
        self: &Arc<Self>,
        app: AppHandle,
        pane_id: &str,
        cols: Option<u16>,
        rows: Option<u16>,
        cwd: Option<&str>,
        shell_profile_id: Option<&str>,
        window_label: &str,
    ) -> Result<(), String> {
        let key = PaneRef {
            window_label: window_label.to_string(),
            pane_id: pane_id.to_string(),
        };

        self.destroy_by_ref(&key);

        let pty_system = native_pty_system();
        let raw_cwd = cwd.map(|s| s.to_string());
        let cwd = resolve_working_directory(cwd);
        let cols = cols.unwrap_or(DEFAULT_COLS).max(MIN_COLS);
        let rows = rows.unwrap_or(DEFAULT_ROWS).max(MIN_ROWS);

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open PTY: {e}"))?;

        let mut cmd = None;
        let mut last_error = String::new();
        let mut shell_stem = String::new();

        for candidate in shell_candidates(&app, shell_profile_id) {
            let stem = candidate
                .shell
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            match build_command(&candidate, &cwd, raw_cwd.as_deref()) {
                Ok(c) => {
                    if stem == "wsl" {
                        shell_stem = extract_wsl_inner_shell(&candidate.args);
                    } else {
                        shell_stem = stem;
                    }
                    cmd = Some(c);
                    break;
                }
                Err(e) => {
                    last_error = e;
                }
            }
        }

        let mut cmd = cmd.ok_or_else(|| {
            if last_error.is_empty() {
                "No executable shell found".into()
            } else {
                last_error
            }
        })?;

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        if shell_stem == "powershell" || shell_stem == "pwsh" {
            cmd.arg("-NoExit");
            cmd.arg("-Command");
            cmd.arg(powershell_osc7_init());
        } else if shell_stem == "bash" {
            cmd.env(
                "PROMPT_COMMAND",
                r#"printf "\033]7;file://%s%s\007" "$(hostname)" "$PWD""#,
            );
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {e}"))?;

        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to get PTY writer: {e}"))?;

        if shell_stem == "zsh" {
            let init = b"vibe99_osc7(){printf '\\033]7;file://%s%s\\007' \"$(hostname)\" \"$PWD\"};chpwd_functions+=(vibe99_osc7);vibe99_osc7\n";
            let _ = writer.write_all(init);
            let _ = writer.flush();
        }

        let master = pair.master;
        let killer = child.clone_killer();

        let pane_id_owned = pane_id.to_string();

        let app_reader = app.clone();
        let pane_id_reader = pane_id_owned.clone();
        let window_label_reader = window_label.to_string();
        let _reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut pending: Vec<u8> = Vec::with_capacity(4);

            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        if !pending.is_empty() {
                            let text = String::from_utf8_lossy(&pending);
                            let _ = app_reader.emit_to(
                                &window_label_reader,
                                "vibe99:terminal-data",
                                TerminalDataPayload {
                                    pane_id: pane_id_reader.clone(),
                                    data: text.into_owned(),
                                },
                            );
                        }
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let cut = utf8_safe_cut(&pending);
                        if cut > 0 {
                            let text = String::from_utf8_lossy(&pending[..cut]);
                            let _ = app_reader.emit_to(
                                &window_label_reader,
                                "vibe99:terminal-data",
                                TerminalDataPayload {
                                    pane_id: pane_id_reader.clone(),
                                    data: text.into_owned(),
                                },
                            );
                            pending.drain(..cut);
                        }
                    }
                }
            }
        });

        let manager = Arc::clone(self);
        let app_exit = app.clone();
        let exit_key = key.clone();
        let exit_thread = std::thread::spawn(move || {
            let exit_code = child.wait().map(|s| s.exit_code()).unwrap_or(1);

            let _ = app_exit.emit_to(
                &exit_key.window_label,
                "vibe99:terminal-exit",
                TerminalExitPayload {
                    pane_id: exit_key.pane_id.clone(),
                    exit_code,
                    reason: "exited".into(),
                },
            );

            if let Ok(mut sessions) = manager.sessions.lock() {
                sessions.remove(&exit_key);
            }
        });

        let session = PtySession {
            master,
            writer,
            killer,
            _reader_thread,
            exit_thread,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .insert(key, session);

        Ok(())
    }

    pub fn write(&self, window_label: &str, pane_id: &str, data: &[u8]) -> Result<(), String> {
        let key = PaneRef {
            window_label: window_label.to_string(),
            pane_id: pane_id.to_string(),
        };
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let session = sessions
            .get_mut(&key)
            .ok_or_else(|| format!("no session for pane {pane_id}"))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| format!("write to PTY failed: {e}"))?;

        session
            .writer
            .flush()
            .map_err(|e| format!("flush PTY failed: {e}"))?;

        Ok(())
    }

    pub fn resize(&self, window_label: &str, pane_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let key = PaneRef {
            window_label: window_label.to_string(),
            pane_id: pane_id.to_string(),
        };
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let session = sessions
            .get(&key)
            .ok_or_else(|| format!("no session for pane {pane_id}"))?;

        session
            .master
            .resize(PtySize {
                rows: rows.max(MIN_ROWS),
                cols: cols.max(MIN_COLS),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))?;

        Ok(())
    }

    pub fn destroy(&self, window_label: &str, pane_id: &str) {
        let key = PaneRef {
            window_label: window_label.to_string(),
            pane_id: pane_id.to_string(),
        };
        self.destroy_by_ref(&key);
    }

    pub fn destroy_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for session in sessions.values_mut() {
                let _ = session.killer.kill();
            }
            sessions.clear();
        }
    }

    pub fn destroy_for_window(&self, window_label: &str) {
        let sessions_to_clean = {
            let mut sessions = match self.sessions.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            let owned: Vec<PaneRef> = sessions
                .keys()
                .filter(|k| k.window_label == window_label)
                .cloned()
                .collect();
            let removed: Vec<PtySession> = owned
                .iter()
                .filter_map(|k| sessions.remove(k))
                .collect();
            // Release lock before joining threads.
            drop(sessions);
            removed
        };
        // Kill and join in background so we don't block the Tauri event thread.
        std::thread::spawn(move || {
            for mut session in sessions_to_clean {
                let _ = session.killer.kill();
                let _ = session.exit_thread.join();
            }
        });
    }

    fn destroy_by_ref(&self, key: &PaneRef) {
        let exit_handle = {
            let mut sessions = match self.sessions.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            let Some(session) = sessions.remove(key) else {
                return;
            };
            let PtySession {
                mut killer,
                exit_thread,
                ..
            } = session;
            let _ = killer.kill();
            exit_thread
        };
        let _ = exit_handle.join();
    }
}

// ----------------------------------------------------------------
// Shell resolution
// ----------------------------------------------------------------

/// Return the ordered list of shell candidates for spawning a PTY.
///
/// Priority:
/// 1. Default profile from settings (if configured and valid).
/// 2. Remaining profiles from settings (if any).
/// 3. Auto-detected platform fallbacks including WSL (always appended as safety net).
///
/// When `shell_profile_id` is `Some(id)`, only the matching profile is
/// tried (with auto-detected fallbacks as safety net), bypassing the
/// normal priority order.
fn shell_candidates(app: &AppHandle, shell_profile_id: Option<&str>) -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();
    let mut seen: HashSet<(PathBuf, Option<String>)> = HashSet::new();

    if let Ok(config) = load_settings_config(app) {
        let profiles = extract_profiles(&config);
        let default_id = extract_default_profile(&config);

        // If a specific profile is requested, use only that one.
        if let Some(requested_id) = shell_profile_id {
            if let Some(profile) = profiles.iter().find(|p| p.id == requested_id) {
                let path = PathBuf::from(&profile.command);
                if seen.insert((path.clone(), None)) {
                    candidates.push(ShellCandidate {
                        shell: path,
                        args: profile.args.clone(),
                        display_name: None,
                    });
                }
            }
        } else {
            // Normal priority: default profile first, then the rest.
            let ordered: Vec<_> = profiles
                .iter()
                .filter(|p| p.id != default_id)
                .chain(profiles.iter().filter(|p| p.id == default_id))
                .collect();

            for profile in ordered.into_iter().rev() {
                let path = PathBuf::from(&profile.command);
                if seen.insert((path.clone(), None)) {
                    candidates.push(ShellCandidate {
                        shell: path,
                        args: profile.args.clone(),
                        display_name: None,
                    });
                }
            }
        }
    }

    // Auto-detected fallbacks.
    let detected = auto_detected_candidates();

    // If a specific profile was requested but not found in settings,
    // try to match it against auto-detected candidates by id.
    if let Some(requested_id) = shell_profile_id {
        if candidates.is_empty() {
            let requested_lower = requested_id.to_lowercase();
            for candidate in &detected {
                // Match by display_name-derived id first, then by shell stem.
                let derived_id = candidate
                    .display_name
                    .as_ref()
                    .map(|d| display_name_to_id(d));
                let matches_display = derived_id.as_deref() == Some(&requested_lower);
                let stem = candidate
                    .shell
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default()
                    .to_lowercase();
                if matches_display || stem == requested_lower {
                    if seen.insert((candidate.shell.clone(), candidate.display_name.clone())) {
                        candidates.push(ShellCandidate {
                            shell: candidate.shell.clone(),
                            args: candidate.args.clone(),
                            display_name: candidate.display_name.clone(),
                        });
                    }
                    break;
                }
            }
        }
    }

    // Append remaining auto-detected fallbacks (deduplicated).
    for candidate in detected {
        if seen.insert((candidate.shell.clone(), candidate.display_name.clone())) {
            candidates.push(candidate);
        }
    }

    candidates
}

/// Load and sanitize settings from disk.
fn load_settings_config(app: &AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("settings.json");

    if !path.exists() {
        return Err("no settings file".into());
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&contents).unwrap_or(serde_json::Value::Null);

    // Reuse the same sanitization as the settings command layer.
    Ok(crate::commands::settings::sanitize_config(&parsed))
}

/// Extract shell profiles from a sanitized config value.
fn extract_profiles(config: &serde_json::Value) -> Vec<crate::commands::settings::ShellProfile> {
    config
        .get("shell")
        .and_then(|s| s.get("profiles"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Extract the default profile id from a sanitized config value.
fn extract_default_profile(config: &serde_json::Value) -> String {
    config
        .get("shell")
        .and_then(|s| s.get("defaultProfile"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ----------------------------------------------------------------
// Auto-detection fallback
// ----------------------------------------------------------------

/// Return platform-specific shell candidates via environment inspection.
///
/// This is the fallback chain used when no profiles are configured in
/// settings, or when all configured profiles fail to resolve.
/// On Windows, WSL shells are offered after native Windows shells.
pub fn auto_detected_candidates() -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();

    if cfg!(target_os = "windows") {
        // Windows: check custom env, then PowerShell, then pwsh, then
        // ComSpec, then cmd.exe, then WSL (if available).
        if let Ok(custom) = std::env::var("VIBE99_WINDOWS_SHELL") {
            if !custom.is_empty() {
                // Special case: "wsl.exe" triggers WSL detection.
                if custom.eq_ignore_ascii_case("wsl.exe") {
                    push_wsl_candidates(&mut candidates, None);
                } else {
                    candidates.push(ShellCandidate {
                        shell: PathBuf::from(&custom),
                        args: vec![],
                        display_name: None,
                    });
                }
            }
        }
        for shell in &["powershell.exe", "pwsh.exe", "cmd.exe"] {
            candidates.push(ShellCandidate {
                shell: PathBuf::from(shell),
                args: vec![],
                display_name: None,
            });
        }
        if let Ok(comspec) = std::env::var("ComSpec") {
            if !comspec.is_empty() {
                candidates.push(ShellCandidate {
                    shell: PathBuf::from(&comspec),
                    args: vec![],
                    display_name: None,
                });
            }
        }
        // Append WSL candidates after native Windows shells.
        push_wsl_candidates(&mut candidates, None);
    } else {
        // Unix (Linux / macOS): $SHELL first (only if absolute), then
        // platform-specific fallbacks, deduplicated.
        let mut seen = HashSet::new();

        if let Ok(shell) = std::env::var("SHELL") {
            let p = PathBuf::from(&shell);
            if p.is_absolute() && seen.insert(p.clone()) {
                candidates.push(ShellCandidate {
                    shell: p,
                    args: vec!["-il".into()],
                    display_name: None,
                });
            }
        }

        let fallbacks: &[&str] = if cfg!(target_os = "macos") {
            &["/bin/zsh", "/bin/bash", "/bin/sh"]
        } else {
            &["/bin/bash", "/bin/sh"]
        };

        for shell in fallbacks {
            let p = PathBuf::from(shell);
            if seen.insert(p.clone()) && is_executable(&p) {
                candidates.push(ShellCandidate {
                    shell: p,
                    args: vec!["-il".into()],
                    display_name: None,
                });
            }
        }
    }

    candidates
}

/// Append WSL shell candidates to the list — one per detected distribution.
///
/// On non-Windows or when WSL is not available this is a no-op.
/// `distro_override` allows forcing a specific distribution (used by
/// `VIBE99_WINDOWS_SHELL=wsl.exe`).
#[cfg(target_os = "windows")]
fn push_wsl_candidates(candidates: &mut Vec<ShellCandidate>, distro_override: Option<&str>) {
    if !wsl::is_wsl_available() {
        return;
    }

    let default_shell = wsl::detect_wsl_default_shell().unwrap_or_else(|| "/bin/bash".into());

    if let Some(distro) = distro_override {
        let args = wsl::wsl_shell_args(Some(distro), &default_shell, &["-il".into()]);
        candidates.push(ShellCandidate {
            shell: PathBuf::from("wsl.exe"),
            args,
            display_name: Some(format!("WSL ({})", distro)),
        });
        return;
    }

    let distros = wsl::list_distributions();
    for distro in &distros {
        let args = wsl::wsl_shell_args(Some(distro), &default_shell, &["-il".into()]);
        candidates.push(ShellCandidate {
            shell: PathBuf::from("wsl.exe"),
            args,
            display_name: Some(format!("WSL ({})", distro)),
        });
    }
}

#[cfg(not(target_os = "windows"))]
fn push_wsl_candidates(_candidates: &mut Vec<ShellCandidate>, _distro_override: Option<&str>) {}

/// Build a `CommandBuilder` for a shell candidate. Returns an error if
/// the candidate binary does not exist or is not executable.
///
/// WSL candidates (shell == "wsl.exe") are handled specially: `wsl.exe`
/// is verified on the Windows side, but the inner shell (e.g. `/bin/bash`)
/// is not checked since it lives inside the WSL filesystem.
///
/// `raw_cwd` carries the original cwd string from the frontend (before
/// `resolve_working_directory` validated it). For WSL panes the saved cwd
/// may be a Linux path like `/home/user/projects` that doesn't pass
/// `is_dir()` on Windows. In that case we convert it to a UNC path
/// (`\\wsl.localhost\<distro>/home/user/projects`) so `wsl.exe` can use it
/// as its working directory, and the Linux shell inside sees the original
/// path.
fn build_command(
    candidate: &ShellCandidate,
    cwd: &Path,
    raw_cwd: Option<&str>,
) -> Result<CommandBuilder, String> {
    let is_wsl = cfg!(target_os = "windows")
        && candidate
            .shell
            .file_name()
            .is_some_and(|n| n.eq_ignore_ascii_case("wsl.exe"));

    if is_wsl {
        // Verify wsl.exe exists on the Windows PATH.
        let wsl_path = which("wsl.exe").ok_or("wsl.exe not found on PATH")?;

        let mut cmd = CommandBuilder::new(&wsl_path);
        cmd.args(&candidate.args);

        // Resolve the effective cwd for the WSL process.
        if let Some(raw) = raw_cwd.filter(|s| s.starts_with('/')) {
            // Linux path from OSC 7 — convert to UNC so wsl.exe can cd to it.
            if let Some(distro) = extract_wsl_distro(&candidate.args) {
                let unc = wsl::wsl_path_to_unc(distro, raw);
                cmd.cwd(PathBuf::from(&unc));
            } else {
                cmd.cwd(cwd);
            }
        } else {
            // Windows path — use the resolved cwd (already validated).
            cmd.cwd(cwd);
        }

        // Set WSLENV so WSL forwards selected env vars from Windows.
        let wslenv = wsl::wslenv_value();
        cmd.env("WSLENV", wslenv);

        return Ok(cmd);
    }

    // Resolve bare names (e.g. "powershell.exe") via PATH lookup.
    let shell_path = if candidate.shell.is_absolute() {
        if !candidate.shell.exists() {
            return Err(format!("shell not found: {:?}", candidate.shell));
        }
        candidate.shell.clone()
    } else {
        which(&candidate.shell.to_string_lossy())
            .ok_or_else(|| format!("shell not found on PATH: {:?}", candidate.shell))?
    };

    if !is_executable(&shell_path) {
        return Err(format!("shell not executable: {:?}", shell_path));
    }

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.args(&candidate.args);
    cmd.cwd(cwd);
    Ok(cmd)
}

// ----------------------------------------------------------------
// Working directory resolution
// ----------------------------------------------------------------

/// Resolve the working directory for a new PTY session.
///
/// Mirrors `electron/main.js` → `getSpawnWorkingDirectory()`:
/// 1. Use the provided `cwd` if it is a valid directory.
/// 2. Fall back to the current working directory.
/// 3. Fall back to the user's home directory.
fn resolve_working_directory(cwd: Option<&str>) -> PathBuf {
    if let Some(cwd) = cwd {
        let p = PathBuf::from(cwd);
        if p.is_dir() {
            return p;
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cwd.is_dir() {
            return cwd;
        }
    }

    dirs_home().unwrap_or_else(|| PathBuf::from("/"))
}

/// Return the user's home directory.
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/// Locate an executable on the system PATH.
///
/// Returns the full path if found, `None` otherwise. On Windows this also
/// checks the current directory and appends `.exe` if no extension is
/// present.
#[cfg(target_os = "windows")]
fn which(name: &str) -> Option<PathBuf> {
    // Check the bare name first (handles absolute paths).
    if Path::new(name).is_file() {
        return Some(PathBuf::from(name));
    }

    let exe_name = if name.ends_with(".exe") {
        name.to_string()
    } else {
        format!("{name}.exe")
    };

    // System PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            let candidate = PathBuf::from(dir).join(&exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn which(name: &str) -> Option<PathBuf> {
    if Path::new(name).is_file() {
        Some(PathBuf::from(name))
    } else {
        None
    }
}

/// Check whether a path refers to an executable file.
#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && path
            .metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

// ----------------------------------------------------------------
// Shell integration helpers
// ----------------------------------------------------------------

/// PowerShell init script that wraps the prompt function to emit OSC 7
/// on every prompt. Uses [char]27/[char]7 instead of backtick escapes to
/// avoid quoting issues when passed as a -Command argument.
fn powershell_osc7_init() -> String {
    "$__v99_op=${function:prompt};function prompt{$osc=[char]27+']7;file://'+$env:COMPUTERNAME+'/'+$PWD.Path.Replace('\\','/')+[char]7;Write-Host -NoNewLine $osc;if($__v99_op){& $__v99_op}else{'PS > '}}".to_string()
}

/// Extract the WSL distribution name from shell candidate args.
///
/// Looks for `--distribution <name>` in the args vector. Returns `None`
/// if no distribution flag is found (default distro).
fn extract_wsl_distro(args: &[String]) -> Option<&str> {
    for i in 0..args.len().saturating_sub(1) {
        if args[i] == "--distribution" {
            return Some(&args[i + 1]);
        }
    }
    None
}

/// Extract the inner shell stem from WSL candidate args.
///
/// Matches `--exec <path>` and returns the file stem (e.g. `/bin/bash` →
/// `"bash"`). Returns `"bash"` as a fallback.
fn extract_wsl_inner_shell(args: &[String]) -> String {
    let re = regex::Regex::new(r"(?i)(?:^|\s)--exec\s+(?:.*/)?(\w+)").unwrap();
    re.captures(&args.join(" "))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_lowercase())
        .unwrap_or_else(|| "bash".to_string())
}
