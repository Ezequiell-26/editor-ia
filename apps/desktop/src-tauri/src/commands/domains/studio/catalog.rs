//! Catálogo multimedia del proyecto abierto por IPC.
//!
//! Adaptador delgado: la sesión de proyecto da la ruta del documento y la
//! raíz; `LocalProjectCatalog` (vía `AppState`) traduce `project.assets` a
//! `CatalogEntry` y combina el índice local de enriquecimiento.

use tauri::State;

use crate::ports::projects::ProjectSession;
use crate::ports::studio::{CatalogEntry, CatalogQuery, MediaCatalog};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn catalog_search(
    state: State<'_, AppState>,
    query: CatalogQuery,
) -> Result<Vec<CatalogEntry>, ProjectError> {
    let session = state.project_session();
    let info = session.require()?;
    let catalog = state.project_catalog(&info.path, &info.root);
    catalog.search(&query)
}

#[tauri::command]
pub async fn catalog_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<CatalogEntry>, ProjectError> {
    let session = state.project_session();
    let info = session.require()?;
    let catalog = state.project_catalog(&info.path, &info.root);
    catalog.get(&id)
}
