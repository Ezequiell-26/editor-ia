//! Registro de capacidades: qué puede hacer la app en esta máquina y con qué
//! backend.
//!
//! La regla fundacional del producto: ninguna capacidad exige internet. Cada
//! una declara sus backends (local o remoto) y su estado **medido**; la UI
//! muestra la capacidad y el motivo cuando está desactivada, nunca un botón
//! que rota.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

use super::models::{is_model_downloaded, MODELS};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBackend {
    pub id: String,
    pub kind: String,
    pub detail: String,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityInfo {
    pub id: String,
    pub label: String,
    pub purpose: String,
    pub backends: Vec<CapabilityBackend>,
    pub available: bool,
}

fn backend_local(
    id: &str,
    detail: String,
    available: bool,
    reason: Option<String>,
) -> CapabilityBackend {
    CapabilityBackend {
        id: id.to_owned(),
        kind: "local".to_owned(),
        detail,
        available,
        reason,
    }
}

/// Qué puede hacer esta máquina, medido ahora.
#[tauri::command]
pub fn list_capabilities(state: State<'_, AppState>) -> Vec<CapabilityInfo> {
    let mut capabilities: Vec<CapabilityInfo> = Vec::new();

    // --- Capacidades que consumen modelos locales ---
    for spec in MODELS {
        let downloaded = is_model_downloaded(&state, spec);
        let model_path = super::models::model_dir(&state, spec)
            .join(spec.files.first().map(|file| file.file_name).unwrap_or(""));
        capabilities.push(CapabilityInfo {
            id: spec.capability.to_owned(),
            label: capability_label(spec.capability),
            purpose: spec.purpose.to_owned(),
            backends: vec![backend_local(
                &format!("modelo-{}", spec.id),
                format!("Modelo {} en el equipo", spec.id),
                downloaded,
                if downloaded {
                    None
                } else {
                    Some(format!(
                        "Falta descargar el modelo ({} MB). Está en Ajustes → Capacidades.",
                        spec.files
                            .iter()
                            .map(|file| file.bytes)
                            .sum::<u64>()
                            .div_ceil(1_048_576)
                    ))
                },
            )],
            // SeetaFace corre con rustface puro: no necesita ONNX Runtime.
            available: downloaded
                && (spec.capability == "face-detection"
                    || super::background::onnx_runtime_available(Some(&model_path))),
        });
    }

    // --- Capacidades con motor propio ya verificado ---
    capabilities.push(whisper_capability(&state));
    capabilities.push(tts_capability(&state));
    capabilities.push(vmaf_capability(&state));
    capabilities.push(whiteboard_capability());

    capabilities
}

fn capability_label(capability: &str) -> String {
    match capability {
        "remove-background" => "Quitar fondo de una foto".to_owned(),
        "upscale" => "Agrandar una imagen ×4".to_owned(),
        "face-detection" => "Detectar rostros para smart reframe".to_owned(),
        other => other.to_owned(),
    }
}

/// Whisper local: hay dos motores y la capability queda disponible si
/// cualquiera de los dos puede producir una transcripción.
///
/// - **whisper.cpp in-process** (concat-speech-min): compilado en el
///   binario; los modelos `ggml` se descargan bajo demanda a
///   `<config>/whisper-models` con SHA-256. "Descargable" cuenta como
///   disponible — la primera transcripción baja el modelo sola — pero el
///   detalle lo dice explícito: la descarga pide conexión una vez.
/// - **faster-whisper** (Python externo): el camino histórico; disponible
///   sólo con un Python verificado que importe el módulo.
fn whisper_capability(state: &AppState) -> CapabilityInfo {
    let python_status = super::transcribe::whisper_status();
    let native = super::transcribe::native_whisper_status(&state.config_dir).ok();

    let mut backends = Vec::with_capacity(2);
    let mut native_available = false;
    if let Some(native) = &native {
        native_available = native.engine_available;
        let downloaded = native.models.iter().filter(|model| model.downloaded).count();
        let total = native.models.len();
        let downloading = native.download.running;
        let detail = if downloading {
            format!(
                "whisper.cpp integrado; descargando el modelo {} ahora ({}/{} MB aprox.)",
                native.download.model_id.as_deref().unwrap_or("?"),
                native
                    .download
                    .progress
                    .as_ref()
                    .map(|progress| progress.received / 1_048_576)
                    .unwrap_or(0),
                native
                    .download
                    .progress
                    .as_ref()
                    .map(|progress| progress.total / 1_048_576)
                    .unwrap_or(0),
            )
        } else {
            format!(
                "whisper.cpp integrado ({} de {} modelos descargados; el que falte se baja solo al transcribir, una vez)",
                downloaded, total
            )
        };
        backends.push(backend_local(
            "whisper.cpp",
            detail,
            native_available,
            if native_available {
                None
            } else {
                Some("el motor nativo no está disponible en este build".to_owned())
            },
        ));
    } else {
        backends.push(backend_local(
            "whisper.cpp",
            "whisper.cpp integrado; no se pudo leer el estado de sus modelos".to_owned(),
            false,
            Some("no se pudo inspeccionar la carpeta de modelos whisper".to_owned()),
        ));
    }

    let python_available = python_status.available();
    let detail = match python_status
        .python
        .as_deref()
        .and_then(|python| python.file_name())
    {
        Some(name) => format!(
            "Python verificado con faster-whisper en el equipo ({})",
            name.to_string_lossy()
        ),
        None => "Python del equipo con faster-whisper (el motor no viene empaquetado)".to_owned(),
    };
    backends.push(backend_local(
        "faster-whisper",
        detail,
        python_available,
        if python_available {
            None
        } else {
            Some(python_status.reason.clone().unwrap_or_else(|| {
                "falta un Python con faster-whisper; instalá el motor y reiniciá Olyvia".to_owned()
            }))
        },
    ));

    CapabilityInfo {
        id: "transcribe".to_owned(),
        label: "Transcribir audio y video".to_owned(),
        purpose: "Pasa la voz a texto con subtítulos por palabra, todo local.".to_owned(),
        available: native_available || python_available,
        backends,
    }
}

/// Whiteboard: el motor `whiteboard-animator` tampoco viene empaquetado; se
/// informa disponible sólo con un Python verificado que importe el paquete.
fn whiteboard_capability() -> CapabilityInfo {
    let status = super::whiteboard::whiteboard_status();
    let available = status.available;
    let detail = match status
        .python
        .as_deref()
        .and_then(|python| python.file_name())
    {
        Some(name) => format!(
            "Python verificado con whiteboard-animator en el equipo ({})",
            name.to_string_lossy()
        ),
        None => {
            "Python del equipo con whiteboard-animator (el motor no viene empaquetado)"
                .to_owned()
        }
    };
    CapabilityInfo {
        id: "whiteboard".to_owned(),
        label: "Animar una imagen como pizarra".to_owned(),
        purpose: "Convierte una imagen en un video donde el contenido se dibuja trazo a trazo.".to_owned(),
        backends: vec![backend_local(
            "whiteboard-animator",
            detail,
            available,
            if available {
                None
            } else {
                status.reason.clone()
            },
        )],
        available,
    }
}

/// TTS local: SAPI en Windows siempre está; Piper es el siguiente backend.
fn tts_capability(state: &AppState) -> CapabilityInfo {
    let sapi = PathBuf::from("C:\\Windows\\System32\\Speech").is_dir();
    let _ = state;
    CapabilityInfo {
        id: "text-to-speech".to_owned(),
        label: "Voz local para la narración".to_owned(),
        purpose: "Convierte el guion en narración sin servicios externos.".to_owned(),
        backends: vec![backend_local(
            "sapi",
            "Voces SAPI de Windows".to_owned(),
            sapi,
            if sapi {
                None
            } else {
                Some("Windows no tiene voces SAPI instaladas".to_owned())
            },
        )],
        available: sapi,
    }
}

/// VMAF: mide la calidad objetiva de una compresión. Depende del build.
fn vmaf_capability(state: &AppState) -> CapabilityInfo {
    let settings = state.settings_snapshot().ok();
    let available = settings
        .as_ref()
        .map(|settings| {
            crate::commands::convert::resolve_tools_public(settings)
                .0
                .is_some()
        })
        .unwrap_or(false);
    let has_filter = available
        && settings
            .as_ref()
            .map(|settings| {
                let (ffmpeg, _, _) = crate::commands::convert::resolve_tools_public(settings);
                ffmpeg
                    .map(|ffmpeg| crate::commands::convert::vmaf_filter_available(&ffmpeg))
                    .unwrap_or(false)
            })
            .unwrap_or(false);
    CapabilityInfo {
        id: "quality-measurement".to_owned(),
        label: "Medir calidad (VMAF)".to_owned(),
        purpose: "Puntaje objetivo de cuánto se perdió en una compresión.".to_owned(),
        backends: vec![backend_local(
            "libvmaf",
            "Filtro libvmaf del FFmpeg local".to_owned(),
            has_filter,
            if has_filter {
                None
            } else {
                Some("Este build de FFmpeg no trae libvmaf".to_owned())
            },
        )],
        available: has_filter,
    }
}
