//! Automatizaciones del descargador — carpeta vigilada, feeds RSS/Atom y
//! checksums de fuente. DTOs IPC, parsers puros y traversal de fs
//! determinista; la red (HEAD, fetch, proxy) queda en `commands::downloader::automation`.

use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_WATCH_FILES: usize = 50;
pub const MAX_WATCH_BYTES: u64 = 1_000_000;
pub const MAX_WATCH_URLS: usize = 500;
pub const MAX_RSS_BYTES: u64 = 2_000_000;
pub const MAX_RSS_ITEMS: usize = 100;

fn automation_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChecksum {
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub source: String,
}

pub fn extract_urls(text: &str) -> Vec<String> {
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

pub fn base64_to_hex(value: &str, expected_bytes: usize) -> Option<String> {
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

pub fn checksum_from_headers(headers: &reqwest::header::HeaderMap) -> SourceChecksum {
    let mut md5 = None;
    let mut sha256 = None;
    let mut source = String::new();
    if let Some(value) = headers
        .get("content-md5")
        .and_then(|value| value.to_str().ok())
    {
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
            } else if lower.starts_with("md5=") && md5.is_none() {
                md5 = base64_to_hex(&trimmed[4..], 16);
                if md5.is_some() {
                    source = "Digest".to_owned();
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
    if let Some(value) = headers
        .get("x-goog-hash")
        .and_then(|value| value.to_str().ok())
    {
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

/// Recorre la carpeta vigilada (hasta 3 niveles, sólo `.txt`, topes de
/// tamaño/cantidad) y devuelve las listas con URLs http(s) deduplicadas.
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

pub fn parse_feed(xml: &str, limit: usize) -> Vec<RssItem> {
    let Ok(document) = roxmltree::Document::parse(xml) else {
        return Vec::new();
    };
    let limit = limit.clamp(1, MAX_RSS_ITEMS);
    let mut items = Vec::new();
    for node in document
        .descendants()
        .filter(|node| node.is_element() && matches!(node.tag_name().name(), "item" | "entry"))
    {
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
