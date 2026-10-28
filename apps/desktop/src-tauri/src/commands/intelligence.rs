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

use crate::commands::analysis::{parse_scene_times, scene_filter};
use crate::commands::system::resolve_tools;
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

fn range(mut start: f64, mut end: f64, duration: f64) -> Option<AnalysisRange> {
    if !start.is_finite() || !end.is_finite() {
        return None;
    }
    start = start.max(0.0).min(duration);
    end = end.max(0.0).min(duration);
    if end - start < 0.02 {
        return None;
    }
    Some(AnalysisRange {
        start_seconds: start,
        end_seconds: end,
    })
}

pub(crate) fn parse_silences(stderr: &str, duration: f64) -> Vec<AnalysisRange> {
    let mut ranges = Vec::new();
    let mut open: Option<f64> = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("silence_start:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if let Ok(value) = token.parse::<f64>() {
                    open = Some(value);
                }
            }
        }
        if let Some(rest) = line.split("silence_end:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if let Ok(value) = token.parse::<f64>() {
                    let start = open.take().unwrap_or(0.0);
                    if let Some(found) = range(start, value, duration) {
                        ranges.push(found);
                    }
                }
            }
        }
    }
    if let Some(start) = open {
        if let Some(found) = range(start, duration, duration) {
            ranges.push(found);
        }
    }
    ranges.sort_by(|a, b| a.start_seconds.total_cmp(&b.start_seconds));
    ranges.truncate(MAX_RANGES);
    ranges
}

pub(crate) fn parse_black_ranges(stderr: &str, duration: f64) -> Vec<AnalysisRange> {
    let mut ranges = Vec::new();
    for line in stderr.lines() {
        if !line.contains("black_start:") {
            continue;
        }
        let mut start = None;
        let mut end = None;
        for token in line.split_whitespace() {
            if let Some(value) = token.strip_prefix("black_start:") {
                start = value.parse::<f64>().ok();
            }
            if let Some(value) = token.strip_prefix("black_end:") {
                end = value.parse::<f64>().ok();
            }
        }
        if let (Some(start), Some(end)) = (start, end) {
            if let Some(found) = range(start, end, duration) {
                ranges.push(found);
            }
        }
    }
    ranges.truncate(MAX_RANGES);
    ranges
}

pub(crate) fn parse_freeze_ranges(stderr: &str, duration: f64) -> Vec<AnalysisRange> {
    let mut ranges = Vec::new();
    let mut open: Option<f64> = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("freeze_start:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                open = token.parse::<f64>().ok();
            }
        }
        if let Some(rest) = line.split("freeze_end:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if let Ok(end) = token.parse::<f64>() {
                    let start = open.take().unwrap_or(0.0);
                    if let Some(found) = range(start, end, duration) {
                        ranges.push(found);
                    }
                }
            }
        }
    }
    ranges.truncate(MAX_RANGES);
    ranges
}

pub(crate) fn parse_loudness(stderr: &str) -> Option<LoudnessSummary> {
    let mut integrated = None;
    let mut peak = None;
    let mut lra = None;
    for line in stderr.lines() {
        if line.contains("I:") && line.contains("LUFS") && line.contains("Summary") {
            continue;
        }
        if line.contains("I:") && line.contains("LUFS") {
            for token in line.split_whitespace() {
                if let Ok(value) = token.parse::<f64>() {
                    integrated = Some(value);
                }
            }
        }
        if line.contains("LRA:") && line.contains("LU") {
            for token in line.split_whitespace() {
                if let Ok(value) = token.parse::<f64>() {
                    lra = Some(value);
                }
            }
        }
        if line.contains("Peak:") && line.contains("dBFS") {
            for token in line.split_whitespace() {
                if let Ok(value) = token.parse::<f64>() {
                    peak = Some(value);
                }
            }
        }
    }
    if integrated.is_none() && peak.is_none() && lra.is_none() {
        return None;
    }
    Some(LoudnessSummary {
        integrated_lufs: integrated,
        true_peak_db: peak,
        lra_db: lra,
        noise_floor_db: None,
    })
}

pub(crate) fn parse_noise_floor(stderr: &str) -> Option<f64> {
    let mut value = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("Noise floor dB:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if token.eq_ignore_ascii_case("-inf") {
                    return None;
                }
                if let Ok(parsed) = token.parse::<f64>() {
                    value = Some(parsed);
                }
            }
        }
    }
    value
}

pub(crate) fn parse_signalstats(stdout: &str) -> (Option<f64>, Option<f64>) {
    let mut luma_sum = 0.0;
    let mut luma_count = 0.0;
    let mut sat_sum = 0.0;
    let mut sat_count = 0.0;
    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("lavfi.signalstats.YAVG=") {
            if let Ok(parsed) = value.trim().parse::<f64>() {
                luma_sum += parsed;
                luma_count += 1.0;
            }
        }
        if let Some(value) = line.strip_prefix("lavfi.signalstats.SATAVG=") {
            if let Ok(parsed) = value.trim().parse::<f64>() {
                sat_sum += parsed;
                sat_count += 1.0;
            }
        }
    }
    (
        (luma_count > 0.0).then_some(luma_sum / luma_count),
        (sat_count > 0.0).then_some(sat_sum / sat_count),
    )
}

struct PassOutput {
    stderr: String,
    success: bool,
}

fn run_pass(ffmpeg: &Path, path: &Path, args: &[&str]) -> Result<PassOutput, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para analizar el material",
        )
    })?;
    Ok(PassOutput {
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        success: output.status.success(),
    })
}

fn disk_cache_path(cache_dir: &Path, key: &str) -> PathBuf {
    let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
    cache_dir.join("analysis").join(format!("{digest}.json"))
}

fn load_disk_cache(cache_dir: &Path, key: &str) -> Option<MediaAnalysis> {
    let path = disk_cache_path(cache_dir, key);
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_disk_cache(cache_dir: &Path, key: &str, analysis: &MediaAnalysis) {
    let path = disk_cache_path(cache_dir, key);
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(bytes) = serde_json::to_vec(analysis) else {
        return;
    };
    // Escritura atómica para que un cierre a mitad de guardado no deje JSON roto.
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        let _ = std::fs::rename(temp, path);
    }
}

fn analyze_luma(ffmpeg: &Path, path: &Path, duration: f64) -> (Option<f64>, Option<f64>) {
    let mut luma = 0.0;
    let mut luma_count = 0.0;
    let mut saturation = 0.0;
    let mut sat_count = 0.0;
    for fraction in [0.2_f64, 0.5, 0.8] {
        let seconds = (duration * fraction).max(0.0);
        let seek = format!("{seconds:.3}");
        let filter = "scale=96:-2,signalstats,metadata=print:file=-";
        let mut command = Command::new(ffmpeg);
        command
            .args(["-hide_banner", "-nostats", "-ss", &seek, "-i"])
            .arg(path)
            .args(["-frames:v", "1", "-vf", filter, "-an", "-f", "null", "-"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut command);
        let output = command.output();
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let (found_luma, found_sat) = parse_signalstats(&text);
        if let Some(value) = found_luma {
            luma += value;
            luma_count += 1.0;
        }
        if let Some(value) = found_sat {
            saturation += value;
            sat_count += 1.0;
        }
    }
    (
        (luma_count > 0.0).then_some(luma / luma_count),
        (sat_count > 0.0).then_some(saturation / sat_count),
    )
}

#[derive(Debug, Default)]
struct AnalysisMeasurements {
    scenes: Vec<f64>,
    silences: Vec<AnalysisRange>,
    blacks: Vec<AnalysisRange>,
    freezes: Vec<AnalysisRange>,
    loudness: Option<LoudnessSummary>,
    luma: Option<f64>,
    saturation: Option<f64>,
    warnings: Vec<String>,
}

/// Corre las mediciones en paralelo y con una sola pasada de audio.
/// `include_samples` desactiva luma/saturación para Automático, que no las usa.
fn measure_media(
    ffmpeg: &Path,
    path: &Path,
    kind: &str,
    duration_seconds: f64,
    threshold: f64,
    silence_db: f64,
    min_silence: f64,
    include_samples: bool,
) -> AnalysisMeasurements {
    let mut result = AnalysisMeasurements::default();
    let audio_filter = format!(
        "silencedetect=noise={silence_db:.1}dB:d={min_silence:.2},ebur128=peak=true,astats=metadata=0:reset=0"
    );
    let scene_filter_value = scene_filter(threshold);
    let detectors = "blackdetect=d=0.15:pix_th=0.10,freezedetect=n=-60dB:d=0.5";
    let (scene_pass, detector_pass, audio_pass, luma_pass) = std::thread::scope(|scope| {
        let scene = if kind == "video" {
            Some(scope.spawn(|| {
                run_pass(
                    ffmpeg,
                    path,
                    &["-an", "-vf", &scene_filter_value, "-f", "null", "-"],
                )
            }))
        } else {
            None
        };
        let detectors_pass =
            if kind == "video" {
                Some(scope.spawn(|| {
                    run_pass(ffmpeg, path, &["-an", "-vf", detectors, "-f", "null", "-"])
                }))
            } else {
                None
            };
        let audio = scope.spawn(|| {
            run_pass(
                ffmpeg,
                path,
                &["-vn", "-af", &audio_filter, "-f", "null", "-"],
            )
        });
        let luma = if kind == "video" && include_samples && duration_seconds > 0.5 {
            Some(scope.spawn(|| analyze_luma(ffmpeg, path, duration_seconds)))
        } else {
            None
        };
        (
            scene.map(|handle| handle.join()),
            detectors_pass.map(|handle| handle.join()),
            audio.join(),
            luma.map(|handle| handle.join()),
        )
    });

    if kind == "video" {
        let scene_output = scene_pass
            .and_then(|joined| joined.ok())
            .and_then(|result| result.ok());
        match scene_output {
            Some(output) if output.success => {
                result.scenes = parse_scene_times(&output.stderr);
            }
            _ => result
                .warnings
                .push("No se pudieron medir los cortes de escena.".to_string()),
        }
        let detector_output = detector_pass
            .and_then(|joined| joined.ok())
            .and_then(|result| result.ok());
        match detector_output {
            Some(output) if output.success => {
                result.blacks = parse_black_ranges(&output.stderr, duration_seconds);
                result.freezes = parse_freeze_ranges(&output.stderr, duration_seconds);
            }
            _ => result
                .warnings
                .push("No se pudieron medir negros o frames congelados.".to_string()),
        }
        if let Some(joined) = luma_pass {
            if let Ok((luma, saturation)) = joined {
                result.luma = luma;
                result.saturation = saturation;
            }
        }
    }

    let audio_output = audio_pass.ok().and_then(|joined| joined.ok());
    match audio_output {
        Some(output) if output.success => {
            result.silences = parse_silences(&output.stderr, duration_seconds);
            result.loudness = parse_loudness(&output.stderr);
            if let Some(summary) = result.loudness.as_mut() {
                summary.noise_floor_db = parse_noise_floor(&output.stderr);
            }
            if result.loudness.is_none() && kind == "audio" {
                result
                    .warnings
                    .push("No se pudo medir el loudness.".to_string());
            }
        }
        _ => {
            if kind == "audio" {
                result
                    .warnings
                    .push("No se pudieron medir los silencios ni el loudness.".to_string());
            }
        }
    }
    result
}

#[tauri::command]
pub async fn analyze_media(
    state: State<'_, AppState>,
    asset_id: String,
    scene_threshold: Option<f64>,
    silence_db: Option<f64>,
    min_silence_seconds: Option<f64>,
    include_samples: Option<bool>,
) -> Result<MediaAnalysis, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para analizar el material",
        ));
    };
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere analizar no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("");
    if kind != "video" && kind != "audio" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el Director automático analiza video o audio",
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el material no está listo para analizar",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }

    let fps_num = asset["media"]["frameRate"]["num"]
        .as_u64()
        .unwrap_or(30)
        .max(1) as u32;
    let fps_den = asset["media"]["frameRate"]["den"]
        .as_u64()
        .unwrap_or(1)
        .max(1) as u32;
    let duration_frames = asset["media"]["durationFrames"].as_u64().unwrap_or(0);
    let fps = fps_num as f64 / fps_den as f64;
    let duration_seconds = if duration_frames > 0 {
        duration_frames as f64 / fps.max(1.0)
    } else {
        0.0
    };
    let hash = asset["integrity"]["sha256"]
        .as_str()
        .unwrap_or(asset_id.as_str())
        .to_string();
    let threshold = scene_threshold.unwrap_or(0.35).clamp(0.05, 0.9);
    let silence_db = silence_db.unwrap_or(-32.0).clamp(-60.0, -10.0);
    let min_silence = min_silence_seconds.unwrap_or(0.35).clamp(0.15, 3.0);
    let include_samples = include_samples.unwrap_or(true);
    let cache_key = format!(
        "analysis-v{ANALYSIS_VERSION}:{hash}:{:.3}:{:.3}:{:.1}:{:.2}:{include_samples}",
        threshold, duration_seconds, silence_db, min_silence
    );
    if let Ok(cache) = state.analysis_cache.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            return Ok(hit.clone());
        }
    }
    if let Some(hit) = load_disk_cache(&state.cache_dir, &cache_key) {
        if let Ok(mut cache) = state.analysis_cache.lock() {
            if cache.len() > 96 {
                cache.clear();
            }
            cache.insert(cache_key.clone(), hit.clone());
        }
        return Ok(hit);
    }

    let measured = measure_media(
        &ffmpeg,
        &path,
        kind,
        duration_seconds,
        threshold,
        silence_db,
        min_silence,
        include_samples,
    );
    let AnalysisMeasurements {
        scenes,
        silences,
        blacks,
        freezes,
        loudness,
        luma,
        saturation,
        warnings,
    } = measured;

    let has_audio = kind == "audio" || loudness.is_some();
    let analysis = MediaAnalysis {
        asset_id,
        kind: kind.to_string(),
        duration_seconds,
        fps_num,
        fps_den,
        has_audio,
        scenes,
        silences,
        blacks,
        freezes,
        loudness,
        luma_average: luma,
        saturation_average: saturation,
        warnings: warnings
            .into_iter()
            .map(|warning| sanitize_log(&warning, &session.root, 240))
            .collect(),
    };
    if let Ok(mut cache) = state.analysis_cache.lock() {
        if cache.len() > 96 {
            cache.clear();
        }
        cache.insert(cache_key.clone(), analysis.clone());
    }
    save_disk_cache(&state.cache_dir, &cache_key, &analysis);
    Ok(analysis)
}

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
