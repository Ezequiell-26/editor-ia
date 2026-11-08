//! Dominio de importación de timelines EDL/OTIO/FCPXML: tipos parseados,
//! parsers puros y resolución de referencias de medios.
//!
//! La orquestación (importar los assets referenciados, armar tracks y clips
//! del proyecto) vive en `application::timeline_import`; los comandos IPC en
//! `commands::media::timeline_import`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub(crate) const MAX_CLIPS: usize = 1_000;
pub(crate) const MAX_MEDIA: usize = 200;
/// Un EDL/OTIO/FCPXML real es de KB; el tope evita cargar un binario gigante
/// en memoria cuando el usuario elige el archivo equivocado.
pub(crate) const MAX_TIMELINE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedTrack {
    pub(crate) label: String,
    pub(crate) kind: TrackKind,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedClip {
    pub(crate) track_index: usize,
    pub(crate) label: String,
    pub(crate) start_seconds: f64,
    pub(crate) source_in_seconds: f64,
    pub(crate) duration_seconds: f64,
    /// Retime del clip en la timeline (OTIO `LinearTimeWarp`); 1/1 si no hay.
    pub(crate) speed_num: u32,
    pub(crate) speed_den: u32,
    pub(crate) media: Option<String>,
    pub(crate) media_hint: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct ParsedTimeline {
    pub(crate) tracks: Vec<ParsedTrack>,
    pub(crate) clips: Vec<ParsedClip>,
    pub(crate) warnings: Vec<String>,
    pub(crate) fps: Option<f64>,
}

include!("timeline_import/edl.rs");
include!("timeline_import/otio.rs");
include!("timeline_import/fcpxml.rs");
include!("timeline_import/fcpxml_parse.rs");

#[cfg(test)]
#[path = "timeline_import.tests.rs"]
mod tests;
