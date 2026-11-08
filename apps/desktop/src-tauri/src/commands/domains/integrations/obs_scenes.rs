//! Escenas OBS: presets persistentes de fuentes y streaming.
//!
//! Una "escena" es una configuración con nombre de lo que `screen_record`
//! graba/streamea: target de captura (pantalla/ventana/región), webcam,
//! micrófono, URL RTMP, fps y encoder. Se guardan en
//! `<config_dir>/obs-scenes.json` y `obs_scene_start` aplica la escena
//! llamando directamente al motor de grabación — una sola fuente de verdad,
//! sin duplicar lógica de captura.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsScene {
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
    #[serde(default)]
    pub stream_url: Option<String>,
    #[serde(default)]
    pub encoder: Option<String>,
    #[serde(default)]
    pub capture_screen: Option<bool>,
}

fn scenes_path(state: &AppState) -> PathBuf {
    state.config_dir.join("obs-scenes.json")
}

fn read_scenes(state: &AppState) -> Result<Vec<ObsScene>, ProjectError> {
    let path = scenes_path(state);
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

fn write_scenes(state: &AppState, scenes: &[ObsScene]) -> Result<(), ProjectError> {
    let path = scenes_path(state);
    let text = serde_json::to_string_pretty(scenes).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo serializar escenas: {e}"),
        )
    })?;
    std::fs::write(&path, text).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar obs-scenes.json: {e}"),
        )
    })
}

fn validate_scene(scene: &ObsScene) -> Result<(), ProjectError> {
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
    Ok(())
}

#[tauri::command]
pub async fn obs_scene_list(state: State<'_, AppState>) -> Result<Vec<ObsScene>, ProjectError> {
    read_scenes(state.inner())
}

#[tauri::command]
pub async fn obs_scene_save(
    state: State<'_, AppState>,
    scene: ObsScene,
) -> Result<ObsScene, ProjectError> {
    validate_scene(&scene)?;
    let mut scenes = read_scenes(state.inner())?;
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
    write_scenes(state.inner(), &scenes)?;
    Ok(scenes.into_iter().find(|s| s.id == id).unwrap())
}

#[tauri::command]
pub async fn obs_scene_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, ProjectError> {
    let mut scenes = read_scenes(state.inner())?;
    let before = scenes.len();
    scenes.retain(|s| s.id != id);
    if scenes.len() == before {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "no existe una escena con ese id",
        ));
    }
    write_scenes(state.inner(), &scenes)?;
    Ok(true)
}

/// Aplica una escena guardada y arranca la grabación/streaming con sus
/// parámetros. Delega en `screen_record_start` (misma validación y motor).
#[tauri::command]
pub async fn obs_scene_start(
    state: State<'_, AppState>,
    id: String,
    output_dir: String,
) -> Result<crate::commands::screen_record::ScreenRecordStatus, ProjectError> {
    let scenes = read_scenes(state.inner())?;
    let scene = scenes
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::NotFound, "escena no encontrada"))?;
    crate::commands::screen_record::screen_record_start(
        state,
        output_dir,
        scene.fps,
        scene.webcam_device,
        scene.capture_screen,
        scene.capture_target,
        scene.window_title,
        scene.region_x,
        scene.region_y,
        scene.region_width,
        scene.region_height,
        scene.audio_device,
        scene.stream_url,
        scene.encoder,
    )
    .await
}

/// Preview de una escena guardada: captura UN frame con la misma
/// configuración de fuentes (pantalla/ventana/región + webcam PiP) y lo
/// devuelve como PNG en `<config_dir>/obs-previews/`. No graba ni
/// streamea nada — es el monitor de preview antes de empezar.
#[tauri::command]
pub async fn obs_scene_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::commands::screen_record::ScreenRecordPreview, ProjectError> {
    let scenes = read_scenes(state.inner())?;
    let scene = scenes
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::NotFound, "escena no encontrada"))?;
    crate::commands::screen_record::screen_record_snapshot(
        state,
        scene.fps,
        scene.webcam_device,
        scene.capture_screen,
        scene.capture_target,
        scene.window_title,
        scene.region_x,
        scene.region_y,
        scene.region_width,
        scene.region_height,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(target: Option<&str>) -> ObsScene {
        ObsScene {
            id: String::new(),
            name: "Test".into(),
            fps: Some(30),
            capture_target: target.map(str::to_owned),
            window_title: None,
            region_x: None,
            region_y: None,
            region_width: None,
            region_height: None,
            webcam_device: None,
            audio_device: None,
            stream_url: None,
            encoder: None,
            capture_screen: None,
        }
    }

    #[test]
    fn window_scene_requires_title() {
        assert!(validate_scene(&scene(Some("window"))).is_err());
        let mut s = scene(Some("window"));
        s.window_title = Some("Editor".into());
        assert!(validate_scene(&s).is_ok());
    }

    #[test]
    fn region_scene_requires_size() {
        assert!(validate_scene(&scene(Some("region"))).is_err());
        let mut s = scene(Some("region"));
        s.region_width = Some(640);
        s.region_height = Some(360);
        assert!(validate_scene(&s).is_ok());
    }

    #[test]
    fn rejects_bad_encoder_and_target() {
        let mut s = scene(None);
        s.encoder = Some("vp9".into());
        assert!(validate_scene(&s).is_err());
        assert!(validate_scene(&scene(Some("moon"))).is_err());
    }

    #[test]
    fn scene_serializes_camel_case() {
        let s = scene(Some("desktop"));
        let json = serde_json::to_value(&s).unwrap();
        assert!(json.get("captureTarget").is_some());
        assert!(json.get("window_title").is_none());
    }
}
