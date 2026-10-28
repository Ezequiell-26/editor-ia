//! Exportación CMX 3600 EDL desde el esquema de Editor IA.
//! Lleva la timeline a Resolve/Premiere sin fingir efectos que el EDL no soporta.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::expand_compounds;

use super::OmittedClips;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdlRequest {
    pub project: Value,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdlResult {
    pub path: String,
    pub bytes: u64,
    pub events: usize,
    pub warnings: Vec<String>,
}

fn nominal_fps(project: &Value) -> u32 {
    let num = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0);
    let den = project["video"]["frameRate"]["den"].as_f64().unwrap_or(1.0);
    (num / den.max(1.0)).round().max(1.0) as u32
}

fn timecode(frames: u64, fps: u32) -> String {
    let fps = fps.max(1) as u64;
    let total_seconds = frames / fps;
    let f = frames % fps;
    let s = total_seconds % 60;
    let m = (total_seconds / 60) % 60;
    let h = total_seconds / 3600;
    format!("{h:02}:{m:02}:{s:02}:{f:02}")
}

fn reel(name: &str) -> String {
    let mut value: String = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_uppercase())
        .take(8)
        .collect();
    if value.is_empty() {
        value = "AX".to_owned();
    }
    value
}

fn build_edl(project: &Value) -> (String, usize, Vec<String>) {
    let fps = nominal_fps(project);
    let title = project["name"]
        .as_str()
        .unwrap_or("Editor IA")
        .replace(['\r', '\n'], " ");
    // `export_edl` ya expandió los compuestos: acá sólo se escribe la spine.
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let asset_by_id: std::collections::HashMap<String, Value> = assets
        .iter()
        .filter_map(|asset| Some((asset["id"].as_str()?.to_owned(), asset.clone())))
        .collect();
    // Una pista oculta no entra en el render, así que tampoco debe reaparecer
    // en el intercambio: OTIO ya las omite y el EDL seguiría esa regla.
    let hidden_tracks: std::collections::HashSet<String> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["hidden"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let mut clips: Vec<Value> = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|clip| {
            let kind = clip["kind"].as_str().unwrap_or("");
            let visible = clip["enabled"].as_bool() != Some(false)
                && !clip["trackId"]
                    .as_str()
                    .map(|id| hidden_tracks.contains(id))
                    .unwrap_or(false);
            visible && matches!(kind, "video" | "image" | "freeze")
        })
        .collect();
    clips.sort_by_key(|clip| clip["startFrame"].as_u64().unwrap_or(0));
    let mut lines = vec![
        format!("TITLE: {title}"),
        "FCM: NON-DROP FRAME".to_owned(),
        String::new(),
    ];
    let mut warnings = Vec::new();
    let mut events = 0usize;
    let mut last_end = 0u64;
    for clip in &clips {
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        if start < last_end {
            warnings.push(format!(
                "el clip {} se solapa con otro; el EDL es una sola pista",
                clip["label"].as_str().unwrap_or("sin nombre")
            ));
        }
        last_end = last_end.max(start + duration);
        if clip["speed"]["num"].as_u64().unwrap_or(1) != clip["speed"]["den"].as_u64().unwrap_or(1)
            || clip["reverse"].as_bool().unwrap_or(false)
        {
            warnings.push(format!(
                "{} tiene velocidad/reverse; se exporta a 100%",
                clip["label"].as_str().unwrap_or("clip")
            ));
        }
        if clip.get("transitionIn").is_some() {
            warnings.push(format!(
                "{} tiene transición; no se escribe en el EDL",
                clip["label"].as_str().unwrap_or("clip")
            ));
        }
        let asset = clip["source"]["assetId"]
            .as_str()
            .and_then(|id| asset_by_id.get(id));
        let name = asset
            .and_then(|asset| asset["source"]["path"].as_str())
            .and_then(|path| Path::new(path).file_stem())
            .map(|stem| stem.to_string_lossy().into_owned())
            .or_else(|| clip["label"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "AX".to_owned());
        let source_in = clip["source"]["inFrame"].as_u64().unwrap_or(0);
        let source_out = clip["source"]["outFrame"]
            .as_u64()
            .unwrap_or(source_in + duration);
        events += 1;
        lines.push(format!(
            "{events:03}  {:<8} V     C        {} {} {} {}",
            reel(&name),
            timecode(source_in, fps),
            timecode(source_out, fps),
            timecode(start, fps),
            timecode(start + duration, fps)
        ));
        lines.push(format!(
            "* FROM CLIP NAME: {}",
            clip["label"].as_str().unwrap_or(&name)
        ));
        if let Some(path) = asset.and_then(|asset| asset["source"]["path"].as_str()) {
            lines.push(format!("* FILENAME: {path}"));
        }
    }
    if events == 0 {
        warnings.push("no hay clips visuales para exportar".to_owned());
    }
    warnings.extend(OmittedClips::from_project(project, false).warnings("al EDL"));
    (format!("{}\n", lines.join("\n")), events, warnings)
}

#[tauri::command]
pub fn export_edl(request: EdlRequest) -> Result<EdlResult, ProjectError> {
    let dir = PathBuf::from(request.output_dir.trim());
    if dir.as_os_str().is_empty() || !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del EDL no existe",
        ));
    }
    let project = expand_compounds(&request.project)?;
    let (text, events, warnings) = build_edl(&project);
    if events == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene clips visuales para exportar como EDL",
        ));
    }
    let stem: String = request.project["name"]
        .as_str()
        .unwrap_or("timeline")
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    let stem = if stem.is_empty() {
        "timeline".to_owned()
    } else {
        stem
    };
    let mut path = dir.join(format!("{stem}.edl"));
    let mut index = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{index}.edl"));
        index += 1;
    }
    let temp = dir.join(format!(".edl-{}.tmp", Uuid::new_v4()));
    std::fs::write(&temp, text.as_bytes()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir el EDL: {error}").as_str(),
        )
    })?;
    std::fs::rename(&temp, &path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el EDL: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(EdlResult {
        path: path.to_string_lossy().into_owned(),
        bytes,
        events,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edl_contains_events_and_timecodes() {
        let project = serde_json::json!({
            "name": "Demo",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
                "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 }
            }] }
        });
        let (text, events, warnings) = build_edl(&project);
        assert_eq!(events, 1);
        assert!(warnings.is_empty());
        assert!(text.contains("TITLE: Demo"));
        assert!(text.contains("00:00:01:00 00:00:03:00"));
        assert!(text.contains("* FROM CLIP NAME: Toma"));
    }

    #[test]
    fn edl_skips_clips_on_hidden_tracks() {
        let project = serde_json::json!({
            "name": "Demo",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "hidden": true },
                    { "id": "v2", "kind": "video", "hidden": false }
                ],
                "clips": [
                    { "id": "hidden", "trackId": "v1", "kind": "video", "label": "Oculta",
                      "startFrame": 0, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                    { "id": "visible", "trackId": "v2", "kind": "video", "label": "Visible",
                      "startFrame": 30, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
                ]
            }
        });
        let (text, events, warnings) = build_edl(&project);
        assert_eq!(events, 1);
        assert!(text.contains("* FROM CLIP NAME: Visible"), "{text}");
        assert!(!text.contains("Oculta"), "{text}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn edl_skips_disabled_clips() {
        let project = serde_json::json!({
            "name": "Demo",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [
                { "id": "off", "kind": "video", "label": "Apagado", "enabled": false,
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "on", "kind": "video", "label": "Activo", "enabled": true,
                  "startFrame": 30, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
            ] }
        });
        let (text, events, warnings) = build_edl(&project);
        assert_eq!(events, 1);
        assert!(text.contains("* FROM CLIP NAME: Activo"), "{text}");
        assert!(!text.contains("Apagado"), "{text}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn edl_warns_about_graphics_adjustments_and_audio() {
        let project = serde_json::json!({
            "name": "Demo",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "captions": { "cues": [
                { "id": "cue1", "trackId": "c1", "startFrame": 0, "endFrame": 30, "text": "Hola" },
                { "id": "cue2", "trackId": "c2", "startFrame": 0, "endFrame": 30, "text": "Oculto" }
            ] },
            "timeline": { "tracks": [
                { "id": "c1", "kind": "caption", "hidden": false },
                { "id": "c2", "kind": "caption", "hidden": true }
            ], "clips": [
                { "id": "v", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "g", "kind": "graphic", "label": "Título", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "graphic" } },
                { "id": "adj", "kind": "adjustment", "label": "Look", "startFrame": 0, "durationFrames": 30 },
                { "id": "au", "kind": "audio", "label": "Música", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "off", "kind": "graphic", "label": "Apagado", "enabled": false,
                  "startFrame": 0, "durationFrames": 30, "source": { "type": "graphic" } }
            ] }
        });
        let (_, events, warnings) = build_edl(&project);
        assert_eq!(events, 1);
        assert_eq!(warnings.len(), 4, "{warnings:?}");
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("1 clip(s) gráfico(s)")),
            "{warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("1 capa(s) de ajuste")),
            "{warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("1 subtítulo(s)")),
            "{warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("1 clip(s) de audio")),
            "{warnings:?}"
        );
    }

    #[test]
    fn edl_expands_compound_clips() {
        let project = serde_json::json!({
            "name": "Demo",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": {
                "clips": [{
                    "id": "outer", "kind": "compound", "label": "Grupo",
                    "startFrame": 10, "durationFrames": 20,
                    "source": { "type": "compound", "compoundId": "c1" }
                }]
            },
            "compounds": [{
                "id": "c1", "label": "Grupo", "durationFrames": 20,
                "clips": [{
                    "id": "inner", "kind": "video", "label": "Toma",
                    "startFrame": 0, "durationFrames": 20,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 20 }
                }]
            }]
        });
        let dir = std::env::temp_dir().join(format!("editoria-edl-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let result = export_edl(EdlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("edl");
        let text = std::fs::read_to_string(&result.path).expect("leer");
        assert_eq!(result.events, 1);
        assert!(text.contains("* FROM CLIP NAME: Toma"), "{text}");
        assert!(
            !text.contains("Grupo"),
            "el compuesto no debe exportarse como un clip suelto: {text}"
        );
        // El clip interno hereda la posición del compuesto (frame 10).
        assert!(text.contains("00:00:00:10"), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
