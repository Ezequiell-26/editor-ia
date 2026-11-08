//! Ports del servidor MCP embebido: token persistente, bridge de
//! herramientas hacia la ventana, handler de requests y detección de
//! clientes de IA externos.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use serde_json::Value;

use crate::mcp::server::{AutoconnectResult, DetectedClient, McpReply, McpServerInfo};
use crate::projects::service::ProjectError;

/// Token Bearer estable del servidor, persistido en el Credential Manager.
pub trait McpServerToken {
    fn get_or_create(&self) -> Result<String, ProjectError>;
}

/// Ejecuta una herramienta MCP en la ventana del editor y espera la
/// respuesta (el mismo camino que usa el asistente).
pub trait McpToolInvoker: Send + Sync {
    fn invoke(
        &self,
        tool: &str,
        args: &Value,
        wait: Duration,
    ) -> Pin<Box<dyn Future<Output = McpReply> + Send + '_>>;
}

/// Dispatcher JSON-RPC que el servidor HTTP consulta por cada request.
/// Lo implementa `application::mcp_server` sobre un `McpToolInvoker`.
pub trait McpRequestHandler: Send + Sync {
    /// Request simple → respuesta (o `None` para notificación → HTTP 202).
    fn handle(&self, request: &Value) -> Pin<Box<dyn Future<Output = Option<Value>> + Send + '_>>;
    /// Lote JSON-RPC → array de respuestas en el orden recibido.
    fn handle_batch(&self, items: &[Value]) -> Pin<Box<dyn Future<Output = Value> + Send + '_>>;
}

/// Detección y escritura de configuración de clientes de IA externos
/// (Claude Desktop, Antigravity).
pub trait AiClientConfigs {
    /// Clientes conocidos con su estado de instalación real.
    fn detect(&self) -> Vec<DetectedClient>;
    /// Archivo de configuración del cliente, si la app está instalada.
    fn config_path(&self, client: &str) -> Result<PathBuf, ProjectError>;
    /// El cliente está instalado en este equipo.
    fn installed(&self, client: &str) -> bool;
    /// URL de descarga para el mensaje de error.
    fn download_url(&self, client: &str) -> &'static str;
    /// Escribe la entrada `olyvia` preservando el resto del archivo.
    fn write_olyvia_entry(
        &self,
        path: &PathBuf,
        info: &McpServerInfo,
    ) -> Result<AutoconnectResult, ProjectError>;
}
