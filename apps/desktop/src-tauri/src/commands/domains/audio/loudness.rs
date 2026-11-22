//! Comandos IPC del monitor de loudness de la mezcla (ITU-R BS.1770-4 /
//! EBU R128). La medición DSP, el reporte y el parseo de `loudnorm` viven en
//! `crate::render::loudness`; aquí quedan la sesión, el perfil de exportación,
//! el plan de audio y el spawn/progreso de FFmpeg.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use crate::commands::system::resolve_tools;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{build_plan, expand_compounds, parse_profile, BuildPlanInput};
use crate::render::loudness::{
    build_report, parse_loudnorm_json, run_meter_over_pcm, FileLoudness, LoudnessProgressEvent,
    MixLoudnessReport, EMIT_EVERY,
};
use crate::state::AppState;

#[tauri::command]
pub async fn analyze_mix_loudness(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<MixLoudnessReport, ProjectError> {
    // Los préstamos de `State` no cruzan el await de `spawn_blocking`: todo lo
    // que el hilo necesita se clona antes.
    let (project_path, project_root, cache_dir, ffmpeg, ffprobe) = {
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
                "ffprobe no está disponible; sin él no se puede armar el grafo de la mezcla",
            ));
        };
        (
            session.path.clone(),
            session.root.clone(),
            state.cache_dir.clone(),
            ffmpeg,
            ffprobe,
        )
    };

    // La medición abre el proyecto guardado, igual que el export: lo que se
    // mide es exactamente lo que se exporta.
    let opened = service::open_project(&project_path)?;
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
    let profile_json = match profile_id.as_deref() {
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
    let profile = parse_profile(&profile_json)?;
    let sample_rate = f64::from(profile.audio_rate);
    let channels = profile.audio_channels as usize;
    let target_lufs = project["audio"]["loudnessTarget"]["integratedLufs"].as_f64();

    let job = uuid::Uuid::new_v4().simple().to_string();
    let temp_dir = cache_dir.join(format!("loudness-{job}"));
    std::fs::create_dir_all(&temp_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo preparar la carpeta temporal",
        )
    })?;

    let plan = match build_plan(BuildPlanInput {
        project: &project,
        root: &project_root,
        profile: &profile,
        output_path: Path::new(""),
        include_captions: false,
        temp_dir: &temp_dir,
        ffprobe: &ffprobe,
        motion_ass: None,
        audio_only: true,
    }) {
        Ok(plan) => plan,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    let total_seconds = plan.duration_seconds;
    let working_dir: PathBuf = plan.working_dir.clone();

    let progress_app = app.clone();
    let handle = tauri::async_runtime::spawn_blocking(
        move || -> Result<MixLoudnessReport, ProjectError> {
            let mut child = crate::render::ffmpeg::spawn(&ffmpeg, &plan).inspect_err(|_error| {
                let _ = std::fs::remove_dir_all(&working_dir);
            })?;
            let stdout = child.stdout.take();
            let stderr_tail = Arc::new(Mutex::new(String::new()));
            // Deadline del análisis: el meter consume el PCM en streaming y un
            // FFmpeg colgado a mitad de la mezcla lo congelaría para siempre.
            // Se usa el mismo criterio que el render (20× realtime, piso/techo).
            let shared_child = Arc::new(Mutex::new(child));
            let watchdog_fired = Arc::new(AtomicBool::new(false));
            let analysis_done = Arc::new(AtomicBool::new(false));
            {
                let shared_child = shared_child.clone();
                let watchdog_fired = watchdog_fired.clone();
                let analysis_done = analysis_done.clone();
                let timeout = crate::commands::proportional_media_timeout(total_seconds);
                std::thread::spawn(move || {
                    let deadline = Instant::now() + timeout;
                    loop {
                        if analysis_done.load(Ordering::SeqCst) {
                            return;
                        }
                        if Instant::now() >= deadline {
                            watchdog_fired.store(true, Ordering::SeqCst);
                            if let Ok(mut guard) = shared_child.lock() {
                                let _ = guard.kill();
                            }
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(500));
                    }
                });
            }
            let stderr = shared_child
                .lock()
                .ok()
                .and_then(|mut guard| guard.stderr.take());
            let stderr_thread = stderr.map(|mut stderr| {
                let tail = stderr_tail.clone();
                std::thread::spawn(move || {
                    let mut buffer = Vec::new();
                    let mut chunk = [0u8; 8_192];
                    loop {
                        match stderr.read(&mut chunk) {
                            Ok(0) | Err(_) => break,
                            Ok(read) => {
                                buffer.extend_from_slice(&chunk[..read]);
                                if buffer.len() > 16_384 {
                                    let drain = buffer.len() - 16_384;
                                    buffer.drain(..drain);
                                }
                            }
                        }
                    }
                    if let Ok(mut guard) = tail.lock() {
                        *guard = String::from_utf8_lossy(&buffer).into_owned();
                    }
                })
            });
            let mut seen = 0usize;
            let measured = stdout.map(|reader| {
                run_meter_over_pcm(
                    reader,
                    sample_rate,
                    channels,
                    total_seconds,
                    |seconds, _momentary, _short_term, percent| {
                        seen += 1;
                        if seen % EMIT_EVERY == 1 {
                            let _ = progress_app.emit(
                                "loudness-analysis-progress",
                                LoudnessProgressEvent {
                                    percent: percent * 100.0,
                                    seconds,
                                    total_seconds,
                                },
                            );
                        }
                    },
                )
            });
            if let Some(thread) = stderr_thread {
                let _ = thread.join();
            }
            let status = shared_child
                .lock()
                .map_err(|_| {
                    ProjectError::message(ProjectErrorCode::RenderFailed, "ffmpeg terminó mal")
                })?
                .wait()
                .map_err(|_| {
                    ProjectError::message(ProjectErrorCode::RenderFailed, "ffmpeg terminó mal")
                })?;
            analysis_done.store(true, Ordering::SeqCst);
            if watchdog_fired.load(Ordering::SeqCst) {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el análisis de loudness superó el tiempo máximo; la mezcla puede ser demasiado pesada",
                ));
            }
            let (meter, history, seconds) = match measured {
                Some(result) => result?,
                None => {
                    return Err(ProjectError::message(
                        ProjectErrorCode::RenderFailed,
                        "ffmpeg no expuso el PCM de la mezcla",
                    ))
                }
            };
            if !status.success() {
                let detail = stderr_tail
                    .lock()
                    .map(|guard| crate::render::ffmpeg::sanitize_log(&guard, &working_dir, 400))
                    .unwrap_or_default();
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    if detail.is_empty() {
                        "ffmpeg no pudo decodificar la mezcla"
                    } else {
                        detail.as_str()
                    },
                ));
            }
            build_report(meter, history, seconds, target_lufs)
        },
    );
    let report = match handle.await {
        Ok(result) => result,
        Err(_) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "el análisis de loudness se interrumpió",
            ));
        }
    };
    let _ = std::fs::remove_dir_all(&temp_dir);
    report
}

/// Loudness medido sobre un archivo ya renderizado.
///
/// `analyze_mix_loudness` mide la mezcla del proyecto abierto; este comando mide
/// el MP4 que salió del render. Es lo que permite el lazo cerrado: comparar el
/// resultado con el objetivo y corregir el master antes de volver a exportar.
#[tauri::command]
pub async fn measure_file_loudness(
    state: State<'_, AppState>,
    path: String,
) -> Result<FileLoudness, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para medir el loudness",
        ));
    };
    // El MP4 renderizado es un archivo del usuario fuera del proyecto:
    // política de lectura de `fs_*` (absoluta, fuera de credenciales).
    let source = crate::application::fs::resolve_user_file_path(&path)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el archivo no existe",
        ));
    }
    // AUD-030: loudnorm sobre el archivo completo es CPU-bound; va a un
    // hilo bloqueante para no congelar el runtime async de Tauri.
    // Deadline generoso: loudnorm es más rápido que realtime pero un archivo
    // muy largo o un FFmpeg colgado no puede quedar esperando para siempre.
    const MEASURE_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
    let ffmpeg_path = ffmpeg.clone();
    let source_path = source.clone();
    let timed = tauri::async_runtime::spawn_blocking(move || {
        let mut command = std::process::Command::new(&ffmpeg_path);
        command
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(&source_path)
            .args(["-af", "loudnorm=print_format=json", "-f", "null", "-"])
            .stdin(std::process::Stdio::null());
        crate::commands::hide_console(&mut command);
        crate::commands::output_with_timeout(&mut command, MEASURE_TIMEOUT)
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la medición de loudness se interrumpió",
        )
    })?
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no pude medir el loudness del archivo: {error}"),
        )
    })?;
    if timed.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la medición de loudness tardó demasiado; el archivo puede ser demasiado largo",
        ));
    }
    let output = timed.into_output().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no devolvió la medición de loudness",
        )
    })?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no pudo medir el archivo",
        ));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_loudnorm_json(&stderr).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el loudness del archivo no se pudo leer",
        )
    })
}
