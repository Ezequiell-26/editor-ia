//! Casos de uso de exportación sin recodificar (lossless).
//!
//! FFmpeg copia paquetes: el corte cae en el keyframe anterior y por eso el
//! resultado reporta duración real y desplazamiento del inicio. Las rutas de
//! herramientas llegan por `MediaTools`/`MediaRunner`; la reserva de nombres
//! y el filesystem por `LosslessOutputs`.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::ports::media::{MediaRunner, MediaTools};
use crate::ports::render::LosslessOutputs;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::lossless::{
    audio_container, chapters_metadata, parse_audio_codec, parse_probe_duration, valid_container,
    valid_range, ChapterInput, ChaptersResult, ExtractResult, LosslessResult,
};

fn ffmpeg_path(tools: &dyn MediaTools) -> PathBuf {
    tools
        .ffmpeg_path()
        .unwrap_or_else(|| PathBuf::from("ffmpeg"))
}

fn ffprobe_path(tools: &dyn MediaTools) -> PathBuf {
    tools
        .ffprobe_path()
        .unwrap_or_else(|| PathBuf::from("ffprobe"))
}

fn spawn_error() -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, "no pude ejecutar FFmpeg")
}

fn require_source(outputs: &dyn LosslessOutputs, input: &str) -> Result<PathBuf, ProjectError> {
    let source = PathBuf::from(input.trim());
    if !outputs.is_file(&source) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de origen no existe",
        ));
    }
    Ok(source)
}

fn probe_duration(runner: &dyn MediaRunner, ffprobe: &Path, path: &Path) -> Option<f64> {
    let args = [
        "-v".to_owned(),
        "error".to_owned(),
        "-show_entries".to_owned(),
        "format=duration".to_owned(),
        "-of".to_owned(),
        "default=noprint_wrappers=1:nokey=1".to_owned(),
        path.to_string_lossy().into_owned(),
    ];
    let output = runner.run_ffprobe(ffprobe, &args).ok()?;
    parse_probe_duration(&String::from_utf8_lossy(&output.stdout))
}

fn probe_audio_codec(runner: &dyn MediaRunner, ffprobe: &Path, path: &Path) -> Option<String> {
    let args = [
        "-v".to_owned(),
        "error".to_owned(),
        "-select_streams".to_owned(),
        "a:0".to_owned(),
        "-show_entries".to_owned(),
        "stream=codec_name".to_owned(),
        "-of".to_owned(),
        "default=noprint_wrappers=1:nokey=1".to_owned(),
        path.to_string_lossy().into_owned(),
    ];
    let output = runner.run_ffprobe(ffprobe, &args).ok()?;
    parse_audio_codec(&String::from_utf8_lossy(&output.stdout))
}

/// Corta `input` entre `start_seconds` y `end_seconds` sin recodificar
/// (`-c copy`), o con recodificación acotada si `exact` es true.
pub fn export_lossless(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    outputs: &dyn LosslessOutputs,
    input: &str,
    output: &str,
    start_seconds: f64,
    end_seconds: f64,
    exact: Option<bool>,
) -> Result<LosslessResult, ProjectError> {
    let source = require_source(outputs, input)?;
    if !valid_range(start_seconds, end_seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango no es válido: el fin tiene que ser mayor que el inicio",
        ));
    }
    let reservation = outputs.reserve(&source, Path::new(output.trim()), false)?;
    let target = reservation.path.clone();

    let ffmpeg = ffmpeg_path(tools);
    let ffprobe = ffprobe_path(tools);

    let exact = exact.unwrap_or(false);
    let mut args = vec![
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-ss".to_owned(),
        start_seconds.to_string(),
        "-to".to_owned(),
        end_seconds.to_string(),
        "-i".to_owned(),
        source.to_string_lossy().into_owned(),
    ];
    if exact {
        // Corte exacto: recodifica sólo el rango. Más lento, pero el inicio cae
        // donde se pidió en vez de en el keyframe anterior.
        let encoder = crate::render::ffmpeg::software_encoder(&ffprobe, "h264");
        args.extend([
            "-c:v".to_owned(),
            encoder.clone(),
            "-preset".to_owned(),
            "veryfast".to_owned(),
            "-crf".to_owned(),
            "18".to_owned(),
        ]);
        if !encoder.starts_with("libx26") {
            args.extend(["-b:v".to_owned(), "12000000".to_owned()]);
        }
        args.extend([
            "-c:a".to_owned(),
            "aac".to_owned(),
            "-b:a".to_owned(),
            "192k".to_owned(),
        ]);
    } else {
        args.extend([
            "-c".to_owned(),
            "copy".to_owned(),
            "-avoid_negative_ts".to_owned(),
            "make_zero".to_owned(),
        ]);
    }
    args.extend(["-y".to_owned(), target.to_string_lossy().into_owned()]);
    let output_result = runner
        .run_ffmpeg(&ffmpeg, &args, None)
        .map_err(|_| spawn_error())?;
    if !output_result.status.success() {
        outputs.remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg failed to export the requested range; partial output removed",
        ));
    }

    let bytes = outputs.file_bytes(&target);
    let actual = probe_duration(runner, &ffprobe, &target).unwrap_or(end_seconds - start_seconds);
    let requested = end_seconds - start_seconds;
    Ok(LosslessResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        requested_seconds: requested,
        actual_seconds: actual,
        start_shift_seconds: if exact {
            0.0
        } else {
            (requested - actual).max(0.0)
        },
    })
}

/// Cambia el contenedor sin tocar los códecs (`-c copy`).
pub fn remux(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    outputs: &dyn LosslessOutputs,
    input: &str,
    output: &str,
) -> Result<LosslessResult, ProjectError> {
    let source = require_source(outputs, input)?;
    let requested = PathBuf::from(output.trim());
    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !valid_container(extension) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el contenedor debe ser mp4, mkv, mov o webm",
        ));
    }
    let reservation = outputs.reserve(&source, &requested, false)?;
    let target = reservation.path.clone();
    let ffmpeg = ffmpeg_path(tools);
    let ffprobe = ffprobe_path(tools);

    let args = vec![
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-i".to_owned(),
        source.to_string_lossy().into_owned(),
        "-c".to_owned(),
        "copy".to_owned(),
        "-y".to_owned(),
        target.to_string_lossy().into_owned(),
    ];
    let result = runner
        .run_ffmpeg(&ffmpeg, &args, None)
        .map_err(|_| spawn_error())?;
    if !result.status.success() {
        outputs.remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no pudo cambiar el contenedor; salida descartada",
        ));
    }
    let bytes = outputs.file_bytes(&target);
    let duration = probe_duration(runner, &ffprobe, &target).unwrap_or(0.0);
    Ok(LosslessResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        requested_seconds: duration,
        actual_seconds: duration,
        start_shift_seconds: 0.0,
    })
}

/// Escribe capítulos y título dentro de una copia del archivo, sin recodificar.
pub fn write_chapters(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    outputs: &dyn LosslessOutputs,
    input: &str,
    output: &str,
    title: Option<String>,
    chapters: Vec<ChapterInput>,
) -> Result<ChaptersResult, ProjectError> {
    let source = require_source(outputs, input)?;
    if chapters.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay marcadores para escribir como capítulos",
        ));
    }
    let mut reservation = outputs.reserve(&source, Path::new(output.trim()), true)?;
    let target = reservation.path.clone();
    let (metadata_path, mut metadata_file) = reservation.take_metadata().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no pude reservar los metadatos de capitulos",
        )
    })?;
    let metadata = chapters_metadata(title.as_deref(), &chapters);
    if metadata_file.write_all(metadata.as_bytes()).is_err() {
        outputs.remove_file(&metadata_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no pude escribir los metadatos",
        ));
    }
    drop(metadata_file);

    let ffmpeg = ffmpeg_path(tools);
    let args = vec![
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-i".to_owned(),
        source.to_string_lossy().into_owned(),
        "-i".to_owned(),
        metadata_path.to_string_lossy().into_owned(),
        "-map_metadata".to_owned(),
        "1".to_owned(),
        "-map_chapters".to_owned(),
        "1".to_owned(),
        "-c".to_owned(),
        "copy".to_owned(),
        "-y".to_owned(),
        target.to_string_lossy().into_owned(),
    ];
    let result = runner
        .run_ffmpeg(&ffmpeg, &args, None)
        .map_err(|_| spawn_error());
    outputs.remove_file(&metadata_path);
    let result = result?;
    if !result.status.success() {
        outputs.remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no pudo escribir los capítulos en ese contenedor",
        ));
    }
    let bytes = outputs.file_bytes(&target);
    Ok(ChaptersResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        chapters: chapters.len(),
    })
}

/// Extrae la primera pista de audio sin recodificar.
pub fn extract_audio(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    outputs: &dyn LosslessOutputs,
    input: &str,
    output: &str,
) -> Result<ExtractResult, ProjectError> {
    let source = require_source(outputs, input)?;
    let ffmpeg = ffmpeg_path(tools);
    let ffprobe = ffprobe_path(tools);

    let codec = probe_audio_codec(runner, &ffprobe, &source).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no tiene una pista de audio",
        )
    })?;
    // El contenedor lo decide el códec: así nunca hay que recodificar.
    let mut requested = PathBuf::from(output.trim());
    if requested.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta la ruta de salida",
        ));
    }
    requested.set_extension(audio_container(&codec));
    let reservation = outputs.reserve(&source, &requested, false)?;
    let target = reservation.path.clone();
    let args = vec![
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-i".to_owned(),
        source.to_string_lossy().into_owned(),
        "-vn".to_owned(),
        "-map".to_owned(),
        "0:a:0".to_owned(),
        "-c".to_owned(),
        "copy".to_owned(),
        "-y".to_owned(),
        target.to_string_lossy().into_owned(),
    ];
    let result = runner
        .run_ffmpeg(&ffmpeg, &args, None)
        .map_err(|_| spawn_error())?;
    if !result.status.success() {
        outputs.remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no pudo extraer el audio",
        ));
    }
    let bytes = outputs.file_bytes(&target);
    Ok(ExtractResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        codec,
    })
}
