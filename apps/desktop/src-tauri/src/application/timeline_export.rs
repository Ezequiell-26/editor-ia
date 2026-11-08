//! Casos de uso de exportación de timeline (EDL/OTIO/FCPXML).
//!
//! La expansión de compounds vive en `render::ffmpeg` (dominio de render) y
//! los builders puros en `media::timeline_export`; aquí sólo se orquesta:
//! validar destino, expandir, construir, verificar y publicar vía port.

use std::path::PathBuf;

use serde_json::Value;

use crate::media::timeline_export::{self, export_stem};
use crate::ports::media::{TimelineExportFiles, TimelineExportOutcome};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::expand_compounds;

struct Built {
    text: String,
    items: usize,
    tracks: usize,
    warnings: Vec<String>,
}

fn export(
    files: &dyn TimelineExportFiles,
    project: &Value,
    output_dir: &str,
    dir_label: &str,
    extension: &str,
    label: &str,
    build: impl FnOnce(&Value) -> Result<Built, ProjectError>,
) -> Result<TimelineExportOutcome, ProjectError> {
    let dir = PathBuf::from(output_dir.trim());
    if dir.as_os_str().is_empty() || !files.is_dir(&dir) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            format!("la carpeta de destino del {dir_label} no existe").as_str(),
        ));
    }
    let project = expand_compounds(project)?;
    let built = build(&project)?;
    let (path, bytes) =
        files.publish(&dir, &export_stem(&project), extension, label, &built.text)?;
    Ok(TimelineExportOutcome {
        path: path.to_string_lossy().into_owned(),
        bytes,
        items: built.items,
        tracks: built.tracks,
        warnings: built.warnings,
    })
}

/// Exporta la timeline como CMX 3600 EDL.
pub fn export_edl(
    files: &dyn TimelineExportFiles,
    project: &Value,
    output_dir: &str,
) -> Result<TimelineExportOutcome, ProjectError> {
    export(
        files,
        project,
        output_dir,
        "EDL",
        "edl",
        "el EDL",
        |project| {
            let (text, events, warnings) = timeline_export::edl::build_edl(project);
            if events == 0 {
                return Err(ProjectError::message(
                    ProjectErrorCode::EmptyTimeline,
                    "la timeline no tiene clips visuales para exportar como EDL",
                ));
            }
            Ok(Built {
                text,
                items: events,
                tracks: 0,
                warnings,
            })
        },
    )
}

/// Exporta la timeline como OpenTimelineIO (`.otio` JSON).
pub fn export_otio(
    files: &dyn TimelineExportFiles,
    project: &Value,
    output_dir: &str,
) -> Result<TimelineExportOutcome, ProjectError> {
    export(
        files,
        project,
        output_dir,
        "OTIO",
        "otio",
        "el OTIO",
        |project| {
            let (text, tracks, clips, warnings) = timeline_export::otio::build_otio(project)?;
            Ok(Built {
                text,
                items: clips,
                tracks,
                warnings,
            })
        },
    )
}

/// Exporta la timeline como FCPXML 1.11, verificando que el XML generado
/// sea parseable antes de publicarlo.
pub fn export_fcpxml(
    files: &dyn TimelineExportFiles,
    project: &Value,
    output_dir: &str,
) -> Result<TimelineExportOutcome, ProjectError> {
    export(
        files,
        project,
        output_dir,
        "FCPXML",
        "fcpxml",
        "FCPXML",
        |project| {
            let (xml, clips, warnings) = timeline_export::fcpxml::build_xml(project);
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
            Ok(Built {
                text: xml,
                items: clips,
                tracks: 0,
                warnings,
            })
        },
    )
}
