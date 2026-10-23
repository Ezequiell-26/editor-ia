//! Local scene analysis for automatic editing.
//!
//! FFmpeg decodes the video and `select` + `showinfo` expose the timestamps of
//! frames whose scene score crosses a threshold. The command is read-only: it
//! never writes the asset and needs no network or API key.

use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

const MAX_CUTS: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneCut {
    pub frame: u64,
    pub seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneDetection {
    pub cuts: Vec<SceneCut>,
    pub duration_frames: u64,
    pub fps_num: u32,
    pub fps_den: u32,
    pub threshold: f64,
}

pub(crate) fn parse_scene_times(stderr: &str) -> Vec<f64> {
    let mut times = Vec::new();
    for (index, _) in stderr.match_indices("pts_time:") {
        let rest = &stderr[index + "pts_time:".len()..];
        let token = rest
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(',');
        if let Ok(seconds) = token.parse::<f64>() {
            if seconds.is_finite() && seconds > 0.01 {
                times.push(seconds);
            }
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    times.dedup_by(|a, b| (*a - *b).abs() < 0.001);
    times.truncate(MAX_CUTS);
    times
}

pub(crate) fn scene_filter(threshold: f64) -> String {
    format!("select='gt(scene,{threshold:.3})',showinfo")
}

pub(crate) fn requested_threshold(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.05, 0.9)
    } else {
        0.35
    }
}

#[tauri::command]
pub async fn detect_scenes(
    state: State<'_, AppState>,
    asset_id: String,
    threshold: f64,
) -> Result<SceneDetection, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para analizar escenas",
        ));
    };
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere analizar no está en el proyecto",
            )
        })?;
    if asset["kind"].as_str() != Some("video") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la detección de escenas sólo se aplica a videos",
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el video no está listo para analizar",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del video no está en disco",
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
    let threshold = requested_threshold(threshold);
    let filter = scene_filter(threshold);

    let path_text = path.to_string_lossy().into_owned();
    let mut command = Command::new(&ffmpeg);
    command
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(&path_text)
        .args(["-vf", &filter, "-an", "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para analizar escenas",
        )
    })?;
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo analizar el video: {}",
                sanitize_log(&stderr, &session.root, 300)
            )
            .as_str(),
        ));
    }

    let fps = fps_num as f64 / fps_den as f64;
    let cuts = parse_scene_times(&stderr)
        .into_iter()
        .filter_map(|seconds| {
            let frame = (seconds * fps).round() as u64;
            if frame == 0 || (duration_frames > 0 && frame >= duration_frames) {
                None
            } else {
                Some(SceneCut { frame, seconds })
            }
        })
        .collect();
    Ok(SceneDetection {
        cuts,
        duration_frames,
        fps_num,
        fps_den,
        threshold,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StabilizationAnalysis {
    pub path: String,
    pub smoothing: u32,
    pub in_frame: u64,
    pub out_frame: u64,
}

/// Analyzes camera motion on the clip's own source window and writes a `.trf`
/// under `media/stabilizers`. The renderer only applies it when the clip still
/// has the same source window, so the transform rows line up with the frames
/// FFmpeg feeds to `vidstabtransform`.
#[tauri::command]
pub async fn analyze_stabilization(
    state: State<'_, AppState>,
    asset_id: String,
    in_frame: u64,
    out_frame: u64,
    smoothing: u32,
) -> Result<StabilizationAnalysis, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para estabilizar",
        ));
    };
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere estabilizar no está en el proyecto",
            )
        })?;
    if asset["kind"].as_str() != Some("video") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización sólo se aplica a videos",
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el video no está listo para estabilizar",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del video no está en disco",
        ));
    }
    if out_frame <= in_frame {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la ventana de estabilización no es válida",
        ));
    }
    let fps_num = opened.project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0)
        .max(1.0);
    let fps_den = opened.project["video"]["frameRate"]["den"]
        .as_f64()
        .unwrap_or(1.0)
        .max(1.0);
    let fps = fps_num / fps_den;
    let in_seconds = in_frame as f64 / fps;
    let duration = (out_frame - in_frame) as f64 / fps;
    if !duration.is_finite() || duration <= 0.0 || duration > 3_600.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la ventana de estabilización no es válida",
        ));
    }
    let smoothing = smoothing.clamp(1, 60);
    let directory = session.root.join("media").join("stabilizers");
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/stabilizers")
    })?;
    let file_name = format!("{}.trf", uuid::Uuid::new_v4());
    let transform_path = directory.join(&file_name);
    // FFmpeg filter options reject an unquoted Windows drive colon. Running
    // inside `media/stabilizers` keeps the value a bare UUID file name.
    let filter = format!("vidstabdetect=shakiness=5:accuracy=15:result={file_name}");
    let mut command = Command::new(&ffmpeg);
    command
        .current_dir(&directory)
        .args([
            "-hide_banner",
            "-nostats",
            "-ss",
            &format!("{in_seconds:.6}"),
            "-t",
            &format!("{duration:.6}"),
            "-i",
        ])
        .arg(&path)
        .args(["-vf", &filter, "-an", "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para estabilizar",
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let _ = std::fs::remove_file(&transform_path);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo analizar el movimiento: {}",
                sanitize_log(&stderr, &session.root, 300)
            )
            .as_str(),
        ));
    }
    if !transform_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no produjo el archivo de transformación",
        ));
    }
    Ok(StabilizationAnalysis {
        path: format!("media/stabilizers/{file_name}"),
        smoothing,
        in_frame,
        out_frame,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_showinfo_pts_and_deduplicates() {
        let stderr = r#"
[Parsed_showinfo_1 @ 0x1] n:   2 pts:     512 pts_time:0.512       pos: 123
[Parsed_showinfo_1 @ 0x1] n:   4 pts:    1024 pts_time:1.024       pos: 456
[Parsed_showinfo_1 @ 0x1] n:   4 pts:    1024 pts_time:1.024       pos: 456
"#;
        assert_eq!(parse_scene_times(stderr), vec![0.512, 1.024]);
    }

    #[test]
    fn ignores_zero_invalid_and_builds_a_scene_filter() {
        assert!(parse_scene_times("pts_time:0 pts_time:no").is_empty());
        assert_eq!(scene_filter(0.35), "select='gt(scene,0.350)',showinfo");
        assert_eq!(requested_threshold(2.0), 0.9);
        assert_eq!(requested_threshold(f64::NAN), 0.35);
    }
}
