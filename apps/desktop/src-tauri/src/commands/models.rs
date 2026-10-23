//! Gestor de modelos locales para las capacidades de IA.
//!
//! Los pesos viven en una carpeta de datos de la app y se descargan una sola
//! vez con verificación de checksum. Cada modelo declara su **licencia** y su
//! origen: es una app cerrada de pago, así que el peso se audita igual que el
//! código — la licencia del repositorio no cubre automáticamente el archivo.
//!
//! Algunos modelos vienen en varios archivos (el ONNX con pesos externos, por
//! ejemplo): el spec declara la lista completa y la verificación exige todos.

use std::io::{BufWriter, Read, Write};
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
                url: "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/real_esrgan_x4plus/releases/v0.65.0/real_esrgan_x4plus-onnx-float.zip#real_esrgan_x4plus.onnx",
                sha256: "0c40d89889e621d4f1a9a0a6d728e4ccd612a67a90927ca8b394eb0917329ed9",
                bytes: 3_158_313,
            },
            ModelFileSpec {
                file_name: "real_esrgan_x4plus.data",
                url: "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/real_esrgan_x4plus/releases/v0.65.0/real_esrgan_x4plus-onnx-float.zip#real_esrgan_x4plus.data",
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

/// Un archivo pendiente de descargar dentro de un modelo.
struct PendingFile {
    path: PathBuf,
    file_name: &'static str,
    url: &'static str,
    sha256: &'static str,
    bytes: u64,
}

fn pending_files(state: &AppState, spec: &ModelSpec) -> Vec<PendingFile> {
    spec.files
        .iter()
        .filter(|file| {
            let path = model_file(state, spec, file);
            !path.is_file()
                || std::fs::metadata(&path)
                    .map(|meta| meta.len() != file.bytes)
                    .unwrap_or(true)
        })
        .map(|file| PendingFile {
            path: model_file(state, spec, file),
            file_name: file.file_name,
            url: file.url,
            sha256: file.sha256,
            bytes: file.bytes,
        })
        .collect()
}

/// Descarga los archivos que falten del modelo, con progreso y verificación.
///
/// Emite `model-download` con `{ id, percent }` (porcentaje sobre el total del
/// modelo, no por archivo). Si un SHA-256 no coincide, ese archivo se borra: un
/// modelo corrupto no se usa, se vuelve a bajar.
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
        for file in &pending {
            let partial_ext = file
                .path
                .extension()
                .map(|ext| ext.to_string_lossy().into_owned())
                .unwrap_or_default();
            let partial = file.path.with_extension(format!("{partial_ext}.partial"));
            let response = reqwest::blocking::Client::new()
                .get(file.url)
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
            let target = std::fs::File::create(&partial).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo escribir el modelo")
            })?;
            let mut writer = BufWriter::new(target);
            let mut hasher = Sha256::new();
            let mut reader = response;
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let read = reader.read(&mut buffer).map_err(|_| {
                    ProjectError::message(ProjectErrorCode::Io, "la descarga del modelo se cortó")
                })?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read]).map_err(|_| {
                    ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el modelo")
                })?;
                hasher.update(&buffer[..read]);
                done_bytes += read as u64;
                let percent = ((done_bytes as f64 / total_bytes as f64) * 100.0) as i64;
                let _ = app_handle.emit(
                    "model-download",
                    serde_json::json!({ "id": model_id, "percent": percent.min(99) }),
                );
            }
            writer.flush().map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el modelo")
            })?;
            let digest = format!("{:x}", hasher.finalize());
            if digest != file.sha256 {
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
            std::fs::rename(&partial, &file.path).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo instalar el modelo")
            })?;
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
