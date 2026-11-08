//! Adaptadores del dominio Projects.
//!
//! - `LocalProjectDocuments`: el documento `.editoria.json` vía
//!   `projects::service` (dominio puro, sin Tauri).
//! - `TauriProjectEnvironment`: diálogos nativos, asset protocol y sondeo de
//!   rutas.
//! - `StateProjectSession`: la sesión de `AppState`; adoptar/cerrar cancela
//!   los renders que pertenecían al proyecto.
//! - `LocalProjectVersioning` (en `projects_history`): snapshots, listado y
//!   restauración de `.olyvia-history/`.
//! - `NativeProjectAssetFiles`: copia/limpieza de assets del proyecto.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::ports::projects::{
    ProjectAssetFiles, ProjectDocuments, ProjectEnvironment, ProjectSession, ProjectSessionInfo,
};
use crate::projects::service::{
    self, OpenedProject, ProjectError, ProjectErrorCode, SaveProjectResult,
};
use crate::state::{AppState, Session};

/// Documento de proyecto sobre `projects::service`.
pub struct LocalProjectDocuments;

impl ProjectDocuments for LocalProjectDocuments {
    fn open(&self, path: &Path) -> Result<OpenedProject, ProjectError> {
        service::open_project(path)
    }

    fn create_with_video(
        &self,
        path: &Path,
        name: &str,
        video: Option<Value>,
    ) -> Result<OpenedProject, ProjectError> {
        service::create_project_with_video(path, name, video)
    }

    fn save(&self, path: &Path, project: &Value) -> Result<SaveProjectResult, ProjectError> {
        service::save_project(path, project)
    }
}

fn io_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

/// Diálogos y scope de medios de Tauri.
pub struct TauriProjectEnvironment<'a> {
    app: &'a AppHandle,
}

impl<'a> TauriProjectEnvironment<'a> {
    pub fn new(app: &'a AppHandle) -> Self {
        Self { app }
    }
}

impl ProjectEnvironment for TauriProjectEnvironment<'_> {
    fn pick_open_path(&self) -> Option<PathBuf> {
        let picked = self
            .app
            .dialog()
            .file()
            .add_filter("Proyecto de Editor IA", &["json"])
            .blocking_pick_file()?;
        picked.into_path().ok()
    }

    fn pick_save_path(&self, default_name: &str) -> Result<Option<PathBuf>, ProjectError> {
        let Some(picked) = self
            .app
            .dialog()
            .file()
            .add_filter("Proyecto de Editor IA", &["json"])
            .set_file_name(default_name)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        picked
            .into_path()
            .map(Some)
            .map_err(|_| io_error("no se pudo usar la ruta elegida"))
    }

    fn path_exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn allow_media_root(&self, root: &Path) -> Result<(), ProjectError> {
        self.app
            .asset_protocol_scope()
            .allow_directory(root, true)
            .map_err(|_| {
                io_error("no se pudo habilitar la vista previa de los medios del proyecto")
            })
    }
}

fn to_info(session: &Session) -> ProjectSessionInfo {
    ProjectSessionInfo {
        path: session.path.clone(),
        root: session.root.clone(),
        project_id: session.project_id.clone(),
    }
}

/// Sesión nativa sobre `AppState`.
pub struct StateProjectSession<'a> {
    state: &'a AppState,
}

impl<'a> StateProjectSession<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl ProjectSession for StateProjectSession<'_> {
    fn current(&self) -> Result<Option<ProjectSessionInfo>, ProjectError> {
        Ok(self.state.session_snapshot()?.as_ref().map(to_info))
    }

    fn require(&self) -> Result<ProjectSessionInfo, ProjectError> {
        self.state.require_session().map(|s| to_info(&s))
    }

    fn adopt(&self, info: &ProjectSessionInfo) -> Result<(), ProjectError> {
        self.state.cancel_all_renders();
        self.state.set_session(Some(Session::new(
            info.path.clone(),
            info.project_id.clone(),
        )))
    }

    fn clear(&self) -> Result<(), ProjectError> {
        self.state.cancel_all_renders();
        self.state.set_session(None)
    }
}

/// Archivos de assets del proyecto (copia en "guardar como", rollback).
pub struct NativeProjectAssetFiles;

impl ProjectAssetFiles for NativeProjectAssetFiles {
    fn copy_project_assets(
        &self,
        project: &Value,
        from_root: &Path,
        to_root: &Path,
    ) -> Result<Vec<PathBuf>, ProjectError> {
        crate::media::copy_project_assets(project, from_root, to_root)
    }

    fn remove_files(&self, files: &[PathBuf]) {
        for file in files {
            let _ = std::fs::remove_file(file);
        }
    }
}
