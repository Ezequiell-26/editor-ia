//! Exploración de archivos para el asistente.
//!
//! El agente puede listar carpetas y buscar material por nombre en todo el
//! equipo, pero **solo devuelve metadatos** (nombre, ruta, tamaño, fecha). La
//! lectura de contenido está acotada a archivos de texto pequeños y con
//! extensiones conocidas, para no volcar binarios ni credenciales al modelo.
//!
//! Todo se ejecuta en el proceso local: no hay red ni comandos de shell.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Carpetas que nunca aportan material y sí pueden tardar muchísimo.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "Windows",
    "WinSxS",
    "$Recycle.Bin",
    "System Volume Information",
    "AppData",
];

/// Extensiones que se pueden leer como texto sin riesgo de binarios.
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "srt", "vtt", "csv", "json", "log", "cube", "xml", "yaml", "yml", "ini", "editoria",
];

const DEFAULT_LIST_LIMIT: usize = 300;
const DEFAULT_SEARCH_LIMIT: usize = 120;
const MAX_DEPTH: usize = 6;
const MAX_TEXT_BYTES: usize = 256 * 1024;

/// Nombres habituales de las carpetas del usuario (inglés y español).
const USER_PROFILE_FOLDERS: &[&str] = &[
    "Downloads",
    "Descargas",
    "Desktop",
    "Escritorio",
    "Documents",
    "Documentos",
    "Videos",
    "Vídeos",
    "Pictures",
    "Imágenes",
    "Music",
    "Música",
];

/// Bases de perfil del usuario. Windows permite mover Descargas, Escritorio o
/// Documentos a otra unidad; acá se detectan esos perfiles alternativos.
fn user_bases() -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("USERPROFILE") {
        bases.push(PathBuf::from(home));
    }
    if let Ok(user) = std::env::var("USERNAME") {
        for drive in ["C:", "D:", "E:", "F:"] {
            let candidate = PathBuf::from(format!("{drive}\\Users\\{user}"));
            if candidate.is_dir()
                && !bases
                    .iter()
                    .any(|existing| existing.to_string_lossy().eq_ignore_ascii_case(&candidate.to_string_lossy()))
            {
                bases.push(candidate);
            }
        }
    }
    bases
}

fn existing_user_folders(base: &Path) -> Vec<PathBuf> {
    USER_PROFILE_FOLDERS
        .iter()
        .map(|folder| base.join(folder))
        .filter(|candidate| candidate.is_dir())
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    /// `folder` | `file`
    pub kind: String,
    pub bytes: u64,
    pub modified_ms: u64,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<FsEntry>,
    pub truncated: bool,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsRoot {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTextFile {
    pub path: String,
    pub bytes: u64,
    pub text: String,
    pub truncated: bool,
}

fn io_error(message: impl Into<String>) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, &message.into())
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn entry_for(path: &Path) -> Option<FsEntry> {
    let meta = fs::symlink_metadata(path).ok()?;
    let file_type = meta.file_type();
    let is_link = file_type.is_symlink();
    // Un enlace se reporta como archivo para no recorrerlo por accidente.
    let kind = if file_type.is_dir() && !is_link { "folder" } else { "file" };
    let name = path.file_name()?.to_string_lossy().to_string();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    Some(FsEntry {
        name,
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        bytes: if kind == "file" { meta.len() } else { 0 },
        modified_ms: modified_ms(&meta),
        extension,
    })
}

fn folder_label(name: &str) -> &'static str {
    match name {
        "Downloads" | "Descargas" => "Descargas",
        "Desktop" | "Escritorio" => "Escritorio",
        "Documents" | "Documentos" => "Documentos",
        "Videos" | "Vídeos" => "Videos",
        "Pictures" | "Imágenes" => "Imágenes",
        "Music" | "Música" => "Música",
        _ => "Carpeta",
    }
}

fn known_roots() -> Vec<FsRoot> {
    let mut roots = Vec::new();
    for base in user_bases() {
        let drive = base
            .to_string_lossy()
            .chars()
            .next()
            .unwrap_or('C')
            .to_ascii_uppercase();
        roots.push(FsRoot {
            id: format!("home-{drive}"),
            label: format!("Carpeta personal ({drive}:)"),
            path: base.to_string_lossy().to_string(),
        });
        for candidate in existing_user_folders(&base) {
            let name = candidate
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            roots.push(FsRoot {
                id: format!("{}-{drive}", name.to_lowercase()),
                label: format!("{} ({drive}:)", folder_label(&name)),
                path: candidate.to_string_lossy().to_string(),
            });
        }
    }
    for drive in ["C:\\", "D:\\", "E:\\"] {
        let path = PathBuf::from(drive);
        if path.is_dir() {
            roots.push(FsRoot {
                id: format!("drive-{}", drive.trim_end_matches('\\').to_lowercase()),
                label: format!("Unidad {drive}"),
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    roots
}

fn list_sync(
    path: Option<String>,
    limit: usize,
    include_hidden: bool,
) -> Result<FsListing, ProjectError> {
    let Some(path) = path.map(|value| value.trim().trim_matches('"').to_owned()) else {
        let roots = known_roots();
        let entries = roots
            .into_iter()
            .map(|root| FsEntry {
                name: root.label,
                path: root.path,
                kind: "folder".into(),
                bytes: 0,
                modified_ms: 0,
                extension: String::new(),
            })
            .collect::<Vec<_>>();
        return Ok(FsListing {
            path: String::new(),
            parent: None,
            total: entries.len(),
            entries,
            truncated: false,
        });
    };
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            &format!("no existe la ruta: {path}"),
        ));
    }
    if !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            &format!("no es una carpeta: {path}"),
        ));
    }
    let read = fs::read_dir(&dir).map_err(|error| {
        io_error(format!("no se pudo leer {path}: {error}"))
    })?;
    let mut items: Vec<FsEntry> = read
        .filter_map(|item| item.ok())
        .filter_map(|item| {
            let entry = entry_for(&item.path())?;
            // Las carpetas ocultas (dotfiles) son ruido y suelen contener
            // configuraciones privadas: no se listan salvo pedido explícito.
            if !include_hidden && entry.name.starts_with('.') {
                return None;
            }
            Some(entry)
        })
        .collect();
    items.sort_by(|a, b| {
        let folder_order = (a.kind != "folder").cmp(&(b.kind != "folder"));
        folder_order.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let total = items.len();
    let truncated = total > limit;
    items.truncate(limit);
    Ok(FsListing {
        path,
        parent: dir
            .parent()
            .map(|parent| parent.to_string_lossy().to_string()),
        entries: items,
        truncated,
        total,
    })
}

fn should_skip_dir(name: &str, hidden_ok: bool) -> bool {
    if !hidden_ok && name.starts_with('.') {
        return true;
    }
    SKIPPED_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(name))
}

fn search_walk(
    dir: &Path,
    query: &str,
    extension: Option<&str>,
    depth: usize,
    max_depth: usize,
    limit: usize,
    hidden_ok: bool,
    out: &mut Vec<FsEntry>,
) {
    if out.len() >= limit || depth > max_depth {
        return;
    }
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut children: Vec<PathBuf> = read.filter_map(|item| item.ok()).map(|item| item.path()).collect();
    children.sort();
    for child in children {
        if out.len() >= limit {
            return;
        }
        let Some(name) = child.file_name().map(|value| value.to_string_lossy().to_string()) else {
            continue;
        };
        let is_dir = child.is_dir();
        if is_dir && should_skip_dir(&name, hidden_ok) {
            continue;
        }
        let extension_matches = extension
            .map(|wanted| {
                child
                    .extension()
                    .map(|value| value.to_string_lossy().to_lowercase() == wanted)
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if (extension.is_none() && name.to_lowercase().contains(query)) || extension_matches {
            if let Some(entry) = entry_for(&child) {
                out.push(entry);
            }
        }
        if is_dir {
            search_walk(&child, query, extension, depth + 1, max_depth, limit, hidden_ok, out);
        }
    }
}

fn default_media_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for base in user_bases() {
        for candidate in existing_user_folders(&base) {
            if !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }
    }
    roots
}

fn search_sync(
    root: Option<String>,
    query: String,
    max_depth: usize,
    limit: usize,
) -> Result<FsListing, ProjectError> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "indicá un texto para buscar en los nombres de archivo",
        ));
    }
    // "*.mp4" o ".mp4" buscan por extensión en lugar de por nombre.
    let extension_query = needle
        .strip_prefix("*.")
        .or_else(|| needle.strip_prefix('.'))
        .filter(|ext| ext.len() >= 2 && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()));
    let hidden_ok = needle.starts_with('.');
    let roots: Vec<PathBuf> = match &root {
        Some(path) if !path.trim().is_empty() => vec![PathBuf::from(path.trim())],
        _ => default_media_roots(),
    };
    if roots.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "no hay carpetas de medios conocidas; indicá una ruta",
        ));
    }
    for candidate in &roots {
        if !candidate.is_dir() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                &format!("no es una carpeta: {}", candidate.display()),
            ));
        }
    }
    let mut hits = Vec::new();
    for candidate in &roots {
        if hits.len() >= limit {
            break;
        }
        search_walk(
            candidate,
            &needle,
            extension_query,
            0,
            max_depth,
            limit,
            hidden_ok,
            &mut hits,
        );
    }
    let truncated = hits.len() >= limit;
    Ok(FsListing {
        path: root.unwrap_or_default(),
        parent: None,
        total: hits.len(),
        entries: hits,
        truncated,
    })
}

fn read_text_sync(path: String, max_bytes: usize) -> Result<FsTextFile, ProjectError> {
    let file_path = PathBuf::from(path.trim());
    let extension = file_path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !TEXT_EXTENSIONS.iter().any(|allowed| *allowed == extension) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "sólo se pueden leer archivos de texto (.txt, .md, .srt, .vtt, .csv, .json, .log, .cube, .xml, .yaml, .ini)",
        ));
    }
    let meta = fs::metadata(&file_path).map_err(|error| {
        io_error(format!("no se pudo leer {}: {error}", file_path.display()))
    })?;
    if !meta.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la ruta no es un archivo",
        ));
    }
    let bytes = fs::read(&file_path)
        .map_err(|error| io_error(format!("no se pudo abrir {}: {error}", file_path.display())))?;
    let truncated = bytes.len() > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    let text = String::from_utf8_lossy(slice).to_string();
    Ok(FsTextFile {
        path: file_path.to_string_lossy().to_string(),
        bytes: meta.len(),
        text,
        truncated,
    })
}

/// Extensiones por tipo de material.
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mkv", "avi", "webm", "m4v", "mts", "m2ts", "wmv", "flv", "mpg", "mpeg", "3gp",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "aiff",
];
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "avif",
];

fn media_extensions(kind: &str) -> Vec<&'static str> {
    match kind {
        "audio" => AUDIO_EXTENSIONS.to_vec(),
        "image" => IMAGE_EXTENSIONS.to_vec(),
        "all" => {
            let mut all = VIDEO_EXTENSIONS.to_vec();
            all.extend_from_slice(AUDIO_EXTENSIONS);
            all.extend_from_slice(IMAGE_EXTENSIONS);
            all
        }
        _ => VIDEO_EXTENSIONS.to_vec(),
    }
}

fn media_walk(
    dir: &Path,
    extensions: &[&str],
    name_filter: &str,
    depth: usize,
    max_depth: usize,
    limit: usize,
    out: &mut Vec<FsEntry>,
) {
    if out.len() >= limit || depth > max_depth {
        return;
    }
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut children: Vec<PathBuf> = read.filter_map(|item| item.ok()).map(|item| item.path()).collect();
    children.sort();
    for child in children {
        if out.len() >= limit {
            return;
        }
        let Some(name) = child.file_name().map(|value| value.to_string_lossy().to_string()) else {
            continue;
        };
        let is_dir = child.is_dir();
        if is_dir {
            if should_skip_dir(&name, false) {
                continue;
            }
            media_walk(&child, extensions, name_filter, depth + 1, max_depth, limit, out);
            continue;
        }
        let extension = child
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !extensions.iter().any(|allowed| *allowed == extension) {
            continue;
        }
        if !name_filter.is_empty() && !name.to_lowercase().contains(name_filter) {
            continue;
        }
        if let Some(entry) = entry_for(&child) {
            out.push(entry);
        }
    }
}

fn find_media_sync(
    kind: String,
    root: Option<String>,
    query: Option<String>,
    limit: usize,
) -> Result<FsListing, ProjectError> {
    let extensions = media_extensions(&kind);
    let roots: Vec<PathBuf> = match &root {
        Some(path) if !path.trim().is_empty() => vec![PathBuf::from(path.trim())],
        _ => default_media_roots(),
    };
    if roots.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "no hay carpetas de medios conocidas; indicá una ruta",
        ));
    }
    for candidate in &roots {
        if !candidate.is_dir() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                &format!("no es una carpeta: {}", candidate.display()),
            ));
        }
    }
    let name_filter = query.unwrap_or_default().trim().to_lowercase();
    let mut hits = Vec::new();
    for candidate in &roots {
        if hits.len() >= limit {
            break;
        }
        media_walk(candidate, &extensions, &name_filter, 0, 4, limit, &mut hits);
    }
    hits.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    let truncated = hits.len() >= limit;
    Ok(FsListing {
        path: root.unwrap_or_default(),
        parent: None,
        total: hits.len(),
        entries: hits,
        truncated,
    })
}

/// Raíces conocidas: carpeta personal, sus subcarpetas habituales y unidades.
#[tauri::command]
pub async fn fs_roots() -> Result<Vec<FsRoot>, ProjectError> {
    Ok(known_roots())
}

/// Lista una carpeta. Sin ruta devuelve las raíces conocidas.
#[tauri::command]
pub async fn fs_list(
    path: Option<String>,
    limit: Option<u32>,
    include_hidden: Option<bool>,
) -> Result<FsListing, ProjectError> {
    let limit = limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, 2_000);
    let hidden = include_hidden.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || list_sync(path, limit, hidden))
        .await
        .map_err(|error| io_error(format!("la exploración falló: {error}")))?
}

/// Busca por nombre (sin distinguir mayúsculas) dentro de una carpeta.
/// Sin `root` recorre Descargas, Escritorio, Videos y Documentos.
#[tauri::command]
pub async fn fs_search(
    root: Option<String>,
    query: String,
    max_depth: Option<u32>,
    limit: Option<u32>,
) -> Result<FsListing, ProjectError> {
    let depth = max_depth
        .map(|value| value as usize)
        .unwrap_or(3)
        .clamp(1, MAX_DEPTH);
    let limit = limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, 500);
    tauri::async_runtime::spawn_blocking(move || search_sync(root, query, depth, limit))
        .await
        .map_err(|error| io_error(format!("la búsqueda falló: {error}")))?
}

/// Encuentra material multimedia (video, audio o imagen) en una sola pasada.
#[tauri::command]
pub async fn fs_find_media(
    kind: Option<String>,
    root: Option<String>,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<FsListing, ProjectError> {
    let kind = kind
        .map(|value| value.trim().to_lowercase())
        .filter(|value| matches!(value.as_str(), "video" | "audio" | "image" | "all"))
        .unwrap_or_else(|| "video".into());
    let limit = limit
        .map(|value| value as usize)
        .unwrap_or(80)
        .clamp(1, 500);
    tauri::async_runtime::spawn_blocking(move || find_media_sync(kind, root, query, limit))
        .await
        .map_err(|error| io_error(format!("la búsqueda de material falló: {error}")))?
}

/// Lee un archivo de texto pequeño (máximo 256 KB) de una lista blanca.
#[tauri::command]
pub async fn fs_read_text(path: String, max_bytes: Option<u32>) -> Result<FsTextFile, ProjectError> {
    let limit = max_bytes
        .map(|value| value as usize)
        .unwrap_or(MAX_TEXT_BYTES)
        .clamp(1_024, MAX_TEXT_BYTES);
    tauri::async_runtime::spawn_blocking(move || read_text_sync(path, limit))
        .await
        .map_err(|error| io_error(format!("la lectura falló: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_noise_folders_and_dotfiles() {
        assert!(should_skip_dir("node_modules", false));
        assert!(should_skip_dir("Windows", false));
        assert!(should_skip_dir(".git", false));
        assert!(!should_skip_dir("Proyectos", false));
    }

    #[test]
    fn text_whitelist_rejects_binaries() {
        let dir = std::env::temp_dir();
        let binary = dir.join("olyvia-fs-test.bin");
        fs::write(&binary, b"\x00\x01\x02").ok();
        let result = read_text_sync(binary.to_string_lossy().to_string(), 1024);
        assert!(result.is_err());
        fs::remove_file(&binary).ok();
    }

    #[test]
    fn list_returns_roots_without_path() {
        let listing = list_sync(None, 10, false).expect("roots");
        // Al menos la carpeta personal o una unidad debe existir en Windows.
        assert!(!listing.entries.is_empty());
        assert!(listing.entries.iter().all(|entry| entry.kind == "folder"));
    }

    #[test]
    fn search_accepts_an_extension_filter() {
        let dir = std::env::temp_dir().join("olyvia-fs-search-test");
        fs::create_dir_all(&dir).ok();
        fs::write(dir.join("toma.mp4"), b"x").ok();
        fs::write(dir.join("guion.txt"), b"y").ok();
        let listing = search_sync(Some(dir.to_string_lossy().to_string()), "*.mp4".into(), 1, 10)
            .expect("search");
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].name, "toma.mp4");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn find_media_filters_by_kind_in_one_pass() {
        let dir = std::env::temp_dir().join("olyvia-fs-media-test");
        fs::create_dir_all(&dir).ok();
        fs::write(dir.join("toma.mp4"), b"x").ok();
        fs::write(dir.join("toma.mov"), b"x").ok();
        fs::write(dir.join("voz.wav"), b"x").ok();
        fs::write(dir.join("poster.jpg"), b"x").ok();
        fs::write(dir.join("guion.txt"), b"x").ok();
        let videos = find_media_sync(
            "video".into(),
            Some(dir.to_string_lossy().to_string()),
            None,
            10,
        )
        .expect("videos");
        assert_eq!(videos.entries.len(), 2);
        let all = find_media_sync(
            "all".into(),
            Some(dir.to_string_lossy().to_string()),
            None,
            10,
        )
        .expect("all");
        assert_eq!(all.entries.len(), 4);
        fs::remove_dir_all(&dir).ok();
    }
}
