//! Variantes de proyecto y material de entrega por carpeta.
//!
//! Lógica de filesystem/JSON de los comandos `write_project_variant`,
//! `copy_media_into` y `write_project_file`: nombres seguros, espejo de
//! assets con verificación de path, y escritura atómica vía
//! `projects::service::save_project`. Sin Tauri ni procesos.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::projects::service::{self, ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantWritten {
    pub path: String,
    pub bytes: u64,
    pub copied_assets: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiedMedia {
    pub source: String,
    pub relative_path: String,
    pub bytes: u64,
    /// SHA-256 del archivo ya copiado: la integridad que declara el proyecto
    /// se calcula sobre el destino real, no sobre el origen.
    pub sha256: String,
}

pub fn safe_stem(name: &str) -> String {
    let mut stem = String::new();
    for character in name.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            stem.push(character.to_ascii_lowercase());
        } else if (character.is_whitespace() || matches!(character, '.' | '/' | '\\'))
            && !stem.ends_with('-')
        {
            stem.push('-');
        }
    }
    let trimmed = stem.trim_matches('-').to_owned();
    if trimmed.is_empty() {
        "variante".to_owned()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// Nombre de archivo de variante: siempre termina en `.editoria.json` (o
/// `.json` si el nombre ya declaraba la extensión del proyecto).
pub fn variant_file_name(file_name: &str) -> String {
    const SUFFIX: &str = ".editoria.json";
    let trimmed = file_name.trim();
    // Si el nombre ya declara la extensión del proyecto, sanear sólo el stem:
    // pasarla entera por `safe_stem` convierte los puntos en guiones y el
    // resultado queda "nombre-editoria-json.editoria.json".
    if trimmed.len() > SUFFIX.len()
        && trimmed[trimmed.len() - SUFFIX.len()..].eq_ignore_ascii_case(SUFFIX)
    {
        return format!(
            "{}{SUFFIX}",
            safe_stem(&trimmed[..trimmed.len() - SUFFIX.len()])
        );
    }
    let mut name = safe_stem(file_name);
    if name.ends_with(".editoria") {
        name.push_str(".json");
    } else if !name.ends_with(".json") {
        name.push_str(".editoria.json");
    }
    name
}

fn relative_asset_paths(project: &Value) -> Result<Vec<String>, ProjectError> {
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    if assets.len() > 10_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la variante declara demasiados assets",
        ));
    }
    let mut paths = Vec::new();
    for asset in &assets {
        let Some(relative) = asset["source"]["path"].as_str() else {
            continue;
        };
        if relative.contains("..") || Path::new(relative).is_absolute() {
            return Err(ProjectError::message(
                ProjectErrorCode::PathEscapesRoot,
                "un asset de la variante intenta salir de la carpeta del proyecto",
            ));
        }
        paths.push(relative.to_string());
    }
    for relative in crate::media::project_lut_paths(project)? {
        if !paths.iter().any(|path| path == &relative) {
            paths.push(relative);
        }
    }
    for relative in crate::media::project_proxy_paths(project)? {
        if !paths.iter().any(|path| path == &relative) {
            paths.push(relative);
        }
    }
    Ok(paths)
}

/// Copy only the missing media. Existing files must prove they are the same
/// bytes — size alone can collide between two different assets (AUD-138).
fn mirror_assets(
    project: &Value,
    old_root: &Path,
    new_root: &Path,
) -> Result<(usize, Vec<PathBuf>), ProjectError> {
    let old_root = old_root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta del proyecto original no está disponible",
        )
    })?;
    // AUD-139: si una copia posterior falla, se revierten sólo los archivos
    // que esta operación creó — la carpeta de variantes no queda con
    // medios huérfanos de una escritura abortada. La lista `created` se
    // devuelve para que el caller también pueda revertir si la escritura
    // del JSON falla después de copiar.
    let mut created: Vec<PathBuf> = Vec::new();
    let result = copy_missing_assets(project, &old_root, new_root, &mut created);
    match result {
        Ok(copied) => Ok((copied, created)),
        Err(error) => {
            for path in created.iter().rev() {
                let _ = std::fs::remove_file(path);
            }
            Err(error)
        }
    }
}

fn copy_missing_assets(
    project: &Value,
    old_root: &Path,
    new_root: &Path,
    created: &mut Vec<PathBuf>,
) -> Result<usize, ProjectError> {
    let mut copied = 0;
    for relative in relative_asset_paths(project)? {
        let source = crate::media::resolve_inside_root(old_root, &relative)?;
        if !source.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "un asset de la variante no está en disco",
            ));
        }
        let destination = new_root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        let Some(parent) = destination.parent() else {
            continue;
        };
        std::fs::create_dir_all(parent).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar la carpeta de medios de las variantes",
            )
        })?;
        let parent_canonical = parent.canonicalize().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "la carpeta de medios de las variantes no es accesible",
            )
        })?;
        if !parent_canonical.starts_with(new_root) {
            return Err(ProjectError::message(
                ProjectErrorCode::PathEscapesRoot,
                "la copia de medios intentaría salir de la carpeta de variantes",
            ));
        }
        if destination.exists() {
            let source_size = std::fs::metadata(&source)
                .map(|meta| meta.len())
                .unwrap_or(0);
            let destination_size = std::fs::metadata(&destination)
                .map(|meta| meta.len())
                .unwrap_or(0);
            if source_size != destination_size {
                return Err(ProjectError::message(
                    ProjectErrorCode::AlreadyExists,
                    "ya existe un medio distinto con el mismo nombre en la carpeta de variantes",
                ));
            }
            // AUD-138: el mismo tamaño no prueba la misma identidad —
            // hashear ambos antes de reutilizar el destino.
            let same_bytes = crate::media::sha256_file(&source).and_then(|(source_hash, _)| {
                crate::media::sha256_file(&destination)
                    .map(|(destination_hash, _)| source_hash == destination_hash)
            });
            match same_bytes {
                Ok(true) => continue,
                Ok(false) => {
                    return Err(ProjectError::message(
                        ProjectErrorCode::AlreadyExists,
                        "ya existe un medio distinto con el mismo nombre en la carpeta de variantes",
                    ));
                }
                Err(_) => {
                    return Err(ProjectError::message(
                        ProjectErrorCode::Io,
                        "no se pudo verificar la integridad del medio existente en las variantes",
                    ));
                }
            }
        }
        std::fs::copy(&source, &destination).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo copiar un medio a la carpeta de variantes",
            )
        })?;
        created.push(destination.clone());
        copied += 1;
    }
    Ok(copied)
}

fn prepare_directory(directory: &str, io_message: &str) -> Result<PathBuf, ProjectError> {
    // La carpeta llega por IPC: política de escritura de `fs_*` (absoluta,
    // sin sistema, credenciales ni carpetas de la app).
    let root = crate::application::fs::validate_user_write_path(directory)?;
    std::fs::create_dir_all(&root)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, io_message))?;
    Ok(root)
}

/// Espeja los assets del proyecto en `directory` y escribe el `.editoria.json`
/// de la variante. `source_root` es la raíz del proyecto que origina las rutas.
pub fn write_project_variant_file(
    directory: &str,
    file_name: &str,
    project: &Value,
    source_root: &Path,
) -> Result<VariantWritten, ProjectError> {
    if directory.trim().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta para las variantes",
        ));
    }
    let new_root = prepare_directory(directory, "no se pudo crear la carpeta de variantes")?;
    let new_root = new_root.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "la carpeta de variantes no es accesible",
        )
    })?;
    let name = variant_file_name(file_name);
    let target = new_root.join(&name);
    if target.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe una variante con ese nombre; no se sobrescribió",
        ));
    }
    let (copied_assets, created) = mirror_assets(project, source_root, &new_root)?;
    // AUD-139 residual: si la escritura del JSON falla después de copiar,
    // los medios recién creados se revierten — la transacción cubre ambas
    // fases, no sólo la copia.
    match service::save_project(&target, project) {
        Ok(saved) => Ok(VariantWritten {
            path: saved.path,
            bytes: saved.bytes,
            copied_assets,
        }),
        Err(error) => {
            for path in created.iter().rev() {
                let _ = std::fs::remove_file(path);
            }
            Err(error)
        }
    }
}

/// Copia material externo dentro de una carpeta de entrega.
///
/// La cola por carpeta trabaja con archivos que no pertenecen a ningún
/// proyecto. El render resuelve las rutas **dentro** de la raíz del proyecto,
/// así que primero se copian a `media/` y el proyecto apunta a la ruta relativa.
pub fn copy_media_files(
    directory: &str,
    paths: &[String],
) -> Result<Vec<CopiedMedia>, ProjectError> {
    let root = prepare_directory(directory, "no se pudo crear la carpeta media de la entrega")?;
    let media = root.join("media");
    std::fs::create_dir_all(&media).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta media de la entrega",
        )
    })?;
    let mut copied = Vec::new();
    for path in paths {
        // Cada archivo llega por IPC: política de lectura de `fs_*`.
        let source = crate::application::fs::resolve_user_file_path(path)?;
        if !source.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "uno de los archivos de la carpeta no existe",
            ));
        }
        let stem = source
            .file_stem()
            .map(|value| safe_stem(&value.to_string_lossy()))
            .unwrap_or_else(|| "media".to_owned());
        let extension = source
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| "mp4".to_owned());
        let mut candidate = media.join(format!("{stem}.{extension}"));
        let mut index = 2;
        while candidate.exists() {
            candidate = media.join(format!("{stem}-{index}.{extension}"));
            index += 1;
        }
        std::fs::copy(&source, &candidate).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo copiar uno de los archivos a la entrega",
            )
        })?;
        // AUD-135: hashear el destino verifica que la copia quedó íntegra y
        // entrega el digest real que el proyecto declara en `integrity`.
        let (sha256, hashed_bytes) = crate::media::sha256_file(&candidate).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo calcular el hash del material copiado",
            )
        })?;
        let relative = candidate
            .strip_prefix(&root)
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| candidate.to_string_lossy().to_string());
        copied.push(CopiedMedia {
            source: path.clone(),
            relative_path: relative,
            bytes: hashed_bytes,
            sha256,
        });
    }
    Ok(copied)
}

/// Escribe un proyecto en una carpeta **sin** exigir una sesión abierta.
///
/// `write_project_variant` espeja assets desde la raíz de la sesión; para la
/// cola por carpeta el material ya está copiado al lado del proyecto, así que
/// sólo hace falta validar y escribir.
pub fn write_project_document(
    directory: &str,
    file_name: &str,
    project: &Value,
) -> Result<VariantWritten, ProjectError> {
    let root = prepare_directory(directory, "no se pudo crear la carpeta de entrega")?;
    let target = root.join(variant_file_name(file_name));
    // AUD-136: sin este chequeo, dos proyectos que sanitizan al mismo nombre
    // se pisaban en silencio (y la limpieza de la cola podía borrar el JSON
    // de la entrega anterior). Mismo criterio que `write_project_variant_file`.
    if target.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un proyecto con ese nombre; no se sobrescribió",
        ));
    }
    let saved = service::save_project(&target, project)?;
    Ok(VariantWritten {
        path: saved.path,
        bytes: saved.bytes,
        copied_assets: 0,
    })
}

#[cfg(test)]
#[path = "variants.tests.rs"]
mod tests;
