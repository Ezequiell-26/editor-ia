//! Catálogo y auditoría de efectos visuales y transiciones.
//!
//! La app ya renderiza los efectos y las transiciones; este módulo es la capa
//! de gestión backend: expone qué filtros de FFmpeg existen en esta máquina,
//! qué parámetros y límites tiene cada efecto, qué presets y transiciones hay,
//! y audita un proyecto sin modificarlo. No reemplaza al editor ni duplica el
//! historial de deshacer: sólo informa.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectParameter {
    pub key: String,
    pub label: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualEffectSpec {
    pub id: String,
    pub label: String,
    pub category: String,
    pub description: String,
    pub filters: Vec<String>,
    pub available: bool,
    pub parameters: Vec<EffectParameter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualPresetSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    pub default_frames: u32,
    pub max_frames: u32,
    pub overlaps_previous: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSupport {
    pub name: String,
    pub label: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualCatalog {
    pub ffmpeg_available: bool,
    pub effects: Vec<VisualEffectSpec>,
    pub presets: Vec<VisualPresetSpec>,
    pub transitions: Vec<TransitionSpec>,
    pub filters: Vec<FilterSupport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualFinding {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub clip_id: Option<String>,
    pub clip_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualAudit {
    pub clips_scanned: u32,
    pub transitions: u32,
    pub effects_clips: u32,
    pub findings: Vec<VisualFinding>,
}

fn parameter(key: &str, label: &str, min: f64, max: f64, default: f64) -> EffectParameter {
    EffectParameter {
        key: key.to_owned(),
        label: label.to_owned(),
        min,
        max,
        default,
        unit: "range".to_owned(),
    }
}

fn effect(
    id: &str,
    label: &str,
    category: &str,
    description: &str,
    filters: &[&str],
    parameters: Vec<EffectParameter>,
) -> VisualEffectSpec {
    VisualEffectSpec {
        id: id.to_owned(),
        label: label.to_owned(),
        category: category.to_owned(),
        description: description.to_owned(),
        filters: filters.iter().map(|value| (*value).to_owned()).collect(),
        available: true,
        parameters,
    }
}

fn preset(id: &str, label: &str, description: &str, settings: Value) -> VisualPresetSpec {
    VisualPresetSpec {
        id: id.to_owned(),
        label: label.to_owned(),
        description: description.to_owned(),
        settings,
    }
}

fn catalog_effects() -> Vec<VisualEffectSpec> {
    vec![
        effect(
            "brightness",
            "Brillo",
            "color",
            "Sube o baja la exposición general del clip.",
            &["eq"],
            vec![parameter("brightness", "Brillo", -1.0, 1.0, 0.0)],
        ),
        effect(
            "contrast",
            "Contraste",
            "color",
            "Separa luces y sombras.",
            &["eq"],
            vec![parameter("contrast", "Contraste", 0.0, 3.0, 1.0)],
        ),
        effect(
            "saturation",
            "Saturación",
            "color",
            "Intensifica o desatura el color.",
            &["eq"],
            vec![parameter("saturation", "Saturación", 0.0, 3.0, 1.0)],
        ),
        effect(
            "temperature",
            "Temperatura",
            "color",
            "Enfría o calienta la imagen.",
            &["colorbalance"],
            vec![parameter("temperature", "Temperatura", -1.0, 1.0, 0.0)],
        ),
        effect(
            "shadows",
            "Sombras",
            "color",
            "Levanta o hunde las sombras.",
            &["curves"],
            vec![parameter("shadows", "Sombras", -1.0, 1.0, 0.0)],
        ),
        effect(
            "highlights",
            "Altas luces",
            "color",
            "Recupera o quema las altas luces.",
            &["curves"],
            vec![parameter("highlights", "Altas luces", -1.0, 1.0, 0.0)],
        ),
        effect(
            "vignette",
            "Viñeta",
            "stylize",
            "Oscurece los bordes para concentrar la mirada.",
            &["vignette"],
            vec![parameter("vignette", "Intensidad", 0.0, 1.0, 0.25)],
        ),
        effect(
            "blur",
            "Desenfoque",
            "stylize",
            "Desenfoque gaussiano en píxeles.",
            &["gblur"],
            vec![parameter("blur", "Radio", 0.0, 50.0, 2.0)],
        ),
        effect(
            "sharpen",
            "Nitidez",
            "stylize",
            "Aumenta el detalle sin cambiar el color.",
            &["unsharp"],
            vec![parameter("sharpen", "Intensidad", 0.0, 5.0, 1.0)],
        ),
        effect(
            "hueRotate",
            "Giro de tono",
            "color",
            "Rota el matiz en grados.",
            &["hue"],
            vec![parameter("hueRotateDeg", "Grados", -180.0, 180.0, 0.0)],
        ),
        effect(
            "lut",
            "LUT .cube",
            "color",
            "Aplica una LUT 3D del proyecto con intensidad.",
            &["lut3d", "blend"],
            vec![parameter("lutIntensity", "Intensidad", 0.0, 1.0, 1.0)],
        ),
        effect(
            "curves",
            "Curvas",
            "color",
            "Curva RGB con preset o puntos propios.",
            &["curves"],
            Vec::new(),
        ),
        effect(
            "colorWheels",
            "Ruedas de color",
            "color",
            "Lift, gamma, gain y offset por canal.",
            &["colorbalance"],
            Vec::new(),
        ),
        effect(
            "hsl",
            "HSL selectivo",
            "color",
            "Ajusta matiz, saturación e intensidad por color.",
            &["hue"],
            Vec::new(),
        ),
        effect(
            "chromaKey",
            "Chroma key",
            "composite",
            "Quita un color de fondo con tolerancia y mezcla.",
            &["colorkey"],
            Vec::new(),
        ),
        effect(
            "mask",
            "Máscara",
            "composite",
            "Recorta con rectángulo o elipse, feather y keyframes.",
            &["geq"],
            Vec::new(),
        ),
    ]
}

fn catalog_presets() -> Vec<VisualPresetSpec> {
    vec![
        preset(
            "soft",
            "Suave",
            "Color limpio con desenfoque mínimo.",
            serde_json::json!({ "blur": 1.2, "brightness": 0.03, "contrast": 0.98, "saturation": 1.04 }),
        ),
        preset(
            "dream",
            "Onírico",
            "Suavidad y viñeta cálida.",
            serde_json::json!({ "blur": 2.4, "brightness": 0.05, "saturation": 1.1, "vignette": 0.12 }),
        ),
        preset(
            "noir",
            "Noir",
            "Blanco y negro con contraste alto.",
            serde_json::json!({ "grayscale": true, "contrast": 1.25, "vignette": 0.35, "curvePreset": "contrast-strong" }),
        ),
        preset(
            "vhs",
            "VHS",
            "Color analógico, ligero desenfoque y viñeta.",
            serde_json::json!({ "contrast": 1.08, "saturation": 0.85, "hueRotateDeg": 6, "blur": 0.5, "vignette": 0.2, "curvePreset": "vintage" }),
        ),
        preset(
            "documentary",
            "Documental",
            "Nitidez y color sobrio.",
            serde_json::json!({ "sharpen": 1.2, "contrast": 1.05, "saturation": 0.95 }),
        ),
        preset(
            "high-key",
            "Alta clave",
            "Luminoso y aireado.",
            serde_json::json!({ "brightness": 0.12, "contrast": 0.95, "saturation": 1.05, "shadows": 0.1, "fade": 0.08 }),
        ),
        preset(
            "low-key",
            "Baja clave",
            "Sombras profundas y contraste.",
            serde_json::json!({ "brightness": -0.1, "contrast": 1.15, "shadows": -0.12, "highlights": 0.08, "vignette": 0.22 }),
        ),
        preset(
            "neon",
            "Neón",
            "Saturación alta y tono desplazado.",
            serde_json::json!({ "saturation": 1.35, "hueRotateDeg": -10, "contrast": 1.1, "vignette": 0.18 }),
        ),
    ]
}

fn transition(
    id: &str,
    label: &str,
    description: &str,
    default_frames: u32,
    overlaps: bool,
) -> TransitionSpec {
    TransitionSpec {
        id: id.to_owned(),
        label: label.to_owned(),
        description: description.to_owned(),
        default_frames,
        max_frames: 120,
        overlaps_previous: overlaps,
        available: true,
    }
}

fn catalog_transitions() -> Vec<TransitionSpec> {
    vec![
        transition(
            "dissolve",
            "Disolvencia",
            "El clip entrante aparece con alfa sobre el anterior.",
            12,
            true,
        ),
        transition(
            "fade-black",
            "Fundido a negro",
            "Entra desde negro sin mezclar la imagen anterior.",
            12,
            false,
        ),
        transition(
            "fade-white",
            "Fundido a blanco",
            "Entra desde blanco sin mezclar la imagen anterior.",
            12,
            false,
        ),
        transition(
            "slide-left",
            "Deslizar desde la derecha",
            "El clip entra desde el borde derecho.",
            15,
            true,
        ),
        transition(
            "slide-right",
            "Deslizar desde la izquierda",
            "El clip entra desde el borde izquierdo.",
            15,
            true,
        ),
        transition(
            "slide-up",
            "Deslizar desde abajo",
            "El clip entra desde el borde inferior.",
            15,
            true,
        ),
        transition(
            "slide-down",
            "Deslizar desde arriba",
            "El clip entra desde el borde superior.",
            15,
            true,
        ),
    ]
}

fn required_filters() -> Vec<(&'static str, &'static str)> {
    vec![
        ("eq", "Ajustes de color"),
        ("curves", "Curvas"),
        ("colorbalance", "Balance de color"),
        ("hue", "Tono y saturación"),
        ("vignette", "Viñeta"),
        ("gblur", "Desenfoque gaussiano"),
        ("unsharp", "Nitidez"),
        ("lut3d", "LUT 3D"),
        ("colorkey", "Chroma key"),
        ("geq", "Máscaras"),
        ("blend", "Mezcla"),
    ]
}

pub(crate) fn parse_filters(output: &str) -> BTreeSet<String> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            let name = parts.next()?;
            if !flags.starts_with('.') {
                // Línea de cabecera: "Filters:" o " .. = ...".
                if !flags.contains('.') {
                    return None;
                }
            }
            if name.starts_with('.') || name == "=" || name.eq_ignore_ascii_case("name") {
                return None;
            }
            Some(name.to_owned())
        })
        .collect()
}

fn available_filters(ffmpeg: Option<&Path>) -> BTreeSet<String> {
    let Some(ffmpeg) = ffmpeg else {
        return BTreeSet::new();
    };
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-filters"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return BTreeSet::new();
    };
    parse_filters(&String::from_utf8_lossy(&output.stdout))
}

/// Catálogo de efectos, presets y transiciones con la disponibilidad medida
/// de los filtros de FFmpeg. La UI puede ocultar lo que este build no soporta.
#[tauri::command]
pub fn list_visual_catalog(state: State<'_, AppState>) -> VisualCatalog {
    let settings = state.settings_snapshot().ok();
    let ffmpeg = settings
        .as_ref()
        .and_then(|settings| resolve_tools(settings).0);
    let filters = available_filters(ffmpeg.as_deref());
    let effects = catalog_effects()
        .into_iter()
        .map(|mut effect| {
            effect.available = effect.filters.iter().all(|name| filters.contains(name));
            effect
        })
        .collect();
    let transitions = catalog_transitions()
        .into_iter()
        .map(|mut transition| {
            transition.available = ffmpeg.is_some();
            transition
        })
        .collect();
    VisualCatalog {
        ffmpeg_available: ffmpeg.is_some(),
        effects,
        presets: catalog_presets(),
        transitions,
        filters: required_filters()
            .into_iter()
            .map(|(name, label)| FilterSupport {
                name: name.to_owned(),
                label: label.to_owned(),
                available: filters.contains(name),
            })
            .collect(),
    }
}

fn finding(
    severity: &str,
    code: &str,
    message: String,
    clip_id: Option<&str>,
    clip_label: Option<&str>,
) -> VisualFinding {
    VisualFinding {
        severity: severity.to_owned(),
        code: code.to_owned(),
        message,
        clip_id: clip_id.map(str::to_owned),
        clip_label: clip_label.map(str::to_owned),
    }
}

/// Audita un proyecto ya cargado. No escribe ni repara: devuelve hallazgos
/// accionables para que el editor decida.
#[tauri::command]
pub fn audit_visuals(
    state: State<'_, AppState>,
    project: Value,
) -> Result<VisualAudit, ProjectError> {
    let session = state.require_session()?;
    let root = PathBuf::from(&session.root);
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let filters = available_filters(ffmpeg.as_deref());
    Ok(audit_project(&project, &root, &filters))
}

pub(crate) fn audit_project(
    project: &Value,
    root: &Path,
    filters: &BTreeSet<String>,
) -> VisualAudit {
    let fps = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0)
        / project["video"]["frameRate"]["den"]
            .as_f64()
            .unwrap_or(1.0)
            .max(1.0);
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut findings = Vec::new();
    let mut transitions = 0u32;
    let mut effects_clips = 0u32;
    let mut scan_clip = |clip: &Value| {
        let kind = clip["kind"].as_str().unwrap_or("");
        if !matches!(kind, "video" | "image" | "freeze") {
            return;
        }
        let clip_id = clip["id"].as_str();
        let label = clip["label"].as_str();
        let duration = clip["durationFrames"].as_f64().unwrap_or(0.0);
        let start = clip["startFrame"].as_f64().unwrap_or(0.0);
        if let Some(transition) = clip.get("transitionIn").filter(|value| value.is_object()) {
            transitions += 1;
            let kind = transition["type"].as_str().unwrap_or("");
            let allowed = [
                "dissolve",
                "fade-black",
                "fade-white",
                "slide-left",
                "slide-right",
                "slide-up",
                "slide-down",
            ];
            if !allowed.contains(&kind) {
                findings.push(finding(
                    "error",
                    "transition-unknown",
                    format!("Transición desconocida: {kind}."),
                    clip_id,
                    label,
                ));
            }
            let frames = transition["frames"].as_f64().unwrap_or(0.0);
            if frames <= 0.0 || frames > 120.0 {
                findings.push(finding(
                    "error",
                    "transition-frames",
                    "La transición debe durar entre 1 y 120 frames.".to_owned(),
                    clip_id,
                    label,
                ));
            } else if frames > duration {
                findings.push(finding(
                    "error",
                    "transition-longer-than-clip",
                    "La transición es más larga que el clip que entra.".to_owned(),
                    clip_id,
                    label,
                ));
            }
            if start <= 0.0 {
                findings.push(finding(
                    "warning",
                    "transition-no-previous",
                    "El clip empieza en 0: no hay clip anterior que mezclar.".to_owned(),
                    clip_id,
                    label,
                ));
            }
            let max_useful = (fps * 2.0).max(1.0);
            if frames > max_useful {
                findings.push(finding(
                    "warning",
                    "transition-renderer-clamp",
                    format!(
                        "El renderer limita el solape a 2 s ({max_useful:.1} frames a {fps:.1} fps)."
                    ),
                    clip_id,
                    label,
                ));
            }
        }
        if let Some(effects) = clip.get("effects").filter(|value| value.is_object()) {
            effects_clips += 1;
            for (key, (min, max)) in [
                ("brightness", (-1.0, 1.0)),
                ("contrast", (0.0, 3.0)),
                ("saturation", (0.0, 3.0)),
                ("temperature", (-1.0, 1.0)),
                ("shadows", (-1.0, 1.0)),
                ("highlights", (-1.0, 1.0)),
                ("fade", (0.0, 1.0)),
                ("vignette", (0.0, 1.0)),
                ("sharpen", (0.0, 5.0)),
                ("blur", (0.0, 50.0)),
                ("hueRotateDeg", (-180.0, 180.0)),
            ] {
                if let Some(value) = effects.get(key).and_then(Value::as_f64) {
                    if value < min || value > max {
                        findings.push(finding(
                            "error",
                            "effect-out-of-range",
                            format!("{key}={value} está fuera del rango [{min}, {max}]."),
                            clip_id,
                            label,
                        ));
                    }
                }
            }
            if effects.get("blur").and_then(Value::as_f64).unwrap_or(0.0) > 0.0
                && !filters.contains("gblur")
            {
                findings.push(finding(
                    "error",
                    "filter-missing-gblur",
                    "El proyecto usa desenfoque, pero este FFmpeg no tiene gblur.".to_owned(),
                    clip_id,
                    label,
                ));
            }
            if let Some(lut) = effects.get("lutFile").and_then(Value::as_str) {
                if !filters.contains("lut3d") {
                    findings.push(finding(
                        "error",
                        "filter-missing-lut3d",
                        "El proyecto usa una LUT, pero este FFmpeg no tiene lut3d.".to_owned(),
                        clip_id,
                        label,
                    ));
                }
                match resolve_inside_root(root, lut) {
                    Ok(path) if path.is_file() => {}
                    Ok(_) => findings.push(finding(
                        "error",
                        "lut-missing",
                        format!("La LUT no existe en el proyecto: {lut}."),
                        clip_id,
                        label,
                    )),
                    Err(error) => {
                        let outside = error.code == ProjectErrorCode::PathEscapesRoot;
                        findings.push(finding(
                            "error",
                            if outside {
                                "lut-outside-project"
                            } else {
                                "lut-missing"
                            },
                            if outside {
                                "La ruta de la LUT sale de la carpeta del proyecto.".to_owned()
                            } else {
                                format!("La LUT no existe en el proyecto: {lut}.")
                            },
                            clip_id,
                            label,
                        ));
                    }
                }
            }
        }
    };
    for clip in &clips {
        scan_clip(clip);
    }
    VisualAudit {
        clips_scanned: clips.len() as u32,
        transitions,
        effects_clips,
        findings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_parser_reads_ffmpeg_filter_list() {
        let sample = "Filters:\n  T.. = Timeline support\n  TSC acompressor      A->A       Audio compressor.\n  ..C eq              V->V       Adjust brightness/contrast.\n  ... gblur           V->V       Gaussian blur.\n  T.. overlay         VV->V      Overlay.\n";
        let filters = parse_filters(sample);
        assert!(filters.contains("eq"));
        assert!(filters.contains("gblur"));
        assert!(filters.contains("overlay"));
        assert!(!filters.contains("Filters:"));
    }

    #[test]
    fn catalog_has_unique_effects_presets_and_transitions() {
        let effects = catalog_effects();
        let presets = catalog_presets();
        let transitions = catalog_transitions();
        assert!(effects.len() >= 10);
        assert!(presets.len() >= 8);
        assert_eq!(
            transitions
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "dissolve",
                "fade-black",
                "fade-white",
                "slide-left",
                "slide-right",
                "slide-up",
                "slide-down"
            ]
        );
        for list in [effects.len(), presets.len(), transitions.len()] {
            let _ = list;
        }
        let mut ids: Vec<&str> = effects.iter().map(|item| item.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), effects.len());
        let mut preset_ids: Vec<&str> = presets.iter().map(|item| item.id.as_str()).collect();
        preset_ids.sort();
        preset_ids.dedup();
        assert_eq!(preset_ids.len(), presets.len());
    }

    #[test]
    fn catalog_presets_match_the_frontend_names() {
        let presets = catalog_presets();
        let labels: Vec<&str> = presets.iter().map(|item| item.label.as_str()).collect();
        assert_eq!(
            labels,
            vec![
                "Suave",
                "Onírico",
                "Noir",
                "VHS",
                "Documental",
                "Alta clave",
                "Baja clave",
                "Neón"
            ]
        );
    }

    #[test]
    fn audit_flags_transitions_effects_luts_and_missing_filters() {
        let dir = std::env::temp_dir().join(format!("editoria-visuals-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("media");
        let project = serde_json::json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "timeline": {
                "clips": [
                    {
                        "id": "c1",
                        "label": "Intro",
                        "kind": "image",
                        "startFrame": 0,
                        "durationFrames": 60,
                        "transitionIn": { "type": "dissolve", "frames": 90 },
                        "effects": { "blur": 2, "brightness": 2, "lutFile": "media/nope.cube" }
                    },
                    {
                        "id": "c2",
                        "label": "Toma",
                        "kind": "video",
                        "startFrame": 60,
                        "durationFrames": 30,
                        "transitionIn": { "type": "wipe", "frames": 200 }
                    },
                    {
                        "id": "c3",
                        "label": "Música",
                        "kind": "audio",
                        "startFrame": 0,
                        "durationFrames": 90,
                        "effects": { "brightness": 9 }
                    }
                ]
            }
        });
        let audit = audit_project(&project, &dir, &BTreeSet::new());
        let codes: Vec<&str> = audit
            .findings
            .iter()
            .map(|item| item.code.as_str())
            .collect();
        assert_eq!(audit.clips_scanned, 3);
        assert_eq!(audit.transitions, 2);
        assert_eq!(audit.effects_clips, 1);
        assert!(codes.contains(&"transition-longer-than-clip"));
        assert!(codes.contains(&"transition-unknown"));
        assert!(codes.contains(&"transition-frames"));
        assert!(codes.contains(&"effect-out-of-range"));
        assert!(codes.contains(&"filter-missing-gblur"));
        assert!(codes.contains(&"filter-missing-lut3d"));
        assert!(codes.contains(&"lut-missing"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn audit_accepts_a_clean_project_with_the_required_filters() {
        let dir = std::env::temp_dir().join(format!("editoria-visuals-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("media");
        std::fs::write(dir.join("media/look.cube"), b"TITLE test").expect("lut");
        let project = serde_json::json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "timeline": {
                "clips": [
                    {
                        "id": "c1",
                        "kind": "video",
                        "startFrame": 30,
                        "durationFrames": 60,
                        "transitionIn": { "type": "fade-black", "frames": 12 },
                        "effects": { "blur": 1.5, "lutFile": "media/look.cube" }
                    }
                ]
            }
        });
        let filters = BTreeSet::from(["gblur".to_owned(), "lut3d".to_owned()]);
        let audit = audit_project(&project, &dir, &filters);
        assert!(audit.findings.is_empty(), "{:?}", audit.findings);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn transition_specs_are_bounded_and_labeled() {
        for transition in catalog_transitions() {
            assert!(!transition.label.is_empty());
            assert!(transition.default_frames > 0);
            assert!(transition.default_frames <= transition.max_frames);
        }
    }
}
