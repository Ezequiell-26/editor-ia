//! Adaptadores IPC del análisis de contenido visual (`image_sense`).
//!
//! La medición fotométrica/de rostros vive en `crate::media::image_sense`
//! (dominio puro); aquí quedan la resolución de sesión/activos/modelo, la
//! extracción del cuadro representativo con FFmpeg y el despacho
//! `spawn_blocking` de los lotes.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::State;

use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_file};
use crate::commands::system::resolve_tools;
use crate::media::image_sense::{measure, representative_second, ImageContent};
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Extrae un cuadro representativo de un video con FFmpeg. Escribirlo a PNG
/// permite reutilizar exactamente la misma medición que se usa para imágenes.
fn sample_video_frame(
    ffmpeg: &Path,
    video: &Path,
    at_seconds: f64,
    output: &Path,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-v")
        .arg("error")
        .arg("-ss")
        .arg(format!("{at_seconds:.3}"))
        .arg("-i")
        .arg(video)
        .arg("-frames:v")
        .arg("1")
        .arg("-update")
        .arg("1")
        .arg("-y")
        .arg(output);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let result = command
        .output()
        .map_err(|error| format!("no se pudo iniciar FFmpeg: {error}"))?;
    if !result.status.success() {
        let reason = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "no se pudo extraer el cuadro: {}",
            reason.trim().chars().take(300).collect::<String>()
        ));
    }
    if !output.is_file() {
        return Err("el cuadro no se escribió en el disco".to_owned());
    }
    Ok(())
}

/// Ruta del modelo SeetaFace si está descargado, si no `None`.
fn face_model_path(state: &AppState) -> Option<PathBuf> {
    model_by_id("seeta-face")
        .filter(|spec| is_model_downloaded(state, spec))
        .and_then(|spec| spec.files.first().map(|file| model_file(state, spec, file)))
}

/// Analiza el contenido visual de varias imágenes del proyecto en una sola
/// llamada. Las imágenes que fallan se omiten del resultado en vez de abortar
/// el lote: el montaje sigue funcionando con las que sí se pudieron leer.
#[tauri::command]
pub async fn analyze_images(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> Result<Vec<ImageContent>, ProjectError> {
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }
    let session = state.require_session()?;
    let opened = service::open_project(&session.path)?;
    let assets = opened
        .project
        .get("assets")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let model_path = face_model_path(&state);

    let mut jobs: Vec<(String, PathBuf)> = Vec::new();
    for asset_id in &asset_ids {
        let Some(asset) = assets
            .iter()
            .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        else {
            continue;
        };
        if asset["kind"].as_str() != Some("image") {
            continue;
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let Ok(path) = resolve_inside_root(&session.root, relative) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        jobs.push((asset_id.clone(), path));
    }

    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let model = model_path;
    let measured = tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::with_capacity(jobs.len());
        for (asset_id, path) in jobs {
            if let Ok(content) = measure(&asset_id, &path, model.as_deref()) {
                out.push(content);
            }
        }
        out
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("el análisis de imágenes se interrumpió: {error}"),
        )
    })?;

    Ok(measured)
}

/// Mide el contenido visual de los materiales del proyecto, **incluidos videos**.
///
/// Es la forma en que el asistente puede *ver* qué hay en la timeline: para cada
/// material devuelve luz, color, textura, nitidez, orientación y rostros medidos
/// en el equipo. En imágenes mide el archivo; en videos extrae el cuadro del
/// punto medio con FFmpeg y lo mide igual. Nada se sube ni se modifica.
#[tauri::command]
pub async fn analyze_media_frames(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> Result<Vec<ImageContent>, ProjectError> {
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para mirar el contenido de los clips",
        ));
    };
    let opened = service::open_project(&session.path)?;
    let assets = opened
        .project
        .get("assets")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let face_model = face_model_path(&state);

    let mut jobs: Vec<(String, PathBuf, Option<f64>)> = Vec::new();
    for asset_id in &asset_ids {
        let Some(asset) = assets
            .iter()
            .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        else {
            continue;
        };
        let kind = asset["kind"].as_str().unwrap_or("");
        if kind != "image" && kind != "video" {
            continue;
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let Ok(path) = resolve_inside_root(&session.root, relative) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        let at_seconds = if kind == "video" {
            representative_second(asset)
        } else {
            None
        };
        jobs.push((asset_id.clone(), path, at_seconds));
    }

    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let ffmpeg_for_jobs = ffmpeg.clone();
    let measured = tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<ImageContent> = Vec::with_capacity(jobs.len());
        for (asset_id, path, at_seconds) in jobs {
            let content = match at_seconds {
                Some(at) => {
                    let sample = std::env::temp_dir()
                        .join(format!("editoria-frame-{}.png", uuid::Uuid::new_v4()));
                    if sample_video_frame(&ffmpeg_for_jobs, &path, at, &sample).is_err() {
                        continue;
                    }
                    let measured = measure(&asset_id, &sample, face_model.as_deref()).ok();
                    let _ = std::fs::remove_file(&sample);
                    measured.map(|mut content| {
                        content.sampled_at_seconds = Some((at * 1000.0).round() / 1000.0);
                        content
                    })
                }
                None => measure(&asset_id, &path, face_model.as_deref()).ok(),
            };
            if let Some(content) = content {
                out.push(content);
            }
        }
        out
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("el análisis del contenido se interrumpió: {error}"),
        )
    })?;

    Ok(measured)
}
