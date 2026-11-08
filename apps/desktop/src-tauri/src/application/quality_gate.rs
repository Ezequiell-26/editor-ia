//! Caso de uso del Quality Gate: revisa un proyecto abierto antes de darlo
//! por entregable.
//!
//! Combina las comprobaciones puras de `crate::studio::quality` (estructura
//! del documento) con la verificación de que los archivos declarados por los
//! assets existen en disco. No renderiza ni muta nada: produce un
//! `QualityReport` que el orquestador puede usar para bloquear la entrega.

use std::path::Path;

use serde_json::Value;

use crate::ports::projects::{ProjectDocuments, ProjectSession};
use crate::projects::service::ProjectError;
use crate::studio::plan::QualityCheckKind;
use crate::studio::quality::{
    check_project, QualityFinding, QualityReport, QualityReportSummary, QualitySeverity,
};

/// Revisa `project` (documento ya validado) contra el `root` del proyecto.
///
/// Los hallazgos de filesystem se agregan a los del documento; un asset cuyo
/// `source.path` no resuelve dentro del root es `missing-resources/error`.
pub fn review_project(root: &Path, project: &Value) -> QualityReport {
    let mut findings = check_project(project);
    findings.extend(missing_file_findings(root, project));
    QualityReport { findings }
}

fn missing_file_findings(root: &Path, project: &Value) -> Vec<QualityFinding> {
    let mut findings = Vec::new();
    let Some(assets) = project.get("assets").and_then(Value::as_array) else {
        return findings;
    };
    for (index, asset) in assets.iter().enumerate() {
        let Some(relative) = asset
            .get("source")
            .and_then(|source| source.get("path"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        // Misma regla que el dominio: la ruta del asset nunca escapa del root.
        let resolved = match crate::media::resolve_inside_root(root, relative) {
            Ok(path) => path,
            Err(_) => {
                findings.push(QualityFinding {
                    check: QualityCheckKind::MissingResources,
                    severity: QualitySeverity::Error,
                    path: format!("assets[{index}].source.path"),
                    message: format!("la ruta del asset {relative} escapa del root del proyecto"),
                });
                continue;
            }
        };
        if !resolved.is_file() {
            let label = asset
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("desconocido");
            findings.push(QualityFinding {
                check: QualityCheckKind::MissingResources,
                severity: QualitySeverity::Error,
                path: format!("assets[{index}].source.path"),
                message: format!(
                    "el asset {label} declara {relative} pero el archivo no está en disco"
                ),
            });
        }
    }
    findings
}

/// Revisa el proyecto abierto en sesión y devuelve el resumen serializable.
///
/// El documento se relee desde disco (`documents.open`): el gate evalúa el
/// último estado persistido, no los cambios en memoria del editor. Quien
/// invoque el comando debe guardar antes si quiere el veredicto más fresco.
pub fn review_open_project(
    session: &dyn ProjectSession,
    documents: &dyn ProjectDocuments,
) -> Result<QualityReportSummary, ProjectError> {
    let info = session.require()?;
    let opened = documents.open(&info.path)?;
    Ok(review_project(&info.root, &opened.project).summary())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project_with_asset(path: &str) -> Value {
        json!({
            "assets": [{
                "id": "a1",
                "kind": "video",
                "status": "ready",
                "source": { "type": "local", "path": path },
                "rights": {
                    "license": { "id": "l", "commercialUse": "allowed" },
                    "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                },
                "media": { "width": 1920, "height": 1080, "durationFrames": 500, "frameRate": { "num": 30, "den": 1 } }
            }],
            "timeline": {
                "tracks": [{ "id": "t1", "kind": "video" }],
                "clips": [{
                    "id": "c1", "trackId": "t1", "kind": "video",
                    "startFrame": 0, "durationFrames": 100,
                    "source": { "type": "asset", "assetId": "a1", "inFrame": 0, "outFrame": 100 }
                }]
            },
            "captions": { "cues": [] },
            "renderProfiles": [{ "id": "p1" }]
        })
    }

    #[test]
    fn reports_missing_files_on_disk() {
        let dir = std::env::temp_dir().join(format!("qg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let report = review_project(&dir, &project_with_asset("media/no-existe.mp4"));
        assert!(!report.passed());
        assert!(report.findings.iter().any(|f| {
            f.check == QualityCheckKind::MissingResources
                && f.severity == QualitySeverity::Error
                && f.message.contains("no-existe.mp4")
        }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn passes_when_the_declared_file_exists() {
        let dir = std::env::temp_dir().join(format!("qg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).unwrap();
        std::fs::write(dir.join("media/clip.mp4"), b"x").unwrap();
        let report = review_project(&dir, &project_with_asset("media/clip.mp4"));
        assert!(report.passed(), "{:?}", report.findings);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_asset_paths_escaping_the_root() {
        let dir = std::env::temp_dir().join(format!("qg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let report = review_project(&dir, &project_with_asset("../fuera.mp4"));
        assert!(!report.passed());
        assert!(report.findings.iter().any(|f| f.message.contains("escapa")));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
