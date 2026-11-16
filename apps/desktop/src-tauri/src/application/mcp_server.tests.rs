//! Tests del ciclo de vida del servidor MCP embebido: start idempotente,
//! stop que aborta el runtime real y estado consistente después.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

use super::*;
use crate::ports::mcp_server::{McpServerRuntime, McpServerToken};

struct FakeTokenStore;

impl McpServerToken for FakeTokenStore {
    fn get_or_create(&self) -> Result<String, ProjectError> {
        Ok("token-de-prueba-mcp-server-stop".to_owned())
    }
}

struct EchoHandler;

impl McpRequestHandler for EchoHandler {
    fn handle(
        &self,
        _request: &Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Value>> + Send + '_>> {
        Box::pin(async { None })
    }

    fn handle_batch(
        &self,
        _items: &[Value],
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Value> + Send + '_>> {
        Box::pin(async { Value::Array(Vec::new()) })
    }
}

/// Runtime falso: registra el abort para verificar que `stop_server`
/// realmente lo invoca (no sólo limpia la info publicada).
struct FakeRuntime {
    aborted: Arc<AtomicBool>,
}

impl McpServerRuntime for FakeRuntime {
    fn abort(&self) {
        self.aborted.store(true, Ordering::SeqCst);
    }
}

fn serve_with_flag(
    flag: Arc<AtomicBool>,
) -> impl FnOnce(String, Arc<dyn McpRequestHandler>) -> Result<Box<dyn McpServerRuntime>, ProjectError>
{
    move |_token, _handler| Ok(Box::new(FakeRuntime { aborted: flag }))
}

#[tokio::test]
async fn start_is_idempotent_and_stop_aborts_the_runtime() {
    // Estado limpio al entrar: si otra corrida dejó el servidor arriba,
    // se detiene antes de probar (los slots son globales del proceso).
    let _ = stop_server();

    // Sin servidor: stop es idempotente y no aborta nada.
    assert!(!stop_server());
    assert!(status().is_none());

    let aborted = Arc::new(AtomicBool::new(false));
    let info = start_server(
        &FakeTokenStore,
        Arc::new(EchoHandler),
        serve_with_flag(aborted.clone()),
    )
    .await
    .expect("start_server debe publicar el servidor");
    assert!(info.url.contains("127.0.0.1"));
    assert_eq!(
        status().as_ref().map(|s| s.url.clone()),
        Some(info.url.clone())
    );

    // Segundo start devuelve la MISMA info sin re-bindear ni reemplazar
    // el runtime (el flag sigue en false hasta el stop).
    let again = start_server(
        &FakeTokenStore,
        Arc::new(EchoHandler),
        serve_with_flag(Arc::new(AtomicBool::new(false))),
    )
    .await
    .expect("start sobre servidor vivo es idempotente");
    assert_eq!(again.url, info.url);
    assert!(!aborted.load(Ordering::SeqCst));

    // Stop: aborta el runtime guardado y limpia el estado publicado.
    assert!(stop_server());
    assert!(
        aborted.load(Ordering::SeqCst),
        "stop debe abortar el listener"
    );
    assert!(status().is_none());

    // Doble stop: la segunda no encuentra nada.
    assert!(!stop_server());

    // Tras el stop se puede volver a arrancar (puerto liberado).
    let restarted = start_server(
        &FakeTokenStore,
        Arc::new(EchoHandler),
        serve_with_flag(Arc::new(AtomicBool::new(false))),
    )
    .await
    .expect("el servidor debe poder reiniciarse tras stop");
    assert_eq!(restarted.url, info.url);
    assert!(stop_server(), "limpieza final del estado global");
    assert!(status().is_none());
}

// Nota: un solo test toca los slots globales del servidor (info/runtime);
// partirlo en varios los haría correr en paralelo y competir por el estado.
