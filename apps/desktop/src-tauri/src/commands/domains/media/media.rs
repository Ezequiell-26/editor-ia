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

/// Metadatos de color de un archivo de video para que la IA decida el
/// tratamiento: espacio/transfer/primarias reales (ffprobe), clasificación
/// HDR (PQ/HLG) y los `cameraProfile` log→Rec.709 que el proyecto soporta.
/// No inventa diagnósticos: el log no se detecta por metadatos de forma
/// fiable, así que la sugerencia es conservadora.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaColorProbe {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pix_fmt: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    /// "pq" | "hlg" | "sdr" | "log-sospechoso" | "desconocido".
    pub hdr: String,
    pub wide_gamut: bool,
    /// cameraProfile ids del schema que la IA puede aplicar al clip.
    pub camera_profiles: Vec<&'static str>,
    /// Sugerencia honesta: Some("hdr-pq"|"hdr-hlg"|"posible-log") o None.
    pub suggestion: Option<String>,
}

#[tauri::command]
pub async fn media_probe_color(
    state: State<'_, AppState>,
    path: String,
) -> Result<MediaColorProbe, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe es necesario para inspeccionar el color",
        ));
    };
    let source = crate::application::fs::resolve_user_file_path(&path)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo no existe",
        ));
    }
    let measure =
        tokio::task::spawn_blocking(move || probe_file(&ffprobe, &source, MediaKind::Video))
            .await
            .map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "la inspección de color falló",
                )
            })??;
    let transfer = measure.color_transfer.as_deref().unwrap_or("");
    let primaries = measure.color_primaries.as_deref().unwrap_or("");
    let space = measure.color_space.as_deref().unwrap_or("");
    let hdr = if matches!(transfer, "smpte2084" | "smpte-st-2084") {
        "pq"
    } else if matches!(transfer, "arib-std-b67" | "arib-std-b67-compat") {
        "hlg"
    } else if matches!(transfer, "iec61966-2-1" | "bt709" | "smpte170m")
        || matches!(primaries, "bt709" | "smpte170m" | "bt470bg")
    {
        "sdr"
    } else {
        "desconocido"
    };
    let wide_gamut = matches!(space, "bt2020nc" | "bt2020c" | "smpte2085")
        || matches!(primaries, "bt2020" | "smpte432")
        || measure
            .pix_fmt
            .as_deref()
            .is_some_and(|p| p.contains("10le") || p.contains("12le"));
    // Log real suele reportar transfer/primarias desconocidas o lineales:
    // señal débil pero honesta, la decide la IA con la lista de perfiles.
    let possible_log = hdr == "desconocido"
        && (transfer.is_empty()
            || matches!(transfer, "linear" | "iec61966-2-4" | "gamma22" | "unknown"));
    let suggestion = match hdr {
        "pq" => Some("hdr-pq".to_owned()),
        "hlg" => Some("hdr-hlg".to_owned()),
        _ if possible_log => Some("posible-log".to_owned()),
        _ => None,
    };
    Ok(MediaColorProbe {
        width: measure.width,
        height: measure.height,
        pix_fmt: measure.pix_fmt,
        color_space: measure.color_space,
        color_transfer: measure.color_transfer,
        color_primaries: measure.color_primaries,
        hdr: hdr.to_owned(),
        wide_gamut,
        camera_profiles: vec![
            "vlog709",
            "slog3709",
            "slog3cinema",
            "nlog709",
            "nlogcinema",
            "gplog709",
            "dlog709",
            "clog3709",
        ],
        suggestion,
    })
}

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
    fn import_bytes_file_name_is_sanitized_to_audio_basename() {
        assert_eq!(
            sanitize_import_file_name("voz-20261120-1430.wav")
                .ok()
                .as_deref(),
            Some("voz-20261120-1430.wav")
        );
        // Sólo el basename: las rutas se descartan, el traversal no pasa.
        assert_eq!(
            sanitize_import_file_name("C:\\tmp\\voz.webm")
                .ok()
                .as_deref(),
            Some("voz.webm")
        );
        assert_eq!(
            sanitize_import_file_name("../voz.wav").ok().as_deref(),
            Some("voz.wav")
        );
        assert!(sanitize_import_file_name("..").is_err());
        assert!(sanitize_import_file_name("voz.exe").is_err());
        assert!(sanitize_import_file_name("sin-extension").is_err());
        assert!(sanitize_import_file_name("voz;rm -rf.wav").is_err());
        assert!(sanitize_import_file_name("").is_err());
    }

    #[test]
    fn import_bytes_decodes_base64_with_limits() {
        let bytes = decode_import_bytes("aGVsbG8=").expect("base64");
        assert_eq!(bytes, b"hello");
        assert!(decode_import_bytes("").is_err());
        assert!(decode_import_bytes("!!!no-base64!!!").is_err());
    }

    #[test]
    fn import_bytes_rejects_oversized_base64_before_decoding() {
        // AUD-142: un string más largo que el máximo codificado se rechaza
        // por longitud, sin decodificar ni reservar el buffer del payload.
        let oversized = "A".repeat(MAX_IMPORT_BASE64_CHARS + 1);
        let err = decode_import_bytes(&oversized).unwrap_err();
        assert!(err.message.contains("256 MB"), "{:?}", err.message);
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

    #[test]
    fn descargas_is_an_alias_of_the_downloads_root() {
        let downloads =
            std::env::temp_dir().join(format!("olyvia-descargas-alias-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::write(downloads.join("foto.png"), b"x").unwrap();

        for name in ["Descargas", "descargas", "Downloads", "DOWNLOADS"] {
            let resolved = resolve_media_folder_dir(name, None, Some(downloads.clone())).unwrap();
            assert_eq!(resolved, downloads, "alias {name}");
        }
        let _ = std::fs::remove_dir_all(&downloads);
    }

    #[test]
    fn media_folder_that_exists_but_is_empty_resolves_and_missing_one_errors() {
        let root =
            std::env::temp_dir().join(format!("olyvia-empty-folder-{}", uuid::Uuid::new_v4()));
        let empty = root.join("video 1");
        std::fs::create_dir_all(&empty).unwrap();

        let resolved = resolve_media_folder_dir("video 1", None, Some(root.clone())).unwrap();
        assert_eq!(resolved, empty);
        assert!(resolve_media_folder_dir("no-existe", None, Some(root.clone())).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
