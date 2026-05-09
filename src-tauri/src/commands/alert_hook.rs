use std::process::Stdio;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::settings::SettingsState;

/// Execute a hook script command using the resolved shell.
///
/// The command is spawned as a detached child process — fire-and-forget.
/// Errors during spawn are logged but do not propagate to the frontend,
/// because a broken hook must not break the alert system.
#[tauri::command]
pub fn alert_hook_run(
    app: AppHandle,
    command: String,
    shell_profile_id: Option<String>,
) -> Result<(), String> {
    if command.trim().is_empty() {
        return Ok(());
    }

    let shell = resolve_shell(&app, shell_profile_id.as_deref());

    // Spawn detached: the child outlives the Tauri command.
    let result = std::process::Command::new(&shell)
        .arg("-c")
        .arg(&command)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            eprintln!("[alert-hook] failed to spawn '{}': {}", command, e);
            Ok(())
        }
    }
}

/// Resolve the shell executable path from a profile id.
///
/// If `profile_id` is `None` or doesn't match any saved profile, falls back
/// to the system default shell (`$SHELL` on Unix, `cmd.exe` on Windows).
fn resolve_shell(app: &AppHandle, profile_id: Option<&str>) -> String {
    if let Some(id) = profile_id {
        if let Ok(config) = crate::pty::load_settings_config(app) {
            let profiles = crate::pty::extract_profiles(&config);
            if let Some(profile) = profiles.iter().find(|p| p.id == id) {
                return profile.command.clone();
            }
        }
    }

    default_shell()
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}
