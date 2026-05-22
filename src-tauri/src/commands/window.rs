use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowFrameInsets {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Return the invisible native frame insets for the current window.
///
/// On Windows, `GetWindowRect` includes the invisible resize border while DWM's
/// extended frame bounds report the visible frame. Quake positioning needs the
/// delta so the visible content, not the outer rect, aligns to the monitor edge.
#[tauri::command]
pub fn window_frame_insets(
    app: tauri::AppHandle,
    window: tauri::Window,
    label: Option<String>,
) -> WindowFrameInsets {
    platform_window_frame_insets(&app, &window, label.as_deref()).unwrap_or(WindowFrameInsets {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    })
}

#[tauri::command]
pub fn window_set_square_corners(
    app: tauri::AppHandle,
    window: tauri::Window,
    label: Option<String>,
    square: bool,
) {
    platform_window_set_square_corners(&app, &window, label.as_deref(), square);
}

#[cfg(target_os = "windows")]
fn platform_window_frame_insets(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    label: Option<&str>,
) -> Option<WindowFrameInsets> {
    use std::mem::{size_of, zeroed};
    use tauri::Manager;
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = label
        .and_then(|label| app.get_webview_window(label))
        .and_then(|target| target.hwnd().ok())
        .or_else(|| window.hwnd().ok())?
        .0 as _;

    unsafe {
        let mut outer: RECT = zeroed();
        if GetWindowRect(hwnd, &mut outer) == 0 {
            return None;
        }

        let mut visible: RECT = zeroed();
        let result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut visible as *mut RECT as *mut _,
            size_of::<RECT>() as u32,
        );
        if result < 0 {
            return None;
        }

        Some(WindowFrameInsets {
            left: (visible.left - outer.left).max(0),
            top: (visible.top - outer.top).max(0),
            right: (outer.right - visible.right).max(0),
            bottom: (outer.bottom - visible.bottom).max(0),
        })
    }
}

#[cfg(target_os = "windows")]
fn platform_window_set_square_corners(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    label: Option<&str>,
    square: bool,
) {
    use std::mem::size_of;
    use tauri::Manager;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT, DWMWCP_DONOTROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    let Some(hwnd) = label
        .and_then(|label| app.get_webview_window(label))
        .and_then(|target| target.hwnd().ok())
        .or_else(|| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as _)
    else {
        return;
    };

    let preference: DWM_WINDOW_CORNER_PREFERENCE = if square {
        DWMWCP_DONOTROUND
    } else {
        DWMWCP_DEFAULT
    };

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const _,
            size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_window_frame_insets(
    _app: &tauri::AppHandle,
    _window: &tauri::Window,
    _label: Option<&str>,
) -> Option<WindowFrameInsets> {
    None
}

#[cfg(not(target_os = "windows"))]
fn platform_window_set_square_corners(
    _app: &tauri::AppHandle,
    _window: &tauri::Window,
    _label: Option<&str>,
    _square: bool,
) {
}
