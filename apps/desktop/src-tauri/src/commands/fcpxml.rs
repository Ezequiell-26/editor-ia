//! Exportación FCPXML 1.11 desde la timeline. Una sola spine; si hay clips
//! solapados se advierte porque FCPXML los trataría como conflicto de pista.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcpxmlRequest {
    pub project: Value,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcpxmlResult {
    pub path: String,
    pub bytes: u64,
    pub clips: usize,
    pub warnings: Vec<String>,
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn seconds(frames: u64, fps: f64) -> String {
    format!("{:.6}s", frames as f64 / fps.max(1.0))
}

fn build_xml(project: &Value) -> (String, usize, Vec<String>) {
    let num = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0);
    let den = project["video"]["frameRate"]["den"].as_f64().unwrap_or(1.0);
    let fps = (num / den.max(1.0)).max(1.0);
    let width = project["video"]["width"].as_u64().unwrap_or(1920);
    let height = project["video"]["height"].as_u64().unwrap_or(1080);
    let name = escape(project["name"].as_str().unwrap_or("Editor IA"));
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let mut clips: Vec<Value> = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|clip| {
            matches!(
                clip["kind"].as_str().unwrap_or(""),
                "video" | "image" | "freeze"
            )
        })
        .collect();
    clips.sort_by_key(|clip| clip["startFrame"].as_u64().unwrap_or(0));
    let mut warnings = Vec::new();
    let mut last_end = 0u64;
    let mut cursor = 0u64;
    let mut resources = String::new();
    let mut spine = String::new();
    for (index, clip) in clips.iter().enumerate() {
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        if start < last_end {
            warnings.push(format!(
                "{} se solapa; FCPXML usa una sola spine",
                clip["label"].as_str().unwrap_or("clip")
            ));
        }
        last_end = last_end.max(start + duration);
        let asset = clip["source"]["assetId"]
            .as_str()
            .and_then(|id| assets.iter().find(|asset| asset["id"].as_str() == Some(id)));
        let relative = asset
            .and_then(|asset| asset["source"]["path"].as_str())
            .unwrap_or("");
        let label = escape(clip["label"].as_str().unwrap_or("Clip"));
        let asset_id = format!("r{}", index + 2);
        let source_in = clip["source"]["inFrame"].as_u64().unwrap_or(0);
        let source_out = clip["source"]["outFrame"]
            .as_u64()
            .unwrap_or(source_in + duration);
        let kind = clip["kind"].as_str().unwrap_or("video");
        let has_video = if kind == "image" { 1 } else { 1 };
        let asset_name = escape(
            std::path::Path::new(relative)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| label.clone())
                .as_str(),
        );
        resources.push_str(&format!(
            "<asset id=\"{asset_id}\" name=\"{asset_name}\" start=\"0s\" duration=\"{}\" hasVideo=\"{has_video}\" format=\"r1\"><media-rep kind=\"original-media\" src=\"file:///{}\"/></asset>\n",
            seconds(source_out, fps),
            escape(&relative.replace('\\', "/"))
        ));
        let gap = if start > last_end.saturating_sub(duration) {
            let cursor = if spine.is_empty() {
                0
            } else {
                last_end.saturating_sub(duration)
            };
            if start > cursor {
                format!(
                    "<gap offset=\"{}\" duration=\"{}\"/>\n",
                    seconds(cursor, fps),
                    seconds(start - cursor, fps)
                )
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        spine.push_str(&gap);
        spine.push_str(&format!(
            "<clip offset=\"{}\" duration=\"{}\" name=\"{label}\" start=\"{}\"><video ref=\"{asset_id}\" offset=\"0s\" duration=\"{}\"/></clip>\n",
            seconds(start, fps),
            seconds(duration, fps),
            seconds(source_in, fps),
            seconds(duration, fps)
        ));
    }
    let total = clips
        .iter()
        .map(|clip| {
            clip["startFrame"].as_u64().unwrap_or(0) + clip["durationFrames"].as_u64().unwrap_or(0)
        })
        .max()
        .unwrap_or(0);
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE fcpxml>\n<fcpxml version=\"1.11\">\n<resources>\n<format id=\"r1\" name=\"FFVideoFormat{custom}\" frameDuration=\"{num:.6}/{den:.6}s\" width=\"{width}\" height=\"{height}\"/>\n{resources}</resources>\n<library><event name=\"{name}\"><project name=\"{name}\"><sequence format=\"r1\" duration=\"{}\" tcStart=\"0s\" tcFormat=\"NDF\"><spine>\n{spine}</spine></sequence></project></event></library>\n</fcpxml>\n",
        seconds(total, fps),
        custom = format!("{width}x{height}"),
    );
    (xml, clips.len(), warnings)
}

#[tauri::command]
pub fn export_fcpxml(request: FcpxmlRequest) -> Result<FcpxmlResult, ProjectError> {
    let dir = PathBuf::from(request.output_dir.trim());
    if dir.as_os_str().is_empty() || !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del FCPXML no existe",
        ));
    }
    let (xml, clips, warnings) = build_xml(&request.project);
    roxmltree::Document::parse_with_options(
        &xml,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            format!("el FCPXML generado no es XML válido: {error}").as_str(),
        )
    })?;
    if clips == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene clips visuales para FCPXML",
        ));
    }
    let stem: String = request.project["name"]
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
    let mut path = dir.join(format!("{stem}.fcpxml"));
    let mut index = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{index}.fcpxml"));
        index += 1;
    }
    let temp = dir.join(format!(".fcpxml-{}.tmp", Uuid::new_v4()));
    std::fs::write(&temp, xml.as_bytes()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir FCPXML: {error}").as_str(),
        )
    })?;
    std::fs::rename(&temp, &path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar FCPXML: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(FcpxmlResult {
        path: path.to_string_lossy().into_owned(),
        bytes,
        clips,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fcpxml_has_resources_spine_and_clip() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{ "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
                "durationFrames": 60, "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } }] }
        });
        let dir = std::env::temp_dir().join(format!("editoria-fcpxml-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let result = export_fcpxml(FcpxmlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("fcpxml");
        let text = std::fs::read_to_string(&result.path).expect("leer");
        assert!(text.contains("<fcpxml version=\"1.11\">"));
        assert!(text.contains("<spine>"));
        assert!(text.contains("name=\"Toma\""));
        roxmltree::Document::parse_with_options(
            &text,
            roxmltree::ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .expect("XML válido");
        assert_eq!(result.clips, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
