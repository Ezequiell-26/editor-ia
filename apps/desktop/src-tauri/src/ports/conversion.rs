//! Puertos del motor de conversión, compresión y lote de exportación.
//!
//! Mismo patrón Jobs que proxies/render: la aplicación orquesta y los
//! adaptadores de infraestructura ejecutan procesos, tocan el filesystem y
//! emiten eventos. Los nombres de eventos IPC se preservan:
//! `convert-progress` (lote) y `compress-progress` (porcentaje en vivo).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::media::conversion::{ConvertProgress, LiveProgress};
use crate::ports::media::MediaRunner;
use crate::projects::service::ProjectError;
use crate::render::ffmpeg::HardwareEncoders;

/// Acceso mínimo al filesystem que necesita el motor de conversión.
pub trait ConversionFiles: Send + Sync {
    fn is_dir(&self, path: &Path) -> bool;
    fn is_file(&self, path: &Path) -> bool;
    fn path_exists(&self, path: &Path) -> bool;
    fn file_len(&self, path: &Path) -> u64;
    fn remove_file(&self, path: &Path);
    fn rename(&self, from: &Path, to: &Path) -> Result<(), ProjectError>;
    /// Primer nombre libre `stem.ext`, `stem-1.ext`, … (nunca pisa archivos).
    fn unique_output(&self, dir: &Path, stem: &str, extension: &str) -> PathBuf;
}

/// Ejecuta un FFmpeg de conversión/compresión de punta a punta:
/// spawn con `-progress pipe:1`, threads de progreso y stderr, espera,
/// publicación por rename y sondeo del resultado. Devuelve
/// `(bytes, duración, formato)` del archivo publicado.
pub trait ConversionRunner: Send + Sync {
    fn run(
        &self,
        ffmpeg: &Path,
        ffprobe: Option<&Path>,
        args: &[String],
        temp_path: &Path,
        final_path: &Path,
        sanitize_root: &Path,
        progress: Option<&LiveProgress>,
    ) -> Result<(u64, Option<f64>, String), ProjectError>;
}

/// Eventos hacia la UI: progreso por porcentaje (compresión) y por ítem
/// (lote de conversión).
pub trait ConversionEvents: Send + Sync {
    fn compress_progress(&self, percent: f64);
    fn batch_progress(&self, event: &ConvertProgress);
}

/// Detección de encoders de hardware (NVENC/AMF/QSV) para el vector de args.
pub trait ConversionHardware: Send + Sync {
    fn detect(&self, ffmpeg: &Path) -> HardwareEncoders;
}

/// Dependencias que la aplicación necesita para los cuatro comandos.
pub struct ConversionDeps<'a> {
    pub session: &'a dyn crate::ports::projects::ProjectSession,
    pub documents: &'a dyn crate::ports::projects::ProjectDocuments,
    pub tools: &'a dyn crate::ports::media::MediaTools,
    pub files: &'a dyn ConversionFiles,
    pub events: Arc<dyn ConversionEvents>,
    pub runner: &'a dyn ConversionRunner,
    pub media_runner: &'a dyn MediaRunner,
    pub hardware: &'a dyn ConversionHardware,
}
