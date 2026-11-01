//! Biblioteca local de motion graphics (Lottie MIT descargables).
//!
//! El catálogo vive en el frontend; acá sólo se descarga y se cachea con
//! verificaciones estrictas. El backend no confía en el catálogo: exige HTTPS,
//! un host y un repo allowlisted, un identificador seguro, un tamaño máximo y
//! el SHA-256 esperado. La escritura es atómica (`.part` + rename) para que un
//! corte de luz no deje un JSON a medias que después rompa la preview.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Los iconos de react-useanimations pesan ~2–8 KB; 512 KB deja aire para
/// plantillas futuras sin permitir un archivo desmedido en la caché.
const MAX_BYTES: u64 = 512 * 1024;
const MAX_ID: usize = 64;
const ALLOWED_HOST: &str = "raw.githubusercontent.com";
const ALLOWED_PREFIX: &str = "/useAnimations/react-useanimations/";
const TIMEOUT: Duration = Duration::from_secs(30);

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn failure(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

fn cache_dir(root: &Path) -> PathBuf {
    root.join("motions").join("cache")
}

/// Identificador usado como nombre de archivo: minúsculas, dígitos y guiones.
fn validate_id(id: &str) -> Result<(), ProjectError> {
    if id.is_empty() || id.len() > MAX_ID {
        return Err(invalid("el identificador del motion no es válido"));
    }
    let mut chars = id.chars();
    let first = chars.next().unwrap_or(' ');
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return Err(invalid("el identificador del motion no es válido"));
    }
    if !chars.all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(invalid("el identificador del motion no es válido"));
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<String, ProjectError> {
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(invalid("el hash del motion no es un SHA-256 válido"));
    }
    Ok(value.to_ascii_lowercase())
}

fn validate_request(
    id: &str,
    raw_url: &str,
    sha256: &str,
    bytes: u64,
) -> Result<(reqwest::Url, String), ProjectError> {
    validate_id(id)?;
    let sha = validate_sha256(sha256)?;
    if bytes == 0 || bytes > MAX_BYTES {
        return Err(invalid(
            "el tamaño declarado del motion está fuera de rango",
        ));
    }
    let url =
        reqwest::Url::parse(raw_url).map_err(|_| invalid("la URL del motion no es válida"))?;
    if url.scheme() != "https" {
        return Err(invalid("la URL del motion debe usar HTTPS"));
    }
    if url.host_str() != Some(ALLOWED_HOST) {
        return Err(invalid("el host del motion no está permitido"));
    }
    if url.port().is_some()
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid("la URL del motion no está permitida"));
    }
    if !url.path().starts_with(ALLOWED_PREFIX) {
        return Err(invalid("el repo del motion no está permitido"));
    }
    Ok((url, sha))
}

fn hash_of(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Escribe `data` sólo si coincide con el hash esperado. `rename` reemplaza de
/// forma atómica en Unix; en Windows el destino existente se retira primero y
/// se reintenta, porque renombrar sobre un archivo abierto falla con sharing
/// violation.
fn write_verified(
    root: &Path,
    id: &str,
    data: &[u8],
    expected_sha: &str,
) -> Result<PathBuf, ProjectError> {
    validate_id(id)?;
    let expected = validate_sha256(expected_sha)?;
    if data.len() as u64 > MAX_BYTES {
        return Err(invalid("el motion descargado supera el tamaño máximo"));
    }
    let actual = hash_of(data);
    if actual != expected {
        return Err(invalid(
            "el hash del motion descargado no coincide con el catálogo",
        ));
    }
    let dir = cache_dir(root);
    fs::create_dir_all(&dir).map_err(|_| failure("no se pudo crear la caché de motions"))?;
    let destination = dir.join(format!("{id}.json"));
    let temporary = dir.join(format!(".{id}.part"));
    let mut file =
        fs::File::create(&temporary).map_err(|_| failure("no se pudo escribir el motion"))?;
    file.write_all(data)
        .map_err(|_| failure("no se pudo escribir el motion"))?;
    file.sync_all()
        .map_err(|_| failure("no se pudo sincronizar el motion"))?;
    drop(file);
    if let Err(first) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&destination);
        fs::rename(&temporary, &destination).map_err(|_| {
            let _ = fs::remove_file(&temporary);
            let _ = first;
            failure("no se pudo guardar el motion en la caché")
        })?;
    }
    Ok(destination)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMotion {
    pub id: String,
    pub bytes: u64,
    pub sha256: String,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionCacheStats {
    pub dir: String,
    pub count: usize,
    pub bytes: u64,
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn list_entries(root: &Path) -> Vec<CachedMotion> {
    let dir = cache_dir(root);
    let Ok(read_dir) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if validate_id(id).is_err() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_BYTES {
            continue;
        }
        let Ok(data) = fs::read(entry.path()) else {
            continue;
        };
        entries.push(CachedMotion {
            id: id.to_owned(),
            bytes: metadata.len(),
            sha256: hash_of(&data),
            modified_ms: modified_ms(&metadata),
        });
    }
    entries.sort_by(|left, right| left.id.cmp(&right.id));
    entries
}

/// Ruta real de la caché, para mostrarla en Ajustes.
#[tauri::command]
pub fn motion_cache_dir(state: State<'_, AppState>) -> String {
    cache_dir(&state.config_dir).to_string_lossy().into_owned()
}

#[tauri::command]
pub fn motion_list_cached(state: State<'_, AppState>) -> Vec<CachedMotion> {
    list_entries(&state.config_dir)
}

#[tauri::command]
pub fn motion_cache_stats(state: State<'_, AppState>) -> MotionCacheStats {
    let dir = cache_dir(&state.config_dir);
    let entries = list_entries(&state.config_dir);
    MotionCacheStats {
        dir: dir.to_string_lossy().into_owned(),
        count: entries.len(),
        bytes: entries.iter().map(|entry| entry.bytes).sum(),
    }
}

#[tauri::command]
pub fn motion_read_cached(
    state: State<'_, AppState>,
    id: String,
    sha256: Option<String>,
) -> Result<String, ProjectError> {
    validate_id(&id)?;
    let path = cache_dir(&state.config_dir).join(format!("{id}.json"));
    let metadata = fs::metadata(&path).map_err(|_| invalid("el motion no está en la caché"))?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(invalid("el motion en caché no es válido"));
    }
    let data = fs::read(&path).map_err(|_| failure("no se pudo leer el motion de la caché"))?;
    if let Some(expected) = sha256 {
        let expected = validate_sha256(&expected)?;
        if hash_of(&data) != expected {
            return Err(invalid(
                "el motion en caché no coincide con el catálogo; volvé a descargarlo",
            ));
        }
    }
    String::from_utf8(data).map_err(|_| invalid("el motion en caché no es texto UTF-8"))
}

#[tauri::command]
pub fn motion_remove_cached(state: State<'_, AppState>, id: String) -> Result<bool, ProjectError> {
    validate_id(&id)?;
    let path = cache_dir(&state.config_dir).join(format!("{id}.json"));
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(failure("no se pudo borrar el motion de la caché")),
    }
}

/// Descarga un motion del catálogo y lo guarda verificado en la caché.
///
/// `spawn_blocking` evita que la descarga bloquee el hilo de IPC; el cliente es
/// nuevo por llamada para no compartir cookies ni estado entre descargas.
#[tauri::command]
pub async fn motion_download(
    state: State<'_, AppState>,
    id: String,
    url: String,
    sha256: String,
    bytes: u64,
) -> Result<CachedMotion, ProjectError> {
    let (parsed, sha) = validate_request(&id, &url, &sha256, bytes)?;
    let root = state.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| failure("no se pudo preparar la descarga del motion"))?;
        let response = client
            .get(parsed)
            .send()
            .map_err(|_| failure("no se pudo conectar para descargar el motion"))?;
        if !response.status().is_success() {
            return Err(failure("el servidor del motion respondió con un error"));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BYTES)
        {
            return Err(invalid("el motion remoto supera el tamaño máximo"));
        }
        let mut data = Vec::new();
        response
            .take(MAX_BYTES + 1)
            .read_to_end(&mut data)
            .map_err(|_| failure("la descarga del motion se interrumpió"))?;
        if data.len() as u64 > MAX_BYTES {
            return Err(invalid("el motion remoto supera el tamaño máximo"));
        }
        if data.len() as u64 != bytes {
            return Err(invalid(
                "el tamaño del motion descargado no coincide con el catálogo",
            ));
        }
        let path = write_verified(&root, &id, &data, &sha)?;
        let metadata =
            fs::metadata(&path).map_err(|_| failure("no se pudo leer el motion descargado"))?;
        Ok(CachedMotion {
            id,
            bytes: metadata.len(),
            sha256: sha,
            modified_ms: modified_ms(&metadata),
        })
    })
    .await
    .map_err(|_| failure("la descarga del motion se interrumpió"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("olyvia-motion-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("temp root");
        root
    }

    #[test]
    fn ids_seguros() {
        for id in ["ua-check-circle", "a1", "0", "a-b-c"] {
            assert!(validate_id(id).is_ok(), "{id}");
        }
        for id in ["", "../x", "Mayus", "a/b", "-a", "a b", &"x".repeat(65)] {
            assert!(validate_id(id).is_err(), "{id}");
        }
    }

    #[test]
    fn urls_allowlisted() {
        let sha = "a".repeat(64);
        let ok = validate_request(
            "ua-check",
            "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/check.json",
            &sha,
            100,
        );
        assert!(ok.is_ok());
        for url in [
            "http://raw.githubusercontent.com/useAnimations/react-useanimations/main/icons/check.json",
            "https://evil.example/useAnimations/react-useanimations/main/icons/check.json",
            "https://raw.githubusercontent.com/other/repo/main/check.json",
            "https://raw.githubusercontent.com:444/useAnimations/react-useanimations/main/x.json",
            "https://user:pass@raw.githubusercontent.com/useAnimations/react-useanimations/main/x.json",
        ] {
            assert!(validate_request("ua-check", url, &sha, 100).is_err(), "{url}");
        }
        assert!(validate_request(
            "ua-check",
            "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/x.json",
            "zz",
            100
        )
        .is_err());
        assert!(validate_request(
            "ua-check",
            "https://raw.githubusercontent.com/useAnimations/react-useanimations/main/x.json",
            &sha,
            MAX_BYTES + 1
        )
        .is_err());
    }

    #[test]
    fn escribe_solo_con_hash_correcto() {
        let root = temp_root("hash");
        let data = br#"{"v":"5.7.4","layers":[]}"#;
        let sha = hash_of(data);
        let wrong = "0".repeat(64);
        assert!(write_verified(&root, "ua-check", data, &wrong).is_err());
        assert!(!cache_dir(&root).join("ua-check.json").exists());
        let path = write_verified(&root, "ua-check", data, &sha).expect("write");
        assert_eq!(fs::read(&path).expect("read"), data);
        let listed = list_entries(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "ua-check");
        assert_eq!(listed[0].sha256, sha);
        assert_eq!(listed[0].bytes, data.len() as u64);
        assert!(fs::read_dir(cache_dir(&root))
            .expect("dir")
            .flatten()
            .all(|entry| !entry.file_name().to_string_lossy().ends_with(".part")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reemplaza_una_entrada_existente() {
        let root = temp_root("replace");
        let first = br#"{"v":"1","layers":[1]}"#;
        let second = br#"{"v":"1","layers":[1,2]}"#;
        write_verified(&root, "ua-check", first, &hash_of(first)).expect("first");
        write_verified(&root, "ua-check", second, &hash_of(second)).expect("second");
        let path = cache_dir(&root).join("ua-check.json");
        assert_eq!(fs::read(&path).expect("read"), second);
        let _ = fs::remove_dir_all(root);
    }
}
