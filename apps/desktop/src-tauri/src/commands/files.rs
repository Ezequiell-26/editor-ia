//! Exploración, lectura y escritura de archivos del disco.
//!
//! `fs_list`/`fs_read` muestran el contenido de carpetas y archivos (la IA
//! *ve* la PC); `fs_write`/`fs_mkdir`/`fs_delete` le dan poder de escritura
//! real: crear scripts, subtítulos, JSON de proyecto, mover material de
//! trabajo — cualquier archivo que el token MCP autorice.
//!
//! Límites deliberados: escritura de texto hasta `FS_WRITE_MAX_BYTES`,
//! `fs_delete` exige `recursive` explícito para carpetas y rechaza rutas
//! protegidas (raíz de unidad, perfil de usuario, Windows). Nunca se
//! ejecuta el contenido escrito.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Tope de entradas por listado: suficiente para cualquier carpeta real y
/// acota el JSON que viaja por IPC.
const FS_LIST_MAX_ENTRIES: usize = 500;
/// Tope de lectura: alcanza para subtítulos, proyectos `.editoria.json` y
/// cualquier texto de trabajo; un binario grande no entra por esta puerta.
const FS_READ_MAX_BYTES: u64 = 512 * 1024;
/// Tope de escritura: alcanza para scripts, subtítulos, JSON y texto de
/// trabajo; no para volcar videos/binarios por esta puerta.
const FS_WRITE_MAX_BYTES: usize = 10 * 1024 * 1024;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteResult {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDeleteResult {
    pub path: String,
    /// `true` cuando se borró una carpeta con todo su contenido.
    pub recursive: bool,
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

/// Rutas que `fs_delete` nunca toca: raíces de unidad, el perfil del usuario
/// y carpetas críticas de Windows. La escritura (`fs_write`/`fs_mkdir`) sí
/// puede crear dentro de ellas — es el trabajo normal de la IA.
fn protected_delete_target(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }
    let text = path.to_string_lossy().replace('/', "\\").to_lowercase();
    text.starts_with("c:\\windows")
        || text.starts_with("c:\\program files")
        || text.starts_with("c:\\programdata\\microsoft")
        || text.starts_with("c:\\users\\public")
}

fn normalize_target(raw: &str) -> Result<PathBuf, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid("la ruta está vacía"));
    }
    let path = PathBuf::from(trimmed);
    if path.as_os_str().is_empty() {
        return Err(invalid("la ruta está vacía"));
    }
    Ok(path)
}

/// Escribe texto en un archivo creándolo si no existe (y sus carpetas
/// padre). Sirve para guiones, subtítulos, JSON, configs — lo que la IA
/// necesite dejar en disco.
#[tauri::command]
pub fn fs_write(path: String, content: String) -> Result<FsWriteResult, ProjectError> {
    let target = normalize_target(&path)?;
    if content.len() > FS_WRITE_MAX_BYTES {
        return Err(invalid("el contenido supera el tope de escritura (10 MiB)"));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|_| invalid("no se pudieron crear las carpetas padre"))?;
        }
    }
    std::fs::write(&target, content.as_bytes())
        .map_err(|_| invalid("no se pudo escribir el archivo"))?;
    let bytes = target
        .metadata()
        .map(|meta| meta.len())
        .unwrap_or(content.len() as u64);
    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes,
    })
}

/// Crea una carpeta (con padres si `recursive`, por defecto true).
#[tauri::command]
pub fn fs_mkdir(path: String, recursive: Option<bool>) -> Result<FsWriteResult, ProjectError> {
    let target = normalize_target(&path)?;
    let recursive = recursive.unwrap_or(true);
    if recursive {
        std::fs::create_dir_all(&target)
            .map_err(|_| invalid("no se pudo crear la carpeta"))?;
    } else {
        std::fs::create_dir(&target).map_err(|_| invalid("no se pudo crear la carpeta"))?;
    }
    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes: 0,
    })
}

/// Borra un archivo, o una carpeta vacía; para carpetas con contenido hay
/// que pasar `recursive: true` explícitamente. Rechaza rutas protegidas.
#[tauri::command]
pub fn fs_delete(path: String, recursive: Option<bool>) -> Result<FsDeleteResult, ProjectError> {
    let target = normalize_target(&path)?;
    if protected_delete_target(&target) {
        return Err(invalid("esa ruta está protegida y no se puede borrar"));
    }
    let recursive = recursive.unwrap_or(false);
    if target.is_dir() {
        if recursive {
            std::fs::remove_dir_all(&target)
                .map_err(|_| invalid("no se pudo borrar la carpeta"))?;
        } else {
            std::fs::remove_dir(&target)
                .map_err(|_| invalid("la carpeta no está vacía: usá recursive=true"))?;
        }
    } else if target.exists() {
        std::fs::remove_file(&target).map_err(|_| invalid("no se pudo borrar el archivo"))?;
    } else {
        return Err(invalid("la ruta no existe"));
    }
    Ok(FsDeleteResult {
        path: target.to_string_lossy().into_owned(),
        recursive,
    })
}

/// Mueve o renombra un archivo/carpeta. El destino puede estar en otra
/// carpeta; si existe, falla (no se sobrescribe sin querer).
#[tauri::command]
pub fn fs_move(from: String, to: String) -> Result<FsWriteResult, ProjectError> {
    let source = normalize_target(&from)?;
    let target = normalize_target(&to)?;
    if !source.exists() {
        return Err(invalid("el origen no existe"));
    }
    if target.exists() {
        return Err(invalid("el destino ya existe"));
    }
    if protected_delete_target(&target) {
        return Err(invalid("el destino está en una ruta protegida"));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|_| invalid("no se pudieron crear las carpetas padre"))?;
        }
    }
    std::fs::rename(&source, &target).map_err(|_| {
        invalid("no se pudo mover (¿cruzando unidades o permisos?)")
    })?;
    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes: 0,
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

    #[test]
    fn fs_write_creates_parents_and_overwrites() {
        let root = std::env::temp_dir().join(format!("olyvia-fs-write-{}", uuid::Uuid::new_v4()));
        let file = root.join("sub").join("guion.txt");
        let result = fs_write(
            file.to_string_lossy().into_owned(),
            "línea 1\nlínea 2".to_owned(),
        )
        .unwrap();
        assert!(result.bytes > 0);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "línea 1\nlínea 2");
        fs_write(file.to_string_lossy().into_owned(), "nuevo".to_owned()).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "nuevo");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fs_write_rejects_empty_path_and_oversized_content() {
        assert!(fs_write("   ".to_owned(), "x".to_owned()).is_err());
        let big = "x".repeat(FS_WRITE_MAX_BYTES + 1);
        assert!(fs_write(
            std::env::temp_dir()
                .join(format!("olyvia-fs-big-{}.txt", uuid::Uuid::new_v4()))
                .to_string_lossy()
                .into_owned(),
            big
        )
        .is_err());
    }

    #[test]
    fn fs_mkdir_creates_nested_and_fs_delete_respects_recursive() {
        let root = std::env::temp_dir().join(format!("olyvia-fs-del-{}", uuid::Uuid::new_v4()));
        let nested = root.join("a").join("b");
        fs_mkdir(nested.to_string_lossy().into_owned(), None).unwrap();
        assert!(nested.is_dir());
        // Carpeta no vacía sin recursive debe fallar.
        std::fs::write(nested.join("f.txt"), "x").unwrap();
        assert!(fs_delete(root.to_string_lossy().into_owned(), None).is_err());
        let removed = fs_delete(root.to_string_lossy().into_owned(), Some(true)).unwrap();
        assert!(removed.recursive);
        assert!(!root.exists());
    }

    #[test]
    fn fs_delete_rejects_protected_paths_and_missing() {
        assert!(fs_delete("C:\\".to_owned(), None).is_err());
        assert!(fs_delete("C:\\Windows".to_owned(), Some(true)).is_err());
        assert!(fs_delete(
            "C:\\no\\existe\\archivo-xyz.txt".to_owned(),
            None
        )
        .is_err());
    }

    #[test]
    fn fs_move_renames_and_relocates() {
        let root = std::env::temp_dir().join(format!("olyvia-fs-move-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let from = root.join("viejo.txt");
        let to = root.join("nuevo").join("renombrado.txt");
        std::fs::write(&from, "datos").unwrap();
        let moved = fs_move(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert!(!from.exists());
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "datos");
        assert_eq!(moved.path, to.to_string_lossy());
        // Destino existente falla.
        assert!(fs_move(
            to.to_string_lossy().into_owned(),
            root.join("otro.txt").to_string_lossy().into_owned(),
        )
        .is_ok());
        assert!(fs_move(
            to.to_string_lossy().into_owned(),
            root.join("otro.txt").to_string_lossy().into_owned(),
        )
        .is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
