//! Batch variant writer.
//!
//! The content factory builds several project documents in memory. This
//! command mirrors their referenced media into one shared folder and writes
//! each `.editoria.json` atomically. It never opens a native dialog, so the
//! loop can generate N variants without stopping the user.
//!
//! La lógica de filesystem/JSON vive en `application::variants`; estos
//! comandos sólo resuelven sesión/perfil y devuelven los DTOs IPC.

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::application::variants::{
    self, CopiedMedia, VariantWritten,
};
use crate::commands::system::resolve_tools;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{self, build_plan, parse_profile, BuildPlanInput};
use crate::render::motion::{build_motion_ass, has_visible_graphic_clips, MotionAssInput};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantRendered {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn write_project_variant(
    state: State<'_, AppState>,
    directory: String,
    file_name: String,
    project: Value,
) -> Result<VariantWritten, ProjectError> {
    let session = state.require_session()?;
    variants::write_project_variant_file(&directory, &file_name, &project, &session.root)
}

#[tauri::command]
pub async fn render_project_variant(
    state: State<'_, AppState>,
    project_path: String,
    profile_id: String,
    output_path: String,
    include_captions: bool,
    motion_plans: Option<Value>,
) -> Result<VariantRendered, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para renderizar variantes",
        ));
    };
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible para verificar variantes",
        ));
    };
    let project_file = crate::application::fs::resolve_user_file_path(&project_path)?;
    if !project_file.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la variante no está en disco",
        ));
    }
    let root = project_file
        .parent()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "la variante no tiene una carpeta válida",
            )
        })?
        .to_path_buf();
    let opened = service::open_project(&project_file)?;
    let project = opened.project;
    let profiles = project["renderProfiles"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let profile_value = if profile_id.trim().is_empty() {
        profiles.first().cloned()
    } else {
        profiles
            .iter()
            .find(|profile| profile["id"].as_str() == Some(profile_id.trim()))
            .cloned()
    }
    .ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la variante no tiene el perfil de render solicitado",
        )
    })?;
    let mut profile = parse_profile(&profile_value)?;
    // Short social variants can legitimately compress below the conservative
    // delivery floor; keep a real anti-empty-render check.
    profile.min_output_bytes = profile.min_output_bytes.min(50_000);
    let project_width = project["video"]["width"].as_u64().unwrap_or(1920) as u32;
    let project_height = project["video"]["height"].as_u64().unwrap_or(1080) as u32;
    let project_fps = project["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as f64
        / project["video"]["frameRate"]["den"]
            .as_u64()
            .unwrap_or(1)
            .max(1) as f64;
    let motion_ass = match motion_plans {
        Some(plans) => build_motion_ass(MotionAssInput {
            project: &project,
            plans: &plans,
            render_width: profile.width,
            render_height: profile.height,
            project_width,
            project_height,
            project_fps,
        })?,
        None => {
            if has_visible_graphic_clips(&project) {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "la variante tiene clips gráficos sin plan de motion; volvé a generarla",
                ));
            }
            String::new()
        }
    };
    let mut final_output = crate::application::fs::validate_user_write_path(&output_path)?;
    if final_output.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la variante necesita una ruta de salida",
        ));
    }
    if !final_output
        .extension()
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        final_output.set_extension("mp4");
    }
    if final_output.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un MP4 con ese nombre; no se sobrescribió",
        ));
    }
    let parent = final_output.parent().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la salida de la variante no tiene carpeta",
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo preparar la carpeta de salida de la variante",
        )
    })?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let temp_dir = state.cache_dir.join(format!("variant-render-{job_id}"));
    std::fs::create_dir_all(&temp_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo preparar la carpeta temporal de la variante",
        )
    })?;
    let render_output = temp_dir.join("out.mp4");
    let plan = match build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &render_output,
        include_captions,
        temp_dir: &temp_dir,
        ffprobe: &ffprobe,
        motion_ass: if motion_ass.is_empty() {
            None
        } else {
            Some(motion_ass.as_str())
        },
    }) {
        Ok(plan) => plan,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    let ffmpeg_for_job = ffmpeg.clone();
    let ffprobe_for_job = ffprobe.clone();
    let rendered = tauri::async_runtime::spawn_blocking(move || {
        ffmpeg::execute_sync(&ffmpeg_for_job, &ffprobe_for_job, &plan, |_| {})
    })
    .await
    .map_err(|_| {
        let _ = std::fs::remove_dir_all(&temp_dir);
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el render de la variante se interrumpió",
        )
    })?;
    let verification = match rendered {
        Ok(verification) => verification,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    if final_output.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "el MP4 de la variante apareció durante el render; no se sobrescribió",
        ));
    }
    std::fs::copy(&render_output, &final_output).map_err(|_| {
        let _ = std::fs::remove_dir_all(&temp_dir);
        ProjectError::message(
            ProjectErrorCode::Io,
            "el render pasó la verificación pero no se pudo publicar el MP4 de la variante",
        )
    })?;
    let _ = std::fs::remove_dir_all(&temp_dir);
    Ok(VariantRendered {
        path: final_output.to_string_lossy().into_owned(),
        bytes: verification.output_bytes,
        duration_seconds: verification.duration_seconds,
        width: verification.width,
        height: verification.height,
    })
}

/// Copia material externo dentro de una carpeta de entrega.
///
/// La cola por carpeta trabaja con archivos que no pertenecen a ningún
/// proyecto. El render resuelve las rutas **dentro** de la raíz del proyecto,
/// así que primero se copian a `media/` y el proyecto apunta a la ruta relativa.
#[tauri::command]
pub fn copy_media_into(
    directory: String,
    paths: Vec<String>,
) -> Result<Vec<CopiedMedia>, ProjectError> {
    variants::copy_media_files(&directory, &paths)
}

/// Escribe un proyecto en una carpeta **sin** exigir una sesión abierta.
///
/// `write_project_variant` espeja assets desde la raíz de la sesión; para la
/// cola por carpeta el material ya está copiado al lado del proyecto, así que
/// sólo hace falta validar y escribir.
#[tauri::command]
pub fn write_project_file(
    directory: String,
    file_name: String,
    project: Value,
) -> Result<VariantWritten, ProjectError> {
    variants::write_project_document(&directory, &file_name, &project)
}
