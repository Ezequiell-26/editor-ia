//! Extracción de paleta y tipografías desde una URL pública.
//!
//! No ejecuta la página ni usa un navegador: descarga HTML/CSS acotados y lee
//! colores hexadecimales y declaraciones `font-family`. Se bloquean hosts
//! privados y locales para evitar SSRF.

use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::redirect::Policy;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_CSS_BYTES: usize = 512 * 1024;
const MAX_STYLESHEETS: usize = 3;
const MAX_COLORS: usize = 8;
const MAX_FONTS: usize = 6;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignExtractRequest {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignExtractReply {
    pub url: String,
    pub title: String,
    pub colors: Vec<String>,
    pub fonts: Vec<String>,
}

fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_unspecified()
                || value.is_multicast()
                || value.is_broadcast()
        }
        IpAddr::V6(value) => {
            value.is_loopback()
                || value.is_unspecified()
                || value.is_multicast()
                || value.is_unique_local()
                || value.is_unicast_link_local()
        }
    }
}

fn validate_public_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("sólo se admiten URLs http o https".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("la URL no puede incluir credenciales".to_owned());
    }
    let host = url.host_str().ok_or("la URL no tiene host")?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
        return Err("no se permiten hosts locales".to_owned());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_forbidden_ip(ip) {
            return Err("no se permiten IPs privadas o locales".to_owned());
        }
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "no se pudo resolver el host".to_owned())?;
    let mut found = false;
    for address in addresses {
        found = true;
        if is_forbidden_ip(address.ip()) {
            return Err("el host resuelve a una IP privada o local".to_owned());
        }
    }
    if !found {
        return Err("el host no resolvió a ninguna dirección".to_owned());
    }
    Ok(())
}

fn normalize_hex(raw: &str) -> Option<String> {
    let value = raw.to_ascii_lowercase();
    match value.len() {
        3 => Some(format!(
            "#{c}{c}{d}{d}{e}{e}",
            c = &value[0..1],
            d = &value[1..2],
            e = &value[2..3]
        )),
        6 => Some(format!("#{value}")),
        _ => None,
    }
}

fn parse_colors(css: &str) -> Vec<String> {
    let bytes = css.as_bytes();
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'#' {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && end - start < 6 && bytes[end].is_ascii_hexdigit() {
            end += 1;
        }
        let length = end - start;
        let next = bytes.get(end).copied();
        let boundary = next.map(|value| !value.is_ascii_hexdigit()).unwrap_or(true);
        if (length == 3 || length == 6) && boundary {
            if let Some(color) = normalize_hex(&css[start..end]) {
                if color != "#000000" && color != "#ffffff" {
                    *counts.entry(color).or_default() += 1;
                }
            }
        }
        index = end.max(index + 1);
    }
    let mut colors: Vec<(String, usize)> = counts.into_iter().collect();
    colors.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    colors
        .into_iter()
        .take(MAX_COLORS)
        .map(|(color, _)| color)
        .collect()
}

fn parse_fonts(css: &str) -> Vec<String> {
    let lower = css.to_ascii_lowercase();
    let mut fonts: Vec<String> = Vec::new();
    let mut index = 0;
    while let Some(found) = lower[index..].find("font-family") {
        let start = index + found + "font-family".len();
        let Some(colon) = lower[start..].find(':') else {
            break;
        };
        let value_start = start + colon + 1;
        let value_end = lower[value_start..]
            .find(|character| matches!(character, ';' | '}' | '!'))
            .map(|offset| value_start + offset)
            .unwrap_or(lower.len());
        let value = &css[value_start..value_end];
        for family in value.split(',') {
            let clean = family.trim().trim_matches(['"', '\'']).trim().to_owned();
            if clean.is_empty() || clean.len() > 60 {
                continue;
            }
            if !fonts
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&clean))
            {
                fonts.push(clean);
            }
            if fonts.len() >= MAX_FONTS {
                return fonts;
            }
        }
        index = value_end;
        if index >= lower.len() {
            break;
        }
    }
    fonts
}

fn parse_title(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(start) = lower.find("<title") else {
        return String::new();
    };
    let Some(end) = lower[start..].find('>') else {
        return String::new();
    };
    let content_start = start + end + 1;
    let Some(close) = lower[content_start..].find("</title>") else {
        return String::new();
    };
    html[content_start..content_start + close]
        .trim()
        .chars()
        .take(160)
        .collect()
}

fn stylesheet_links(html: &str, base: &Url) -> Vec<Url> {
    let lower = html.to_ascii_lowercase();
    let mut links = Vec::new();
    let mut index = 0;
    while let Some(found) = lower[index..].find("<link") {
        let start = index + found;
        let Some(end) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + end];
        let tag_lower = tag.to_ascii_lowercase();
        if tag_lower.contains("stylesheet") {
            if let Some(href_start) = tag_lower.find("href=") {
                let rest = &tag[href_start + 5..];
                let quote = rest.chars().next();
                let value = match quote {
                    Some('"') | Some('\'') => {
                        let q = quote.unwrap();
                        let end = rest[1..].find(q).map(|offset| offset + 1);
                        end.map(|end| &rest[1..end])
                    }
                    _ => rest
                        .split_whitespace()
                        .next()
                        .map(|value| value.trim_end_matches('>')),
                };
                if let Some(value) = value {
                    if let Ok(url) = base.join(value) {
                        if url.host_str() == base.host_str()
                            && !links.iter().any(|existing: &Url| existing == &url)
                        {
                            links.push(url);
                        }
                    }
                }
            }
        }
        index = start + end + 1;
        if links.len() >= MAX_STYLESHEETS {
            break;
        }
    }
    links
}

async fn fetch_text(
    client: &reqwest::Client,
    url: &Url,
    max_bytes: usize,
) -> Result<String, ProjectError> {
    validate_public_url(url)
        .map_err(|reason| ProjectError::message(ProjectErrorCode::InvalidProject, &reason))?;
    let response = client.get(url.clone()).send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "la página no respondió a tiempo".to_owned()
        } else {
            "no se pudo descargar la página".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    validate_public_url(response.url())
        .map_err(|reason| ProjectError::message(ProjectErrorCode::InvalidProject, &reason))?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!("la página respondió HTTP {}", response.status().as_u16()),
        ));
    }
    if response.content_length().unwrap_or(0) > max_bytes as u64 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la página supera el tamaño permitido",
        ));
    }
    let bytes = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la página llegó incompleta",
        )
    })?;
    if bytes.len() > max_bytes {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la página supera el tamaño permitido",
        ));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

async fn extract_from_url(url: Url) -> Result<DesignExtractReply, ProjectError> {
    validate_public_url(&url)
        .map_err(|reason| ProjectError::message(ProjectErrorCode::InvalidProject, &reason))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(Policy::limited(5))
        .user_agent("Olyvia/0.4 (design extract)")
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let html = fetch_text(&client, &url, MAX_HTML_BYTES).await?;
    let title = parse_title(&html);
    let mut css = String::new();
    let lower = html.to_ascii_lowercase();
    let mut index = 0;
    while let Some(found) = lower[index..].find("<style") {
        let start = index + found;
        let Some(open_end) = lower[start..].find('>') else {
            break;
        };
        let content_start = start + open_end + 1;
        let Some(close) = lower[content_start..].find("</style>") else {
            break;
        };
        css.push_str(&html[content_start..content_start + close]);
        css.push('\n');
        index = content_start + close + 8;
        if index >= lower.len() {
            break;
        }
    }
    for link in stylesheet_links(&html, &url) {
        if let Ok(stylesheet) = fetch_text(&client, &link, MAX_CSS_BYTES).await {
            css.push_str(&stylesheet);
            css.push('\n');
        }
    }
    Ok(DesignExtractReply {
        url: url.to_string(),
        title,
        colors: parse_colors(&css),
        fonts: parse_fonts(&css),
    })
}

#[tauri::command]
pub async fn design_extract_url(
    _state: State<'_, AppState>,
    request: DesignExtractRequest,
) -> Result<DesignExtractReply, ProjectError> {
    let url = Url::parse(request.url.trim()).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "la URL no es válida")
    })?;
    extract_from_url(url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_colors_and_fonts_from_css() {
        let css = "body{background:#0B0F14;color:#fff;font-family:'Inter', system-ui, sans-serif}\
                   .cta{background:#5b8cff;font-family: \"Space Grotesk\", Arial}";
        assert_eq!(parse_colors(css), vec!["#0b0f14", "#5b8cff"]);
        assert_eq!(
            parse_fonts(css),
            vec!["Inter", "system-ui", "sans-serif", "Space Grotesk", "Arial"]
        );
    }

    #[test]
    fn parses_title_and_same_host_stylesheets() {
        let html = "<html><head><title> Mi diseño </title><link rel=\"stylesheet\" href=\"/a.css\"><link rel=stylesheet href=\"https://other.test/b.css\"></head></html>";
        let base = Url::parse("https://example.test/page").unwrap();
        assert_eq!(parse_title(html), "Mi diseño");
        let links = stylesheet_links(html, &base);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].as_str(), "https://example.test/a.css");
    }

    #[test]
    fn rejects_private_hosts_and_credentials() {
        for value in [
            "http://localhost:3000",
            "http://127.0.0.1",
            "http://10.0.0.1",
            "http://169.254.1.1",
            "http://user:pass@example.com",
            "file:///tmp/a.html",
        ] {
            let url = Url::parse(value).unwrap();
            assert!(validate_public_url(&url).is_err(), "{value}");
        }
    }

    #[test]
    #[ignore = "descarga una URL pública; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_extract_public_url() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let url = std::env::var("EDITOR_IA_EXTRACT_URL")
            .unwrap_or_else(|_| "https://example.com".to_owned());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let reply = runtime
            .block_on(extract_from_url(Url::parse(&url).expect("URL")))
            .expect("extracción real");
        eprintln!(
            "extract real: title={} colors={} fonts={}",
            reply.title,
            reply.colors.len(),
            reply.fonts.len()
        );
    }
}
