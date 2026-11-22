//! Comandos IPC del gestor de modelos locales.
//!
//! El catálogo, la verificación de checksums y la descarga verificada viven en
//! `crate::application::models`; acá queda sólo la frontera Tauri: sesión,
//! eventos de progreso y los tres comandos.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Emitter, State};

use crate::application::models as app;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

// Re-exportaciones para los consumidores existentes (`crate::commands::models`).
// Las firmas conservan `&AppState`: adaptan la sesión a `config_dir`.
pub use app::{ModelFileSpec, ModelInfo, ModelLicense, ModelSpec, MODELS};

pub fn model_by_id(id: &str) -> Option<&'static ModelSpec> {
    app::model_by_id(id)
}

pub fn models_dir(state: &AppState) -> PathBuf {
    app::models_dir(&state.config_dir)
}

pub fn model_dir(state: &AppState, spec: &ModelSpec) -> PathBuf {
    app::model_dir(&state.config_dir, spec)
}

pub fn model_file(state: &AppState, spec: &ModelSpec, file: &ModelFileSpec) -> PathBuf {
    app::model_file(&state.config_dir, spec, file)
}

pub fn is_model_downloaded(state: &AppState, spec: &ModelSpec) -> bool {
    app::is_model_downloaded(&state.config_dir, spec)
}

pub fn total_bytes(spec: &ModelSpec) -> u64 {
    app::total_bytes(spec)
}

pub fn verify_model_hash(state: &AppState, spec: &ModelSpec) -> bool {
    app::verify_model_hash(&state.config_dir, spec)
}

fn model_info(state: &AppState, spec: &ModelSpec) -> ModelInfo {
    app::model_info(&state.config_dir, spec)
}

/// Candado por `model_id` (AUD-089): dos `download_model` simultáneos del
/// mismo modelo compartirían los `.partial` y la caché ZIP. El mapa sólo
/// crece con los ids del catálogo (3 entradas); el candado real es async
/// para no ocupar un hilo bloqueante mientras se espera.
fn model_download_lock(id: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .entry(id.to_owned())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

#[tauri::command]
pub fn list_models(state: State<'_, AppState>) -> Result<Vec<ModelInfo>, ProjectError> {
    let snapshot = &*state;
    Ok(MODELS
        .iter()
        .map(|spec| model_info(snapshot, spec))
        .collect())
}

/// Descarga los archivos que falten del modelo, con progreso y verificación.
///
/// Emite `model-download` con `{ id, percent }` (porcentaje sobre el total del
/// modelo, no por archivo). Si un SHA-256 no coincide, ese archivo se borra: un
/// modelo corrupto no se usa, se vuelve a bajar. Los modelos con pesos externos
/// vienen en un ZIP: se baja una vez y se extraen sus entradas.
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ModelInfo, ProjectError> {
    let spec = model_by_id(&id).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "ese modelo no existe en el catálogo",
        )
    })?;
    if is_model_downloaded(&state, spec) {
        return Ok(model_info(&state, spec));
    }
    // AUD-089: reserva por modelo hasta verificar y publicar todos los
    // archivos; la segunda llamada espera y re-verifica al entrar.
    let download_lock = model_download_lock(&id);
    let _download_guard = download_lock.lock().await;
    if is_model_downloaded(&state, spec) {
        return Ok(model_info(&state, spec));
    }

    let dir = model_dir(&state, spec);
    std::fs::create_dir_all(&dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta de modelos",
        )
    })?;
    let pending = app::pending_files(&state.config_dir, spec);
    let total_bytes: u64 = pending.iter().map(|file| file.bytes).sum::<u64>().max(1);

    let app_handle = app.clone();
    let model_id = spec.id.to_owned();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), ProjectError> {
        let mut done_bytes: u64 = 0;
        let mut archives: Vec<PathBuf> = Vec::new();
        for file in &pending {
            let target = dir.join(file.file_name);
            let (base_url, _) = app::split_archive_url(file.url);
            let archive_cap = app::archive_byte_cap(&pending, base_url);
            app::download_file_verified(
                file,
                &target,
                &dir,
                &mut archives,
                &mut done_bytes,
                total_bytes,
                archive_cap,
                &mut |percent| {
                    let _ = app_handle.emit(
                        "model-download",
                        serde_json::json!({ "id": model_id, "percent": percent }),
                    );
                },
            )?;
        }
        for archive in archives {
            let _ = std::fs::remove_file(archive);
        }
        Ok(())
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la descarga del modelo se interrumpió",
        )
    })??;

    Ok(model_info(&state, spec))
}

#[tauri::command]
pub fn delete_model(state: State<'_, AppState>, id: String) -> Result<bool, ProjectError> {
    let spec = model_by_id(&id)
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::NotFound, "ese modelo no existe"))?;
    let dir = model_dir(&state, spec);
    if !dir.is_dir() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir)
        .map(|_| true)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo borrar el modelo"))
}
