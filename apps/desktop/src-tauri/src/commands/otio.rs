//! Exportación OpenTimelineIO (`.otio` JSON) desde la timeline de Editor IA.
//! Es un intercambio propio; no usa el modelo de FilmCraft para no fingir un
//! adaptador que todavía no existe.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtioRequest {
    pub project: Value,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtioResult {
    pub path: String,
    pub bytes: u64,
    pub tracks: usize,
    pub clips: usize,
    pub warnings: Vec<String>,
}

fn time(value: u64, rate: f64) -> Value {
    json!({ "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": value })
}

fn range(start: u64, duration: u64, rate: f64) -> Value {
    json!({
        "OTIO_SCHEMA": "TimeRange.1",
        "start_time": time(start, rate),
        "duration": time(duration, rate)
    })
}

fn url(path: &str) -> String {
    format!("file:///{}", path.replace('\\', "/"))
}

fn track_clips(project: &Value, track: &Value, rate: f64) -> (Vec<Value>, usize, Vec<String>) {
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let mut clips: Vec<Value> = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|clip| clip["trackId"].as_str() == track["id"].as_str())
        .filter(|clip| {
            !matches!(
                clip["kind"].as_str().unwrap_or(""),
                "graphic" | "adjustment"
            )
        })
        .collect();
    clips.sort_by_key(|clip| clip["startFrame"].as_u64().unwrap_or(0));
    let mut children = Vec::new();
    let mut cursor = 0u64;
    let mut count = 0usize;
    let mut warnings = Vec::new();
    for clip in clips {
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        if start > cursor {
            children.push(json!({
                "OTIO_SCHEMA": "Gap.1",
                "name": "Gap",
                "source_range": range(0, start - cursor, rate)
            }));
        }
        let asset = clip["source"]["assetId"]
            .as_str()
            .and_then(|id| assets.iter().find(|asset| asset["id"].as_str() == Some(id)));
        let relative = asset
            .and_then(|asset| asset["source"]["path"].as_str())
            .unwrap_or("");
        let name = clip["label"].as_str().unwrap_or("Clip");
        let source_in = clip["source"]["inFrame"].as_u64().unwrap_or(0);
        let mut clip_json = json!({
            "OTIO_SCHEMA": "Clip.2",
            "name": name,
            "source_range": range(source_in, duration, rate),
            "media_reference": {
                "OTIO_SCHEMA": "ExternalReference.1",
                "target_url": url(relative),
                "metadata": { "editor_ia": { "relative_path": relative } }
            },
            "metadata": { "editor_ia": { "clip_id": clip["id"] } }
        });
        if clip["speed"]["num"].as_u64().unwrap_or(1) != clip["speed"]["den"].as_u64().unwrap_or(1)
        {
            warnings.push(format!("{name}: la velocidad no se exporta a OTIO"));
            clip_json["metadata"]["editor_ia"]["speed"] = clip["speed"].clone();
        }
        children.push(clip_json);
        cursor = start + duration;
        count += 1;
    }
    (children, count, warnings)
}

#[tauri::command]
pub fn export_otio(request: OtioRequest) -> Result<OtioResult, ProjectError> {
    let dir = PathBuf::from(request.output_dir.trim());
    if dir.as_os_str().is_empty() || !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del OTIO no existe",
        ));
    }
    let project = request.project;
    let fps = {
        let num = project["video"]["frameRate"]["num"]
            .as_f64()
            .unwrap_or(30.0);
        let den = project["video"]["frameRate"]["den"].as_f64().unwrap_or(1.0);
        (num / den.max(1.0)).max(1.0)
    };
    let mut tracks = Vec::new();
    let mut track_count = 0usize;
    let mut clip_count = 0usize;
    let mut warnings = Vec::new();
    for track in project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        let kind = track["kind"].as_str().unwrap_or("video");
        if !matches!(kind, "video" | "audio" | "narration")
            || track["hidden"].as_bool().unwrap_or(false)
        {
            continue;
        }
        let (children, count, mut notes) = track_clips(&project, &track, fps);
        warnings.append(&mut notes);
        clip_count += count;
        track_count += 1;
        tracks.push(json!({
            "OTIO_SCHEMA": "Track.1",
            "name": track["name"].as_str().unwrap_or("Track"),
            "kind": if kind == "video" { "Video" } else { "Audio" },
            "children": children
        }));
    }
    let timeline = json!({
        "OTIO_SCHEMA": "Timeline.1",
        "name": project["name"].as_str().unwrap_or("Timeline"),
        "global_start_time": time(0, fps),
        "tracks": { "OTIO_SCHEMA": "Stack.1", "name": "tracks", "children": tracks },
        "metadata": { "editor_ia": { "fps": fps } }
    });
    let text = serde_json::to_string_pretty(&timeline).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo serializar OTIO: {error}").as_str(),
        )
    })?;
    let text = format!("{text}\n");
    let stem: String = project["name"]
        .as_str()
        .unwrap_or("timeline")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    let stem = if stem.is_empty() {
        "timeline".to_owned()
    } else {
        stem
    };
    let mut path = dir.join(format!("{stem}.otio"));
    let mut index = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{index}.otio"));
        index += 1;
    }
    let temp = dir.join(format!(".otio-{}.tmp", Uuid::new_v4()));
    std::fs::write(&temp, text.as_bytes()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir el OTIO: {error}").as_str(),
        )
    })?;
    std::fs::rename(&temp, &path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el OTIO: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(OtioResult {
        path: path.to_string_lossy().into_owned(),
        bytes,
        tracks: track_count,
        clips: clip_count,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otio_has_timeline_track_and_gap() {
        let project = serde_json::json!({
            "name": "Demo",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": {
                "tracks": [{ "id": "v1", "name": "V1", "kind": "video", "hidden": false }],
                "clips": [{ "id": "c", "kind": "video", "label": "Toma", "trackId": "v1",
                    "startFrame": 30, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 } }]
            }
        });
        let dir = std::env::temp_dir().join(format!("editoria-otio-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let result = export_otio(OtioRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("otio");
        let text = std::fs::read_to_string(&result.path).expect("leer");
        assert!(text.contains("Timeline.1"));
        assert!(text.contains("Gap.1"));
        assert!(text.contains("Toma"));
        assert_eq!(result.clips, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
