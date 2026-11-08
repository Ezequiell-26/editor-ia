//! Local media intelligence for the automatic director.
//!
//! Every measurement uses FFmpeg on the project copy. Nothing is uploaded and
//! the commands are read-only. The frontend turns these measurements into an
//! explainable edit plan; this module never edits the timeline itself.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::analysis::{parse_scene_times, scene_filter};
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

const MAX_RANGES: usize = 300;
const ANALYSIS_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRange {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessSummary {
    pub integrated_lufs: Option<f64>,
    pub true_peak_db: Option<f64>,
    pub lra_db: Option<f64>,
    pub noise_floor_db: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAnalysis {
    pub asset_id: String,
    pub kind: String,
    pub duration_seconds: f64,
    pub fps_num: u32,
    pub fps_den: u32,
    pub has_audio: bool,
    pub scenes: Vec<f64>,
    pub silences: Vec<AnalysisRange>,
    pub blacks: Vec<AnalysisRange>,
    pub freezes: Vec<AnalysisRange>,
    pub loudness: Option<LoudnessSummary>,
    pub luma_average: Option<f64>,
    pub saturation_average: Option<f64>,
    pub warnings: Vec<String>,
}

include!("intelligence/parsers.rs");
include!("intelligence/cache.rs");
include!("intelligence/measurements.rs");
include!("intelligence/command.rs");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_silences_and_open_tail() {
        let stderr = r#"
[silencedetect] silence_start: 1.0
[silencedetect] silence_end: 2.5 | silence_duration: 1.5
[silencedetect] silence_start: 3.0
"#;
        let ranges = parse_silences(stderr, 4.0);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].start_seconds, 1.0);
        assert_eq!(ranges[0].end_seconds, 2.5);
        assert_eq!(ranges[1].end_seconds, 4.0);
    }

    #[test]
    fn parses_black_and_freeze_ranges() {
        let black = "[blackdetect] black_start:0.5 black_end:1.5 black_duration:1.0";
        assert_eq!(parse_black_ranges(black, 3.0).len(), 1);
        let freeze = "[freezedetect] freeze_start: 2.0\n[freezedetect] freeze_end: 3.0";
        assert_eq!(parse_freeze_ranges(freeze, 4.0).len(), 1);
    }

    #[test]
    fn parses_loudness_and_noise_floor() {
        let stderr = r#"
  Integrated loudness:
    I:         -18.7 LUFS
  Loudness range:
    LRA:         0.0 LU
  True peak:
    Peak:       -4.1 dBFS
"#;
        let summary = parse_loudness(stderr).expect("loudness");
        assert_eq!(summary.integrated_lufs, Some(-18.7));
        assert_eq!(summary.true_peak_db, Some(-4.1));
        assert_eq!(
            parse_noise_floor("[astats] Noise floor dB: -52.4"),
            Some(-52.4)
        );
        assert_eq!(parse_noise_floor("[astats] Noise floor dB: -inf"), None);
    }

    #[test]
    fn parses_signalstats_averages() {
        let stdout =
            "lavfi.signalstats.YAVG=100\nlavfi.signalstats.SATAVG=30\nlavfi.signalstats.YAVG=140\n";
        let (luma, saturation) = parse_signalstats(stdout);
        assert_eq!(luma, Some(120.0));
        assert_eq!(saturation, Some(30.0));
    }

    #[test]
    fn clamps_tiny_and_invalid_ranges() {
        assert!(range(0.0, 0.01, 2.0).is_none());
        assert!(range(f64::NAN, 1.0, 2.0).is_none());
        let found = range(-1.0, 10.0, 4.0).expect("range");
        assert_eq!(found.start_seconds, 0.0);
        assert_eq!(found.end_seconds, 4.0);
    }

    #[test]
    fn live_measurements_on_generated_media() {
        if std::env::var("EDITORIA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let dir = std::env::temp_dir().join(format!("editoria-intel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let audio = dir.join("tono.wav");
        let made_audio = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=0.2*sin(2*PI*440*t):s=22050:d=0.6",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=22050:cl=mono",
                "-filter_complex",
                "[0:a][1:a]concat=n=2:v=0:a=1",
                "-t",
                "2.6",
            ])
            .arg(&audio)
            .status()
            .expect("ffmpeg audio");
        assert!(made_audio.success());
        let silence = run_pass(
            Path::new("ffmpeg"),
            &audio,
            &[
                "-vn",
                "-af",
                "silencedetect=noise=-32dB:d=0.35",
                "-f",
                "null",
                "-",
            ],
        )
        .expect("silence pass");
        let ranges = parse_silences(&silence.stderr, 2.6);
        assert!(!ranges.is_empty(), "no se detectó el silencio sintético");
        assert!(ranges
            .iter()
            .any(|range| range.end_seconds - range.start_seconds > 1.5));
        let loud = run_pass(
            Path::new("ffmpeg"),
            &audio,
            &["-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
        )
        .expect("loudness pass");
        let summary = parse_loudness(&loud.stderr).expect("loudness");
        assert!(summary.integrated_lufs.is_some());

        let video = dir.join("negro-rojo.mp4");
        let made_video = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=1",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x64:d=1",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg video");
        assert!(made_video.success());
        let detection = run_pass(
            Path::new("ffmpeg"),
            &video,
            &[
                "-an",
                "-vf",
                "blackdetect=d=0.15:pix_th=0.10,freezedetect=n=-60dB:d=0.5",
                "-f",
                "null",
                "-",
            ],
        )
        .expect("black pass");
        let blacks = parse_black_ranges(&detection.stderr, 2.0);
        assert_eq!(blacks.len(), 1, "se esperaba un tramo negro");
        let (luma, saturation) = analyze_luma(Path::new("ffmpeg"), &video, 2.0);
        assert!(luma.is_some());
        assert!(saturation.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Compara el camino viejo secuencial con el nuevo paralelo en un clip
    /// sintético de 10 s. Mide de verdad, no estima.
    #[test]
    fn live_parallel_measurement_benchmark() {
        if std::env::var("EDITORIA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        use std::time::Instant;
        let dir = std::env::temp_dir().join(format!("editoria-bench-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let video = dir.join("bench.mp4");
        let made = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=30:duration=10",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=10",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg bench");
        assert!(made.success());
        let ffmpeg = Path::new("ffmpeg");

        // Camino legacy: escenas + detectores + 3 muestras + 3 pasadas de audio.
        let started = Instant::now();
        let _ = run_pass(
            ffmpeg,
            &video,
            &["-an", "-vf", &scene_filter(0.35), "-f", "null", "-"],
        );
        let _ = run_pass(
            ffmpeg,
            &video,
            &[
                "-an",
                "-vf",
                "blackdetect=d=0.15:pix_th=0.10,freezedetect=n=-60dB:d=0.5",
                "-f",
                "null",
                "-",
            ],
        );
        let _ = analyze_luma(ffmpeg, &video, 10.0);
        let _ = run_pass(
            ffmpeg,
            &video,
            &[
                "-vn",
                "-af",
                "silencedetect=noise=-32dB:d=0.35",
                "-f",
                "null",
                "-",
            ],
        );
        let _ = run_pass(
            ffmpeg,
            &video,
            &["-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
        );
        let _ = run_pass(
            ffmpeg,
            &video,
            &["-vn", "-af", "astats=metadata=0:reset=0", "-f", "null", "-"],
        );
        let legacy = started.elapsed();

        let started = Instant::now();
        let fast = measure_media(ffmpeg, &video, "video", 10.0, 0.35, -32.0, 0.35, false);
        let fast_time = started.elapsed();

        let started = Instant::now();
        let full = measure_media(ffmpeg, &video, "video", 10.0, 0.35, -32.0, 0.35, true);
        let full_time = started.elapsed();

        eprintln!(
            "benchmark 10 s: legacy={legacy:?} · nuevo Automático={fast_time:?} · nuevo Director={full_time:?}"
        );
        assert!(fast.luma.is_none());
        assert!(full.luma.is_some());
        assert!(fast.loudness.is_some());
        assert!(full.loudness.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
