//! Batch variant writer.
//!
//! The content factory builds several project documents in memory. This
//! command mirrors their referenced media into one shared folder and writes
//! each `.editoria.json` atomically. It never opens a native dialog, so the
//! loop can generate N variants without stopping the user.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{self, build_plan, parse_profile, BuildPlanInput};
use crate::render::motion::{build_motion_ass, has_visible_graphic_clips, MotionAssInput};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantWritten {
    pub path: String,
    pub bytes: u64,
    pub copied_assets: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantRendered {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
}

fn safe_stem(name: &str) -> String {
    let mut stem = String::new();
    for character in name.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            stem.push(character.to_ascii_lowercase());
        } else if character.is_whitespace() || matches!(character, '.' | '/' | '\\') {
            if !stem.ends_with('-') {
                stem.push('-');
            }
        }
    }
    let trimmed = stem.trim_matches('-').to_owned();
    if trimmed.is_empty() {
        "variante".to_owned()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn relative_asset_paths(project: &Value) -> Result<Vec<String>, ProjectError> {
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    if assets.len() > 10_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la variante declara demasiados assets",
        ));
    }
    let mut paths = Vec::new();
    for asset in &assets {
        let Some(relative) = asset["source"]["path"].as_str() else {
            continue;
        };
        if relative.contains("..") || Path::new(relative).is_absolute() {
            return Err(ProjectError::message(
                ProjectErrorCode::PathEscapesRoot,
                "un asset de la variante intenta salir de la carpeta del proyecto",
            ));
        }
        paths.push(relative.to_string());
    }
    for relative in crate::media::project_lut_paths(project)? {
        if !paths.iter().any(|path| path == &relative) {
            paths.push(relative);
        }
    }
    for relative in crate::media::project_proxy_paths(project)? {
        if !paths.iter().any(|path| path == &relative) {
            paths.push(relative);
        }
    }
    Ok(paths)
}

/// Copy only the missing media. Existing files must match the source size to
/// avoid silently mixing two different assets with the same relative path.
fn mirror_assets(project: &Value, old_root: &Path, new_root: &Path) -> Result<usize, ProjectError> {
    let old_root = old_root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta del proyecto original no está disponible",
        )
    })?;
    let mut copied = 0;
    for relative in relative_asset_paths(project)? {
        let source = resolve_inside_root(&old_root, &relative)?;
        if !source.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "un asset de la variante no está en disco",
            ));
        }
        let destination = new_root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        let Some(parent) = destination.parent() else {
            continue;
        };
        std::fs::create_dir_all(parent).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar la carpeta de medios de las variantes",
            )
        })?;
        let parent_canonical = parent.canonicalize().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "la carpeta de medios de las variantes no es accesible",
            )
        })?;
        if !parent_canonical.starts_with(new_root) {
            return Err(ProjectError::message(
                ProjectErrorCode::PathEscapesRoot,
                "la copia de medios intentaría salir de la carpeta de variantes",
            ));
        }
        if destination.exists() {
            let source_size = std::fs::metadata(&source)
                .map(|meta| meta.len())
                .unwrap_or(0);
            let destination_size = std::fs::metadata(&destination)
                .map(|meta| meta.len())
                .unwrap_or(0);
            if source_size != destination_size {
                return Err(ProjectError::message(
                    ProjectErrorCode::AlreadyExists,
                    "ya existe un medio distinto con el mismo nombre en la carpeta de variantes",
                ));
            }
            continue;
        }
        std::fs::copy(&source, &destination).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo copiar un medio a la carpeta de variantes",
            )
        })?;
        copied += 1;
    }
    Ok(copied)
}

#[tauri::command]
pub async fn write_project_variant(
    state: State<'_, AppState>,
    directory: String,
    file_name: String,
    project: Value,
) -> Result<VariantWritten, ProjectError> {
    let session = state.require_session()?;
    let directory = PathBuf::from(directory.trim());
    if directory.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta para las variantes",
        ));
    }
    if !directory.is_absolute() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la carpeta de variantes debe ser una ruta absoluta",
        ));
    }
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta de variantes",
        )
    })?;
    let new_root = directory.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la carpeta de variantes no es accesible",
        )
    })?;
    let mut name = safe_stem(&file_name);
    if name.ends_with(".editoria") {
        name.push_str(".json");
    } else if !name.ends_with(".json") {
        name.push_str(".editoria.json");
    }
    let target = new_root.join(&name);
    if target.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe una variante con ese nombre; no se sobrescribió",
        ));
    }
    let copied_assets = mirror_assets(&project, &session.root, &new_root)?;
    let saved = service::save_project(&target, &project)?;
    Ok(VariantWritten {
        path: saved.path,
        bytes: saved.bytes,
        copied_assets,
    })
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
    let project_file = PathBuf::from(project_path.trim());
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
    let mut final_output = PathBuf::from(output_path.trim());
    if final_output.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la variante necesita una ruta de salida",
        ));
    }
    if final_output
        .extension()
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
        != true
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
