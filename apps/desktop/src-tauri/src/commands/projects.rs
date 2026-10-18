use std::path::PathBuf;

use crate::projects::service;
use crate::projects::ProjectDocument;

#[tauri::command]
pub fn create_project(path: String, name: String) -> Result<ProjectDocument, String> {
    service::create_project(&PathBuf::from(path), &name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectDocument, String> {
    service::open_project(&PathBuf::from(path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_project(path: String, project: ProjectDocument) -> Result<(), String> {
    service::save_project(&PathBuf::from(path), &project).map_err(|error| error.to_string())
}
