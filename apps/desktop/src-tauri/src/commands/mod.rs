//! Allowlisted Tauri commands. Everything privileged lives behind these
//! functions: project persistence, media import, rendering, provider
//! credentials and local narration.

use std::process::Command;

/// Prepara un proceso externo para que **no parpadee una consola** y para que
/// ceda CPU cuando la persona está editando o usando la IA.
///
/// Los hijos pesados (FFmpeg, yt-dlp, Python, PowerShell) corren en
/// `BELOW_NORMAL_PRIORITY_CLASS`: si no hay contención usan todos los núcleos
/// igual, pero cuando la UI o un modelo local compiten por CPU, el sistema
/// atiende primero a la app. Toda invocación debe pasar por acá antes de
/// `spawn()`/`output()`/`status()`.
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    #[cfg(not(windows))]
    let _ = command;
}

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

pub mod analysis;
pub mod assistant;
pub mod audio;
pub mod audio_providers;
pub mod background;
pub mod best_frame;
pub mod capabilities;
pub mod color_lut;
pub mod convert;
pub mod denoise;
pub mod dialogue;
pub mod downloader;
pub mod downloader_bridge;
pub mod dubbing;
pub mod edl;
pub mod extension;
pub mod face;
pub mod fcpxml;
pub mod filmcraft_scopes;
pub mod intelligence;
pub mod lip_sync;
pub mod localization;
pub mod loudness;
pub mod mcp;
pub mod media;
pub mod media_tools;
pub mod memory;
pub mod models;
pub mod motion_ai;
pub mod narration;
pub mod otio;
pub mod package;
pub mod preview_frame;
pub mod projects;
pub mod providers;
pub mod publish;
pub mod render;
pub mod rules;
pub mod shorts;
pub mod subtitles;
pub mod system;
pub mod thumbnail;
pub mod timeline_import;
pub mod transcribe;
pub mod upscale;
pub mod variants;
pub mod visuals;
pub mod voice_clone;
