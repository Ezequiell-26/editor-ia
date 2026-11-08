//! Adaptadores de infraestructura del motor de conversión.
//!
//! `SystemConversionRunner` reproduce verbatim el worker histórico:
//! `-nostats -progress pipe:1`, thread que junta stderr (cap 256 KB), thread
//! que lee `out_time_us=` y emite porcentaje, espera del proceso, borrado del
//! temporal en error, rename atómico a destino y sondeo ffprobe del resultado.
//! Nunca hay shell: los argumentos ya vienen construidos por el dominio.

use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::infrastructure::process::hide_console;
use crate::media::conversion::{parse_out_time_us, parse_probe_result, LiveProgress};
use crate::ports::conversion::{ConversionEvents, ConversionFiles, ConversionRunner};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{detect_hardware_cached, HardwareEncoders};

/// Filesystem local: existe/lee/borra/renombra y nombres únicos de salida.
pub struct LocalConversionFiles;

impl ConversionFiles for LocalConversionFiles {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn path_exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn file_len(&self, path: &Path) -> u64 {
        fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
    }

    fn remove_file(&self, path: &Path) {
        let _ = fs::remove_file(path);
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<(), ProjectError> {
        fs::rename(from, to).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo publicar el archivo convertido",
            )
        })
    }

    fn unique_output(&self, dir: &Path, stem: &str, extension: &str) -> PathBuf {
        let first = dir.join(format!("{stem}.{extension}"));
        if !first.exists() {
            return first;
        }
        for index in 1..1_000 {
            let candidate = dir.join(format!("{stem}-{index}.{extension}"));
            if !candidate.exists() {
                return candidate;
            }
        }
        dir.join(format!("{stem}-{}.{extension}", Uuid::new_v4()))
    }
}

/// Eventos Tauri: `compress-progress` con `{percent}` y `convert-progress`
/// con el DTO camelCase del lote.
pub struct TauriConversionEvents {
    pub app: AppHandle,
}

impl ConversionEvents for TauriConversionEvents {
    fn compress_progress(&self, percent: f64) {
        let _ = self.app.emit(
            "compress-progress",
            serde_json::json!({ "percent": percent }),
        );
    }

    fn batch_progress(&self, event: &crate::media::conversion::ConvertProgress) {
        let _ = self.app.emit("convert-progress", event);
    }
}

/// Detección real de encoders de hardware con la caché del proceso.
pub struct SystemConversionHardware;

impl crate::ports::conversion::ConversionHardware for SystemConversionHardware {
    fn detect(&self, ffmpeg: &Path) -> HardwareEncoders {
        detect_hardware_cached(ffmpeg)
    }
}

/// Worker FFmpeg de conversión/compresión (verbatim del comando original).
pub struct SystemConversionRunner;

impl ConversionRunner for SystemConversionRunner {
    fn run(
        &self,
        ffmpeg: &Path,
        ffprobe: Option<&Path>,
        args: &[String],
        temp_path: &Path,
        final_path: &Path,
        sanitize_root: &Path,
        progress: Option<&LiveProgress>,
    ) -> Result<(u64, Option<f64>, String), ProjectError> {
        run_conversion(
            ffmpeg,
            ffprobe,
            args,
            temp_path,
            final_path,
            sanitize_root,
            progress,
        )
    }
}

#[allow(clippy::too_many_arguments)]
fn run_conversion(
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    args: &[String],
    temp_path: &Path,
    final_path: &Path,
    sanitize_root: &Path,
    progress: Option<&LiveProgress>,
) -> Result<(u64, Option<f64>, String), ProjectError> {
    // `-progress pipe:1` escribe líneas clave=valor en stdout (`out_time_us`,
    // `progress=continue/end`): es lo que hace posible el porcentaje real
    // durante la compresión. `-nostats` silencia el stderr ruidoso.
    let mut full_args: Vec<String> = Vec::with_capacity(args.len() + 3);
    full_args.push("-nostats".to_owned());
    full_args.push("-progress".to_owned());
    full_args.push("pipe:1".to_owned());
    full_args.extend_from_slice(args);
    let mut command = Command::new(ffmpeg);
    command
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para convertir el material",
        )
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_handle = thread::spawn(move || {
        let Some(stderr) = stderr else {
            return Vec::new();
        };
        let mut collected: Vec<u8> = Vec::with_capacity(8 * 1024);
        let mut reader = BufReader::new(stderr);
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if collected.len() < 256 * 1024 {
                        collected.extend_from_slice(&buffer[..read]);
                    }
                }
            }
        }
        collected
    });
    // El cierre se clona (Arc) FUERA del hilo: así el hilo es dueño de su copia
    // y nada con el lifetime del que llama lo cruza.
    let live = progress.map(|live| (live.total_seconds, live.emit.clone()));
    let progress_handle = thread::spawn(move || {
        let Some(stdout) = stdout else { return };
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Some(micros) = parse_out_time_us(&line) else {
                continue;
            };
            let Some((total_seconds, emit)) = &live else {
                continue;
            };
            if *total_seconds > 0.0 {
                let fraction = (micros as f64 / 1_000_000.0) / total_seconds;
                emit(fraction.clamp(0.0, 0.99) * 100.0);
            }
        }
    });
    let status = child.wait().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo seguir el proceso de FFmpeg",
        )
    })?;
    let stderr_bytes: Vec<u8> = stderr_handle.join().unwrap_or_default();
    let _ = progress_handle.join();
    if !status.success() {
        let _ = fs::remove_file(temp_path);
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo convertir el material: {}",
                crate::render::ffmpeg::sanitize_log(&stderr, sanitize_root, 300)
            )
            .as_str(),
        ));
    }
    let metadata = fs::metadata(temp_path).map_err(|_| {
        let _ = fs::remove_file(temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            "la conversión terminó pero el archivo no existe",
        )
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la conversión produjo un archivo vacío",
        ));
    }
    if final_path.exists() {
        let _ = fs::remove_file(temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "el archivo de destino apareció durante la conversión; no se sobrescribió",
        ));
    }
    fs::rename(temp_path, final_path).map_err(|_| {
        let _ = fs::remove_file(temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo publicar el archivo convertido",
        )
    })?;
    Ok(probe_result(ffprobe, final_path))
}

/// Sondeo no fatal del archivo publicado: bytes + duración + formato.
/// Cualquier fallo devuelve lo que se pueda sin romper la conversión.
fn probe_result(ffprobe: Option<&Path>, path: &Path) -> (u64, Option<f64>, String) {
    let bytes = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    let Some(ffprobe) = ffprobe else {
        return (bytes, None, String::new());
    };
    let args = vec![
        "-v".to_owned(),
        "error".to_owned(),
        "-show_entries".to_owned(),
        "format=format_name,duration,size".to_owned(),
        "-of".to_owned(),
        "json".to_owned(),
        path.to_string_lossy().into_owned(),
    ];
    let mut command = Command::new(ffprobe);
    command.args(&args);
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return (bytes, None, String::new());
    };
    if !output.status.success() {
        return (bytes, None, String::new());
    }
    parse_probe_result(&output.stdout, bytes)
}
