#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::Manager;
use vibe99_lib::commands::context_menu;
use vibe99_lib::commands::layout;
use vibe99_lib::commands::settings;
use vibe99_lib::commands::shell_profile;
use vibe99_lib::commands::terminal::{self, AppState};
use vibe99_lib::commands::wsl as wsl_cmd;
use vibe99_lib::pty::PtyManager;

/// Parse `--layout <id>` from the command-line arguments.
fn parse_layout_arg() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if args[i] == "--layout" && i + 1 < args.len() {
            return Some(args[i + 1].clone());
        }
    }
    None
}

fn main() {
    let layout_id_arg = parse_layout_arg();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            pty: Arc::new(PtyManager::new()),
        })
        .manage(settings::SettingsState {
            lock: std::sync::Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_destroy,
            terminal::get_cwd,
            settings::settings_load,
            settings::settings_save,
            layout::layouts_list,
            layout::layout_save,
            layout::layout_delete,
            layout::layout_rename,
            layout::layout_set_default,
            layout::layout_open_in_new_window,
            shell_profile::shell_profiles_list,
            shell_profile::shell_profile_set,
            shell_profile::shell_profile_add,
            shell_profile::shell_profile_remove,
            shell_profile::shell_profiles_detect,
            context_menu::show_context_menu,
            context_menu::emit_menu_action,
            wsl_cmd::wsl_status,
            wsl_cmd::wsl_convert_path,
            wsl_cmd::wsl_cwd,
        ])
        .setup(move |app| {
            if let Some(layout_id) = &layout_id_arg {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(mut url) = window.url() {
                        url.query_pairs_mut().append_pair("layoutId", layout_id);
                        let _ = window.navigate(url);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppState>();
                terminal::destroy_all_terminals(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
