//! Adaptadores del servidor MCP embebido: token en Credential Manager,
//! bridge `mcp-call` hacia la ventana con pending map, detección de
//! clientes externos y el listener HTTP en 127.0.0.1.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Semaphore};
use uuid::Uuid;

use crate::mcp::server::{
    classify_request, client_entry, header_value, is_json_content_type, known_clients,
    merge_olyvia_entry, request_content_length, request_scopes, rpc_error, tool_required_scope,
    AutoconnectResult, DetectedClient, McpReply, McpServerInfo, RpcRequest, BODY_READ_TIMEOUT,
    HEADER_READ_TIMEOUT, MAX_BODY_BYTES, MAX_CONNECTIONS, MAX_HEADER_BYTES, MCP_KEYRING_SERVICE,
    MCP_KEYRING_USER, MCP_PORT, MCP_SCOPES_HEADER, SCOPE_DENIED_CODE,
};
use crate::ports::mcp_server::{
    AiClientConfigs, McpAuditSink, McpRequestHandler, McpServerToken, McpToolInvoker,
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
        path: &Path,
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
// Comparación constant-time del token (port de concat-server/token.rs)
// ---------------------------------------------------------------------------

/// `true` si `presented` es `expected`, en tiempo que depende sólo del
/// largo de `expected`: un atacante en el socket no aprende nada de qué
/// byte difiere por la velocidad del rechazo.
fn secure_token_eq(presented: &str, expected: &str) -> bool {
    let a = presented.as_bytes();
    let b = expected.as_bytes();
    let mut difference = a.len() ^ b.len();
    for (index, byte) in b.iter().enumerate() {
        let other = a.get(index).copied().unwrap_or(0);
        difference |= usize::from(byte ^ other);
    }
    std::hint::black_box(difference) == 0
}

// ---------------------------------------------------------------------------
// Throttle anti-fuerza-bruta (port de concat-server/throttle.rs)
// ---------------------------------------------------------------------------
//
// El listener sólo escucha en 127.0.0.1, así que todos los peers son la
// misma dirección: el libro queda efectivamente global por servidor, que
// es justo lo que hace falta contra un proceso local probando tokens.

/// Fallos de token perdonados antes de empezar a esperar.
const THROTTLE_FREE_FAILURES: u32 = 3;
/// Primera espera, duplicada en cada fallo siguiente.
const THROTTLE_FIRST_WAIT: Duration = Duration::from_millis(250);
/// Espera máxima.
const THROTTLE_LONGEST_WAIT: Duration = Duration::from_secs(60);
/// Cuántas direcciones se recuerdan como máximo.
const THROTTLE_MAX_PEERS: usize = 4096;
/// Cuánto se recuerda a un peer que dejó de fallar.
const THROTTLE_MEMORY: Duration = Duration::from_secs(600);

#[derive(Clone, Copy)]
struct Strikes {
    failures: u32,
    until: Instant,
    last: Instant,
}

#[derive(Default)]
struct Throttle {
    peers: Mutex<HashMap<std::net::IpAddr, Strikes>>,
}

impl Throttle {
    /// Cuánto debe esperar todavía `peer` antes de que se lea su token.
    fn wait(&self, peer: std::net::IpAddr) -> Option<Duration> {
        let peers = self.peers.lock().unwrap_or_else(|p| p.into_inner());
        let strikes = peers.get(&peer)?;
        strikes
            .until
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
    }

    fn failed(&self, peer: std::net::IpAddr) {
        let now = Instant::now();
        let mut peers = self.peers.lock().unwrap_or_else(|p| p.into_inner());
        if peers.len() >= THROTTLE_MAX_PEERS && !peers.contains_key(&peer) {
            peers.retain(|_, strikes| now.duration_since(strikes.last) < THROTTLE_MEMORY);
            if peers.len() >= THROTTLE_MAX_PEERS {
                if let Some(oldest) = peers
                    .iter()
                    .min_by_key(|(_, strikes)| strikes.last)
                    .map(|(peer, _)| *peer)
                {
                    peers.remove(&oldest);
                }
            }
        }
        let strikes = peers.entry(peer).or_insert(Strikes {
            failures: 0,
            until: now,
            last: now,
        });
        strikes.failures = strikes.failures.saturating_add(1);
        strikes.last = now;
        strikes.until = now + throttle_wait_after(strikes.failures);
    }

    fn succeeded(&self, peer: std::net::IpAddr) {
        self.peers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&peer);
    }
}

fn throttle_wait_after(failures: u32) -> Duration {
    if failures <= THROTTLE_FREE_FAILURES {
        return Duration::ZERO;
    }
    let doublings = (failures - THROTTLE_FREE_FAILURES - 1).min(16);
    THROTTLE_FIRST_WAIT
        .saturating_mul(1 << doublings)
        .min(THROTTLE_LONGEST_WAIT)
}

fn auth_throttle() -> &'static Throttle {
    static THROTTLE: OnceLock<Throttle> = OnceLock::new();
    THROTTLE.get_or_init(Throttle::default)
}

// ---------------------------------------------------------------------------
// Audit log persistente (JSONL append-only)
// ---------------------------------------------------------------------------

/// Tope del archivo de audit antes de rotar a `mcp-audit.1.jsonl`.
const AUDIT_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Sumidero JSONL: una línea por llamada, en `<config_dir>/mcp-audit.jsonl`.
/// Nunca propaga errores: si el disco falla, la llamada sigue igual.
pub struct JsonlMcpAuditSink {
    path: PathBuf,
}

impl JsonlMcpAuditSink {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl McpAuditSink for JsonlMcpAuditSink {
    fn record(&self, entry: &Value) {
        if let Ok(meta) = std::fs::metadata(&self.path) {
            if meta.len() > AUDIT_MAX_BYTES {
                let rotated = self.path.with_file_name("mcp-audit.1.jsonl");
                let _ = std::fs::rename(&self.path, rotated);
            }
        }
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let Ok(mut line) = serde_json::to_string(entry) else {
            return;
        };
        line.push('\n');
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            use std::io::Write;
            let _ = file.write_all(line.as_bytes());
        }
    }
}

// ---------------------------------------------------------------------------
// Enforcement de scopes por conexión
// ---------------------------------------------------------------------------

/// Decorador del handler real: exige el scope de cada `tools/call` según
/// el header `X-Olyvia-Scopes` de la conexión y audita los rechazos.
/// Las llamadas permitidas las audita el dispatcher (con duración y
/// resultado); acá sólo se anotan las denegadas.
pub struct ScopedMcpHandler {
    inner: Arc<dyn McpRequestHandler>,
    scopes: HashSet<String>,
    audit: Option<Arc<dyn McpAuditSink>>,
}

impl ScopedMcpHandler {
    pub fn new(
        inner: Arc<dyn McpRequestHandler>,
        scopes: HashSet<String>,
        audit: Option<Arc<dyn McpAuditSink>>,
    ) -> Self {
        Self {
            inner,
            scopes,
            audit,
        }
    }

    /// Si `request` es un `tools/call` sin scope suficiente, devuelve
    /// (nombre, args, id) para rechazarlo.
    fn denied_call(&self, request: &Value) -> Option<(String, Value, Value)> {
        if request.get("method").and_then(Value::as_str) != Some("tools/call") {
            return None;
        }
        let name = request["params"]["name"].as_str()?;
        let required = tool_required_scope(name);
        if crate::mcp::server::scopes_satisfy(&self.scopes, required) {
            return None;
        }
        Some((
            name.to_owned(),
            request["params"]["arguments"].clone(),
            request.get("id").cloned().unwrap_or(Value::Null),
        ))
    }

    fn audit_denied(&self, name: &str, args: &Value, required: &str) {
        if let Some(sink) = &self.audit {
            sink.record(&json!({
                "ts": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|value| value.as_millis() as u64)
                    .unwrap_or(0),
                "tool": name,
                "args": crate::mcp::server::sanitize_audit_args(args),
                "ok": false,
                "denied": "scope",
                "requiredScope": required,
                "grantedScopes": self.scopes.iter().collect::<Vec<_>>(),
            }));
        }
    }

    fn denied_response(id: &Value, name: &str, required: &str) -> Value {
        rpc_error(
            id,
            SCOPE_DENIED_CODE,
            &format!(
                "la herramienta `{name}` requiere el scope `{required}`; pedilo con el header {MCP_SCOPES_HEADER}"
            ),
        )
    }
}

impl McpRequestHandler for ScopedMcpHandler {
    fn handle(&self, request: &Value) -> Pin<Box<dyn Future<Output = Option<Value>> + Send + '_>> {
        if let Some((name, args, id)) = self.denied_call(request) {
            let required = tool_required_scope(&name);
            self.audit_denied(&name, &args, required);
            let response = Self::denied_response(&id, &name, required);
            return Box::pin(async move { Some(response) });
        }
        self.inner.handle(request)
    }

    fn handle_batch(&self, items: &[Value]) -> Pin<Box<dyn Future<Output = Value> + Send + '_>> {
        // Separa lo permitido (al handler real, que preserva su
        // paralelismo de lecturas) de lo denegado (error por ítem).
        let mut allowed: Vec<Value> = Vec::new();
        // denied[i] = respuesta de error para el ítem i-ésimo original.
        let mut denied: HashMap<usize, Value> = HashMap::new();
        for (index, item) in items.iter().enumerate() {
            // Las notificaciones no producen respuesta en ninguno de los
            // dos niveles; ni se miran ni se reenvían.
            if matches!(classify_request(item), RpcRequest::Notification) {
                continue;
            }
            if let Some((name, args, id)) = self.denied_call(item) {
                let required = tool_required_scope(&name);
                self.audit_denied(&name, &args, required);
                denied.insert(index, Self::denied_response(&id, &name, required));
            } else {
                allowed.push(item.clone());
            }
        }
        let inner = self.inner.clone();
        let allowed_len = allowed.len();
        let items = items.to_vec();
        Box::pin(async move {
            let responses = if allowed_len == 0 {
                Vec::new()
            } else {
                inner
                    .handle_batch(&allowed)
                    .await
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            };
            // Recompone el array en el orden original: las notificaciones
            // no emiten nada; los permitidos consumen la próxima respuesta
            // del handler interno en el mismo orden en que se enviaron.
            let mut merged: Vec<Value> = Vec::new();
            let mut next = responses.into_iter();
            for (index, item) in items.iter().enumerate() {
                if let Some(error) = denied.get(&index) {
                    merged.push(error.clone());
                    continue;
                }
                if matches!(classify_request(item), RpcRequest::Notification) {
                    continue;
                }
                if let Some(response) = next.next() {
                    merged.push(response);
                }
            }
            Value::Array(merged)
        })
    }
}

// ---------------------------------------------------------------------------
// Discovery file (`automation.json`, como concat-server/discovery.rs)
// ---------------------------------------------------------------------------

/// Nombre del archivo de descubrimiento dentro del config dir de la app.
pub const AUTOMATION_FILE: &str = "automation.json";
/// Layout del archivo; un lector rechaza otra versión.
pub const AUTOMATION_VERSION: u32 = 1;

/// Tools publicadas en el discovery file: el catálogo fallback más las
/// tools de estudio que ejecuta el backend (mínimo garantizado; la
/// ventana puede publicar más vía `tools/list`).
fn automation_tool_names() -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut push = |name: &str| {
        if !name.is_empty() && !names.iter().any(|existing| existing == name) {
            names.push(name.to_owned());
        }
    };
    if let Some(items) = crate::mcp::server::tools().as_array() {
        for item in items {
            if let Some(name) = item["name"].as_str() {
                push(name);
            }
        }
    }
    for tool in crate::mcp::server::studio_tools() {
        if let Some(name) = tool["name"].as_str() {
            push(name);
        }
    }
    names
}

/// Contenido del discovery file: endpoint, token, versión y tools.
/// El token va en claro igual que en Concat: el config dir ya es
/// per-user y el archivo sólo sirve para que un adaptador local
/// (p.ej. `motion-mcp` u otro cliente stdio) encuentre al servidor.
pub fn automation_listing(info: &McpServerInfo) -> Value {
    json!({
        "version": AUTOMATION_VERSION,
        "url": info.url,
        "token": info.token,
        "pid": std::process::id(),
        "app": "olyvia",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "protocolVersion": "2025-06-18",
        "scopesHeader": MCP_SCOPES_HEADER,
        "tools": automation_tool_names(),
    })
}

/// Escribe `automation.json` en `dir` de forma atómica (staging + rename),
/// como hace Concat: un lector nunca ve medio archivo.
pub fn write_automation_file(dir: &Path, info: &McpServerInfo) -> Result<(), ProjectError> {
    std::fs::create_dir_all(dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear el directorio de configuración para automation.json",
        )
    })?;
    let path = dir.join(AUTOMATION_FILE);
    let text = serde_json::to_string_pretty(&automation_listing(info)).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo serializar automation.json",
        )
    })?;
    let staging = dir.join(format!(".{AUTOMATION_FILE}.{}.tmp", std::process::id()));
    std::fs::write(&staging, text).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo escribir automation.json")
    })?;
    if let Err(error) = std::fs::rename(&staging, &path) {
        let _ = std::fs::remove_file(&staging);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo publicar automation.json: {error}"),
        ));
    }
    Ok(())
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
    audit: Option<Arc<dyn McpAuditSink>>,
) {
    // Anti-fuerza-bruta antes de leer nada: un peer en espera no llega
    // ni a enviar su token. En loopback todos comparten IpAddr, así que
    // el throttle actúa como límite global del servidor.
    let peer = stream.peer_addr().ok().map(|addr| addr.ip());
    if let Some(ip) = peer {
        if auth_throttle().wait(ip).is_some() {
            write_response(
                &mut stream,
                429,
                "{\"error\":\"demasiados intentos; esperá antes de reintentar\"}",
            )
            .await;
            return;
        }
    }
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
    let authorized = header_value(&head, "authorization")
        .map(|presented| secure_token_eq(&presented, &expected))
        .unwrap_or(false);
    if let Some(ip) = peer {
        if authorized {
            auth_throttle().succeeded(ip);
        } else {
            auth_throttle().failed(ip);
        }
    }
    if !authorized {
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
    // Scopes por conexión: el header `X-Olyvia-Scopes` decide qué tools
    // puede ejecutar este cliente; sin header, read+write.
    let scopes = request_scopes(header_value(&head, MCP_SCOPES_HEADER).as_deref());
    let scoped = Arc::new(ScopedMcpHandler::new(handler, scopes, audit));
    let response = if let Some(items) = value.as_array() {
        scoped.handle_batch(items).await
    } else {
        match scoped.handle(&value).await {
            Some(answer) => answer,
            None => {
                write_response(&mut stream, 202, "{}").await;
                return;
            }
        }
    };
    write_response(&mut stream, 200, &response.to_string()).await;
}

/// Handle del accept loop del servidor MCP. `abort` mata la task que
/// hace `listener.accept()`: al soltarse el `TcpListener` el puerto
/// 31417 queda libre para un próximo `start_mcp_server`.
pub struct McpListenerHandle {
    task: tauri::async_runtime::JoinHandle<()>,
}

impl crate::ports::mcp_server::McpServerRuntime for McpListenerHandle {
    fn abort(&self) {
        self.task.abort();
    }
}

/// Bind del listener en 127.0.0.1:MCP_PORT + accept loop con límite de
/// conexiones concurrentes. Lo llama `application::mcp_server::start_server`.
/// `audit` es el sumidero JSONL compartido: el dispatcher audita las
/// llamadas ejecutadas y el wrapper de scopes las denegadas.
/// Devuelve el handle del listener: sin él no hay forma de frenar el
/// servidor (`application::mcp_server::stop_server`).
pub fn serve_mcp(
    token: String,
    handler: Arc<dyn McpRequestHandler>,
    audit: Option<Arc<dyn McpAuditSink>>,
) -> Result<McpListenerHandle, ProjectError> {
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
    let task = tauri::async_runtime::spawn(async move {
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
            let audit = audit.clone();
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                serve(stream, handler, token, audit).await;
            });
        }
    });
    Ok(McpListenerHandle { task })
}

/// Quita `automation.json` del config dir al detener el servidor: un
/// cliente stdio que lo lea después no debe encontrar un endpoint muerto.
/// Archivo ausente no es error.
pub fn remove_automation_file(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(AUTOMATION_FILE));
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

    // ------------------------------------------------------------------
    // Token constant-time, throttle, scopes, audit y discovery
    // ------------------------------------------------------------------

    #[test]
    fn secure_token_eq_accepts_only_the_exact_token() {
        assert!(secure_token_eq("Bearer abc123", "Bearer abc123"));
        assert!(!secure_token_eq("Bearer abc12", "Bearer abc123"));
        assert!(!secure_token_eq("Bearer abc1234", "Bearer abc123"));
        assert!(!secure_token_eq("bearer abc123", "Bearer abc123"));
        assert!(!secure_token_eq("", "Bearer abc123"));
    }

    #[test]
    fn throttle_waits_only_after_free_failures_and_caps() {
        assert_eq!(throttle_wait_after(1), Duration::ZERO);
        assert_eq!(throttle_wait_after(THROTTLE_FREE_FAILURES), Duration::ZERO);
        assert_eq!(
            throttle_wait_after(THROTTLE_FREE_FAILURES + 1),
            THROTTLE_FIRST_WAIT
        );
        assert_eq!(
            throttle_wait_after(THROTTLE_FREE_FAILURES + 2),
            THROTTLE_FIRST_WAIT * 2
        );
        assert_eq!(throttle_wait_after(1000), THROTTLE_LONGEST_WAIT);
    }

    #[test]
    fn throttle_tracks_failures_per_peer_and_clears_on_success() {
        let throttle = Throttle::default();
        let peer: std::net::IpAddr = "127.0.0.1".parse().unwrap();
        let other: std::net::IpAddr = "127.0.0.2".parse().unwrap();
        for _ in 0..THROTTLE_FREE_FAILURES {
            throttle.failed(peer);
            assert_eq!(throttle.wait(peer), None, "perdonado");
        }
        throttle.failed(peer);
        assert!(throttle.wait(peer).is_some());
        assert_eq!(throttle.wait(other), None, "sólo el que falló");
        throttle.succeeded(peer);
        assert_eq!(throttle.wait(peer), None);
    }

    /// Handler fake: responde echo a todo request con id.
    struct EchoHandler;

    impl McpRequestHandler for EchoHandler {
        fn handle(
            &self,
            request: &Value,
        ) -> Pin<Box<dyn Future<Output = Option<Value>> + Send + '_>> {
            let id = request.get("id").cloned().unwrap_or(Value::Null);
            let method = request["method"].clone();
            Box::pin(async move {
                Some(crate::mcp::server::rpc_result(
                    &id,
                    json!({ "echo": method }),
                ))
            })
        }

        fn handle_batch(
            &self,
            items: &[Value],
        ) -> Pin<Box<dyn Future<Output = Value> + Send + '_>> {
            let items = items.to_vec();
            Box::pin(async move {
                Value::Array(
                    items
                        .iter()
                        .map(|item| {
                            crate::mcp::server::rpc_result(
                                &item.get("id").cloned().unwrap_or(Value::Null),
                                json!({ "echo": item["method"].clone() }),
                            )
                        })
                        .collect(),
                )
            })
        }
    }

    fn scoped(scopes_header: Option<&str>) -> ScopedMcpHandler {
        ScopedMcpHandler::new(
            Arc::new(EchoHandler),
            crate::mcp::server::request_scopes(scopes_header),
            None,
        )
    }

    fn call_request(id: i64, tool: &str) -> Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": { "name": tool, "arguments": {} }
        })
    }

    #[tokio::test]
    async fn default_scopes_deny_destructive_and_admin_tools() {
        let handler = scoped(None); // read+write
                                    // Lectura y escritura pasan al handler interno.
        for tool in ["diagnostics", "clip_update", "project_save"] {
            let request = call_request(1, tool);
            let response = handler.handle(&request).await.expect("response");
            assert!(response.get("result").is_some(), "{tool} debió pasar");
        }
        // Destructiva y admin rebotan con scope error.
        for (tool, required) in [
            ("clip_delete", "destructive"),
            ("export_render", "destructive"),
            ("production_cancel", "destructive"),
            ("run_command", "admin"),
            ("fs_write", "admin"),
        ] {
            let request = call_request(2, tool);
            let response = handler.handle(&request).await.expect("response");
            assert_eq!(
                response["error"]["code"],
                json!(SCOPE_DENIED_CODE),
                "{tool} debió ser denegada"
            );
            assert!(
                response["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains(required),
                "{tool}: mensaje sin scope requerido"
            );
        }
    }

    #[tokio::test]
    async fn explicit_scopes_unlock_destructive_but_not_admin() {
        let handler = scoped(Some("read,write,destructive"));
        let ok = handler
            .handle(&call_request(1, "clip_delete"))
            .await
            .unwrap();
        assert!(ok.get("result").is_some());
        let denied = handler
            .handle(&call_request(2, "run_command"))
            .await
            .unwrap();
        assert_eq!(denied["error"]["code"], json!(SCOPE_DENIED_CODE));

        let admin = scoped(Some("admin"));
        let ok = admin.handle(&call_request(3, "run_command")).await.unwrap();
        assert!(ok.get("result").is_some(), "admin cubre todo");
    }

    #[tokio::test]
    async fn batch_preserves_order_and_denies_per_item() {
        let handler = scoped(None);
        let items = vec![
            call_request(1, "diagnostics"),
            call_request(2, "clip_delete"), // denegada
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            call_request(3, "clip_update"),
            call_request(4, "run_command"), // denegada
        ];
        let response = handler.handle_batch(&items).await;
        let array = response.as_array().expect("batch array");
        // 4 respuestas: diag ok, clip_delete error, clip_update ok,
        // run_command error (la notificación no produce nada).
        assert_eq!(array.len(), 4);
        assert!(array[0].get("result").is_some());
        assert_eq!(array[1]["error"]["code"], json!(SCOPE_DENIED_CODE));
        assert_eq!(array[1]["id"], json!(2));
        assert!(array[2].get("result").is_some());
        assert_eq!(array[3]["error"]["code"], json!(SCOPE_DENIED_CODE));
        assert_eq!(array[3]["id"], json!(4));
    }

    #[test]
    fn jsonl_audit_sink_appends_parseable_lines() {
        let dir = std::env::temp_dir().join(format!("olyvia-audit-{}", uuid::Uuid::new_v4()));
        let path = dir.join("mcp-audit.jsonl");
        let sink = JsonlMcpAuditSink::new(path.clone());
        sink.record(&json!({ "tool": "diagnostics", "ok": true }));
        sink.record(&json!({ "tool": "clip_delete", "ok": false, "denied": "scope" }));
        let text = std::fs::read_to_string(&path).expect("audit file");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["tool"], json!("diagnostics"));
        let second: Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["denied"], json!("scope"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn automation_file_lists_endpoint_token_and_tools() {
        let dir = std::env::temp_dir().join(format!("olyvia-auto-{}", uuid::Uuid::new_v4()));
        let info = McpServerInfo {
            url: "http://127.0.0.1:31417/mcp".to_owned(),
            token: "tok-123".to_owned(),
        };
        write_automation_file(&dir, &info).expect("writes automation.json");
        let path = dir.join(AUTOMATION_FILE);
        let text = std::fs::read_to_string(&path).expect("automation.json");
        let listing: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(listing["version"], json!(AUTOMATION_VERSION));
        assert_eq!(listing["url"], json!(info.url));
        assert_eq!(listing["token"], json!("tok-123"));
        assert_eq!(listing["pid"], json!(std::process::id()));
        assert_eq!(listing["app"], json!("olyvia"));
        let tools = listing["tools"].as_array().expect("tools array");
        assert!(tools.iter().any(|t| t == "diagnostics"));
        assert!(tools.iter().any(|t| t == "production_cancel"));
        assert!(listing["scopesHeader"].as_str().unwrap().contains("scopes"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
