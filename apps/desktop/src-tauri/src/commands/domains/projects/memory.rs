//! Local, user-scoped memory for the automatic director.
//!
//! The file lives in the app config directory, never in the project and never
//! on the network. It stores bounded style parameters plus a short run history
//! so the editor can calibrate itself without pretending to train a model.

use serde_json::Value;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MEMORY_FILE: &str = "director-memory.json";
const MAX_MEMORY_BYTES: usize = 2_000_000;

#[tauri::command]
pub async fn load_director_memory(
    state: State<'_, AppState>,
) -> Result<Option<Value>, ProjectError> {
    let path = state.config_dir.join(MEMORY_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let metadata = std::fs::metadata(&path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo leer la memoria del Director",
        )
    })?;
    if metadata.len() as usize > MAX_MEMORY_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::FileTooLarge,
            "la memoria del Director supera el límite local",
        ));
    }
    let text = std::fs::read_to_string(&path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo abrir la memoria del Director",
        )
    })?;
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidJson,
            "la memoria del Director está dañada; se ignoró",
        )
    })?;
    Ok(Some(value))
}

#[tauri::command]
pub async fn save_director_memory(
    state: State<'_, AppState>,
    memory: Value,
) -> Result<(), ProjectError> {
    let text = serde_json::to_string_pretty(&memory).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo serializar la memoria del Director",
        )
    })?;
    if text.len() > MAX_MEMORY_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::FileTooLarge,
            "la memoria del Director supera el límite local",
        ));
    }
    let path = state.config_dir.join(MEMORY_FILE);
    let temp = state
        .config_dir
        .join(format!(".{MEMORY_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp, text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo escribir la memoria del Director",
        )
    })?;
    std::fs::rename(&temp, &path).map_err(|_| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo publicar la memoria del Director",
        )
    })?;
    Ok(())
}
