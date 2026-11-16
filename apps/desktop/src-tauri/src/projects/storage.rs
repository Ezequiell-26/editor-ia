//! Lectura y escritura del archivo de proyecto.
//!
//! El límite de tamaño está documentado acá mismo: un proyecto es un documento
//! de edición, no un contenedor de medios, y un archivo de varios megabytes ya
//! señala un error. Escribir se hace por temporal en el mismo directorio +
//! `rename`, para que un fallo deje intacto el archivo anterior.
//!
//! Ningún mensaje incluye el directorio: solo el nombre del archivo. La ruta
//! completa del usuario queda del lado de la interfaz nativa.

use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use super::service::{ProjectError, ProjectErrorCode};

pub const MAX_PROJECT_FILE_BYTES: u64 = 8 * 1024 * 1024;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "el archivo elegido".to_owned())
}

fn file_name(path: &Path) -> String {
    display_name(path)
}

pub fn read_project_file(path: &Path) -> Result<String, ProjectError> {
    // Open once and inspect/read the same handle. A path-based metadata + read
    // sequence could race with a replacement or a file growing after the check.
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                &format!(
                    "no existe un archivo de proyecto en este nombre: {}",
                    file_name(path)
                ),
            ));
        }
        Err(error) => {
            // Opening a directory can fail on Windows before a File handle is
            // returned; preserve the public "not a project file" error.
            if fs::metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
                return Err(ProjectError::message(
                    ProjectErrorCode::NotFound,
                    &format!("la ruta elegida no es un archivo: {}", file_name(path)),
                ));
            }
            return Err(io_error(&error));
        }
    };

    let metadata = file.metadata().map_err(|error| io_error(&error))?;
    if !metadata.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            &format!("la ruta elegida no es un archivo: {}", file_name(path)),
        ));
    }

    if metadata.len() > MAX_PROJECT_FILE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::FileTooLarge,
            &format!(
                "{} pesa {} bytes y un proyecto no puede pasar de {}",
                file_name(path),
                metadata.len(),
                MAX_PROJECT_FILE_BYTES
            ),
        ));
    }

    // Limit the actual read too: metadata can become stale while another
    // process writes to the file. One extra byte is enough to detect overflow.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    let mut reader = file.take(MAX_PROJECT_FILE_BYTES + 1);
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| io_error(&error))?;
    if bytes.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::FileTooLarge,
            &format!(
                "{} supera el limite de {} bytes",
                file_name(path),
                MAX_PROJECT_FILE_BYTES
            ),
        ));
    }

    String::from_utf8(bytes).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidJson,
            &format!("{} no esta en codificacion UTF-8", file_name(path)),
        )
    })
}

/// Escribe temporal + `rename`. Un error deja el archivo anterior intacto y
/// borra el temporal; nunca se pisa el destino con una escritura a medias.
pub fn write_project_file(path: &Path, contents: &str) -> Result<u64, ProjectError> {
    // Keep the write boundary symmetric with `read_project_file`: never create
    // a project that this same application would refuse to reopen.
    if contents.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::FileTooLarge,
            &format!(
                "{} pesa {} bytes y un proyecto no puede pasar de {}",
                file_name(path),
                contents.len(),
                MAX_PROJECT_FILE_BYTES
            ),
        ));
    }

    let directory = path.parent().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la ruta elegida no tiene un directorio donde escribir",
        )
    })?;

    let temporary = directory.join(format!(
        ".{}.tmp-{}-{}",
        file_name(path),
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::SeqCst)
    ));

    let outcome = (|| -> Result<u64, ProjectError> {
        let mut handle = fs::File::create(&temporary).map_err(|error| io_error(&error))?;
        handle
            .write_all(contents.as_bytes())
            .map_err(|error| io_error(&error))?;
        handle.flush().map_err(|error| io_error(&error))?;
        handle.sync_all().map_err(|error| io_error(&error))?;
        drop(handle);
        fs::rename(&temporary, path).map_err(|error| io_error(&error))?;
        Ok(contents.len() as u64)
    })();

    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }

    outcome
}

pub fn exists(path: &Path) -> bool {
    path.exists()
}

fn io_error(error: &std::io::Error) -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::Io,
        &format!(
            "el sistema de archivos rechazo la operacion: {}",
            error.kind()
        ),
    )
}

#[cfg(test)]
#[path = "storage.tests.rs"]
mod tests;
