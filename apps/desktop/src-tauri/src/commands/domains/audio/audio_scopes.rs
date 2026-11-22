//! Scopes de audio al estilo Kdenlive (`src/scopes/audioscopes/`):
//! oscilograma (min/max por bucket), espectro promedio y espectrograma,
//! calculados en Rust con el FFT de `filmcraft-audio-dsp` sobre PCM f32le
//! mono que decodifica FFmpeg. La UI dibuja el JSON resultante en canvas.
//!
//! El cálculo vive en `media::audio_scope` (puro y testeado); este comando
//! sólo decodifica y delega.

use std::process::Command;

use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::audio_scope::{
    analyze_pcm, decode_f32_le, normalize_scope_range, AudioScopeData, MAX_ANALYZE_SECONDS,
    TARGET_RATE,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Decodifica el audio de un archivo a PCM f32le mono 48 kHz con FFmpeg.
/// Con `range` decodifica sólo la ventana `[start, start + duration)` en
/// segundos del archivo (seek de entrada + `-t` de salida).
fn decode_pcm(
    ffmpeg: &std::path::Path,
    path: &std::path::Path,
    range: Option<(f64, f64)>,
) -> Result<Vec<f32>, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-nostats", "-v", "error"]);
    if let Some((start, _)) = range {
        command.arg("-ss").arg(format!("{start:.3}"));
    }
    command.arg("-i").arg(path);
    // AUD-028: `-t` de salida acota el PCM a MAX_ANALYZE_SECONDS (antes se
    // leía hasta el tope de bytes y un archivo largo llenaba el pipe de
    // stdout mientras stderr — nunca drenado — bloqueaba a ffmpeg).
    let out_seconds = range
        .map(|(_, duration)| duration)
        .unwrap_or(MAX_ANALYZE_SECONDS)
        .min(MAX_ANALYZE_SECONDS);
    command.arg("-t").arg(format!("{out_seconds:.3}"));
    command.args([
        "-vn",
        "-ac",
        "1",
        "-ar",
        &TARGET_RATE.to_string(),
        "-f",
        "f32le",
        "-",
    ]);
    // stdout+stderr se drenan en threads y hay deadline: nada de deadlock de
    // pipes ni esperas eternas (AUD-028).
    let timed =
        crate::commands::output_with_timeout(&mut command, std::time::Duration::from_secs(180))
            .map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo decodificar el audio: {error}"),
                )
            })?;
    if timed.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la decodificación de audio superó el tiempo máximo (3 min)",
        ));
    }
    let Some(output) = timed.into_output() else {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no produjo salida de audio",
        ));
    };
    // AUD-029: el exit status decide — un ffmpeg que falla a mitad deja PCM
    // parcial que no puede presentarse como análisis completo.
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let root = path.parent().unwrap_or(path);
        let detail = crate::render::ffmpeg::sanitize_log(&stderr, root, 300);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "ffmpeg no pudo decodificar el audio{}",
                if detail.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {detail}")
                }
            ),
        ));
    }
    Ok(decode_f32_le(&output.stdout))
}

/// Analiza el audio de un archivo del proyecto: oscilograma, espectro y
/// espectrograma listos para dibujar en canvas. Con `start_seconds` +
/// `duration_seconds` analiza sólo esa ventana del archivo.
#[tauri::command]
pub async fn audio_scope_analyze(
    state: State<'_, AppState>,
    path: String,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<AudioScopeData, ProjectError> {
    let range = normalize_scope_range(start_seconds, duration_seconds)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para analizar el audio",
        ));
    };
    // Archivo suelto del usuario: política de lectura de `fs_*`
    // (absoluta, fuera de credenciales).
    let source = crate::application::fs::resolve_user_file_path(&path)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de audio no existe",
        ));
    }
    // Límite duro de espera por si ffmpeg se cuelga con un archivo raro.
    let samples = tokio::task::spawn_blocking(move || decode_pcm(&ffmpeg, &source, range))
        .await
        .map_err(|_| {
            ProjectError::message(ProjectErrorCode::RenderFailed, "el análisis de audio falló")
        })??;
    if samples.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo no tiene pista de audio decodificable",
        ));
    }
    Ok(analyze_pcm(&samples, TARGET_RATE))
}

/// Scopes de audio de un asset del proyecto abierto (misma resolución que
/// `audio_peaks`: el asset debe tener audio y estar en disco). Con
/// `start_seconds` + `duration_seconds` analiza sólo esa ventana.
#[tauri::command]
pub async fn audio_scope_analyze_asset(
    state: State<'_, AppState>,
    asset_id: String,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<AudioScopeData, ProjectError> {
    let range = normalize_scope_range(start_seconds, duration_seconds)?;
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para analizar el audio",
        ));
    };
    let (_kind, source) = crate::commands::audio::resolve_audio_asset(&session, &asset_id)?;
    let samples = tokio::task::spawn_blocking(move || decode_pcm(&ffmpeg, &source, range))
        .await
        .map_err(|_| {
            ProjectError::message(ProjectErrorCode::RenderFailed, "el análisis de audio falló")
        })??;
    if samples.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el material no tiene pista de audio decodificable",
        ));
    }
    Ok(analyze_pcm(&samples, TARGET_RATE))
}
