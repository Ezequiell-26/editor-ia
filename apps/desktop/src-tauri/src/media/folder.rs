//! Nombres de carpeta de medios: el modelo sólo manda un nombre, nunca una
//! ruta. Se rechazan separadores, `..`, unidades y caracteres reservados de
//! Windows.

/// Sanitiza el nombre de carpeta proveniente del asistente/frontend.
/// Devuelve `None` si no es un nombre simple y seguro.
pub fn sanitize_media_folder_name(folder: &str) -> Option<String> {
    let name = folder.trim().trim_matches(['"', '\'', '“', '”', '«', '»']);
    if name.is_empty() || name.chars().count() > 120 {
        return None;
    }
    if name == "." || name == ".." {
        return None;
    }
    if name
        .chars()
        .any(|value| matches!(value, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return None;
    }
    Some(name.to_owned())
}

use std::path::PathBuf;

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Archivo de una carpeta que el asistente puede montar en la timeline.
#[derive(Debug, Clone, Serialize)]
pub struct MediaFolderFile {
    pub path: String,
    pub name: String,
    /// `image`, `audio` o `video`.
    pub kind: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaFolderListing {
    pub directory: String,
    pub files: Vec<MediaFolderFile>,
}

/// Resultado de `search_media_folder`: los medios cuyo nombre coincide más
/// `truncated` cuando el recorrido se cortó por los topes de la búsqueda.
#[derive(Debug, Clone, Serialize)]
pub struct MediaSearchResult {
    pub directory: String,
    pub query: String,
    pub files: Vec<MediaFolderFile>,
    pub truncated: bool,
}

const MEDIA_FOLDER_IMAGE_EXTENSIONS: [&str; 9] = [
    "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "tif",
];
const MEDIA_FOLDER_AUDIO_EXTENSIONS: [&str; 7] =
    ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"];
const MEDIA_FOLDER_VIDEO_EXTENSIONS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mts"];
const MEDIA_FOLDER_MAX_FILES: usize = 300;
/// La búsqueda por nombre recorre más hondo que el listado rápido y acota el
/// trabajo total: sin estos topes una carpeta grande (o una raíz del disco)
/// podría dejar el hilo nativo ocupado demasiado tiempo.
pub const MEDIA_SEARCH_MAX_DEPTH: u8 = 4;
const MEDIA_SEARCH_MAX_VISITED: usize = 20_000;
const MEDIA_SEARCH_MAX_MATCHES: usize = 200;

fn media_folder_kind(path: &std::path::Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if MEDIA_FOLDER_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Some("image")
    } else if MEDIA_FOLDER_AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        Some("audio")
    } else if MEDIA_FOLDER_VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some("video")
    } else {
        None
    }
}

/// Lista imágenes, audio y video hasta dos niveles; ignora cualquier otro archivo.
pub fn collect_media_folder_files(directory: &std::path::Path) -> Vec<MediaFolderFile> {
    let mut files = Vec::new();
    let mut pending = vec![(directory.to_path_buf(), 0u8)];
    while let Some((current, depth)) = pending.pop() {
        if depth > 2 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            if files.len() >= MEDIA_FOLDER_MAX_FILES {
                break;
            }
            let path = entry.path();
            if path.is_dir() {
                if depth < 2 {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            let Some(kind) = media_folder_kind(&path) else {
                continue;
            };
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_owned();
            if name.is_empty() {
                continue;
            }
            let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            files.push(MediaFolderFile {
                path: path.to_string_lossy().into_owned(),
                name,
                kind: kind.to_owned(),
                bytes,
            });
        }
    }
    files.sort_by_key(|left| left.name.to_lowercase());
    files
}

pub fn media_folder_listing(directory: PathBuf) -> MediaFolderListing {
    MediaFolderListing {
        directory: directory.to_string_lossy().into_owned(),
        files: collect_media_folder_files(&directory),
    }
}

/// Busca archivos de medios cuyo nombre contiene `query` (sin distinguir
/// mayúsculas), hasta `MEDIA_SEARCH_MAX_DEPTH` niveles. `kind` filtra por
/// `image`/`audio`/`video`. Devuelve los matches ordenados y si el recorrido
/// se cortó por los topes (hay más resultados de los devueltos).
pub fn collect_media_folder_matches(
    directory: &std::path::Path,
    query: &str,
    kind: Option<&str>,
) -> (Vec<MediaFolderFile>, bool) {
    let needle = query.trim().to_lowercase();
    let mut files = Vec::new();
    let mut pending = vec![(directory.to_path_buf(), 0u8)];
    let mut visited = 0usize;
    let mut truncated = false;
    'outer: while let Some((current, depth)) = pending.pop() {
        if depth > MEDIA_SEARCH_MAX_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MEDIA_SEARCH_MAX_VISITED {
                truncated = true;
                break 'outer;
            }
            let path = entry.path();
            if path.is_dir() {
                if depth < MEDIA_SEARCH_MAX_DEPTH {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            let Some(file_kind) = media_folder_kind(&path) else {
                continue;
            };
            if let Some(want) = kind {
                if file_kind != want {
                    continue;
                }
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_owned();
            if name.is_empty() {
                continue;
            }
            if !name.to_lowercase().contains(&needle) {
                continue;
            }
            let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            files.push(MediaFolderFile {
                path: path.to_string_lossy().into_owned(),
                name,
                kind: file_kind.to_owned(),
                bytes,
            });
            if files.len() >= MEDIA_SEARCH_MAX_MATCHES {
                truncated = true;
                break 'outer;
            }
        }
    }
    files.sort_by_key(|file| file.name.to_lowercase());
    (files, truncated)
}

/// Valida el texto de búsqueda (1–200 caracteres tras trim).
pub fn validate_media_search_query(query: &str) -> Result<String, ProjectError> {
    let query = query.trim().to_owned();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "La búsqueda necesita un texto de 1 a 200 caracteres.",
        ));
    }
    Ok(query)
}

/// Normaliza el filtro de tipo: `None`, `image`, `audio` o `video`.
pub fn normalize_media_search_kind(kind: Option<String>) -> Result<Option<String>, ProjectError> {
    match kind.map(|value| value.trim().to_ascii_lowercase()) {
        Some(value) if value.is_empty() => Ok(None),
        Some(value) if matches!(value.as_str(), "image" | "audio" | "video") => Ok(Some(value)),
        Some(_) => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "El tipo de medio debe ser image, audio o video.",
        )),
        None => Ok(None),
    }
}

/// Resuelve una carpeta por ruta absoluta o por nombre dentro de `root` y del
/// destino de Descargas (`downloads_dir`). Nunca acepta una ruta del modelo
/// para el nombre (sólo `folder` puede ser ruta absoluta explícita).
pub fn resolve_media_folder_dir(
    folder: &str,
    root: Option<String>,
    downloads_dir: Option<PathBuf>,
) -> Result<PathBuf, ProjectError> {
    let trimmed = folder.trim().trim_matches(['"', '\'', '“', '”', '«', '»']);
    let direct_path = PathBuf::from(trimmed);
    if direct_path.is_dir() {
        let listing = media_folder_listing(direct_path.clone());
        if !listing.files.is_empty() {
            return Ok(direct_path);
        }
    }

    let name = sanitize_media_folder_name(folder).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "El nombre de la carpeta no es válido.",
        )
    })?;
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(root) = root.map(|value| value.trim().to_owned()) {
        if !root.is_empty() {
            let candidate = PathBuf::from(&root);
            if candidate.is_dir() {
                roots.push(candidate);
            }
        }
    }
    if let Some(downloads) = downloads_dir {
        if downloads.is_dir() {
            roots.push(downloads);
        }
    }
    for root in roots {
        let direct = root.join(&name);
        if direct.is_dir() {
            let listing = media_folder_listing(direct);
            if !listing.files.is_empty() {
                return Ok(listing.directory.into());
            }
        }
        let nested = root.join("Videos descargados");
        if let Ok(entries) = std::fs::read_dir(&nested) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let candidate = entry.path().join(&name);
                if candidate.is_dir() {
                    let listing = media_folder_listing(candidate);
                    if !listing.files.is_empty() {
                        return Ok(listing.directory.into());
                    }
                }
            }
        }
    }
    let message =
        format!("No encontré la carpeta «{name}» con imágenes, audio o video en Descargas.");
    Err(ProjectError::message(ProjectErrorCode::Io, &message))
}
