//! Editor IA desktop library.
//!
//! The native boundary owns every privileged operation: project persistence,
//! media import, rendering, provider credentials and local narration. The React
//! screen never touches the filesystem or a shell; it invokes the allowlisted
//! commands registered here.

use tauri::{Emitter, Listener, Manager};

pub mod ai;
pub mod application;
pub mod commands;
pub mod infrastructure;
pub mod mcp;
pub mod media;
pub mod ports;
pub mod projects;
pub mod render;
pub mod state;
pub mod studio;

#[cfg_attr(test, allow(dead_code))]
static QUIT_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg_attr(test, allow(dead_code))]
static BACKGROUND_START: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
fn background_start_mode() -> bool {
    BACKGROUND_START.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(windows)]
#[cfg_attr(test, allow(dead_code))]
fn claim_single_instance() -> bool {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *mut c_void, initial: i32, name: *const u16) -> *mut c_void;
        fn GetLastError() -> u32;
    }
    static HANDLE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    let mut name: Vec<u16> = r"Local\OlyviaQueueAgent".encode_utf16().collect();
    name.push(0);
    let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
    if handle.is_null() {
        return true;
    }
    HANDLE.get_or_init(|| handle as usize);
    unsafe { GetLastError() != 183 }
}

#[cfg(not(windows))]
#[cfg_attr(test, allow(dead_code))]
fn claim_single_instance() -> bool {
    true
}

#[cfg(windows)]
#[cfg_attr(test, allow(dead_code))]
fn hide_splash_for_background(app: &tauri::App) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.hide();
    }
}

#[cfg(not(windows))]
#[cfg_attr(test, allow(dead_code))]
fn hide_splash_for_background(_app: &tauri::App) {}

#[cfg_attr(test, allow(dead_code))]
fn show_main_window(app: &tauri::AppHandle) {
    let _ = app.emit("app-show-requested", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(test, allow(dead_code))]
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Mostrar Olyvia", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir de Olyvia", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("olyvia-tray")
        .tooltip("Olyvia · estudio local")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
                app.state::<state::AppState>().cancel_all_renders();
                commands::downloader::cancel_active_download();
                commands::agent::remove_watchdog_silent(
                    &infrastructure::agent::SchtasksWatchdog::new(),
                );
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// Revelado de la ventana principal. Se llena en `setup` y lo disparan tres
/// caminos: la carga de la página principal, el evento `app-ready` del
/// frontend y un fallo total a los 12 s.
#[cfg_attr(test, allow(dead_code))]
static REVEAL: std::sync::OnceLock<std::sync::Arc<dyn Fn() + Send + Sync>> =
    std::sync::OnceLock::new();

/// Tiempo mínimo que el splash permanece en pantalla. La bienvenida es parte
/// de la identidad, pero no debe tapar una app que ya está lista: 0,9 s evita
/// el flash blanco sin castigar el arranque.
#[cfg_attr(test, allow(dead_code))]
const MIN_SPLASH_MS: u64 = 450;

#[cfg_attr(test, allow(dead_code))]
fn maybe_reveal_after_page_load(window_label: &str) {
    if window_label != "main" || BACKGROUND_START.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Some(reveal) = REVEAL.get() else {
        return;
    };
    // Margen corto para que React monte y pinte el primer frame.
    let reveal = std::sync::Arc::clone(reveal);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(450));
        reveal();
    });
}

/// La ventana principal arranca oculta y el splash la tapa. Cuando la página
/// principal termina de cargar (señal nativa) o el frontend avisa que montó
/// (`app-ready`), se muestra la principal y se cierra el splash. Un último
/// fallback a los 12 s evita dejar al usuario mirando una pantalla fija si
/// ninguna de las dos señales llega.
#[cfg_attr(test, allow(dead_code))]
fn reveal_after_ready(app: &tauri::AppHandle) {
    let started = std::time::Instant::now();
    let Some(splash) = app.get_webview_window("splash") else {
        // Sin splash (p. ej. desarrollo): la principal se muestra sola,
        // salvo que el proceso haya arrancado como agente de fondo.
        if !BACKGROUND_START.load(std::sync::atomic::Ordering::SeqCst) {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
            }
        }
        return;
    };
    let Some(main) = app.get_webview_window("main") else {
        return;
    };

    // reveal() sólo corre una vez, venga de la señal que venga, y nunca antes
    // de que el splash haya estado MIN_SPLASH_MS en pantalla.
    let done = std::sync::Arc::new(std::sync::OnceLock::new());
    let reveal = {
        let main = main.clone();
        let splash = splash.clone();
        let done = done.clone();
        move || {
            if done.set(()).is_ok() {
                let elapsed = started.elapsed().as_millis() as u64;
                if elapsed < MIN_SPLASH_MS {
                    std::thread::sleep(std::time::Duration::from_millis(MIN_SPLASH_MS - elapsed));
                }
                if BACKGROUND_START.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = main.hide();
                } else {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                let _ = splash.close();
            }
        }
    };
    let reveal: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(reveal);
    let _ = REVEAL.set(std::sync::Arc::clone(&reveal));

    // El frontend avisa que montó (llega antes si la app arranca rápido).
    let event_id = app.listen("app-ready", {
        let reveal = std::sync::Arc::clone(&reveal);
        move |_| reveal()
    });

    // Fallo total: mostrar igual a los 12 s.
    let app_owned = app.clone();
    let reveal_fallback = std::sync::Arc::clone(&reveal);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        reveal_fallback();
        app_owned.unlisten(event_id);
    });
}

/// En tests no se inicializa Tauri ni el plugin de diálogos: evita enlazar
/// Common-Controls v6 en el binario de pruebas, que no tiene manifiesto.
#[cfg(test)]
pub fn run() {}

/// Helper: emit a progress event to the splash window and app handle so it can
/// show real, progressive loading status instead of an abrupt jump.
#[cfg_attr(test, allow(dead_code))]
fn emit_splash_progress(app: &tauri::AppHandle, step: u32, total: u32, message: &str, pct: u32) {
    let payload = serde_json::json!({
        "step": step,
        "total": total,
        "message": message,
        "pct": pct,
    });
    let _ = app.emit("splash-progress", &payload);
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.emit("splash-progress", &payload);
    }
}

#[cfg(not(test))]
pub fn run() {
    let background = std::env::args().any(|arg| arg == "--background");
    BACKGROUND_START.store(background, std::sync::atomic::Ordering::SeqCst);
    if !claim_single_instance() {
        return;
    }
    let app = crate::commands::registry::register(
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_notification::init())
            .on_page_load(|window, _payload| {
                maybe_reveal_after_page_load(window.label());
            })
            .on_window_event(|window, event| {
                if window.label() != "main" {
                    return;
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if !QUIT_REQUESTED.load(std::sync::atomic::Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            })
            .setup(|app| {
                let handle = app.handle().clone();
                setup_tray(app)?;
                if BACKGROUND_START.load(std::sync::atomic::Ordering::SeqCst) {
                    hide_splash_for_background(app);
                }

                // Cargar estado central (sincrónico para dependencias)
                let state = state::AppState::load(app.handle());
                app.manage(state);

                if std::env::args().any(|arg| arg == "--test-notification") {
                    use tauri_plugin_notification::NotificationExt;
                    let result = app
                        .notification()
                        .builder()
                        .title("Olyvia")
                        .body("Notificación de prueba desde el descargador.")
                        .show();
                    let marker = std::env::temp_dir().join("olyvia-notification-test.txt");
                    let _ = std::fs::write(marker, if result.is_ok() { "ok" } else { "error" });
                }

                // Iniciar puente de descarga si está disponible
                if let Some(runtime) = commands::downloader_bridge::start(handle.clone()) {
                    if let Ok(mut slot) = app.state::<state::AppState>().downloader_bridge.lock() {
                        *slot = Some(runtime);
                    }
                }

                // Hilo de progreso del splash: avance realista y visible estilo DaVinci NLE
                // durante la ventana de arranque (MIN_SPLASH_MS = 4000ms)
                let splash_handle = handle.clone();
                std::thread::spawn(move || {
                    let steps: [(&str, u32, u64); 6] = [
                        ("Inicializando subsistemas del motor de video…", 15, 220),
                        (
                            "Detectando aceleración de hardware y decodificadores GPU…",
                            32,
                            520,
                        ),
                        (
                            "Cargando preferencias, atajos y configuración NLE…",
                            52,
                            560,
                        ),
                        (
                            "Iniciando puente de descarga y servicios en segundo plano…",
                            70,
                            560,
                        ),
                        (
                            "Comprobando catálogo de proyectos y medios locales…",
                            88,
                            560,
                        ),
                        ("Estudio de edición listo.", 100, 480),
                    ];

                    for (idx, (msg, pct, delay)) in steps.iter().enumerate() {
                        std::thread::sleep(std::time::Duration::from_millis(*delay));
                        emit_splash_progress(
                            &splash_handle,
                            (idx + 1) as u32,
                            steps.len() as u32,
                            msg,
                            *pct,
                        );
                    }
                });

                reveal_after_ready(&handle);

                // Hook de verificación: EDITORIA_OPEN_EMBED=1 abre el navegador
                // embebido al arrancar (testing manual/automatizado, no UI).
                if std::env::var("EDITORIA_OPEN_EMBED").is_ok() {
                    let embed_handle = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        let url = std::env::var("EDITORIA_OPEN_EMBED_URL").ok();
                        // Las ventanas WebView2 sólo se crean en el hilo principal.
                        let inner = embed_handle.clone();
                        let marker = std::env::temp_dir().join("olyvia-embed-test.txt");
                        let _ = embed_handle.run_on_main_thread(move || {
                            let result = commands::flow_embed::flow_embed_open(inner, url);
                            let _ = std::fs::write(&marker, format!("{result:?}"));
                        });
                    });
                }
                Ok(())
            }),
    )
    .build(tauri::generate_context!())
    .expect("Editor IA no pudo iniciar la ventana nativa");

    // A render is a real child process. If the window closes mid-render, kill
    // every child and remove its temporary directory before the process exits;
    // otherwise FFmpeg would keep writing a file nobody is waiting for.
    app.run(|app_handle, event| {
        if matches!(
            &event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            app_handle.state::<state::AppState>().cancel_all_renders();
            commands::downloader::cancel_active_download();
        }
    });
}
