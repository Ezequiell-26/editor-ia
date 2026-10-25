//! Exportación FCPXML 1.11 desde la timeline. Una sola spine; si hay clips
//! solapados se advierte porque FCPXML los trataría como conflicto de pista.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::expand_compounds;

use super::OmittedClips;

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

struct SpineEntry {
    start: u64,
    /// Etiqueta de apertura autocerrada; con lanes se convierte en apertura.
    tag: String,
    close: &'static str,
    lanes: Vec<String>,
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
    // Misma regla que OTIO y el render: lo que está en una pista oculta no
    // viaja al FCPXML, para no reabrir en otra app un clip que no se ve acá.
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
    let audio_tracks: std::collections::HashSet<String> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| {
                    matches!(track["kind"].as_str().unwrap_or(""), "audio" | "narration")
                })
                .filter_map(|track| track["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let visible = |clip: &Value| {
        clip["enabled"].as_bool() != Some(false)
            && !clip["trackId"]
                .as_str()
                .map(|id| hidden_tracks.contains(id))
                .unwrap_or(false)
    };
    let all_clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut clips: Vec<Value> = all_clips
        .iter()
        .filter(|clip| {
            let kind = clip["kind"].as_str().unwrap_or("");
            visible(clip) && matches!(kind, "video" | "image" | "freeze")
        })
        .cloned()
        .collect();
    clips.sort_by_key(|clip| clip["startFrame"].as_u64().unwrap_or(0));
    let mut audio_clips: Vec<Value> = all_clips
        .iter()
        .filter(|clip| {
            clip["kind"].as_str() == Some("audio")
                && visible(clip)
                && clip["trackId"]
                    .as_str()
                    .map(|id| audio_tracks.contains(id))
                    .unwrap_or(false)
        })
        .cloned()
        .collect();
    audio_clips.sort_by_key(|clip| clip["startFrame"].as_u64().unwrap_or(0));
    let mut warnings = Vec::new();
    let mut last_end = 0u64;
    let mut written = 0usize;
    let mut resources = String::new();
    let mut spine: Vec<SpineEntry> = Vec::new();
    let mut next_resource = clips.len() + 2;
    for (index, clip) in clips.iter().enumerate() {
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        let label_text = clip["label"].as_str().unwrap_or("clip");
        // Sin asset el XML quedaría con `<asset src="file:///">`, que ninguna
        // app puede abrir; se omite con aviso en vez de escribir media rota.
        let relative = clip["source"]["assetId"]
            .as_str()
            .and_then(|id| assets.iter().find(|asset| asset["id"].as_str() == Some(id)))
            .and_then(|asset| asset["source"]["path"].as_str())
            .filter(|path| !path.trim().is_empty());
        let Some(relative) = relative else {
            warnings.push(format!("{label_text}: no tiene asset; se omite del FCPXML"));
            continue;
        };
        if clip["speed"]["num"].as_u64().unwrap_or(1) != clip["speed"]["den"].as_u64().unwrap_or(1)
            || clip["reverse"].as_bool().unwrap_or(false)
        {
            warnings.push(format!(
                "{label_text} tiene velocidad/reverse; se exporta a 100%"
            ));
        }
        if clip.get("transitionIn").is_some() {
            warnings.push(format!(
                "{label_text} tiene transición; no se escribe en el FCPXML"
            ));
        }
        written += 1;
        if start < last_end {
            warnings.push(format!(
                "{} se solapa; FCPXML usa una sola spine",
                clip["label"].as_str().unwrap_or("clip")
            ));
        } else if start > last_end {
            // El gap va del final del clip anterior al inicio de éste. No se
            // puede derivar de `last_end` después de sumar el clip actual:
            // con dos clips separados eso daba cursor == start y el hueco
            // desaparecía del XML.
            spine.push(SpineEntry {
                start: last_end,
                tag: format!(
                    "<gap offset=\"{}\" duration=\"{}\"/>",
                    seconds(last_end, fps),
                    seconds(start - last_end, fps)
                ),
                close: "</gap>",
                lanes: Vec::new(),
            });
        }
        last_end = last_end.max(start + duration);
        let label = escape(label_text);
        let asset_id = format!("r{}", index + 2);
        let source_in = clip["source"]["inFrame"].as_u64().unwrap_or(0);
        let source_out = clip["source"]["outFrame"]
            .as_u64()
            .unwrap_or(source_in + duration);
        let asset_name = escape(
            std::path::Path::new(relative)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| label.clone())
                .as_str(),
        );
        resources.push_str(&format!(
            "<asset id=\"{asset_id}\" name=\"{asset_name}\" start=\"0s\" duration=\"{}\" hasVideo=\"1\" format=\"r1\"><media-rep kind=\"original-media\" src=\"file:///{}\"/></asset>\n",
            seconds(source_out, fps),
            escape(&relative.replace('\\', "/"))
        ));
        // `<asset-clip>` es el elemento que escribe Final Cut para un clip de
        // medio; `<clip><video>` también es válido pero menos interoperable.
        spine.push(SpineEntry {
            start,
            tag: format!(
                "<asset-clip ref=\"{asset_id}\" offset=\"{}\" duration=\"{}\" name=\"{label}\" start=\"{}\"/>",
                seconds(start, fps),
                seconds(duration, fps),
                seconds(source_in, fps)
            ),
            close: "</asset-clip>",
            lanes: Vec::new(),
        });
    }
    // El audio viaja como lane conectado (-1) al clip o hueco que lo contiene:
    // es el mismo formato que produce Final Cut y que el importador ya lee.
    if spine.is_empty() && !audio_clips.is_empty() {
        let span_end = audio_clips
            .iter()
            .map(|clip| {
                clip["startFrame"].as_u64().unwrap_or(0)
                    + clip["durationFrames"].as_u64().unwrap_or(0)
            })
            .max()
            .unwrap_or(0);
        spine.push(SpineEntry {
            start: 0,
            tag: format!(
                "<gap offset=\"0.000000s\" duration=\"{}\"/>",
                seconds(span_end, fps)
            ),
            close: "</gap>",
            lanes: Vec::new(),
        });
    }
    let mut audio_end = 0u64;
    for clip in &audio_clips {
        if spine.is_empty() {
            break;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        let label_text = clip["label"].as_str().unwrap_or("audio");
        let relative = clip["source"]["assetId"]
            .as_str()
            .and_then(|id| assets.iter().find(|asset| asset["id"].as_str() == Some(id)))
            .and_then(|asset| asset["source"]["path"].as_str())
            .filter(|path| !path.trim().is_empty());
        let Some(relative) = relative else {
            warnings.push(format!(
                "{label_text}: el audio no tiene asset; se omite del FCPXML"
            ));
            continue;
        };
        if clip["speed"]["num"].as_u64().unwrap_or(1) != clip["speed"]["den"].as_u64().unwrap_or(1)
            || clip["reverse"].as_bool().unwrap_or(false)
        {
            warnings.push(format!(
                "{label_text} tiene velocidad/reverse; se exporta a 100%"
            ));
        }
        let anchor = spine
            .iter()
            .rposition(|entry| entry.start <= start)
            .unwrap_or(0);
        let asset_id = format!("r{}", next_resource);
        next_resource += 1;
        let source_in = clip["source"]["inFrame"].as_u64().unwrap_or(0);
        let source_out = clip["source"]["outFrame"]
            .as_u64()
            .unwrap_or(source_in + duration);
        let asset_name = escape(
            std::path::Path::new(relative)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| label_text.to_owned())
                .as_str(),
        );
        resources.push_str(&format!(
            "<asset id=\"{asset_id}\" name=\"{asset_name}\" start=\"0s\" duration=\"{}\" hasVideo=\"0\" hasAudio=\"1\"><media-rep kind=\"original-media\" src=\"file:///{}\"/></asset>\n",
            seconds(source_out, fps),
            escape(&relative.replace('\\', "/"))
        ));
        let offset = start.saturating_sub(spine[anchor].start);
        spine[anchor].lanes.push(format!(
            "<asset-clip lane=\"-1\" ref=\"{asset_id}\" offset=\"{}\" duration=\"{}\" name=\"{}\" start=\"{}\" audioStart=\"{}\" audioEnd=\"{}\"/>",
            seconds(offset, fps),
            seconds(duration, fps),
            escape(label_text),
            seconds(source_in, fps),
            seconds(source_in, fps),
            seconds(source_in + duration, fps)
        ));
        audio_end = audio_end.max(start + duration);
        written += 1;
    }
    // La duración de la secuencia cubre la spine y el audio que la excede.
    let total = last_end.max(audio_end);
    let mut spine_xml = String::new();
    for entry in &spine {
        if entry.lanes.is_empty() {
            spine_xml.push_str(&entry.tag);
            spine_xml.push('\n');
        } else {
            spine_xml.push_str(entry.tag.trim_end_matches("/>"));
            spine_xml.push_str(">\n");
            for lane in &entry.lanes {
                spine_xml.push_str(lane);
                spine_xml.push('\n');
            }
            spine_xml.push_str(entry.close);
            spine_xml.push('\n');
        }
    }
    // `frameDuration` es el tiempo de UN cuadro, no la tasa: 30/1 se escribe
    // 1/30s. Al revés, una NLE leería 30 segundos por cuadro.
    let frame_duration = format!("{den:.0}/{num:.0}s");
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE fcpxml>\n<fcpxml version=\"1.11\">\n<resources>\n<format id=\"r1\" name=\"FFVideoFormat{custom}\" frameDuration=\"{frame_duration}\" width=\"{width}\" height=\"{height}\"/>\n{resources}</resources>\n<library><event name=\"{name}\"><project name=\"{name}\"><sequence format=\"r1\" duration=\"{}\" tcStart=\"0s\" tcFormat=\"NDF\"><spine>\n{spine_xml}</spine></sequence></project></event></library>\n</fcpxml>\n",
        seconds(total, fps),
        custom = format!("{width}x{height}"),
    );
    warnings.extend(OmittedClips::from_project(project, true).warnings("al FCPXML"));
    (xml, written, warnings)
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
    let project = expand_compounds(&request.project)?;
    let (xml, clips, warnings) = build_xml(&project);
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
        assert!(text.contains("frameDuration=\"1/30s\""), "{text}");
        assert!(text.contains("<spine>"));
        assert!(text.contains("name=\"Toma\""));
        assert!(
            text.contains("<asset-clip ref=\"r2\" offset=\"1.000000s\""),
            "la spine debería usar asset-clip como Final Cut: {text}"
        );
        assert!(!text.contains("<video ref="), "{text}");
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

    #[test]
    fn fcpxml_skips_clips_on_hidden_tracks() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
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
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 1);
        assert!(xml.contains("name=\"Visible\""), "{xml}");
        assert!(!xml.contains("Oculta"), "{xml}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn fcpxml_skips_disabled_clips() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
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
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 1);
        assert!(xml.contains("name=\"Activo\""), "{xml}");
        assert!(!xml.contains("Apagado"), "{xml}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn fcpxml_writes_a_gap_between_separated_clips() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [
                { "id": "first", "kind": "video", "label": "Primero",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "second", "kind": "video", "label": "Segundo",
                  "startFrame": 40, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 40, "outFrame": 70 } }
            ] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 2);
        assert!(
            xml.contains("<gap offset=\"1.000000s\" duration=\"0.333333s\"/>"),
            "falta el hueco entre clips separados: {xml}"
        );
        roxmltree::Document::parse_with_options(
            &xml,
            roxmltree::ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .expect("XML válido");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn fcpxml_skips_clips_without_a_resolvable_asset() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [
                { "id": "orphan", "kind": "video", "label": "Huérfano",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "missing", "inFrame": 0, "outFrame": 30 } },
                { "id": "ok", "kind": "video", "label": "Buena",
                  "startFrame": 30, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
            ] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 1);
        assert!(xml.contains("name=\"Buena\""), "{xml}");
        assert!(!xml.contains("Huérfano"), "{xml}");
        assert!(
            !xml.contains("src=\"file:///\""),
            "media rota en el XML: {xml}"
        );
        // El hueco de 0 a 30 sigue existiendo: el clip omitido no lo tapa.
        assert!(
            xml.contains("<gap offset=\"0.000000s\" duration=\"1.000000s\"/>"),
            "{xml}"
        );
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("Huérfano") && warning.contains("asset")),
            "{warnings:?}"
        );
    }

    #[test]
    fn fcpxml_warns_about_speed_reverse_and_transitions() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Rápida",
                "startFrame": 0, "durationFrames": 30,
                "speed": { "num": 2, "den": 1 }, "reverse": true,
                "transitionIn": { "type": "dissolve", "frames": 6 },
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 }
            }] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 1);
        assert_eq!(warnings.len(), 2, "{warnings:?}");
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("velocidad/reverse")),
            "{warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains("transición")),
            "{warnings:?}"
        );
        assert!(xml.contains("name=\"Rápida\""), "{xml}");
    }

    #[test]
    fn fcpxml_rejects_a_timeline_with_only_zero_duration_clips() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{ "id": "zero", "kind": "video", "label": "Cero",
                "startFrame": 0, "durationFrames": 0,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 0 } }] }
        });
        let dir = std::env::temp_dir().join(format!("editoria-fcpxml-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let error = export_fcpxml(FcpxmlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect_err("una timeline sin clips escritos no debe exportarse");
        assert_eq!(error.code.name(), "EMPTY_TIMELINE");
        assert_eq!(std::fs::read_dir(&dir).expect("dir").count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fcpxml_exports_audio_as_a_connected_lane() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "tracks": [
                { "id": "v1", "kind": "video", "hidden": false },
                { "id": "a1", "kind": "audio", "hidden": false }
            ], "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 90,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 90 } },
                { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música", "startFrame": 15, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
            ] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 2, "{warnings:?}");
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(
            xml.contains("lane=\"-1\" ref=\"r3\" offset=\"0.500000s\" duration=\"1.000000s\" name=\"Música\""),
            "el audio debería ser un lane relativo al ancla: {xml}"
        );
        assert!(xml.contains("hasAudio=\"1\""), "{xml}");
        roxmltree::Document::parse_with_options(
            &xml,
            roxmltree::ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .expect("XML válido");
    }

    #[test]
    fn fcpxml_exports_audio_clips_on_hidden_audio_tracks_out() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "tracks": [
                { "id": "v1", "kind": "video", "hidden": false },
                { "id": "a1", "kind": "audio", "hidden": true }
            ], "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 60,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } },
                { "id": "au", "trackId": "a1", "kind": "audio", "label": "Oculta", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } }
            ] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 1);
        assert!(!xml.contains("Oculta"), "{xml}");
        assert!(!xml.contains("lane=\"-1\""), "{xml}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn fcpxml_exports_an_audio_only_timeline_over_a_gap() {
        let project = serde_json::json!({
            "name": "SoloAudio", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/musica.wav" } }],
            "timeline": { "tracks": [
                { "id": "a1", "kind": "audio", "hidden": false }
            ], "clips": [
                { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música", "startFrame": 0, "durationFrames": 60,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } }
            ] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        assert_eq!(clips, 1, "{warnings:?}");
        assert!(xml.contains("lane=\"-1\""), "{xml}");
        assert!(
            xml.contains("<gap offset=\"0.000000s\" duration=\"2.000000s\""),
            "una timeline sólo de audio se ancla a un hueco: {xml}"
        );
        roxmltree::Document::parse_with_options(
            &xml,
            roxmltree::ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .expect("XML válido");
    }

    #[test]
    fn fcpxml_warns_about_graphics_and_adjustments_but_writes_audio() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "captions": { "cues": [
                { "id": "cue1", "trackId": "c1", "startFrame": 0, "endFrame": 30, "text": "Hola" },
                { "id": "cue2", "trackId": "c2", "startFrame": 0, "endFrame": 30, "text": "Oculto" }
            ] },
            "timeline": { "tracks": [
                { "id": "v1", "kind": "video", "hidden": false },
                { "id": "a1", "kind": "audio", "hidden": false },
                { "id": "c1", "kind": "caption", "hidden": false },
                { "id": "c2", "kind": "caption", "hidden": true }
            ], "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "g", "kind": "graphic", "label": "Título", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "graphic" } },
                { "id": "adj", "kind": "adjustment", "label": "Look", "startFrame": 0, "durationFrames": 30 },
                { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música", "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "off", "kind": "adjustment", "label": "Apagada", "enabled": false,
                  "startFrame": 0, "durationFrames": 30 }
            ] }
        });
        let (xml, clips, warnings) = build_xml(&project);
        // Video + audio: el audio ya no se pierde, viaja como lane conectado.
        assert_eq!(clips, 2);
        assert!(xml.contains("name=\"Toma\""), "{xml}");
        assert!(
            xml.contains("lane=\"-1\"") && xml.contains("hasAudio=\"1\""),
            "{xml}"
        );
        assert_eq!(warnings.len(), 3, "{warnings:?}");
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
    }

    #[test]
    fn fcpxml_writes_the_frame_duration_not_the_rate() {
        let project = serde_json::json!({
            "name": "NTSC", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30000, "den": 1001 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{ "id": "c", "kind": "video", "label": "Toma",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } }] }
        });
        let (xml, _, _) = build_xml(&project);
        assert!(xml.contains("frameDuration=\"1001/30000s\""), "{xml}");
        assert!(
            xml.contains("<asset-clip ref=\"r2\" offset=\"0.000000s\" duration=\"1.001000s\""),
            "30 frames a 29.97 son 1.001 s: {xml}"
        );
    }

    #[test]
    fn fcpxml_expands_compound_clips() {
        let project = serde_json::json!({
            "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
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
        let dir = std::env::temp_dir().join(format!("editoria-fcpxml-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let result = export_fcpxml(FcpxmlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("fcpxml");
        let text = std::fs::read_to_string(&result.path).expect("leer");
        assert_eq!(result.clips, 1);
        assert!(text.contains("name=\"Toma\""), "{text}");
        assert!(!text.contains("name=\"Grupo\""), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
