//! Automatizaciones ligeras del descargador: carpeta vigilada, feeds RSS y
//! comprobación de proxies. No descargan nada por sí mismas; sólo entregan
//! entradas validadas a la cola de la UI.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;

use crate::commands::downloader::validate_url;
use crate::projects::service::{ProjectError, ProjectErrorCode};

const MAX_WATCH_FILES: usize = 50;
const MAX_WATCH_BYTES: u64 = 1_000_000;
const MAX_WATCH_URLS: usize = 500;
const MAX_RSS_BYTES: u64 = 2_000_000;
const MAX_RSS_ITEMS: usize = 100;

fn automation_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
}

fn provider_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFile {
    pub path: String,
    pub name: String,
    pub modified_seconds: u64,
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssItem {
    pub title: String,
    pub link: String,
    pub published: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHealth {
    pub proxy: String,
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn extract_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let candidate = line
            .split_whitespace()
            .find(|part| part.starts_with("http://") || part.starts_with("https://"));
        if let Some(candidate) = candidate {
            let candidate = candidate.trim_matches(['"', '\'', ',', ';']);
            if !candidate.is_empty() && !urls.iter().any(|item| item == candidate) {
                urls.push(candidate.to_owned());
                if urls.len() >= MAX_WATCH_URLS {
                    break;
                }
            }
        }
    }
    urls
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChecksum {
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub source: String,
}

fn base64_to_hex(value: &str, expected_bytes: usize) -> Option<String> {
    let cleaned = value.trim().trim_matches(':').trim_matches('"');
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cleaned)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(cleaned))
        .ok()?;
    (bytes.len() == expected_bytes).then(|| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    })
}

fn checksum_from_headers(headers: &reqwest::header::HeaderMap) -> SourceChecksum {
    let mut md5 = None;
    let mut sha256 = None;
    let mut source = String::new();
    if let Some(value) = headers.get("content-md5").and_then(|value| value.to_str().ok()) {
        md5 = base64_to_hex(value, 16);
        if md5.is_some() {
            source = "Content-MD5".to_owned();
        }
    }
    if let Some(value) = headers.get("digest").and_then(|value| value.to_str().ok()) {
        for part in value.split(',') {
            let trimmed = part.trim();
            let lower = trimmed.to_ascii_lowercase();
            if lower.starts_with("sha-256=") {
                sha256 = base64_to_hex(&trimmed[8..], 32);
                if sha256.is_some() {
                    source = "Digest".to_owned();
                }
            } else if lower.starts_with("md5=") {
                if md5.is_none() {
                    md5 = base64_to_hex(&trimmed[4..], 16);
                    if md5.is_some() {
                        source = "Digest".to_owned();
                    }
                }
            }
        }
    }
    if sha256.is_none() {
        if let Some(value) = headers
            .get("x-checksum-sha256")
            .and_then(|value| value.to_str().ok())
        {
            let value = value.trim().to_ascii_lowercase();
            if value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()) {
                sha256 = Some(value);
                source = "X-Checksum-Sha256".to_owned();
            }
        }
    }
    if let Some(value) = headers.get("x-goog-hash").and_then(|value| value.to_str().ok()) {
        for part in value.split(',') {
            if let Some(raw) = part.trim().strip_prefix("md5=") {
                if md5.is_none() {
                    md5 = base64_to_hex(raw, 16);
                    if md5.is_some() {
                        source = "x-goog-hash".to_owned();
                    }
                }
            }
        }
    }
    SourceChecksum {
        md5,
        sha256,
        source,
    }
}

#[tauri::command]
pub fn probe_source_checksum(url: String) -> Result<SourceChecksum, ProjectError> {
    let url = validate_url(&url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Olyvia/0.1 (checksum probe)")
        .build()
        .map_err(|_| provider_error("No se pudo iniciar la consulta de checksum."))?;
    let response = client
        .head(&url)
        .send()
        .map_err(|_| provider_error("No se pudo consultar la fuente para el checksum."))?;
    if !response.status().is_success() && !response.status().is_redirection() {
        return Err(provider_error(format!(
            "La fuente respondió {} al pedir el checksum.",
            response.status().as_u16()
        )));
    }
    Ok(checksum_from_headers(response.headers()))
}

#[tauri::command]
pub fn scan_watch_folder(path: String) -> Result<Vec<WatchFile>, ProjectError> {
    let directory = PathBuf::from(path.trim());
    if directory.as_os_str().is_empty() || !directory.is_dir() {
        return Err(automation_error("La carpeta vigilada no existe."));
    }
    let mut files = Vec::new();
    let mut pending = vec![(directory.clone(), 0u8)];
    while let Some((current, depth)) = pending.pop() {
        if depth > 3 || pending.len() > 200 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten().take(1_000) {
            if files.len() >= MAX_WATCH_FILES {
                break;
            }
            let path = entry.path();
            if path.is_dir() {
                if depth < 3 {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            if !path.is_file() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if extension != "txt" {
                continue;
            }
            let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            if size == 0 || size > MAX_WATCH_BYTES {
                continue;
            }
            let modified_seconds = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let urls = extract_urls(&text);
            if urls.is_empty() {
                continue;
            }
            files.push(WatchFile {
                path: path.to_string_lossy().into_owned(),
                name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "lista.txt".to_owned()),
                modified_seconds,
                urls,
            });
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

fn text_of(node: roxmltree::Node<'_, '_>) -> String {
    node.text().unwrap_or("").trim().to_owned()
}

fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == name)
        .map(text_of)
        .filter(|value| !value.is_empty())
}

fn entry_link(node: roxmltree::Node<'_, '_>) -> Option<String> {
    if let Some(link) = child_text(node, "link") {
        return Some(link);
    }
    node.children()
        .filter(|child| child.is_element() && child.tag_name().name() == "link")
        .find_map(|child| {
            child
                .attribute("href")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        })
}

pub(crate) fn parse_feed(xml: &str, limit: usize) -> Vec<RssItem> {
    let Ok(document) = roxmltree::Document::parse(xml) else {
        return Vec::new();
    };
    let limit = limit.clamp(1, MAX_RSS_ITEMS);
    let mut items = Vec::new();
    for node in document.descendants().filter(|node| {
        node.is_element() && matches!(node.tag_name().name(), "item" | "entry")
    }) {
        let Some(link) = entry_link(node) else {
            continue;
        };
        let title = child_text(node, "title").unwrap_or_else(|| link.clone());
        let published = child_text(node, "pubDate")
            .or_else(|| child_text(node, "published"))
            .or_else(|| child_text(node, "updated"));
        items.push(RssItem {
            title,
            link,
            published,
        });
        if items.len() >= limit {
            break;
        }
    }
    items
}

#[tauri::command]
pub fn fetch_rss_feed(url: String, limit: Option<u32>) -> Result<Vec<RssItem>, ProjectError> {
    let url = validate_url(&url)?;
    let limit = limit.unwrap_or(30) as usize;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| provider_error("No se pudo iniciar la consulta del feed."))?;
    let response = client
        .get(&url)
        .header("User-Agent", "Olyvia/0.1 (feed local)")
        .send()
        .map_err(|_| provider_error("No se pudo leer el feed RSS. Revisá la URL o la conexión."))?;
    if !response.status().is_success() {
        return Err(provider_error(format!(
            "El feed respondió {}.",
            response.status().as_u16()
        )));
    }
    let mut body = String::new();
    response
        .take(MAX_RSS_BYTES)
        .read_to_string(&mut body)
        .map_err(|_| provider_error("El feed devolvió un cuerpo ilegible."))?;
    let items = parse_feed(&body, limit);
    if items.is_empty() {
        return Err(automation_error(
            "El feed no tiene entradas RSS/Atom reconocibles.",
        ));
    }
    Ok(items)
}

#[tauri::command]
pub fn test_proxy(proxy: String) -> Result<ProxyHealth, ProjectError> {
    let proxy = proxy.trim().to_owned();
    if !(proxy.starts_with("http://")
        || proxy.starts_with("https://")
        || proxy.starts_with("socks4://")
        || proxy.starts_with("socks5://"))
    {
        return Err(automation_error(
            "El proxy debe empezar con http://, https://, socks4:// o socks5://.",
        ));
    }
    let started = Instant::now();
    let result = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .proxy(
            reqwest::Proxy::all(&proxy)
                .map_err(|_| automation_error("La URL del proxy no es válida."))?,
        )
        .build()
        .and_then(|client| {
            client
                .get("https://www.youtube.com/generate_204")
                .header("User-Agent", "Olyvia/0.1 (proxy check)")
                .send()
        });
    match result {
        Ok(response) if response.status().is_success() || response.status().is_redirection() => {
            Ok(ProxyHealth {
                proxy,
                ok: true,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                error: None,
            })
        }
        Ok(response) => Ok(ProxyHealth {
            proxy,
            ok: false,
            latency_ms: None,
            error: Some(format!("HTTP {}.", response.status().as_u16())),
        }),
        Err(error) => Ok(ProxyHealth {
            proxy,
            ok: false,
            latency_ms: None,
            error: Some(if error.is_timeout() {
                "Tiempo de espera agotado.".to_owned()
            } else {
                "Sin conexión a través del proxy.".to_owned()
            }),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_urls_from_watch_text() {
        let urls = extract_urls(
            "# lista\nhttps://youtu.be/uno\n\n  https://example.com/dos, \nno es url\nhttps://youtu.be/uno\n",
        );
        assert_eq!(urls, vec!["https://youtu.be/uno", "https://example.com/dos"]);
        assert!(extract_urls("solo texto").is_empty());
    }

    #[test]
    fn parses_rss_and_atom_entries() {
        let rss = r#"<?xml version="1.0"?><rss><channel>
            <item><title>Primero</title><link>https://example.com/a</link><pubDate>Mon, 01 Jan 2026</pubDate></item>
            <item><title>Segundo</title><link>https://example.com/b</link></item>
        </channel></rss>"#;
        let items = parse_feed(rss, 10);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Primero");
        assert_eq!(items[0].link, "https://example.com/a");
        assert_eq!(items[1].published, None);

        let atom = r#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
            <entry><title>Atom</title><link href="https://example.com/atom"/><updated>2026-01-01T00:00:00Z</updated></entry>
        </feed>"#;
        let items = parse_feed(atom, 10);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].link, "https://example.com/atom");
        assert_eq!(items[0].published.as_deref(), Some("2026-01-01T00:00:00Z"));
    }

    #[test]
    fn watch_folder_requires_a_directory() {
        assert!(scan_watch_folder("Z:\\no-existe".to_owned()).is_err());
        assert!(scan_watch_folder(String::new()).is_err());
    }

    #[test]
    fn watch_folder_reads_txt_lists_and_skips_empty_files() {
        let root = std::env::temp_dir().join(format!("editoria-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("lista.txt"),
            "https://youtu.be/uno\n# comentario\nhttps://example.com/dos\n",
        )
        .unwrap();
        std::fs::write(root.join("vacia.txt"), "sin enlaces").unwrap();
        std::fs::write(root.join("ignorar.md"), "https://example.com/tres").unwrap();
        let files = scan_watch_folder(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "lista.txt");
        assert_eq!(files[0].urls.len(), 2);
        assert!(files[0].modified_seconds > 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn checksum_headers_convert_base64_to_hex() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "content-md5",
            reqwest::header::HeaderValue::from_static("kAFQmDzST7DWlj99KOF/cg=="),
        );
        headers.insert(
            "digest",
            reqwest::header::HeaderValue::from_static(
                "sha-256=:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=:",
            ),
        );
        let checksum = checksum_from_headers(&headers);
        assert_eq!(
            checksum.md5.as_deref(),
            Some("900150983cd24fb0d6963f7d28e17f72")
        );
        assert_eq!(
            checksum.sha256.as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        assert_eq!(checksum.source, "Digest");
    }

    #[test]
    fn rss_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let items = fetch_rss_feed("https://hnrss.org/frontpage".to_owned(), Some(5))
            .expect("feed real");
        assert!(!items.is_empty());
        assert!(items.iter().all(|item| item.link.starts_with("http")));
        eprintln!("RSS real: {} entradas", items.len());
    }
}
