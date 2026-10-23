//! Puente de sincronización labial local.
//!
//! La app no incluye un modelo de lip-sync (Wav2Lip/MuseTalk/SadTalker pesan
//! cientos de MB y tienen requisitos propios). Este comando conecta un motor
//! local externo por HTTP loopback: recibe video y audio del proyecto, le pide
//! el MP4 sincronizado, valida el archivo y lo publica. La muestra nunca sale
//! de la máquina.

use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::media::{probe_file, resolve_inside_root, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_OUTPUT_SECONDS: f64 = 900.0;
const MAX_AUDIO_SECONDS: f64 = 900.0;
const MAX_RESPONSE_BYTES: usize = 200 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LipSyncRequest {
    pub video_path: String,
    pub audio_path: String,
    pub output_dir: String,
    /// Endpoint local completo, por ejemplo http://127.0.0.1:8000/lipsync
    pub engine_url: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LipSyncResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub engine: String,
}

fn loopback_endpoint(value: &str) -> Result<String, ProjectError> {
    let url = Url::parse(value.trim()).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor de lip-sync no es válida",
        )
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor no puede incluir usuario ni contraseña",
        ));
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor debe usar http o https",
        ));
    }
    if !matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1") | Some("[::1]")
    ) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el motor de lip-sync debe estar en loopback (localhost/127.0.0.1); no se envía el video a internet",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor no debe incluir query ni fragmento",
        ));
    }
    Ok(url.to_string())
}

pub(crate) fn is_mp4(bytes: &[u8]) -> bool {
    // Un MP4 contiene el box `ftyp` cerca del inicio; FFprobe hace la validación
    // definitiva después de recibirlo.
    bytes.len() >= 12 && bytes.windows(4).take(32).any(|window| window == b"ftyp")
}

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
        let detail = response.text().await.unwrap_or_default();
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
    let bytes = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el motor no devolvió un video legible",
        )
    })?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el video sincronizado supera los 200 MB; acortá el clip",
        ));
    }
    if !is_mp4(&bytes) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el motor devolvió un archivo que no es MP4; revisá el adaptador local",
        ));
    }
    Ok(bytes.to_vec())
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
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
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
    let (source_width, source_height, video_duration) = probe_video(&ffprobe, &video)?;
    if source_width == 0 || source_height == 0 || video_duration <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el video del lip-sync no tiene dimensiones o duración válidas",
        ));
    }
    let audio_duration = probe_audio(&ffprobe, &audio)?;
    if audio_duration <= 0.0 || audio_duration > MAX_AUDIO_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio del lip-sync debe durar entre 0,1 y 900 segundos",
        ));
    }
    let _ = app.emit(
        "lipsync-progress",
        json!({ "percent": 5.0, "stage": "Validando video y audio" }),
    );
    let _ = app.emit(
        "lipsync-progress",
        json!({ "percent": 35.0, "stage": "Generando la sincronización local" }),
    );
    let bytes = request_lipsync(&endpoint, &video, &audio, request.api_key.as_deref()).await?;
    let temp = output_dir.join(format!(".lipsync-{}.mp4", Uuid::new_v4()));
    std::fs::write(&temp, &bytes).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo guardar el lip-sync: {error}").as_str(),
        )
    })?;
    let (width, height, duration) = match probe_video(&ffprobe, &temp) {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
    };
    if width == 0 || height == 0 || duration <= 0.0 || duration > MAX_OUTPUT_SECONDS {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el motor devolvió un video sin dimensiones o duración válidas",
        ));
    }
    let stem = video
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let safe: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let base = safe.trim_matches('-');
    let base = if base.is_empty() { "video" } else { base };
    let mut final_path = output_dir.join(format!("{base}-lipsync.mp4"));
    let mut index = 2;
    while final_path.exists() {
        final_path = output_dir.join(format!("{base}-lipsync-{index}.mp4"));
        index += 1;
    }
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

    #[test]
    fn loopback_endpoint_is_enforced() {
        assert!(loopback_endpoint("http://127.0.0.1:8000/lipsync").is_ok());
        assert!(loopback_endpoint("http://localhost:8000/lipsync").is_ok());
        assert!(loopback_endpoint("https://example.com/lipsync").is_err());
        assert!(loopback_endpoint("http://user:pass@127.0.0.1:8000").is_err());
        assert!(loopback_endpoint("http://127.0.0.1:8000/lipsync?x=1").is_err());
    }

    #[test]
    fn mp4_signature_is_checked() {
        assert!(is_mp4(b"\x00\x00\x00\x20ftypisom"));
        assert!(is_mp4(b"\x00\x00\x00\x08free\x00\x00\x00\x20ftypisom"));
        assert!(!is_mp4(b"<html>no</html>"));
        assert!(!is_mp4(b"RIFF0000WAVE"));
    }

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
