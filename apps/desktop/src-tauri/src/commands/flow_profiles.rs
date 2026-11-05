//! Proxies por cuenta de Google Flow.
//!
//! El servidor MCP de Flow no administra proxies: lee `proxies.json` del
//! directorio de datos al lanzar el navegador de cada cuenta. La app escribe ese
//! archivo desde acá, así cada cuenta sale por su propio proxy sin compartir IP
//! con las demás.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::Value;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

fn data_dir() -> PathBuf {
    if let Ok(value) = std::env::var("FLOW_MCP_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    std::env::var("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("flow-mcp"))
        .unwrap_or_else(|_| PathBuf::from("flow-mcp"))
}

fn proxies_file() -> PathBuf {
    data_dir().join("proxies.json")
}

/// Un proxy válido tiene esquema y no tiene espacios.
pub(crate) fn valid_proxy(value: &str) -> bool {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    let has_scheme = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("socks5://");
    has_scheme && trimmed.len() > 10 && !trimmed.chars().any(char::is_whitespace)
}

fn read_proxies() -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    let Ok(text) = std::fs::read_to_string(proxies_file()) else {
        return map;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return map;
    };
    if let Some(object) = value.as_object() {
        for (account, proxy) in object {
            if let Some(text) = proxy.as_str() {
                if valid_proxy(text) {
                    map.insert(account.clone(), text.trim().to_owned());
                }
            }
        }
    }
    map
}

#[tauri::command]
pub fn get_flow_proxies(_state: State<'_, AppState>) -> Result<BTreeMap<String, String>, ProjectError> {
    Ok(read_proxies())
}

#[tauri::command]
pub fn set_flow_proxy(
    _state: State<'_, AppState>,
    account_id: String,
    proxy: Option<String>,
) -> Result<BTreeMap<String, String>, ProjectError> {
    let account = account_id.trim().to_owned();
    if account.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta el id de la cuenta",
        ));
    }
    let mut map = read_proxies();
    match proxy {
        Some(value) if !value.trim().is_empty() => {
            if !valid_proxy(&value) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el proxy debe empezar con http://, https:// o socks5:// y no tener espacios",
                ));
            }
            map.insert(account, value.trim().to_owned());
        }
        _ => {
            map.remove(&account);
        }
    }
    let directory = data_dir();
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no pude crear el directorio de datos de Flow",
        )
    })?;
    let text = serde_json::to_string_pretty(&map).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude serializar los proxies")
    })?;
    std::fs::write(proxies_file(), text).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude escribir proxies.json")
    })?;
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_https_and_socks5() {
        assert!(valid_proxy("http://127.0.0.1:8080"));
        assert!(valid_proxy("https://user:pass@proxy.example.com:443"));
        assert!(valid_proxy("socks5://10.0.0.5:1080"));
    }

    #[test]
    fn rejects_missing_scheme_or_spaces() {
        assert!(!valid_proxy("127.0.0.1:8080"));
        assert!(!valid_proxy("http://host:80 with space"));
        assert!(!valid_proxy(""));
        assert!(!valid_proxy("ftp://host:21"));
    }
}
