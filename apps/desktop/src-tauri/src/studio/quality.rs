//! Quality Gate del estudio: comprobaciones puras sobre el documento del
//! proyecto.
//!
//! Un render que termina con código 0 no prueba que la producción sirva. Estas
//! reglas detectan los fallos que el schema no puede ver — o que el schema
//! garantiza pero conviene re-verificar antes de entregar — y producen
//! `QualityFinding` tipados que el orquestador puede bloquear o reportar.
//!
//! Todo lo que necesita filesystem (¿existe el archivo del asset?) vive en
//! `crate::application::quality_gate`, que agrega esos hallazgos a los de
//! aquí. La taxonomía `check` replica `QualityCheckKindSchema` del plan.

use serde::Serialize;
use serde_json::Value;

use super::plan::QualityCheckKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QualitySeverity {
    Error,
    Warning,
}

impl QualitySeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityFinding {
    pub check: QualityCheckKind,
    pub severity: QualitySeverity,
    /// Ruta JSON dentro del documento del proyecto.
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct QualityReport {
    pub findings: Vec<QualityFinding>,
}

impl QualityReport {
    /// La producción puede entregarse: ningún hallazgo de severidad error.
    pub fn passed(&self) -> bool {
        !self
            .findings
            .iter()
            .any(|finding| finding.severity == QualitySeverity::Error)
    }

    pub fn errors(&self) -> usize {
        self.findings
            .iter()
            .filter(|finding| finding.severity == QualitySeverity::Error)
            .count()
    }

    pub fn warnings(&self) -> usize {
        self.findings
            .iter()
            .filter(|finding| finding.severity == QualitySeverity::Warning)
            .count()
    }

    /// Versión serializable para IPC: veredicto + conteos + hallazgos.
    pub fn summary(&self) -> QualityReportSummary {
        QualityReportSummary {
            passed: self.passed(),
            errors: self.errors(),
            warnings: self.warnings(),
            findings: self.findings.clone(),
        }
    }
}

/// Reporte del Quality Gate tal como cruza IPC hacia la UI/orquestador.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityReportSummary {
    pub passed: bool,
    pub errors: usize,
    pub warnings: usize,
    pub findings: Vec<QualityFinding>,
}

fn finding(
    check: QualityCheckKind,
    severity: QualitySeverity,
    path: impl Into<String>,
    message: impl Into<String>,
) -> QualityFinding {
    QualityFinding {
        check,
        severity,
        path: path.into(),
        message: message.into(),
    }
}

fn u64_at(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn str_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Clips visibles: los kinds que producen imagen en el render.
fn is_visual_clip(kind: &str) -> bool {
    matches!(kind, "video" | "image" | "graphic" | "freeze" | "compound")
}

fn clip_enabled(clip: &Value) -> bool {
    clip.get("enabled").and_then(Value::as_bool) != Some(false)
}

fn collect_clips<'a>(project: &'a Value, out: &mut Vec<(String, &'a Value)>) {
    // El schema v1 guarda los clips en `timeline.clips` (array plano con
    // `trackId`); `timeline.tracks` sólo declara las pistas.
    if let Some(clips) = project
        .get("timeline")
        .and_then(|timeline| timeline.get("clips"))
        .and_then(Value::as_array)
    {
        for (clip_index, clip) in clips.iter().enumerate() {
            out.push((format!("timeline.clips[{clip_index}]"), clip));
        }
    }
    if let Some(compounds) = project.get("compounds").and_then(Value::as_array) {
        for (compound_index, compound) in compounds.iter().enumerate() {
            if let Some(clips) = compound.get("clips").and_then(Value::as_array) {
                for (clip_index, clip) in clips.iter().enumerate() {
                    out.push((
                        format!("compounds[{compound_index}].clips[{clip_index}]"),
                        clip,
                    ));
                }
            }
        }
    }
}

/// Comprobaciones puras del documento. No toca disco ni procesos.
pub fn check_project(project: &Value) -> Vec<QualityFinding> {
    let mut findings = Vec::new();
    let mut clips = Vec::new();
    collect_clips(project, &mut clips);

    let assets = project
        .get("assets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let asset_by_id = |id: &str| assets.iter().find(|asset| str_at(asset, "id") == Some(id));

    // 1. Timeline vacío: sin clips visuales habilitados no hay producción.
    let has_visual = clips.iter().any(|(_, clip)| {
        clip_enabled(clip) && str_at(clip, "kind").map(is_visual_clip).unwrap_or(false)
    });
    if !has_visual {
        findings.push(finding(
            QualityCheckKind::RenderVerify,
            QualitySeverity::Error,
            "timeline",
            "la línea de tiempo no tiene ningún clip visual habilitado",
        ));
    }

    // 2. Assets referenciados: readiness y derechos.
    let mut seen_assets = std::collections::BTreeSet::new();
    for (path, clip) in &clips {
        let source = clip.get("source").cloned().unwrap_or(Value::Null);
        if str_at(&source, "type") != Some("asset") {
            continue;
        }
        let Some(asset_id) = str_at(&source, "assetId") else {
            continue;
        };
        if !seen_assets.insert(asset_id.to_owned()) {
            continue;
        }
        let Some(asset) = asset_by_id(asset_id) else {
            // El schema ya lo valida; si aparece, el documento bypasseó la
            // validación canónica y eso es un error de entrega.
            findings.push(finding(
                QualityCheckKind::MissingResources,
                QualitySeverity::Error,
                format!("{path}.source.assetId"),
                format!("el clip referencia el asset {asset_id} que no existe en el proyecto"),
            ));
            continue;
        };
        match str_at(asset, "status") {
            Some("ready") => {}
            Some("missing") | Some("failed") => findings.push(finding(
                QualityCheckKind::MissingResources,
                QualitySeverity::Error,
                format!("{path}.source.assetId"),
                format!(
                    "el asset {asset_id} está {} y no puede entrar al render",
                    str_at(asset, "status").unwrap_or("sin estado")
                ),
            )),
            _ => findings.push(finding(
                QualityCheckKind::MissingResources,
                QualitySeverity::Warning,
                format!("{path}.source.assetId"),
                format!("el asset {asset_id} no está verificado como listo"),
            )),
        }
        let commercial_use = asset
            .get("rights")
            .and_then(|rights| rights.get("license"))
            .and_then(|license| str_at(license, "commercialUse"))
            .unwrap_or("unknown");
        if commercial_use != "allowed" {
            findings.push(finding(
                QualityCheckKind::Rights,
                QualitySeverity::Warning,
                format!("{path}.source.assetId"),
                format!(
                    "el asset {asset_id} tiene uso comercial «{commercial_use}»: revisar atribución o licencia antes de entregar"
                ),
            ));
        }
    }

    // 3. Rango fuente: outFrame no puede pasar la duración medida del asset.
    for (path, clip) in &clips {
        let source = clip.get("source").cloned().unwrap_or(Value::Null);
        if str_at(&source, "type") != Some("asset") {
            continue;
        }
        let (Some(asset_id), Some(out_frame)) =
            (str_at(&source, "assetId"), u64_at(&source, "outFrame"))
        else {
            continue;
        };
        let Some(asset) = asset_by_id(asset_id) else {
            continue;
        };
        let Some(duration) = asset
            .get("media")
            .and_then(|media| u64_at(media, "durationFrames"))
        else {
            continue;
        };
        if out_frame > duration {
            findings.push(finding(
                QualityCheckKind::ClipRange,
                QualitySeverity::Error,
                format!("{path}.source.outFrame"),
                format!(
                    "el clip pide hasta el frame {out_frame} pero {asset_id} dura {duration} frames"
                ),
            ));
        }
    }

    // 4. Subtítulos fuera de la duración total de la timeline.
    let total_frames = clips
        .iter()
        .filter(|(_, clip)| clip_enabled(clip))
        .filter_map(|(_, clip)| {
            let start = u64_at(clip, "startFrame").unwrap_or(0);
            let duration = u64_at(clip, "durationFrames").unwrap_or(0);
            Some(start.saturating_add(duration))
        })
        .max()
        .unwrap_or(0);
    if total_frames > 0 {
        if let Some(cues) = project
            .get("captions")
            .and_then(|captions| captions.get("cues"))
            .and_then(Value::as_array)
        {
            for (index, cue) in cues.iter().enumerate() {
                let end = u64_at(cue, "endFrame").unwrap_or(0);
                if end > total_frames {
                    findings.push(finding(
                        QualityCheckKind::CaptionSync,
                        QualitySeverity::Warning,
                        format!("captions.cues[{index}].endFrame"),
                        format!(
                            "el subtítulo termina en el frame {end} pero la producción dura {total_frames}"
                        ),
                    ));
                }
            }
        }
    }

    // 5. Sin perfil de render no hay entrega posible.
    let profiles = project
        .get("renderProfiles")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    if profiles == 0 {
        findings.push(finding(
            QualityCheckKind::RenderVerify,
            QualitySeverity::Warning,
            "renderProfiles",
            "el proyecto no declara ningún perfil de render",
        ));
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn clip(id: &str, kind: &str, asset_id: Option<&str>, start: u64, duration: u64) -> Value {
        let source = match asset_id {
            Some(id) => json!({ "type": "asset", "assetId": id, "inFrame": 0, "outFrame": 100 }),
            None => json!({ "type": "graphic", "motionId": "m1" }),
        };
        json!({
            "id": id,
            "trackId": "t1",
            "kind": kind,
            "startFrame": start,
            "durationFrames": duration,
            "source": source
        })
    }

    fn project_with(clips: Vec<Value>, assets: Vec<Value>) -> Value {
        json!({
            "assets": assets,
            "timeline": {
                "tracks": [{ "id": "t1", "kind": "video" }],
                "clips": clips
            },
            "captions": { "cues": [] },
            "renderProfiles": [{ "id": "p1" }]
        })
    }

    fn ready_asset(id: &str, duration: u64) -> Value {
        json!({
            "id": id,
            "kind": "video",
            "status": "ready",
            "source": { "type": "local", "path": "media/x.mp4" },
            "rights": { "license": { "id": "l", "commercialUse": "allowed" }, "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" } },
            "media": { "width": 1920, "height": 1080, "durationFrames": duration, "frameRate": { "num": 30, "den": 1 } }
        })
    }

    #[test]
    fn empty_timeline_is_an_error() {
        let findings = check_project(&project_with(vec![], vec![]));
        assert!(findings
            .iter()
            .any(|f| f.check == QualityCheckKind::RenderVerify
                && f.severity == QualitySeverity::Error));
    }

    #[test]
    fn healthy_project_passes() {
        let project = project_with(
            vec![clip("c1", "video", Some("a1"), 0, 100)],
            vec![ready_asset("a1", 500)],
        );
        let findings = check_project(&project);
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn missing_asset_file_state_is_an_error() {
        let mut asset = ready_asset("a1", 500);
        asset["status"] = json!("missing");
        let project = project_with(vec![clip("c1", "video", Some("a1"), 0, 100)], vec![asset]);
        let findings = check_project(&project);
        assert!(findings
            .iter()
            .any(|f| f.check == QualityCheckKind::MissingResources
                && f.severity == QualitySeverity::Error));
    }

    #[test]
    fn out_of_range_clip_is_an_error() {
        let mut clip = clip("c1", "video", Some("a1"), 0, 100);
        clip["source"]["outFrame"] = json!(9999);
        let project = project_with(vec![clip], vec![ready_asset("a1", 500)]);
        let findings = check_project(&project);
        assert!(findings.iter().any(
            |f| f.check == QualityCheckKind::ClipRange && f.severity == QualitySeverity::Error
        ));
    }

    #[test]
    fn caption_beyond_total_duration_warns() {
        let mut project = project_with(
            vec![clip("c1", "video", Some("a1"), 0, 100)],
            vec![ready_asset("a1", 500)],
        );
        project["captions"] =
            json!({ "cues": [{ "id": "cap1", "startFrame": 0, "endFrame": 500 }] });
        let findings = check_project(&project);
        assert!(findings
            .iter()
            .any(|f| f.check == QualityCheckKind::CaptionSync
                && f.severity == QualitySeverity::Warning));
    }

    #[test]
    fn attribution_license_warns_on_rights() {
        let mut asset = ready_asset("a1", 500);
        asset["rights"]["license"]["commercialUse"] = json!("requires-attribution");
        let project = project_with(vec![clip("c1", "video", Some("a1"), 0, 100)], vec![asset]);
        let findings = check_project(&project);
        assert!(findings.iter().any(|f| f.check == QualityCheckKind::Rights));
    }

    #[test]
    fn missing_render_profile_warns() {
        let mut project = project_with(
            vec![clip("c1", "video", Some("a1"), 0, 100)],
            vec![ready_asset("a1", 500)],
        );
        project["renderProfiles"] = json!([]);
        let findings = check_project(&project);
        assert!(findings
            .iter()
            .any(|f| f.check == QualityCheckKind::RenderVerify
                && f.severity == QualitySeverity::Warning));
    }
}
