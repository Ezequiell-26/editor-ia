//! Exportación de la timeline a formatos de intercambio (EDL/OTIO/FCPXML).
//! Los builders son puros; la escritura atómica vive en infrastructure.

pub mod edl;
pub mod fcpxml;
pub mod otio;

use serde_json::Value;

/// Clips visibles que un exportador de intercambio no puede escribir.
#[derive(Default)]
pub(crate) struct OmittedClips {
    pub graphic: usize,
    pub adjustment: usize,
    pub audio: usize,
    pub captions: usize,
}

impl OmittedClips {
    /// Cuenta el material visible que el exportador no escribe. `exports_audio`
    /// distingue a OTIO, que sí incluye las pistas de audio.
    pub(crate) fn from_project(project: &serde_json::Value, exports_audio: bool) -> Self {
        let mut omitted = Self::default();
        let hidden: std::collections::HashSet<&str> = project["timeline"]["tracks"]
            .as_array()
            .map(|tracks| {
                tracks
                    .iter()
                    .filter(|track| track["hidden"].as_bool().unwrap_or(false))
                    .filter_map(|track| track["id"].as_str())
                    .collect()
            })
            .unwrap_or_default();
        let visible = |item: &serde_json::Value| {
            item["enabled"].as_bool() != Some(false)
                && !item["trackId"]
                    .as_str()
                    .map(|id| hidden.contains(id))
                    .unwrap_or(false)
        };
        for clip in project["timeline"]["clips"]
            .as_array()
            .into_iter()
            .flatten()
        {
            if !visible(clip) {
                continue;
            }
            match clip["kind"].as_str().unwrap_or("") {
                "graphic" => omitted.graphic += 1,
                "adjustment" => omitted.adjustment += 1,
                "audio" if !exports_audio => omitted.audio += 1,
                _ => {}
            }
        }
        omitted.captions = project["captions"]["cues"]
            .as_array()
            .map(|cues| cues.iter().filter(|cue| visible(cue)).count())
            .unwrap_or(0);
        omitted
    }

    pub(crate) fn warnings(&self, target: &str) -> Vec<String> {
        let mut warnings = Vec::new();
        if self.graphic > 0 {
            warnings.push(format!(
                "{} clip(s) gráfico(s) no se exportan {target}",
                self.graphic
            ));
        }
        if self.adjustment > 0 {
            warnings.push(format!(
                "{} capa(s) de ajuste no se exportan {target}",
                self.adjustment
            ));
        }
        if self.captions > 0 {
            warnings.push(format!(
                "{} subtítulo(s) no se exportan {target}",
                self.captions
            ));
        }
        if self.audio > 0 {
            warnings.push(format!(
                "{} clip(s) de audio no se exportan {target}",
                self.audio
            ));
        }
        warnings
    }
}

/// Nombre de archivo seguro derivado del nombre del proyecto.
pub fn export_stem(project: &Value) -> String {
    let stem: String = project["name"]
        .as_str()
        .unwrap_or("timeline")
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    if stem.is_empty() {
        "timeline".to_owned()
    } else {
        stem
    }
}
