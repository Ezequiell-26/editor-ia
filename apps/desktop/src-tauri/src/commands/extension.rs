//! Guided installation of the bundled browser extension.
//!
//! Chrome and Edge do not allow an app to silently install an unpacked
//! extension. Editor IA copies the extension to a stable local folder and
//! returns its path so the person can load it with "Load unpacked".

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    pub available: bool,
    pub prepared: bool,
    pub source_path: Option<String>,
    pub prepared_path: Option<String>,
    pub hint: Option<String>,
}

fn prepared_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("extension").join("editor-ia-downloader")
}

/// Development, resource and portable layouts are checked in order. A path is
/// only accepted when it contains the extension manifest.
fn extension_source(app: &AppHandle, config_dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("extension").join("editor-ia-downloader"));
        candidates.push(resource.join("extensions").join("editor-ia-downloader"));
        candidates.push(
            resource
                .join("_up_")
                .join("_up_")
                .join("_up_")
                .join("extensions")
                .join("editor-ia-downloader"),
        );
    }
    if let Ok(executable) = std::env::current_exe() {
        for ancestor in executable.ancestors().take(6) {
            candidates.push(ancestor.join("extensions").join("editor-ia-downloader"));
        }
    }
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current.join("extensions").join("editor-ia-downloader"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("extensions")
            .join("editor-ia-downloader"),
    );
    candidates.push(prepared_dir(config_dir));
    candidates
        .into_iter()
        .find(|path| path.join("manifest.json").is_file())
}

fn copy_dir(source: &Path, destination: &Path) -> Result<(), ProjectError> {
    fs::create_dir_all(destination).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "No se pudo crear la carpeta de la extensión.",
        )
    })?;
    for entry in fs::read_dir(source)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "No se pudo leer la extensión."))?
    {
        let entry = entry.map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "No se pudo leer un archivo de la extensión.",
            )
        })?;
        let source_path = entry.path();
        let target = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir(&source_path, &target)?;
        } else {
            fs::copy(&source_path, &target).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "No se pudo copiar un archivo de la extensión.",
                )
            })?;
        }
    }
    Ok(())
}

fn status(app: &AppHandle, config_dir: &Path) -> ExtensionStatus {
    let prepared = prepared_dir(config_dir);
    let prepared_ok = prepared.join("manifest.json").is_file();
    let source = extension_source(app, config_dir);
    ExtensionStatus {
        available: source.is_some() || prepared_ok,
        prepared: prepared_ok,
        source_path: source
            .as_ref()
            .filter(|path| **path != prepared)
            .map(|path| path.to_string_lossy().into_owned()),
        prepared_path: prepared_ok.then(|| prepared.to_string_lossy().into_owned()),
        hint: if prepared_ok {
            Some(
                "Cargala desde Chrome o Edge con Modo desarrollador → Cargar descomprimida."
                    .to_owned(),
            )
        } else if source.is_some() {
            Some("Prepará la extensión para copiarla a una carpeta estable.".to_owned())
        } else {
            Some("La carpeta de la extensión no está incluida en esta instalación.".to_owned())
        },
    }
}

#[tauri::command]
pub async fn extension_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExtensionStatus, ProjectError> {
    Ok(status(&app, &state.config_dir))
}

#[tauri::command]
pub async fn prepare_extension(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExtensionStatus, ProjectError> {
    let config_dir = state.config_dir.clone();
    let source = extension_source(&app, &config_dir).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "No se encontró la extensión en esta instalación.",
        )
    })?;
    let destination = prepared_dir(&config_dir);
    if source == destination {
        return Ok(status(&app, &config_dir));
    }
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "No se pudo actualizar la carpeta de la extensión.",
            )
        })?;
    }
    copy_dir(&source, &destination)?;
    Ok(status(&app, &config_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn copies_the_extension_tree() {
        let root = std::env::temp_dir().join(format!("editor-ia-ext-{}", Uuid::new_v4()));
        let source = root.join("source");
        let destination = root.join("prepared");
        fs::create_dir_all(source.join("icons")).unwrap();
        fs::write(source.join("manifest.json"), b"{}").unwrap();
        fs::write(source.join("icons").join("icon.png"), b"png").unwrap();
        copy_dir(&source, &destination).unwrap();
        assert!(destination.join("manifest.json").is_file());
        assert!(destination.join("icons").join("icon.png").is_file());
        let _ = fs::remove_dir_all(root);
    }
}
