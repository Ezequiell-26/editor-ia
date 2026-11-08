//! Puertos del dominio Render.
//!
//! Contratos que los casos de uso de `application` necesitan del exterior.
//! Las implementaciones viven en `crate::infrastructure`.

use serde_json::Value;

use crate::render::queue::QueueEntry;

/// Persistencia de la cola de render (JSON en el directorio de estado).
/// `read_entries` devuelve `[]` cuando el archivo falta o está corrupto:
/// la degradación es parte del contrato, no un error.
pub trait RenderQueueStore {
    /// Entradas crudas del archivo (sin recuperar ni capear).
    fn read_entries(&self) -> Vec<Value>;
    /// Persiste la porción capada de la cola.
    fn write_entries(&self, entries: &[QueueEntry]) -> Result<(), String>;
}

use std::fs::File;
use std::path::{Path, PathBuf};

/// Salida reservada atómicamente con `create_new`: el nombre queda tomado
/// mientras el `File` guard viva, así dos exportaciones no pisan el mismo
/// archivo. `metadata` es el sidecar `*.ffmeta.txt` cuando se pidió.
#[derive(Debug)]
pub struct ReservedOutput {
    pub path: PathBuf,
    metadata: Option<(PathBuf, File)>,
    _guard: File,
}

impl ReservedOutput {
    /// Construye la reserva (sólo infraestructura la crea).
    pub fn new(path: PathBuf, guard: File, metadata: Option<(PathBuf, File)>) -> Self {
        Self {
            path,
            metadata,
            _guard: guard,
        }
    }

    /// Entrega el sidecar de metadatos para escribirlo (una sola vez).
    pub fn take_metadata(&mut self) -> Option<(PathBuf, File)> {
        self.metadata.take()
    }
}

/// Reserva de destinos y métricas de archivo para las exportaciones
/// sin recodificar. La implementación real está en
/// `infrastructure::render_lossless::LocalLosslessOutputs`.
pub trait LosslessOutputs {
    /// La ruta existe como archivo.
    fn is_file(&self, path: &Path) -> bool;
    /// Reserva `<requested>` (o `<stem>-N.<ext>`) sin pisar nada; con
    /// `reserve_metadata` reserva también el sidecar `ffmeta.txt`.
    fn reserve(
        &self,
        source: &Path,
        requested: &Path,
        reserve_metadata: bool,
    ) -> Result<ReservedOutput, crate::projects::service::ProjectError>;
    /// Tamaño del archivo en bytes (0 si no se puede medir).
    fn file_bytes(&self, path: &Path) -> u64;
    /// Borra un archivo (sidecar fallido, salida parcial).
    fn remove_file(&self, path: &Path);
}

// ---------------------------------------------------------------------------
// Ciclo de vida del render (jobs con worker FFmpeg + eventos).
// ---------------------------------------------------------------------------

use std::process::{ChildStderr, ChildStdout};
use std::sync::Arc;
use std::time::Instant;

use crate::projects::service::ProjectError;
use crate::render::export_tools::ExportVerification;
use crate::render::ffmpeg::RenderPlan;
use crate::render::lifecycle::{RenderFinishedEvent, RenderProgressEvent};

/// Proceso hijo FFmpeg en curso con su flag de cancelación.
/// `try_wait` devuelve `Some(exito)` al terminar y `None` mientras corre.
pub trait RenderProcess: Send + Sync {
    fn try_wait(&self) -> Option<bool>;
    /// Marca cancelación y mata el proceso hijo.
    fn request_cancel(&self);
    /// `true` si se pidió cancelación (aunque el proceso siga cerrando).
    fn is_cancelled(&self) -> bool;
}

/// Registro de renders activos (uno a la vez por contrato de la app).
pub trait RenderRuntime: Send + Sync {
    fn is_busy(&self) -> bool;
    fn first_id(&self) -> Option<String>;
    /// Registra el proceso bajo `job_id`; error si ya hay otro render.
    fn register(&self, job_id: &str, process: Arc<dyn RenderProcess>) -> Result<(), ProjectError>;
    fn unregister(&self, job_id: &str);
    /// Cancela el render `job_id` (flag + kill); `NotFound` si ya no corre.
    fn cancel(&self, job_id: &str) -> Result<(), ProjectError>;
    /// Mata todos los renders activos (cambio de sesión o salida de la app).
    fn cancel_all(&self);
}

/// Eventos `render-progress` / `render-finished` hacia la ventana.
pub trait RenderEvents: Send + Sync {
    fn progress(&self, event: &RenderProgressEvent);
    fn finished(&self, event: &RenderFinishedEvent);
}

/// Filesystem del ciclo de vida: directorios temporales, canonicalización,
/// publicación del archivo verificado y limpieza del cache de renders.
pub trait RenderFiles: Send + Sync {
    /// `canonicalize` si existe; si no, padre canonical + nombre.
    fn canonical(&self, path: &Path) -> Option<PathBuf>;
    /// `<cache_dir>/render-<job_id>` creado si falta.
    fn temp_dir(&self, cache_dir: &Path, job_id: &str) -> Result<PathBuf, ProjectError>;
    fn remove_dir(&self, path: &Path);
    /// Mueve (o copia como fallback) el temporal verificado al destino final.
    fn publish_output(&self, temporary: &Path, final_path: &Path) -> Result<(), ProjectError>;
    /// Borra los directorios `render-*` del cache; devuelve cuántos.
    fn prune_cache(&self, cache_dir: &Path) -> u64;
}

/// Diálogos nativos para elegir salida y carpeta del lote.
pub trait RenderDialogs {
    /// Guardar como MP4 dentro de `root` con `suggested` como nombre.
    fn pick_output(&self, root: &Path, suggested: &str) -> Result<Option<PathBuf>, ProjectError>;
    /// Elegir carpeta dentro de `root`.
    fn pick_directory(&self, root: &Path) -> Result<Option<PathBuf>, ProjectError>;
}

/// Spawn del proceso FFmpeg con pipes de progreso/lista para el worker.
pub struct SpawnedRender {
    pub process: Arc<dyn RenderProcess>,
    pub stdout: Option<ChildStdout>,
    pub stderr: Option<ChildStderr>,
}

pub trait RenderEncoder: Send + Sync {
    fn spawn(&self, ffmpeg: &Path, plan: &RenderPlan) -> Result<SpawnedRender, ProjectError>;
}

/// Reporte FFprobe del archivo publicado (`render-finished.verification`).
pub trait RenderVerifier: Send + Sync {
    fn verify(&self, ffprobe: &Path, path: &Path) -> Result<ExportVerification, ProjectError>;
}

/// Todo lo que el worker de render necesita una vez validado el plan.
pub struct RenderLaunch {
    pub job_id: String,
    pub plan: RenderPlan,
    pub ffprobe: PathBuf,
    pub final_output: PathBuf,
    pub temp_dir: PathBuf,
    pub root: PathBuf,
    pub started: Instant,
    pub process: Arc<dyn RenderProcess>,
    pub stdout: Option<ChildStdout>,
    pub stderr: Option<ChildStderr>,
}

/// Lanza el worker del render en background: threads de progreso y stderr,
/// espera del proceso, verificación y publicación. Los estados se reportan
/// por `RenderRuntime`/`RenderEvents`/`RenderFiles`/`RenderVerifier`.
pub trait RenderLauncher: Send + Sync {
    fn launch(&self, job: RenderLaunch);
}
