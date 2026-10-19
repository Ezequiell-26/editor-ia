//! Media import, measurement and thumbnails.
//!
//! Importing is non-destructive: the source file stays where it is and a copy
//! lands under `<project>/media/`. Every imported asset records its SHA-256,
//! byte count and measured media metadata; the legal rights are declared by the
//! person in the UI, never invented here. An asset starts `unverified` with an
//! unknown licence until that declaration exists.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::projects::service::{now_rfc3339, ProjectError, ProjectErrorCode};

pub const MAX_IMPORT_FILES: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Image,
    Audio,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Video => "video",
            MediaKind::Image => "image",
            MediaKind::Audio => "audio",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMeasure {
    pub kind: MediaKind,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub frame_rate_num: Option<u32>,
    pub frame_rate_den: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub assets: Vec<Value>,
    pub warnings: Vec<String>,
}

pub fn is_forbidden_relative(path: &str) -> Option<&'static str> {
    if path.is_empty() {
        return Some("la ruta está vacía");
    }
    if path.len() > 512 {
        return Some("la ruta excede los 512 caracteres");
    }
    if path.starts_with('/') || path.starts_with('~') {
        return Some("la ruta es absoluta");
    }
    if path.as_bytes().get(1) == Some(&b':')
        && path.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
    {
        return Some("la ruta trae letra de unidad");
    }
    if path.contains('\\') {
        return Some("la ruta usa barra invertida");
    }
    if path.contains(['<', '>', ':', '"', '|', '?', '*']) {
        return Some("la ruta usa caracteres reservados");
    }
    if path.ends_with('/') {
        return Some("la ruta termina en separador");
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Some("la ruta tiene un segmento vacío, . o ..");
        }
    }
    None
}

/// Resolve a project-relative path and prove it stays inside the project root.
pub fn resolve_inside_root(root: &Path, relative: &str) -> Result<PathBuf, ProjectError> {
    if let Some(problem) = is_forbidden_relative(relative) {
        return Err(ProjectError::message(
            ProjectErrorCode::PathEscapesRoot,
            problem,
        ));
    }
    let root = root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta del proyecto no está disponible",
        )
    })?;
    let candidate = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let canonical = candidate.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del proyecto ya no está en la ruta registrada",
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(ProjectError::message(
            ProjectErrorCode::PathEscapesRoot,
            "el archivo cae fuera de la carpeta del proyecto",
        ));
    }
    Ok(canonical)
}

pub fn sha256_file(path: &Path) -> Result<(String, u64), ProjectError> {
    let mut handle = File::open(path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo abrir el archivo para medirlo",
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes: u64 = 0;
    loop {
        let read = handle.read(&mut buffer).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo leer el archivo para medirlo",
            )
        })?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok((format!("{:x}", hasher.finalize()), bytes))
}

fn extension_kind(path: &Path) -> Option<MediaKind> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "mts" | "m2ts" => Some(MediaKind::Video),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "avif" => {
            Some(MediaKind::Image)
        }
        "wav" | "mp3" | "m4a" | "aac" | "flac" | "ogg" | "opus" | "wma" => Some(MediaKind::Audio),
        _ => None,
    }
}

fn parse_rate(value: Option<&str>) -> Option<(u32, u32)> {
    let raw = value?;
    let mut parts = raw.split('/');
    let num: u32 = parts.next()?.parse().ok()?;
    let den: u32 = parts.next().unwrap_or("1").parse().ok()?;
    if num == 0 || den == 0 {
        None
    } else {
        Some((num, den))
    }
}

/// Measure with ffprobe. The parse is kept separate so it can be tested with a
/// recorded JSON payload without requiring ffprobe on the test machine.
pub fn parse_probe(kind: MediaKind, payload: &Value) -> MediaMeasure {
    let streams = payload["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|stream| stream["codec_type"].as_str() == Some("video"));
    let audio = streams
        .iter()
        .find(|stream| stream["codec_type"].as_str() == Some("audio"));
    let duration = payload["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .or_else(|| {
            video
                .and_then(|stream| stream["duration"].as_str())
                .and_then(|v| v.parse().ok())
        });
    let (rate_num, rate_den) = video
        .and_then(|stream| parse_rate(stream["avg_frame_rate"].as_str()))
        .unwrap_or((0, 0));

    MediaMeasure {
        kind,
        width: video
            .and_then(|stream| stream["width"].as_u64())
            .map(|value| value as u32),
        height: video
            .and_then(|stream| stream["height"].as_u64())
            .map(|value| value as u32),
        duration_seconds: duration,
        frame_rate_num: (rate_num > 0).then_some(rate_num),
        frame_rate_den: (rate_den > 0).then_some(rate_den),
        sample_rate: audio
            .and_then(|stream| stream["sample_rate"].as_str())
            .and_then(|value| value.parse::<u32>().ok()),
        channels: audio
            .and_then(|stream| stream["channels"].as_u64())
            .map(|value| value as u32),
    }
}

/// Copy every referenced asset from the old project root to the new one,
/// preserving its project-relative path. Used by Save As so a project moved to
/// another folder keeps its media addressable. Nothing is overwritten: if a
/// destination already holds a different file the operation fails before
/// writing the project. On a partial failure, only the files created by this
/// call are removed.
pub fn copy_project_assets(
    project: &Value,
    old_root: &Path,
    new_root: &Path,
) -> Result<Vec<PathBuf>, ProjectError> {
    let old_root = old_root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta original del proyecto no está disponible",
        )
    })?;
    let new_root = new_root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino no está disponible",
        )
    })?;
    if old_root == new_root {
        return Ok(Vec::new());
    }

    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    if assets.len() > 10_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto declara demasiados assets para copiarlos",
        ));
    }

    let mut planned: Vec<(PathBuf, PathBuf)> = Vec::new();
    for asset in &assets {
        let Some(relative) = asset["source"]["path"].as_str() else {
            continue;
        };
        if let Some(problem) = is_forbidden_relative(relative) {
            return Err(ProjectError::message(
                ProjectErrorCode::PathEscapesRoot,
                problem,
            ));
        }
        let source = resolve_inside_root(&old_root, relative)?;
        let destination = new_root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        if destination.exists() {
            let existing = destination
                .canonicalize()
                .unwrap_or_else(|_| destination.clone());
            if existing != source {
                return Err(ProjectError::message(
                    ProjectErrorCode::AlreadyExists,
                    "ya existe un archivo con el mismo nombre relativo en la carpeta de destino; elegí otra carpeta",
                ));
            }
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo preparar la carpeta de destino para copiar los medios",
                )
            })?;
            let parent_canonical = parent.canonicalize().map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "la carpeta de destino no es accesible",
                )
            })?;
            if !parent_canonical.starts_with(&new_root) {
                return Err(ProjectError::message(
                    ProjectErrorCode::PathEscapesRoot,
                    "la copia de medios intentaría salir de la carpeta de destino",
                ));
            }
        }
        planned.push((source, destination));
    }

    let mut created = Vec::new();
    for (source, destination) in planned {
        match std::fs::copy(&source, &destination) {
            Ok(_) => created.push(destination),
            Err(_) => {
                for file in created {
                    let _ = std::fs::remove_file(file);
                }
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudieron copiar los medios a la carpeta de destino; el proyecto no se guardó",
                ));
            }
        }
    }
    Ok(created)
}

pub fn probe_file(
    ffprobe: &Path,
    path: &Path,
    kind: MediaKind,
) -> Result<MediaMeasure, ProjectError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; revisá las capacidades del sistema en Ajustes",
        )
    })?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "ffprobe no pudo leer el archivo elegido",
        ));
    }
    let payload: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidJson,
            "ffprobe devolvió una medición que no se pudo interpretar",
        )
    })?;
    Ok(parse_probe(kind, &payload))
}

fn sanitize_file_name(source: &Path) -> String {
    let original = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_owned());
    let path = Path::new(&original);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_owned());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut safe: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    while safe.contains("--") {
        safe = safe.replace("--", "-");
    }
    let safe = safe.trim_matches('-');
    let base = if safe.is_empty() { "media" } else { safe };
    let base: String = base.chars().take(100).collect();
    if extension.is_empty() {
        base
    } else {
        format!("{}.{}", base, extension)
    }
}

fn unique_destination(directory: &Path, file_name: &str) -> PathBuf {
    let candidate = directory.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_owned());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    for index in 2..10_000 {
        let name = if extension.is_empty() {
            format!("{}-{}", stem, index)
        } else {
            format!("{}-{}.{}", stem, index, extension)
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{}-{}", Uuid::new_v4(), file_name))
}

fn relative_with_forward_slashes(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub fn import_file(
    root: &Path,
    source: &Path,
    ffprobe: &Path,
    project_fps_num: u32,
    project_fps_den: u32,
) -> Result<Value, ProjectError> {
    let metadata = fs::metadata(source).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo elegido no está disponible",
        )
    })?;
    if !metadata.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la selección incluye algo que no es un archivo",
        ));
    }
    if metadata.len() == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo elegido está vacío",
        ));
    }

    let kind = extension_kind(source).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no es un video, una imagen ni un audio reconocido",
        )
    })?;
    let measure = probe_file(ffprobe, source, kind)?;
    if measure.width.unwrap_or(0) == 0 && kind != MediaKind::Audio {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no declara dimensiones de imagen o video",
        ));
    }

    let root_canonical = root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta del proyecto no está disponible",
        )
    })?;
    let media_dir = root_canonical.join("media");
    fs::create_dir_all(&media_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta media del proyecto",
        )
    })?;

    let source_canonical = source.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo elegido no está disponible",
        )
    })?;
    let destination = if source_canonical.starts_with(&media_dir) {
        source_canonical.clone()
    } else {
        let file_name = sanitize_file_name(&source_canonical);
        let destination = unique_destination(&media_dir, &file_name);
        fs::copy(&source_canonical, &destination).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo copiar el archivo a la carpeta media del proyecto",
            )
        })?;
        destination
    };

    let (sha256, bytes) = sha256_file(&destination)?;
    let relative = relative_with_forward_slashes(&destination, &root_canonical);
    let label = destination
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Material".to_owned());
    let acquired_at = now_rfc3339();

    let mut media = serde_json::Map::new();
    match kind {
        MediaKind::Video => {
            media.insert("width".into(), json!(measure.width.unwrap_or(1)));
            media.insert("height".into(), json!(measure.height.unwrap_or(1)));
            let seconds = measure.duration_seconds.unwrap_or(0.0);
            let frames = if seconds > 0.0 && project_fps_num > 0 && project_fps_den > 0 {
                ((seconds * project_fps_num as f64 / project_fps_den as f64).round() as u64).max(1)
            } else {
                1
            };
            media.insert("durationFrames".into(), json!(frames));
            media.insert(
                "frameRate".into(),
                json!({
                    "num": measure.frame_rate_num.unwrap_or(project_fps_num.max(1)),
                    "den": measure.frame_rate_den.unwrap_or(project_fps_den.max(1)),
                }),
            );
        }
        MediaKind::Image => {
            media.insert("width".into(), json!(measure.width.unwrap_or(1)));
            media.insert("height".into(), json!(measure.height.unwrap_or(1)));
        }
        MediaKind::Audio => {
            let seconds = measure.duration_seconds.unwrap_or(0.0);
            let frames = if seconds > 0.0 && project_fps_num > 0 && project_fps_den > 0 {
                ((seconds * project_fps_num as f64 / project_fps_den as f64).round() as u64).max(1)
            } else {
                1
            };
            media.insert(
                "sampleRate".into(),
                json!(measure.sample_rate.unwrap_or(48_000)),
            );
            media.insert("channels".into(), json!(measure.channels.unwrap_or(2)));
            media.insert("durationFrames".into(), json!(frames));
        }
    }

    Ok(json!({
        "id": Uuid::new_v4().to_string(),
        "label": label.chars().take(200).collect::<String>(),
        "kind": kind.as_str(),
        "source": { "type": "local", "path": relative },
        "status": "unverified",
        "integrity": { "sha256": sha256, "bytes": bytes },
        "rights": {
            "license": { "id": "unknown", "commercialUse": "unknown" },
            "provenance": { "origin": "user-imported", "acquiredAt": acquired_at }
        },
        "media": Value::Object(media)
    }))
}

pub fn thumbnail_data_url(
    ffmpeg: &Path,
    source: &Path,
    is_image: bool,
) -> Result<String, ProjectError> {
    let mut command = Command::new(ffmpeg);
    if is_image {
        command.arg("-i").arg(source);
    } else {
        command.args(["-ss", "1"]).arg("-i").arg(source);
    }
    command
        .args([
            "-vf",
            "scale=480:-2",
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-q:v",
            "5",
            "-",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para generar la miniatura",
        )
    })?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo generar la miniatura de este material",
        ));
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe_payload() -> Value {
        json!({
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "30000/1001",
                    "duration": "10.5"
                },
                {
                    "codec_type": "audio",
                    "sample_rate": "48000",
                    "channels": 2
                }
            ],
            "format": { "duration": "10.5" }
        })
    }

    #[test]
    fn parses_a_measured_video() {
        let measure = parse_probe(MediaKind::Video, &probe_payload());
        assert_eq!(measure.width, Some(1920));
        assert_eq!(measure.height, Some(1080));
        assert_eq!(measure.frame_rate_num, Some(30000));
        assert_eq!(measure.frame_rate_den, Some(1001));
        assert_eq!(measure.sample_rate, Some(48_000));
        assert!((measure.duration_seconds.unwrap_or_default() - 10.5).abs() < 0.001);
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        for path in [
            "../fuera.mp4",
            "media/../../fuera.mp4",
            "/etc/passwd",
            "C:/obra/x.mp4",
            "media\\x.mp4",
            "media//x.mp4",
        ] {
            assert!(
                is_forbidden_relative(path).is_some(),
                "{path} debería rechazarse"
            );
        }
        for path in ["media/demo.mp4", "media/narracion-1.wav", "assets/a/b.png"] {
            assert!(
                is_forbidden_relative(path).is_none(),
                "{path} debería aceptarse"
            );
        }
    }

    #[test]
    fn file_names_are_safe_and_keep_the_extension() {
        assert_eq!(
            sanitize_file_name(Path::new("C:/x/Mi Video Ñandú.mp4")),
            "Mi-Video-and.mp4"
        );
        assert_eq!(sanitize_file_name(Path::new("C:/x/___.wav")), "___.wav");
    }

    #[test]
    fn relative_paths_use_forward_slashes() {
        let root = Path::new("C:/obra");
        let path = Path::new("C:/obra/media/demo.mp4");
        assert_eq!(relative_with_forward_slashes(path, root), "media/demo.mp4");
    }

    #[test]
    fn destination_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("editor-ia-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("demo.mp4"), b"one").unwrap();
        let chosen = unique_destination(&dir, "demo.mp4");
        assert_eq!(chosen.file_name().unwrap().to_string_lossy(), "demo-2.mp4");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_as_copies_assets_and_refuses_to_overwrite() {
        let base = std::env::temp_dir().join(format!("editor-ia-copy-{}", Uuid::new_v4()));
        let old_root = base.join("old");
        let new_root = base.join("new");
        std::fs::create_dir_all(old_root.join("media")).unwrap();
        std::fs::create_dir_all(&new_root).unwrap();
        std::fs::write(old_root.join("media/clip.mp4"), b"video-bytes").unwrap();
        let project = json!({
            "assets": [{
                "id": "11111111-1111-4111-8111-111111111111",
                "source": { "type": "local", "path": "media/clip.mp4" }
            }]
        });
        let created = copy_project_assets(&project, &old_root, &new_root).unwrap();
        assert_eq!(created.len(), 1);
        assert_eq!(
            std::fs::read(new_root.join("media/clip.mp4")).unwrap(),
            b"video-bytes"
        );
        assert!(copy_project_assets(&project, &old_root, &new_root).is_err());
        assert!(copy_project_assets(&project, &old_root, &old_root)
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn thumbnails_are_measured_only_when_ffmpeg_answers() {
        // The real invocation is covered by the system capability probe; here we
        // pin that an empty stdout is never turned into a data URL.
        let missing = std::env::temp_dir().join("editor-ia-no-ffmpeg.exe");
        assert!(thumbnail_data_url(&missing, Path::new("C:/x.png"), true).is_err());
    }
}
