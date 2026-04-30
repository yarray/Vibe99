use portable_pty::CommandBuilder;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::wsl;

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
pub fn build_command(
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

/// Detects WSL UNC paths in any common representation (backslash, forward-slash,
/// extended-length `\\?\UNC\…`, canonicalized).  Returns true when the normalized
/// path starts with `wsl.localhost/` or `wsl$/`.
pub fn is_wsl_unc_path(path: &str) -> bool {
    let lower = path.to_lowercase().replace('\\', "/");
    let s = lower
        .trim_start_matches("//?/")
        .trim_start_matches("unc/")
        .trim_start_matches('/');
    s.starts_with("wsl.localhost/") || s.starts_with("wsl$/")
}

pub fn is_posix_path(path: &str) -> bool {
    path.starts_with('/') && !path.starts_with(r"\\")
}

/// Returns true when a directory path resolves (via canonicalize) to a WSL
/// mount, including through junctions or reparse points.  A canonicalize
/// failure is treated as "untrusted" — safer to fall back than to risk error 448.
pub fn is_wsl_resolved_path(path: &Path) -> bool {
    if is_wsl_unc_path(&path.to_string_lossy()) {
        return true;
    }
    match path.canonicalize() {
        Ok(canonical) => is_wsl_unc_path(&canonical.to_string_lossy()),
        Err(_) => true,
    }
}

/// Resolve the working directory for a new PTY session.
///
/// Order: saved cwd → process cwd → home directory.
/// On Windows, obvious WSL/POSIX strings are rejected before any filesystem
/// call.  For paths that pass the string check, canonicalization detects
/// junctions and symlinks that ultimately point into the WSL filesystem.
pub fn resolve_working_directory(cwd: Option<&str>) -> PathBuf {
    if let Some(cwd) = cwd {
        if cfg!(target_os = "windows") && (is_wsl_unc_path(cwd) || is_posix_path(cwd)) {
            // String-level WSL / POSIX — skip filesystem probe entirely.
        } else {
            let p = PathBuf::from(cwd);
            if p.is_dir() {
                if cfg!(target_os = "windows") && is_wsl_resolved_path(&p) {
                    // Junction / symlink targets WSL — fall through.
                } else {
                    return p;
                }
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cfg!(target_os = "windows") && is_wsl_resolved_path(&cwd) {
            // Process cwd resolves to WSL — skip.
        } else if cwd.is_dir() {
            return cwd;
        }
    }

    dirs_home().unwrap_or_else(|| PathBuf::from("/"))
}

/// Return the user's home directory.
pub fn dirs_home() -> Option<PathBuf> {
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
pub fn which(name: &str) -> Option<PathBuf> {
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
pub fn which(name: &str) -> Option<PathBuf> {
    if Path::new(name).is_file() {
        Some(PathBuf::from(name))
    } else {
        None
    }
}

/// Check whether a path refers to an executable file.
#[cfg(unix)]
pub fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && path
            .metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
pub fn is_executable(path: &Path) -> bool {
    path.is_file()
}

// ----------------------------------------------------------------
// Shell integration helpers
// ----------------------------------------------------------------

/// PowerShell init script that wraps the prompt function to emit OSC 7
/// on every prompt. Uses [char]27/[char]7 instead of backtick escapes to
/// avoid quoting issues when passed as a -Command argument.
pub fn powershell_osc7_init() -> String {
    "$__v99_op=${function:prompt};function prompt{$osc=[char]27+']7;file://'+$env:COMPUTERNAME+'/'+$PWD.Path.Replace('\\','/')+[char]7;Write-Host -NoNewLine $osc;if($__v99_op){& $__v99_op}else{'PS > '}}".to_string()
}

/// Extract the WSL distribution name from shell candidate args.
///
/// Looks for `--distribution <name>` in the args vector. Returns `None`
/// if no distribution flag is found (default distro).
pub fn extract_wsl_distro(args: &[String]) -> Option<&str> {
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
pub fn extract_wsl_inner_shell(args: &[String]) -> String {
    let re = regex::Regex::new(r"(?i)(?:^|\s)--exec\s+(?:.*/)?(\w+)").unwrap();
    re.captures(&args.join(" "))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_lowercase())
        .unwrap_or_else(|| "bash".to_string())
}

/// Load and sanitize settings from disk.
pub fn load_settings_config(
    app: &tauri::AppHandle,
) -> Result<serde_json::Value, String> {
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
pub fn extract_profiles(
    config: &serde_json::Value,
) -> Vec<crate::commands::settings::ShellProfile> {
    config
        .get("shell")
        .and_then(|s| s.get("profiles"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Extract the default profile id from a sanitized config value.
pub fn extract_default_profile(config: &serde_json::Value) -> String {
    config
        .get("shell")
        .and_then(|s| s.get("defaultProfile"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}
