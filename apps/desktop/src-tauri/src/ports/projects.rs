//! Puertos del dominio Projects.
//!
//! Cada trait agrupa una necesidad real del ciclo de vida del proyecto:
//! documentos (abrir/crear/guardar), entorno nativo (diálogos, scope de
//! assets, sondeo de rutas), sesión (qué proyecto está abierto y qué jobs le
//! pertenecen), versionado (snapshots previos al guardado) y archivos de
//! assets (copiar al guardar como / limpiar en rollback).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::projects::service::{OpenedProject, ProjectError, SaveProjectResult};

/// Foto de la sesión nativa en términos del dominio: nada de `AppState` ni de
/// tipos de Tauri atraviesa esta frontera.
#[derive(Debug, Clone)]
pub struct ProjectSessionInfo {
    pub path: PathBuf,
    pub root: PathBuf,
    pub project_id: String,
}

/// Persistencia del documento `.editoria.json`.
pub trait ProjectDocuments {
    fn open(&self, path: &Path) -> Result<OpenedProject, ProjectError>;
    fn create_with_video(
        &self,
        path: &Path,
        name: &str,
        video: Option<Value>,
    ) -> Result<OpenedProject, ProjectError>;
    fn save(&self, path: &Path, project: &Value) -> Result<SaveProjectResult, ProjectError>;
}

/// Servicios del entorno nativo que la UI provee: diálogos de archivo, scope
/// del asset protocol y existencia de rutas.
pub trait ProjectEnvironment {
    /// Diálogo "abrir proyecto"; `None` si la persona cancela.
    fn pick_open_path(&self) -> Option<PathBuf>;
    /// Diálogo "guardar como" con nombre sugerido; `None` si cancela.
    fn pick_save_path(&self, default_name: &str) -> Result<Option<PathBuf>, ProjectError>;
    fn path_exists(&self, path: &Path) -> bool;
    /// Permite que el webview sirva los medios del proyecto por asset protocol.
    fn allow_media_root(&self, root: &Path) -> Result<(), ProjectError>;
}

/// Sesión nativa: qué proyecto está abierto y la cancelación de sus renders.
pub trait ProjectSession {
    fn current(&self) -> Result<Option<ProjectSessionInfo>, ProjectError>;
    fn require(&self) -> Result<ProjectSessionInfo, ProjectError>;
    /// Compromete el proyecto a la sesión: cancela renders activos y fija la
    /// sesión nueva. Sólo la llama el caso de uso `adopt_project`.
    fn adopt(&self, info: &ProjectSessionInfo) -> Result<(), ProjectError>;
    /// Cierra la sesión y cancela los renders que le pertenecían.
    fn clear(&self) -> Result<(), ProjectError>;
}

/// Historial de versiones del proyecto (snapshots en `.olyvia-history/`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVersionInfo {
    pub id: String,
    pub project_path: String,
    pub path: String,
    pub saved_at_ms: u64,
    pub bytes: u64,
    pub reason: String,
    pub project_name: Option<String>,
    pub asset_count: u64,
    pub clip_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProjectVersionResult {
    pub restore_mode: String,
    pub project_path: String,
    pub backup_path: Option<String>,
    pub version: ProjectVersionInfo,
}

/// Versionado del proyecto: snapshots, listado y restauración.
pub trait ProjectVersioning {
    /// Snapshot previo a guardar: autosave con throttle, manual siempre.
    fn snapshot_before_save(&self, project_path: &Path, reason: &str);
    /// Versiones disponibles ordenadas de más nueva a más vieja.
    fn list_versions(&self, project_path: &Path) -> Vec<ProjectVersionInfo>;
    /// Restaura una versión: `copy` crea un archivo nuevo, si no pisa el
    /// proyecto tras guardar un backup `before-restore`.
    fn restore_version(
        &self,
        project_path: &Path,
        version_id: &str,
        copy: bool,
    ) -> Result<RestoreProjectVersionResult, ProjectError>;
}

/// Archivos de assets del proyecto en disco: copia al "guardar como" y
/// limpieza cuando el guardado falla.
pub trait ProjectAssetFiles {
    fn copy_project_assets(
        &self,
        project: &Value,
        from_root: &Path,
        to_root: &Path,
    ) -> Result<Vec<PathBuf>, ProjectError>;
    fn remove_files(&self, files: &[PathBuf]);
}

/// Asset declarado en el proyecto cuyo archivo no está en disco.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingAssetInfo {
    pub asset_id: String,
    pub label: String,
    pub kind: String,
    pub path: String,
    pub used_by_clip_ids: Vec<String>,
    pub proxy_path: Option<String>,
}

/// Resultado de intentar repuntar un asset.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkResult {
    pub ok: bool,
    pub asset_id: Option<String>,
    pub path: Option<String>,
    pub copied: Option<bool>,
    pub validated_by: Option<String>,
    pub bytes: Option<u64>,
    pub sha256: Option<String>,
    pub reason: Option<String>,
    pub missing: Option<MissingAssetInfo>,
}

impl RelinkResult {
    pub fn failed(asset_id: &str, reason: &str) -> Self {
        Self {
            ok: false,
            asset_id: Some(asset_id.to_owned()),
            path: None,
            copied: None,
            validated_by: None,
            bytes: None,
            sha256: None,
            reason: Some(reason.to_owned()),
            missing: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkFolderRejected {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkFolderResult {
    pub relinked: Vec<RelinkResult>,
    pub still_missing: Vec<MissingAssetInfo>,
    pub rejected: Vec<RelinkFolderRejected>,
}

/// Grupo de assets que apuntan al mismo contenido (mismo SHA-256 y bytes).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateAssetGroup {
    pub sha256: String,
    pub bytes: u64,
    pub asset_ids: Vec<String>,
    pub labels: Vec<String>,
    pub paths: Vec<String>,
    pub used_by_clip_ids: HashMap<String, Vec<String>>,
}

/// Recuperación de assets: detectar medios faltantes, repuntarlos y buscar
/// duplicados por contenido. Toda la complejidad de filesystem, hashing y
/// escaneo acotado vive en el adaptador; el caso de uso sólo orquesta.
pub trait ProjectAssetRecovery {
    /// Assets del documento cuyos archivos no resuelven dentro de `root`.
    fn missing_assets(&self, project: &Value, root: &Path) -> Vec<MissingAssetInfo>;
    /// Escaneo acotado de una carpeta de origen para relink masivo.
    fn scan_source_folder(&self, folder: &Path) -> Result<Vec<PathBuf>, ProjectError>;
    /// Tamaño en bytes de un archivo candidato (para matching por tamaño).
    fn file_size(&self, path: &Path) -> Option<u64>;
    /// Valida, copia al proyecto si hace falta y repunta el asset en el
    /// documento. No persiste: el caso de uso decide cuándo guardar.
    fn relink_asset(
        &self,
        project: &mut Value,
        root: &Path,
        asset_id: &str,
        source: &Path,
    ) -> Result<RelinkResult, ProjectError>;
    /// Assets del documento con contenido idéntico (mismo hash y tamaño).
    fn duplicate_groups(&self, project: &Value, root: &Path) -> Vec<DuplicateAssetGroup>;
}
