//! Exportación CMX 3600 EDL — builders puros de dominio.

use std::path::Path;

use serde_json::Value;

use super::OmittedClips;

fn nominal_fps(project: &Value) -> u32 {
    let num = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0);
    let den = project["video"]["frameRate"]["den"].as_f64().unwrap_or(1.0);
    (num / den.max(1.0)).round().max(1.0) as u32
}

/// fps real del proyecto (p.ej. 30000/1001 = 29.97), sin redondear.
fn real_fps(project: &Value) -> f64 {
    let num = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0);
    let den = project["video"]["frameRate"]["den"].as_f64().unwrap_or(1.0);
    num / den.max(1.0)
}

/// Drop-frame aplica a las tasas fraccionarias de broadcast: 29.97 y 59.94
/// (mismo criterio que Kdenlive `utils/timecode.cpp`: sólo 30000/1001; acá se
/// extiende también a 60000/1001, que usa la misma regla SMPTE).
fn is_drop_frame(fps: f64) -> bool {
    const DF_RATES: [f64; 2] = [30000.0 / 1001.0, 60000.0 / 1001.0];
    DF_RATES.iter().any(|rate| (fps - rate).abs() < 0.005)
}

/// frames → timecode drop-frame `HH:MM:SS;FF`.
///
/// Port del algoritmo de Kdenlive `Timecode::getTimecodeDropFrame`
/// (`utils/timecode.cpp`, basado en David Heidelberger / Andrew Duncan): las
/// etiquetas corren al fps nominal (30/60) pero se saltan `drop` números por
/// minuto, salvo en los minutos múltiplos de 10.
fn drop_timecode(frames: u64, real_fps: f64) -> String {
    let displayed = real_fps.round().max(1.0) as i64;
    let drop = (real_fps * 0.066666).round() as i64;
    let frames_per_10_minutes = (real_fps * 600.0).round() as i64;
    let per_minute_divisor = (real_fps * 60.0).round() as i64 - drop;
    let mut adjusted = frames as i64;
    let d = adjusted / frames_per_10_minutes;
    let m = adjusted % frames_per_10_minutes;
    adjusted += drop * 9 * d;
    if m > drop {
        adjusted += drop * ((m - drop) / per_minute_divisor);
    }
    let ff = adjusted % displayed;
    let total_seconds = adjusted / displayed;
    let ss = total_seconds % 60;
    let mm = (total_seconds / 60) % 60;
    let hh = total_seconds / 3600;
    format!("{hh:02}:{mm:02}:{ss:02};{ff:02}")
}

fn timecode(frames: u64, fps: u32, real: f64) -> String {
    if is_drop_frame(real) {
        return drop_timecode(frames, real);
    }
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

pub fn build_edl(project: &Value) -> (String, usize, Vec<String>) {
    let fps = nominal_fps(project);
    let real = real_fps(project);
    let drop_frame = is_drop_frame(real);
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
        if drop_frame {
            "FCM: DROP FRAME".to_owned()
        } else {
            "FCM: NON-DROP FRAME".to_owned()
        },
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
            timecode(source_in, fps, real),
            timecode(source_out, fps, real),
            timecode(start, fps, real),
            timecode(start + duration, fps, real)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::edl::{export_edl, EdlRequest};
    use uuid::Uuid;

    #[test]
    fn drop_timecode_matches_smpte_labels() {
        let fps = 30000.0 / 1001.0;
        assert!(is_drop_frame(fps));
        assert!(!is_drop_frame(30.0));
        assert!(!is_drop_frame(24.0));
        assert!(is_drop_frame(60000.0 / 1001.0));
        // 1798 frames reales @29.97 = exactamente 1 minuto → etiqueta ;00.
        assert_eq!(drop_timecode(1798, fps), "00:01:00;00");
        // El frame anterior es el último válido del minuto 0 (los ;28 ;29 se saltan).
        assert_eq!(drop_timecode(1797, fps), "00:00:59;27");
        assert_eq!(drop_timecode(0, fps), "00:00:00;00");
        // 10 minutos no pierden frames: 17982 reales → 00:10:00;00.
        assert_eq!(drop_timecode(17982, fps), "00:10:00;00");
    }

    #[test]
    fn edl_uses_drop_frame_for_2997_projects() {
        let project = serde_json::json!({
            "name": "DF",
            "video": { "frameRate": { "num": 30000, "den": 1001 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 1798,
                "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
            }] }
        });
        let (text, _, _) = build_edl(&project);
        assert!(text.contains("FCM: DROP FRAME"));
        // El clip arranca en el frame real 1798 → etiqueta 00:01:00;00.
        assert!(text.contains("00:01:00;00"));
        assert!(text.contains("00:01:01;00"));
    }

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
