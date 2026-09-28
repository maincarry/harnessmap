// HarnessMap desktop companion — Tauri v2 shell.
//
// The window loads a small bundled widget (../web/index.html) that runs at the app
// origin, so Tauri IPC and window dragging always work; the widget talks to the local
// map server over localhost (the server allows the app origin + sends CORS headers).
// The native side stays thin: a tray icon, an always-on-top frameless transparent
// window, and a few window commands (drag, tuck-to-edge, reset).

use std::fs;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

// Edge-tuck state (a mis-tuck can never lose the window: the tray "Reset position"
// item always brings it back to the bottom-right).
static TUCKED: AtomicBool = AtomicBool::new(false);
static SAVED_X: AtomicI32 = AtomicI32::new(i32::MIN);

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

/// Tuck the window off the right screen edge (leaving a thin tab), or restore it.
/// Returns the new state: true = tucked.
#[tauri::command]
fn tuck_toggle(window: tauri::WebviewWindow) -> bool {
    let cur = window.outer_position().ok();
    let size = window.outer_size().ok();
    if !TUCKED.load(Ordering::SeqCst) {
        if let (Some(p), Some(s)) = (cur, size) {
            SAVED_X.store(p.x, Ordering::SeqCst);
            let sliver = 40i32; // physical px of the window left visible at the edge (the tab)
            let _ = window.set_position(tauri::PhysicalPosition::new(p.x + s.width as i32 - sliver, p.y));
        }
        TUCKED.store(true, Ordering::SeqCst);
        true
    } else {
        let sx = SAVED_X.load(Ordering::SeqCst);
        if let Some(p) = cur {
            if sx != i32::MIN { let _ = window.set_position(tauri::PhysicalPosition::new(sx, p.y)); }
        }
        TUCKED.store(false, Ordering::SeqCst);
        false
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

/// Bring the window back to its home position (also the tray safety net).
#[tauri::command]
fn reset_position(window: tauri::WebviewWindow) {
    TUCKED.store(false, Ordering::SeqCst);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_map, map_port_cmd, map_ready, start_drag, tuck_toggle, reset_position])
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
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&toggle, &open, &reset, &quit]).build()?;

            let handle = app.handle().clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("HarnessMap — your live map")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open_map" => open_map(app.clone(), None),
                    "toggle" => toggle_window(app),
                    "reset" => {
                        if let Some(w) = app.get_webview_window("companion") {
                            TUCKED.store(false, Ordering::SeqCst);
                            place_bottom_right(&w);
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click { .. } = event { toggle_window(&handle); }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the HarnessMap companion");
}
