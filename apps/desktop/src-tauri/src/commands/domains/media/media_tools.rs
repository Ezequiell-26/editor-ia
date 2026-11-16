//! Herramientas de material estilo caja de herramientas (merge, recorte,
//! marca de agua y metadatos) — adaptadores IPC.
//!
//! La validación, la construcción de argumentos FFmpeg y la búsqueda de
//! assets viven en `crate::media::toolbox`; aquí quedan la sesión, las
//! herramientas resueltas, la ejecución del proceso y el resultado en disco.
//! Todo pasa por FFmpeg local: sin red y sin códigos arbitrarios.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::media::toolbox::{
    choose_subtitle_stream, metadata_args, merge_video_args, ready_output_dir, resolve_asset,
    subtitle_extract_args, trim_video_args, unique_path, watermark_filter, watermark_position,
    watermark_video_args,
};
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub path: String,
    pub bytes: u64,
    pub message: String,
}

/** Fuente para `drawtext`: sin una tipoteca la marca de agua no se puede dibujar. */
fn find_font() -> Option<PathBuf> {
    let candidates = [
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\calibri.ttf",
    ];
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[String],
    root: &Path,
    what: &str,
) -> Result<(), ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-nostats")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo iniciar FFmpeg para {what}"),
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "FFmpeg no pudo {what}: {}",
                sanitize_log(&stderr, root, 300)
            ),
        ));
    }
    Ok(())
}

/// Args de códec de video para las herramientas: resuelve el primer encoder
/// H.264 que el FFmpeg configurado declare y pueda iniciar (el bundle LGPL
/// no trae `libx264`) y arma los flags según su familia. Las dimensiones
/// del input alimentan el bitrate de los fallback sin CRF; si ffprobe no
/// puede medir, se asumen 1080p30 (bitrate conservador ~13 Mbps).
fn tool_video_codec_args(
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    input: &Path,
) -> Result<Vec<String>, ProjectError> {
    let encoder = crate::commands::sharpen::resolve_encoder(ffmpeg)?;
    let (width, height, fps) = ffprobe
        .and_then(|probe| {
            probe_file(probe, input, MediaKind::Video)
                .ok()
                .map(|measure| {
                    (
                        measure.width.unwrap_or(1920),
                        measure.height.unwrap_or(1080),
                        f64::from(measure.frame_rate_num.unwrap_or(30))
                            / f64::from(measure.frame_rate_den.unwrap_or(1).max(1)),
                    )
                })
        })
        .unwrap_or((1920, 1080, 30.0));
    Ok(crate::commands::sharpen::video_codec_args(
        &encoder, 20, width, height, fps,
    ))
}

fn finish(final_path: &Path, message: &str) -> Result<ToolResult, ProjectError> {
    let bytes = std::fs::metadata(final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if bytes == 0 {
        let _ = std::fs::remove_file(final_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la herramienta produjo un archivo vacío",
        ));
    }
    Ok(ToolResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        message: message.to_owned(),
    })
}

// --------------------------------------------------------------------------- //
// Comandos
// --------------------------------------------------------------------------- //

/// Une varios videos en uno solo (mismo tamaño y orientación recomendados).
#[tauri::command]
pub async fn merge_videos(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    output_dir: String,
) -> Result<ToolResult, ProjectError> {
    if asset_ids.len() < 2 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí al menos dos videos para unir",
        ));
    }
    let session = state.require_session()?;
    let out_dir = ready_output_dir(&output_dir)?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para unir videos",
        )
    })?;

    let mut inputs: Vec<PathBuf> = Vec::new();
    for id in &asset_ids {
        let (kind, path) = resolve_asset(&session.path, &session.root, id)?;
        if kind != "video" {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "sólo se pueden unir videos",
            ));
        }
        inputs.push(path);
    }
    // concat exige mismas dimensiones: el bitrate del fallback usa las del
    // primer input (inputs tiene >= 2 elementos por la validación previa).
    let codec_args = tool_video_codec_args(&ffmpeg, ffprobe.as_deref(), &inputs[0])?;

    let mut args = merge_video_args(&inputs, &codec_args);
    let final_path = unique_path(&out_dir, "union", "mp4");
    args.push("-y".into());
    args.push(final_path.to_string_lossy().into_owned());
    run_ffmpeg(&ffmpeg, &args, &session.root, "unir los videos")?;
    finish(&final_path, "videos unidos en un solo MP4")
}

/// Recorta un video entre dos momentos (en segundos).
#[tauri::command]
pub async fn trim_video(
    state: State<'_, AppState>,
    asset_id: String,
    start_seconds: f64,
    end_seconds: f64,
    output_dir: String,
) -> Result<ToolResult, ProjectError> {
    if !start_seconds.is_finite() || !end_seconds.is_finite() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "los tiempos tienen que ser números",
        ));
    }
    if start_seconds < 0.0 || end_seconds <= start_seconds {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el final tiene que ser mayor que el inicio",
        ));
    }
    if end_seconds - start_seconds > 6.0 * 3600.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el recorte no puede durar más de 6 horas",
        ));
    }
    let session = state.require_session()?;
    let out_dir = ready_output_dir(&output_dir)?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para recortar",
        )
    })?;

    let (kind, input) = resolve_asset(&session.path, &session.root, &asset_id)?;
    if kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el recorte rápido sólo acepta videos",
        ));
    }

    let codec_args = tool_video_codec_args(&ffmpeg, ffprobe.as_deref(), &input)?;
    let final_path = unique_path(&out_dir, "recorte", "mp4");
    let args = trim_video_args(&input, start_seconds, end_seconds, &codec_args, &final_path);
    run_ffmpeg(&ffmpeg, &args, &session.root, "recortar el video")?;
    finish(
        &final_path,
        &format!("recorte de {start_seconds:.1}s a {end_seconds:.1}s"),
    )
}

/// Dibuja una marca de agua de texto sobre el video.
#[tauri::command]
pub async fn watermark_video(
    state: State<'_, AppState>,
    asset_id: String,
    text: String,
    position: String,
    output_dir: String,
) -> Result<ToolResult, ProjectError> {
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "escribí el texto de la marca de agua",
        ));
    }
    if text.chars().count() > 80 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la marca de agua no puede pasar los 80 caracteres",
        ));
    }
    if watermark_position(position.trim()).is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la posición elegida no existe",
        ));
    }
    let font = find_font().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se encontró una tipoteca del sistema para dibujar la marca de agua",
        )
    })?;
    let filter = watermark_filter(&font, &text, &position)?;
    let session = state.require_session()?;
    let out_dir = ready_output_dir(&output_dir)?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para la marca de agua",
        )
    })?;

    let (kind, input) = resolve_asset(&session.path, &session.root, &asset_id)?;
    if kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la marca de agua sólo se aplica a videos",
        ));
    }

    let codec_args = tool_video_codec_args(&ffmpeg, ffprobe.as_deref(), &input)?;
    let final_path = unique_path(&out_dir, "marca-de-agua", "mp4");
    let args = watermark_video_args(&input, &filter, &codec_args, &final_path);
    run_ffmpeg(&ffmpeg, &args, &session.root, "aplicar la marca de agua")?;
    finish(&final_path, &format!("marca de agua «{text}» aplicada"))
}

/// Edita los metadatos de un video o audio (título, artista, comentario).
#[tauri::command]
pub async fn set_metadata(
    state: State<'_, AppState>,
    asset_id: String,
    title: String,
    artist: String,
    comment: String,
    output_dir: String,
) -> Result<ToolResult, ProjectError> {
    let title = title.trim().chars().take(120).collect::<String>();
    let artist = artist.trim().chars().take(120).collect::<String>();
    let comment = comment.trim().chars().take(300).collect::<String>();
    if title.is_empty() && artist.is_empty() && comment.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "escribí al menos un campo de metadatos",
        ));
    }
    let session = state.require_session()?;
    let out_dir = ready_output_dir(&output_dir)?;
    let (ffmpeg, _ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para los metadatos",
        )
    })?;

    let (kind, input) = resolve_asset(&session.path, &session.root, &asset_id)?;
    if kind != "video" && kind != "audio" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "los metadatos se editan en videos o audios",
        ));
    }
    let extension = input
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "mp4".into());

    let final_path = unique_path(&out_dir, "con-metadatos", &extension);
    let args = metadata_args(&input, &title, &artist, &comment, &final_path);
    run_ffmpeg(&ffmpeg, &args, &session.root, "editar los metadatos")?;
    finish(&final_path, "metadatos actualizados")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedSubtitles {
    pub language: Option<String>,
    pub title: Option<String>,
    pub srt: String,
}

/// Extrae el primer subtítulo incrustado (prefiere español) a SRT, sin IA ni
/// red. Si el archivo no trae pistas de subtítulos devuelve `None`.
#[tauri::command]
pub async fn extract_subtitles(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<ExtractedSubtitles>, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, path.trim())?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video ya no está en el proyecto",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para extraer subtítulos",
        ));
    };
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no está disponible para leer los subtítulos",
        ));
    };

    let mut probe = Command::new(&ffprobe);
    probe
        .args([
            "-v",
            "error",
            "-select_streams",
            "s",
            "-show_entries",
            "stream=index:stream_tags=language,title",
            "-of",
            "json",
        ])
        .arg(&input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut probe);
    let probed = probe.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo consultar los subtítulos del video",
        )
    })?;
    if !probed.status.success() {
        return Ok(None);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&probed.stdout).unwrap_or_else(|_| serde_json::json!({}));
    let streams = value["streams"].as_array().cloned().unwrap_or_default();
    if streams.is_empty() {
        return Ok(None);
    }
    let chosen = choose_subtitle_stream(&streams);
    let stream = &streams[chosen];
    let language = stream["tags"]["language"]
        .as_str()
        .map(|value| value.to_owned());
    let title = stream["tags"]["title"]
        .as_str()
        .map(|value| value.to_owned());

    let temp = std::env::temp_dir().join(format!("editoria-subs-{}.srt", Uuid::new_v4()));
    let args = subtitle_extract_args(&input, chosen, &temp);
    let mut command = Command::new(&ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para extraer subtítulos",
        )
    })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let detail = String::from_utf8_lossy(&output.stderr);
        let last = detail
            .lines()
            .last()
            .unwrap_or("FFmpeg no pudo extraer los subtítulos");
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudieron extraer los subtítulos: {last}"),
        ));
    }
    let bytes = std::fs::metadata(&temp).map(|meta| meta.len()).unwrap_or(0);
    if bytes == 0 || bytes > 4 * 1024 * 1024 {
        let _ = std::fs::remove_file(&temp);
        return if bytes == 0 {
            Ok(None)
        } else {
            Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "los subtítulos incrustados superan los 4 MB",
            ))
        };
    }
    let srt = std::fs::read_to_string(&temp).unwrap_or_default();
    let _ = std::fs::remove_file(&temp);
    if srt.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(ExtractedSubtitles {
        language,
        title,
        srt,
    }))
}
