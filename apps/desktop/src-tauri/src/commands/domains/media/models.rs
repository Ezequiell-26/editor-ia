//! Gestor de modelos locales para las capacidades de IA.
//!
//! Los pesos viven en una carpeta de datos de la app y se descargan una sola
//! vez con verificación de checksum. Cada modelo declara su **licencia** y su
//! origen: es una app cerrada de pago, así que el peso se audita igual que el
//! código — la licencia del repositorio no cubre automáticamente el archivo.
//!
//! Algunos modelos vienen en varios archivos (el ONNX con pesos externos, por
//! ejemplo): el spec declara la lista completa y la verificación exige todos.

use std::io::{BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// La licencia del **peso**, no del código que lo convirtió.
#[derive(Debug, Clone, Copy)]
pub struct ModelLicenseSpec {
    pub id: &'static str,
    pub detail: &'static str,
    pub url: &'static str,
}

/// Un archivo del modelo. Varios archivos = un modelo (onnx + pesos externos).
#[derive(Debug, Clone, Copy)]
pub struct ModelFileSpec {
    pub file_name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

/// Declaración estática de un modelo: todo `&'static str` para poder vivir en
/// una constante. Los `String` se arman al exponerlo por la interfaz.
#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    /// Subcarpeta dentro de `models/` (los archivos viven juntos).
    pub dir_name: &'static str,
    pub capability: &'static str,
    pub purpose: &'static str,
    pub license: ModelLicenseSpec,
    pub files: &'static [ModelFileSpec],
}

/// Modelos disponibles. Uno por capacidad que necesite inferencia local.
///
/// Los checksums se fijaron descargando cada archivo una vez y calculando
/// SHA-256: la descarga de la app verifica contra estos valores, no contra la
/// confianza en el servidor.
pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "u2netp",
        dir_name: "u2netp",
        capability: "remove-background",
        purpose: "Recorta el sujeto de una foto generando su recorte con transparencia.",
        license: ModelLicenseSpec {
            id: "apache-2.0",
            detail: "Pesos de U²-Net (Apache-2.0), conversión ONNX publicada por rembg (MIT).",
            url: "https://github.com/xuebinqin/U-2-Net/blob/main/LICENSE",
        },
        files: &[ModelFileSpec {
            file_name: "u2netp.onnx",
            url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
            sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
            bytes: 4_574_861,
        }],
    },
    ModelSpec {
        id: "real-esrgan-x4plus",
        dir_name: "real-esrgan-x4plus",
        capability: "upscale",
        purpose: "Agranda una imagen ×4 recuperando detalle (Real-ESRGAN).",
        license: ModelLicenseSpec {
            id: "bsd-3-clause",
            detail: "Real-ESRGAN-x4plus exportado por Qualcomm AI Hub (BSD-3-Clause), sobre la arquitectura de xinntao/Real-ESRGAN (BSD-3-Clause).",
            url: "https://huggingface.co/qualcomm/Real-ESRGAN-x4plus",
        },
        files: &[
            ModelFileSpec {
                file_name: "real_esrgan_x4plus.onnx",
                url: "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/real_esrgan_x4plus/releases/v0.65.0/real_esrgan_x4plus-onnx-float.zip#real_esrgan_x4plus-onnx-float/real_esrgan_x4plus.onnx",
                sha256: "0c40d89889e621d4f1a9a0a6d728e4ccd612a67a90927ca8b394eb0917329ed9",
                bytes: 3_158_313,
            },
            ModelFileSpec {
                file_name: "real_esrgan_x4plus.data",
                url: "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/real_esrgan_x4plus/releases/v0.65.0/real_esrgan_x4plus-onnx-float.zip#real_esrgan_x4plus-onnx-float/real_esrgan_x4plus.data",
                sha256: "28fada125730d3c87d504d48dd8332837f65811ec431a570ea4919ba3eee3287",
                bytes: 66_737_664,
            },
        ],
    },
    ModelSpec {
        id: "seeta-face",
        dir_name: "seeta-face",
        capability: "face-detection",
        purpose: "Detecta rostros para el encuadre inteligente de shorts y recortes.",
        license: ModelLicenseSpec {
            id: "bsd-2-clause",
            detail: "Modelo de detección facial SeetaFace (BSD-2-Clause), ejecutado localmente con rustface.",
            url: "https://github.com/seetaface/SeetaFaceEngine/blob/master/LICENSE",
        },
        files: &[ModelFileSpec {
            file_name: "seeta_fd_frontal_v1.0.bin",
            url: "https://raw.githubusercontent.com/seetaface/SeetaFaceEngine/master/FaceDetection/model/seeta_fd_frontal_v1.0.bin",
            sha256: "c4619d066ed35e84d9a8e842860b0dff567aba0cbb139881075538761db3ff5d",
            bytes: 1_209_904,
        }],
    },
];

pub fn model_by_id(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|model| model.id == id)
}

pub fn models_dir(state: &AppState) -> PathBuf {
    state.config_dir.join("models")
}

pub fn model_dir(state: &AppState, spec: &ModelSpec) -> PathBuf {
    models_dir(state).join(spec.dir_name)
}

pub fn model_file(state: &AppState, spec: &ModelSpec, file: &ModelFileSpec) -> PathBuf {
    model_dir(state, spec).join(file.file_name)
}

/// El modelo está completo cuando todos sus archivos existen y pesan lo justo.
pub fn is_model_downloaded(state: &AppState, spec: &ModelSpec) -> bool {
    spec.files.iter().all(|file| {
        let path = model_file(state, spec, file);
        path.is_file()
            && std::fs::metadata(&path)
                .map(|meta| meta.len() == file.bytes)
                .unwrap_or(false)
    })
}

pub fn total_bytes(spec: &ModelSpec) -> u64 {
    spec.files.iter().map(|file| file.bytes).sum()
}

/// Verifica el SHA-256 de un modelo ya instalado. Se usa antes de cargar pesos
/// que no vienen de ONNX (por ejemplo SeetaFace) para no ejecutar un archivo
/// corrupto que casualmente tenga el tamaño correcto.
pub fn verify_model_hash(state: &AppState, spec: &ModelSpec) -> bool {
    spec.files.iter().all(|file| {
        let path = model_file(state, spec, file);
        let Ok(mut handle) = std::fs::File::open(&path) else {
            return false;
        };
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            match handle.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => hasher.update(&buffer[..read]),
                Err(_) => return false,
            }
        }
        format!("{:x}", hasher.finalize()) == file.sha256
    })
}

fn license_of(spec: &ModelSpec) -> ModelLicense {
    ModelLicense {
        id: spec.license.id.to_owned(),
        detail: spec.license.detail.to_owned(),
        url: spec.license.url.to_owned(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLicense {
    pub id: String,
    pub detail: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub capability: String,
    pub purpose: String,
    pub bytes: u64,
    pub downloaded: bool,
    pub license: ModelLicense,
    pub source_url: String,
}

fn model_info(state: &AppState, spec: &ModelSpec) -> ModelInfo {
    ModelInfo {
        id: spec.id.to_owned(),
        capability: spec.capability.to_owned(),
        purpose: spec.purpose.to_owned(),
        bytes: total_bytes(spec),
        downloaded: is_model_downloaded(state, spec),
        license: license_of(spec),
        source_url: spec.license.url.to_owned(),
    }
}

#[tauri::command]
pub fn list_models(state: State<'_, AppState>) -> Result<Vec<ModelInfo>, ProjectError> {
    let snapshot = &*state;
    Ok(MODELS
        .iter()
        .map(|spec| model_info(snapshot, spec))
        .collect())
}

/// Archivos del modelo que faltan o están incompletos.
fn pending_files(state: &AppState, spec: &ModelSpec) -> Vec<ModelFileSpec> {
    spec.files
        .iter()
        .copied()
        .filter(|file| {
            let path = model_file(state, spec, file);
            !path.is_file()
                || std::fs::metadata(&path)
                    .map(|meta| meta.len() != file.bytes)
                    .unwrap_or(true)
        })
        .collect()
}

/// Separa una URL de descarga de una entrada ZIP: `paquete.zip#ruta/interna`.
/// El fragmento no viaja al servidor; lo usa la app para extraer el archivo.
fn split_archive_url(url: &str) -> (&str, Option<&str>) {
    match url.split_once('#') {
        Some((base, entry)) if !entry.trim().is_empty() => (base, Some(entry.trim())),
        Some((base, _)) => (base, None),
        None => (url, None),
    }
}

fn zip_cache_path(cache_dir: &Path, archive_url: &str) -> PathBuf {
    let digest = Sha256::digest(archive_url.as_bytes());
    cache_dir.join(format!(".archive-{:x}.zip", digest))
}

/// Resuelve la entrada del ZIP por ruta exacta o por nombre de archivo. El
/// catálogo histórico usaba sólo el basename; se acepta igual.
fn resolve_zip_entry<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    requested: &str,
) -> Result<String, ProjectError> {
    if archive.by_name(requested).is_ok() {
        return Ok(requested.to_owned());
    }
    let base_name = requested.rsplit('/').next().unwrap_or(requested);
    for index in 0..archive.len() {
        let Ok(entry) = archive.by_index(index) else {
            continue;
        };
        let Ok(name) = entry.name() else {
            continue;
        };
        if name.rsplit('/').next() == Some(base_name) {
            return Ok(name.into_owned());
        }
    }
    Err(ProjectError::message(
        ProjectErrorCode::InvalidProviderResponse,
        format!("el paquete del modelo no contiene {requested}").as_str(),
    ))
}

/// Descarga por HTTP y entrega cada bloque al consumidor, sin cargar el
/// archivo entero en memoria.
fn stream_download(
    url: &str,
    mut on_chunk: impl FnMut(&[u8]) -> Result<(), ProjectError>,
) -> Result<(), ProjectError> {
    let response = reqwest::blocking::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(1800))
        .send()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo descargar el modelo; revisá la conexión",
            )
        })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!("la descarga del modelo devolvió {}", response.status()).as_str(),
        ));
    }
    let mut reader = response;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "la descarga del modelo se cortó")
        })?;
        if read == 0 {
            break;
        }
        on_chunk(&buffer[..read])?;
    }
    Ok(())
}

/// Baja un paquete ZIP una sola vez y lo deja en la carpeta del modelo para
/// reutilizarlo entre sus archivos. Se borra al terminar la descarga completa.
fn ensure_archive(
    base_url: &str,
    cache_dir: &Path,
    archives: &mut Vec<PathBuf>,
) -> Result<PathBuf, ProjectError> {
    let cache = zip_cache_path(cache_dir, base_url);
    if cache.is_file() {
        archives.push(cache.clone());
        return Ok(cache);
    }
    let partial = cache.with_extension("zip.partial");
    {
        let target = std::fs::File::create(&partial).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo escribir el paquete del modelo",
            )
        })?;
        let mut writer = BufWriter::new(target);
        stream_download(base_url, |chunk| {
            writer.write_all(chunk).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo guardar el paquete del modelo",
                )
            })
        })?;
        writer.flush().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo guardar el paquete del modelo",
            )
        })?;
    }
    std::fs::rename(&partial, &cache).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo instalar el paquete del modelo",
        )
    })?;
    archives.push(cache.clone());
    Ok(cache)
}

/// Descarga un archivo del modelo (directo o dentro de un ZIP), verifica el
/// SHA-256 y los bytes, y recién entonces lo mueve a su ruta final.
fn download_file_verified(
    file: &ModelFileSpec,
    target: &Path,
    cache_dir: &Path,
    archives: &mut Vec<PathBuf>,
    done_bytes: &mut u64,
    total_bytes: u64,
    on_progress: &mut dyn FnMut(i64),
) -> Result<(), ProjectError> {
    let partial_ext = target
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned())
        .unwrap_or_default();
    let partial = target.with_extension(format!("{partial_ext}.partial"));
    let (base_url, entry_name) = split_archive_url(file.url);
    let mut hasher = Sha256::new();
    let mut written: u64 = 0;

    if let Some(entry_name) = entry_name {
        let archive_path = ensure_archive(base_url, cache_dir, archives)?;
        let handle = std::fs::File::open(&archive_path).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo abrir el paquete del modelo",
            )
        })?;
        let mut archive = zip::ZipArchive::new(handle).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el paquete del modelo no es un ZIP válido",
            )
        })?;
        let resolved = resolve_zip_entry(&mut archive, entry_name)?;
        let mut entry = archive.by_name(&resolved).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "no se pudo leer la entrada del paquete del modelo",
            )
        })?;
        let target_file = std::fs::File::create(&partial).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo escribir el modelo")
        })?;
        let mut writer = BufWriter::new(target_file);
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buffer).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo extraer el modelo")
            })?;
            if read == 0 {
                break;
            }
            writer.write_all(&buffer[..read]).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el modelo")
            })?;
            hasher.update(&buffer[..read]);
            written += read as u64;
            *done_bytes += read as u64;
            let percent = ((*done_bytes as f64 / total_bytes as f64) * 100.0) as i64;
            on_progress(percent.min(99));
        }
        writer.flush().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el modelo")
        })?;
    } else {
        let target_file = std::fs::File::create(&partial).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo escribir el modelo")
        })?;
        let mut writer = BufWriter::new(target_file);
        stream_download(base_url, |chunk| {
            writer.write_all(chunk).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el modelo")
            })?;
            hasher.update(chunk);
            written += chunk.len() as u64;
            *done_bytes += chunk.len() as u64;
            let percent = ((*done_bytes as f64 / total_bytes as f64) * 100.0) as i64;
            on_progress(percent.min(99));
            Ok(())
        })?;
        writer.flush().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el modelo")
        })?;
    }

    let digest = format!("{:x}", hasher.finalize());
    if digest != file.sha256 || written != file.bytes {
        let _ = std::fs::remove_file(&partial);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            format!(
                "el archivo {} no coincide con el checksum esperado; se descartó",
                file.file_name
            )
            .as_str(),
        ));
    }
    std::fs::rename(&partial, target).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo instalar el modelo")
    })?;
    Ok(())
}

/// Descarga los archivos que falten del modelo, con progreso y verificación.
///
/// Emite `model-download` con `{ id, percent }` (porcentaje sobre el total del
/// modelo, no por archivo). Si un SHA-256 no coincide, ese archivo se borra: un
/// modelo corrupto no se usa, se vuelve a bajar. Los modelos con pesos externos
/// vienen en un ZIP: se baja una vez y se extraen sus entradas.
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ModelInfo, ProjectError> {
    let spec = model_by_id(&id).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "ese modelo no existe en el catálogo",
        )
    })?;
    if is_model_downloaded(&state, spec) {
        return Ok(model_info(&state, spec));
    }

    let dir = model_dir(&state, spec);
    std::fs::create_dir_all(&dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta de modelos",
        )
    })?;
    let pending = pending_files(&state, spec);
    let total_bytes: u64 = pending.iter().map(|file| file.bytes).sum::<u64>().max(1);

    let app_handle = app.clone();
    let model_id = spec.id.to_owned();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), ProjectError> {
        let mut done_bytes: u64 = 0;
        let mut archives: Vec<PathBuf> = Vec::new();
        for file in &pending {
            let target = dir.join(file.file_name);
            download_file_verified(
                file,
                &target,
                &dir,
                &mut archives,
                &mut done_bytes,
                total_bytes,
                &mut |percent| {
                    let _ = app_handle.emit(
                        "model-download",
                        serde_json::json!({ "id": model_id, "percent": percent }),
                    );
                },
            )?;
        }
        for archive in archives {
            let _ = std::fs::remove_file(archive);
        }
        Ok(())
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la descarga del modelo se interrumpió",
        )
    })??;

    Ok(model_info(&state, spec))
}

#[tauri::command]
pub fn delete_model(state: State<'_, AppState>, id: String) -> Result<bool, ProjectError> {
    let spec = model_by_id(&id)
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::NotFound, "ese modelo no existe"))?;
    let dir = model_dir(&state, spec);
    if !dir.is_dir() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir)
        .map(|_| true)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo borrar el modelo"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_archive_urls_from_direct_urls() {
        assert_eq!(
            split_archive_url("https://cdn/model.zip#carpeta/pesos.onnx"),
            ("https://cdn/model.zip", Some("carpeta/pesos.onnx"))
        );
        assert_eq!(
            split_archive_url("https://cdn/model.onnx"),
            ("https://cdn/model.onnx", None)
        );
        assert_eq!(
            split_archive_url("https://cdn/model.zip#"),
            ("https://cdn/model.zip", None)
        );
    }

    #[test]
    fn resolves_zip_entries_by_path_or_basename() {
        let dir = std::env::temp_dir().join(format!("olyvia-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp");
        let zip_path = dir.join("modelo.zip");
        {
            let file = std::fs::File::create(&zip_path).expect("zip");
            let mut writer = zip::ZipWriter::new(file);
            writer
                .start_file(
                    "carpeta/pesos.onnx",
                    zip::write::SimpleFileOptions::default(),
                )
                .expect("entrada");
            writer.write_all(b"modelo").expect("contenido");
            writer.finish().expect("cerrar");
        }
        let mut archive =
            zip::ZipArchive::new(std::fs::File::open(&zip_path).expect("abrir")).expect("zip");
        assert_eq!(
            resolve_zip_entry(&mut archive, "carpeta/pesos.onnx").expect("ruta exacta"),
            "carpeta/pesos.onnx"
        );
        assert_eq!(
            resolve_zip_entry(&mut archive, "pesos.onnx").expect("basename"),
            "carpeta/pesos.onnx"
        );
        assert!(resolve_zip_entry(&mut archive, "otro.onnx").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Descarga real del modelo con pesos externos (62 MB) y verifica que el
    /// ZIP se extraiga y que ambos archivos coincidan con su checksum.
    #[test]
    #[ignore = "descarga real de 62 MB; requiere red y EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_downloads_real_esrgan_zip_files() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la descarga real");
            return;
        }
        let spec = model_by_id("real-esrgan-x4plus").expect("spec");
        let dir = std::env::temp_dir().join(format!("olyvia-esrgan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp");
        let total = total_bytes(spec);
        let mut done = 0u64;
        let mut archives = Vec::new();
        for file in spec.files {
            let target = dir.join(file.file_name);
            download_file_verified(
                file,
                &target,
                &dir,
                &mut archives,
                &mut done,
                total,
                &mut |_| {},
            )
            .expect("descarga verificada");
            let meta = std::fs::metadata(&target).expect("archivo");
            assert_eq!(meta.len(), file.bytes);
            let mut hasher = Sha256::new();
            let mut handle = std::fs::File::open(&target).expect("abrir");
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let read = handle.read(&mut buffer).expect("leer");
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            assert_eq!(format!("{:x}", hasher.finalize()), file.sha256);
        }
        for archive in archives {
            let _ = std::fs::remove_file(archive);
        }
        let _ = std::fs::remove_dir_all(&dir);
        eprintln!("real-esrgan verificado: {done} bytes extraídos del ZIP");
    }
}
