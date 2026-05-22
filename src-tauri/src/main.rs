#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::Manager;
use vibe99_lib::commands::context_menu;
use vibe99_lib::commands::hook;
use vibe99_lib::commands::hotkey::{self, HotkeyState};
use vibe99_lib::commands::layout;
use vibe99_lib::commands::settings;
use vibe99_lib::commands::shell_profile;
use vibe99_lib::commands::terminal::{self, AppState};
use vibe99_lib::commands::wsl as wsl_cmd;
use vibe99_lib::pty::PtyManager;
use tauri::Emitter;
use tauri_plugin_global_shortcut::ShortcutState;

/// Resolve layout id from `--layout <id>` CLI arg or `VIBE99_LAYOUT` env var.
fn resolve_layout_id() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if args[i] == "--layout" && i + 1 < args.len() {
            return Some(args[i + 1].clone());
        }
    }
    std::env::var("VIBE99_LAYOUT").ok()
}

fn main() {
    vibe99_lib::windows::log_redirection_guard_status();

    let layout_id_arg = resolve_layout_id();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let state = app.state::<HotkeyState>();
                        let guard = state.bindings.lock();
                        if let Ok(bindings) = guard {
                            if let Some(layout_id) = bindings.get(&shortcut.to_string()) {
                                let _ = app.emit(
                                    "hotkey:pressed",
                                    serde_json::json!({
                                        "shortcut": shortcut.to_string(),
                                        "layoutId": layout_id,
                                    }),
                                );
                            }
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            pty: Arc::new(PtyManager::new()),
        })
        .manage(settings::SettingsState {
            lock: std::sync::Mutex::new(()),
        })
        .manage(HotkeyState::default())
        .invoke_handler(tauri::generate_handler![
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_destroy,
            terminal::get_cwd,
            settings::settings_load,
            settings::settings_save,
            settings::float_window_state_save,
            layout::layouts_list,
            layout::layout_save,
            layout::layout_delete,
            layout::layout_rename,
            layout::layout_set_default,
            shell_profile::shell_profiles_list,
            shell_profile::shell_profile_set,
            shell_profile::shell_profile_add,
            shell_profile::shell_profile_remove,
            shell_profile::shell_profiles_detect,
            hook::hooks_list,
            hook::hook_add,
            hook::hook_remove,
            hook::hook_update,
            hook::hook_execute,
            hook::shell_quote,
            context_menu::show_context_menu,
            context_menu::emit_menu_action,
            wsl_cmd::wsl_status,
            wsl_cmd::wsl_redetect,
            wsl_cmd::wsl_convert_path,
            wsl_cmd::wsl_cwd,
            hotkey::hotkey_register,
            hotkey::hotkey_unregister,
            hotkey::hotkey_list,
            hotkey::hotkey_register_all,
        ])
        .setup(move |app| {
            if let Some(layout_id) = &layout_id_arg {
                if let Some(window) = app.get_webview_window("main") {
                    let escaped = layout_id.replace('\\', "\\\\").replace('\'', "\\'");
                    let _ = window.eval(&format!("window.__VIBE99_LAYOUT_ID = '{escaped}'"));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppState>();
                let label = window.label().to_string();
                terminal::destroy_terminals_for_window(&state, &label);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
