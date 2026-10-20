// HarnessMap desktop companion — Tauri v2 shell.
//
// The window loads a small bundled widget (../web/index.html) that runs at the app
// origin, so Tauri IPC and window dragging always work; the widget talks to the local
// map server over localhost (the server allows the app origin + sends CORS headers).
// The native side stays thin: a tray icon, an always-on-top frameless transparent
// window, and a few window commands (drag, reset). Minimize is handled in the web layer.

use std::fs;
use std::path::PathBuf;
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

/// The ChatGPT desktop app retains the codex:// scheme for local chats:
/// https://learn.chatgpt.com/docs/reference/commands#deep-links
/// Accept only a technical UUID, never an arbitrary URL, command, or opaque MCP correlation ID.
fn desktop_session_url(thread_id: &str) -> Result<String, String> {
    if thread_id.len() != 36 || !thread_id.bytes().enumerate().all(|(i, b)| {
        if matches!(i, 8 | 13 | 18 | 23) { b == b'-' } else { b.is_ascii_hexdigit() }
    }) {
        return Err("invalid local desktop thread ID".to_string());
    }
    Ok(format!("codex://threads/{thread_id}"))
}

#[tauri::command]
fn open_desktop_session(app: tauri::AppHandle, thread_id: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let url = desktop_session_url(&thread_id)?;
    // The user clicked the companion; allow the protocol handler to foreground its own window.
    allow_foreground();
    app.shell().open(url, None).map_err(|error| error.to_string())
}

/// M507 (Mark): a Claude Code session's page on claude.ai (Remote Control). The id comes from the session itself
/// (CLAUDE_CODE_BRIDGE_SESSION_ID, documented for hook subprocesses) and is validated again here: only `session_<base32-ish>`,
/// never an arbitrary URL. The page shows the same running session in the browser.
fn claude_session_url(web_id: &str) -> Result<String, String> {
    let ok = web_id.len() >= 18 && web_id.len() <= 48 && web_id.starts_with("session_")
        && web_id["session_".len()..].bytes().all(|b| b.is_ascii_alphanumeric());
    if !ok { return Err("invalid claude.ai session id".to_string()); }
    Ok(format!("https://claude.ai/code/{web_id}"))
}

#[tauri::command]
fn open_claude_session(app: tauri::AppHandle, web_id: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let url = claude_session_url(&web_id)?;
    allow_foreground(); // the person clicked; let the browser come forward
    app.shell().open(url, None).map_err(|error| error.to_string())
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

// ---- M502 (Mark, 2026-10-19): the companion as the map's status light and power button ----
// The hooks fail silently when the server is down (by design: a dead map must never break a session), and only an attached
// session's start hook revives it. So a server that died mid-day leaves every session unrecorded with no sign anywhere.
// The companion is the one piece that can see it. It shows "the map is off" loudly and starts the server on a CLICK, or
// once at its own launch when the setting says so. It never starts the server on its own after launch: "stop the map"
// must mean stopped. (Honest-result rule, M401: say what happened, never claim a start that did not.)

fn hm_home() -> PathBuf {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    std::path::Path::new(&home).join(".harnessmap")
}

/// What the server wrote about itself on its last start (server.json beside the port file): where its code lives and
/// which bun ran it. A fresh Codex install that never started has none; fall back to ~/.harnessmap/app and a bun on PATH.
fn server_info() -> (Option<PathBuf>, Option<PathBuf>) {
    let p = hm_home().join("server.json");
    let v: Option<serde_json::Value> = fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str(&s).ok());
    let app = v.as_ref().and_then(|j| j.get("appRoot")).and_then(|x| x.as_str()).map(PathBuf::from).filter(|d| d.join("hooks").join("start-server.ts").exists());
    let bun = v.as_ref().and_then(|j| j.get("bun")).and_then(|x| x.as_str()).map(PathBuf::from).filter(|b| b.exists());
    (app, bun)
}

fn find_bun() -> Option<PathBuf> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let exe = if cfg!(windows) { "bun.exe" } else { "bun" };
    let candidates = [std::path::Path::new(&home).join(".bun").join("bin").join(exe)];
    for c in candidates.iter() { if c.exists() { return Some(c.clone()); } }
    // PATH as the GUI app sees it (may carry no bun at all — M235)
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) { let c = dir.join(exe); if c.exists() { return Some(c); } }
    }
    None
}

/// Start the map server the way every hook, installer and the doctor do: `bun run hooks/start-server.ts` in the app folder.
/// That script spawns the server detached, waits for it to answer, and prints one honest line — which we return.
#[tauri::command]
fn start_server() -> Result<String, String> {
    use std::process::{Command, Stdio};
    let (app_from_json, bun_from_json) = server_info();
    let app = app_from_json.or_else(|| { let d = hm_home().join("app"); if d.join("hooks").join("start-server.ts").exists() { Some(d) } else { None } })
        .ok_or_else(|| "cannot find the map's code: ~/.harnessmap/server.json names no app folder and ~/.harnessmap/app has none — say “install map” or “update map” in a session".to_string())?;
    let bun = bun_from_json.or_else(find_bun)
        .ok_or_else(|| "cannot find bun (the map's runtime) — say “update map” in a session; it installs what is missing".to_string())?;
    let mut cmd = Command::new(&bun);
    cmd.arg("run").arg("hooks/start-server.ts").current_dir(&app)
        .env("HARNESSMAP_HOME", hm_home())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW: no console flash
    let out = cmd.output().map_err(|e| format!("could not run {}: {}", bun.display(), e))?;
    let line = String::from_utf8_lossy(&out.stdout).lines().last().map(|s| s.trim().to_string()).unwrap_or_default();
    if out.status.success() {
        Ok(if line.is_empty() { "map server up".to_string() } else { line })
    } else {
        let err = String::from_utf8_lossy(&out.stderr).lines().last().map(|s| s.trim().to_string()).unwrap_or_default();
        Err(if !line.is_empty() { line } else if !err.is_empty() { err } else { format!("the start script exited with {} — see ~/.harnessmap/server.log", out.status) })
    }
}

/// M503 (Mark, Windows): Windows lets only the foreground process change the foreground window. The map server runs in
/// the background, so its SetForegroundWindow was refused and the taskbar button merely flashed. The user's click makes
/// THIS window foreground, so right here, before asking the server, we grant the right to any process for this one
/// change (ASFW_ANY). Elsewhere there is nothing to grant.
#[tauri::command]
fn allow_foreground() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};
        return unsafe { AllowSetForegroundWindow(ASFW_ANY) } != 0;
    }
    #[allow(unreachable_code)]
    false
}

/// The companion's two settings, in ~/.harnessmap/companion.json. launchAtLogin is mirrored into the OS login item by the
/// autostart plugin; startMapOnOpen is read once at launch (below).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Settings { launch_at_login: bool, start_map_on_open: bool }
impl Default for Settings { fn default() -> Self { Settings { launch_at_login: false, start_map_on_open: true } } }

fn settings_path() -> PathBuf { hm_home().join("companion.json") }
fn read_settings() -> Settings {
    fs::read_to_string(settings_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn write_settings(s: &Settings) -> Result<(), String> {
    let _ = fs::create_dir_all(hm_home());
    fs::write(settings_path(), serde_json::to_string_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    use tauri_plugin_autostart::ManagerExt;
    let mut s = read_settings();
    // the OS login item is the truth for launchAtLogin (the user may have changed it in system settings)
    if let Ok(on) = app.autolaunch().is_enabled() { s.launch_at_login = on; }
    s
}

#[tauri::command]
fn set_settings(app: tauri::AppHandle, settings: Settings) -> Result<Settings, String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    let r = if settings.launch_at_login { al.enable() } else { al.disable() };
    r.map_err(|e| format!("could not change the login item: {e}"))?;
    write_settings(&settings)?;
    Ok(get_settings(app))
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

/// M510: "exit the companion" in the settings view. Same effect as the tray menu's Exit — the map server keeps running.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![open_map, open_desktop_session, open_claude_session, map_port_cmd, map_ready, start_drag, reset_position, show_companion_menu, api, start_server, get_settings, set_settings, allow_foreground, quit_app])
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

            // M502: start the map ONCE at launch when the setting says so and it is down. Off the UI thread — the start
            // script waits up to several seconds for the server to answer. Never again after launch.
            if read_settings().start_map_on_open && !map_ready() {
                std::thread::spawn(|| { let _ = start_server(); });
            }

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

    #[test]
    fn claude_session_links_accept_only_a_session_id() {
        assert_eq!(claude_session_url("session_01KrDXwmPDvypgLaGgRUH4dW").unwrap(), "https://claude.ai/code/session_01KrDXwmPDvypgLaGgRUH4dW");
        for bad in ["", "session_", "session_01K?x=1", "https://claude.ai/code/session_01K", "session_01K/../x", "01KrDXwmPDvypgLaGgRUH4dW"] {
            assert!(claude_session_url(bad).is_err(), "accepted {bad}");
        }
    }

    #[test]
    fn desktop_links_address_only_the_requested_local_thread() {
        let id = "01234567-89ab-7cde-8fab-0123456789ab";
        assert_eq!(desktop_session_url(id).unwrap(), format!("codex://threads/{id}"));
        assert!(desktop_session_url(&id.to_uppercase()).is_ok());
    }

    #[test]
    fn desktop_links_reject_routes_queries_commands_and_opaque_ids() {
        for id in ["", "new", "session-correlation-id", "codex://settings", "../settings",
            "01234567-89ab-7cde-8fab-0123456789ab?prompt=hello",
            "01234567-89ab-7cde-8fab-0123456789ab/extra", "$(whoami)",
            "01234567-89ab-7cde-8fab-0123456789ag", "0123456789ab7cde8fab0123456789ab"] {
            assert!(desktop_session_url(id).is_err(), "accepted {id}");
        }
    }

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
