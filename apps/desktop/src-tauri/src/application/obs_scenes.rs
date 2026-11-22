//! Escenas OBS: presets persistentes de fuentes y streaming.
//!
//! Una "escena" es una configuración con nombre de lo que `screen_record`
//! graba/streamea: target de captura (pantalla/ventana/región), webcam,
//! micrófono, URL RTMP, fps y encoder. Se guardan en
//! `<config_dir>/obs-scenes.json` y `obs_scene_start` aplica la escena
//! llamando directamente al motor de grabación — una sola fuente de verdad,
//! sin duplicar lógica de captura.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::media::cursor_overlay::CursorOverlaySpec;
use crate::media::webcam_chroma::WebcamChromaSpec;
use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsScene {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub fps: Option<u32>,
    /// desktop | window | region
    #[serde(default)]
    pub capture_target: Option<String>,
    #[serde(default)]
    pub window_title: Option<String>,
    #[serde(default)]
    pub region_x: Option<i32>,
    #[serde(default)]
    pub region_y: Option<i32>,
    #[serde(default)]
    pub region_width: Option<i32>,
    #[serde(default)]
    pub region_height: Option<i32>,
    #[serde(default)]
    pub webcam_device: Option<String>,
    #[serde(default)]
    pub audio_device: Option<String>,
    /// URL RTMP completa tal como la pegó el usuario. Es SOLO entrada IPC:
    /// `skip_serializing` garantiza que la clave de stream nunca se
    /// persista en obs-scenes.json — la clave va al llavero del sistema
    /// (AUD-096) y `stream_endpoint`/`stream_key_ref` son lo que queda.
    #[serde(default, skip_serializing)]
    pub stream_url: Option<String>,
    /// Endpoint RTMP sin la clave de stream (se persiste).
    #[serde(default)]
    pub stream_endpoint: Option<String>,
    /// Cuenta del llavero donde vive la stream key (sólo presencia =
    /// "hay clave guardada"; el secreto nunca está en este archivo).
    #[serde(default)]
    pub stream_key_ref: Option<String>,
    #[serde(default)]
    pub encoder: Option<String>,
    #[serde(default)]
    pub capture_screen: Option<bool>,
    /// Opciones opcionales: ausentes en escenas creadas por versiones anteriores.
    #[serde(default)]
    pub cursor_overlay: Option<CursorOverlaySpec>,
    #[serde(default)]
    pub webcam_chroma: Option<WebcamChromaSpec>,
}

pub fn scenes_path(config_dir: &Path) -> PathBuf {
    config_dir.join("obs-scenes.json")
}

/// Largo mínimo del último segmento de path para considerarlo clave de
/// stream (AUD-096): los endpoints RTMP suelen terminar en `/live`,
/// `/app`, `/live2` (cortos) y las claves reales son largas (YouTube ~24,
/// Twitch ~30). Por debajo del umbral la URL entera queda como endpoint.
pub const MIN_STREAM_KEY_LEN: usize = 8;

/// Separa `rtmp(s)://host/app[/...]/CLAVE` en (endpoint, clave). La clave
/// es el último segmento del path sólo si mide >= `MIN_STREAM_KEY_LEN`;
/// si no, la URL completa es el endpoint (stream sin clave o clave corta).
pub fn split_stream_url(url: &str) -> (String, Option<String>) {
    let trimmed = url.trim().trim_end_matches('/');
    let Some(slash) = trimmed.rfind('/') else {
        return (trimmed.to_owned(), None);
    };
    let endpoint = &trimmed[..slash];
    let key = &trimmed[slash + 1..];
    // El endpoint debe conservar scheme://host como mínimo — si el "/"
    // encontrado es el del "//" de "rtmp://host" no hay clave.
    if key.len() >= MIN_STREAM_KEY_LEN && endpoint.len() > "rtmp://".len() + 1 {
        (endpoint.to_owned(), Some(key.to_owned()))
    } else {
        (trimmed.to_owned(), None)
    }
}

/// Reconstruye la URL completa endpoint+clave para ffmpeg.
pub fn merge_stream_url(endpoint: &str, key: &str) -> String {
    format!("{}/{}", endpoint.trim_end_matches('/'), key)
}

/// Valida una URL RTMP(S) completa (con o sin clave) para grabación o
/// sesión de switching. Límite 2048 chars y scheme `rtmp://`/`rtmps://`.
pub fn validate_stream_url(url: &str) -> Result<(), ProjectError> {
    if !(url.starts_with("rtmp://") || url.starts_with("rtmps://")) || url.len() > 2048 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "streamUrl debe ser una URL rtmp:// o rtmps:// válida",
        ));
    }
    Ok(())
}

pub fn read_scenes(config_dir: &Path) -> Result<Vec<ObsScene>, ProjectError> {
    let path = scenes_path(config_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo leer obs-scenes.json: {e}"),
        )
    })?;
    serde_json::from_str(&text).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("obs-scenes.json corrupto: {e}"),
        )
    })
}

pub fn write_scenes(config_dir: &Path, scenes: &[ObsScene]) -> Result<(), ProjectError> {
    let path = scenes_path(config_dir);
    let text = serde_json::to_string_pretty(scenes).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo serializar escenas: {e}"),
        )
    })?;
    // AUD-097: tmp + sync + rename — un corte a mitad de escritura nunca
    // deja un obs-scenes.json truncado (antes era fs::write directo).
    let tmp = path.with_extension("json.tmp");
    let write_result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&tmp, &path)
    })();
    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar obs-scenes.json: {e}"),
        ));
    }
    Ok(())
}

pub fn validate_scene(scene: &ObsScene) -> Result<(), ProjectError> {
    if scene.name.trim().is_empty() || scene.name.len() > 120 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el nombre de la escena debe tener entre 1 y 120 caracteres",
        ));
    }
    if let Some(t) = scene.capture_target.as_deref() {
        if !matches!(t, "desktop" | "window" | "region") {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "captureTarget debe ser desktop, window o region",
            ));
        }
        if t == "window" && scene.window_title.as_deref().unwrap_or("").is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "una escena de ventana necesita windowTitle",
            ));
        }
        if t == "region"
            && (scene.region_width.unwrap_or(0) < 16 || scene.region_height.unwrap_or(0) < 16)
        {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "una escena de región necesita regionWidth/regionHeight >= 16",
            ));
        }
    }
    if let Some(e) = scene.encoder.as_deref() {
        if !matches!(e, "x264" | "nvenc" | "qsv" | "amf" | "mf") {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "encoder debe ser x264, nvenc, qsv, amf o mf",
            ));
        }
    }
    if let Some(chroma) = scene.webcam_chroma.as_ref() {
        chroma.validate()?;
        if !scene
            .webcam_device
            .as_deref()
            .is_some_and(|device| !device.trim().is_empty())
        {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "webcamChroma requiere webcamDevice",
            ));
        }
    }
    if let Some(cursor) = scene.cursor_overlay.as_ref() {
        cursor.validate()?;
        if scene.capture_screen == Some(false)
            || scene.capture_target.as_deref().unwrap_or("desktop") != "desktop"
        {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "cursorOverlay sólo aplica a captura de escritorio completa",
            ));
        }
    }
    Ok(())
}

pub fn list_obs_scenes(config_dir: &Path) -> Result<Vec<ObsScene>, ProjectError> {
    read_scenes(config_dir)
}

/// Crea o actualiza una escena (upsert por id; id vacío genera uno nuevo).
pub fn save_obs_scene(config_dir: &Path, scene: ObsScene) -> Result<ObsScene, ProjectError> {
    validate_scene(&scene)?;
    let mut scenes = read_scenes(config_dir)?;
    let id = if scene.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        scene.id.clone()
    };
    if let Some(existing) = scenes.iter_mut().find(|s| s.id == id) {
        *existing = ObsScene {
            id: id.clone(),
            ..scene
        };
    } else {
        scenes.push(ObsScene {
            id: id.clone(),
            ..scene
        });
    }
    write_scenes(config_dir, &scenes)?;
    Ok(scenes.into_iter().find(|s| s.id == id).unwrap())
}

pub fn delete_obs_scene(config_dir: &Path, id: &str) -> Result<bool, ProjectError> {
    let mut scenes = read_scenes(config_dir)?;
    let before = scenes.len();
    scenes.retain(|s| s.id != id);
    if scenes.len() == before {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "no existe una escena con ese id",
        ));
    }
    write_scenes(config_dir, &scenes)?;
    Ok(true)
}

/// Busca una escena por id dentro de una lista ya leída.
pub fn find_obs_scene(scenes: Vec<ObsScene>, id: &str) -> Result<ObsScene, ProjectError> {
    scenes
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::NotFound, "escena no encontrada"))
}

#[cfg(test)]
#[path = "obs_scenes.tests.rs"]
mod tests;
