//! Adaptadores IPC de los comandos `fs_*` (ADR-0001).
//!
//! La lógica — límites de tamaño, clasificación de tipos y reglas de rutas
//! protegidas — vive en `crate::application::fs`; aquí sólo se exponen los
//! `#[tauri::command]` con la firma pública que consume el frontend y el
//! MCP. Los tipos se re-exportan para no romper imports existentes.

pub use crate::application::fs::{
    FsDeleteResult, FsEntry, FsFileContent, FsListing, FsWriteResult,
};

use crate::projects::service::ProjectError;

/// Lista el contenido de una carpeta: primero las subcarpetas, después los
/// archivos, ordenados por nombre. No recursa: la IA baja nivel por nivel.
#[tauri::command]
pub fn fs_list(path: String) -> Result<FsListing, ProjectError> {
    crate::application::fs::fs_list(path)
}

/// Lee un archivo de texto hasta `FS_READ_MAX_BYTES`. Rechaza carpetas y
/// archivos que no se pueden abrir; nunca ejecuta ni interpreta el contenido.
#[tauri::command]
pub fn fs_read(path: String) -> Result<FsFileContent, ProjectError> {
    crate::application::fs::fs_read(path)
}

/// Escribe texto en un archivo creándolo si no existe (y sus carpetas
/// padre). Sirve para guiones, subtítulos, JSON, configs — lo que la IA
/// necesite dejar en disco.
#[tauri::command]
pub fn fs_write(path: String, content: String) -> Result<FsWriteResult, ProjectError> {
    crate::application::fs::fs_write(path, content)
}

/// Crea una carpeta (con padres si `recursive`, por defecto true).
#[tauri::command]
pub fn fs_mkdir(path: String, recursive: Option<bool>) -> Result<FsWriteResult, ProjectError> {
    crate::application::fs::fs_mkdir(path, recursive)
}

/// Borra un archivo, o una carpeta vacía; para carpetas con contenido hay
/// que pasar `recursive: true` explícitamente. Rechaza rutas protegidas.
#[tauri::command]
pub fn fs_delete(path: String, recursive: Option<bool>) -> Result<FsDeleteResult, ProjectError> {
    crate::application::fs::fs_delete(path, recursive)
}

/// Mueve o renombra un archivo/carpeta. El destino puede estar en otra
/// carpeta; si existe, falla (no se sobrescribe sin querer).
#[tauri::command]
pub fn fs_move(from: String, to: String) -> Result<FsWriteResult, ProjectError> {
    crate::application::fs::fs_move(from, to)
}
