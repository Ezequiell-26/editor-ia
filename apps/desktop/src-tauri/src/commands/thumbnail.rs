//! Thumbnail Studio: guarda una miniatura dibujada en el canvas del frontend.
//!
//! El frontend compone la imagen (fondo, overlay, texto y badge) y manda un
//! data URL PNG. Este módulo valida el contenido con la crate `image`, lo
//! re-encodea a PNG y lo publica con nombre único y rename atómico. No confía
//! en la extensión ni en el nombre que manda el cliente.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailExportRequest {
    pub data_url: String,
    pub output_dir: String,
    #[serde(default)]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailExportResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
}

fn decode_data_url(value: &str) -> Result<Vec<u8>, ProjectError> {
    let payload = value
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(value)
        .trim();
    if payload.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura llegó vacía",
        ));
    }
    STANDARD.decode(payload).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura no es un data URL base64 válido",
        )
    })
}

fn safe_stem(value: Option<&str>) -> String {
    let raw = value.unwrap_or("miniatura").trim();
    let mut stem: String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    // Varios caracteres inválidos seguidos generan una corrida de guiones:
    // "mi:mini/../atura" no debe convertirse en "mi-mini----atura".
    stem = stem
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    stem = stem.trim().trim_matches('-').to_owned();
    if stem.len() > 80 {
        stem.truncate(80);
    }
    if stem.is_empty() {
        "miniatura".to_owned()
    } else {
        stem
    }
}

fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.png"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{index}.png"));
        index += 1;
    }
    candidate
}

/// Guarda la miniatura como PNG y devuelve la ruta publicada.
#[tauri::command]
pub fn save_thumbnail(
    request: ThumbnailExportRequest,
) -> Result<ThumbnailExportResult, ProjectError> {
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de la miniatura no existe",
        ));
    }
    let bytes = decode_data_url(&request.data_url)?;
    let image = image::load_from_memory(&bytes).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura no es una imagen válida",
        )
    })?;
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura tiene dimensiones fuera de rango",
        ));
    }
    // Re-encodea a PNG: no se guarda lo que el cliente dijo que era, sino lo
    // que `image` efectivamente decodificó.
    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo convertir la miniatura a PNG",
            )
        })?;
    let stem = safe_stem(request.file_name.as_deref());
    let final_path = unique_path(&output_dir, &stem);
    let temp_path = output_dir.join(format!(".thumbnail-{}.png", Uuid::new_v4()));
    std::fs::write(&temp_path, &png).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir la miniatura: {error}").as_str(),
        )
    })?;
    if image::image_dimensions(&temp_path).is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el PNG temporal de la miniatura no es válido",
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar la miniatura: {error}").as_str(),
        )
    })?;
    let published = std::fs::metadata(&final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(ThumbnailExportResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes: published,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Genera el PNG en el propio test: un fixture base64 escrito a mano es
    /// frágil (el CRC del chunk se rompe con facilidad).
    fn one_pixel_png_data_url() -> String {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .expect("png");
        format!("data:image/png;base64,{}", STANDARD.encode(&png))
    }

    #[test]
    fn decodes_a_png_data_url() {
        let data_url = one_pixel_png_data_url();
        let bytes = decode_data_url(&data_url).expect("data url");
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let image = image::load_from_memory(&bytes).expect("png");
        assert_eq!((image.width(), image.height()), (1, 1));
    }

    #[test]
    fn saves_a_png_and_avoids_overwrite() {
        let dir = std::env::temp_dir().join(format!("editoria-thumb-save-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        let request = ThumbnailExportRequest {
            data_url: one_pixel_png_data_url(),
            output_dir: dir.to_string_lossy().into_owned(),
            file_name: Some("mi:miniatura".to_owned()),
        };
        let first = save_thumbnail(request.clone()).expect("primera");
        assert_eq!((first.width, first.height), (1, 1));
        assert!(first.bytes > 0);
        assert!(Path::new(&first.path).is_file());
        assert!(first.path.ends_with("mi-miniatura.png"));
        let second = save_thumbnail(request).expect("segunda");
        assert!(second.path.ends_with("mi-miniatura-2.png"));
        assert_ne!(first.path, second.path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_garbage_and_empty_payloads() {
        assert!(decode_data_url("").is_err());
        assert!(decode_data_url("data:image/png;base64,@@@").is_err());
    }

    #[test]
    fn sanitizes_names_and_avoids_overwrite() {
        assert_eq!(safe_stem(Some("mi:mini/../atura")), "mi-mini-atura");
        assert_eq!(safe_stem(Some("   ")), "miniatura");
        let dir = std::env::temp_dir().join(format!("editoria-thumb-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        let first = unique_path(&dir, "thumb");
        std::fs::write(&first, b"x").expect("archivo");
        let second = unique_path(&dir, "thumb");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().contains("thumb-2.png"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
