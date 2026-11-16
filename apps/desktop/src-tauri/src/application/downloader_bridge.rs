//! Puente local para la extensión del navegador — DTOs del protocolo y
//! helpers puros (token, naming, probe de imagen directa, parse del head
//! HTTP). El servidor TCP (listener, sockets, rutas con AppHandle) queda en
//! `commands::downloader::downloader_bridge`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::downloads::{DownloadProbe, DownloadRequest};

pub const MAX_BODY_BYTES: usize = 1_500_000;
pub const MAX_HEADER_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
    pub downloads_dir: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFile {
    pub name: String,
    pub bytes: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeJob {
    pub id: String,
    pub status: String,
    pub stage: String,
    pub percent: Option<f64>,
    pub message: String,
    pub files: Vec<BridgeFile>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

/// Head HTTP ya parseado: método, ruta, headers y dónde empieza el cuerpo.
#[derive(Debug, Clone)]
pub struct HttpHead {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body_start: usize,
    pub content_length: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeProbeRequest {
    pub url: String,
    pub direct_image: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeDownloadRequest {
    #[serde(flatten)]
    pub download: DownloadRequest,
    pub direct_image: Option<bool>,
}

/// Ubica el fin de los headers (`\r\n\r\n`) en el buffer acumulado.
pub fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|window| window == b"\r\n\r\n")
}

/// Parsea método, ruta y headers una vez que el head completo está en `data`.
/// Devuelve `None` si el head es inválido o el body excede `MAX_BODY_BYTES`.
pub fn parse_http_head(data: &[u8]) -> Option<HttpHead> {
    let header_end = find_header_end(data)?;
    let head = String::from_utf8_lossy(&data[..header_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut request_parts = lines.next()?.split_whitespace();
    let method = request_parts.next()?.to_ascii_uppercase();
    let path = request_parts.next()?.split('?').next()?.to_owned();
    let mut headers = BTreeMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return None;
    }
    Some(HttpHead {
        method,
        path,
        headers,
        body_start: header_end + 4,
        content_length,
    })
}

pub fn error_body(message: impl Into<String>) -> String {
    json!({ "error": message.into() }).to_string()
}

/// Comparación constante en tiempo: no corta en la primera diferencia.
pub fn token_matches(candidate: &str, expected: &str) -> bool {
    if candidate.len() != expected.len() {
        return false;
    }
    candidate
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |accumulator, (left, right)| {
            accumulator | (left ^ right)
        })
        == 0
}

/// Token nuevo de 64 hex chars para el puente del navegador. La
/// persistencia vive en el llavero del sistema (AUD-100) — antes se
/// escribía en `downloader-bridge.token` en texto plano y el error se
/// ignoraba, así que un fallo de escritura anunciaba un emparejamiento
/// que no sobrevivía al reinicio.
pub fn generate_bridge_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Valida el contenido de un `downloader-bridge.token` legado: >=32 chars
/// hex. Devuelve el token limpio o `None` si el archivo está corrupto.
pub fn parse_legacy_bridge_token(text: &str) -> Option<String> {
    let token = text.trim();
    (token.len() >= 32 && token.chars().all(|value| value.is_ascii_hexdigit()))
        .then(|| token.to_owned())
}

/// Probe sintético para `direct_image`: no consulta yt-dlp, arma el DTO con
/// lo que se sabe de la URL sola.
pub fn direct_image_probe(url: &str) -> DownloadProbe {
    let title = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("Imagen");
    DownloadProbe {
        url: url.to_owned(),
        title: title.chars().take(200).collect(),
        uploader: None,
        duration_seconds: None,
        thumbnail: Some(url.to_owned()),
        kind: "image".to_owned(),
        entry_count: 1,
        max_height: None,
        estimated_bytes: None,
        qualities: Vec::new(),
    }
}

fn sanitize_file_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect();
    if sanitized.trim().is_empty() {
        "archivo".to_owned()
    } else {
        sanitized
    }
}

/// Destino único dentro de `directory`: sanitiza caracteres inválidos de
/// Windows y numera ` (2)`, ` (3)`, … sin pisar archivos existentes.
pub fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let safe = sanitize_file_name(name);
    let candidate = directory.join(&safe);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(&safe);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned());
    for index in 2..10_000 {
        let name = match extension.as_deref() {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{}.bin", Uuid::new_v4()))
}

/// Nombre de archivo para una imagen directa: toma el último segmento de la
/// URL, sanitiza y completa la extensión según el Content-Type.
pub fn image_file_name(url: &str, content_type: &str) -> String {
    let raw = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("imagen");
    let sanitized = sanitize_file_name(raw);
    let lower = sanitized.to_ascii_lowercase();
    let has_extension = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
        .iter()
        .any(|extension| lower.ends_with(extension));
    if has_extension {
        return sanitized;
    }
    let extension = match content_type {
        value if value.contains("png") => ".png",
        value if value.contains("webp") => ".webp",
        value if value.contains("gif") => ".gif",
        value if value.contains("avif") => ".avif",
        _ => ".jpg",
    };
    format!("{sanitized}{extension}")
}
