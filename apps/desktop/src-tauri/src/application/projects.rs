//! Casos de uso del ciclo de vida del proyecto.
//!
//! Reglas que vivían en el adaptador IPC y ahora son del caso de uso:
//! - La sesión nativa sólo se compromete tras `adopt_project` (la webview ya
//!   validó el documento con el esquema canónico); hasta entonces un open
//!   fallido no puede redirigir el próximo guardado.
//! - "Guardar como" copia los assets al nuevo root y los elimina si el
//!   guardado falla (rollback).
//! - El id del proyecto en pantalla debe coincidir con el de la sesión
//!   nativa antes de guardar.
//! - Todo render pertenece al proyecto que lo pidió: adoptar otra sesión
//!   cancela los jobs activos.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::ports::projects::{
    DuplicateAssetGroup, MissingAssetInfo, ProjectAssetFiles, ProjectAssetRecovery,
    ProjectDocuments, ProjectEnvironment, ProjectSession, ProjectSessionInfo, ProjectVersionInfo,
    ProjectVersioning, RelinkFolderRejected, RelinkFolderResult, RelinkResult,
    RestoreProjectVersionResult,
};
use crate::projects::service::{OpenedProject, ProjectError, ProjectErrorCode};

/// Vista del proyecto abierto, ya descrita para la interfaz (path, root y
/// label son datos de presentación del caso de uso, no del DTO IPC).
#[derive(Debug, Clone)]
pub struct OpenedProjectView {
    pub project: Value,
    pub path: String,
    pub root: String,
    pub label: String,
}

impl From<OpenedProject> for OpenedProjectView {
    fn from(opened: OpenedProject) -> Self {
        let path = PathBuf::from(&opened.path);
        let root = path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .unwrap_or_default();
        let label = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| {
                opened.project["name"]
                    .as_str()
                    .unwrap_or("proyecto")
                    .to_owned()
            });
        Self {
            project: opened.project,
            path: opened.path,
            root,
            label,
        }
    }
}

pub(crate) fn safe_file_stem(name: &str) -> String {
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
        "proyecto".to_owned()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// Keep an explicit `.json` name exactly as the save dialog confirmed it. Only
/// a name without a JSON extension is completed, and that completion is
/// checked for collisions before writing.
pub(crate) fn ensure_extension(path: PathBuf) -> PathBuf {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with(".json") {
        return path;
    }
    PathBuf::from(format!("{}.editoria.json", path.to_string_lossy()))
}

/// Completa la extensión elegida en el diálogo y rechaza la colisión que la
/// completación automática podría crear.
fn complete_save_path(
    environment: &dyn ProjectEnvironment,
    picked: PathBuf,
) -> Result<PathBuf, ProjectError> {
    let completed = ensure_extension(picked.clone());
    if completed != picked && environment.path_exists(&completed) {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un proyecto con el nombre completo que se agregó automáticamente; elegí otro nombre",
        ));
    }
    Ok(completed)
}

fn pick_save_path(
    environment: &dyn ProjectEnvironment,
    default_name: &str,
) -> Result<Option<PathBuf>, ProjectError> {
    environment
        .pick_save_path(default_name)?
        .map(|picked| complete_save_path(environment, picked))
        .transpose()
}

/// Valida, expone los medios por asset protocol y describe el proyecto sin
/// tocar la sesión nativa.
fn describe(
    environment: &dyn ProjectEnvironment,
    opened: OpenedProject,
) -> Result<OpenedProjectView, ProjectError> {
    let view = OpenedProjectView::from(opened);
    environment.allow_media_root(Path::new(&view.root))?;
    Ok(view)
}

fn describe_at(
    environment: &dyn ProjectEnvironment,
    documents: &dyn ProjectDocuments,
    path: &Path,
) -> Result<OpenedProjectView, ProjectError> {
    describe(environment, documents.open(path)?)
}

/// Compromete el proyecto validado a la sesión nativa.
fn adopt(
    session: &dyn ProjectSession,
    view: OpenedProjectView,
) -> Result<OpenedProjectView, ProjectError> {
    let project_id = view
        .project
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    session.adopt(&ProjectSessionInfo {
        path: PathBuf::from(&view.path),
        root: PathBuf::from(&view.root),
        project_id,
    })?;
    Ok(view)
}

fn open_and_adopt(
    documents: &dyn ProjectDocuments,
    environment: &dyn ProjectEnvironment,
    session: &dyn ProjectSession,
    path: &Path,
) -> Result<OpenedProjectView, ProjectError> {
    let view = describe_at(environment, documents, path)?;
    adopt(session, view)
}

fn ensure_session_project(
    session: &ProjectSessionInfo,
    project: &Value,
) -> Result<(), ProjectError> {
    let project_id = project
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if project_id != session.project_id {
        return Err(ProjectError::message(
            ProjectErrorCode::SessionMismatch,
            "el proyecto de la pantalla no coincide con la sesión nativa; volvé a abrirlo antes de guardar",
        ));
    }
    Ok(())
}

/// Crea un proyecto con el nombre dado y, opcionalmente, un video inicial.
/// Devuelve `None` si la persona cancela el diálogo de guardado.
pub fn create_project(
    documents: &dyn ProjectDocuments,
    environment: &dyn ProjectEnvironment,
    name: &str,
    video: Option<Value>,
) -> Result<Option<OpenedProjectView>, ProjectError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto necesita un nombre",
        ));
    }
    let default_name = format!("{}.editoria.json", safe_file_stem(trimmed));
    let Some(path) = pick_save_path(environment, &default_name)? else {
        return Ok(None);
    };
    let opened = documents.create_with_video(&path, trimmed, video)?;
    describe(environment, opened).map(Some)
}

/// Abre el proyecto que elija la persona en el diálogo, sin adoptarlo.
pub fn open_project(
    documents: &dyn ProjectDocuments,
    environment: &dyn ProjectEnvironment,
) -> Result<Option<OpenedProjectView>, ProjectError> {
    let Some(path) = environment.pick_open_path() else {
        return Ok(None);
    };
    let opened = documents.open(&path)?;
    describe(environment, opened).map(Some)
}

/// Abre una ruta concreta (deep link / adopción desde la UI) sin sesión.
pub fn open_project_at(
    documents: &dyn ProjectDocuments,
    environment: &dyn ProjectEnvironment,
    path: &Path,
) -> Result<OpenedProjectView, ProjectError> {
    describe_at(environment, documents, path)
}

/// Abre una ruta concreta y la compromete a la sesión nativa.
pub fn adopt_project(
    documents: &dyn ProjectDocuments,
    environment: &dyn ProjectEnvironment,
    session: &dyn ProjectSession,
    path: &Path,
) -> Result<OpenedProjectView, ProjectError> {
    open_and_adopt(documents, environment, session, path)
}

/// Guarda el documento en la ruta de la sesión actual.
pub fn save_project(
    documents: &dyn ProjectDocuments,
    session: &dyn ProjectSession,
    versioning: &dyn ProjectVersioning,
    project: Value,
) -> Result<OpenedProjectView, ProjectError> {
    let current = session.require()?;
    ensure_session_project(&current, &project)?;
    // Historial: snapshot antes de pisar (autosave con throttle de 60 s).
    versioning.snapshot_before_save(&current.path, "autosave");
    let saved = documents.save(&current.path, &project)?;
    Ok(OpenedProjectView::from(OpenedProject {
        project,
        path: saved.path,
    }))
}

/// Guarda el documento en una ruta nueva: copia los assets al nuevo root y,
/// si el guardado falla, elimina las copias para no dejar basura.
pub fn save_project_as(
    documents: &dyn ProjectDocuments,
    environment: &dyn ProjectEnvironment,
    session: &dyn ProjectSession,
    asset_files: &dyn ProjectAssetFiles,
    project: &Value,
) -> Result<Option<OpenedProjectView>, ProjectError> {
    let current = session.require()?;
    ensure_session_project(&current, project)?;
    let name = project["name"].as_str().unwrap_or("proyecto");
    let default_name = format!("{}.editoria.json", safe_file_stem(name));
    let Some(path) = pick_save_path(environment, &default_name)? else {
        return Ok(None);
    };

    let old_root = current.root.clone();
    let new_root = path.parent().map(PathBuf::from).ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "el destino no tiene carpeta")
    })?;
    let copied = if old_root.canonicalize().ok() == new_root.canonicalize().ok() {
        Vec::new()
    } else {
        asset_files.copy_project_assets(project, &old_root, &new_root)?
    };

    match documents.save(&path, project) {
        Ok(_) => open_and_adopt(documents, environment, session, &path).map(Some),
        Err(error) => {
            asset_files.remove_files(&copied);
            Err(error)
        }
    }
}

/// Cierra el proyecto: cancela sus renders y limpia la sesión.
pub fn close_project(session: &dyn ProjectSession) -> Result<(), ProjectError> {
    session.clear()
}

/// Resuelve el proyecto pedido explícitamente o el de la sesión nativa.
fn resolve_project_file(
    session: &dyn ProjectSession,
    environment: &dyn ProjectEnvironment,
    project_path: Option<&str>,
) -> Result<PathBuf, ProjectError> {
    if let Some(raw) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(raw);
        if !environment.path_exists(&path) {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el proyecto indicado no está en disco",
            ));
        }
        return Ok(path);
    }
    Ok(session.require()?.path)
}

/// Versiones del proyecto pedido o del abierto en sesión.
pub fn list_project_versions(
    session: &dyn ProjectSession,
    environment: &dyn ProjectEnvironment,
    versioning: &dyn ProjectVersioning,
    project_path: Option<&str>,
) -> Result<Vec<ProjectVersionInfo>, ProjectError> {
    let path = resolve_project_file(session, environment, project_path)?;
    Ok(versioning.list_versions(&path))
}

/// Restaura una versión sobre una ruta concreta de proyecto.
pub fn restore_project_version(
    versioning: &dyn ProjectVersioning,
    project_path: &str,
    version_id: &str,
    mode: Option<&str>,
) -> Result<RestoreProjectVersionResult, ProjectError> {
    versioning.restore_version(
        Path::new(project_path.trim()),
        version_id,
        mode == Some("copy"),
    )
}

// ---------------------------------------------------------------------------
// Recuperación de assets (relink / missing / duplicados)
// ---------------------------------------------------------------------------

/// Proyecto pedido explícitamente o el de la sesión, con su raíz en disco.
fn resolve_project_location(
    session: &dyn ProjectSession,
    environment: &dyn ProjectEnvironment,
    project_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), ProjectError> {
    if let Some(raw) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(raw);
        let root = path.parent().map(Path::to_path_buf).ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::Io, "ruta de proyecto inválida")
        })?;
        if !environment.path_exists(&path) {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el proyecto indicado no está en disco",
            ));
        }
        return Ok((path, root));
    }
    let info = session.require()?;
    Ok((info.path, info.root))
}

/// Bytes declarados del asset en `integrity`/`source`/`sizeBytes`.
fn asset_expected_bytes(project: &Value, asset_id: &str) -> Option<u64> {
    project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id))
        })
        .and_then(|asset| {
            asset["integrity"]["bytes"]
                .as_u64()
                .or_else(|| asset["source"]["bytes"].as_u64())
                .or_else(|| asset["sizeBytes"].as_u64())
        })
}

/// Nombre de archivo registrado en la ruta relativa del asset.
fn repository_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// El candidato debe llamarse igual y, si el proyecto declara bytes, medir
/// exactamente eso.
fn file_matches(
    recovery: &dyn ProjectAssetRecovery,
    file: &Path,
    name: &str,
    expected_bytes: Option<u64>,
) -> bool {
    let Some(file_name) = file.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if file_name != name {
        return false;
    }
    match expected_bytes {
        Some(expected) => recovery.file_size(file) == Some(expected),
        None => true,
    }
}

/// Assets del proyecto (explícito o en sesión) que no están en disco.
pub fn find_missing_assets(
    session: &dyn ProjectSession,
    environment: &dyn ProjectEnvironment,
    documents: &dyn ProjectDocuments,
    recovery: &dyn ProjectAssetRecovery,
    project_path: Option<&str>,
) -> Result<Vec<MissingAssetInfo>, ProjectError> {
    let (path, root) = resolve_project_location(session, environment, project_path)?;
    let opened = documents.open(&path)?;
    Ok(recovery.missing_assets(&opened.project, &root))
}

/// Reapunta un asset del proyecto abierto en sesión y guarda si salió bien.
pub fn relink_asset(
    session: &dyn ProjectSession,
    documents: &dyn ProjectDocuments,
    recovery: &dyn ProjectAssetRecovery,
    asset_id: &str,
    new_path: &str,
) -> Result<RelinkResult, ProjectError> {
    let info = session.require()?;
    let mut opened = documents.open(&info.path)?;
    let raw = PathBuf::from(new_path.trim());
    let source = if raw.is_absolute() {
        raw
    } else {
        info.root.join(raw)
    };
    let result = recovery.relink_asset(&mut opened.project, &info.root, asset_id, &source)?;
    if result.ok {
        documents.save(&info.path, &opened.project)?;
    }
    Ok(result)
}

/// Relink masivo desde una carpeta: matchea por nombre+tamaño, repunta los
/// inequívocos y guarda una sola vez si algo se relinkeó.
pub fn relink_assets_from_folder(
    session: &dyn ProjectSession,
    environment: &dyn ProjectEnvironment,
    documents: &dyn ProjectDocuments,
    recovery: &dyn ProjectAssetRecovery,
    project_path: Option<&str>,
    folder: &str,
) -> Result<RelinkFolderResult, ProjectError> {
    let (path, root) = resolve_project_location(session, environment, project_path)?;
    let mut opened = documents.open(&path)?;
    let directory = PathBuf::from(folder.trim());
    let files = recovery.scan_source_folder(&directory)?;
    let missing = recovery.missing_assets(&opened.project, &root);
    let mut relinked = Vec::new();
    let mut rejected = Vec::new();
    let mut still_missing = Vec::new();
    for item in missing {
        let expected = asset_expected_bytes(&opened.project, &item.asset_id);
        let name = repository_name(&item.path);
        let candidates: Vec<&PathBuf> = files
            .iter()
            .filter(|file| file_matches(recovery, file, name, expected))
            .collect();
        if candidates.is_empty() {
            still_missing.push(item);
            continue;
        }
        if candidates.len() > 1 {
            rejected.push(RelinkFolderRejected {
                path: item.path.clone(),
                reason: "hay más de un archivo con ese nombre (y tamaño) en la carpeta".to_owned(),
            });
            still_missing.push(item);
            continue;
        }
        match recovery.relink_asset(&mut opened.project, &root, &item.asset_id, candidates[0]) {
            Ok(result) if result.ok => relinked.push(result),
            Ok(result) => {
                rejected.push(RelinkFolderRejected {
                    path: item.path.clone(),
                    reason: result
                        .reason
                        .unwrap_or_else(|| "no se pudo repuntar".to_owned()),
                });
                still_missing.push(item);
            }
            Err(error) => {
                rejected.push(RelinkFolderRejected {
                    path: item.path.clone(),
                    reason: error.message,
                });
                still_missing.push(item);
            }
        }
    }
    if !relinked.is_empty() {
        documents.save(&path, &opened.project)?;
    }
    Ok(RelinkFolderResult {
        relinked,
        still_missing,
        rejected,
    })
}

/// Assets del proyecto con contenido duplicado (mismo hash y tamaño).
pub fn find_duplicate_assets(
    session: &dyn ProjectSession,
    environment: &dyn ProjectEnvironment,
    documents: &dyn ProjectDocuments,
    recovery: &dyn ProjectAssetRecovery,
    project_path: Option<&str>,
) -> Result<Vec<DuplicateAssetGroup>, ProjectError> {
    let (path, root) = resolve_project_location(session, environment, project_path)?;
    let opened = documents.open(&path)?;
    Ok(recovery.duplicate_groups(&opened.project, &root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_is_safe_and_bounded() {
        assert_eq!(
            safe_file_stem("  Mi Obra: capítulo 1/2  "),
            "mi-obra-captulo-1-2"
        );
        assert_eq!(safe_file_stem("///"), "proyecto");
        assert_eq!(safe_file_stem("a".repeat(200).as_str()).chars().count(), 80);
    }

    #[test]
    fn explicit_json_names_are_kept_and_missing_extensions_are_completed() {
        assert_eq!(
            ensure_extension(PathBuf::from("C:/obra.editoria.json")),
            PathBuf::from("C:/obra.editoria.json")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("C:/obra.json")),
            PathBuf::from("C:/obra.json")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("C:/obra")),
            PathBuf::from("C:/obra.editoria.json")
        );
    }

    #[test]
    fn session_identity_must_match_the_payload() {
        let session = ProjectSessionInfo {
            path: PathBuf::from("C:/proyectos/obra.json"),
            root: PathBuf::from("C:/proyectos"),
            project_id: "60606060-6060-4606-8606-606060606060".to_owned(),
        };
        let mut project = serde_json::json!({
            "id": "60606060-6060-4606-8606-606060606060"
        });
        assert!(ensure_session_project(&session, &project).is_ok());
        project["id"] = serde_json::json!("70707070-7070-4707-8707-707070707070");
        let error = ensure_session_project(&session, &project).unwrap_err();
        assert_eq!(error.code, ProjectErrorCode::SessionMismatch);
    }
}
