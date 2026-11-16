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
    // AUD-092: no se acepta `current_dir` como origen — una ruta que
    // depende del directorio de trabajo con el que se lanzó la app es un
    // candidato no confiable para el contenido que va a la extensión.
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

/// Copia el árbol de la extensión sin seguir enlaces (AUD-092): misma
/// política que `plugins::copy_dir` — `file_type` no sigue symlinks, así
/// que un enlace dentro del árbol aborta la copia en vez de incorporar
/// contenido de afuera.
fn copy_dir(source: &Path, destination: &Path) -> Result<(), ProjectError> {
    let read_error =
        || ProjectError::message(ProjectErrorCode::Io, "No se pudo leer la extensión.");
    let metadata = fs::symlink_metadata(source).map_err(|_| read_error())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "La extensión contiene un enlace simbólico.",
        ));
    }
    fs::create_dir_all(destination).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "No se pudo crear la carpeta de la extensión.",
        )
    })?;
    for entry in fs::read_dir(source).map_err(|_| read_error())? {
        let entry = entry.map_err(|_| read_error())?;
        let entry_type = entry.file_type().map_err(|_| read_error())?;
        if entry_type.is_symlink() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "La extensión contiene un enlace simbólico.",
            ));
        }
        let source_path = entry.path();
        let target = destination.join(entry.file_name());
        if entry_type.is_dir() {
            copy_dir(&source_path, &target)?;
        } else if entry_type.is_file() {
            fs::copy(&source_path, &target).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "No se pudo copiar un archivo de la extensión.",
                )
            })?;
        } else {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "La extensión contiene un archivo especial.",
            ));
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
    // AUD-093: actualización transaccional — se copia a un staging hermano
    // y sólo se publica cuando el árbol está completo y validado; si algo
    // falla la versión anterior queda intacta.
    let staging = destination.with_file_name("editor-ia-downloader.staging");
    let _ = fs::remove_dir_all(&staging);
    if let Err(error) = copy_dir(&source, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if !staging.join("manifest.json").is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "La extensión copiada no tiene manifest.json.",
        ));
    }
    publish_extension(&staging, &destination)?;
    Ok(status(&app, &config_dir))
}

/// Reemplaza `destination` por `staging` conservando la versión anterior
/// como backup restaurable (AUD-093). Si el swap falla, `destination`
/// queda como estaba.
fn publish_extension(staging: &Path, destination: &Path) -> Result<(), ProjectError> {
    let io_error = || {
        ProjectError::message(
            ProjectErrorCode::Io,
            "No se pudo actualizar la carpeta de la extensión.",
        )
    };
    let backup = destination.with_file_name("editor-ia-downloader.previous");
    let had_previous = destination.exists();
    if had_previous {
        let _ = fs::remove_dir_all(&backup);
        fs::rename(destination, &backup).map_err(|_| io_error())?;
    }
    match fs::rename(staging, destination) {
        Ok(()) => {
            if had_previous {
                let _ = fs::remove_dir_all(&backup);
            }
            Ok(())
        }
        Err(_) => {
            if had_previous {
                let _ = fs::rename(&backup, destination);
            }
            let _ = fs::remove_dir_all(staging);
            Err(io_error())
        }
    }
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

    #[test]
    fn copy_dir_rejects_symlinks() {
        let root = std::env::temp_dir().join(format!("editor-ia-ext-{}", Uuid::new_v4()));
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("manifest.json"), b"{}").unwrap();
        let outside = root.join("outside.txt");
        fs::write(&outside, b"secreto").unwrap();
        let link = source.join("linked.txt");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link).is_ok();
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(not(any(windows, unix)))]
        let linked = false;
        if !linked {
            // Sin privilegio de symlink el SO no deja crearlo: no hay nada
            // que probar en esta máquina.
            let _ = fs::remove_dir_all(&root);
            return;
        }
        let error = copy_dir(&source, &root.join("dest")).expect_err("debió rechazar el enlace");
        assert!(error.message.contains("enlace"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn publish_swaps_only_when_staging_is_complete() {
        let root = std::env::temp_dir().join(format!("editor-ia-ext-{}", Uuid::new_v4()));
        let destination = root.join("prepared").join("editor-ia-downloader");
        let staging = root.join("prepared").join("editor-ia-downloader.staging");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("manifest.json"), b"{\"v\":1}").unwrap();

        // Staging sin manifest: publish no debería llamarse, pero si se
        // invocara el swap mueve carpetas igual — el guard real está en
        // prepare_extension. Acá probamos el swap exitoso y la restauración.
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("manifest.json"), b"{\"v\":2}").unwrap();
        publish_extension(&staging, &destination).expect("swap");
        let current = fs::read_to_string(destination.join("manifest.json")).unwrap();
        assert!(current.contains("\"v\":2"));
        assert!(!root
            .join("prepared")
            .join("editor-ia-downloader.previous")
            .exists());

        // Swap con staging inexistente: el rename falla y el destino
        // anterior (v:2) se restaura desde el backup.
        let result = publish_extension(&staging, &destination);
        assert!(result.is_err());
        let restored = fs::read_to_string(destination.join("manifest.json")).unwrap();
        assert!(restored.contains("\"v\":2"));
        let _ = fs::remove_dir_all(&root);
    }
}
