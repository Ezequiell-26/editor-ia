//! Reparación acotada del documento del proyecto tras un Quality Gate
//! fallido.
//!
//! Sólo aplica correcciones mecánicas y seguras — hoy: rangos de clip que
//! superan la duración medida del asset (se clampean, nunca se agranda
//! nada). No inventa media, no cambia licencias ni reescribe la timeline:
//! lo que no se puede arreglar sin decisión humana queda reportado como
//! hallazgo y el caller decide si reintenta.
//!
//! La reparación es idempotente: aplicarla dos veces sobre el mismo
//! documento produce el mismo resultado.

use serde_json::Value;

use crate::studio::quality::QualityFinding;

/// Máximo de ciclos review→repair→render→review por corrida. Cada ciclo
/// re-renderiza, así que el límite evita gasto infinito de CPU.
pub const MAX_REPAIR_ATTEMPTS: u32 = 2;

#[derive(Debug, Default)]
pub struct RepairReport {
    /// Descripciones legibles de cada corrección aplicada (auditoría).
    pub applied: Vec<String>,
}

fn u64_at(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn str_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Recorre `clips` (array de la timeline o de un compound) y clampea los
/// `source.outFrame`/`durationFrames` que superan la duración del asset.
/// Devuelve las descripciones de lo corregido.
fn repair_clip_array(clips: &mut [Value], assets: &[Value], applied: &mut Vec<String>) {
    for clip in clips.iter_mut() {
        let source = clip.get("source").cloned().unwrap_or(Value::Null);
        if str_at(&source, "type") != Some("asset") {
            continue;
        }
        let (Some(asset_id), Some(in_frame), Some(out_frame)) = (
            str_at(&source, "assetId"),
            u64_at(&source, "inFrame"),
            u64_at(&source, "outFrame"),
        ) else {
            continue;
        };
        let Some(asset) = assets.iter().find(|a| str_at(a, "id") == Some(asset_id)) else {
            continue;
        };
        let Some(duration) = asset
            .get("media")
            .and_then(|media| u64_at(media, "durationFrames"))
        else {
            continue;
        };
        if duration == 0 || out_frame <= duration {
            continue;
        }
        // Clamp: outFrame nunca supera la duración medida; inFrame queda por
        // debajo de outFrame; la duración del clip iguala el rango fuente.
        let new_out = duration;
        let new_in = in_frame.min(new_out.saturating_sub(1));
        let new_len = new_out - new_in;
        let clip_id = str_at(clip, "id").unwrap_or("?").to_owned();
        if let Some(source) = clip.get_mut("source") {
            source["outFrame"] = Value::from(new_out);
            source["inFrame"] = Value::from(new_in);
        }
        if let Some(len) = clip.get_mut("durationFrames") {
            *len = Value::from(new_len);
        }
        applied.push(format!(
            "clip {clip_id}: rango fuente {in_frame}..{out_frame} → {new_in}..{new_out} \
             (asset {asset_id} dura {duration} frames)"
        ));
    }
}

/// Aplica las reparaciones mecánicas posibles sobre `project` (documento
/// JSON del `.editoria.json`). Devuelve las correcciones aplicadas; lista
/// vacía ⇒ nada reparable y el caller no debe reintentar.
pub fn repair_document(project: &mut Value, _findings: &[QualityFinding]) -> RepairReport {
    let mut report = RepairReport::default();
    let assets = project
        .get("assets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Some(clips) = project
        .get_mut("timeline")
        .and_then(|t| t.get_mut("clips"))
        .and_then(Value::as_array_mut)
    {
        repair_clip_array(clips, &assets, &mut report.applied);
    }
    if let Some(compounds) = project.get_mut("compounds").and_then(Value::as_array_mut) {
        for compound in compounds.iter_mut() {
            if let Some(clips) = compound.get_mut("clips").and_then(Value::as_array_mut) {
                repair_clip_array(clips, &assets, &mut report.applied);
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn asset(id: &str, duration: u64) -> Value {
        json!({
            "id": id, "kind": "video", "status": "ready",
            "source": { "type": "local", "path": "media/x.mp4" },
            "rights": { "license": { "id": "l", "commercialUse": "allowed" },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" } },
            "media": { "width": 1920, "height": 1080, "durationFrames": duration,
                       "frameRate": { "num": 30, "den": 1 } }
        })
    }

    fn project_with_clip(out_frame: u64, clip_len: u64) -> Value {
        json!({
            "assets": [asset("a1", 500)],
            "timeline": {
                "tracks": [{ "id": "t1", "kind": "video" }],
                "clips": [{
                    "id": "c1", "trackId": "t1", "kind": "video",
                    "startFrame": 0, "durationFrames": clip_len,
                    "source": { "type": "asset", "assetId": "a1", "inFrame": 0, "outFrame": out_frame }
                }]
            },
            "captions": { "cues": [] },
            "renderProfiles": [{ "id": "p1" }]
        })
    }

    #[test]
    fn clamps_out_of_range_clip() {
        let mut project = project_with_clip(9999, 9999);
        let report = repair_document(&mut project, &[]);
        assert_eq!(report.applied.len(), 1);
        let clip = &project["timeline"]["clips"][0];
        assert_eq!(clip["source"]["outFrame"], json!(500));
        assert_eq!(clip["durationFrames"], json!(500));
    }

    #[test]
    fn leaves_in_range_clip_untouched() {
        let mut project = project_with_clip(300, 300);
        let report = repair_document(&mut project, &[]);
        assert!(report.applied.is_empty());
        assert_eq!(
            project["timeline"]["clips"][0]["source"]["outFrame"],
            json!(300)
        );
    }

    #[test]
    fn keeps_in_frame_below_out_frame() {
        // inFrame=450, outFrame=9999, asset dura 500 → new_out=500, new_in=450? no:
        // in.min(out-1)=450 <500 ok, len=50.
        let mut project = project_with_clip(9999, 9999);
        project["timeline"]["clips"][0]["source"]["inFrame"] = json!(450);
        let report = repair_document(&mut project, &[]);
        assert_eq!(report.applied.len(), 1);
        let clip = &project["timeline"]["clips"][0];
        assert_eq!(clip["source"]["outFrame"], json!(500));
        assert_eq!(clip["source"]["inFrame"], json!(450));
        assert_eq!(clip["durationFrames"], json!(50));
    }

    #[test]
    fn repairs_compound_clips_too() {
        let mut project = json!({
            "assets": [asset("a1", 100)],
            "timeline": { "tracks": [], "clips": [] },
            "compounds": [{
                "id": "cp1",
                "clips": [{
                    "id": "cc1", "trackId": "t1", "kind": "video",
                    "startFrame": 0, "durationFrames": 900,
                    "source": { "type": "asset", "assetId": "a1", "inFrame": 0, "outFrame": 900 }
                }]
            }],
            "captions": { "cues": [] },
            "renderProfiles": [{ "id": "p1" }]
        });
        let report = repair_document(&mut project, &[]);
        assert_eq!(report.applied.len(), 1);
        assert_eq!(
            project["compounds"][0]["clips"][0]["source"]["outFrame"],
            json!(100)
        );
    }
}
