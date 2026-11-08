//! Adaptadores del servidor MCP embebido: token en Credential Manager,
//! bridge `mcp-call` hacia la ventana con pending map, detección de
//! clientes externos y el listener HTTP en 127.0.0.1.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Semaphore};
use uuid::Uuid;

use crate::mcp::server::{
    client_entry, header_value, is_json_content_type, known_clients, merge_olyvia_entry,
    request_content_length, AutoconnectResult, DetectedClient, McpReply, McpServerInfo,
    BODY_READ_TIMEOUT, HEADER_READ_TIMEOUT, MAX_BODY_BYTES, MAX_CONNECTIONS, MAX_HEADER_BYTES,
    MCP_KEYRING_SERVICE, MCP_KEYRING_USER, MCP_PORT,
};
use crate::ports::mcp_server::{
    AiClientConfigs, McpRequestHandler, McpServerToken, McpToolInvoker,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

// ---------------------------------------------------------------------------
// Token persistente
// ---------------------------------------------------------------------------

/// Token Bearer estable del servidor MCP, protegido por el Administrador de
/// credenciales de Windows: sin él no se atiende ninguna request.
pub struct KeyringMcpServerToken;

impl McpServerToken for KeyringMcpServerToken {
    fn get_or_create(&self) -> Result<String, ProjectError> {
        let entry = keyring::Entry::new(MCP_KEYRING_SERVICE, MCP_KEYRING_USER).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::KeyringUnavailable,
                "el Administrador de credenciales de Windows no esta disponible",
            )
        })?;
        if let Ok(existing) = entry.get_password() {
            let existing = existing.trim();
            if existing.len() >= 32 {
                return Ok(existing.to_owned());
            }
        }
        let token = Uuid::new_v4().to_string();
        entry.set_password(&token).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::KeyringUnavailable,
                "no se pudo guardar el token MCP en el Administrador de credenciales",
            )
        })?;
        Ok(token)
    }
}

// ---------------------------------------------------------------------------
// Bridge hacia la ventana (pending map + evento `mcp-call`)
// ---------------------------------------------------------------------------

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<McpReply>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<McpReply>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registra una respuesta pendiente dentro de un ámbito síncrono para no
/// conservar un MutexGuard en el futuro async que atiende la conexión.
fn register_pending(id: &str, sender: oneshot::Sender<McpReply>) -> Result<(), ()> {
    let mut entries = pending().lock().map_err(|_| ())?;
    entries.insert(id.to_owned(), sender);
    Ok(())
}

/// Respuesta del frontend a un `run_command` pendiente (comando IPC).
pub fn respond_pending(id: &str, ok: bool, text: String) -> bool {
    let sender = pending().lock().ok().and_then(|mut map| map.remove(id));
    match sender {
        Some(sender) => sender.send(McpReply { ok, text }).is_ok(),
        None => false,
    }
}

/// Invoca una herramienta en la ventana: emite `mcp-call` y espera la
/// respuesta por `mcp_respond` con timeout.
pub struct TauriMcpToolInvoker {
    app: AppHandle,
}

impl TauriMcpToolInvoker {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl McpToolInvoker for TauriMcpToolInvoker {
    fn invoke(
        &self,
        tool: &str,
        args: &Value,
        wait: Duration,
    ) -> Pin<Box<dyn Future<Output = McpReply> + Send + '_>> {
        let app = self.app.clone();
        let tool = tool.to_owned();
        let args = args.clone();
        Box::pin(async move {
            let id = Uuid::new_v4().to_string();
            let (sender, receiver) = oneshot::channel();
            if register_pending(&id, sender).is_err() {
                return McpReply {
                    ok: false,
                    text: "el registro de solicitudes MCP está bloqueado".to_owned(),
                };
            }

            let emitted = app.emit("mcp-call", json!({ "id": id, "tool": tool, "args": args }));
            if emitted.is_err() {
                if let Ok(mut entries) = pending().lock() {
                    entries.remove(&id);
                }
                return McpReply {
                    ok: false,
                    text: "la ventana del editor no está disponible".to_owned(),
                };
            }

            match tokio::time::timeout(wait, receiver).await {
                Ok(Ok(reply)) => reply,
                Ok(Err(_)) => McpReply {
                    ok: false,
                    text: "la ventana cerró antes de responder".to_owned(),
                },
                Err(_) => {
                    if let Ok(mut entries) = pending().lock() {
                        entries.remove(&id);
                    }
                    McpReply {
                        ok: false,
                        text: format!("la herramienta no respondió en {} segundos", wait.as_secs()),
                    }
                }
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Clientes de IA externos
// ---------------------------------------------------------------------------

fn claude_desktop_config_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("Claude")
            .join("claude_desktop_config.json"),
    )
}

/// Heurística de instalación: Claude Desktop crea una de estas carpetas al
/// instalarse, sin depender de que ya se haya abierto una vez.
fn claude_desktop_installed() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    let local = PathBuf::from(local);
    local.join("AnthropicClaude").exists() || local.join("Programs").join("Claude").exists()
}

/// Config compartida de Antigravity 2.0 / IDE / CLI (todas leen el mismo
/// archivo). Ver docs de Google Antigravity: `~/.gemini/config/mcp_config.json`.
fn antigravity_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")?;
    Some(
        PathBuf::from(home)
            .join(".gemini")
            .join("config")
            .join("mcp_config.json"),
    )
}

fn antigravity_installed() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    PathBuf::from(local)
        .join("Programs")
        .join("Antigravity IDE")
        .exists()
}

/// Detección real de clientes externos por variables de entorno y filesystem.
pub struct EnvAiClientConfigs;

impl AiClientConfigs for EnvAiClientConfigs {
    fn detect(&self) -> Vec<DetectedClient> {
        known_clients()
            .into_iter()
            .map(|(id, label, download_url)| DetectedClient {
                id: id.to_owned(),
                label: label.to_owned(),
                installed: self.installed(id),
                download_url: download_url.to_owned(),
            })
            .collect()
    }

    fn config_path(&self, client: &str) -> Result<PathBuf, ProjectError> {
        let path = match client {
            "claude-desktop" => claude_desktop_config_path(),
            "antigravity" => antigravity_config_path(),
            _ => None,
        };
        path.ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se encontró la variable de entorno necesaria en este equipo",
            )
        })
    }

    fn installed(&self, client: &str) -> bool {
        match client {
            "claude-desktop" => claude_desktop_installed(),
            "antigravity" => antigravity_installed(),
            _ => false,
        }
    }

    fn download_url(&self, client: &str) -> &'static str {
        known_clients()
            .iter()
            .find(|(id, _, _)| *id == client)
            .map(|(_, _, url)| *url)
            .unwrap_or("https://antigravity.google/")
    }

    /// Mezcla no destructiva: se preserva cualquier otro contenido del
    /// archivo (otros servidores MCP, ajustes propios del cliente) y sólo se
    /// agrega o reemplaza la entrada "olyvia".
    fn write_olyvia_entry(
        &self,
        path: &PathBuf,
        info: &McpServerInfo,
    ) -> Result<AutoconnectResult, ProjectError> {
        let client = if path.to_string_lossy().contains("claude_desktop_config") {
            "claude-desktop"
        } else {
            "antigravity"
        };
        let entry = client_entry(client, info).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("cliente MCP desconocido: {client}"),
            )
        })?;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo crear la carpeta de configuración de ese cliente",
                )
            })?;
        }

        let mut root: Value = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| json!({}));
        merge_olyvia_entry(&mut root, entry);

        let pretty = serde_json::to_string_pretty(&root).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo generar la configuración")
        })?;
        std::fs::write(path, pretty).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo escribir el archivo de configuración de ese cliente",
            )
        })?;

        Ok(AutoconnectResult {
            client: client.to_owned(),
            config_path: path.to_string_lossy().into_owned(),
            message: "listo".into(),
        })
    }
}

// ---------------------------------------------------------------------------
// Listener HTTP
// ---------------------------------------------------------------------------

async fn write_response(stream: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        if status == 200 { "OK" } else { "Error" },
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

async fn serve(
    mut stream: tokio::net::TcpStream,
    handler: Arc<dyn McpRequestHandler>,
    token: String,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end;
    let header_deadline = tokio::time::Instant::now() + HEADER_READ_TIMEOUT;
    loop {
        match tokio::time::timeout_at(header_deadline, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => return,
            Ok(Ok(read)) => {
                buffer.extend_from_slice(&chunk[..read]);
                if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                    header_end = position + 4;
                    break;
                }
                if buffer.len() > MAX_HEADER_BYTES {
                    write_response(
                        &mut stream,
                        431,
                        "{\"error\":\"headers demasiado grandes\"}",
                    )
                    .await;
                    return;
                }
            }
            Ok(Err(_)) => return,
            Err(_) => {
                write_response(&mut stream, 408, "{\"error\":\"timeout leyendo headers\"}").await;
                return;
            }
        }
    }
    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    if method != "POST" || path != "/mcp" {
        write_response(&mut stream, 404, "{\"error\":\"usá POST /mcp\"}").await;
        return;
    }
    let expected = format!("Bearer {token}");
    if header_value(&head, "authorization").as_deref() != Some(expected.as_str()) {
        write_response(&mut stream, 401, "{\"error\":\"token inválido\"}").await;
        return;
    }
    if !is_json_content_type(&head) {
        write_response(
            &mut stream,
            415,
            "{\"error\":\"content-type debe ser application/json\"}",
        )
        .await;
        return;
    }
    let length = match request_content_length(&head) {
        Ok(length) => length,
        Err(message) => {
            write_response(&mut stream, 400, &format!("{{\"error\":\"{message}\"}}")).await;
            return;
        }
    };
    if length > MAX_BODY_BYTES {
        write_response(&mut stream, 413, "{\"error\":\"cuerpo demasiado grande\"}").await;
        return;
    }
    let mut body = buffer[header_end..].to_vec();
    if body.len() > length {
        write_response(
            &mut stream,
            400,
            "{\"error\":\"bytes adicionales después del cuerpo\"}",
        )
        .await;
        return;
    }
    let body_deadline = tokio::time::Instant::now() + BODY_READ_TIMEOUT;
    while body.len() < length {
        match tokio::time::timeout_at(body_deadline, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => {
                write_response(&mut stream, 400, "{\"error\":\"cuerpo HTTP incompleto\"}").await;
                return;
            }
            Ok(Ok(read)) => {
                body.extend_from_slice(&chunk[..read]);
                if body.len() > length {
                    write_response(
                        &mut stream,
                        400,
                        "{\"error\":\"cuerpo HTTP excede content-length\"}",
                    )
                    .await;
                    return;
                }
            }
            Ok(Err(_)) => {
                write_response(
                    &mut stream,
                    400,
                    "{\"error\":\"no se pudo leer el cuerpo HTTP\"}",
                )
                .await;
                return;
            }
            Err(_) => {
                write_response(
                    &mut stream,
                    408,
                    "{\"error\":\"timeout leyendo el cuerpo HTTP\"}",
                )
                .await;
                return;
            }
        }
    }
    let value: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            write_response(&mut stream, 400, "{\"error\":\"JSON inválido\"}").await;
            return;
        }
    };
    let response = if let Some(items) = value.as_array() {
        handler.handle_batch(items).await
    } else {
        match handler.handle(&value).await {
            Some(answer) => answer,
            None => {
                write_response(&mut stream, 202, "{}").await;
                return;
            }
        }
    };
    write_response(&mut stream, 200, &response.to_string()).await;
}

/// Bind del listener en 127.0.0.1:MCP_PORT + accept loop con límite de
/// conexiones concurrentes. Lo llama `application::mcp_server::start_server`.
pub fn serve_mcp(token: String, handler: Arc<dyn McpRequestHandler>) -> Result<(), ProjectError> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", MCP_PORT)).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el puerto MCP 31417 esta ocupado; cerra la otra instancia o libera ese puerto",
        )
    })?;
    listener.set_nonblocking(true).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo preparar el listener MCP")
    })?;
    let listener = TcpListener::from_std(listener).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo preparar el listener MCP")
    })?;
    let connection_slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let permit = match connection_slots.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => {
                    tauri::async_runtime::spawn(async move {
                        let mut stream = stream;
                        write_response(
                            &mut stream,
                            503,
                            "{\"error\":\"servidor MCP ocupado; reintentá más tarde\"}",
                        )
                        .await;
                    });
                    continue;
                }
            };
            let handler = handler.clone();
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                serve(stream, handler, token).await;
            });
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::mcp_server;

    #[cfg(windows)]
    #[test]
    fn persistent_mcp_token_is_reused_from_windows_credential_manager() {
        let store = KeyringMcpServerToken;
        let first = store
            .get_or_create()
            .expect("el Administrador de credenciales debe estar disponible");
        let second = store
            .get_or_create()
            .expect("la credencial MCP debe poder leerse");
        assert!(first.len() >= 32);
        assert!(
            first == second,
            "el token MCP debe conservarse entre reinicios"
        );
    }

    #[test]
    fn detect_clients_returns_known_clients() {
        let clients = mcp_server::detect_clients(&EnvAiClientConfigs);
        let ids: Vec<&str> = clients.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"claude-desktop"));
        assert!(ids.contains(&"antigravity"));
        for client in &clients {
            assert!(!client.label.is_empty());
            assert!(client.download_url.starts_with("https://"));
        }
    }
}
