//! Comandos IPC de las herramientas de audio profesionales (FilmCraft DSP):
//! catálogo de efectos, render offline de cadena FX, loudness BS.1770,
//! alineación GCC-PHAT entre dos archivos y time-stretch WSOLA.
//!
//! Decodificación: FFmpeg → PCM f32le interleaved → planar en
//! `media::audio_tools`. Salidas: WAV IEEE-float32 (calidad sin pérdida).
//! Pensados para que la IA los invoque vía MCP/assistant, no para la UI.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::audio_scope::decode_f32_le;
use crate::media::audio_tools::{
    self, deinterleave, list_effects, EffectInfoDto, EffectStep, PlanarPcm, TARGET_RATE,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Techo de audio procesado por llamada (PCM planar en memoria).
pub(crate) const MAX_PROCESS_SECONDS: f64 = 300.0;

/// Decodifica a PCM f32le interleaved con FFmpeg (mismo patrón que
/// `audio_scopes::decode_pcm`: timeout, stderr drenable, exit status decide).
fn decode_interleaved(
    ffmpeg: &Path,
    path: &Path,
    channels: usize,
    max_seconds: f64,
) -> Result<Vec<f32>, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-nostats", "-v", "error"]);
    command.arg("-i").arg(path);
    command.arg("-t").arg(format!("{max_seconds:.3}"));
    command.args([
        "-vn",
        "-ac",
        &channels.to_string(),
        "-ar",
        &TARGET_RATE.to_string(),
        "-f",
        "f32le",
        "-",
    ]);
    let timed =
        crate::commands::output_with_timeout(&mut command, std::time::Duration::from_secs(300))
            .map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo decodificar el audio: {error}"),
                )
            })?;
    if timed.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la decodificación de audio superó el tiempo máximo",
        ));
    }
    let Some(output) = timed.into_output() else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no produjo salida de audio",
        ));
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let root = path.parent().unwrap_or(path);
        let detail = crate::render::ffmpeg::sanitize_log(&stderr, root, 300);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("ffmpeg no pudo decodificar el audio: {detail}"),
        ));
    }
    Ok(decode_f32_le(&output.stdout))
}

pub(crate) fn decode_planar(
    ffmpeg: &Path,
    path: &Path,
    channels: usize,
    max_seconds: f64,
) -> Result<PlanarPcm, ProjectError> {
    let interleaved = decode_interleaved(ffmpeg, path, channels, max_seconds)?;
    let pcm = deinterleave(&interleaved, channels);
    if pcm.iter().all(Vec::is_empty) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo no tiene pista de audio decodificable",
        ));
    }
    Ok(pcm)
}

pub(crate) fn resolve_ffmpeg(state: &AppState) -> Result<PathBuf, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para procesar audio",
        )
    })
}

pub(crate) fn user_file(path: &str) -> Result<PathBuf, ProjectError> {
    let source = crate::application::fs::resolve_user_file_path(path)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de audio no existe",
        ));
    }
    Ok(source)
}

pub(crate) fn output_file(path: &str) -> Result<PathBuf, ProjectError> {
    let out = crate::application::fs::resolve_user_file_path(path)?;
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear el directorio de salida: {e}"),
            )
        })?;
    }
    Ok(out)
}

/// Catálogo de efectos DSP disponibles (registry de filmcraft-audio-dsp):
/// id, nombre, categoría y parámetros con rango/unidad/default. La IA lo
/// consulta antes de armar una cadena para `audio_effects_render`.
#[tauri::command]
pub async fn audio_effects_list() -> Result<Vec<EffectInfoDto>, ProjectError> {
    Ok(list_effects())
}

/// Render offline: decodifica el audio (estéreo 48 kHz), aplica la cadena de
/// efectos en orden y escribe WAV float32. `speed` opcional aplica
/// time-stretch WSOLA antes de los efectos.
#[tauri::command]
pub async fn audio_effects_render(
    state: State<'_, AppState>,
    path: String,
    output: String,
    chain: Vec<EffectStep>,
    speed: Option<f64>,
) -> Result<String, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let dest = output_file(&output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".wav") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la salida debe ser un archivo .wav",
        ));
    }
    let speed = speed.unwrap_or(1.0);
    if !(0.1..=10.0).contains(&speed) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "speed debe estar entre 0.1 y 10",
        ));
    }
    let pcm = tokio::task::spawn_blocking(move || {
        let mut pcm = decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)?;
        if (speed - 1.0).abs() > 1e-6 {
            pcm = audio_tools::wsola_stretch(&pcm, speed);
        }
        audio_tools::apply_effect_chain(&mut pcm, &chain)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e))?;
        Ok::<PlanarPcm, ProjectError>(pcm)
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el procesamiento de audio falló",
        )
    })??;
    let dest_write = dest.clone();
    tokio::task::spawn_blocking(move || {
        audio_tools::write_wav_atomic(&pcm, TARGET_RATE, &dest_write)
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "la escritura del WAV falló")
    })?
    .map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el WAV: {e}"),
        )
    })?;
    Ok(dest.to_string_lossy().to_string())
}

/// Loudness BS.1770/EBU R128 del archivo: LUFS integrado, rango, picos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLoudness {
    pub integrated_lufs: f64,
    pub loudness_range_lu: f64,
    pub max_momentary_lufs: f64,
    pub max_short_term_lufs: f64,
    pub sample_peak_dbfs: f64,
    pub true_peak_dbtp: f64,
    pub duration_seconds: f64,
}

#[tauri::command]
pub async fn audio_loudness_analyze(
    state: State<'_, AppState>,
    path: String,
) -> Result<FileLoudness, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let pcm = tokio::task::spawn_blocking(move || {
        decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el análisis de loudness falló",
        )
    })??;
    let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
    let mut meter = filmcraft_audio_dsp::LoudnessMeter::new(TARGET_RATE as f64, channels.len());
    meter.process(&channels);
    let summary = meter.summary();
    let frames = pcm.iter().map(Vec::len).min().unwrap_or(0);
    Ok(FileLoudness {
        integrated_lufs: summary.integrated_lufs,
        loudness_range_lu: summary.loudness_range_lu,
        max_momentary_lufs: summary.max_momentary_lufs,
        max_short_term_lufs: summary.max_short_term_lufs,
        sample_peak_dbfs: summary.sample_peak_dbfs,
        true_peak_dbtp: summary.true_peak_dbtp,
        duration_seconds: frames as f64 / TARGET_RATE as f64,
    })
}

/// Offset entre dos grabaciones del mismo evento (GCC-PHAT, precision de
/// samples): `b[n]` se alinea con `a[n + lag]`. `reliable` indica si el
/// match es claro (confidence/distinct del algoritmo).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOffset {
    pub lag_samples: i64,
    pub lag_seconds: f64,
    pub lag_fine_seconds: f64,
    pub confidence: f32,
    pub distinct: f32,
    pub inverted: bool,
    pub reliable: bool,
}

#[tauri::command]
pub async fn audio_sync_offset(
    state: State<'_, AppState>,
    path_a: String,
    path_b: String,
) -> Result<SyncOffset, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source_a = user_file(&path_a)?;
    let source_b = user_file(&path_b)?;
    let (a, b) = tokio::task::spawn_blocking(move || {
        let a = decode_interleaved(&ffmpeg, &source_a, 1, MAX_PROCESS_SECONDS)?;
        let b = decode_interleaved(&ffmpeg, &source_b, 1, MAX_PROCESS_SECONDS)?;
        Ok::<(Vec<f32>, Vec<f32>), ProjectError>((a, b))
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "la sincronización falló")
    })??;
    let result = filmcraft_audio_dsp::sync::find_offset(&a, &b, TARGET_RATE, &Default::default())
        .ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo calcular el offset entre los archivos",
        )
    })?;
    Ok(SyncOffset {
        lag_samples: result.lag,
        lag_seconds: result.lag as f64 / TARGET_RATE as f64,
        lag_fine_seconds: result.lag_fine / TARGET_RATE as f64,
        confidence: result.confidence,
        distinct: result.distinct,
        inverted: result.inverted,
        reliable: result.reliable(),
    })
}

/// Normalización a target LUFS (EBU R128): mide el archivo, calcula la
/// ganancia que llega al objetivo sin pasar el true-peak límite, aplica
/// ganancia lineal y un limiter de seguridad (ceiling -1 dBTP). Salida WAV.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessNormalizeResult {
    pub output: String,
    pub measured_lufs: f64,
    pub target_lufs: f64,
    pub gain_db: f64,
}

#[tauri::command]
pub async fn audio_loudness_normalize(
    state: State<'_, AppState>,
    path: String,
    output: String,
    target_lufs: Option<f64>,
) -> Result<LoudnessNormalizeResult, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let dest = output_file(&output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".wav") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la salida debe ser un archivo .wav",
        ));
    }
    let target = target_lufs.unwrap_or(-14.0);
    if !(-70.0..=-5.0).contains(&target) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "target_lufs debe estar entre -70 y -5",
        ));
    }
    let pcm = tokio::task::spawn_blocking(move || {
        let mut pcm = decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)?;
        // Medición sobre la entrada decodificada.
        let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
        let mut meter = filmcraft_audio_dsp::LoudnessMeter::new(TARGET_RATE as f64, channels.len());
        meter.process(&channels);
        let summary = meter.summary();
        if !summary.integrated_lufs.is_finite() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el archivo está silencioso o no se pudo medir el loudness",
            ));
        }
        let gain_db = filmcraft_audio_dsp::loudness::normalize_gain_db_peak_limited(
            summary.integrated_lufs,
            target,
            summary.true_peak_dbtp,
            -1.0,
        );
        let gain = 10f32.powf(gain_db as f32 / 20.0);
        for ch in pcm.iter_mut() {
            for s in ch.iter_mut() {
                *s *= gain;
            }
        }
        // Limitador de seguridad con techo -1 dBTP.
        audio_tools::apply_effect_chain(
            &mut pcm,
            &[EffectStep {
                effect: "limiter".into(),
                params: vec![
                    crate::media::audio_tools::EffectParam {
                        param: "input_gain".into(),
                        value: 0.0,
                    },
                    crate::media::audio_tools::EffectParam {
                        param: "ceiling".into(),
                        value: -1.0,
                    },
                ],
            }],
        )
        .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e))?;
        Ok::<(PlanarPcm, f64, f64), ProjectError>((pcm, gain_db, summary.integrated_lufs))
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la normalización de loudness falló",
        )
    })??;
    let (pcm, gain_db, measured) = pcm;
    let dest_write = dest.clone();
    tokio::task::spawn_blocking(move || {
        audio_tools::write_wav_atomic(&pcm, TARGET_RATE, &dest_write)
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "la escritura del WAV falló")
    })?
    .map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el WAV: {e}"),
        )
    })?;
    Ok(LoudnessNormalizeResult {
        output: dest.to_string_lossy().to_string(),
        measured_lufs: measured,
        target_lufs: target,
        gain_db,
    })
}

/// Time-stretch con pitch preservado (WSOLA): `speed > 1` acorta el audio,
/// `speed < 1` lo alarga. Salida WAV float32. Útil para ajustar narración al
/// tiempo del video sin cambiar el tono de voz.
#[tauri::command]
pub async fn audio_time_stretch(
    state: State<'_, AppState>,
    path: String,
    output: String,
    speed: f64,
) -> Result<String, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let dest = output_file(&output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".wav") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la salida debe ser un archivo .wav",
        ));
    }
    if !(0.1..=10.0).contains(&speed) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "speed debe estar entre 0.1 y 10",
        ));
    }
    let pcm = tokio::task::spawn_blocking(move || {
        let mut pcm = decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)?;
        pcm = audio_tools::wsola_stretch(&pcm, speed);
        Ok::<PlanarPcm, ProjectError>(pcm)
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "el time-stretch falló")
    })??;
    let dest_write = dest.clone();
    tokio::task::spawn_blocking(move || {
        audio_tools::write_wav_atomic(&pcm, TARGET_RATE, &dest_write)
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "la escritura del WAV falló")
    })?
    .map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el WAV: {e}"),
        )
    })?;
    Ok(dest.to_string_lossy().to_string())
}
