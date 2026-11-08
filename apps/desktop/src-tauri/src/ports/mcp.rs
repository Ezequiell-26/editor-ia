//! Ports del cliente MCP: persistencia de configuración, secretos de
//! entorno y transporte stdio de procesos.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::Value;

use crate::mcp::client::{McpServerConfig, ResolvedEnv};
use crate::projects::service::ProjectError;

/// Persistencia del archivo `mcp-servers.json` (lectura y publicación
/// atómica son responsabilidad del adaptador).
pub trait McpServerStore {
    fn read_servers(&self) -> Result<Vec<McpServerConfig>, ProjectError>;
    fn write_servers(&self, servers: &[McpServerConfig]) -> Result<(), ProjectError>;
}

/// Secretos de variables de entorno por servidor (keyring en la
/// implementación real). Los valores nunca se persisten en el JSON.
pub trait McpEnvSecrets {
    /// Lee todas las `env_keys` del servidor. Falla si falta alguna.
    fn read_env(&self, server: &McpServerConfig) -> Result<ResolvedEnv, ProjectError>;
    /// Guarda (o actualiza) el valor de una variable.
    fn set_env(&self, server_id: &str, key: &str, value: &str) -> Result<(), ProjectError>;
    /// Borra una credencial suelta (variable retirada de la config).
    fn remove_key(&self, server_id: &str, key: &str);
    /// Borra todas las credenciales del servidor.
    fn remove_env(&self, server: &McpServerConfig);
}

/// Un proceso MCP vivo con transporte JSON-RPC newline-delimited.
/// Implementación real: `StdioMcpTransport` en infrastructure.
pub trait McpTransport: Send {
    /// Escribe un mensaje JSON-RPC seguido de `\n`.
    fn send(&mut self, value: &Value) -> Result<(), ProjectError>;
    /// Espera la respuesta con ese `id`, ignorando logs y notificaciones.
    /// El adaptador enriquece los errores con la cola de `stderr`.
    fn receive_for(&mut self, id: u64, timeout: Duration) -> Result<Value, ProjectError>;
    /// PID del proceso raíz, para mostrarlo en el estado de sesiones.
    fn pid(&self) -> u32;
}

/// Fabrica transportes MCP a partir de la configuración persistida.
pub trait McpTransportFactory {
    fn spawn(
        &self,
        server: &McpServerConfig,
        env: &BTreeMap<String, String>,
    ) -> Result<Box<dyn McpTransport>, ProjectError>;
}
