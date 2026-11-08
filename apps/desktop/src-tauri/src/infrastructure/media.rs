//! Adaptadores del dominio Media.
//!
//! - `StateMediaTools`: rutas de ffmpeg/ffprobe desde la configuración del
//!   usuario (`AppState` + `system::resolve_tools`).
//! - `SystemMediaRunner`: ejecuta FFmpeg/FFprobe con stdout y stderr
//!   capturados, ocultando la consola en Windows, y resuelve rutas de
//!   salida. No depende del estado: también lo usan los tests.

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use crate::commands::system::resolve_tools;
use crate::ports::media::{MediaRunner, MediaTools};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Herramientas externas según la configuración persistida del usuario.
pub struct StateMediaTools<'a> {
    state: &'a AppState,
}

impl<'a> StateMediaTools<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl MediaTools for StateMediaTools<'_> {
    fn ffmpeg_path(&self) -> Option<PathBuf> {
        let settings = self.state.settings_snapshot().ok()?;
        let (ffmpeg, _, _) = resolve_tools(&settings);
        ffmpeg
    }

    fn ffprobe_path(&self) -> Option<PathBuf> {
        let settings = self.state.settings_snapshot().ok()?;
        let (_, ffprobe, _) = resolve_tools(&settings);
        ffprobe
    }
}

/// Runner de procesos FFmpeg/FFprobe sobre el sistema real.
pub struct SystemMediaRunner;

fn run(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
    spawn_error: &'static str,
) -> Result<Output, ProjectError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    crate::commands::hide_console(&mut command);
    command
        .output()
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, spawn_error))
}

impl MediaRunner for SystemMediaRunner {
    fn run_ffmpeg(
        &self,
        ffmpeg: &Path,
        args: &[String],
        cwd: Option<&Path>,
    ) -> Result<Output, ProjectError> {
        run(ffmpeg, args, cwd, "no se pudo iniciar FFmpeg")
    }

    fn run_ffprobe(&self, ffprobe: &Path, args: &[String]) -> Result<Output, ProjectError> {
        run(
            ffprobe,
            args,
            None,
            "no se pudo iniciar ffprobe para inspeccionar el archivo",
        )
    }

    fn ensure_dir(&self, path: &Path) -> Result<(), ProjectError> {
        std::fs::create_dir_all(path).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo crear el directorio de salida",
            )
        })
    }

    fn file_exists(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn remove_file(&self, path: &Path) {
        let _ = std::fs::remove_file(path);
    }
}

/// Publicación de exports de timeline sobre el sistema de archivos local.
pub struct LocalTimelineExportFiles;

impl crate::ports::media::TimelineExportFiles for LocalTimelineExportFiles {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn publish(
        &self,
        dir: &Path,
        stem: &str,
        extension: &str,
        label: &str,
        text: &str,
    ) -> Result<(PathBuf, u64), ProjectError> {
        let mut path = dir.join(format!("{stem}.{extension}"));
        let mut index = 2;
        while path.exists() {
            path = dir.join(format!("{stem}-{index}.{extension}"));
            index += 1;
        }
        let temp = dir.join(format!(".{extension}-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temp, text.as_bytes()).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo escribir {label}: {error}").as_str(),
            )
        })?;
        std::fs::rename(&temp, &path).map_err(|error| {
            let _ = std::fs::remove_file(&temp);
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo publicar {label}: {error}").as_str(),
            )
        })?;
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Ok((path, bytes))
    }
}

/// Lectura de archivos de subtítulos sobre el sistema de archivos local.
pub struct LocalSubtitleFiles;

impl crate::ports::media::SubtitleFiles for LocalSubtitleFiles {
    fn metadata(&self, path: &Path) -> Option<crate::ports::media::SubtitleFileMeta> {
        let metadata = std::fs::metadata(path).ok()?;
        Some(crate::ports::media::SubtitleFileMeta {
            is_file: metadata.is_file(),
            len: metadata.len(),
        })
    }

    fn read(&self, path: &Path) -> Result<Vec<u8>, ProjectError> {
        std::fs::read(path).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo leer el archivo de subtítulos",
            )
        })
    }
}

/// `LocalizedSubtitleFiles` sobre el sistema de archivos real: temporal
/// oculto `.localized-{uuid}.{ext}` + rename atómico, igual que el comando
/// histórico.
pub struct LocalLocalizedSubtitleFiles;

impl Default for LocalLocalizedSubtitleFiles {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalLocalizedSubtitleFiles {
    pub fn new() -> Self {
        Self
    }
}

impl crate::ports::media::LocalizedSubtitleFiles for LocalLocalizedSubtitleFiles {
    fn output_dir_exists(&self, dir: &Path) -> bool {
        dir.is_dir()
    }

    fn candidate_exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn write_temp(
        &self,
        dir: &Path,
        extension: &str,
        content: &str,
    ) -> Result<(PathBuf, u64), ProjectError> {
        let temp_path = dir.join(format!(".localized-{}.{extension}", uuid::Uuid::new_v4()));
        std::fs::write(&temp_path, content.as_bytes()).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo escribir el subtítulo: {error}").as_str(),
            )
        })?;
        let written = std::fs::metadata(&temp_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if written == 0 {
            let _ = std::fs::remove_file(&temp_path);
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "el subtítulo temporal quedó vacío",
            ));
        }
        Ok((temp_path, written))
    }

    fn file_len(&self, path: &Path) -> Option<u64> {
        std::fs::metadata(path).ok().map(|metadata| metadata.len())
    }

    fn publish(&self, temp: &Path, final_path: &Path) -> Result<(), ProjectError> {
        std::fs::rename(temp, final_path).map_err(|error| {
            let _ = std::fs::remove_file(temp);
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo publicar el subtítulo: {error}").as_str(),
            )
        })
    }
}
