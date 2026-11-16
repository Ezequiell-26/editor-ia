// Caché de frames del preview real por firma (rebanada de
// `assinaturas`/`veredito`/`baldes` de `prerender.js`+`agendador.js` de
// AlaukCut): cada `render_preview_frame` escribía un PNG nuevo con UUID
// por llamada — revisitar un frame ya renderizado pagaba otra pasada de
// FFmpeg. La firma cubre el proyecto serializado + clip + frame + modo,
// así cualquier edición invalida la entrada sin tabla de dependencias.
//
// Se guarda `frame-<sig>.png` + `frame-<sig>.json` (metadatos del
// resultado) y se poda a `CACHE_LIMIT` entradas por mtime — el caché es
// best-effort: si el disco falla, el render se devuelve igual.
//
// `PreviewFrameResult`, `Path`, `PathBuf` y `Value` ya están en scope por
// el módulo padre (include!); sólo se importan los que faltan.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::SystemTime;

/// Entradas máximas conservadas (par orden png+json). ~240 frames ≈ unos
/// pocos cientos de MB en el peor caso; el prune corre sólo al escribir.
const CACHE_LIMIT: usize = 240;
const FILE_PREFIX: &str = "frame-";

/// Firma estable del frame pedido. `DefaultHasher::new()` usa claves fijas
/// (a diferencia de `RandomState`), así la firma sobrevive reinicios.
fn frame_signature(
    project: &Value,
    clip_id: &str,
    frame: u64,
    native: bool,
    composite: bool,
) -> String {
    let mut hasher = DefaultHasher::new();
    // La serialización es O(proyecto) pero insignificante frente a una
    // pasada de FFmpeg; `Value` ordena las claves, la firma es estable.
    if let Ok(json) = serde_json::to_string(project) {
        json.hash(&mut hasher);
    }
    clip_id.hash(&mut hasher);
    frame.hash(&mut hasher);
    native.hash(&mut hasher);
    composite.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn cache_paths(dir: &Path, signature: &str) -> (PathBuf, PathBuf) {
    (
        dir.join(format!("{FILE_PREFIX}{signature}.png")),
        dir.join(format!("{FILE_PREFIX}{signature}.json")),
    )
}

/// Devuelve el resultado cacheado si el PNG y su JSON existen y parsean.
pub fn cache_lookup(dir: &Path, signature: &str) -> Option<PreviewFrameResult> {
    let (png, json) = cache_paths(dir, signature);
    if !png.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(&json).ok()?;
    let mut result: PreviewFrameResult = serde_json::from_str(&raw).ok()?;
    // La ruta absoluta puede cambiar entre sesiones (otra instalación del
    // caché); se reescribe con la ubicación actual del PNG.
    result.path = png.to_string_lossy().into_owned();
    Some(result)
}

/// Copia el PNG renderizado a la ruta de caché, guarda los metadatos y
/// poda. Devuelve el resultado con `path` apuntando al PNG cacheado; si la
/// copia falla devuelve el resultado original (el frame ya está renderizado).
pub fn cache_store(
    dir: &Path,
    signature: &str,
    result: &PreviewFrameResult,
) -> PreviewFrameResult {
    let (png, json) = cache_paths(dir, signature);
    let source = PathBuf::from(&result.path);
    if source.is_file() && std::fs::copy(&source, &png).is_ok() {
        let mut stored = result.clone();
        stored.path = png.to_string_lossy().into_owned();
        if let Ok(raw) = serde_json::to_string(&stored) {
            let _ = std::fs::write(&json, raw);
        }
        prune_cache(dir);
        return stored;
    }
    result.clone()
}

/// Conserva las `CACHE_LIMIT` entradas más recientes (por mtime del PNG)
/// y borra el resto junto a su JSON. Best-effort: errores de lectura se
/// ignoran (peor caso: entradas huérfanas que el próximo prune limpia).
fn prune_cache(dir: &Path) {
    let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with(FILE_PREFIX) || path.extension().and_then(|e| e.to_str()) != Some("png")
        {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push((path, modified));
    }
    if entries.len() <= CACHE_LIMIT {
        return;
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    for (path, _) in entries.into_iter().skip(CACHE_LIMIT) {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_file_name(format!("{stem}.json")));
    }
}
