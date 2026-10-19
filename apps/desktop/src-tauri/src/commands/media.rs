//! Media ingestion and thumbnails. The dialog chooses files; the native side
//! copies, hashes and measures them, and the UI declares the rights afterwards.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::system::resolve_tools;
use crate::media::{import_file, resolve_inside_root, thumbnail_data_url, ImportOutcome};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[tauri::command]
pub async fn import_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    fps_num: u32,
    fps_den: u32,
) -> Result<Option<ImportOutcome>, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; sin medir el material no se puede importar",
        ));
    };

    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar video, imagen o audio")
        .add_filter(
            "Medios",
            &[
                "mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts", "jpg", "jpeg", "png",
                "webp", "bmp", "gif", "tif", "tiff", "avif", "wav", "mp3", "m4a", "aac", "flac",
                "ogg", "opus", "wma",
            ],
        )
        .blocking_pick_files()
    else {
        return Ok(None);
    };

    let mut outcome = ImportOutcome {
        assets: Vec::new(),
        warnings: Vec::new(),
    };
    for file in picked {
        if outcome.assets.len() >= crate::media::MAX_IMPORT_FILES {
            outcome.warnings.push(format!(
                "Se importaron solo los primeros {} archivos.",
                crate::media::MAX_IMPORT_FILES
            ));
            break;
        }
        let path = match file.into_path() {
            Ok(path) => path,
            Err(_) => {
                outcome
                    .warnings
                    .push("Se salteó una selección que no era una ruta local.".to_owned());
                continue;
            }
        };
        match import_file(
            &session.root,
            &path,
            &ffprobe,
            fps_num.max(1),
            fps_den.max(1),
        ) {
            Ok(asset) => outcome.assets.push(asset),
            Err(error) => outcome.warnings.push(format!(
                "{}: {}",
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "archivo".to_owned()),
                error.message
            )),
        }
    }
    Ok(Some(outcome))
}

#[tauri::command]
pub async fn media_thumbnail(
    state: State<'_, AppState>,
    path: String,
    is_image: bool,
) -> Result<String, ProjectError> {
    let session = state.require_session()?;
    let source = resolve_inside_root(&session.root, &path)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para generar miniaturas",
        ));
    };

    let metadata = std::fs::metadata(&source).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el material ya no está en el proyecto",
        )
    })?;
    let cache_key = format!(
        "{}:{}:{}",
        source.to_string_lossy(),
        metadata.len(),
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    );
    if let Ok(cache) = state.thumbnails.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            return Ok(hit.clone());
        }
    }

    let data_url = thumbnail_data_url(&ffmpeg, &source, is_image)?;
    if let Ok(mut cache) = state.thumbnails.lock() {
        cache.insert(cache_key, data_url.clone());
    }
    Ok(data_url)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFileInfo {
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
}

/// Check that every asset still resolves inside the project root. The UI uses
/// this before rendering and shows a precise warning instead of a broken export.
#[tauri::command]
pub async fn check_asset_files(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<AssetFileInfo>, ProjectError> {
    let session = state.require_session()?;
    let mut out = Vec::new();
    for path in paths.into_iter().take(2_000) {
        match resolve_inside_root(&session.root, &path) {
            Ok(resolved) => {
                let bytes = std::fs::metadata(&resolved).map(|m| m.len()).unwrap_or(0);
                out.push(AssetFileInfo {
                    path,
                    exists: bytes > 0,
                    bytes,
                });
            }
            Err(_) => out.push(AssetFileInfo {
                path,
                exists: false,
                bytes: 0,
            }),
        }
    }
    Ok(out)
}

#[allow(dead_code)]
fn _assert_pathbuf_send(_: PathBuf) {}
