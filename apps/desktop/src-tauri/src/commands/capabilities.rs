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
                        (spec.files.iter().map(|file| file.bytes).sum::<u64>() + 1_048_575)
                            / 1_048_576
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

/// Whisper local: la transcripción usa el CLI empaquetado si está instalado.
fn whisper_capability(state: &AppState) -> CapabilityInfo {
    let available = super::background::whisper_cli_available();
    CapabilityInfo {
        id: "transcribe".to_owned(),
        label: "Transcribir audio y video".to_owned(),
        purpose: "Pasa la voz a texto con subtítulos por palabra, todo local.".to_owned(),
        backends: vec![backend_local(
            "whisper-cli",
            "Faster-Whisper empaquetado con la app".to_owned(),
            available,
            if available {
                None
            } else {
                Some("Falta instalar el motor de transcripción (Inicio → herramientas)".to_owned())
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
