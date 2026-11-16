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

/// AUD-127: topes antes de tocar el payload — un data URL hostil no puede
/// inflar la RAM ni declarar dimensiones gigantes sin que el decoder las
/// rechace antes de reservar el raster.
const MAX_THUMBNAIL_BYTES: usize = 64 * 1024 * 1024;
const MAX_DATA_URL_PAYLOAD_CHARS: usize = 4 * (MAX_THUMBNAIL_BYTES / 3 + 1);
const MAX_THUMBNAIL_DIMENSION: u32 = 16_384;
const MAX_THUMBNAIL_ALLOC: u64 = 2 * 1024 * 1024 * 1024;

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
    // AUD-127: el tope se aplica sobre el payload ANTES de decodificar —
    // base64 infla ~4/3, así que un string gigante ya es motivo de rechazo.
    if payload.len() > MAX_DATA_URL_PAYLOAD_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura excede el tamaño máximo admitido",
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
    // Carpeta de destino elegida por el usuario: política de escritura de
    // `fs_*` — absoluta y fuera de sistema/credenciales/carpeta de la app.
    let output_dir = crate::application::fs::validate_user_write_path(&request.output_dir)?;
    if !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de la miniatura no existe",
        ));
    }
    let bytes = decode_data_url(&request.data_url)?;
    let invalid_image = || {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura no es una imagen válida",
        )
    };
    // AUD-127: las dimensiones se leen del header ANTES de decodificar —
    // un PNG de pocos KB puede declarar 100.000×100.000 y el decoder
    // reservaría gigas de raster antes del chequeo de rango.
    let (width, height) = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| invalid_image())?
        .into_dimensions()
        .map_err(|_| invalid_image())?;
    if width == 0
        || height == 0
        || width > MAX_THUMBNAIL_DIMENSION
        || height > MAX_THUMBNAIL_DIMENSION
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la miniatura tiene dimensiones fuera de rango",
        ));
    }
    // Y la decodificación en sí corre con límites del decoder: aunque el
    // header mienta sobre el contenido, el raster queda acotado.
    let mut reader = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| invalid_image())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_THUMBNAIL_DIMENSION);
    limits.max_image_height = Some(MAX_THUMBNAIL_DIMENSION);
    limits.max_alloc = Some(MAX_THUMBNAIL_ALLOC);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| invalid_image())?;
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
    fn rechaza_payloads_mayores_al_tope_antes_de_decodificar() {
        // AUD-127: el tope se evalúa sobre la longitud del payload, sin
        // materializar los bytes decodificados.
        let oversized = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_DATA_URL_PAYLOAD_CHARS + 1)
        );
        let error = decode_data_url(&oversized).expect_err("debió rechazar");
        assert!(error.message.contains("tamaño máximo"));
    }

    fn crc32_ieee(bytes: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &byte in bytes {
            crc ^= byte as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    /// PNG real de 1×1 con el IHDR patcheado a `width`×`height` (CRC
    /// recalculado): el escenario del decompression bomb — un archivo
    /// diminuto que declara un raster gigante.
    fn png_with_hostile_dimensions(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .expect("png");
        // Estructura: sig(8) + len(4) + "IHDR"(4) + data(13) + crc(4).
        // Ancho en bytes 16..20, alto en 20..24, CRC en 29..33.
        png[16..20].copy_from_slice(&width.to_be_bytes());
        png[20..24].copy_from_slice(&height.to_be_bytes());
        let crc = crc32_ieee(&png[12..29]);
        png[29..33].copy_from_slice(&crc.to_be_bytes());
        png
    }

    #[test]
    fn rechaza_imagenes_con_dimensiones_hostiles_leidas_del_header() {
        // AUD-127: 20.000×20.000 excede el tope aunque el PNG sea diminuto.
        let hostile = STANDARD.encode(png_with_hostile_dimensions(20_000, 20_000));
        let dir = std::env::temp_dir().join(format!("editoria-thumb-bomb-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        let request = ThumbnailExportRequest {
            data_url: format!("data:image/png;base64,{hostile}"),
            output_dir: dir.to_string_lossy().into_owned(),
            file_name: None,
        };
        let error = save_thumbnail(request).expect_err("debió rechazar");
        assert!(error.message.contains("dimensiones"));
        let _ = std::fs::remove_dir_all(&dir);
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
