//! Reserva de destinos y métricas de archivo para exportaciones sin
//! recodificar. Implementa `ports::render::LosslessOutputs`.

use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::ports::render::{LosslessOutputs, ReservedOutput};
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Normaliza una ruta de destino usando su carpeta canonica.
fn normalized_output_path(path: &Path) -> Result<PathBuf, ProjectError> {
    let file_name = path.file_name().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta el nombre del archivo de salida",
        )
    })?;
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let canonical_parent = parent.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no pude resolver la carpeta de salida",
        )
    })?;
    Ok(canonical_parent.join(file_name))
}

/// ¿Las dos rutas apuntan al mismo archivo?
///
/// El destino puede no existir todavía: en ese caso no hay nada que pisar. Se
/// comparan rutas canónicas para que `C:\x\a.mp4` y `c:\x\.\a.mp4` cuenten como
/// el mismo archivo en Windows.
fn same_file_path(source: &Path, target: &Path) -> Result<bool, ProjectError> {
    let left = source.canonicalize().map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "el archivo de origen no existe")
    })?;
    let right = match target.canonicalize() {
        Ok(path) => path,
        Err(_) => return Ok(false),
    };
    Ok(left == right)
}

/// Reserva el destino mediante create_new para evitar carreras entre exportaciones.
fn reserve_output_path(
    source: &Path,
    requested: &Path,
    reserve_metadata: bool,
) -> Result<ReservedOutput, ProjectError> {
    if requested.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta la ruta de salida",
        ));
    }
    let parent = requested
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude crear la carpeta de salida")
    })?;
    let requested_path = normalized_output_path(requested)?;
    if same_file_path(source, &requested_path)? {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de salida no puede ser el mismo que el origen",
        ));
    }
    let stem = requested
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let extension = requested.extension().and_then(|value| value.to_str());
    let source_path = source.canonicalize().map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "el archivo de origen no existe")
    })?;
    for index in 1..=9_999u32 {
        let candidate = if index == 1 {
            requested_path.clone()
        } else {
            let name = match extension {
                Some(extension) => format!("{stem}-{index}.{extension}"),
                None => format!("{stem}-{index}"),
            };
            requested_path.with_file_name(name)
        };
        #[cfg(windows)]
        let same_source = candidate
            .to_string_lossy()
            .eq_ignore_ascii_case(&source_path.to_string_lossy());
        #[cfg(not(windows))]
        let same_source = candidate == source_path;
        if same_source {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el archivo de salida no puede ser el mismo que el origen",
            ));
        }
        let output_file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "no pude reservar el archivo de salida",
                ))
            }
        };
        let sidecar = candidate.with_extension("ffmeta.txt");
        let metadata = if reserve_metadata {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&sidecar)
            {
                Ok(file) => Some((sidecar, file)),
                Err(error) => {
                    drop(output_file);
                    let _ = fs::remove_file(&candidate);
                    if error.kind() == ErrorKind::AlreadyExists {
                        continue;
                    }
                    return Err(ProjectError::message(
                        ProjectErrorCode::Io,
                        "no pude reservar los metadatos de capitulos",
                    ));
                }
            }
        } else {
            None
        };
        return Ok(ReservedOutput::new(candidate, output_file, metadata));
    }
    Err(ProjectError::message(
        ProjectErrorCode::AlreadyExists,
        "no encontre un nombre libre para la entrega",
    ))
}

pub struct LocalLosslessOutputs;

impl LosslessOutputs for LocalLosslessOutputs {
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn reserve(
        &self,
        source: &Path,
        requested: &Path,
        reserve_metadata: bool,
    ) -> Result<ReservedOutput, ProjectError> {
        reserve_output_path(source, requested, reserve_metadata)
    }

    fn file_bytes(&self, path: &Path) -> u64 {
        fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
    }

    fn remove_file(&self, path: &Path) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_when_the_output_is_the_source() {
        let dir = std::env::temp_dir().join("lossless-same-file-test");
        let _ = fs::create_dir_all(&dir);
        let source = dir.join("origen.mp4");
        fs::write(&source, b"x").expect("escribir el archivo de prueba");
        assert!(same_file_path(&source, &source).unwrap_or(false));
        // Un destino que todavía no existe no puede ser el mismo archivo.
        assert!(!same_file_path(&source, &dir.join("todavia-no-existe.mp4")).unwrap_or(true));
        let _ = fs::remove_file(&source);
    }

    #[test]
    fn refuses_to_export_over_the_source() {
        let root = std::env::temp_dir().join(format!("lossless-source-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        fs::write(&source, b"original").unwrap();
        let error = reserve_output_path(&source, &source, false).unwrap_err();
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
        assert_eq!(fs::read(&source).unwrap(), b"original");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reserves_a_new_name_instead_of_overwriting_an_existing_delivery() {
        let root = std::env::temp_dir().join(format!("lossless-collision-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let requested = root.join("cut.mp4");
        fs::write(&source, b"original").unwrap();
        fs::write(&requested, b"keep-me").unwrap();
        let reserved = reserve_output_path(&source, &requested, false).unwrap();
        assert_eq!(reserved.path.file_name().unwrap(), "cut-2.mp4");
        assert_eq!(fs::read(&requested).unwrap(), b"keep-me");
        assert_eq!(fs::metadata(&reserved.path).unwrap().len(), 0);
        drop(reserved);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reserves_chapter_sidecar_name_as_well_as_video_name() {
        let root = std::env::temp_dir().join(format!("lossless-sidecar-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let requested = root.join("cut.mp4");
        fs::write(&source, b"original").unwrap();
        fs::write(root.join("cut.ffmeta.txt"), b"keep-metadata").unwrap();
        let mut reserved = reserve_output_path(&source, &requested, true).unwrap();
        assert_eq!(reserved.path.file_name().unwrap(), "cut-2.mp4");
        assert_eq!(
            fs::read(root.join("cut.ffmeta.txt")).unwrap(),
            b"keep-metadata"
        );
        assert!(reserved.take_metadata().is_some());
        drop(reserved);
        let _ = fs::remove_dir_all(&root);
    }
}
