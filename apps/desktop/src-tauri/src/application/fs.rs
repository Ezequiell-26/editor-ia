//! Exploración, lectura y escritura de archivos del disco — caso de uso.
//!
//! `fs_list`/`fs_read` muestran el contenido de carpetas y archivos (la IA
//! *ve* la PC); `fs_write`/`fs_mkdir`/`fs_delete` le dan poder de escritura
//! real: crear scripts, subtítulos, JSON de proyecto, mover material de
//! trabajo — cualquier archivo que el token MCP autorice.
//!
//! Límites deliberados: escritura de texto hasta `FS_WRITE_MAX_BYTES`,
//! `fs_delete` exige `recursive` explícito para carpetas y rechaza rutas
//! protegidas (raíz de unidad, perfil de usuario, Windows). Nunca se
//! ejecuta el contenido escrito.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Tope de entradas por listado: suficiente para cualquier carpeta real y
/// acota el JSON que viaja por IPC.
const FS_LIST_MAX_ENTRIES: usize = 500;
/// Tope de lectura: alcanza para subtítulos, proyectos `.editoria.json` y
/// cualquier texto de trabajo; un binario grande no entra por esta puerta.
const FS_READ_MAX_BYTES: u64 = 512 * 1024;
/// Tope de escritura: alcanza para scripts, subtítulos, JSON y texto de
/// trabajo; no para volcar videos/binarios por esta puerta.
const FS_WRITE_MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    /// `dir`, `image`, `audio`, `video`, `subtitle`, `text` u `other`.
    pub kind: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListing {
    pub directory: String,
    pub entries: Vec<FsEntry>,
    /// `true` cuando la carpeta tiene más entradas que el tope.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsFileContent {
    pub path: String,
    pub bytes: u64,
    /// `true` cuando el archivo superaba el tope y el contenido viene cortado.
    pub truncated: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteResult {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDeleteResult {
    pub path: String,
    /// `true` cuando se borró una carpeta con todo su contenido.
    pub recursive: bool,
}

const FS_IMAGE_EXTENSIONS: [&str; 9] = [
    "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "tif",
];
const FS_AUDIO_EXTENSIONS: [&str; 7] = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"];
const FS_VIDEO_EXTENSIONS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mts"];
const FS_SUBTITLE_EXTENSIONS: [&str; 4] = ["srt", "vtt", "ass", "ssa"];
const FS_TEXT_EXTENSIONS: [&str; 16] = [
    "txt", "md", "json", "jsonl", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "log",
    "editoria", "fcpxml", "otio", "edl",
];

fn fs_kind(path: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "dir";
    }
    let Some(extension) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return "other";
    };
    if FS_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        "image"
    } else if FS_AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        "audio"
    } else if FS_VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        "video"
    } else if FS_SUBTITLE_EXTENSIONS.contains(&extension.as_str()) {
        "subtitle"
    } else if FS_TEXT_EXTENSIONS.contains(&extension.as_str()) {
        "text"
    } else {
        "other"
    }
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Lista el contenido de una carpeta: primero las subcarpetas, después los
/// archivos, ordenados por nombre. No recursa: la IA baja nivel por nivel.
pub fn fs_list(path: String) -> Result<FsListing, ProjectError> {
    let directory = PathBuf::from(path.trim());
    if sensitive_component(&directory) || inside_app_owned_dir(&directory) {
        return Err(invalid(
            "esa ruta contiene credenciales y no se puede listar",
        ));
    }
    if !directory.is_dir() {
        return Err(invalid("la ruta no es una carpeta existente"));
    }
    let read = std::fs::read_dir(&directory).map_err(|_| invalid("no se pudo leer la carpeta"))?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut truncated = false;
    for entry in read.flatten() {
        if dirs.len() + files.len() >= FS_LIST_MAX_ENTRIES {
            truncated = true;
            break;
        }
        let entry_path = entry.path();
        let is_dir = entry_path.is_dir();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() {
            continue;
        }
        let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        let item = FsEntry {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            kind: fs_kind(&entry_path, is_dir).to_owned(),
            bytes,
        };
        if is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }
    let sort = |a: &FsEntry, b: &FsEntry| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(sort);
    files.sort_by(sort);
    dirs.extend(files);
    Ok(FsListing {
        directory: directory.to_string_lossy().into_owned(),
        entries: dirs,
        truncated,
    })
}

/// Lee un archivo de texto hasta `FS_READ_MAX_BYTES`. Rechaza carpetas y
/// archivos que no se pueden abrir; nunca ejecuta ni interpreta el contenido.
pub fn fs_read(path: String) -> Result<FsFileContent, ProjectError> {
    let file = PathBuf::from(path.trim());
    if sensitive_component(&file) || app_secret_file(&file) {
        return Err(invalid("esa ruta contiene credenciales y no se puede leer"));
    }
    if !file.is_file() {
        return Err(invalid("la ruta no es un archivo existente"));
    }
    let bytes = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let truncated = bytes > FS_READ_MAX_BYTES;
    let read = std::fs::File::open(&file).map_err(|_| invalid("no se pudo abrir el archivo"))?;
    use std::io::Read;
    let mut buffer = Vec::new();
    read.take(FS_READ_MAX_BYTES)
        .read_to_end(&mut buffer)
        .map_err(|_| invalid("no se pudo leer el archivo"))?;
    Ok(FsFileContent {
        path: file.to_string_lossy().into_owned(),
        bytes,
        truncated,
        content: String::from_utf8_lossy(&buffer).into_owned(),
    })
}

/// Normaliza una ruta para comparar: minúsculas y separador `\`.
fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

/// Resuelve `.` y `..` léxicamente para que las rutas de chequeo no se
/// puedan evadir con traversal (`C:\Users\x\..\Windows\...`).
fn normalized_components(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Canonicaliza el ancestro existente más cercano y re-acopla los
/// segmentos que aún no existen. Resuelve junctions/symlinks intermedios
/// (un junction dentro del perfil que apunte a `C:\Windows` ya no evade
/// los chequeos) y devuelve la ruta lista para comparar.
fn resolved_for_check(path: &Path) -> PathBuf {
    let normalized = normalized_components(path);
    let mut cursor = normalized.clone();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    while !cursor.exists() {
        match cursor.file_name() {
            Some(name) => {
                missing.push(name.to_os_string());
                if !cursor.pop() {
                    break;
                }
            }
            None => break,
        }
    }
    let mut base = cursor.canonicalize().unwrap_or_else(|_| cursor.clone());
    // canonicalize en Windows devuelve prefijos \\?\ que romperían las
    // comparaciones de texto contra las raíces de sistema.
    let text = base.to_string_lossy().into_owned();
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        base = PathBuf::from(stripped);
    }
    for part in missing.iter().rev() {
        base.push(part);
    }
    normalized_components(&base)
}

/// `true` si `text` es igual a `root` o está dentro de él.
fn path_within(text: &str, root: &str) -> bool {
    text == root || text.starts_with(&format!("{root}\\"))
}

/// Raíces de sistema derivadas del entorno de la máquina (no hardcodeadas a
/// `C:`): Windows, los Program Files y carpetas críticas de ProgramData.
fn system_roots() -> Vec<String> {
    let mut roots: Vec<String> = [
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "CommonProgramFiles",
        "CommonProgramFiles(x86)",
    ]
    .iter()
    .filter_map(|var| std::env::var(var).ok())
    .map(|value| path_key(Path::new(&value)))
    .filter(|value| !value.is_empty())
    .collect();
    roots.push("c:\\programdata\\microsoft".to_owned());
    roots.push("c:\\users\\public".to_owned());
    roots
}

/// Carpetas del sistema donde ni escritura, ni borrado, ni movimiento deben
/// llegar: incluyen todo lo que esté DENTRO de ellas (no sólo la raíz).
fn inside_system_dir(path: &Path) -> bool {
    let resolved = resolved_for_check(path);
    let text = path_key(&resolved);
    system_roots().iter().any(|root| path_within(&text, root))
}

/// Raíces que `fs_delete`/`fs_move` jamás tocan: unidades, el perfil del
/// usuario completo, Windows y los Program Files. La escritura
/// (`fs_write`/`fs_mkdir`) sí puede crear dentro del perfil — es el trabajo
/// normal de la IA — pero nunca dentro de las carpetas de sistema.
fn protected_delete_target(path: &Path) -> bool {
    let resolved = resolved_for_check(path);
    let path = resolved.as_path();
    if path.parent().is_none() {
        return true;
    }
    let text = path_key(path);
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let profile_key = path_key(Path::new(&profile));
        if !profile_key.is_empty() && text == profile_key {
            return true;
        }
    }
    inside_system_dir(path)
}

/// Componentes de ruta que jamás deben tocar los comandos fs_*: claves
/// privadas, stores de nube/k8s/docker, credenciales git/npm y bases de
/// credenciales del navegador. Un agente prompt-inyectado podría leer
/// `id_rsa` y exfiltrarlo, o escribir `authorized_keys` en `.ssh`.
const SENSITIVE_COMPONENTS: &[&str] = &[
    ".ssh",
    ".aws",
    ".azure",
    ".gnupg",
    ".kube",
    ".docker",
    ".git-credentials",
    ".netrc",
    ".pypirc",
    ".npmrc",
    "login data",
    "cookies",
    "web data",
    "key4.db",
    "key3.db",
    "cert9.db",
    "logins.json",
    "signons.sqlite",
];

/// `true` si la ruta (resuelta) contiene algún componente sensible.
fn sensitive_component(path: &Path) -> bool {
    resolved_for_check(path).components().any(|comp| {
        matches!(comp, std::path::Component::Normal(name) if {
            let lowered = name.to_string_lossy().to_lowercase();
            SENSITIVE_COMPONENTS.contains(&lowered.as_str())
        })
    })
}

/// Nombre de la carpeta de datos de la app en disco. Los comandos `fs_*`
/// viven en un módulo puro (sin `AppState`), así que se deriva del entorno
/// igual que `system_roots()`: `%APPDATA%\com.editoria.desktop` en Windows
/// y `$XDG_CONFIG_HOME/com.editoria.desktop` en Unix.
const APP_DATA_DIR_NAME: &str = "com.editoria.desktop";

/// Carpetas que pertenecen a la app: su config dir y su cache dir. Un
/// agente prompt-inyectado que pueda escribir ahí podría (a) reemplazar
/// `settings.json` y apuntar `ffmpegPath` a un binario arbitrario — que la
/// app luego ejecuta —, (b) inyectar servidores MCP con un `command` malicioso
/// en `mcp-servers.json`, o (c) leer `downloader-bridge.token` y usar el
/// puente local desde fuera. Ninguna de esas acciones es "escribir un
/// archivo para el usuario", así que quedan fuera del alcance de `fs_*`.
fn app_owned_dirs() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        if !appdata.trim().is_empty() {
            roots.push(PathBuf::from(appdata).join(APP_DATA_DIR_NAME));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.trim().is_empty() {
            roots.push(PathBuf::from(local).join(APP_DATA_DIR_NAME));
        }
    }
    if let Ok(xdg_config) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg_config.trim().is_empty() {
            roots.push(PathBuf::from(xdg_config).join(APP_DATA_DIR_NAME));
        }
    }
    if let Ok(xdg_cache) = std::env::var("XDG_CACHE_HOME") {
        if !xdg_cache.trim().is_empty() {
            roots.push(PathBuf::from(xdg_cache).join(APP_DATA_DIR_NAME));
        }
    }
    roots
}

/// `true` si la ruta está dentro de una carpeta propiedad de la app.
fn inside_app_owned_dir(path: &Path) -> bool {
    let text = path_key(&resolved_for_check(path));
    app_owned_dirs().iter().any(|root| {
        let key = path_key(root);
        !key.is_empty() && path_within(&text, &key)
    })
}

/// Archivos de la app que guardan secretos de sesión y que nunca deben
/// salir por `fs_read`/`fs_list`.
const APP_SECRET_FILES: &[&str] = &["downloader-bridge.token", "mcp-servers.json"];

/// `true` si la ruta apunta a un archivo de secreto de la app.
fn app_secret_file(path: &Path) -> bool {
    resolved_for_check(path)
        .file_name()
        .map(|name| {
            let lowered = name.to_string_lossy().to_lowercase();
            APP_SECRET_FILES.contains(&lowered.as_str())
        })
        .unwrap_or(false)
}

fn normalize_target(raw: &str) -> Result<PathBuf, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid("la ruta está vacía"));
    }
    let path = PathBuf::from(trimmed);
    if path.as_os_str().is_empty() {
        return Err(invalid("la ruta está vacía"));
    }
    Ok(path)
}

// ---------------------------------------------------------------------------
// Política de rutas de usuario para comandos IPC de archivos sueltos
// ---------------------------------------------------------------------------
//
// Los comandos que procesan un archivo del disco elegido por la persona
// (file picker, cola de carpeta, salida de un render, herramienta MCP) no
// pueden exigir que viva dentro del proyecto — el material de trabajo está
// en descargas, exportaciones y carpetas externas. La política uniforme es
// la misma que ya aplica `fs_*`:
//
// - `resolve_user_file_path`: entrada para leer/procesar. Exige ruta
//   absoluta (una relativa en IPC se resolvería contra el cwd del proceso,
//   ambiguo y evadible), normaliza `.`/`..`, canonicaliza el ancestro
//   existente más cercano (los junctions/symlinks intermedios no evaden el
//   chequeo) y rechaza componentes sensibles (`.ssh`, `.aws`, `.gnupg`,
//   `.kube`, `.docker`, `.netrc`, `.npmrc`, stores de credenciales del
//   navegador) y los archivos de secreto de la app (`downloader-bridge.
//   token`, `mcp-servers.json`). Es la política de lectura de `fs_read`:
//   cualquier carpeta del usuario sirve, menos las de credenciales. No
//   exige que el archivo exista: cada comando conserva su `is_file` y su
//   mensaje de error.
// - `validate_user_write_path`: destino que el comando va a crear o
//   sobrescribir (carpeta de salida, `.ass`/`.mp4` de entrega). Además de
//   lo anterior, rechaza carpetas de sistema y las carpetas propiedad de
//   la app — la misma regla que `fs_write`/`fs_mkdir`.
//
// Los comandos que trabajan con assets del proyecto siguen usando
// `media::resolve_inside_root` (rutas relativas dentro del root); esta
// política es sólo para rutas absolutas de archivos del usuario.

/// Normaliza una ruta de IPC: no vacía y absoluta. El resto de la política
/// la deciden los dos puntos de entrada de abajo.
fn user_path(raw: &str) -> Result<PathBuf, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid("la ruta está vacía"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(invalid("la ruta tiene que ser absoluta"));
    }
    Ok(path)
}

/// Entrada de usuario para leer/procesar: política de lectura de `fs_*`.
/// Devuelve la ruta resuelta (sin `\\?\`, con symlinks/junctions del
/// ancestro existente ya canonicalizados) lista para abrir o pasar a
/// FFmpeg/Python.
pub fn resolve_user_file_path(raw: &str) -> Result<PathBuf, ProjectError> {
    let path = user_path(raw)?;
    let resolved = resolved_for_check(&path);
    if sensitive_component(&resolved) || app_secret_file(&resolved) {
        return Err(invalid(
            "esa ruta contiene credenciales y no se puede procesar",
        ));
    }
    Ok(resolved)
}

/// Salida de usuario que el comando va a escribir: política de escritura
/// de `fs_*` (sistema, credenciales y carpetas de la app vedadas).
pub fn validate_user_write_path(raw: &str) -> Result<PathBuf, ProjectError> {
    let path = user_path(raw)?;
    let resolved = resolved_for_check(&path);
    if inside_system_dir(&resolved)
        || sensitive_component(&resolved)
        || inside_app_owned_dir(&resolved)
        || app_secret_file(&resolved)
    {
        return Err(invalid("esa ruta está protegida y no se puede escribir"));
    }
    Ok(resolved)
}

/// Escribe texto en un archivo creándolo si no existe (y sus carpetas
/// padre). Sirve para guiones, subtítulos, JSON, configs — lo que la IA
/// necesite dejar en disco.
pub fn fs_write(path: String, content: String) -> Result<FsWriteResult, ProjectError> {
    let target = normalize_target(&path)?;
    if inside_system_dir(&target) || sensitive_component(&target) || inside_app_owned_dir(&target) {
        return Err(invalid("esa ruta está protegida y no se puede escribir"));
    }
    if content.len() > FS_WRITE_MAX_BYTES {
        return Err(invalid("el contenido supera el tope de escritura (10 MiB)"));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|_| invalid("no se pudieron crear las carpetas padre"))?;
        }
    }
    // Escritura atómica (temp oculto en el mismo dir + rename): un corte a
    // mitad nunca deja el archivo destino truncado — misma convención que
    // el resto de persistencia del crate (AUD-148).
    let tmp = target.with_file_name(format!(
        ".{}.tmp-{}",
        target
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        uuid::Uuid::new_v4()
    ));
    let write_result =
        std::fs::write(&tmp, content.as_bytes()).and_then(|()| std::fs::rename(&tmp, &target));
    if write_result.is_err() {
        let _ = std::fs::remove_file(&tmp);
        return Err(invalid("no se pudo escribir el archivo"));
    }
    let bytes = target
        .metadata()
        .map(|meta| meta.len())
        .unwrap_or(content.len() as u64);
    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes,
    })
}

/// Crea una carpeta (con padres si `recursive`, por defecto true).
pub fn fs_mkdir(path: String, recursive: Option<bool>) -> Result<FsWriteResult, ProjectError> {
    let target = normalize_target(&path)?;
    if inside_system_dir(&target) || sensitive_component(&target) || inside_app_owned_dir(&target) {
        return Err(invalid("esa ruta está protegida y no se puede crear"));
    }
    let recursive = recursive.unwrap_or(true);
    if recursive {
        std::fs::create_dir_all(&target).map_err(|_| invalid("no se pudo crear la carpeta"))?;
    } else {
        std::fs::create_dir(&target).map_err(|_| invalid("no se pudo crear la carpeta"))?;
    }
    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes: 0,
    })
}

/// Borra un archivo, o una carpeta vacía; para carpetas con contenido hay
/// que pasar `recursive: true` explícitamente. Rechaza rutas protegidas.
pub fn fs_delete(path: String, recursive: Option<bool>) -> Result<FsDeleteResult, ProjectError> {
    let target = normalize_target(&path)?;
    if protected_delete_target(&target)
        || sensitive_component(&target)
        || inside_app_owned_dir(&target)
    {
        return Err(invalid("esa ruta está protegida y no se puede borrar"));
    }
    let recursive = recursive.unwrap_or(false);
    if target.is_dir() {
        if recursive {
            std::fs::remove_dir_all(&target)
                .map_err(|_| invalid("no se pudo borrar la carpeta"))?;
        } else {
            std::fs::remove_dir(&target)
                .map_err(|_| invalid("la carpeta no está vacía: usá recursive=true"))?;
        }
    } else if target.exists() {
        std::fs::remove_file(&target).map_err(|_| invalid("no se pudo borrar el archivo"))?;
    } else {
        return Err(invalid("la ruta no existe"));
    }
    Ok(FsDeleteResult {
        path: target.to_string_lossy().into_owned(),
        recursive,
    })
}

/// Mueve o renombra un archivo/carpeta. El destino puede estar en otra
/// carpeta; si existe, falla (no se sobrescribe sin querer).
pub fn fs_move(from: String, to: String) -> Result<FsWriteResult, ProjectError> {
    let source = normalize_target(&from)?;
    let target = normalize_target(&to)?;
    if protected_delete_target(&source)
        || sensitive_component(&source)
        || inside_app_owned_dir(&source)
        || app_secret_file(&source)
    {
        return Err(invalid(
            "el origen es una ruta protegida y no se puede mover",
        ));
    }
    if !source.exists() {
        return Err(invalid("el origen no existe"));
    }
    if target.exists() {
        return Err(invalid("el destino ya existe"));
    }
    if inside_system_dir(&target)
        || sensitive_component(&target)
        || inside_app_owned_dir(&target)
        || app_secret_file(&target)
    {
        return Err(invalid("el destino es una ruta protegida"));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|_| invalid("no se pudieron crear las carpetas padre"))?;
        }
    }
    std::fs::rename(&source, &target)
        .map_err(|_| invalid("no se pudo mover (¿cruzando unidades o permisos?)"))?;
    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes: 0,
    })
}

#[cfg(test)]
#[path = "fs.tests.rs"]
mod tests;
