use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

mod shell_resolver;
pub use shell_resolver::*;

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

    let mut i = len - 1;
    while i > 0 && buf[i] & 0xC0 == 0x80 {
        i -= 1;
    }

    let expected: usize = match buf[i] {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => return len,
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
            use std::io::Read;

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

    pub fn resize(
        &self,
        window_label: &str,
        pane_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
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
            let removed: Vec<PtySession> =
                owned.iter().filter_map(|k| sessions.remove(k)).collect();
            drop(sessions);
            removed
        };
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

    let detected = auto_detected_candidates();

    if let Some(requested_id) = shell_profile_id {
        if candidates.is_empty() {
            let requested_lower = requested_id.to_lowercase();
            for candidate in &detected {
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

    for candidate in detected {
        if seen.insert((candidate.shell.clone(), candidate.display_name.clone())) {
            candidates.push(candidate);
        }
    }

    candidates
}

#[cfg(test)]
mod tests_pty {
    use super::*;

    #[test]
    fn wsl_unc_path_localhost() {
        assert!(is_wsl_unc_path(r"\\wsl.localhost\Ubuntu\home\user"));
    }

    #[test]
    fn wsl_unc_path_legacy() {
        assert!(is_wsl_unc_path(r"\\wsl$\Ubuntu\home\user"));
    }

    #[test]
    fn wsl_unc_path_case_insensitive() {
        assert!(is_wsl_unc_path(r"\\WSL.LOCALHOST\Ubuntu\home"));
        assert!(is_wsl_unc_path(r"\\Wsl$\Ubuntu"));
    }

    #[test]
    fn wsl_unc_path_forward_slash() {
        assert!(is_wsl_unc_path("//wsl.localhost/Ubuntu/home/user"));
        assert!(is_wsl_unc_path("//wsl$/Ubuntu/home/user"));
    }

    #[test]
    fn wsl_unc_path_canonicalized() {
        assert!(is_wsl_unc_path(r"\\?\UNC\wsl.localhost\Ubuntu\home\user"));
        assert!(is_wsl_unc_path(r"\\?\UNC\wsl$\Ubuntu\home\user"));
        assert!(is_wsl_unc_path(r"\\?\wsl.localhost\Ubuntu\home\user"));
        assert!(is_wsl_unc_path("//?/UNC/wsl.localhost/Ubuntu/home/user"));
    }

    #[test]
    fn not_wsl_unc_path() {
        assert!(!is_wsl_unc_path(r"C:\Users\user"));
        assert!(!is_wsl_unc_path(r"\\server\share"));
        assert!(!is_wsl_unc_path("/home/user"));
        assert!(!is_wsl_unc_path("relative/path"));
        assert!(!is_wsl_unc_path(r"\\?\C:\Users\user"));
        assert!(!is_wsl_unc_path(r"\\?\UNC\server\share\path"));
    }

    #[test]
    fn posix_path_detection() {
        assert!(is_posix_path("/home/user/project"));
        assert!(is_posix_path("/"));
        assert!(!is_posix_path(r"C:\Windows"));
        assert!(!is_posix_path(r"\\wsl$\Ubuntu"));
        assert!(!is_posix_path("relative/path"));
    }

    #[test]
    fn display_name_to_id_samples() {
        assert_eq!(display_name_to_id("WSL (Ubuntu)"), "wsl-ubuntu");
        assert_eq!(display_name_to_id("PowerShell"), "powershell");
        assert_eq!(display_name_to_id("Git Bash (x64)"), "git-bash-x64");
    }
}
