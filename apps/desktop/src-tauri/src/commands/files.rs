//! Exploración y lectura de archivos del disco.
//!
//! Estas dos primitivas son las que le permiten a la IA (vía MCP) *ver* la PC:
//! `fs_list` muestra el contenido de una carpeta (carpetas primero, después
//! archivos, con tipo y tamaño) y `fs_read` devuelve el texto de un archivo
//! acotado. Son de sólo lectura y están pensadas para que el modelo descubra
//! material antes de pedir `asset_import` o abrir un proyecto.
//!
//! No hay escritura: modificar archivos del disco sigue siendo trabajo de los
//! comandos de proyecto/exportación, que validan rutas y formatos.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Tope de entradas por listado: suficiente para cualquier carpeta real y
/// acota el JSON que viaja por IPC.
const FS_LIST_MAX_ENTRIES: usize = 500;
/// Tope de lectura: alcanza para subtítulos, proyectos `.editoria.json` y
/// cualquier texto de trabajo; un binario grande no entra por esta puerta.
const FS_READ_MAX_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    /// `dir`, `image`, `audio`, `video`, `subtitle`, `text` u `other`.
    pub kind: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListing {
    pub directory: String,
    pub entries: Vec<FsEntry>,
    /// `true` cuando la carpeta tiene más entradas que el tope.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsFileContent {
    pub path: String,
    pub bytes: u64,
    /// `true` cuando el archivo superaba el tope y el contenido viene cortado.
    pub truncated: bool,
    pub content: String,
}

const FS_IMAGE_EXTENSIONS: [&str; 9] = [
    "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "tif",
];
const FS_AUDIO_EXTENSIONS: [&str; 7] = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"];
const FS_VIDEO_EXTENSIONS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mts"];
const FS_SUBTITLE_EXTENSIONS: [&str; 4] = ["srt", "vtt", "ass", "ssa"];
const FS_TEXT_EXTENSIONS: [&str; 16] = [
    "txt", "md", "json", "jsonl", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "log",
    "editoria", "fcpxml", "otio", "edl",
];

fn fs_kind(path: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "dir";
    }
    let Some(extension) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return "other";
    };
    if FS_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        "image"
    } else if FS_AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        "audio"
    } else if FS_VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        "video"
    } else if FS_SUBTITLE_EXTENSIONS.contains(&extension.as_str()) {
        "subtitle"
    } else if FS_TEXT_EXTENSIONS.contains(&extension.as_str()) {
        "text"
    } else {
        "other"
    }
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Lista el contenido de una carpeta: primero las subcarpetas, después los
/// archivos, ordenados por nombre. No recursa: la IA baja nivel por nivel.
#[tauri::command]
pub fn fs_list(path: String) -> Result<FsListing, ProjectError> {
    let directory = PathBuf::from(path.trim());
    if !directory.is_dir() {
        return Err(invalid("la ruta no es una carpeta existente"));
    }
    let read = std::fs::read_dir(&directory)
        .map_err(|_| invalid("no se pudo leer la carpeta"))?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut truncated = false;
    for entry in read.flatten() {
        if dirs.len() + files.len() >= FS_LIST_MAX_ENTRIES {
            truncated = true;
            break;
        }
        let entry_path = entry.path();
        let is_dir = entry_path.is_dir();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() {
            continue;
        }
        let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        let item = FsEntry {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            kind: fs_kind(&entry_path, is_dir).to_owned(),
            bytes,
        };
        if is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }
    let sort = |a: &FsEntry, b: &FsEntry| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(sort);
    files.sort_by(sort);
    dirs.extend(files);
    Ok(FsListing {
        directory: directory.to_string_lossy().into_owned(),
        entries: dirs,
        truncated,
    })
}

/// Lee un archivo de texto hasta `FS_READ_MAX_BYTES`. Rechaza carpetas y
/// archivos que no se pueden abrir; nunca ejecuta ni interpreta el contenido.
#[tauri::command]
pub fn fs_read(path: String) -> Result<FsFileContent, ProjectError> {
    let file = PathBuf::from(path.trim());
    if !file.is_file() {
        return Err(invalid("la ruta no es un archivo existente"));
    }
    let bytes = file
        .metadata()
        .map(|meta| meta.len())
        .unwrap_or(0);
    let truncated = bytes > FS_READ_MAX_BYTES;
    let read = std::fs::File::open(&file)
        .map_err(|_| invalid("no se pudo abrir el archivo"))?;
    use std::io::Read;
    let mut buffer = Vec::new();
    read.take(FS_READ_MAX_BYTES)
        .read_to_end(&mut buffer)
        .map_err(|_| invalid("no se pudo leer el archivo"))?;
    Ok(FsFileContent {
        path: file.to_string_lossy().into_owned(),
        bytes,
        truncated,
        content: String::from_utf8_lossy(&buffer).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fs_list_shows_dirs_first_and_classifies_kinds() {
        let root = std::env::temp_dir().join(format!("olyvia-fs-list-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("clip.mp4"), b"x").unwrap();
        std::fs::write(root.join("notas.srt"), b"x").unwrap();
        std::fs::write(root.join("raro.bin"), b"x").unwrap();

        let listing = fs_list(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(listing.entries[0].kind, "dir");
        assert_eq!(listing.entries[0].name, "sub");
        let kinds: Vec<&str> = listing
            .entries
            .iter()
            .filter(|entry| entry.kind != "dir")
            .map(|entry| entry.kind.as_str())
            .collect();
        assert!(kinds.contains(&"video"));
        assert!(kinds.contains(&"subtitle"));
        assert!(kinds.contains(&"other"));
        assert!(!listing.truncated);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fs_list_rejects_missing_path() {
        assert!(fs_list("C:\\no\\existe\\carpeta".to_owned()).is_err());
    }

    #[test]
    fn fs_read_returns_text_and_marks_truncation() {
        let file = std::env::temp_dir().join(format!("olyvia-fs-read-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&file, "hola mundo").unwrap();
        let content = fs_read(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(content.content, "hola mundo");
        assert!(!content.truncated);
        assert!(fs_read(file.to_string_lossy().into_owned()).is_ok());
        let _ = std::fs::remove_file(&file);

        let big = std::env::temp_dir().join(format!("olyvia-fs-big-{}.txt", uuid::Uuid::new_v4()));
        let payload = vec![b'a'; (FS_READ_MAX_BYTES + 10) as usize];
        std::fs::write(&big, &payload).unwrap();
        let big_content = fs_read(big.to_string_lossy().into_owned()).unwrap();
        assert!(big_content.truncated);
        assert_eq!(big_content.content.len() as u64, FS_READ_MAX_BYTES);
        let _ = std::fs::remove_file(&big);
    }

    #[test]
    fn fs_read_rejects_directories() {
        let dir = std::env::temp_dir().join(format!("olyvia-fs-dir-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(fs_read(dir.to_string_lossy().into_owned()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
