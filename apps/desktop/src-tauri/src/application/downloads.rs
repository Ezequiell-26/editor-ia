//! DTOs y lógica pura del subsistema de descargas (yt-dlp + post-proceso
//! FFmpeg): contrato IPC, límites, parsers JSON→DTO, validadores, naming de
//! carpetas y publicación de archivos. No conoce Tauri ni procesos: la
//! ejecución vive en `commands::downloader`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_URL_LENGTH: usize = 2_048;
pub const MAX_PROBE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_GALLERY_ITEMS: usize = 12;
pub const MAX_ENGINE_BYTES: usize = 200 * 1024 * 1024;
pub const MAX_HEIGHT: u32 = 4_320;
pub const ENGINE_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
pub const ENGINE_SUMS_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";

pub const IMAGE_EXTENSIONS: [&str; 8] =
    ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic"];
pub const VIDEO_EXTENSIONS: [&str; 9] = [
    "mp4", "mkv", "webm", "mov", "avi", "flv", "ts", "m4v", "3gp",
];
pub const AUDIO_EXTENSIONS: [&str; 6] = ["mp3", "m4a", "aac", "opus", "wav", "flac"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloaderStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub managed: bool,
    pub can_install: bool,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorSegment {
    pub category: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQuality {
    pub height: u32,
    pub label: String,
    pub width: Option<u32>,
    pub fps: Option<f64>,
    pub ext: Option<String>,
    pub vcodec: Option<String>,
    pub filesize: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProbe {
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_seconds: Option<f64>,
    pub thumbnail: Option<String>,
    pub kind: String,
    pub entry_count: usize,
    pub max_height: Option<u32>,
    pub estimated_bytes: Option<u64>,
    pub qualities: Vec<DownloadQuality>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub index: usize,
    pub title: String,
    pub url: Option<String>,
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub format_id: String,
    pub language: Option<String>,
    pub ext: Option<String>,
    pub abr: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    /// UUID estable para reanudar un trabajo y reutilizar sus `.part`.
    pub run_id: Option<String>,
    pub max_height: Option<u32>,
    pub compression: Option<String>,
    pub codec: Option<String>,
    /// `tonemap` (SDR) o `preserve` (HDR 10-bit HEVC).
    pub hdr_mode: Option<String>,
    /// Objetivo de tamaño final en MB; calcula bitrate y reemplaza al CRF.
    pub target_size_mb: Option<u64>,
    /// Conserva el archivo original además del procesado.
    pub keep_original: Option<bool>,
    pub kind: Option<String>,
    pub playlist: Option<bool>,
    pub cookies_file: Option<String>,
    /// `chrome`, `edge`, `firefox`, `brave`, `chromium`, `opera` o `vivaldi`.
    pub cookies_from_browser: Option<String>,
    pub format: Option<String>,
    pub save_to_downloads: Option<bool>,
    pub quality: Option<String>,
    pub destination_root: Option<String>,
    /// Look cinematográfico 35 mm: 60 fps por flujo óptico, 0.98×, grano,
    /// zoom 4 %, espejo y reemplazo o eliminación del audio.
    pub cinematic: Option<bool>,
    pub cinematic_focus: Option<String>,
    pub replacement_audio: Option<String>,
    /// Pipeline automático post-descarga: denoise + cine + H.265 CRF 22,
    /// hash MD5 nuevo y limpieza del original, antes de mover a destino.
    pub auto_pipeline: Option<bool>,
    /// Trata la pista original: 1.02× con atempo y ruido rosa a -50 dB.
    pub audio_speed_noise: Option<bool>,
    /// Genera una narración con Piper y la usa como audio final.
    pub voice_pipeline: Option<bool>,
    pub voice_script: Option<String>,
    /// Superpone resources/watermark.png sobre el video procesado.
    pub watermark: Option<bool>,
    /// Parche `delogo` proporcional en una esquina para marcas de agua fijas.
    pub delogo: Option<bool>,
    /// `top-right`, `top-left`, `bottom-right` o `bottom-left`.
    pub delogo_corner: Option<String>,
    /// Rectángulo manual en fracciones 0–1 del canvas; reemplaza la esquina.
    pub delogo_rect: Option<DelogoManualRect>,
    /// Escalado Lanczos sólo si el origen queda por debajo del objetivo.
    pub upscale: Option<bool>,
    /// `auto` (1080p cortos / 4K largos), `1080` o `2160`.
    pub upscale_target: Option<String>,
    /// Enrutamiento automático por duración y palabras clave del título.
    pub auto_route: Option<bool>,
    pub source_title: Option<String>,
    pub source_duration: Option<f64>,
    /// Proxy HTTP/SOCKS para yt-dlp.
    pub proxy: Option<String>,
    /// Límite de bajada de yt-dlp (por ejemplo `8M` o `500K`).
    pub limit_rate: Option<String>,
    pub download_subtitles: Option<bool>,
    /// Lista de idiomas para `--sub-langs` (por ejemplo `es.*,en.*`.
    pub subtitle_langs: Option<String>,
    pub download_thumbnail: Option<bool>,
    pub download_chapters: Option<bool>,
    pub sponsorblock: Option<bool>,
    /// Categorías de SponsorBlock separadas por coma.
    pub sponsorblock_categories: Option<String>,
    /// Categorías que se marcan en el capítulo en vez de quitarse.
    pub sponsorblock_mark: Option<String>,
    /// Categorías cuyos tramos se silencian después de descargar.
    pub sponsorblock_mute: Option<String>,
    /// Plantilla de nombre; acepta {title}, {id}, {platform}, {height} y {date}.
    pub filename_template: Option<String>,
    /// Lista de elementos de playlist, por ejemplo `1-10` o `1,3,5`.
    pub playlist_items: Option<String>,
    /// Idioma de audio preferido (`es`, `en`, `pt-BR`) o `all`.
    pub audio_language: Option<String>,
    /// format_id de audio elegido tras el análisis.
    pub audio_format_id: Option<String>,
    /// Metadatos que se escriben al contenedor final.
    pub metadata_title: Option<String>,
    pub metadata_artist: Option<String>,
    pub metadata_comment: Option<String>,
    /// Imagen que se incrusta como carátula.
    pub cover_path: Option<String>,
    /// Calcula MD5 y SHA-256 de todos los archivos descargados.
    pub hash_files: Option<bool>,
    /// SHA-256 esperado; si ningún archivo coincide, la descarga se marca como error.
    pub expected_sha256: Option<String>,
    /// Recorte previo a la descarga en segundos.
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    /// Tamaño estimado que devolvió el probe, para el chequeo de disco.
    pub estimated_bytes: Option<u64>,
}

/// Rectángulo manual del parche `delogo`, en fracciones 0–1 del canvas.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelogoManualRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedChapter {
    pub start_seconds: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedSubtitle {
    pub path: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub kind: String,
    /// MD5 del archivo final. Sólo se informa para videos procesados.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub md5: Option<String>,
    /// SHA-256 del archivo final; identifica el asset reencodeado completo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// Capítulos leídos con FFprobe después de mover el archivo.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub chapters: Vec<DownloadedChapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub run_id: String,
    pub directory: String,
    pub files: Vec<DownloadedFile>,
    pub compressed: bool,
    pub warnings: Vec<String>,
    /// Subtítulos SRT/VTT leídos del destino para importarlos al proyecto.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subtitles: Vec<DownloadedSubtitle>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub run_id: String,
    pub stage: String,
    pub percent: Option<f64>,
    pub message: String,
}

fn invalid_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
}

fn io_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::Io, &message)
}

pub fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("archivo");
    let direct = directory.join(file_name);
    if !direct.exists() {
        return direct;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 2..=999 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let suffix = &Uuid::new_v4().to_string()[..8];
    directory.join(format!("{stem}-{suffix}{extension}"))
}

pub fn parse_playlist_entries(value: &Value, limit: usize) -> Vec<PlaylistEntry> {
    value["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(position, entry)| {
            let title = entry["title"].as_str()?.trim();
            if title.is_empty() {
                return None;
            }
            let url = entry["webpage_url"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| entry["url"].as_str().map(str::to_owned))
                .or_else(|| {
                    entry["id"]
                        .as_str()
                        .map(|id| format!("https://www.youtube.com/watch?v={id}"))
                });
            Some(PlaylistEntry {
                index: entry["playlist_index"]
                    .as_u64()
                    .map(|value| value as usize)
                    .unwrap_or(position + 1),
                title: title.chars().take(200).collect(),
                url,
                duration_seconds: entry["duration"].as_f64(),
            })
        })
        .take(limit.clamp(1, 1000))
        .collect()
}

pub fn parse_audio_tracks(value: &Value) -> Vec<AudioTrack> {
    let mut tracks = Vec::new();
    for format in value["formats"].as_array().into_iter().flatten() {
        if format["acodec"].as_str().unwrap_or("none") == "none" {
            continue;
        }
        if format["vcodec"].as_str().unwrap_or("none") != "none" {
            continue;
        }
        let Some(format_id) = format["format_id"].as_str() else {
            continue;
        };
        if tracks
            .iter()
            .any(|track: &AudioTrack| track.format_id == format_id)
        {
            continue;
        }
        tracks.push(AudioTrack {
            format_id: format_id.to_owned(),
            language: format["language"].as_str().map(str::to_owned),
            ext: format["ext"].as_str().map(str::to_owned),
            abr: format["abr"].as_f64(),
            note: format["format_note"].as_str().map(str::to_owned),
        });
        if tracks.len() >= 30 {
            break;
        }
    }
    tracks.sort_by(|a, b| {
        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tracks
}

pub fn valid_format_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
}

pub fn audio_language(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let lower = value.to_ascii_lowercase();
    if lower == "all" {
        return Ok(Some(lower));
    }
    let valid = lower.split('-').enumerate().all(|(index, part)| {
        let expected = if index == 0 { 2..=3 } else { 2..=2 };
        expected.contains(&part.len()) && part.chars().all(|ch| ch.is_ascii_alphabetic())
    });
    if !valid || lower.split('-').count() > 2 {
        return Err("El idioma de audio debe ser un código como es, en, pt-BR o all.".to_owned());
    }
    Ok(Some(lower))
}

pub fn download_output_template(
    directory: &Path,
    template: Option<&str>,
) -> Result<String, String> {
    let default = "%(title).60s [%(id)s]";
    let custom = template.map(str::trim).filter(|value| !value.is_empty());
    let mut name = if let Some(custom) = custom {
        if custom.len() > 120
            || custom.contains("..")
            || custom.chars().any(|character| {
                character.is_control()
                    || matches!(
                        character,
                        '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                    )
            })
        {
            return Err(
                "La plantilla de nombre no puede superar 120 caracteres ni incluir rutas o caracteres prohibidos."
                    .to_owned(),
            );
        }
        custom
            .replace("{title}", "%(title).60s")
            .replace("{id}", "%(id)s")
            .replace("{platform}", "%(extractor)s")
            .replace("{height}", "%(height)s")
            .replace("{date}", "%(upload_date)s")
    } else {
        default.to_owned()
    };
    if name.trim().is_empty() {
        name = default.to_owned();
    }
    Ok(directory
        .join(format!("{name}.%(ext)s"))
        .to_string_lossy()
        .into_owned())
}

pub fn playlist_items(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 100
        || !value
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, ',' | '-' | ':'))
    {
        return Err(
            "Los elementos de playlist sólo aceptan números, comas, guiones y dos puntos (ej. 1-10 o 1,3,5)."
                .to_owned(),
        );
    }
    Ok(Some(value.to_owned()))
}

/// Turns the downloaded file stem into a folder name. Invalid Windows
/// characters are replaced, whitespace is collapsed and the name is capped so
/// the final path stays usable. The original file name remains untouched.
/// Windows still fails with OSError 22 when the temporary path + title +
/// yt-dlp suffixes cross MAX_PATH. Keep the readable title below 60 chars and
/// let yt-dlp produce Windows-safe names; the per-video folder is derived from
/// that short stem.
pub fn folder_from_file_name(name: &str) -> Option<String> {
    let raw_stem = Path::new(name).file_stem()?.to_string_lossy();
    let stem = raw_stem
        .strip_suffix(" - compacto")
        .unwrap_or(raw_stem.as_ref());
    let mut cleaned = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        {
            cleaned.push('_');
        } else {
            cleaned.push(character);
        }
    }
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed
        .trim_matches([' ', '.'])
        .chars()
        .take(80)
        .collect::<String>();
    let trimmed = trimmed.trim_end_matches([' ', '.']).to_owned();
    if trimmed.is_empty() {
        return None;
    }
    let upper = trimmed.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=9).contains(&value))
        || upper
            .strip_prefix("LPT")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=9).contains(&value));
    Some(if reserved {
        format!("_{trimmed}")
    } else {
        trimmed
    })
}

pub fn download_folder_name(files: &[DownloadedFile]) -> Option<String> {
    files
        .first()
        .and_then(|file| folder_from_file_name(&file.name))
}

/// The user can choose any existing folder, so downloads can live on another
/// disk. The default is Downloads/Videos descargados. The chosen folder stays
/// as typed (no `\\?\` prefix) and is validated before any file is moved.
pub fn resolve_destination_root(
    chosen: Option<&str>,
    default: PathBuf,
) -> Result<PathBuf, ProjectError> {
    let Some(chosen) = chosen.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(default);
    };
    let path = PathBuf::from(chosen);
    if !path.is_absolute() {
        return Err(invalid_error(
            "La carpeta de descarga debe ser una ruta absoluta.",
        ));
    }
    if !path.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "La carpeta de descarga ya no existe. Elegí otra carpeta.",
        ));
    }
    Ok(path)
}

pub fn move_download_to(
    outcome: &mut DownloadOutcome,
    destination: &Path,
) -> Result<(), ProjectError> {
    std::fs::create_dir_all(destination)
        .map_err(|_| io_error("No se pudo crear Videos descargados."))?;
    let mut moved = Vec::with_capacity(outcome.files.len());
    for file in &outcome.files {
        let source = PathBuf::from(&file.path);
        let target = unique_destination(destination, &file.name);
        if std::fs::rename(&source, &target).is_err() {
            std::fs::copy(&source, &target)
                .map_err(|_| io_error("No se pudo guardar el archivo en Descargas."))?;
            std::fs::remove_file(&source).map_err(|_| {
                io_error("Se copió el archivo pero no se pudo limpiar el temporal.")
            })?;
        }
        let bytes = std::fs::metadata(&target)
            .map(|metadata| metadata.len())
            .unwrap_or(file.bytes);
        moved.push(DownloadedFile {
            path: target.to_string_lossy().into_owned(),
            name: target
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| file.name.clone()),
            bytes,
            kind: file.kind.clone(),
            md5: file.md5.clone(),
            sha256: file.sha256.clone(),
            chapters: file.chapters.clone(),
        });
    }
    outcome.files = moved;
    outcome.directory = destination.to_string_lossy().into_owned();
    Ok(())
}

// ---------------------------------------------------------------------------
// Reglas y helpers del pipeline de descarga (metadata, SponsorBlock,
// enrutado automático, hashes, progreso). Movidos desde
// `commands/domains/downloader/downloader/media_filters/`.
// ---------------------------------------------------------------------------

use std::io::Read;

use md5::Md5;
use sha2::{Digest, Sha256};

pub fn file_md5(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "No se pudo abrir el archivo final para calcular su MD5.".to_owned())?;
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo final para calcular su MD5.".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "No se pudo abrir el archivo final para calcular su SHA-256.".to_owned())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo final para calcular su SHA-256.".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn media_extension(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn downloaded_kind(path: &Path) -> &'static str {
    let extension = media_extension(path);
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        "image"
    } else if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        "audio"
    } else if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        "video"
    } else {
        "other"
    }
}

pub fn parse_progress_percent(line: &str) -> Option<f64> {
    let percent_index = line.find('%')?;
    let token = line[..percent_index].split_whitespace().last()?;
    token
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| (0.0..=100.0).contains(value))
}

pub fn subtitle_languages(value: Option<&str>) -> Result<String, String> {
    let value = value.unwrap_or("es.*,en.*").trim();
    if value.is_empty() || value.len() > 120 {
        return Err("La lista de idiomas de subtítulos no es válida.".to_owned());
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | ',' | '*' | '-' | '_'))
    {
        return Err(
            "Los idiomas de subtítulos sólo pueden usar letras, números, ., *, , y -.".to_owned(),
        );
    }
    Ok(value.to_owned())
}

pub fn sponsorblock_categories(value: Option<&str>) -> Result<String, String> {
    const ALLOWED: [&str; 8] = [
        "sponsor",
        "selfpromo",
        "interaction",
        "intro",
        "outro",
        "preview",
        "filler",
        "music_offtopic",
    ];
    let raw = value.unwrap_or("sponsor,selfpromo,interaction");
    let mut selected: Vec<&str> = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !ALLOWED.contains(&item) {
            return Err(format!("Categoría de SponsorBlock desconocida: {item}."));
        }
        if !selected.contains(&item) {
            selected.push(item);
        }
    }
    if selected.is_empty() {
        return Err("Elegí al menos una categoría de SponsorBlock.".to_owned());
    }
    Ok(selected.join(","))
}

pub fn sponsorblock_category_list(value: Option<&str>) -> Result<Vec<String>, String> {
    Ok(sponsorblock_categories(value)?
        .split(',')
        .map(str::to_owned)
        .collect())
}

/// Extrae el ID de 11 caracteres de las formas habituales de YouTube.
pub fn youtube_video_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (_, rest) = trimmed.split_once("://")?;
    let (host, path) = rest.split_once('/')?;
    let host = host
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    let mut candidate = None;
    if host == "youtu.be" {
        candidate = path.split(['?', '#', '/']).next();
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        if let Some(query) = path.strip_prefix("watch?") {
            candidate = query.split('&').find_map(|pair| pair.strip_prefix("v="));
        } else {
            candidate = path.split('/').find(|part| {
                !part.is_empty() && !matches!(*part, "shorts" | "embed" | "live" | "v" | "e")
            });
        }
    }
    let id = candidate?.trim();
    (id.len() == 11
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    .then(|| id.to_owned())
}

pub fn parse_sponsor_segments(value: &Value) -> Vec<SponsorSegment> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let segment = item["segment"].as_array()?;
            let start = segment.first()?.as_f64()?;
            let end = segment.get(1)?.as_f64()?;
            if !start.is_finite() || !end.is_finite() || end <= start {
                return None;
            }
            Some(SponsorSegment {
                category: item["category"].as_str().unwrap_or("sponsor").to_owned(),
                start_seconds: start,
                end_seconds: end,
                action: item["actionType"].as_str().unwrap_or("skip").to_owned(),
            })
        })
        .take(200)
        .collect()
}

/// Tratamiento opcional de la pista original: acelera 2 % sin cambiar el
/// tono y suma ruido rosa a -50 dB antes de la normalización de emisión.
/// Los títulos de música conservan la pista original: el enrutador no debe
/// sustituirla por Piper ni por una banda, aunque el video sea corto.
pub fn title_prefers_original_audio(title: &str) -> bool {
    let lower = title.to_lowercase();
    [
        "music", "song", "lyrics", "cover", "música", "musica", "canción", "cancion",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

/// Decisión estática del enrutador automático. No consulta IA ni red: sólo la
/// duración conocida y el título. Se resuelve una vez por archivo y se puede
/// recalcular después de descargar si la duración llegó vacía.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoRouteDecision {
    pub long_video: bool,
    pub music: bool,
}

impl AutoRouteDecision {
    pub fn pick(duration_seconds: f64, title: &str) -> Self {
        Self {
            long_video: duration_seconds > 60.0,
            music: title_prefers_original_audio(title),
        }
    }

    /// Sólo los videos cortos no musicales reciben narración Piper.
    /// Los cortos no musicales conservan y masterizan la pista original; la
    /// voz Piper queda como opción manual explícita, no automática.
    pub fn master_original_audio(self) -> bool {
        !self.music && !self.long_video
    }

    /// Los videos largos aceleran 2 % y suman ruido; la música nunca.
    pub fn speed_and_noise(self) -> bool {
        self.long_video && !self.music
    }

    /// La música conserva la pista sin filtros de velocidad ni ruido.
    pub fn preserves_original_audio_without_voice(self) -> bool {
        self.music
    }

    pub fn summary(self) -> &'static str {
        match (self.music, self.long_video) {
            (true, true) => "música larga: look rápido sin flujo óptico y audio original intacto",
            (true, false) => "música: look completo y audio original intacto",
            (false, true) => {
                "video largo: look rápido sin flujo óptico y audio 1,02× con ruido −50 dB"
            }
            (false, false) => {
                "video corto: look completo con flujo óptico y audio original masterizado"
            }
        }
    }
}

/// Selector `-f` de yt-dlp para video: mejor calidad bajo `max_height`,
/// o el peor stream válido cuando la calidad pedida es `worst`.
pub fn video_format_selector(quality: &str, max_height: u32) -> String {
    if quality == "worst" {
        return "worstvideo[height>=144]+worstaudio/worst[height>=144]/worst".to_owned();
    }
    format!("bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best")
}

/// Orden de selección para `-S` (yt-dlp `--format-sort`): máxima resolución
/// primero; a igual resolución y fps gana el códec más eficiente — el orden
/// interno de `vcodec` de yt-dlp ya es av01 > vp9 > h265 > h264, así que a
/// igual píxel se baja el peso sin tocar la imagen (nunca se re-codifica,
/// sólo se elige el stream). `lang` va después de `vcodec` para no tocar la
/// elección de video pero sí desempatar el audio por idioma. `acodec`
/// prefiere opus/mp4a sobre el resto.
pub fn video_format_sort(audio_language: Option<&str>) -> String {
    match audio_language.filter(|lang| *lang != "all") {
        Some(lang) => format!("res,fps,vcodec,lang:{lang},acodec,ext,proto,hasaud"),
        None => "res,fps,vcodec,acodec,ext,proto,hasaud".to_owned(),
    }
}

/// Recorta espacios y limita la cantidad de caracteres (no bytes).
pub fn truncate(value: &str, limit: usize) -> String {
    value.trim().chars().take(limit).collect()
}

/// Última línea no vacía de stderr, recortada — para mensajes de error de
/// procesos externos sin volcar el log completo.
pub fn error_tail(stderr: &str, fallback: &str) -> String {
    let line = stderr
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(fallback);
    truncate(line, 320)
}

/// Valida el nombre del navegador para `--cookies-from-browser`.
pub fn cookies_browser(raw: Option<&str>) -> Result<Option<String>, ProjectError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value = value.to_ascii_lowercase();
    if matches!(
        value.as_str(),
        "chrome" | "edge" | "firefox" | "brave" | "chromium" | "opera" | "vivaldi"
    ) {
        Ok(Some(value))
    } else {
        Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "El navegador de cookies no es compatible.",
        ))
    }
}
