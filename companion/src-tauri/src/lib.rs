// HarnessMap desktop companion — Tauri v2 shell.
//
// It hosts the map's own /widget page (served by the local map server), so the
// native side stays thin: a tray icon, an always-on-top frameless window, and a
// couple of commands. Almost all UI/logic lives in the web widget the server serves.
//
// NOT YET COMPILED (dev box has no Rust/GUI toolchain). Standard Tauri v2; expect a
// small fix-up on the first real build. See companion/README.md.

use std::fs;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

/// The map server's port: ~/.harnessmap/port (written by the server), else 8790.
fn map_port() -> u16 {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let p = std::path::Path::new(&home).join(".harnessmap").join("port");
    fs::read_to_string(p).ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(8790)
}

fn widget_url() -> String { format!("http://127.0.0.1:{}/widget", map_port()) }
fn map_url() -> String { format!("http://127.0.0.1:{}/", map_port()) }

/// The map server's port, for the bundled loader to build its URLs.
#[tauri::command]
fn map_port_cmd() -> u16 { map_port() }

/// Open the full map in the user's default browser.
#[tauri::command]
fn open_map(app: tauri::AppHandle) {
    use tauri_plugin_shell::ShellExt;
    let _ = app.shell().open(map_url(), None);
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_map, map_port_cmd])
        .setup(|app| {
            // The window loads the bundled loader (index.html), which asks Rust for the
            // port (map_port_cmd), waits until the map server is reachable, then redirects
            // itself to http://127.0.0.1:<port>/widget. If the server is down it shows a
            // "map not running" message and retries — so we never land on a dead-URL error.
            let win = app.get_webview_window("companion").unwrap();
            let _ = widget_url(); // (used by the loader via the port command)
            let _ = win.show();

            // Tray icon + menu.
            let open = MenuItemBuilder::with_id("open_map", "Open map").build(app)?;
            let toggle = MenuItemBuilder::with_id("toggle", "Show / hide companion").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&toggle, &open, &quit]).build()?;

            let handle = app.handle().clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("HarnessMap — your live map")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open_map" => open_map(app.clone()),
                    "toggle" => toggle_window(app),
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
