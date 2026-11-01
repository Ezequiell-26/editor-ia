//! Overlays propios empaquetados con la app.
//!
//! Los videos se generan con `scripts/generate-overlays.mjs` (gradientes y
//! partículas procedurales, sin assets de terceros) y se guardan en
//! `resources/overlays`. Al agregarlos, se copian al proyecto y se registran
//! como material generado localmente con licencia CC0.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::system::{bundled_resource_dir, resolve_tools};
use crate::media::import_file;
use crate::projects::service::{now_rfc3339, ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayEntry {
    id: String,
    label: String,
    description: String,
    file: String,
    poster: String,
    width: u32,
    height: u32,
    fps: u32,
    duration_seconds: f64,
    blend_mode: String,
    #[serde(default)]
    has_alpha: bool,
}

#[derive(Debug, Deserialize)]
struct OverlayCatalog {
    version: u32,
    overlays: Vec<OverlayEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinOverlay {
    id: String,
    label: String,
    description: String,
    width: u32,
    height: u32,
    fps: u32,
    duration_seconds: f64,
    blend_mode: String,
    has_alpha: bool,
    /** Poster JPEG/PNG como data URL para no depender del scope de assets. */
    thumbnail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedOverlay {
    asset: Value,
    label: String,
    blend_mode: String,
    duration_seconds: f64,
}

fn overlay_dir() -> Option<PathBuf> {
    if let Some(base) = bundled_resource_dir() {
        let candidate = base.join("overlays");
        if candidate.join("catalog.json").is_file() {
            return Some(candidate);
        }
    }
    // En `tauri dev` el resource dir puede ser target/debug sin los recursos
    // copiados; se usa la carpeta fuente compilada en el binario.
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("overlays");
    if dev.join("catalog.json").is_file() {
        return Some(dev);
    }
    None
}

fn catalog_entries() -> Result<Vec<OverlayEntry>, ProjectError> {
    let dir = overlay_dir().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "no se encontró la biblioteca de overlays empaquetada",
        )
    })?;
    let raw = std::fs::read_to_string(dir.join("catalog.json")).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo leer el catálogo de overlays",
        )
    })?;
    let catalog: OverlayCatalog = serde_json::from_str(&raw).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el catálogo de overlays no es válido",
        )
    })?;
    if catalog.version != 1 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "versión de catálogo de overlays no soportada",
        ));
    }
    for entry in &catalog.overlays {
        if !entry
            .id
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
        {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el catálogo tiene un id de overlay inválido",
            ));
        }
        if entry.width == 0 || entry.height == 0 || entry.fps == 0 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el overlay {} no declara dimensiones o fps", entry.id),
            ));
        }
        if !(0.1..=60.0).contains(&entry.duration_seconds) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el overlay {} tiene una duración inválida", entry.id),
            ));
        }
        if !matches!(
            entry.blend_mode.as_str(),
            "screen" | "overlay" | "lighten" | "normal"
        ) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el overlay {} usa una mezcla no permitida", entry.id),
            ));
        }
        for name in [&entry.file, &entry.poster] {
            let path = dir.join(name);
            if !path.is_file() {
                return Err(ProjectError::message(
                    ProjectErrorCode::NotFound,
                    &format!("falta el recurso {}", path.display()),
                ));
            }
        }
    }
    Ok(catalog.overlays)
}

fn find_entry(id: &str) -> Result<(PathBuf, OverlayEntry), ProjectError> {
    let dir = overlay_dir().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "no se encontró la biblioteca de overlays empaquetada",
        )
    })?;
    let entries = catalog_entries()?;
    let entry = entries
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el overlay elegido no está en la biblioteca",
            )
        })?;
    let file = dir.join(&entry.file);
    Ok((file, entry))
}

#[tauri::command]
pub async fn list_builtin_overlays() -> Result<Vec<BuiltinOverlay>, ProjectError> {
    let dir = overlay_dir().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "no se encontró la biblioteca de overlays empaquetada",
        )
    })?;
    let entries = catalog_entries()?;
    let mut result = Vec::with_capacity(entries.len());
    for entry in entries {
        let poster = std::fs::read(dir.join(&entry.poster)).unwrap_or_default();
        let thumbnail = if poster.is_empty() {
            String::new()
        } else {
            let mime = if entry.poster.to_ascii_lowercase().ends_with(".png") {
                "image/png"
            } else {
                "image/jpeg"
            };
            format!("data:{mime};base64,{}", BASE64.encode(poster))
        };
        result.push(BuiltinOverlay {
            id: entry.id,
            label: entry.label,
            description: entry.description,
            width: entry.width,
            height: entry.height,
            fps: entry.fps,
            duration_seconds: entry.duration_seconds,
            blend_mode: entry.blend_mode,
            has_alpha: entry.has_alpha,
            thumbnail,
        });
    }
    Ok(result)
}

/// Marca el asset como generado localmente con la licencia CC0 de la
/// biblioteca. Se separa del comando para poder probarlo sin Tauri.
fn decorate_asset(asset: &mut Value, label: &str) -> Result<(), ProjectError> {
    let path = asset["source"]["path"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if path.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el overlay no se copió al proyecto",
        ));
    }
    let now = now_rfc3339();
    asset["label"] = json!(label);
    asset["source"] = json!({
        "type": "generated",
        "provider": { "id": "editor-ia", "model": "procedural-overlay-v1" },
        "path": path,
        "generatedAt": now
    });
    asset["rights"] = json!({
        "license": {
            "id": "cc0-1.0",
            "commercialUse": "allowed",
            "attributionText": "Overlay generado por Editor IA",
            "notes": "Contenido procedural propio; no usa assets de terceros."
        },
        "provenance": {
            "origin": "generated-locally",
            "acquiredAt": now,
            "provider": "Editor IA"
        }
    });
    asset["status"] = json!("ready");
    Ok(())
}

fn prepare_asset(asset: &mut Value, entry: &OverlayEntry) -> Result<(), ProjectError> {
    decorate_asset(asset, &entry.label)?;
    if entry.has_alpha {
        asset["media"]["alpha"] = json!(true);
    }
    Ok(())
}

/// Copia un overlay empaquetado al proyecto. El asset queda como material
/// generado localmente (CC0) y listo para montar; `blendMode` lo aplica la UI.
#[tauri::command]
pub async fn import_builtin_overlay(
    state: State<'_, AppState>,
    id: String,
    fps_num: u32,
    fps_den: u32,
) -> Result<ImportedOverlay, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; no se puede medir el overlay",
        ));
    };
    let (source, entry) = find_entry(id.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el overlay empaquetado ya no está en disco",
        ));
    }
    let mut asset = import_file(
        &session.root,
        &source,
        &ffprobe,
        fps_num.max(1),
        fps_den.max(1),
    )?;
    prepare_asset(&mut asset, &entry)?;
    Ok(ImportedOverlay {
        asset,
        label: entry.label,
        blend_mode: entry.blend_mode,
        duration_seconds: entry.duration_seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ships_owned_overlays_with_real_files() {
        let dir = overlay_dir().expect("overlays");
        let entries = catalog_entries().expect("catálogo válido");
        assert_eq!(entries.len(), 5);
        for entry in &entries {
            assert!(entry.width >= 640 && entry.height >= 360);
            assert!(entry.duration_seconds >= 1.0);
            assert!(
                matches!(entry.blend_mode.as_str(), "screen" | "normal"),
                "{}",
                entry.id
            );
            assert!(dir.join(&entry.file).is_file());
            assert!(dir.join(&entry.poster).is_file());
        }
        let mascot = entries
            .iter()
            .find(|entry| entry.id == "mascot-wave")
            .expect("mascota");
        assert!(mascot.has_alpha);
        assert_eq!(mascot.blend_mode, "normal");
        assert!(mascot.file.ends_with(".webm"));
        assert!(mascot.poster.ends_with(".png"));
    }

    #[test]
    fn unknown_overlay_is_rejected_without_touching_the_project() {
        let error = find_entry("no-existe").expect_err("debe fallar");
        assert_eq!(error.code, ProjectErrorCode::NotFound);
    }

    #[test]
    fn imports_a_real_overlay_and_marks_it_generated_cc0() {
        let ffprobe = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg")
            .join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
        if !ffprobe.is_file() {
            eprintln!("import de overlay omitido: falta el ffprobe empaquetado");
            return;
        }
        for (id, label, alpha) in [
            ("dust-motes", "Polvo dorado", false),
            ("mascot-wave", "Mascota que saluda", true),
        ] {
            let (source, entry) = find_entry(id).expect("overlay");
            let root = std::env::temp_dir().join(format!(
                "editoria-overlay-import-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(root.join("media")).unwrap();
            let mut asset = import_file(&root, &source, &ffprobe, 30, 1).expect("import");
            prepare_asset(&mut asset, &entry).expect("prepare");
            assert_eq!(asset["status"], "ready");
            assert_eq!(asset["label"], label);
            assert_eq!(asset["source"]["type"], "generated");
            assert_eq!(asset["source"]["provider"]["id"], "editor-ia");
            assert_eq!(asset["rights"]["license"]["id"], "cc0-1.0");
            assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");
            assert_eq!(asset["media"]["width"], 1280);
            assert_eq!(asset["media"]["height"], 720);
            assert_eq!(entry.duration_seconds, 4.0);
            if alpha {
                assert_eq!(asset["media"]["alpha"], json!(true));
            } else {
                assert!(asset["media"].get("alpha").is_none());
            }
            let relative = asset["source"]["path"].as_str().unwrap();
            assert!(relative.starts_with("media/"), "{relative}");
            let copied = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
            assert!(copied.is_file());
            assert_eq!(asset["integrity"]["sha256"].as_str().unwrap().len(), 64);
            let _ = std::fs::remove_dir_all(&root);
        }
    }
}
