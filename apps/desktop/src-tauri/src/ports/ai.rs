//! Puertos del dominio AI.
//!
//! Secretos (Windows Credential Manager), settings del proveedor y las dos
//! llamadas HTTP (chat completions y sondeo `/models`) se resuelven en
//! `infrastructure::ai`; los casos de uso en `application::providers`.

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

use crate::ai::providers::ProviderTestResult;
use crate::projects::service::ProjectError;

/// Configuración no secreta del proveedor (`kind`, `base_url`, `model`).
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub kind: String,
    pub base_url: String,
    pub model: String,
}

/// API key del proveedor en el almacén de credenciales del SO.
pub trait ProviderSecrets: Send + Sync {
    /// Clave guardada, o `None` si no hay o está vacía.
    fn read_key(&self) -> Option<String>;
    /// Guarda la clave (rechaza valores de menos de 8 caracteres).
    fn set_key(&self, secret: &str) -> Result<(), ProjectError>;
    /// Borra la credencial (mejor esfuerzo: no existe → ok).
    fn clear_key(&self);
    /// El almacén de credenciales está disponible en esta máquina.
    fn available(&self) -> bool;
}

/// Persistencia de la configuración no secreta del proveedor.
pub trait ProviderSettingsStore: Send + Sync {
    fn provider(&self) -> Result<ProviderConfig, ProjectError>;
    fn save_provider(&self, config: &ProviderConfig) -> Result<(), ProjectError>;
}

/// Petición de chat completions con ownership propio (cruza el boundary del
/// port; los `&str` del comando se convierten acá).
#[derive(Debug, Clone)]
pub struct ChatCall {
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
    pub messages: Vec<Value>,
    pub key: Option<String>,
}

/// Llamada a `/chat/completions` con JSON mode y fallback del endpoint.
pub trait ProviderChat: Send + Sync {
    fn chat<'a>(
        &'a self,
        call: ChatCall,
    ) -> Pin<Box<dyn Future<Output = Result<String, ProjectError>> + Send + 'a>>;
}

/// Sondeo real de `{base}/models` con clasificación de errores.
pub trait ProviderProbe: Send + Sync {
    fn probe<'a>(
        &'a self,
        base_url: &'a str,
        model: &'a str,
        key: Option<String>,
        timeout: std::time::Duration,
    ) -> Pin<Box<dyn Future<Output = ProviderTestResult> + Send + 'a>>;
}

/// Petición de una completion simple sin JSON mode (motion_ai): el comando
/// histórico hacía un único POST y mapeaba los errores con mensajes propios.
#[derive(Debug, Clone)]
pub struct MotionChatCall {
    pub base_url: String,
    pub model: String,
    pub system: String,
    pub user: String,
    pub key: Option<String>,
    /// `0.4` para motion, `0.2` para el emparejado de medios.
    pub temperature: f64,
}

/// POST único a `/chat/completions` que devuelve el payload JSON completo;
/// la extracción de `choices[0].message.content` queda en el dominio.
pub trait MotionChat: Send + Sync {
    fn complete<'a>(
        &'a self,
        call: MotionChatCall,
    ) -> Pin<Box<dyn Future<Output = Result<Value, ProjectError>> + Send + 'a>>;
}

/// POST único a `/chat/completions` para el emparejado narración↔imágenes:
/// misma forma que `MotionChat` pero con los mensajes de error propios del
/// comando `match_media_plan`.
pub trait MediaMatchChat: Send + Sync {
    fn complete<'a>(
        &'a self,
        call: MotionChatCall,
    ) -> Pin<Box<dyn Future<Output = Result<Value, ProjectError>> + Send + 'a>>;
}
