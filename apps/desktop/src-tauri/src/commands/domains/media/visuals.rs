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

use serde_json::Value;
use tauri::State;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::media::visuals_catalog::{
    catalog_effects, catalog_presets, catalog_transitions, parse_filters, required_filters,
    FilterSupport, VisualAudit, VisualCatalog, VisualFinding,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

pub(crate) fn available_filters(ffmpeg: Option<&Path>) -> BTreeSet<String> {
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

include!("visuals/catalog_command.rs");
include!("visuals/audit.rs");

#[cfg(test)]
mod tests {
    use super::*;

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
}
