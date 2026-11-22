//! Adaptador FFmpeg/FFprobe del puerto `ObjectTrackBackend`.
//!
//! Extrae frames con `ffmpeg -f rawvideo -pix_fmt rgb24` escalados al lado
//! máximo del tracker y los entrega por chunks para acotar la memoria.
//! El decode nunca se acumula entero en RAM.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::ports::object_track::ObjectTrackBackend;
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Backend de producción: binarios FFmpeg/FFprobe del sistema del usuario.
pub struct FfmpegObjectTrackBackend;

impl ObjectTrackBackend for FfmpegObjectTrackBackend {
    fn probe_dimensions(&self, ffprobe: &Path, input: &Path) -> Result<(u32, u32), ProjectError> {
        let output = Command::new(ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0",
            ])
            .arg(input)
            .output()
            .map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("no se pudo consultar el video: {error}").as_str(),
                )
            })?;
        if !output.status.success() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "FFprobe no pudo leer las dimensiones del video",
            ));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut parts = text.trim().split(',');
        let w = parts
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        let h = parts
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        if w == 0 || h == 0 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el video no declara dimensiones válidas",
            ));
        }
        Ok((w, h))
    }

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
    ) -> Result<(), ProjectError> {
        let filter = format!(
            "fps={},scale={width}:{height}",
            crate::media::object_track::SAMPLE_FPS
        );
        let mut command = Command::new(ffmpeg);
        command
            .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
            .arg("-ss")
            .arg(format!("{start_seconds:.3}"))
            .arg("-t")
            .arg(format!("{duration:.3}"))
            .arg("-i")
            .arg(input)
            .args(["-vf", &filter, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        crate::infrastructure::process::hide_console(&mut command);
        let mut child = command.stdout(Stdio::piped()).spawn().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo lanzar FFmpeg para el seguimiento: {error}").as_str(),
            )
        })?;
        let mut stdout = child.stdout.take().ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::Io, "FFmpeg no devolvió frames")
        })?;

        let frame_bytes = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(3))
            .filter(|bytes| *bytes > 0)
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "dimensiones de frame inválidas",
                )
            })?;
        let chunk_frames = chunk_frames.max(1);
        let mut frame = vec![0u8; frame_bytes];
        let mut first_byte = [0u8; 1];
        let mut chunk: Vec<Vec<u8>> = Vec::with_capacity(chunk_frames);

        loop {
            let read = stdout.read(&mut first_byte).map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("no se pudieron leer los frames del seguimiento: {error}").as_str(),
                )
            })?;
            if read == 0 {
                break;
            }
            frame[0] = first_byte[0];
            if let Err(error) = stdout.read_exact(&mut frame[1..]) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("FFmpeg devolvió un frame incompleto durante el seguimiento: {error}")
                        .as_str(),
                ));
            }
            chunk.push(frame.clone());
            if chunk.len() >= chunk_frames {
                if let Err(error) = on_chunk(std::mem::take(&mut chunk)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                chunk = Vec::with_capacity(chunk_frames);
            }
        }

        if !chunk.is_empty() {
            if let Err(error) = on_chunk(chunk) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }

        let status = child.wait().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo completar FFmpeg: {error}").as_str(),
            )
        })?;
        if !status.success() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "FFmpeg terminó con error durante el seguimiento del objeto",
            ));
        }
        Ok(())
    }
}
