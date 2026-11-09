use super::settings::{sanitize_config, settings_path, SettingsState, ShellProfile};
use serde_json::Value;
use std::collections::HashSet;
use tauri::{AppHandle, Manager};

/// Friendly names for common shell executables.
fn friendly_label(shell: &str) -> (String, String) {
    let lower = shell.to_lowercase();
    let stem = std::path::Path::new(&lower)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let label = match stem.as_str() {
        "powershell" => "Windows PowerShell",
        "pwsh" => "PowerShell",
        "cmd" => "Command Prompt",
        "wsl" => "WSL",
        "bash" => "Bash",
        "zsh" => "Zsh",
        "sh" => "Sh",
        "fish" => "Fish",
        other => other,
    };

    (stem.to_string(), label.to_string())
}

/// Result type for commands that return the full shell block.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellConfig {
    profiles: Vec<ShellProfile>,
    default_profile: String,
}

/// Read the raw settings file, apply full sanitization, and extract
/// the shell block. Returns a default (empty) shell config if the
/// file does not exist or cannot be parsed.
fn read_shell_config(app: &AppHandle) -> Result<(Value, ShellConfig), String> {
    let path = settings_path(app)?;

    let raw = if path.exists() {
        let contents =
            std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;
        serde_json::from_str(&contents).unwrap_or(Value::Null)
    } else {
        Value::Null
    };

    let sanitized = sanitize_config(&raw);
    let profiles = extract_profiles(&sanitized);
    let default_profile = extract_default_profile(&sanitized);

    Ok((
        sanitized,
        ShellConfig {
            profiles,
            default_profile,
        },
    ))
}

/// Persist the full sanitized config (with the shell block replaced)
/// back to disk.
fn write_config(app: &AppHandle, config: &Value) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create settings directory: {e}"))?;
    }
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    std::fs::write(&path, serialized).map_err(|e| format!("failed to write settings: {e}"))
}

/// Persist a profile list and its default id, then return the sanitized shell
/// block that was actually written.
///
/// Every profile mutation funnels through here so the file format,
/// default-profile fallbacks and sanitization stay identical no matter which
/// caller performed the write (UI bridge commands or the CLI server).
fn persist_shell_config(
    app: &AppHandle,
    mut config: Value,
    profiles: Vec<ShellProfile>,
    default_profile: String,
) -> Result<ShellConfig, String> {
    if let Some(obj) = config.as_object_mut() {
        obj.insert(
            "shell".to_string(),
            serde_json::json!({
                "profiles": profiles,
                "defaultProfile": default_profile,
            }),
        );
    }

    let sanitized = sanitize_config(&config);
    write_config(app, &sanitized)?;

    Ok(ShellConfig {
        profiles: extract_profiles(&sanitized),
        default_profile: extract_default_profile(&sanitized),
    })
}

fn extract_profiles(config: &Value) -> Vec<ShellProfile> {
    config
        .get("shell")
        .and_then(|s| s.get("profiles"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn extract_default_profile(config: &Value) -> String {
    config
        .get("shell")
        .and_then(|s| s.get("defaultProfile"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ----------------------------------------------------------------
// Tauri commands
// ----------------------------------------------------------------

/// List all shell profiles and the current default profile id.
#[tauri::command]
pub fn shell_profiles_list(app: AppHandle) -> Result<ShellConfig, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (_, shell_config) = read_shell_config(&app)?;
    Ok(shell_config)
}

/// Set the default shell profile by `profile_id`.
///
/// Returns an error if no profile with the given id exists.
#[tauri::command]
pub fn shell_profile_set(app: AppHandle, profile_id: String) -> Result<ShellConfig, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, shell_config) = read_shell_config(&app)?;

    if !shell_config.profiles.iter().any(|p| p.id == profile_id) {
        return Err(format!("profile not found: {profile_id}"));
    }

    persist_shell_config(&app, config, shell_config.profiles, profile_id)
}

/// Add a new shell profile. If a profile with the same `id` already
/// exists it is replaced.
///
/// The `name` field is optional (defaults to `id` if absent). The `args`
/// field is optional (defaults to `[]`).
#[tauri::command]
pub fn shell_profile_add(app: AppHandle, profile: Value) -> Result<ShellConfig, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, mut shell_config) = read_shell_config(&app)?;

    let new_profile = ShellProfile::sanitize(&profile)
        .ok_or("invalid profile: 'id' and 'command' are required")?;

    // Upsert: replace existing profile with the same id, or append.
    if let Some(existing) = shell_config
        .profiles
        .iter_mut()
        .find(|p| p.id == new_profile.id)
    {
        *existing = new_profile;
    } else {
        shell_config.profiles.push(new_profile);
    }

    // If no default is set yet, point to the first profile.
    if shell_config.default_profile.is_empty() {
        shell_config.default_profile = shell_config.profiles[0].id.clone();
    }

    persist_shell_config(
        &app,
        config,
        shell_config.profiles,
        shell_config.default_profile,
    )
}

/// Remove a shell profile by `profile_id`.
///
/// If the removed profile was the default, the default is cleared
/// (set to the first remaining profile's id, or empty string).
#[tauri::command]
pub fn shell_profile_remove(app: AppHandle, profile_id: String) -> Result<ShellConfig, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, mut shell_config) = read_shell_config(&app)?;

    let before_len = shell_config.profiles.len();
    shell_config.profiles.retain(|p| p.id != profile_id);

    if shell_config.profiles.len() == before_len {
        return Err(format!("profile not found: {profile_id}"));
    }

    // Re-point default if the removed profile was selected.
    if shell_config.default_profile == profile_id {
        shell_config.default_profile = shell_config
            .profiles
            .first()
            .map(|p| p.id.clone())
            .unwrap_or_default();
    }

    persist_shell_config(
        &app,
        config,
        shell_config.profiles,
        shell_config.default_profile,
    )
}

/// Reorder shell profiles to match the given list of profile IDs.
///
/// Profiles whose IDs appear in the list are arranged in that order;
/// any profiles not mentioned in the list retain their relative order
/// and are appended at the end. This preserves auto-detected profiles
/// that may not be part of the user's explicit ordering.
#[tauri::command]
pub fn shell_profiles_reorder(
    app: AppHandle,
    profile_ids: Vec<String>,
) -> Result<ShellConfig, String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, shell_config) = read_shell_config(&app)?;

    // Build the reordered list: first the explicitly ordered profiles,
    // then any remaining ones in their original order.
    let mut reordered: Vec<ShellProfile> = Vec::with_capacity(shell_config.profiles.len());
    let mut remaining: Vec<ShellProfile> = shell_config.profiles;

    for id in &profile_ids {
        if let Some(pos) = remaining.iter().position(|p| &p.id == id) {
            reordered.push(remaining.remove(pos));
        }
    }
    // Append any profiles not in the reorder list (retain original order)
    reordered.append(&mut remaining);

    persist_shell_config(&app, config, reordered, shell_config.default_profile)
}

/// Detect available shells on the system and return them as profiles.
///
/// These are shells found via environment probes (e.g. PowerShell, WSL)
/// that are not necessarily in the user's settings. The frontend can
/// merge them into the profile list so users can see and select them.
#[tauri::command]
pub fn shell_profiles_detect() -> Vec<ShellProfile> {
    let candidates = crate::pty::auto_detected_candidates();
    let mut profiles = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for candidate in candidates {
        let shell_str = candidate.shell.to_string_lossy().to_string();

        let (id, name) = if let Some(ref display) = candidate.display_name {
            (crate::pty::display_name_to_id(display), display.clone())
        } else {
            friendly_label(&shell_str)
        };

        // Deduplicate by id (e.g. ComSpec may resolve to the same cmd.exe).
        if !seen_ids.insert(id.clone()) {
            continue;
        }

        profiles.push(ShellProfile {
            id,
            name,
            command: shell_str,
            args: candidate.args.join(" "),
            theme_id: String::new(),
        });
    }

    profiles
}

// ----------------------------------------------------------------
// Validated write operations for the CLI server
// ----------------------------------------------------------------
//
// The UI editor is an upsert: saving replaces the profile with the same id and
// the list redraws immediately, so the user sees the result. A CLI caller has
// no such feedback, so its write methods validate first — a create that would
// overwrite an existing profile or shadow an auto-detected shell is an error
// instead of a silent replace.
//
// These functions take the same settings lock and go through the same
// `persist_shell_config` path as the Tauri commands above; only the
// preconditions differ.

/// Auto-detected shells are environment probes, not settings entries. The UI
/// shows them as read-only, so a CLI write must refuse instead of shadowing
/// the detected shell with a settings profile of the same id.
fn auto_detected_error(id: &str) -> String {
    format!(
        "profile '{id}' is auto-detected and read-only; create a copy under a new id instead (e.g. '{id}-custom')"
    )
}

/// All profiles a user can see: settings profiles plus auto-detected shells
/// that no settings profile shadows. Mirrors the merge the renderer performs.
fn visible_profiles<'a>(
    profiles: &'a [ShellProfile],
    detected: &'a [ShellProfile],
) -> Vec<&'a ShellProfile> {
    let user_ids: HashSet<&str> = profiles.iter().map(|p| p.id.as_str()).collect();
    profiles
        .iter()
        .chain(
            detected
                .iter()
                .filter(|p| !user_ids.contains(p.id.as_str())),
        )
        .collect()
}

/// Return the id of a visible profile already using `name` (case-insensitive),
/// ignoring `exclude_id`. Profiles with an empty name display their id, so the
/// display name is what must stay unique.
fn name_conflict(
    profiles: &[ShellProfile],
    detected: &[ShellProfile],
    exclude_id: Option<&str>,
    name: &str,
) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    visible_profiles(profiles, detected)
        .into_iter()
        .filter(|p| Some(p.id.as_str()) != exclude_id)
        .find(|p| p.display_name().eq_ignore_ascii_case(name))
        .map(|p| p.id.clone())
}

fn existing_user_profile<'a>(profiles: &'a [ShellProfile], id: &str) -> Option<&'a ShellProfile> {
    profiles.iter().find(|p| p.id == id)
}

/// Create a profile from a CLI request (`{id?, name?, command, args?, themeId?}`).
///
/// The id is derived from the name when omitted, matching what the UI does when
/// the user types a name. Returns the created profile together with the
/// sanitized shell block.
pub fn profile_create(
    app: AppHandle,
    request: &Value,
) -> Result<(ShellProfile, ShellConfig), String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, shell_config) = read_shell_config(&app)?;

    if request
        .get("command")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_none()
    {
        return Err("profile needs a non-empty 'command'".to_string());
    }

    let name = request
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    let id = match request
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(id) => id.to_string(),
        None => crate::pty::display_name_to_id(name),
    };
    if id.is_empty() {
        return Err("profile needs an id or a name".to_string());
    }

    let candidate_json = serde_json::json!({
        "id": id,
        "name": name,
        "command": request.get("command").cloned().unwrap_or(Value::Null),
        "args": request.get("args").cloned().unwrap_or(Value::Null),
        "themeId": request.get("themeId").cloned().unwrap_or(Value::Null),
    });
    let candidate = ShellProfile::sanitize(&candidate_json)
        .ok_or("invalid profile: 'id' and 'command' are required")?;

    if existing_user_profile(&shell_config.profiles, &candidate.id).is_some() {
        return Err(format!(
            "profile id '{}' already exists; use `profile update {}` to change it",
            candidate.id, candidate.id
        ));
    }

    let detected = shell_profiles_detect();
    if detected.iter().any(|p| p.id == candidate.id) {
        return Err(auto_detected_error(&candidate.id));
    }
    if let Some(owner) = name_conflict(
        &shell_config.profiles,
        &detected,
        None,
        candidate.display_name(),
    ) {
        return Err(format!(
            "profile name '{}' is already used by profile '{owner}'",
            candidate.display_name()
        ));
    }

    let mut profiles = shell_config.profiles;
    let default_profile = if shell_config.default_profile.is_empty() {
        candidate.id.clone()
    } else {
        shell_config.default_profile
    };
    profiles.push(candidate.clone());

    let config = persist_shell_config(&app, config, profiles, default_profile)?;
    Ok((candidate, config))
}

/// Update an existing profile. `patch` may contain `name`, `command`, `args`
/// and `themeId`; keys that are absent or null keep their current value. The
/// path id is authoritative — ids are not renamable.
pub fn profile_update(
    app: AppHandle,
    profile_id: &str,
    patch: &Value,
) -> Result<(ShellProfile, ShellConfig), String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, shell_config) = read_shell_config(&app)?;

    let existing = match existing_user_profile(&shell_config.profiles, profile_id) {
        Some(profile) => profile.clone(),
        None => {
            if shell_profiles_detect().iter().any(|p| p.id == profile_id) {
                return Err(auto_detected_error(profile_id));
            }
            return Err(format!("profile not found: {profile_id}"));
        }
    };

    let mut merged =
        serde_json::to_value(&existing).map_err(|e| format!("serialize profile: {e}"))?;
    if let (Some(obj), Some(patch_obj)) = (merged.as_object_mut(), patch.as_object()) {
        for (key, value) in patch_obj {
            if key == "id" || value.is_null() {
                continue;
            }
            obj.insert(key.clone(), value.clone());
        }
    }
    merged["id"] = Value::String(profile_id.to_string());

    let updated = ShellProfile::sanitize(&merged)
        .ok_or("invalid profile: 'command' must be a non-empty string")?;

    let detected = shell_profiles_detect();
    if let Some(owner) = name_conflict(
        &shell_config.profiles,
        &detected,
        Some(profile_id),
        updated.display_name(),
    ) {
        return Err(format!(
            "profile name '{}' is already used by profile '{owner}'",
            updated.display_name()
        ));
    }

    let profiles: Vec<ShellProfile> = shell_config
        .profiles
        .into_iter()
        .map(|p| {
            if p.id == profile_id {
                updated.clone()
            } else {
                p
            }
        })
        .collect();

    let config = persist_shell_config(&app, config, profiles, shell_config.default_profile)?;
    Ok((updated, config))
}

/// Delete a settings profile. Auto-detected shells are rejected; they are not
/// settings entries and deleting one from the UI is impossible too.
pub fn profile_delete(
    app: AppHandle,
    profile_id: &str,
) -> Result<(ShellProfile, ShellConfig), String> {
    let state = app.state::<SettingsState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|e| format!("settings lock poisoned: {e}"))?;

    let (config, shell_config) = read_shell_config(&app)?;

    let removed = match existing_user_profile(&shell_config.profiles, profile_id) {
        Some(profile) => profile.clone(),
        None => {
            if shell_profiles_detect().iter().any(|p| p.id == profile_id) {
                return Err(auto_detected_error(profile_id));
            }
            return Err(format!("profile not found: {profile_id}"));
        }
    };

    let profiles: Vec<ShellProfile> = shell_config
        .profiles
        .into_iter()
        .filter(|p| p.id != profile_id)
        .collect();
    let default_profile = if shell_config.default_profile == profile_id {
        profiles.first().map(|p| p.id.clone()).unwrap_or_default()
    } else {
        shell_config.default_profile
    };

    let config = persist_shell_config(&app, config, profiles, default_profile)?;
    Ok((removed, config))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str) -> ShellProfile {
        ShellProfile {
            id: id.to_string(),
            name: name.to_string(),
            command: "bash".to_string(),
            args: String::new(),
            theme_id: String::new(),
        }
    }

    #[test]
    fn name_conflict_skips_the_profile_being_updated() {
        let profiles = vec![profile("work", "Work"), profile("home", "Home")];

        assert_eq!(name_conflict(&profiles, &[], Some("home"), "home"), None);
        assert_eq!(
            name_conflict(&profiles, &[], Some("home"), "WORK"),
            Some("work".to_string())
        );
    }

    #[test]
    fn empty_names_fall_back_to_the_id_for_conflict_checks() {
        let profiles = vec![profile("work", "")];

        // "work" displays as "work", so another visible profile cannot be
        // called "work" even though the stored name is empty.
        assert_eq!(
            name_conflict(&profiles, &[], None, "Work"),
            Some("work".to_string())
        );
    }

    #[test]
    fn auto_detected_profiles_participate_in_name_conflicts() {
        let detected = vec![profile("bash", "Bash")];

        assert_eq!(
            name_conflict(&[], &detected, None, "bash"),
            Some("bash".to_string())
        );
    }

    #[test]
    fn settings_entry_shadows_detected_profile() {
        let profiles = vec![profile("bash", "My Bash")];
        let detected = vec![profile("bash", "Bash"), profile("zsh", "Zsh")];

        let visible: Vec<&str> = visible_profiles(&profiles, &detected)
            .into_iter()
            .map(|p| p.id.as_str())
            .collect();

        // The auto-detected "bash" is shadowed by the settings entry, but the
        // unshadowed "zsh" remains visible.
        assert_eq!(visible, vec!["bash", "zsh"]);
    }
}
