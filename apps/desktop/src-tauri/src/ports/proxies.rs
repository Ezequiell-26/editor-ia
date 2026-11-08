//! Puertos del subsistema de proxies de vista previa.
//!
//! Separa el estado en memoria de los jobs (`ProxyRuntime`), el acceso al
//! filesystem del cache (`ProxyFiles`), la emisión de eventos (`ProxyEvents`)
//! y el worker FFmpeg en background (`ProxyGenerator`). Los casos de uso en
//! `application::proxies` orquestan estos puertos sin tocar Tauri ni procesos.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::media::proxy::{ExistingProxy, ProxyCleanupResult, ProxyProgressEvent, ProxyStatus};
use crate::projects::service::ProjectError;

/// Registro en memoria de los jobs de proxy, indexado por `asset_id`.
/// Conserva el flag de cancelación junto al último estado publicado.
pub trait ProxyRuntime: Send + Sync {
    /// Estado registrado para el asset, si existe.
    fn status(&self, asset_id: &str) -> Option<ProxyStatus>;
    /// Flag de cancelación del job activo, si existe.
    fn flag(&self, asset_id: &str) -> Option<Arc<AtomicBool>>;
    /// Registra un job nuevo con flag de cancelación fresco y lo devuelve.
    fn begin(&self, asset_id: &str, status: ProxyStatus) -> Arc<AtomicBool>;
    /// Reemplaza el estado conservando el flag existente (o crea uno nuevo).
    fn update(&self, asset_id: &str, status: ProxyStatus);
}

/// Publica los cambios de estado de un proxy hacia la UI.
pub trait ProxyEvents: Send + Sync {
    fn progress(&self, event: ProxyProgressEvent);
}

/// Una entrada del directorio `media/proxies` para la limpieza de huérfanos.
#[derive(Debug, Clone)]
pub struct ProxyFileEntry {
    pub path: PathBuf,
    pub name: String,
    pub bytes: u64,
}

/// Operaciones de filesystem del cache `media/proxies` y de la huella
/// del archivo origen.
pub trait ProxyFiles: Send + Sync {
    /// Crea el directorio del cache si no existe.
    fn ensure_dir(&self, dir: &Path) -> Result<(), ProjectError>;
    /// Huella del origen: (mtime ms, bytes).
    fn fingerprint(&self, path: &Path) -> Option<(u64, u64)>;
    /// `true` si el path es un archivo existente.
    fn is_file(&self, path: &Path) -> bool;
    /// Tamaño en bytes del archivo, si existe.
    fn file_len(&self, path: &Path) -> Option<u64>;
    /// Escanea `media/proxies` y devuelve los candidatos del asset con su
    /// flag `up_to_date` ya calculado contra la huella del origen.
    fn candidates(
        &self,
        root: &Path,
        asset_id: &str,
        source_mtime_ms: u64,
        source_bytes: u64,
    ) -> Vec<ExistingProxy>;
    /// Borra un archivo; `true` si se eliminó.
    fn remove_file(&self, path: &Path) -> bool;
    /// Renombra `from` a `to`; `true` si se movió.
    fn rename(&self, from: &Path, to: &Path) -> bool;
    /// Borra proxies del cache; con `asset_id` sólo los de ese asset.
    fn cleanup(&self, root: &Path, asset_id: Option<&str>) -> ProxyCleanupResult;
    /// Lista las entradas de `media/proxies` (nombre + bytes) para detectar
    /// proxies huérfanos. Vacío si el directorio no existe.
    fn proxy_entries(&self, root: &Path) -> Vec<ProxyFileEntry>;
}

/// Trabajo de generación de un proxy: todo lo que el worker necesita,
/// ya resuelto por el caso de uso.
#[derive(Debug, Clone)]
pub struct ProxyJob {
    pub asset_id: String,
    pub quality: String,
    pub root: PathBuf,
    pub source: PathBuf,
    pub target: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub cancelled: Arc<AtomicBool>,
}

/// Lanza el worker FFmpeg de proxies en background. La implementación
/// reporta estados a través de `ProxyRuntime` y eventos vía `ProxyEvents`.
pub trait ProxyGenerator: Send + Sync {
    fn generate(&self, job: ProxyJob);
}
