use std::path::PathBuf;

use crate::projects::{
    create_project as create_project_service, open_project as open_project_service,
    save_project as save_project_service, ProjectDocument,
};

#[tauri::command]
pub fn create_project(path: String, name: String) -> Result<ProjectDocument, String> {
    create_project_service(&PathBuf::from(path), &name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectDocument, String> {
    open_project_service(&PathBuf::from(path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_project(path: String, project: ProjectDocument) -> Result<(), String> {
    save_project_service(&PathBuf::from(path), &project).map_err(|error| error.to_string())
}
