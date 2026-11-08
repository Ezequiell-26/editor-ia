//! Ciclo de vida del render: validación, plan, spawn, registro y lanzamiento
//! del worker. La lógica es la misma que tenía `commands::render`; los
//! procesos, eventos, filesystem y diálogos viven detrás de ports.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::Value;

use crate::media::resolve_inside_root;
use crate::ports::media::MediaTools;
use crate::ports::projects::{ProjectDocuments, ProjectSession};
use crate::ports::render::{
    RenderDialogs, RenderEncoder, RenderEvents, RenderFiles, RenderLaunch, RenderLauncher,
    RenderRuntime,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{build_plan_range, expand_compounds, parse_profile, BuildPlanInput};
use crate::render::lifecycle::{safe_name, RenderProgressEvent, RenderStarted};
use crate::render::motion::{build_motion_ass, has_visible_graphic_clips, MotionAssInput};

/// Dependencias del ciclo de vida del render.
pub struct RenderDeps<'a> {
    pub session: &'a dyn ProjectSession,
    pub documents: &'a dyn ProjectDocuments,
    pub tools: &'a dyn MediaTools,
    pub runtime: &'a dyn RenderRuntime,
    pub events: &'a dyn RenderEvents,
    pub files: &'a dyn RenderFiles,
    pub dialogs: &'a dyn RenderDialogs,
    pub encoder: &'a dyn RenderEncoder,
    pub launcher: &'a dyn RenderLauncher,
    pub cache_dir: PathBuf,
}

/// El destino final no puede ser el proyecto, un medio del proyecto ni un
/// archivo dentro del temporal del render. FFmpeg escribe al temporal y sólo
/// un archivo verificado se publica.
pub fn ensure_output_is_safe(
    project: &Value,
    project_path: &Path,
    root: &Path,
    output: &Path,
    temp_dir: &Path,
    files: &dyn RenderFiles,
) -> Result<(), ProjectError> {
    let Some(output) = files.canonical(output) else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la carpeta de destino del render no existe",
        ));
    };
    let temp = files
        .canonical(temp_dir)
        .unwrap_or_else(|| temp_dir.to_path_buf());
    if output.starts_with(&temp) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo de salida no puede quedar dentro de la carpeta temporal del render",
        ));
    }
    let project_path = files
        .canonical(project_path)
        .unwrap_or_else(|| project_path.to_path_buf());
    if output == project_path {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo de salida no puede ser el archivo del proyecto",
        ));
    }
    for asset in project["assets"].as_array().cloned().unwrap_or_default() {
        let Some(relative) = asset["source"]["path"].as_str() else {
            continue;
        };
        if let Ok(asset_path) = resolve_inside_root(root, relative) {
            if output == asset_path {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el archivo de salida no puede sobrescribir un medio del proyecto",
                ));
            }
        }
    }
    Ok(())
}

/// `start_render` / `start_render_to`: valida, arma el plan, lanza el
/// worker y devuelve el `job_id`. `Ok(None)` = el usuario canceló el diálogo.
#[allow(clippy::too_many_arguments)]
pub fn start_render(
    deps: &RenderDeps<'_>,
    profile_id: Option<String>,
    include_captions: bool,
    motion_plans: Option<Value>,
    hardware_encoder: Option<String>,
    range: Option<(u64, u64)>,
    requested_output: Option<PathBuf>,
) -> Result<Option<RenderStarted>, ProjectError> {
    let session = deps.session.require()?;
    let Some(ffmpeg) = deps.tools.ffmpeg_path() else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no está disponible; elegí ffmpeg.exe en Ajustes → Herramientas",
        ));
    };
    let Some(ffprobe) = deps.tools.ffprobe_path() else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffprobe no está disponible; no se podría verificar el render",
        ));
    };
    if deps.runtime.is_busy() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderBusy,
            "ya hay un render en curso; esperá a que termine o cancelalo",
        ));
    }

    let opened = deps.documents.open(&session.path)?;
    let project = expand_compounds(&opened.project)?;
    let profiles = project["renderProfiles"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if profiles.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto no tiene perfiles de exportación",
        ));
    }
    let mut profile_json = match profile_id.as_deref() {
        Some(id) if !id.is_empty() => profiles
            .iter()
            .find(|profile| profile["id"].as_str() == Some(id))
            .cloned()
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el perfil de exportación elegido ya no existe",
                )
            })?,
        _ => profiles[0].clone(),
    };
    if let Some(encoder) = hardware_encoder.filter(|value| !value.is_empty()) {
        profile_json["hardwareEncoder"] = Value::String(encoder);
    }
    let profile = parse_profile(&profile_json)?;
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
                    "hay clips gráficos sin plan de motion; volvé a exportar desde el editor",
                ));
            }
            String::new()
        }
    };
    let project_name = project["name"].as_str().unwrap_or("proyecto");
    let suggested = format!(
        "{}-{}.mp4",
        safe_name(project_name),
        safe_name(&profile.name)
    );
    let final_output = match requested_output {
        Some(path) => {
            if path.exists() {
                return Err(ProjectError::message(
                    ProjectErrorCode::AlreadyExists,
                    "ya existe un archivo con ese nombre en la carpeta del lote; elegí otra carpeta",
                ));
            }
            path
        }
        None => {
            let Some(path) = deps.dialogs.pick_output(&session.root, &suggested)? else {
                return Ok(None);
            };
            path
        }
    };

    let job_id = uuid::Uuid::new_v4().to_string();
    let temp_dir = deps.files.temp_dir(&deps.cache_dir, &job_id)?;
    if let Err(error) = ensure_output_is_safe(
        &project,
        &session.path,
        &session.root,
        &final_output,
        &temp_dir,
        deps.files,
    ) {
        deps.files.remove_dir(&temp_dir);
        return Err(error);
    }
    let render_output = temp_dir.join("out.mp4");

    let plan = match build_plan_range(
        BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &session.root,
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
        },
        range,
    ) {
        Ok(plan) => plan,
        Err(error) => {
            deps.files.remove_dir(&temp_dir);
            return Err(error);
        }
    };
    let spawned = match deps.encoder.spawn(&ffmpeg, &plan) {
        Ok(spawned) => spawned,
        Err(error) => {
            deps.files.remove_dir(&temp_dir);
            return Err(error);
        }
    };

    let started = Instant::now();
    if let Err(error) = deps.runtime.register(&job_id, spawned.process.clone()) {
        deps.files.remove_dir(&temp_dir);
        return Err(error);
    }

    deps.events.progress(&RenderProgressEvent {
        job_id: job_id.clone(),
        percent: 0.0,
        processed_seconds: 0.0,
        total_seconds: plan.duration_seconds,
        phase: "preparando".to_owned(),
    });

    deps.launcher.launch(RenderLaunch {
        job_id: job_id.clone(),
        plan,
        ffprobe,
        final_output,
        temp_dir,
        root: session.root.clone(),
        started,
        process: spawned.process,
        stdout: spawned.stdout,
        stderr: spawned.stderr,
    });

    Ok(Some(RenderStarted {
        job_id,
        profile_name: profile.name,
    }))
}

/// `cancel_render(jobId)`.
pub fn cancel_render(deps: &RenderDeps<'_>, job_id: &str) -> Result<(), ProjectError> {
    deps.runtime.cancel(job_id)
}

/// `active_render()` — id del render en curso, si hay.
pub fn active_render(deps: &RenderDeps<'_>) -> Result<Option<String>, ProjectError> {
    Ok(deps.runtime.first_id())
}

/// `choose_export_directory()` — diálogo de carpeta dentro del proyecto.
pub fn choose_export_directory(deps: &RenderDeps<'_>) -> Result<Option<String>, ProjectError> {
    let session = deps.session.require()?;
    Ok(deps
        .dialogs
        .pick_directory(&session.root)?
        .map(|path| path.to_string_lossy().into_owned()))
}

/// `prune_render_cache()` — borra los `render-*` del cache.
pub fn prune_render_cache(deps: &RenderDeps<'_>) -> Result<u64, ProjectError> {
    Ok(deps.files.prune_cache(&deps.cache_dir))
}
