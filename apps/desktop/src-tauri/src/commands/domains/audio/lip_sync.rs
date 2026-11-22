//! Puente de sincronización labial local.
//!
//! La app no incluye un modelo de lip-sync (Wav2Lip/MuseTalk/SadTalker pesan
//! cientos de MB y tienen requisitos propios). Este comando conecta un motor
//! local externo por HTTP loopback: recibe video y audio del proyecto, le pide
//! el MP4 sincronizado, valida el archivo y lo publica. La muestra nunca sale
//! de la máquina.

use std::path::Path;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

// DTOs, validadores y naming: `application::lip_sync`.
pub use crate::application::lip_sync::*;

use crate::commands::system::resolve_tools;
use crate::media::{probe_file, resolve_inside_root, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

fn probe_video(ffprobe: &Path, path: &Path) -> Result<(u32, u32, f64), ProjectError> {
    let measure = probe_file(ffprobe, path, MediaKind::Video)?;
    Ok((
        measure.width.unwrap_or(0),
        measure.height.unwrap_or(0),
        measure.duration_seconds.unwrap_or(0.0),
    ))
}

fn probe_audio(ffprobe: &Path, path: &Path) -> Result<f64, ProjectError> {
    let measure = probe_file(ffprobe, path, MediaKind::Audio)?;
    Ok(measure.duration_seconds.unwrap_or(0.0))
}

/// Parámetros del lector capeado compartido (`commands::read_body_capped`)
/// con la redacción propia del motor de lip-sync.
const LIPSYNC_INTERRUPTED: &str = "la respuesta del motor de lip-sync se cortó";

async fn request_lipsync(
    endpoint: &str,
    video: &Path,
    audio: &Path,
    api_key: Option<&str>,
) -> Result<Vec<u8>, ProjectError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión con el motor de lip-sync",
            )
        })?;
    let body = json!({
        "video_path": video.to_string_lossy(),
        "audio_path": audio.to_string_lossy(),
        "output_format": "mp4",
    });
    let mut call = client
        .post(endpoint)
        .json(&body)
        .header("Accept", "video/mp4, application/octet-stream");
    if let Some(secret) = api_key.filter(|value| !value.trim().is_empty()) {
        call = call.bearer_auth(secret.trim());
    }
    let response = call.send().await.map_err(|error| {
        let detail = if error.is_timeout() {
            "el motor local no respondió en 30 minutos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el motor local; revisá que esté encendido en la URL indicada"
                .to_owned()
        } else {
            "la llamada al motor de lip-sync falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &detail)
    })?;
    let status = response.status();
    if !status.is_success() {
        // AUD-077: el cuerpo de error también se lee con tope — antes un
        // error HTTP podía reservar memoria por todo el cuerpo.
        let detail = crate::commands::read_body_capped(
            response,
            64 * 1024,
            ProjectErrorCode::InvalidProviderResponse,
            "el motor devolvió un error demasiado grande",
            LIPSYNC_INTERRUPTED,
        )
        .await
        .unwrap_or_default();
        let detail = String::from_utf8_lossy(&detail);
        let safe = detail.lines().next().unwrap_or("sin detalle");
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el motor rechazó el lip-sync (HTTP {}): {}",
                status.as_u16(),
                safe.chars().take(200).collect::<String>()
            ),
        ));
    }
    let bytes = crate::commands::read_body_capped(
        response,
        MAX_RESPONSE_BYTES,
        ProjectErrorCode::InvalidProviderResponse,
        "el video sincronizado supera los 200 MB; acortá el clip",
        LIPSYNC_INTERRUPTED,
    )
    .await?;
    if !is_mp4(&bytes) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el motor devolvió un archivo que no es MP4; revisá el adaptador local",
        ));
    }
    Ok(bytes)
}

/// Sincroniza los labios de un video del proyecto con un audio del proyecto
/// usando un motor local externo.
#[tauri::command]
pub async fn lip_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LipSyncRequest,
) -> Result<LipSyncResult, ProjectError> {
    let endpoint = loopback_endpoint(&request.engine_url)?;
    let session = state.require_session()?;
    let video = resolve_inside_root(&session.root, &request.video_path)?;
    let audio = resolve_inside_root(&session.root, &request.audio_path)?;
    if !video.is_file() || !audio.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video o el audio del lip-sync ya no están en el proyecto",
        ));
    }
    let output_dir = crate::application::fs::validate_user_write_path(&request.output_dir)?;
    if !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del lip-sync no existe",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe es necesario para validar el video y el audio del lip-sync",
        ));
    };
    // probe_video/probe_audio lanzan ffprobe: procesos bloqueantes que
    // no pueden correr en el runtime async (AUD-129).
    let ffprobe_for_probe = ffprobe.clone();
    let video_for_probe = video.clone();
    let audio_for_probe = audio.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (width, height, duration) = probe_video(&ffprobe_for_probe, &video_for_probe)?;
        if width == 0 || height == 0 || duration <= 0.0 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el video del lip-sync no tiene dimensiones o duración válidas",
            ));
        }
        validate_audio_duration(probe_audio(&ffprobe_for_probe, &audio_for_probe)?)
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la validación del lip-sync se interrumpió",
        )
    })??;
    let _ = app.emit(
        "lipsync-progress",
        json!({ "percent": 5.0, "stage": "Validando video y audio" }),
    );
    let _ = app.emit(
        "lipsync-progress",
        json!({ "percent": 35.0, "stage": "Generando la sincronización local" }),
    );
    let bytes = request_lipsync(&endpoint, &video, &audio, request.api_key.as_deref()).await?;
    // Escribir el video completo (puede ser GBs) + ffprobe de salida +
    // publicación: fuera del runtime async (AUD-129).
    let ffprobe_for_output = ffprobe.clone();
    let video_for_output = video.clone();
    let (final_path, published, width, height, duration) =
        tauri::async_runtime::spawn_blocking(move || -> Result<_, ProjectError> {
            let temp = output_dir.join(format!(".lipsync-{}.mp4", Uuid::new_v4()));
            std::fs::write(&temp, &bytes).map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("no se pudo guardar el lip-sync: {error}").as_str(),
                )
            })?;
            let (width, height, duration) = match probe_video(&ffprobe_for_output, &temp) {
                Ok(value) => value,
                Err(error) => {
                    let _ = std::fs::remove_file(&temp);
                    return Err(error);
                }
            };
            if let Err(error) = validate_output_probe(width, height, duration) {
                let _ = std::fs::remove_file(&temp);
                return Err(error);
            }
            let final_path = lipsync_output_path(&output_dir, &video_for_output);
            std::fs::rename(&temp, &final_path).map_err(|error| {
                let _ = std::fs::remove_file(&temp);
                ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("no se pudo publicar el lip-sync: {error}").as_str(),
                )
            })?;
            let published = std::fs::metadata(&final_path)
                .map(|metadata| metadata.len())
                .unwrap_or(bytes.len() as u64);
            Ok((final_path, published, width, height, duration))
        })
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "la publicación del lip-sync se interrumpió",
            )
        })??;
    let _ = app.emit(
        "lipsync-progress",
        json!({ "percent": 100.0, "stage": "Lip-sync listo" }),
    );
    Ok(LipSyncResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes: published,
        width,
        height,
        duration_seconds: duration,
        engine: request.engine.unwrap_or_else(|| "local".to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requiere el adaptador de lip-sync y un video/audio reales"]
    async fn local_engine_returns_mp4() {
        let url = std::env::var("LIPSYNC_TEST_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8765/lipsync".to_owned());
        let video = std::env::var("LIPSYNC_TEST_VIDEO")
            .expect("definí LIPSYNC_TEST_VIDEO con un video existente");
        let audio = std::env::var("LIPSYNC_TEST_AUDIO")
            .expect("definí LIPSYNC_TEST_AUDIO con un audio existente");
        let bytes = request_lipsync(&url, Path::new(&video), Path::new(&audio), None)
            .await
            .expect("el motor real debe responder un MP4");
        assert!(is_mp4(&bytes), "la respuesta debe ser un MP4");
        assert!(bytes.len() > 10_000, "el MP4 debe tener contenido real");
        eprintln!("lip-sync real: {} bytes", bytes.len());
    }
}
