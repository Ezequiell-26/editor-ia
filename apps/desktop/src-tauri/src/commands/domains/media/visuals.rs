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

include!("visuals/catalog.rs");
include!("visuals/filter_support.rs");
include!("visuals/catalog_command.rs");
include!("visuals/audit.rs");

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
                "slide-down",
                "slide-3d-left",
                "slide-3d-right",
                "slide-3d-up",
                "slide-3d-down",
                "wipe-left",
                "wipe-right",
                "wipe-up",
                "wipe-down",
                "iris",
                "dip-color",
                "luma-wipe"
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
