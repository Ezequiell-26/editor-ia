//! Adaptadores MCP: store JSON atómico, secretos keyring y transporte
//! stdio (proceso hijo con pipes, hilos de lectura y kill de árbol).

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use uuid::Uuid;

use crate::mcp::client::{check_shell_launch, error, needs_cmd_shell, McpServerConfig, MCP_FILE};
use crate::ports::mcp::{McpEnvSecrets, McpServerStore, McpTransport, McpTransportFactory};
use crate::projects::service::{ProjectError, ProjectErrorCode};

const KEYRING_SERVICE: &str = "editor-ia.mcp";
const MAX_LINE_BYTES: usize = 4_000_000;
const STDERR_TAIL: usize = 24;

// ---------------------------------------------------------------------------
// Store de configuración
// ---------------------------------------------------------------------------

/// `mcp-servers.json` dentro del config dir de la app.
pub struct LocalMcpServerStore {
    pub dir: PathBuf,
}

impl McpServerStore for LocalMcpServerStore {
    fn read_servers(&self) -> Result<Vec<McpServerConfig>, ProjectError> {
        let path = self.dir.join(MCP_FILE);
        if !path.is_file() {
            return Ok(Vec::new());
        }
        let text = std::fs::read_to_string(&path).map_err(|_| {
            error(
                ProjectErrorCode::Io,
                "no se pudo leer la configuración de servidores MCP",
            )
        })?;
        let servers: Vec<McpServerConfig> = serde_json::from_str(&text).map_err(|_| {
            error(
                ProjectErrorCode::InvalidJson,
                "la configuración de servidores MCP está dañada",
            )
        })?;
        Ok(servers
            .into_iter()
            .take(crate::mcp::client::MAX_SERVERS)
            .collect())
    }

    fn write_servers(&self, servers: &[McpServerConfig]) -> Result<(), ProjectError> {
        let text = serde_json::to_string_pretty(servers).map_err(|_| {
            error(
                ProjectErrorCode::Io,
                "no se pudo serializar la configuración MCP",
            )
        })?;
        let path = self.dir.join(MCP_FILE);
        let temp = self.dir.join(format!(".{MCP_FILE}.{}.tmp", Uuid::new_v4()));
        std::fs::write(&temp, text).map_err(|_| {
            error(
                ProjectErrorCode::Io,
                "no se pudo escribir la configuración MCP",
            )
        })?;
        std::fs::rename(&temp, &path).map_err(|_| {
            let _ = std::fs::remove_file(&temp);
            error(
                ProjectErrorCode::Io,
                "no se pudo publicar la configuración MCP",
            )
        })?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Secretos de entorno (Windows Credential Manager)
// ---------------------------------------------------------------------------

fn keyring_entry(server_id: &str, key: &str) -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("{server_id}:{key}")).map_err(|_| {
        error(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de credenciales de Windows no está disponible para MCP",
        )
    })
}

/// Variables de entorno MCP en el Credential Manager: una credencial por
/// `server_id:key`. El JSON de configuración sólo guarda los nombres.
pub struct KeyringMcpEnv;

impl McpEnvSecrets for KeyringMcpEnv {
    fn read_env(&self, server: &McpServerConfig) -> Result<BTreeMap<String, String>, ProjectError> {
        let mut values = BTreeMap::new();
        for key in &server.env_keys {
            let entry = keyring_entry(&server.id, key)?;
            match entry.get_password() {
                Ok(secret) => {
                    values.insert(key.clone(), secret);
                }
                Err(keyring::Error::NoEntry) => {
                    return Err(error(
                        ProjectErrorCode::KeyringUnavailable,
                        "falta el valor de una variable de entorno MCP; volvé a guardarla",
                    ));
                }
                Err(_) => {
                    return Err(error(
                        ProjectErrorCode::KeyringUnavailable,
                        "no se pudo leer una variable de entorno MCP del almacén de Windows",
                    ));
                }
            }
        }
        Ok(values)
    }

    fn set_env(&self, server_id: &str, key: &str, value: &str) -> Result<(), ProjectError> {
        keyring_entry(server_id, key)?
            .set_password(value)
            .map_err(|_| {
                error(
                    ProjectErrorCode::KeyringUnavailable,
                    "no se pudo guardar una variable de entorno MCP en el almacén de Windows",
                )
            })
    }

    fn remove_key(&self, server_id: &str, key: &str) {
        if let Ok(entry) = keyring_entry(server_id, key) {
            let _ = entry.delete_credential();
        }
    }

    fn remove_env(&self, server: &McpServerConfig) {
        for key in &server.env_keys {
            self.remove_key(&server.id, key);
        }
    }
}

// ---------------------------------------------------------------------------
// Transporte stdio
// ---------------------------------------------------------------------------

fn build_command(server: &McpServerConfig) -> Result<Command, ProjectError> {
    check_shell_launch(&server.command, &server.args)?;
    #[cfg(windows)]
    {
        if needs_cmd_shell(&server.command) {
            let mut command = Command::new("cmd");
            command.arg("/C").arg(&server.command).args(&server.args);
            return Ok(command);
        }
    }
    let mut command = Command::new(&server.command);
    command.args(&server.args);
    Ok(command)
}

/// Termina el proceso y todo lo que haya lanzado.
///
/// En Windows el comando puede envolverse en `cmd /C` (npx, npm, .cmd): matar
/// sólo el `cmd` deja vivo el `node` —y con él el navegador— como huérfano.
/// `taskkill /T` recorre el árbol completo.
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Proceso MCP hijo con pipes stdio y un hilo por stream.
pub struct StdioMcpTransport {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

impl StdioMcpTransport {
    fn spawn_inner(
        server: &McpServerConfig,
        env: &BTreeMap<String, String>,
    ) -> Result<Self, ProjectError> {
        if !server.enabled {
            return Err(error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP está desactivado",
            ));
        }
        let mut command = build_command(server)?;
        if let Some(dir) = server.working_dir.as_deref() {
            command.current_dir(dir);
        }
        if !env.is_empty() {
            command.envs(env);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // stderr no es protocolo: se guarda una cola corta para poder
            // explicar por qué murió un servidor en lugar de decir "no
            // respondió a tiempo".
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo iniciar el servidor MCP; revisá el comando",
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP no expone una entrada estándar",
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP no expone una salida estándar",
            )
        })?;
        let stderr_buffer: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(stderr) = child.stderr.take() {
            let sink = stderr_buffer.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    let Ok(text) = line else { break };
                    let trimmed: String = text.trim().chars().take(400).collect();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(mut buffer) = sink.lock() {
                        if buffer.len() >= STDERR_TAIL {
                            buffer.pop_front();
                        }
                        buffer.push_back(trimmed);
                    }
                }
            });
        }
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        if text.len() > MAX_LINE_BYTES {
                            break;
                        }
                        if sender.send(text).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            lines: receiver,
            stderr: stderr_buffer,
        })
    }

    /// Última línea de `stderr`, para acompañar un error con la causa real.
    fn stderr_tail(&self) -> Option<String> {
        let buffer = self.stderr.lock().ok()?;
        let joined = buffer
            .iter()
            .rev()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" · ");
        if joined.is_empty() {
            None
        } else {
            Some(joined)
        }
    }

    /// Agrega la cola de `stderr` al mensaje cuando existe.
    fn with_stderr(&self, message: &str) -> String {
        match self.stderr_tail() {
            Some(tail) => format!("{message} — {tail}"),
            None => message.to_owned(),
        }
    }
}

impl McpTransport for StdioMcpTransport {
    fn send(&mut self, value: &Value) -> Result<(), ProjectError> {
        let mut text = serde_json::to_string(value)
            .map_err(|_| error(ProjectErrorCode::Io, "no se pudo serializar el mensaje MCP"))?;
        text.push('\n');
        self.stdin.write_all(text.as_bytes()).map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                &self.with_stderr("el servidor MCP cerró la entrada antes de responder"),
            )
        })?;
        self.stdin.flush().map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                &self.with_stderr("no se pudo enviar el mensaje al servidor MCP"),
            )
        })
    }

    fn receive_for(&mut self, id: u64, timeout: Duration) -> Result<Value, ProjectError> {
        let until = Instant::now() + timeout;
        loop {
            let now = Instant::now();
            if now >= until {
                return Err(error(
                    ProjectErrorCode::ProviderUnavailable,
                    &self.with_stderr("el servidor MCP no respondió a tiempo"),
                ));
            }
            let message = match self.lines.recv_timeout(until - now) {
                Ok(message) => message,
                // El proceso cerró su salida: no va a llegar ninguna respuesta.
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(error(
                        ProjectErrorCode::ProviderUnavailable,
                        &self.with_stderr(
                            "el servidor MCP terminó sin responder; revisá el comando y su registro",
                        ),
                    ));
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(error(
                        ProjectErrorCode::ProviderUnavailable,
                        &self.with_stderr("el servidor MCP no respondió a tiempo"),
                    ));
                }
            };
            let value: Value = match serde_json::from_str(&message) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                // Logs and notifications are not part of this request.
                continue;
            }
            if let Some(failure) = value.get("error") {
                let detail = failure
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("error sin detalle");
                return Err(error(
                    ProjectErrorCode::ProviderRejected,
                    &format!("el servidor MCP rechazó la operación: {detail}"),
                ));
            }
            return Ok(value);
        }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }
}

impl Drop for StdioMcpTransport {
    fn drop(&mut self) {
        kill_tree(&mut self.child);
    }
}

/// Fabrica el transporte real sobre stdio.
pub struct StdioMcpTransportFactory;

impl McpTransportFactory for StdioMcpTransportFactory {
    fn spawn(
        &self,
        server: &McpServerConfig,
        env: &BTreeMap<String, String>,
    ) -> Result<Box<dyn McpTransport>, ProjectError> {
        StdioMcpTransport::spawn_inner(server, env).map(|process| Box::new(process) as _)
    }
}

// ---------------------------------------------------------------------------
// Constructores de composición (usados por AppState, no por application/)
// ---------------------------------------------------------------------------

/// Store JSON de servidores MCP dentro del config dir de la app.
pub fn config_dir_store(config_dir: &std::path::Path) -> LocalMcpServerStore {
    LocalMcpServerStore {
        dir: config_dir.to_path_buf(),
    }
}

/// Secretos de entorno MCP en el llavero del sistema.
pub fn keyring_env() -> KeyringMcpEnv {
    KeyringMcpEnv
}

/// Transporte stdio real (proceso hijo con pipes).
pub fn stdio_factory() -> StdioMcpTransportFactory {
    StdioMcpTransportFactory
}
