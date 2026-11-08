//! Exportación FCPXML 1.11 — builders puros de dominio.

use serde_json::Value;

use super::OmittedClips;

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

pub fn build_xml(project: &Value) -> (String, usize, Vec<String>) {
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

#[cfg(test)]
#[path = "fcpxml.tests.rs"]
mod tests;
