//! Herramientas de material (merge, recorte, marca de agua, metadatos,
//! subtítulos incrustados) — dominio puro.
//!
//! Validación de entradas, construcción de los argumentos de FFmpeg, búsqueda
//! del asset dentro del proyecto y nombres de salida únicos. La ejecución del
//! proceso y la sesión IPC quedan en `commands/domains/media/media_tools.rs`.

use std::path::{Path, PathBuf};

use serde_json::Value;
use uuid::Uuid;

use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};

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

/// drawtext exige escapar ':' '\' ''' y '%' dentro del texto.
pub fn escape_drawtext(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "\\%")
}

/// Filtro `drawtext` completo para la marca de agua.
pub fn watermark_filter(font: &Path, text: &str, position: &str) -> Result<String, ProjectError> {
    let (x, y) = watermark_position(position.trim()).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la posición elegida no existe",
        )
    })?;
    Ok(format!(
        "drawtext=fontfile='{}':text='{}':x={}:y={}:fontsize=36:fontcolor=white@0.75:borderw=2:bordercolor=black@0.6",
        font.to_string_lossy(),
        escape_drawtext(text),
        x,
        y
    ))
}

/// Entrada de merge con lo que ffprobe pudo medir: si trae pista de audio
/// y su duración (necesaria para sintetizar silencio cuando falta).
pub struct MergeInput {
    pub path: PathBuf,
    pub has_audio: bool,
    pub duration_seconds: f64,
}

/// Argumentos de `merge_videos`: entradas `-i`, `concat` y el tail de
/// codificación. `codec_args` trae `-c:v` + rate control del encoder que el
/// binario tenga (la capa de comandos lo resuelve: este módulo no lanza
/// procesos). El comando agrega `-y` y la salida.
///
/// AUD-130: un video sin pista de audio rompia el `concat a=1` porque cada
/// segmento exige `[i:a]`. Ahora los inputs sin audio reciben una entrada
/// `anullsrc` adicional con su duración y TODA la audio pasa por
/// `aformat` a 48 kHz estéreo — concat también exige sample rate y layout
/// iguales entre segmentos.
pub fn merge_video_args(inputs: &[MergeInput], codec_args: &[String]) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut lavfi_index = inputs.len();
    let mut filter = String::new();
    for (index, input) in inputs.iter().enumerate() {
        args.push("-i".into());
        args.push(input.path.to_string_lossy().into_owned());
        // Video y audio se normalizan a pads etiquetados: los pads sin
        // etiqueta se conectarían al siguiente filtro del grafo.
        filter.push_str(&format!("[{index}:v:0]null[v{index}];"));
        if input.has_audio {
            // La audio real se normaliza a 48 kHz estéreo para que el
            // concat no falle por sample rate/layout distinto.
            filter.push_str(&format!(
                "[{index}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a{index}];"
            ));
        } else {
            args.push("-f".into());
            args.push("lavfi".into());
            args.push("-t".into());
            args.push(format!("{:.3}", input.duration_seconds.max(0.001)));
            args.push("-i".into());
            args.push("anullsrc=r=48000:cl=stereo".into());
            filter.push_str(&format!(
                "[{lavfi_index}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a{index}];"
            ));
            lavfi_index += 1;
        }
    }
    for index in 0..inputs.len() {
        filter.push_str(&format!("[v{index}][a{index}]"));
    }
    filter.push_str(&format!("concat=n={}:v=1:a=1[outv][outa]", inputs.len()));
    args.push("-filter_complex".into());
    args.push(filter);
    args.push("-map".into());
    args.push("[outv]".into());
    args.push("-map".into());
    args.push("[outa]".into());
    args.extend(codec_args.iter().cloned());
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    args.push("-c:a".into());
    args.push("aac".into());
    args.push("-b:a".into());
    args.push("192k".into());
    args.push("-movflags".into());
    args.push("+faststart".into());
    args
}

/// Argumentos de `trim_video` incluyendo la salida; el `-y` va antes del
/// path. `codec_args` trae `-c:v` + rate control del encoder resuelto por
/// la capa de comandos.
pub fn trim_video_args(
    input: &Path,
    start_seconds: f64,
    end_seconds: f64,
    codec_args: &[String],
    output: &Path,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-ss".into(),
        format!("{start_seconds:.3}"),
        "-to".into(),
        format!("{end_seconds:.3}"),
        "-i".into(),
        input.to_string_lossy().into_owned(),
    ];
    args.extend(codec_args.iter().cloned());
    args.extend([
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output.to_string_lossy().into_owned(),
    ]);
    args
}

/// Argumentos de `watermark_video` incluyendo la salida; `codec_args` trae
/// `-c:v` + rate control del encoder resuelto por la capa de comandos.
pub fn watermark_video_args(
    input: &Path,
    filter: &str,
    codec_args: &[String],
    output: &Path,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filter.to_owned(),
    ];
    args.extend(codec_args.iter().cloned());
    args.extend([
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "copy".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output.to_string_lossy().into_owned(),
    ]);
    args
}

/// Argumentos de `set_metadata`: copia de streams, sólo cambian los tags.
pub fn metadata_args(
    input: &Path,
    title: &str,
    artist: &str,
    comment: &str,
    output: &Path,
) -> Vec<String> {
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
    args.push("-c".into());
    args.push("copy".into());
    args.push("-y".into());
    args.push(output.to_string_lossy().into_owned());
    args
}

/// Índice del stream de subtítulos a extraer: prefiere español, si no el
/// primero. `streams` es el array `streams` del JSON de ffprobe.
pub fn choose_subtitle_stream(streams: &[Value]) -> usize {
    for (index, stream) in streams.iter().enumerate() {
        let language = stream["tags"]["language"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase();
        if language.starts_with("es") || language == "spa" {
            return index;
        }
    }
    0
}

/// Argumentos de extracción a SRT del subtítulo `chosen` (0-based).
pub fn subtitle_extract_args(input: &Path, chosen: usize, output: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-map".into(),
        format!("0:s:{chosen}"),
        "-c:s".into(),
        "srt".into(),
        "-f".into(),
        "srt".into(),
        output.to_string_lossy().into_owned(),
    ]
}

pub fn ready_output_dir(output_dir: &str) -> Result<PathBuf, ProjectError> {
    // La carpeta llega por IPC: política de escritura de `fs_*`.
    let root = crate::application::fs::validate_user_write_path(output_dir)?;
    if !root.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    Ok(root)
}

pub fn unique_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
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

/// Busca un asset del proyecto y devuelve `(kind, ruta absoluta)`. Recibe las
/// rutas del proyecto ya resueltas por la sesión para no depender de `state`.
pub fn resolve_asset(
    project_path: &Path,
    root: &Path,
    asset_id: &str,
) -> Result<(String, PathBuf), ProjectError> {
    let opened = service::open_project(project_path)?;
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
    let path = resolve_inside_root(root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }
    Ok((kind, path))
}

#[cfg(test)]
#[path = "toolbox.tests.rs"]
mod tests;
