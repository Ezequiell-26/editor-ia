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

// DTOs, scanners de carpeta y validadores: `media::folder`.
pub use crate::media::folder::{
    collect_media_folder_files, collect_media_folder_matches, media_folder_listing,
    normalize_media_search_kind, resolve_media_folder_dir, sanitize_media_folder_name,
    validate_media_search_query, MediaFolderFile, MediaFolderListing, MediaSearchResult,
    MEDIA_SEARCH_MAX_DEPTH,
};

fn resolve_folder_dir(
    app: &AppHandle,
    folder: &str,
    root: Option<String>,
) -> Result<PathBuf, ProjectError> {
    let downloads_dir = app.path().download_dir().ok();
    resolve_media_folder_dir(folder, root, downloads_dir)
}

/// Resuelve una carpeta por nombre dentro de Descargas y del destino del
/// descargador, y devuelve sus medios. Nunca acepta una ruta del modelo.
#[tauri::command]
pub fn list_media_folder(
    app: AppHandle,
    folder: String,
    root: Option<String>,
) -> Result<MediaFolderListing, ProjectError> {
    let directory = resolve_folder_dir(&app, &folder, root)?;
    Ok(media_folder_listing(directory))
}

/// Busca medios por nombre dentro de una carpeta (misma resolución que
/// `list_media_folder`). `kind` es opcional: `image`, `audio` o `video`.
#[tauri::command]
pub fn search_media_folder(
    app: AppHandle,
    folder: String,
    query: String,
    kind: Option<String>,
    root: Option<String>,
) -> Result<MediaSearchResult, ProjectError> {
    let query = validate_media_search_query(&query)?;
    let kind = normalize_media_search_kind(kind)?;
    let directory = resolve_folder_dir(&app, &folder, root)?;
    let (files, truncated) = collect_media_folder_matches(&directory, &query, kind.as_deref());
    Ok(MediaSearchResult {
        directory: directory.to_string_lossy().into_owned(),
        query,
        files,
        truncated,
    })
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
    fn media_search_matches_name_case_insensitive_and_kind() {
        let root =
            std::env::temp_dir().join(format!("olyvia-media-search-{}", uuid::Uuid::new_v4()));
        let deep = root.join("a").join("b").join("c");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(root.join("Boda-Clip.MP4"), b"x").unwrap();
        std::fs::write(root.join("boda-foto.JPG"), b"x").unwrap();
        std::fs::write(root.join("otra-cosa.png"), b"x").unwrap();
        std::fs::write(deep.join("boda-lejos.wav"), b"x").unwrap();
        std::fs::write(root.join("boda-nota.txt"), b"x").unwrap();

        let (all, truncated) = collect_media_folder_matches(&root, "boda", None);
        let names: Vec<&str> = all.iter().map(|file| file.name.as_str()).collect();
        assert!(!truncated);
        assert_eq!(
            names,
            vec!["Boda-Clip.MP4", "boda-foto.JPG", "boda-lejos.wav"]
        );

        let (videos, _) = collect_media_folder_matches(&root, "boda", Some("video"));
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].name, "Boda-Clip.MP4");

        let (none, _) = collect_media_folder_matches(&root, "inexistente", None);
        assert!(none.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn media_search_respects_depth_limit() {
        let root =
            std::env::temp_dir().join(format!("olyvia-media-depth-{}", uuid::Uuid::new_v4()));
        let mut deep = root.clone();
        for index in 0..(MEDIA_SEARCH_MAX_DEPTH as usize + 2) {
            deep = deep.join(format!("d{index}"));
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(root.join("cerca.mp4"), b"x").unwrap();
        std::fs::write(deep.join("lejos.mp4"), b"x").unwrap();

        let (files, _) = collect_media_folder_matches(&root, "mp4", None);
        let names: Vec<&str> = files.iter().map(|file| file.name.as_str()).collect();
        assert!(names.contains(&"cerca.mp4"));
        assert!(!names.contains(&"lejos.mp4"));
        let _ = std::fs::remove_dir_all(&root);
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
