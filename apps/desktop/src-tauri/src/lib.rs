mod commands;
mod projects;

use commands::{get_app_info, projects::{create_project, open_project, save_project}};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    operating_system: &'static str,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Editor IA",
        version: env!("CARGO_PKG_VERSION"),
        operating_system: std::env::consts::OS,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            create_project,
            open_project,
            save_project
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Editor IA desktop");
}
