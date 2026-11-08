//! Doblaje local de un video con voces SAPI.
//!
//! El flujo es deliberadamente local y acotado: se sintetiza cada subtítulo a
//! WAV, se ajusta su duración a la ventana del cue con `atempo`/`atrim`, se
//! coloca en una base silenciosa con `adelay` y se mezcla con `amix`. El video
//! se copia sin re-encodear; el audio original se reemplaza. No hay clonación
//! de voz ni traducción: las cues llegan ya traducidas.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::narration::{sapi_voices, synthesize_sapi_wav, VoiceInfo};
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_CUES: usize = 60;
const MAX_TOTAL_CHARS: usize = 20_000;
const MAX_CUE_CHARS: usize = 1_000;
const MAX_DURATION_SECONDS: f64 = 900.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DubCue {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeDubRequest {
    /// Ruta del video relativa a la carpeta del proyecto.
    pub path: String,
    pub output_dir: String,
    pub language: String,
    #[serde(default)]
    pub voice: Option<String>,
    pub cues: Vec<DubCue>,
    /// Fin del video doblado. Si se omite, termina en la última cue + 0,4 s.
    #[serde(default)]
    pub end_seconds: Option<f64>,
    /// Volumen 0–1 del audio original como cama (música/SFX). 0 lo reemplaza.
    #[serde(default)]
    pub bed_volume: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DubResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub language: String,
    pub voice: String,
    pub cues: u32,
    pub replaced_original_audio: bool,
    pub original_audio_volume: f64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct DubSegment {
    start: f64,
    end: f64,
    wav: PathBuf,
    duration: f64,
}

include!("dubbing/validation.rs");
include!("dubbing/filter.rs");
include!("dubbing/probe.rs");
include!("dubbing/synthesis.rs");
include!("dubbing/voice.rs");
include!("dubbing/command.rs");

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64, text: &str) -> DubCue {
        DubCue {
            start_seconds: start,
            end_seconds: end,
            text: text.to_owned(),
        }
    }

    #[test]
    fn normalizes_supported_languages_and_rejects_unknown() {
        assert_eq!(normalize_language("es-AR"), Some("es"));
        assert_eq!(normalize_language("EN-us"), Some("en"));
        assert_eq!(normalize_language("zh-CN"), Some("zh"));
        assert_eq!(normalize_language("fr"), Some("fr"));
        assert_eq!(normalize_language("xx"), None);
    }

    #[test]
    fn validates_and_sorts_cues_without_large_overlaps() {
        let cues = validate_cues(&[
            cue(2.5, 4.0, " Segundo "),
            cue(0.0, 2.0, "Primero\ncon salto"),
        ])
        .expect("cues");
        assert_eq!(cues[0].text, "Primero con salto");
        assert_eq!(cues[1].text, "Segundo");
        assert!(validate_cues(&[cue(0.0, 2.0, "A"), cue(1.0, 3.0, "B")]).is_err());
        assert!(validate_cues(&[cue(0.0, 0.0, "A")]).is_err());
        assert!(validate_cues(&[cue(0.0, 1.0, "   ")]).is_err());
        assert!(validate_cues(&[cue(0.0, 1.0, &"x".repeat(MAX_CUE_CHARS + 1))]).is_err());
    }

    #[test]
    fn end_respects_cues_source_and_request() {
        let cues = vec![cue(0.0, 4.0, "A")];
        assert!((dub_end_seconds(&cues, None, Some(10.0)) - 4.4).abs() < 0.001);
        assert_eq!(dub_end_seconds(&cues, Some(8.0), Some(10.0)), 8.0);
        assert_eq!(dub_end_seconds(&cues, Some(80.0), Some(10.0)), 10.0);
    }

    #[test]
    fn filter_uses_silence_delay_and_limits_clipping() {
        let segments = vec![
            DubSegment {
                start: 0.5,
                end: 2.5,
                wav: PathBuf::from("a.wav"),
                duration: 1.2,
            },
            DubSegment {
                start: 3.0,
                end: 4.0,
                wav: PathBuf::from("b.wav"),
                duration: 2.0,
            },
        ];
        let (filter, warnings) = build_dub_filter(&segments, 5.0, None);
        assert!(filter.contains("anullsrc"));
        assert!(filter.contains("adelay=500|500"));
        assert!(filter.contains("adelay=3000|3000"));
        assert!(filter.contains("atempo="));
        assert!(filter.contains("alimiter=limit=0.95"));
        assert!(filter.contains("amix=inputs=3"));
        assert_eq!(warnings.len(), 1);
        let (with_bed, _) = build_dub_filter(&segments, 5.0, Some(0.15));
        assert!(with_bed.contains("[0:a]"));
        assert!(with_bed.contains("[bed]"));
        assert!(with_bed.contains("amix=inputs=4"));
    }

    #[test]
    fn picks_a_voice_for_the_language_and_explains_when_missing() {
        let voices = vec![
            VoiceInfo {
                id: "Sabina".to_owned(),
                name: "Microsoft Sabina Desktop".to_owned(),
                culture: "es-MX".to_owned(),
                gender: "Female".to_owned(),
            },
            VoiceInfo {
                id: "Zira".to_owned(),
                name: "Microsoft Zira Desktop".to_owned(),
                culture: "en-US".to_owned(),
                gender: "Female".to_owned(),
            },
        ];
        assert_eq!(
            pick_voice(&voices, "es").expect("es").name,
            "Microsoft Sabina Desktop"
        );
        assert_eq!(
            pick_voice(&voices, "en").expect("en").name,
            "Microsoft Zira Desktop"
        );
        let error = pick_voice(&voices, "ja").expect_err("sin voz");
        assert!(error.message.contains("no tiene una voz instalada"));
    }

    #[test]
    #[ignore = "requiere SAPI y un video sintético; se ejecuta a mano"]
    fn dubs_a_synthetic_video_end_to_end() {
        let voice = std::env::var("DUB_VOICE").expect("DUB_VOICE");
        let ffmpeg = Path::new("ffmpeg");
        let ffprobe = Path::new("ffprobe");
        let powershell = Path::new("powershell");
        let dir = std::env::temp_dir().join(format!("editoria-dub-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("source.mp4");
        assert!(Command::new(ffmpeg)
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&input)
            .status()
            .expect("ffmpeg")
            .success());
        let result = synthesize_dub_file(
            None,
            powershell,
            ffmpeg,
            ffprobe,
            &input,
            &dir,
            "en",
            &voice,
            &[
                cue(0.3, 2.0, "Hello from the local dub."),
                cue(2.4, 4.5, "This audio was generated on this machine."),
            ],
            5.0,
            Some(0.15),
        )
        .expect("doblaje");
        assert_eq!(result.cues, 2);
        assert!(!result.replaced_original_audio);
        assert!((result.original_audio_volume - 0.15).abs() < 0.001);
        assert!(result.bytes > 0);
        assert_eq!((result.width, result.height), (320, 180));
        assert!((result.duration_seconds - 5.0).abs() < 0.6);
        assert!(std::path::Path::new(&result.path).is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
