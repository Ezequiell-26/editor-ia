//! Pipeline automático de subtítulos: video → transcripción → traducción →
//! ASS → MP4 con subtítulos quemados (libass de FFmpeg).
//!
//! Orquesta piezas que ya existían por separado: `transcribe_faster.py`
//! (faster-whisper), `providers::translate_subtitles` (proveedor IA real,
//! con resultado `simulated` honesto) y el filtro `subtitles` de FFmpeg.
//! Si no hay `targetLanguage` se omite la traducción; si no hay proveedor
//! configurado la traducción falla explícitamente (no se inventa texto).

use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::system::resolve_tools;
use super::transcribe::{run_native, whisper_status, NativeRun, NativeRunSpec, SCRIPT};
use crate::application::transcribe::{
    derive_hf_home, engine_plan, native_model_id, parse_result, validate_language, validate_model,
    TranscriptionEngine, TranscriptionResult,
};
use crate::render::subtitles::{cues_to_ass, escape_filter_arg};

const VIDEO_EXTS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "m4v"];

fn default_model() -> String {
    "small".into()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlePipelineRequest {
    /// Archivo de video/audio a procesar (ruta absoluta).
    pub input_path: String,
    /// Salida .mp4 con subtítulos quemados; si se omite, sólo se genera el .ass.
    #[serde(default)]
    pub output_path: Option<String>,
    /// Idioma destino para traducir (ej. "en"). Vacío = sin traducción.
    #[serde(default)]
    pub target_language: Option<String>,
    /// Idioma fuente ("auto" por defecto).
    #[serde(default)]
    pub source_language: Option<String>,
    /// Modelo whisper (tiny/base/small/medium).
    #[serde(default = "default_model")]
    pub model: String,
    /// Quema los subtítulos en el video de salida.
    #[serde(default = "default_true")]
    pub burn: bool,
}

#[tauri::command]
pub async fn subtitles_pipeline(
    state: State<'_, AppState>,
    request: SubtitlePipelineRequest,
) -> Result<serde_json::Value, ProjectError> {
    // El video de entrada lo elige el usuario (diálogo o MCP): política de
    // lectura de `fs_*` — absoluta, fuera de ubicaciones de credenciales.
    let input = crate::application::fs::resolve_user_file_path(&request.input_path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de entrada no existe",
        ));
    }
    let ext = input
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !VIDEO_EXTS.contains(&ext.as_str()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la entrada debe ser un video (mp4, mov, mkv, webm, avi, m4v)",
        ));
    }
    // La salida la escribe el pipeline (.ass junto a la salida y .mp4
    // quemado): política de escritura de `fs_*` — absoluta y fuera de
    // carpetas de sistema, credenciales y carpetas de la app.
    let output_path = request
        .output_path
        .as_deref()
        .map(crate::application::fs::validate_user_write_path)
        .transpose()?;
    let burn = request.burn && output_path.is_some();
    if request.burn && output_path.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "burn=true requiere outputPath (.mp4)",
        ));
    }

    // Settings/tools se resuelven antes de mover `state` a la traducción.
    let settings = state.settings_snapshot()?;
    let (ffmpeg_opt, ffprobe_opt, _) = resolve_tools(&settings);

    // 1) Transcripción: motor nativo (whisper.cpp in-process) primero cuando
    //    el modelo tiene equivalente y hay FFmpeg para decodificar; el
    //    puente Python de faster-whisper queda como fallback, igual que en
    //    `transcribe_asset`.
    let status = whisper_status();
    let language = validate_language(request.source_language.as_deref().unwrap_or("auto"))?;
    let model = validate_model(&request.model)?;
    let native_id = native_model_id(&model);
    let models_dir = crate::vendor_concat::whisper_models_dir(&state.config_dir);
    let native_supported = native_id.is_some() && ffmpeg_opt.is_some() && ffprobe_opt.is_some();
    let engines = engine_plan(native_supported, status.python.is_some());
    if engines.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!(
                "transcripción no disponible: {}",
                status
                    .reason
                    .as_deref()
                    .unwrap_or("falta Python con faster-whisper y FFmpeg para el motor nativo")
            ),
        ));
    }

    let mut transcription: Option<TranscriptionResult> = None;
    let mut native_failures: Vec<String> = Vec::new();
    for engine in engines {
        match engine {
            TranscriptionEngine::Native => {
                let (Some(ffmpeg), Some(ffprobe), Some(model_id)) =
                    (ffmpeg_opt.clone(), ffprobe_opt.clone(), native_id)
                else {
                    continue;
                };
                let language_opt = if language.eq_ignore_ascii_case("auto") {
                    None
                } else {
                    Some(language.clone())
                };
                match run_native(NativeRunSpec {
                    ffmpeg,
                    ffprobe,
                    source: input.clone(),
                    models_dir: models_dir.clone(),
                    model_id,
                    language: language_opt,
                    requested_language: language.clone(),
                    requested_model: model.clone(),
                })
                .await
                {
                    NativeRun::Done(result) => {
                        transcription = Some(result);
                        break;
                    }
                    NativeRun::Skip => native_failures
                        .push("el motor nativo no cubre archivos de más de 30 min".to_owned()),
                    NativeRun::Failed(error) => {
                        native_failures.push(format!("motor nativo (whisper.cpp): {error}"));
                    }
                    NativeRun::TimedOut => {
                        return Err(ProjectError::message(
                            ProjectErrorCode::ProviderUnavailable,
                            "la transcripción superó el tiempo máximo (30 min) y se canceló",
                        ));
                    }
                }
            }
            TranscriptionEngine::Python => {
                let Some(python) = status.python.clone() else {
                    continue;
                };
                // Camino histórico: faster-whisper vía puente Python.
                let script = state.cache_dir.join("transcribe_faster.py");
                std::fs::write(&script, SCRIPT).map_err(|e| {
                    ProjectError::message(
                        ProjectErrorCode::Io,
                        &format!("no se pudo preparar el script: {e}"),
                    )
                })?;
                // AUD-007/030: la transcripción bloquea minutos; corre en hilo
                // bloqueante con deadline, igual que `transcribe_asset`.
                let hf_home = derive_hf_home(&python);
                let input_clone = input.clone();
                let language_run = language.clone();
                let model_run = model.clone();
                let timed = tokio::task::spawn_blocking(move || {
                    let mut command = std::process::Command::new(&python);
                    command
                        .arg(&script)
                        .arg(&input_clone)
                        .arg("--language")
                        .arg(&language_run)
                        .arg("--model")
                        .arg(&model_run)
                        .env("PYTHONIOENCODING", "utf-8")
                        .env("PYTHONUTF8", "1");
                    if let Some(hf_home) = hf_home {
                        command.env("EDITORIA_HF_HOME", hf_home);
                    }
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        command.creation_flags(0x0800_0000);
                    }
                    crate::commands::output_with_timeout(
                        &mut command,
                        std::time::Duration::from_secs(30 * 60),
                    )
                })
                .await
                .map_err(|_| {
                    ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        "el hilo de transcripción se interrumpió",
                    )
                })?
                .map_err(|_| {
                    ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        "no se pudo iniciar Python",
                    )
                })?;
                if timed.timed_out {
                    return Err(ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        "la transcripción superó el tiempo máximo (30 min) y se canceló",
                    ));
                }
                let Some(output) = timed.into_output() else {
                    return Err(ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        "la transcripción terminó de forma inesperada",
                    ));
                };
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        &format!(
                            "Faster-Whisper falló: {}",
                            stderr.chars().take(400).collect::<String>()
                        ),
                    ));
                }
                transcription = Some(parse_result(&output.stdout)?);
                break;
            }
        }
    }
    let Some(transcription) = transcription else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!(
                "ningún motor de transcripción pudo completar el trabajo ({})",
                native_failures.join("; ")
            ),
        ));
    };
    let mut cues: Vec<(f64, f64, String)> = transcription
        .segments
        .iter()
        .map(|s| (s.start, s.end, s.text.trim().to_owned()))
        .filter(|(_, _, t)| !t.is_empty())
        .collect();

    // 2) Traducción opcional con el proveedor configurado.
    let mut translated = false;
    let mut simulated = false;
    if let Some(target) = request
        .target_language
        .as_deref()
        .filter(|t| !t.trim().is_empty())
    {
        let texts: Vec<String> = cues.iter().map(|(_, _, t)| t.clone()).collect();
        let result = crate::commands::providers::translate_subtitles(
            state,
            crate::commands::providers::TranslateRequest {
                texts,
                source_language: request
                    .source_language
                    .clone()
                    .unwrap_or_else(|| "auto".into()),
                target_language: target.to_owned(),
                glossary: None,
                approved_cost: true,
            },
        )
        .await?;
        translated = true;
        simulated = result.simulated;
        for (cue, text) in cues.iter_mut().zip(result.texts.iter()) {
            cue.2 = text.clone();
        }
    }

    // 3) ASS junto al video de salida (o junto a la entrada si no hay burn).
    // AUD-078: FFmpeg sólo se exige cuando hay quemado; con burn=false el
    // pipeline genera el .ass aunque el ejecutable no esté configurado
    // (ffprobe ya es opcional para el PlayRes).
    let ffmpeg = if burn {
        Some(ffmpeg_opt.ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se encontró FFmpeg configurado",
            )
        })?)
    } else {
        None
    };
    let ffprobe = ffprobe_opt;

    let base = output_path
        .clone()
        .unwrap_or_else(|| input.with_extension("es"));
    // El .ass se escribe junto a la salida (o a la entrada): misma política
    // de escritura — nunca dentro de carpetas de sistema ni de la app.
    let ass_path = crate::application::fs::validate_user_write_path(
        &base.with_extension("ass").to_string_lossy(),
    )?;
    // Probe de dimensiones reales para el PlayRes del ASS (AUD-030: ffprobe
    // es un proceso externo; no bloquea el runtime async).
    let input_probe = input.clone();
    let ffprobe_probe = ffprobe.clone();
    let (w, h) =
        tokio::task::spawn_blocking(move || probe_size(ffprobe_probe.as_ref(), &input_probe))
            .await
            .ok()
            .flatten()
            .unwrap_or((1920, 1080));
    let ass = cues_to_ass(&cues, w, h);
    if let Some(parent) = ass_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear la carpeta: {e}"),
            )
        })?;
    }
    // Escritura atómica: el .ass es un entregable — un corte a mitad no
    // debe dejar subtítulos truncados (misma convención que fs_write).
    let ass_tmp = ass_path.with_file_name(format!(
        ".{}.tmp-{}",
        ass_path
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        uuid::Uuid::new_v4()
    ));
    let ass_write =
        std::fs::write(&ass_tmp, &ass).and_then(|()| std::fs::rename(&ass_tmp, &ass_path));
    if ass_write.is_err() {
        let _ = std::fs::remove_file(&ass_tmp);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo escribir el ASS",
        ));
    }

    // 4) Burn opcional con el filtro subtitles (libass).
    let mut output_file: Option<String> = None;
    if burn {
        let out = output_path
            .clone()
            .expect("burn requiere outputPath validado");
        if out.extension().and_then(|e| e.to_str()) != Some("mp4") {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "outputPath debe ser .mp4",
            ));
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo crear la carpeta: {e}"),
                )
            })?;
        }
        // AUD-077: nombres únicos por ejecución — dos pipelines concurrentes
        // sobre el mismo destino no deben compartir el MP4 temporal ni el
        // ASS que FFmpeg lee (antes ambos eran determinísticos y `-y` los
        // truncaba mientras el otro proceso los usaba).
        let run_tag = unique_run_tag();
        let tmp = out.with_extension(format!("{run_tag}.tmp.mp4"));
        let burn_ass_path = out.with_extension(format!("{run_tag}.burn.ass"));
        std::fs::write(&burn_ass_path, &ass).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo escribir el ASS de quemado: {e}"),
            )
        })?;
        // libass/ffmpeg parsea el filtergraph separando opciones por ':' — una
        // ruta absoluta de Windows («D:/…») rompe el parseo («original_size»).
        // Hay que escapar los caracteres reservados del filtro.
        let ass_arg = escape_filter_arg(&burn_ass_path.to_string_lossy().replace('\\', "/"));
        let ffmpeg_bin = ffmpeg.clone().expect("burn requiere FFmpeg configurado");
        let mut encoded = false;
        let mut last_err = String::new();
        for encoder in ["libopenh264", "h264_mf"] {
            // AUD-030/008: el burn puede tardar según la duración; corre en
            // hilo bloqueante con deadline y pipes drenados.
            let ffmpeg_run = ffmpeg_bin.clone();
            let input_run = input.clone();
            let tmp_run = tmp.clone();
            let ass_run = ass_arg.clone();
            let run = tokio::task::spawn_blocking(move || {
                let mut command = std::process::Command::new(&ffmpeg_run);
                command.args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    &input_run.to_string_lossy(),
                    "-vf",
                    &format!("subtitles=filename={ass_run}"),
                    "-c:v",
                    encoder,
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    &tmp_run.to_string_lossy(),
                ]);
                crate::commands::output_with_timeout(
                    &mut command,
                    std::time::Duration::from_secs(2 * 3600),
                )
            })
            .await;
            match run {
                Ok(Ok(timed)) if !timed.timed_out => {
                    if let Some(o) = timed.into_output() {
                        if o.status.success() {
                            encoded = true;
                            break;
                        }
                        last_err = String::from_utf8_lossy(&o.stderr)
                            .chars()
                            .take(300)
                            .collect();
                    } else {
                        last_err = "ffmpeg no produjo salida".to_owned();
                    }
                    let _ = std::fs::remove_file(&tmp);
                }
                Ok(Ok(_)) => {
                    last_err = "el burn de subtítulos superó el tiempo máximo (2 h)".to_owned();
                    let _ = std::fs::remove_file(&tmp);
                }
                Ok(Err(e)) => {
                    last_err = e.to_string();
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    break;
                }
            }
        }
        if !encoded {
            let _ = std::fs::remove_file(&burn_ass_path);
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                &format!("FFmpeg no pudo quemar subtítulos: {last_err}"),
            ));
        }
        std::fs::rename(&tmp, &out).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo publicar el video: {e}"),
            )
        })?;
        let _ = std::fs::remove_file(&burn_ass_path);
        output_file = Some(out.to_string_lossy().to_string());
    }

    Ok(serde_json::json!({
        "ok": true,
        "assPath": ass_path.to_string_lossy(),
        "outputPath": output_file,
        "cues": cues.len(),
        "language": transcription.language,
        "translated": translated,
        "simulated": simulated,
        "burned": burn,
    }))
}

/// Etiqueta única por ejecución del pipeline (pid + nanos desde epoch)
/// para nombres temporales que no colisionen entre llamadas concurrentes
/// sobre el mismo destino (AUD-077).
fn unique_run_tag() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{nanos}", std::process::id())
}

fn probe_size(ffprobe: Option<&PathBuf>, input: &Path) -> Option<(u32, u32)> {
    let ffprobe = ffprobe?;
    let out = std::process::Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            &input.to_string_lossy(),
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let stream = &json["streams"][0];
    Some((
        stream["width"].as_u64()? as u32,
        stream["height"].as_u64()? as u32,
    ))
}
