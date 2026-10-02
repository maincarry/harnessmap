// HarnessMap desktop companion — Tauri v2 shell.
//
// The window loads a small bundled widget (../web/index.html) that runs at the app
// origin, so Tauri IPC and window dragging always work; the widget talks to the local
// map server over localhost (the server allows the app origin + sends CORS headers).
// The native side stays thin: a tray icon, an always-on-top frameless transparent
// window, and a few window commands (drag, reset). Minimize is handled in the web layer.

use std::fs;
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// The map server's port: ~/.harnessmap/port (written by the server), else 8790.
fn map_port() -> u16 {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let p = std::path::Path::new(&home).join(".harnessmap").join("port");
    fs::read_to_string(p).ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(8790)
}

fn map_url() -> String { format!("http://127.0.0.1:{}/", map_port()) }

/// The map server's port, so the widget can build its localhost API + WebSocket URLs.
#[tauri::command]
fn map_port_cmd() -> u16 { map_port() }

/// Is the map server reachable? A local TCP check from Rust (no browser CORS), so the
/// widget can show "map not running" cleanly instead of a failed fetch.
#[tauri::command]
fn map_ready() -> bool {
    use std::net::TcpStream;
    use std::time::Duration;
    match format!("127.0.0.1:{}", map_port()).parse() {
        Ok(sa) => TcpStream::connect_timeout(&sa, Duration::from_millis(500)).is_ok(),
        Err(_) => false,
    }
}

/// Open the full map in the user's default browser. An optional `ask` carries a question
/// across so the browser's talk-to-map reopens with it (to review a proposal there).
#[tauri::command]
fn open_map(app: tauri::AppHandle, ask: Option<String>) {
    use tauri_plugin_shell::ShellExt;
    let url = match ask.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => format!("{}?ask={}", map_url(), urlencode(q)),
        None => map_url(),
    };
    let _ = app.shell().open(url, None);
}

/// Minimal percent-encoding for the ask query value (kept dependency-free).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Begin an OS window drag — the widget calls this on mousedown of a drag handle (the
/// pill or the panel header), so the frameless window can be moved anywhere.
#[tauri::command]
fn start_drag(window: tauri::WebviewWindow) { let _ = window.start_dragging(); }

/// Talk to the local map server FROM RUST, so the companion always reaches the map
/// regardless of the server's version. A browser fetch carries an Origin header the
/// server's loopback gate rejects on older builds; this native request carries none
/// (like curl), so any server version accepts it. HTTP/1.0 + Connection: close avoids
/// chunked transfer, so reading to EOF yields the whole body. Returns the response body.
#[tauri::command]
fn api(method: String, path: String, body: Option<String>) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;
    let port = map_port();
    let mut s = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(10)));
    let m = if method.is_empty() { "GET".to_string() } else { method.to_uppercase() };
    let b = body.unwrap_or_default();
    let p = if path.starts_with('/') { path } else { format!("/{}", path) };
    let req = format!(
        "{m} {p} HTTP/1.0\r\nHost: 127.0.0.1\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{b}",
        b.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut resp = Vec::new();
    s.read_to_end(&mut resp).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&resp);
    match text.find("\r\n\r\n") {
        Some(i) => Ok(text[i + 4..].to_string()),
        None => Ok(String::new()),
    }
}

/// Rest the window in the bottom-right of the primary screen (its home position).
fn place_bottom_right(win: &tauri::WebviewWindow) {
    if let Ok(Some(mon)) = win.primary_monitor() {
        let sz = mon.size();
        let mp = mon.position();
        let ws = win.outer_size().unwrap_or(tauri::PhysicalSize::new(320, 300));
        let margin = 24i32;
        let x = mp.x + sz.width as i32 - ws.width as i32 - margin;
        let y = mp.y + sz.height as i32 - ws.height as i32 - margin - 48;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

/// Bring the window back to its home position (the tray safety net, if it was dragged away).
#[tauri::command]
fn reset_position(window: tauri::WebviewWindow) {
    place_bottom_right(&window);
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("companion") {
        if w.is_visible().unwrap_or(false) { let _ = w.hide(); }
        else { let _ = w.show(); let _ = w.set_focus(); }
    }
}

// Keep the same native menu alive for the tray and the widget's context menu.
struct CompanionMenu(Menu<tauri::Wry>);

#[tauri::command]
fn show_companion_menu(window: tauri::WebviewWindow, menu: tauri::State<'_, CompanionMenu>) -> Result<(), String> {
    window.popup_menu(&menu.0).map_err(|error| error.to_string())
}

fn toggles_companion(event: &TrayIconEvent) -> bool {
    matches!(event, TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_map, map_port_cmd, map_ready, start_drag, reset_position, show_companion_menu, api])
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_map" => open_map(app.clone(), None),
            "toggle" => toggle_window(app),
            "reset" => {
                if let Some(w) = app.get_webview_window("companion") {
                    reset_position(w);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .setup(|app| {
            // The window loads the bundled widget (index.html, app origin). It asks Rust
            // for the port, then talks to the map server over localhost.
            let win = app.get_webview_window("companion").unwrap();

            // Rest in the bottom-right corner (not the OS default, dead centre).
            place_bottom_right(&win);
            let _ = win.show();

            // Tray icon + menu.
            let open = MenuItemBuilder::with_id("open_map", "Open map").build(app)?;
            let toggle = MenuItemBuilder::with_id("toggle", "Show / hide companion").build(app)?;
            let reset = MenuItemBuilder::with_id("reset", "Reset position").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Exit companion").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&toggle, &open, &reset, &quit]).build()?;
            app.manage(CompanionMenu(menu.clone()));

            let handle = app.handle().clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("HarnessMap — your live map")
                .menu(&menu)
                // Right-click owns the menu. Toggling/focusing the window on
                // either right-button event dismisses that menu on Windows.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event| {
                    if toggles_companion(&event) { toggle_window(&handle); }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the HarnessMap companion");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn click(button: MouseButton, button_state: MouseButtonState) -> TrayIconEvent {
        TrayIconEvent::Click {
            id: "companion".into(),
            position: tauri::PhysicalPosition::new(0.0, 0.0),
            rect: tauri::Rect::default(),
            button,
            button_state,
        }
    }

    #[test]
    fn a_left_click_toggles_once_on_release() {
        let events = [click(MouseButton::Left, MouseButtonState::Down), click(MouseButton::Left, MouseButtonState::Up)];
        assert_eq!(events.iter().filter(|event| toggles_companion(event)).count(), 1);
        assert!(!toggles_companion(&events[0]));
    }

    #[test]
    fn context_menu_and_middle_clicks_do_not_toggle() {
        for button in [MouseButton::Right, MouseButton::Middle] {
            for state in [MouseButtonState::Down, MouseButtonState::Up] {
                assert!(!toggles_companion(&click(button, state)));
            }
        }
    }

    #[test]
    fn hover_and_double_click_notifications_do_not_toggle() {
        let id = "companion".into();
        let position = tauri::PhysicalPosition::new(0.0, 0.0);
        let rect = tauri::Rect::default();
        assert!(!toggles_companion(&TrayIconEvent::Enter { id, position, rect }));
        assert!(!toggles_companion(&TrayIconEvent::DoubleClick {
            id: "companion".into(), position, rect, button: MouseButton::Left,
        }));
    }
}
