use serde::Serialize;

use crate::wsl;

/// WSL status returned to the frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    available: bool,
    distributions: Vec<String>,
    /// Always `None`: probing `$SHELL` inside WSL was removed because it
    /// boots the WSL VM (see `wsl.rs`). Field kept for API compatibility.
    default_shell: Option<String>,
}

/// Check WSL availability and return distribution info.
///
/// Async so the (bounded, cached) `wsl.exe` probe runs on a worker thread
/// instead of the IPC thread. Always returns `available: false` on
/// non-Windows platforms.
#[tauri::command]
pub async fn wsl_status() -> WslStatus {
    let available = wsl::is_wsl_available();
    let distributions = if available {
        tauri::async_runtime::spawn_blocking(wsl::discover_distributions)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    WslStatus {
        available,
        distributions,
        default_shell: None,
    }
}

/// Clear the cached "WSL unavailable" flag and re-run detection.
///
/// Use this when the user wants to re-detect WSL after installing it
/// while the application is already running. Returns the fresh status.
#[tauri::command]
pub async fn wsl_redetect() -> WslStatus {
    wsl::clear_wsl_unavailable_flag();
    wsl_status().await
}

/// Convert a Windows path to its WSL equivalent.
///
/// Returns the converted path or the original input unchanged if it
/// does not look like a Windows path.
#[tauri::command]
pub fn wsl_convert_path(windows_path: String) -> Result<String, String> {
    wsl::windows_to_wsl_path(&windows_path)
        .ok_or_else(|| format!("cannot convert path: {windows_path}"))
}

/// Get the current working directory, converting to WSL path format
/// when running under WSL.
#[tauri::command]
pub fn wsl_cwd() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("failed to get cwd: {e}"))?;
    let cwd_str = cwd.display().to_string();

    // If this is a Windows path and WSL is available, convert it.
    if cfg!(target_os = "windows") && wsl::is_wsl_available() {
        if let Some(wsl_path) = wsl::windows_to_wsl_path(&cwd_str) {
            return Ok(wsl_path);
        }
    }

    Ok(cwd_str)
}
