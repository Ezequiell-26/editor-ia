//! Editor IA desktop library.
//!
//! The native boundary owns every privileged operation: project persistence,
//! media import, rendering, provider credentials and local narration. The React
//! screen never touches the filesystem or a shell; it invokes the allowlisted
//! commands registered here.

use tauri::Manager;

pub mod commands;
pub mod media;
pub mod projects;
pub mod render;
pub mod state;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = state::AppState::load(app.handle());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::create_project,
            commands::projects::open_project,
            commands::projects::open_project_at,
            commands::projects::adopt_project,
            commands::projects::save_project,
            commands::projects::save_project_as,
            commands::projects::close_project,
            commands::media::import_assets,
            commands::media::media_thumbnail,
            commands::media::check_asset_files,
            commands::system::system_info,
            commands::system::choose_tool,
            commands::system::reveal_output,
            commands::providers::get_provider,
            commands::providers::save_provider,
            commands::providers::clear_provider_key,
            commands::providers::generate_script,
            commands::narration::list_voices,
            commands::narration::synthesize_narration,
            commands::render::start_render,
            commands::render::cancel_render,
            commands::render::active_render,
            commands::render::prune_render_cache,
        ])
        .build(tauri::generate_context!())
        .expect("Editor IA no pudo iniciar la ventana nativa");

    // A render is a real child process. If the window closes mid-render, kill
    // every child and remove its temporary directory before the process exits;
    // otherwise FFmpeg would keep writing a file nobody is waiting for.
    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            app_handle.state::<state::AppState>().cancel_all_renders();
        }
    });
}
