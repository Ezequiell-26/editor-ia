//! Casos de uso del motor de conversión, compresión y lote de exportación.
//!
//! Orquesta sesión → herramientas → validación de dominio → args → runner →
//! resultado. Las cuatro operaciones comparten `compress_input` y el sondeo
//! no fatal del archivo publicado. Los mensajes de error son los históricos.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use uuid::Uuid;

use crate::application::media::probe_file_json;
use crate::media::conversion::{
    build_args, crf_for_quality, parse_probe_result, quality_clamp, safe_stem,
    validate_compress_target_mode, video_bitrate_for_target, BatchConversionItem,
    CompressAnyRequest, CompressInput, CompressParams, CompressRequest, ConversionResult,
    ConversionTarget, ConvertOptions, ConvertProgress, EncoderPref, EnhanceOptions, LiveProgress,
};
use crate::ports::conversion::{ConversionDeps, ConversionFiles, ConversionRunner};
use crate::ports::projects::ProjectSessionInfo;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::HardwareEncoders;

/// Un asset del proyecto resuelto a un archivo real en disco.
struct AssetInput {
    kind: String,
    label: String,
    path: PathBuf,
    source_bytes: u64,
}

/// Resuelve un asset del proyecto abierto a un archivo real en disco. Comparte
/// las reglas de siempre: el material tiene que estar `ready` y vivir dentro de
/// la carpeta del proyecto.
fn resolve_asset_input(
    deps: &ConversionDeps<'_>,
    session: &ProjectSessionInfo,
    asset_id: &str,
) -> Result<AssetInput, ProjectError> {
    let opened = deps.documents.open(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|item| item["id"].as_str() == Some(asset_id))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere convertir no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("").to_string();
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "confirmá los derechos del material antes de convertirlo",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = crate::media::resolve_inside_root(&session.root, relative)?;
    if !deps.files.is_file(&path) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }
    let source_bytes = deps.files.file_len(&path);
    Ok(AssetInput {
        kind,
        label: asset["label"].as_str().unwrap_or("medio").to_string(),
        path,
        source_bytes,
    })
}

/// Herramientas externas: ffmpeg obligatorio, ffprobe opcional.
fn resolve_tools<'a>(
    deps: &'a ConversionDeps<'_>,
    missing: &str,
) -> Result<(PathBuf, Option<PathBuf>), ProjectError> {
    let ffmpeg = deps
        .tools
        .ffmpeg_path()
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, missing))?;
    Ok((ffmpeg, deps.tools.ffprobe_path()))
}

fn require_output_dir(
    deps: &ConversionDeps<'_>,
    output_dir: &str,
) -> Result<PathBuf, ProjectError> {
    let output_root = PathBuf::from(output_dir.trim());
    if output_root.as_os_str().is_empty() || !deps.files.is_dir(&output_root) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    Ok(output_root)
}

fn temp_output_path(dir: &Path, prefix: &str, extension: &str) -> PathBuf {
    dir.join(format!("{prefix}-{}.{}", Uuid::new_v4(), extension))
}

/// Sondeo no fatal del archivo (mismo formato que `probe_result` del worker):
/// bytes del filesystem + duración/formato vía ffprobe. Nunca rompe la operación.
fn probe_media_info(
    files: &dyn ConversionFiles,
    media_runner: &dyn crate::ports::media::MediaRunner,
    ffprobe: Option<&Path>,
    path: &Path,
) -> (u64, Option<f64>, String) {
    let bytes = files.file_len(path);
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
    let Ok(output) = media_runner.run_ffprobe(ffprobe, &args) else {
        return (bytes, None, String::new());
    };
    if !output.status.success() {
        return (bytes, None, String::new());
    }
    parse_probe_result(&output.stdout, bytes)
}

fn conversion_options(
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<&str>,
    enhance: Option<EnhanceOptions>,
) -> ConvertOptions {
    ConvertOptions {
        encoder: EncoderPref::parse(encoder),
        enhance: enhance.unwrap_or_default(),
        ..ConvertOptions::simple(quality_clamp(quality), max_width)
    }
}

/// `convert_media`: un asset del proyecto a un formato de la allowlist.
pub fn convert_media(
    deps: &ConversionDeps<'_>,
    asset_id: &str,
    target: &str,
    output_dir: &str,
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<&str>,
    enhance: Option<EnhanceOptions>,
) -> Result<ConversionResult, ProjectError> {
    let session = deps.session.require()?;
    let (ffmpeg, ffprobe) =
        resolve_tools(deps, "ffmpeg no está disponible para convertir material")?;
    let target = ConversionTarget::parse(target).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato de salida no está permitido",
        )
    })?;
    let output_root = require_output_dir(deps, output_dir)?;
    let input = resolve_asset_input(deps, &session, asset_id)?;
    if !target.accepts(&input.kind) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato elegido no acepta este tipo de material",
        ));
    }
    let final_path = output_root.join(format!(
        "{}.{}",
        safe_stem(&input.label),
        target.extension()
    ));
    if deps.files.path_exists(&final_path) {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con ese nombre en la carpeta de destino",
        ));
    }
    let temp_path = temp_output_path(&output_root, ".editoria-convert", target.extension());
    let options = conversion_options(quality, max_width, encoder, enhance);
    let hardware = deps.hardware.detect(&ffmpeg);
    let (args, encoder_used) = build_args(
        &input.path,
        &temp_path,
        target,
        &input.kind,
        options,
        &hardware,
    )?;
    let (bytes, duration_seconds, format_name) = deps.runner.run(
        &ffmpeg,
        ffprobe.as_deref(),
        &args,
        &temp_path,
        &final_path,
        &session.root,
        None,
    )?;
    Ok(ConversionResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        duration_seconds,
        format_name,
        source_bytes: input.source_bytes,
        encoder: encoder_used,
    })
}

/// `convert_media_batch`: muchos assets en una corrida; cada ítem reporta su
/// resultado y nunca aborta la cola. Emite `convert-progress` por fase.
pub fn convert_media_batch(
    deps: &ConversionDeps<'_>,
    asset_ids: &[String],
    target: &str,
    output_dir: &str,
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<&str>,
    enhance: Option<EnhanceOptions>,
) -> Result<Vec<BatchConversionItem>, ProjectError> {
    let session = deps.session.require()?;
    let (ffmpeg, ffprobe) =
        resolve_tools(deps, "ffmpeg no está disponible para convertir material")?;
    let target = ConversionTarget::parse(target).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato de salida no está permitido",
        )
    })?;
    let output_root = require_output_dir(deps, output_dir)?;
    if asset_ids.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí al menos un medio para convertir",
        ));
    }
    if asset_ids.len() > 200 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "un lote acepta hasta 200 medios por corrida",
        ));
    }

    let options = conversion_options(quality, max_width, encoder, enhance);
    let hardware = deps.hardware.detect(&ffmpeg);
    let total = asset_ids.len();
    let mut items: Vec<BatchConversionItem> = Vec::with_capacity(total);

    for (index, asset_id) in asset_ids.iter().enumerate() {
        let input = match resolve_asset_input(deps, &session, asset_id) {
            Ok(input) => input,
            Err(error) => {
                items.push(BatchConversionItem {
                    asset_id: asset_id.clone(),
                    label: asset_id.clone(),
                    ok: false,
                    path: None,
                    bytes: None,
                    source_bytes: 0,
                    duration_seconds: None,
                    format_name: None,
                    encoder: None,
                    message: Some(error.message),
                });
                continue;
            }
        };
        deps.events.batch_progress(&ConvertProgress {
            index,
            total,
            label: input.label.clone(),
            phase: "start".into(),
            ok: true,
        });

        let outcome = (|| {
            if !target.accepts(&input.kind) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el formato elegido no acepta este tipo de material",
                ));
            }
            let final_path = deps.files.unique_output(
                &output_root,
                &safe_stem(&input.label),
                target.extension(),
            );
            let temp_path = temp_output_path(&output_root, ".editoria-convert", target.extension());
            let (args, encoder_used) = build_args(
                &input.path,
                &temp_path,
                target,
                &input.kind,
                options,
                &hardware,
            )?;
            let (bytes, duration_seconds, format_name) = deps.runner.run(
                &ffmpeg,
                ffprobe.as_deref(),
                &args,
                &temp_path,
                &final_path,
                &session.root,
                None,
            )?;
            Ok((
                final_path,
                bytes,
                duration_seconds,
                format_name,
                encoder_used,
            ))
        })();

        let item = match outcome {
            Ok((path, bytes, duration_seconds, format_name, encoder_used)) => BatchConversionItem {
                asset_id: asset_id.clone(),
                label: input.label.clone(),
                ok: true,
                path: Some(path.to_string_lossy().into_owned()),
                bytes: Some(bytes),
                source_bytes: input.source_bytes,
                duration_seconds,
                format_name: Some(format_name),
                encoder: Some(encoder_used),
                message: None,
            },
            Err(error) => BatchConversionItem {
                asset_id: asset_id.clone(),
                label: input.label.clone(),
                ok: false,
                path: None,
                bytes: None,
                source_bytes: input.source_bytes,
                duration_seconds: None,
                format_name: None,
                encoder: None,
                message: Some(error.message),
            },
        };
        deps.events.batch_progress(&ConvertProgress {
            index,
            total,
            label: item.label.clone(),
            phase: "done".into(),
            ok: item.ok,
        });
        items.push(item);
    }

    Ok(items)
}

/// El tramo común de toda compresión: parámetros, FFmpeg y publicación.
///
/// Las herramientas y los encoders de hardware llegan resueltos: así el mismo
/// tramo sirve al comando con proyecto, al comando por ruta y a la prueba real.
#[allow(clippy::too_many_arguments)]
pub(crate) fn compress_input(
    files: &dyn ConversionFiles,
    runner: &dyn ConversionRunner,
    media_runner: &dyn crate::ports::media::MediaRunner,
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    hardware: &HardwareEncoders,
    input: &CompressInput,
    params: &CompressParams<'_>,
    output_root: &Path,
    sanitize_root: &Path,
    progress: Option<&LiveProgress>,
) -> Result<ConversionResult, ProjectError> {
    if !params.target.accepts(&input.kind) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "sólo se pueden comprimir videos",
        ));
    }
    let audio_kbps = params.audio_kbps.unwrap_or(128).clamp(32, 512);
    let quality = quality_clamp(params.quality);
    let mut options = ConvertOptions {
        encoder: EncoderPref::parse(params.encoder),
        enhance: params.enhance.unwrap_or_default(),
        max_width: params.max_width,
        audio_bitrate_kbps: Some(audio_kbps),
        ..ConvertOptions::simple(quality, params.max_width)
    };
    if params.mode == "size" {
        let target_megabytes = params.target_megabytes.unwrap_or(0.0);
        if !(0.1..=20_000.0).contains(&target_megabytes) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el tamaño objetivo va de 0,1 MB a 20 GB",
            ));
        }
        let duration = probe_media_info(files, media_runner, ffprobe, &input.path).1;
        options.video_bitrate_kbps = Some(video_bitrate_for_target(
            target_megabytes,
            duration.unwrap_or(0.0),
            audio_kbps,
        ));
    } else {
        options.crf = Some(crf_for_quality(quality));
    }

    let final_path = output_root.join(format!(
        "{}.{}",
        safe_stem(&input.label),
        params.target.extension()
    ));
    if files.path_exists(&final_path) {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con ese nombre en la carpeta de destino",
        ));
    }
    let temp_path = temp_output_path(
        &output_root,
        ".editoria-compress",
        params.target.extension(),
    );
    let (args, encoder_used) = build_args(
        &input.path,
        &temp_path,
        params.target,
        &input.kind,
        options,
        hardware,
    )?;
    let (bytes, duration_seconds, format_name) = runner.run(
        ffmpeg,
        ffprobe,
        &args,
        &temp_path,
        &final_path,
        sanitize_root,
        progress,
    )?;
    Ok(ConversionResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        duration_seconds,
        format_name,
        source_bytes: input.source_bytes,
        encoder: encoder_used,
    })
}

fn live_progress(deps: &ConversionDeps<'_>, total_seconds: f64) -> LiveProgress {
    let events = Arc::clone(&deps.events);
    LiveProgress {
        total_seconds,
        emit: Arc::new(move |percent| events.compress_progress(percent)),
    }
}

/// `compress_media`: compresión de un asset del proyecto con progreso en vivo.
pub fn compress_media(
    deps: &ConversionDeps<'_>,
    request: &CompressRequest,
) -> Result<ConversionResult, ProjectError> {
    let session = deps.session.require()?;
    let (target, mode) = validate_compress_target_mode(&request.target, &request.mode)?;
    let output_root = require_output_dir(deps, &request.output_dir)?;
    let input = resolve_asset_input(deps, &session, &request.asset_id)?;
    let (ffmpeg, ffprobe) =
        resolve_tools(deps, "ffmpeg no está disponible para comprimir material")?;
    let hardware = deps.hardware.detect(&ffmpeg);
    let params = CompressParams {
        target,
        mode: &mode,
        quality: request.quality,
        target_megabytes: request.target_megabytes,
        audio_kbps: request.audio_kbps,
        encoder: request.encoder.as_deref(),
        max_width: request.max_width,
        enhance: request.enhance,
    };
    let total_seconds = probe_media_info(
        deps.files,
        deps.media_runner,
        ffprobe.as_deref(),
        &input.path,
    )
    .1;
    let progress = live_progress(deps, total_seconds.unwrap_or(0.0));
    compress_input(
        deps.files,
        deps.runner,
        deps.media_runner,
        &ffmpeg,
        ffprobe.as_deref(),
        &hardware,
        &CompressInput {
            path: input.path,
            kind: input.kind,
            label: input.label,
            source_bytes: input.source_bytes,
        },
        &params,
        &output_root,
        &session.root,
        Some(&progress),
    )
}

/// `compress_any_file`: compresión de un archivo suelto del disco, sin
/// proyecto abierto. Es el corazón del modo "Comprimir como pro": cualquier
/// video que FFmpeg lea, con el número verificable (antes → después).
pub fn compress_any_file(
    deps: &ConversionDeps<'_>,
    request: &CompressAnyRequest,
) -> Result<ConversionResult, ProjectError> {
    let (target, mode) = validate_compress_target_mode(&request.target, &request.mode)?;
    let output_root = require_output_dir(deps, &request.output_dir)?;
    let input_path = PathBuf::from(request.input_path.trim());
    if input_path.as_os_str().is_empty() || !deps.files.is_file(&input_path) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo a comprimir no está en disco",
        ));
    }
    let (ffmpeg, ffprobe) =
        resolve_tools(deps, "ffmpeg no está disponible para comprimir material")?;
    // Sondeo: se acepta por contenido, no por extensión. Si FFmpeg no ve una
    // pista de video, no es material de compresión.
    let probe = probe_file_json(deps.media_runner, ffprobe.as_deref(), &input_path)?;
    if probe["video"].is_null() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "ese archivo no tiene pista de video: la compresión es para video",
        ));
    }
    let source_bytes = deps.files.file_len(&input_path);
    let label = input_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let input = CompressInput {
        path: input_path,
        kind: "video".to_owned(),
        label,
        source_bytes,
    };
    let params = CompressParams {
        target,
        mode: &mode,
        quality: request.quality,
        target_megabytes: request.target_megabytes,
        audio_kbps: request.audio_kbps,
        encoder: request.encoder.as_deref(),
        max_width: request.max_width,
        enhance: request.enhance,
    };
    let hardware = deps.hardware.detect(&ffmpeg);
    let total_seconds = probe["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .unwrap_or(0.0);
    let progress = live_progress(deps, total_seconds);
    // El log se sanea contra la carpeta de salida: el origen puede estar en
    // cualquier lado y no conviene filtrar rutas del usuario en el error.
    let sanitize_root = output_root.clone();
    compress_input(
        deps.files,
        deps.runner,
        deps.media_runner,
        &ffmpeg,
        ffprobe.as_deref(),
        &hardware,
        &input,
        &params,
        &output_root,
        &sanitize_root,
        Some(&progress),
    )
}

#[cfg(test)]
#[path = "conversion.tests.rs"]
mod tests;
