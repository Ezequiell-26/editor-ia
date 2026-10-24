//! Render commands: start, cancel and report.
//!
//! The render runs in a worker thread with FFmpeg's progress stream wired to
//! Tauri events. A job is only reported as `completed` after FFprobe verifies
//! the file. Cancellation kills the child process and reports `cancelled`; it
//! never fabricates an output.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::system::resolve_tools;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{
    self, build_plan, parse_profile, sanitize_log, BuildPlanInput, RenderPlan,
};
use crate::render::motion::{build_motion_ass, has_visible_graphic_clips, MotionAssInput};
use crate::state::{AppState, RenderJob, Session};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderStarted {
    pub job_id: String,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgressEvent {
    pub job_id: String,
    pub percent: f64,
    pub processed_seconds: f64,
    pub total_seconds: f64,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderFinishedEvent {
    pub job_id: String,
    pub status: String,
    pub code: Option<String>,
    pub message: Option<String>,
    pub detail: Option<String>,
    pub output_path: Option<String>,
    pub output_bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub elapsed_ms: u64,
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('-');
    if cleaned.is_empty() {
        "export".to_owned()
    } else {
        cleaned.chars().take(80).collect()
    }
}

fn ensure_mp4(mut path: PathBuf) -> PathBuf {
    if path
        .extension()
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        path
    } else {
        path.set_extension("mp4");
        path
    }
}

fn pick_output(
    app: &AppHandle,
    root: &Path,
    suggested: &str,
) -> Result<Option<PathBuf>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Exportar video")
        .set_directory(root)
        .add_filter("Video MP4", &["mp4"])
        .set_file_name(suggested)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let completed = ensure_mp4(picked.clone());
    if completed != picked && completed.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ya existe un MP4 con el nombre completo que se agregó automáticamente; elegí otro nombre",
        ));
    }
    Ok(Some(completed))
}

fn canonical_output(path: &Path) -> Option<PathBuf> {
    if path.exists() {
        return path.canonicalize().ok();
    }
    let parent = path.parent()?.canonicalize().ok()?;
    Some(parent.join(path.file_name()?))
}

/// The final path is chosen by the user; it must not be the project file, a
/// media asset or a file inside the temporary render directory. FFmpeg still
/// writes to the temporary directory and only a verified file is published.
fn ensure_output_is_safe(
    project: &Value,
    session: &Session,
    output: &Path,
    temp_dir: &Path,
) -> Result<(), ProjectError> {
    let Some(output) = canonical_output(output) else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la carpeta de destino del render no existe",
        ));
    };
    let temp = temp_dir
        .canonicalize()
        .unwrap_or_else(|_| temp_dir.to_path_buf());
    if output.starts_with(&temp) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo de salida no puede quedar dentro de la carpeta temporal del render",
        ));
    }
    let project_path = session
        .path
        .canonicalize()
        .unwrap_or_else(|_| session.path.clone());
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
        if let Ok(asset_path) = crate::media::resolve_inside_root(&session.root, relative) {
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

fn publish_output(temporary: &Path, final_path: &Path) -> Result<(), ProjectError> {
    let parent = final_path.parent().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo de salida no tiene una carpeta de destino",
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo preparar la carpeta de salida",
        )
    })?;
    std::fs::copy(temporary, final_path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el render pasó la verificación pero no se pudo publicar el archivo final",
        )
    })?;
    Ok(())
}

fn emit_failed(
    app: &AppHandle,
    job_id: &str,
    started: Instant,
    error: ProjectError,
    detail: Option<String>,
) {
    let _ = app.emit(
        "render-finished",
        RenderFinishedEvent {
            job_id: job_id.to_owned(),
            status: "failed".to_owned(),
            code: Some(error.code.name().to_owned()),
            message: Some(error.message),
            detail,
            output_path: None,
            output_bytes: None,
            duration_seconds: None,
            width: None,
            height: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
    );
}

fn start_render_with_output(
    app: &AppHandle,
    state: &AppState,
    profile_id: Option<String>,
    include_captions: bool,
    motion_plans: Option<Value>,
    hardware_encoder: Option<String>,
    requested_output: Option<PathBuf>,
) -> Result<Option<RenderStarted>, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no está disponible; elegí ffmpeg.exe en Ajustes → Herramientas",
        ));
    };
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffprobe no está disponible; no se podría verificar el render",
        ));
    };

    {
        let jobs = state.render_jobs.lock().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "el estado de render no está disponible",
            )
        })?;
        if !jobs.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderBusy,
                "ya hay un render en curso; esperá a que termine o cancelalo",
            ));
        }
    }

    let opened = service::open_project(&session.path)?;
    let project = opened.project;
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
            let Some(path) = pick_output(app, &session.root, &suggested)? else {
                return Ok(None);
            };
            path
        }
    };

    let job_id = uuid::Uuid::new_v4().to_string();
    let temp_dir = state.cache_dir.join(format!("render-{}", job_id));
    std::fs::create_dir_all(&temp_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo preparar la carpeta temporal del render",
        )
    })?;
    if let Err(error) = ensure_output_is_safe(&project, &session, &final_output, &temp_dir) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(error);
    }
    let render_output = temp_dir.join("out.mp4");

    let plan = match build_plan(BuildPlanInput {
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
    }) {
        Ok(plan) => plan,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    let mut child = match ffmpeg::spawn(&ffmpeg, &plan) {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };

    let started = Instant::now();
    let cancelled = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let job = Arc::new(Mutex::new(RenderJob {
        child,
        cancelled: cancelled.clone(),
    }));
    {
        let mut jobs = state.render_jobs.lock().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "el estado de render no está disponible",
            )
        })?;
        jobs.insert(job_id.clone(), job.clone());
    }

    let _ = app.emit(
        "render-progress",
        RenderProgressEvent {
            job_id: job_id.clone(),
            percent: 0.0,
            processed_seconds: 0.0,
            total_seconds: plan.duration_seconds,
            phase: "preparando".to_owned(),
        },
    );

    let progress_app = app.clone();
    let progress_job = job_id.clone();
    let total_seconds = plan.duration_seconds;
    let progress_thread = stdout.map(|stdout| {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(progress) = ffmpeg::progress_from_line(&line, total_seconds) {
                    let _ = progress_app.emit(
                        "render-progress",
                        RenderProgressEvent {
                            job_id: progress_job.clone(),
                            percent: progress.percent,
                            processed_seconds: progress.processed_seconds,
                            total_seconds: progress.total_seconds,
                            phase: "renderizando".to_owned(),
                        },
                    );
                }
            }
        })
    });

    let log_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = log_buffer.clone();
    let stderr_thread = stderr.map(|mut stderr| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buffer: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 8_192];
            loop {
                match stderr.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        buffer.extend_from_slice(&chunk[..read]);
                        if buffer.len() > 65_536 {
                            let drain = buffer.len() - 65_536;
                            buffer.drain(..drain);
                        }
                    }
                    Err(_) => break,
                }
            }
            if let Ok(mut log) = stderr_buffer.lock() {
                *log = String::from_utf8_lossy(&buffer).into_owned();
            }
        })
    });

    let worker_app = app.clone();
    let worker_job_id = job_id.clone();
    let worker_root = session.root.clone();
    let worker_cache = state.cache_dir.clone();
    let worker_jobs = state.render_jobs.clone();
    let worker_cancelled = cancelled.clone();
    let worker_plan: RenderPlan = plan;
    let worker_output = final_output;
    let worker_ffprobe = ffprobe;
    std::thread::spawn(move || loop {
        let status = {
            let mut guard = match job.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };
            match guard.child.try_wait() {
                Ok(Some(status)) => Some(status),
                Ok(None) => None,
                Err(_) => None,
            }
        };
        if let Some(status) = status {
            if let Some(handle) = progress_thread {
                let _ = handle.join();
            }
            if let Some(handle) = stderr_thread {
                let _ = handle.join();
            }
            if let Ok(mut jobs) = worker_jobs.lock() {
                jobs.remove(&worker_job_id);
            }
            let log = log_buffer
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            let detail = sanitize_log(&log, &worker_root, 600);
            let temp_dir = worker_cache.join(format!("render-{}", worker_job_id));

            if worker_cancelled.load(Ordering::SeqCst) {
                let _ = std::fs::remove_dir_all(&temp_dir);
                let _ = worker_app.emit(
                    "render-finished",
                    RenderFinishedEvent {
                        job_id: worker_job_id,
                        status: "cancelled".to_owned(),
                        code: Some("RENDER_CANCELLED".to_owned()),
                        message: Some(
                            "el render se canceló; no se reporta ningún archivo".to_owned(),
                        ),
                        detail: None,
                        output_path: None,
                        output_bytes: None,
                        duration_seconds: None,
                        width: None,
                        height: None,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    },
                );
                return;
            }
            if !status.success() {
                let _ = std::fs::remove_dir_all(&temp_dir);
                let _ = worker_app.emit(
                    "render-finished",
                    RenderFinishedEvent {
                        job_id: worker_job_id,
                        status: "failed".to_owned(),
                        code: Some("RENDER_FAILED".to_owned()),
                        message: Some("ffmpeg no pudo completar el render".to_owned()),
                        detail: (!detail.is_empty()).then_some(detail),
                        output_path: None,
                        output_bytes: None,
                        duration_seconds: None,
                        width: None,
                        height: None,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    },
                );
                return;
            }
            let _ = worker_app.emit(
                "render-progress",
                RenderProgressEvent {
                    job_id: worker_job_id.clone(),
                    percent: 99.0,
                    processed_seconds: worker_plan.duration_seconds,
                    total_seconds: worker_plan.duration_seconds,
                    phase: "verificando".to_owned(),
                },
            );
            match ffmpeg::verify_output(&worker_ffprobe, &worker_plan).and_then(|verification| {
                publish_output(&worker_plan.output_path, &worker_output)?;
                let published = std::fs::metadata(&worker_output)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                if published != verification.output_bytes {
                    return Err(ProjectError::message(
                        ProjectErrorCode::RenderFailed,
                        "el archivo publicado no coincide con el render verificado",
                    ));
                }
                Ok(verification)
            }) {
                Ok(verification) => {
                    let _ = worker_app.emit(
                        "render-finished",
                        RenderFinishedEvent {
                            job_id: worker_job_id,
                            status: "completed".to_owned(),
                            code: None,
                            message: None,
                            detail: None,
                            output_path: Some(worker_output.to_string_lossy().into_owned()),
                            output_bytes: Some(verification.output_bytes),
                            duration_seconds: Some(verification.duration_seconds),
                            width: Some(verification.width),
                            height: Some(verification.height),
                            elapsed_ms: started.elapsed().as_millis() as u64,
                        },
                    );
                }
                Err(error) => emit_failed(&worker_app, &worker_job_id, started, error, None),
            }
            let _ = std::fs::remove_dir_all(&temp_dir);
            return;
        }
        std::thread::sleep(Duration::from_millis(120));
    });

    Ok(Some(RenderStarted {
        job_id,
        profile_name: profile.name,
    }))
}

#[tauri::command]
pub async fn start_render(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
    include_captions: bool,
    motion_plans: Option<Value>,
    hardware_encoder: Option<String>,
) -> Result<Option<RenderStarted>, ProjectError> {
    start_render_with_output(
        &app,
        &state,
        profile_id,
        include_captions,
        motion_plans,
        hardware_encoder,
        None,
    )
}

#[tauri::command]
pub async fn start_render_to(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    include_captions: bool,
    output_path: String,
    motion_plans: Option<Value>,
    hardware_encoder: Option<String>,
) -> Result<Option<RenderStarted>, ProjectError> {
    let path = PathBuf::from(output_path);
    if !path
        .extension()
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el lote solo escribe archivos .mp4",
        ));
    }
    if path.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con ese nombre en la carpeta elegida",
        ));
    }
    start_render_with_output(
        &app,
        &state,
        Some(profile_id),
        include_captions,
        motion_plans,
        hardware_encoder,
        Some(path),
    )
}

#[tauri::command]
pub async fn choose_export_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, ProjectError> {
    let session = state.require_session()?;
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Elegir carpeta para el lote de exportación")
        .set_directory(&session.root)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la carpeta elegida")
    })?;
    if !folder.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la ruta elegida no es una carpeta",
        ));
    }
    Ok(Some(folder.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn cancel_render(state: State<'_, AppState>, job_id: String) -> Result<(), ProjectError> {
    let jobs = state.render_jobs.lock().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el estado de render no está disponible",
        )
    })?;
    let Some(job) = jobs.get(&job_id).cloned() else {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "ese render ya no está en curso",
        ));
    };
    drop(jobs);
    let mut guard = job.lock().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el proceso de render no está disponible",
        )
    })?;
    guard.cancelled.store(true, Ordering::SeqCst);
    guard.child.kill().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo cancelar el render",
        )
    })?;
    Ok(())
}

#[tauri::command]
pub async fn active_render(state: State<'_, AppState>) -> Result<Option<String>, ProjectError> {
    let jobs = state.render_jobs.lock().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el estado de render no está disponible",
        )
    })?;
    Ok(jobs.keys().next().cloned())
}

#[tauri::command]
pub async fn prune_render_cache(state: State<'_, AppState>) -> Result<u64, ProjectError> {
    let mut removed = 0u64;
    if let Ok(entries) = std::fs::read_dir(&state.cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .map(|name| name.to_string_lossy().starts_with("render-"))
                .unwrap_or(false)
            {
                if std::fs::remove_dir_all(&path).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishing_copies_the_verified_temp_file_to_the_final_path() {
        let base = std::env::temp_dir().join(format!("editor-ia-publish-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let temporary = base.join("temp.mp4");
        let final_path = base.join("final.mp4");
        std::fs::write(&temporary, b"verified-bytes").unwrap();
        publish_output(&temporary, &final_path).unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"verified-bytes");
        assert!(temporary.exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn output_cannot_overwrite_the_project_an_asset_or_the_temp_dir() {
        let base = std::env::temp_dir().join(format!("editor-ia-safe-{}", uuid::Uuid::new_v4()));
        let root = base.join("project");
        let media = root.join("media");
        let cache = base.join("cache/render-job");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        let project_path = root.join("obra.json");
        let asset_path = media.join("clip.mp4");
        std::fs::write(&project_path, "{}").unwrap();
        std::fs::write(&asset_path, b"asset").unwrap();
        let project = serde_json::json!({
            "assets": [{ "id": "11111111-1111-4111-8111-111111111111", "source": { "path": "media/clip.mp4" } }]
        });
        let session = Session::new(
            project_path.clone(),
            "11111111-1111-4111-8111-111111111111".to_owned(),
        );
        assert!(ensure_output_is_safe(&project, &session, &project_path, &cache).is_err());
        assert!(ensure_output_is_safe(&project, &session, &asset_path, &cache).is_err());
        assert!(ensure_output_is_safe(&project, &session, &cache.join("out.mp4"), &cache).is_err());
        assert!(
            ensure_output_is_safe(&project, &session, &base.join("export.mp4"), &cache).is_ok()
        );
        let _ = std::fs::remove_dir_all(&base);
    }
}
