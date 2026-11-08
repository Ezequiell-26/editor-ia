//! Media ingestion and thumbnails. The dialog chooses files; the native side
//! copies, hashes and measures them, and the UI declares the rights afterwards.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::system::resolve_tools;
use crate::media::{
    import_file, probe_file, resolve_inside_root, thumbnail_data_url, ImportOutcome, MediaKind,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

include!("media/import.rs");
include!("media/color_proxy.rs");
include!("media/lut_thumbnail.rs");
include!("media/filesystem.rs");

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

const MEDIA_FOLDER_IMAGE_EXTENSIONS: [&str; 9] = [
    "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "tif",
];
const MEDIA_FOLDER_AUDIO_EXTENSIONS: [&str; 7] =
    ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"];
const MEDIA_FOLDER_VIDEO_EXTENSIONS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mts"];
const MEDIA_FOLDER_MAX_FILES: usize = 300;

pub use crate::media::folder::sanitize_media_folder_name;
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
    files.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    files
}

fn media_folder_listing(directory: PathBuf) -> MediaFolderListing {
    MediaFolderListing {
        directory: directory.to_string_lossy().into_owned(),
        files: collect_media_folder_files(&directory),
    }
}

/// Resuelve una carpeta por nombre dentro de Descargas y del destino del
/// descargador, y devuelve sus medios. Nunca acepta una ruta del modelo.
#[tauri::command]
pub fn list_media_folder(
    app: AppHandle,
    folder: String,
    root: Option<String>,
) -> Result<MediaFolderListing, ProjectError> {
    let trimmed = folder.trim().trim_matches(['"', '\'', '“', '”', '«', '»']);
    let direct_path = PathBuf::from(trimmed);
    if direct_path.is_dir() {
        let listing = media_folder_listing(direct_path);
        if !listing.files.is_empty() {
            return Ok(listing);
        }
    }

    let name = sanitize_media_folder_name(&folder).ok_or_else(|| {
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
    if let Ok(downloads) = app.path().download_dir() {
        roots.push(downloads);
    }
    for root in roots {
        let direct = root.join(&name);
        if direct.is_dir() {
            let listing = media_folder_listing(direct);
            if !listing.files.is_empty() {
                return Ok(listing);
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
                        return Ok(listing);
                    }
                }
            }
        }
    }
    let message =
        format!("No encontré la carpeta «{name}» con imágenes, audio o video en Descargas.");
    Err(ProjectError::message(ProjectErrorCode::Io, &message))
}

#[allow(dead_code)]
fn _assert_pathbuf_send(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::media::confirm_generated_rights;
    use serde_json::json;

    #[test]
    fn media_folder_name_rejects_paths_and_control_chars() {
        assert_eq!(
            sanitize_media_folder_name("  video 1 ").as_deref(),
            Some("video 1")
        );
        assert_eq!(
            sanitize_media_folder_name("«video 1»").as_deref(),
            Some("video 1")
        );
        assert_eq!(
            sanitize_media_folder_name("\"video 1\"").as_deref(),
            Some("video 1")
        );
        assert!(sanitize_media_folder_name("../secret").is_none());
        assert!(sanitize_media_folder_name("C:\\Windows").is_none());
        assert!(sanitize_media_folder_name("a/b").is_none());
        assert!(sanitize_media_folder_name("..").is_none());
        assert!(sanitize_media_folder_name("   ").is_none());
    }

    #[test]
    fn media_folder_collects_media_and_ignores_other_files() {
        let root =
            std::env::temp_dir().join(format!("olyvia-media-folder-{}", uuid::Uuid::new_v4()));
        let nested = root.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("b.jpg"), b"x").unwrap();
        std::fs::write(root.join("a.wav"), b"x").unwrap();
        std::fs::write(root.join("clip.mp4"), b"x").unwrap();
        std::fs::write(root.join("nota.txt"), b"x").unwrap();
        std::fs::write(nested.join("c.png"), b"x").unwrap();

        let files = collect_media_folder_files(&root);
        let names: Vec<&str> = files.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, vec!["a.wav", "b.jpg", "c.png", "clip.mp4"]);
        assert!(files.iter().any(|file| file.kind == "image"));
        assert!(files.iter().any(|file| file.kind == "audio"));
        assert!(files.iter().any(|file| file.kind == "video"));
        assert!(files.iter().all(|file| file.name != "nota.txt"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn confirmed_generated_rights_become_ready_with_provider_provenance() {
        let mut asset = json!({
            "id": "a",
            "status": "unverified",
            "rights": {
                "license": { "id": "unknown", "commercialUse": "unknown" },
                "provenance": { "origin": "user-imported", "acquiredAt": "2026-10-20T00:00:00Z" }
            }
        });
        confirm_generated_rights(&mut asset, Some("google-flow-image"));
        assert_eq!(asset["status"], "ready");
        assert_eq!(asset["rights"]["license"]["commercialUse"], "allowed");
        assert_eq!(
            asset["rights"]["provenance"]["origin"],
            "generated-by-provider"
        );
        assert_eq!(
            asset["rights"]["provenance"]["provider"],
            "google-flow-image"
        );
    }

    #[test]
    fn list_media_folder_accepts_existing_absolute_dir() {
        let root = std::env::temp_dir().join(format!("olyvia-abs-folder-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("sample.mp4"), b"test").unwrap();

        let listing = media_folder_listing(root.clone());
        assert_eq!(listing.files.len(), 1);
        assert_eq!(listing.files[0].name, "sample.mp4");
        assert_eq!(listing.files[0].kind, "video");
        let _ = std::fs::remove_dir_all(&root);
    }
}
