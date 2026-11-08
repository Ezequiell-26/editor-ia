//! Conversión, compresión y lote de exportación — adaptador IPC.
//!
//! La lógica vive en `application::conversion` sobre los puertos
//! `ConversionFiles`/`ConversionRunner`/`ConversionEvents`/`ConversionHardware`
//! (y los de sesión/documentos/media compartidos); las reglas puras en
//! `media::conversion`. Acá sólo queda el contrato IPC: mismos nombres,
//! payloads y tipos serde. El worker FFmpeg está en
//! `infrastructure::conversion::state.conversion_runner()`.
//!
//! - `convert_media`: un asset a un formato de la allowlist.
//! - `compress_media` / `compress_any_file`: MP4/MKV/HEVC por calidad o tamaño.
//! - `convert_media_batch`: lote con `convert-progress` por ítem.

#[path = "convert/probe_vmaf.rs"]
mod probe_vmaf;

pub use probe_vmaf::*;

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::application::conversion;
use crate::media::conversion::{
    BatchConversionItem, CompressAnyRequest, CompressRequest, ConversionResult, EnhanceOptions,
};
use crate::ports::conversion::{ConversionDeps, ConversionEvents};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn convert_media(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
    target: String,
    output_dir: String,
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<String>,
    enhance: Option<EnhanceOptions>,
) -> Result<ConversionResult, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let files = state.conversion_files();
    let events: Arc<dyn ConversionEvents> = Arc::new(state.conversion_events());
    let runner = state.conversion_runner();
    let media_runner = state.media_runner();
    let hardware = state.conversion_hardware();
    let deps = ConversionDeps {
        session: &session,
        documents: &documents,
        tools: &tools,
        files: &files,
        events,
        runner: &runner,
        media_runner: &media_runner,
        hardware: &hardware,
    };
    conversion::convert_media(
        &deps,
        &asset_id,
        &target,
        &output_dir,
        quality,
        max_width,
        encoder.as_deref(),
        enhance,
    )
}

#[tauri::command]
pub async fn convert_media_batch(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    target: String,
    output_dir: String,
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<String>,
    enhance: Option<EnhanceOptions>,
) -> Result<Vec<BatchConversionItem>, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let files = state.conversion_files();
    let events: Arc<dyn ConversionEvents> = Arc::new(state.conversion_events());
    let runner = state.conversion_runner();
    let media_runner = state.media_runner();
    let hardware = state.conversion_hardware();
    let deps = ConversionDeps {
        session: &session,
        documents: &documents,
        tools: &tools,
        files: &files,
        events,
        runner: &runner,
        media_runner: &media_runner,
        hardware: &hardware,
    };
    conversion::convert_media_batch(
        &deps,
        &asset_ids,
        &target,
        &output_dir,
        quality,
        max_width,
        encoder.as_deref(),
        enhance,
    )
}

#[tauri::command]
pub async fn compress_media(
    _app: AppHandle,
    state: State<'_, AppState>,
    request: CompressRequest,
) -> Result<ConversionResult, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let files = state.conversion_files();
    let events: Arc<dyn ConversionEvents> = Arc::new(state.conversion_events());
    let runner = state.conversion_runner();
    let media_runner = state.media_runner();
    let hardware = state.conversion_hardware();
    let deps = ConversionDeps {
        session: &session,
        documents: &documents,
        tools: &tools,
        files: &files,
        events,
        runner: &runner,
        media_runner: &media_runner,
        hardware: &hardware,
    };
    conversion::compress_media(&deps, &request)
}

#[tauri::command]
pub async fn compress_any_file(
    _app: AppHandle,
    state: State<'_, AppState>,
    request: CompressAnyRequest,
) -> Result<ConversionResult, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let files = state.conversion_files();
    let events: Arc<dyn ConversionEvents> = Arc::new(state.conversion_events());
    let runner = state.conversion_runner();
    let media_runner = state.media_runner();
    let hardware = state.conversion_hardware();
    let deps = ConversionDeps {
        session: &session,
        documents: &documents,
        tools: &tools,
        files: &files,
        events,
        runner: &runner,
        media_runner: &media_runner,
        hardware: &hardware,
    };
    conversion::compress_any_file(&deps, &request)
}
