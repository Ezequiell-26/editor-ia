//! Herramientas de material estilo caja de herramientas (merge, recorte,
//! marca de agua y metadatos).
//!
//! Cada herramienta recibe assets del proyecto abierto, verifica que estén
//! listos y dentro de la raíz, y escribe el resultado en la carpeta que elige
//! el usuario. Todo pasa por FFmpeg local: sin red y sin codigos arbitrarios —
//! los argumentos se construyen acá.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub path: String,
    pub bytes: u64,
    pub message: String,
}

/** Posiciones de la marca de agua, con el margen ya resuelto. */
pub fn watermark_position(id: &str) -> Option<(&'static str, &'static str)> {
    match id {
        "top-left" => Some(("24", "24")),
        "top-right" => Some(("w-text_w-24", "24")),
        "bottom-left" => Some(("24", "h-text_h-24")),
        "bottom-right" => Some(("w-text_w-24", "h-text_h-24")),
        "center" => Some(("(w-text_w)/2", "(h-text_h)/2")),
        _ => None,
    }
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

fn safe_stem(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('-').to_owned();
    let base = if trimmed.is_empty() {
        "medio"
    } else {
        &trimmed
    };
    base.chars().take(60).collect()
}

/// Busca un asset del proyecto y devuelve `(kind, ruta absoluta)`.
fn resolve_asset(
    session: &crate::state::Session,
    asset_id: &str,
) -> Result<(String, PathBuf), ProjectError> {
    let opened = service::open_project(&session.path)?;
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
                "el material no está en el proyecto",
            )
        })?;
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "confirmá los derechos del material antes de usar esta herramienta",
        ));
    }
    let kind = asset["kind"].as_str().unwrap_or("").to_owned();
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }
    Ok((kind, path))
}

fn ready_output_dir(output_dir: &str) -> Result<PathBuf, ProjectError> {
    let root = PathBuf::from(output_dir.trim());
    if root.as_os_str().is_empty() || !root.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    Ok(root)
}

fn unique_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let base = dir.join(format!("{stem}.{extension}"));
    if !base.exists() {
        return base;
    }
    for attempt in 2..=999 {
        let candidate = dir.join(format!("{stem}-{attempt}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}.{extension}", Uuid::new_v4()))
}

fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[String],
    root: &Path,
    what: &str,
) -> Result<PathBuf, ProjectError> {
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
    Ok(PathBuf::new())
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
    let (ffmpeg, _ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para unir videos",
        )
    })?;

    let mut inputs: Vec<PathBuf> = Vec::new();
    for id in &asset_ids {
        let (kind, path) = resolve_asset(&session, id)?;
        if kind != "video" {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "sólo se pueden unir videos",
            ));
        }
        inputs.push(path);
    }

    let mut args: Vec<String> = Vec::new();
    for input in &inputs {
        args.push("-i".into());
        args.push(input.to_string_lossy().into_owned());
    }
    let mut filter = String::new();
    for (index, _) in inputs.iter().enumerate() {
        filter.push_str(&format!("[{index}:v:0][{index}:a:0]"));
    }
    filter.push_str(&format!("concat=n={}:v=1:a=1[outv][outa]", inputs.len()));
    args.push("-filter_complex".into());
    args.push(filter);
    args.push("-map".into());
    args.push("[outv]".into());
    args.push("-map".into());
    args.push("[outa]".into());
    args.push("-c:v".into());
    args.push("libx264".into());
    args.push("-preset".into());
    args.push("medium".into());
    args.push("-crf".into());
    args.push("20".into());
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    args.push("-c:a".into());
    args.push("aac".into());
    args.push("-b:a".into());
    args.push("192k".into());
    args.push("-movflags".into());
    args.push("+faststart".into());

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
    let (ffmpeg, _ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para recortar",
        )
    })?;

    let (kind, input) = resolve_asset(&session, &asset_id)?;
    if kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el recorte rápido sólo acepta videos",
        ));
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-ss".into(),
        format!("{start_seconds:.3}"),
        "-to".into(),
        format!("{end_seconds:.3}"),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "medium".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
    ];
    let final_path = unique_path(&out_dir, "recorte", "mp4");
    args.push(final_path.to_string_lossy().into_owned());
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
    let (x, y) = watermark_position(position.trim()).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la posición elegida no existe",
        )
    })?;
    let font = find_font().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se encontró una tipoteca del sistema para dibujar la marca de agua",
        )
    })?;
    let session = state.require_session()?;
    let out_dir = ready_output_dir(&output_dir)?;
    let (ffmpeg, _ffprobe, _) = resolve_tools(&state.settings_snapshot()?);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para la marca de agua",
        )
    })?;

    let (kind, input) = resolve_asset(&session, &asset_id)?;
    if kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la marca de agua sólo se aplica a videos",
        ));
    }

    // drawtext exige escapar ':' '\' ''' y '%' dentro del texto.
    let escaped = text
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "\\%");
    let filter = format!(
        "drawtext=fontfile='{}':text='{}':x={}:y={}:fontsize=36:fontcolor=white@0.75:borderw=2:bordercolor=black@0.6",
        font.to_string_lossy(),
        escaped,
        x,
        y
    );

    let final_path = unique_path(&out_dir, "marca-de-agua", "mp4");
    let args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filter,
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "medium".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "copy".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        final_path.to_string_lossy().into_owned(),
    ];
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

    let (kind, input) = resolve_asset(&session, &asset_id)?;
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

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
    ];
    if !title.is_empty() {
        args.push("-metadata".into());
        args.push(format!("title={title}"));
    }
    if !artist.is_empty() {
        args.push("-metadata".into());
        args.push(format!("artist={artist}"));
    }
    if !comment.is_empty() {
        args.push("-metadata".into());
        args.push(format!("comment={comment}"));
    }
    // Copia de streams: sólo cambian los metadatos, no se recodifica.
    args.push("-c".into());
    args.push("copy".into());
    let final_path = unique_path(&out_dir, "con-metadatos", &extension);
    args.push("-y".into());
    args.push(final_path.to_string_lossy().into_owned());
    run_ffmpeg(&ffmpeg, &args, &session.root, "editar los metadatos")?;
    finish(&final_path, "metadatos actualizados")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watermark_positions_are_known() {
        assert_eq!(watermark_position("top-left"), Some(("24", "24")));
        assert_eq!(
            watermark_position("bottom-right"),
            Some(("w-text_w-24", "h-text_h-24"))
        );
        assert_eq!(
            watermark_position("center"),
            Some(("(w-text_w)/2", "(h-text_h)/2"))
        );
        assert_eq!(watermark_position("middle-ish"), None);
    }

    #[test]
    fn drawtext_text_is_escaped() {
        // drawtext exige escapar ':' '\' ''' y '%' dentro del texto.
        let escape = |text: &str| {
            text.replace('\\', "\\\\")
                .replace(':', "\\:")
                .replace('\'', "\\'")
                .replace('%', "\\%")
        };
        assert_eq!(escape("hola"), "hola");
        assert_eq!(escape("a:b"), "a\\:b");
        assert_eq!(escape("100%"), "100\\%");
        assert_eq!(escape("it's"), "it\\'s");
        assert_eq!(escape("c:\\temp"), "c\\:\\\\temp");
    }

    #[test]
    fn unique_path_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("editoria-tools-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "salida", "mp4");
        assert_eq!(first.file_name().unwrap(), "salida.mp4");
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(&dir, "salida", "mp4");
        assert_eq!(second.file_name().unwrap(), "salida-2.mp4");
        let _ = std::fs::remove_dir_all(&dir);
    }
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
    let streams = value["streams"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if streams.is_empty() {
        return Ok(None);
    }
    let mut chosen = 0usize;
    for (index, stream) in streams.iter().enumerate() {
        let language = stream["tags"]["language"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase();
        if language.starts_with("es") || language == "spa" {
            chosen = index;
            break;
        }
    }
    let stream = &streams[chosen];
    let language = stream["tags"]["language"]
        .as_str()
        .map(|value| value.to_owned());
    let title = stream["tags"]["title"].as_str().map(|value| value.to_owned());

    let temp = std::env::temp_dir().join(format!(
        "editoria-subs-{}.srt",
        Uuid::new_v4()
    ));
    let mut command = Command::new(&ffmpeg);
    command
        .args(["-hide_banner", "-v", "error", "-y", "-i"])
        .arg(&input)
        .arg("-map")
        .arg(format!("0:s:{chosen}"))
        .args(["-c:s", "srt", "-f", "srt"])
        .arg(&temp)
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
        let last = detail.lines().last().unwrap_or("FFmpeg no pudo extraer los subtítulos");
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
