//! Puerto del seguimiento de objeto por template matching (NCC).
//!
//! La aplicación orquesta el tracking sobre frames ya decodificados; este
//! trait abstrae el sustrato: FFprobe para dimensiones y un stream de
//! frames rgb24 escalados entregado por chunks acotados en memoria.

use std::path::Path;

use crate::projects::service::ProjectError;

/// Backend de frames para el tracker de objetos.
pub trait ObjectTrackBackend: Send + Sync {
    /// Dimensiones del primer stream de video, vía FFprobe.
    fn probe_dimensions(&self, ffprobe: &Path, input: &Path) -> Result<(u32, u32), ProjectError>;

    /// Entrega los frames del rango `[start_seconds, +duration)` escalados a
    /// `width × height` rgb24, agrupados en chunks de hasta `chunk_frames`.
    /// El callback corre por chunk en orden; si devuelve `Err` el stream se
    /// aborta y el error se propaga. El chunk final puede ser parcial.
    // clippy::too_many_arguments: firma del trait del puerto; la implementan
    // backends de FFmpeg y cambiarla altera el contrato interno.
    #[allow(clippy::too_many_arguments)]
    fn stream_frame_chunks(
        &self,
        ffmpeg: &Path,
        input: &Path,
        start_seconds: f64,
        duration: f64,
        width: u32,
        height: u32,
        chunk_frames: usize,
        on_chunk: &mut dyn FnMut(Vec<Vec<u8>>) -> Result<(), ProjectError>,
    ) -> Result<(), ProjectError>;
}
