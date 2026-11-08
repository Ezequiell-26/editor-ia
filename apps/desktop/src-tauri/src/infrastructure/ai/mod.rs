//! Adaptadores del dominio AI.
//!
//! - `secrets`: API key en el Windows Credential Manager.
//! - `settings`: `ProviderSettings` de `AppState` ↔ `ProviderConfig`.
//! - `chat`: `/chat/completions` con JSON mode y fallback.
//! - `probe`: sondeo `{base}/models` con errores clasificados.
//! - `single_shot`: POST único compartido por motion y media-match.
//!
//! Fachada: los consumidores siguen usando `infrastructure::ai::*`.

mod chat;
mod probe;
mod secrets;
mod settings;
mod single_shot;

pub use chat::ReqwestProviderChat;
pub use probe::ReqwestProviderProbe;
pub use secrets::KeyringProviderSecrets;
pub use settings::StateProviderSettings;
pub use single_shot::{ReqwestMediaMatchChat, ReqwestMotionChat};

/// Servidor HTTP mínimo para tests: atiende una respuesta por conexión y
/// cierra. Comparte el harness entre los tests de chat y probe.
#[cfg(test)]
pub(super) mod test_server {
    use serde_json::json;

    pub fn http_response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Sirve `responses` en orden sobre un listener local y devuelve la base
    /// URL `…/v1` más el handle del servidor.
    pub async fn serve(responses: Vec<String>) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("puerto de prueba");
        let address = listener.local_addr().expect("dirección");
        let handle = tokio::spawn(async move {
            for response in responses {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buffer = [0u8; 4096];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            }
        });
        (format!("http://{address}/v1"), handle)
    }

    pub fn chat_call(base_url: &str) -> crate::ports::ai::ChatCall {
        crate::ports::ai::ChatCall {
            base_url: base_url.to_owned(),
            model: "m".to_owned(),
            temperature: 0.0,
            messages: vec![json!({ "role": "user", "content": "x" })],
            key: None,
        }
    }
}
