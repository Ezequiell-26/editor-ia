//! Mejora de diálogo con DSP local de FilmCraft.
//!
//! La cadena viene de `filmcraft-audio-dsp` (MIT OR Apache-2.0): reducción de
//! ruido espectral, de-hum, de-esser, de-reverb, EQ, compresor, realce de voz y
//! limitador de pico real. No separa voces superpuestas ni es un modelo de IA:
//! es procesamiento de señal determinista sobre el audio elegido.
//!
//! FFmpeg decodifica el archivo a f32le estéreo 48 kHz, el DSP procesa en
//! bloques y el resultado se publica como WAV PCM 24 bits con rename atómico.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::dialogue::{build_chain, DialoguePreset};
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const CHANNELS: usize = 2;
const BLOCK_FRAMES: usize = 1024;
const MAX_SECONDS: f64 = 180.0;

/// Temporal que se borra al salir del scope salvo que se publique con
/// `keep()`: cubre todos los `?` intermedios sin repetir limpieza en cada
/// rama de error (AUD-083). Lo reusa `narration` para el WAV de SAPI.
pub(crate) struct TempFile(PathBuf);

impl TempFile {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self(path)
    }
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
    /// Entrega la ruta y desactiva el borrado (el archivo ya tiene dueño).
    pub(crate) fn keep(self) -> PathBuf {
        let path = self.0.clone();
        std::mem::forget(self);
        path
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueRequest {
    pub input_path: String,
    pub output_dir: Option<String>,
    #[serde(default)]
    pub preset: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueResult {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: f64,
    pub preset: String,
    /// Cadena aplicada en orden, para que la UI no invente el procesamiento.
    pub effects: Vec<String>,
}

fn process_audio<F: FnMut(f64, &str)>(
    input: &Path,
    output_dir: &Path,
    preset: DialoguePreset,
    ffmpeg: &Path,
    ffprobe: &Path,
    mut progress: F,
) -> Result<DialogueResult, ProjectError> {
    progress(5.0, "Midiendo el audio");
    let measure = probe_file(ffprobe, input, MediaKind::Audio)?;
    let source_seconds = measure.duration_seconds.unwrap_or(0.0);
    if source_seconds <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio no tiene una duración válida",
        ));
    }
    if source_seconds > MAX_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la mejora de voz admite hasta 180 segundos por archivo",
        ));
    }

    progress(15.0, "Decodificando a 48 kHz");
    let mut decode = Command::new(ffmpeg);
    decode
        .args(["-v", "error", "-i"])
        .arg(input)
        .args(["-vn", "-ac", "2", "-ar", "48000", "-f", "f32le", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut decode);
    let decoded = decode.output().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo decodificar el audio: {error}").as_str(),
        )
    })?;
    if !decoded.status.success() {
        let detail = String::from_utf8_lossy(&decoded.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "FFmpeg no pudo leer el audio: {}",
                detail.lines().last().unwrap_or("sin detalle")
            )
            .as_str(),
        ));
    }
    if decoded.stdout.len() < CHANNELS * 4 || decoded.stdout.len() % (CHANNELS * 4) != 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no contiene audio estéreo utilizable",
        ));
    }
    let frames = decoded.stdout.len() / (CHANNELS * 4);
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for frame in decoded.stdout.as_chunks::<{ CHANNELS * 4 }>().0 {
        left.push(f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]));
        right.push(f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]));
    }

    progress(25.0, "Aplicando la cadena de diálogo");
    let mut chain = build_chain(preset)?;
    let latency: usize = chain.iter().map(|fx| fx.latency()).sum();
    let mut work_l = vec![0.0f32; latency];
    work_l.extend_from_slice(&left);
    work_l.resize(work_l.len() + latency, 0.0);
    let mut work_r = vec![0.0f32; latency];
    work_r.extend_from_slice(&right);
    work_r.resize(work_r.len() + latency, 0.0);
    let total = work_l.len();
    let mut processed = 0usize;
    while processed < total {
        let end = (processed + BLOCK_FRAMES).min(total);
        let (l, r) = (&mut work_l[processed..end], &mut work_r[processed..end]);
        let mut channels = [l, r];
        for fx in chain.iter_mut() {
            fx.process(&mut channels);
        }
        processed = end;
        let percent = 25.0 + 55.0 * (processed as f64 / total.max(1) as f64);
        progress(percent, "Procesando voz");
    }
    left.clear();
    right.clear();
    for index in latency..latency + frames {
        left.push(work_l[index]);
        right.push(work_r[index]);
    }

    let raw_path = TempFile::new(output_dir.join(format!(".voz-{}.f32", Uuid::new_v4())));
    let mut raw = std::fs::File::create(raw_path.path()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir el audio procesado: {error}").as_str(),
        )
    })?;
    for (l, r) in left.iter().zip(right.iter()) {
        raw.write_all(&l.to_le_bytes())
            .and_then(|_| raw.write_all(&r.to_le_bytes()))
            .map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("no se pudo escribir el audio procesado: {error}").as_str(),
                )
            })?;
    }
    drop(raw);

    progress(85.0, "Publicando el WAV");
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "audio".to_owned());
    let safe: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let base = safe.trim_matches('-');
    let base = if base.is_empty() { "audio" } else { base };
    let mut final_path = output_dir.join(format!("{base}-voz.wav"));
    let mut index = 2;
    while final_path.exists() {
        final_path = output_dir.join(format!("{base}-voz-{index}.wav"));
        index += 1;
    }
    let temp_wav = TempFile::new(output_dir.join(format!(".voz-{}.wav", Uuid::new_v4())));
    let mut encode = Command::new(ffmpeg);
    encode
        .args([
            "-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i",
        ])
        .arg(raw_path.path())
        .args(["-c:a", "pcm_s24le"])
        .arg(temp_wav.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut encode);
    let encoded = encode.output().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo codificar el WAV: {error}").as_str(),
        )
    })?;
    drop(raw_path);
    if !encoded.status.success() {
        let detail = String::from_utf8_lossy(&encoded.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            format!(
                "FFmpeg no pudo escribir el WAV: {}",
                detail.lines().last().unwrap_or("sin detalle")
            )
            .as_str(),
        ));
    }
    let measured = probe_file(ffprobe, temp_wav.path(), MediaKind::Audio)?;
    let duration = measured.duration_seconds.unwrap_or(0.0);
    if duration <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el WAV procesado no tiene una duración válida",
        ));
    }
    std::fs::rename(temp_wav.path(), &final_path).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el WAV: {error}").as_str(),
        )
    })?;
    temp_wav.keep();
    let bytes = std::fs::metadata(&final_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    progress(100.0, "Voz lista");
    Ok(DialogueResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        duration_seconds: duration,
        preset: preset.id().to_owned(),
        effects: preset
            .effect_ids()
            .iter()
            .map(|id| (*id).to_owned())
            .collect(),
    })
}

/// Mejora un audio con la cadena de diálogo DSP local.
#[tauri::command]
pub async fn enhance_dialogue(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DialogueRequest,
) -> Result<DialogueResult, ProjectError> {
    let input = crate::application::fs::resolve_user_file_path(&request.input_path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el audio para mejorar no está en disco",
        ));
    }
    let output_dir = match request.output_dir.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            crate::application::fs::validate_user_write_path(value)?
        }
        _ => input
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
    };
    if !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de la voz no existe",
        ));
    }
    let preset = DialoguePreset::parse(request.preset.as_deref())?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para mejorar la voz",
        ));
    };
    tauri::async_runtime::spawn_blocking(move || {
        process_audio(
            &input,
            &output_dir,
            preset,
            &ffmpeg,
            &ffprobe,
            |percent, stage| {
                let _ = app.emit(
                    "dialogue-progress",
                    serde_json::json!({ "percent": percent, "stage": stage }),
                );
            },
        )
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("la mejora de voz se interrumpió: {error}").as_str(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_file_borra_al_salir_y_keep_lo_conserva() {
        let dir = std::env::temp_dir().join(format!("editor-ia-tmp-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temporal");
        let dropped = TempFile::new(dir.join("sale.bin"));
        std::fs::write(dropped.path(), b"x").expect("escribir");
        drop(dropped);
        assert!(!dir.join("sale.bin").exists());

        let kept = TempFile::new(dir.join("queda.bin"));
        std::fs::write(kept.path(), b"x").expect("escribir");
        let published = kept.keep();
        assert!(published.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_processes_a_real_wav() {
        let dir = std::env::temp_dir().join(format!("editor-ia-voz-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temporal");
        let input = dir.join("voz.wav");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=220:duration=1.2",
                "-f",
                "lavfi",
                "-i",
                "anoisesrc=amplitude=0.02:duration=1.2",
                "-filter_complex",
                "[0:a][1:a]amix=inputs=2:duration=shortest",
                "-ar",
                "48000",
                "-ac",
                "2",
            ])
            .arg(&input)
            .status()
            .expect("ffmpeg disponible");
        assert!(generated.success());
        let result = process_audio(
            &input,
            &dir,
            DialoguePreset::Dialogue,
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            |_, _| {},
        )
        .expect("procesar el WAV real");
        assert!(result.bytes > 1_000);
        assert!(result.duration_seconds > 1.0);
        assert_eq!(result.effects.len(), 8);
        println!(
            "voz real: {} bytes, {:.2}s, {}",
            result.bytes, result.duration_seconds, result.path
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
