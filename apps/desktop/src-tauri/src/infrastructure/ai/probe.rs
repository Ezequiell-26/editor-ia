//! Sondeo `{base}/models` sobre reqwest async con errores clasificados.

use std::future::Future;
use std::pin::Pin;
use std::time::Instant;

use crate::ai::providers::{
    http_failure_detail, models_endpoint, parse_model_ids, provider_test_result,
    ProviderTestResult, MAX_MODELS_BODY_BYTES,
};
use crate::ports::ai::ProviderProbe;

/// Sondeo `{base}/models` sobre reqwest async.
pub struct ReqwestProviderProbe;

impl ProviderProbe for ReqwestProviderProbe {
    fn probe<'a>(
        &'a self,
        base_url: &'a str,
        model: &'a str,
        key: Option<String>,
        timeout: std::time::Duration,
    ) -> Pin<Box<dyn Future<Output = ProviderTestResult> + Send + 'a>> {
        Box::pin(async move { probe_models(base_url, model, key.as_deref(), timeout).await })
    }
}

/// Sondeo real del endpoint. Devuelve un resultado **tipado** (éxito, 401,
/// 404, timeout, sin conexión) con el modelo configurado verificado contra la
/// lista, sin lanzar la excepción genérica del primer error de generación.
async fn probe_models(
    base_url: &str,
    configured_model: &str,
    key: Option<&str>,
    timeout: std::time::Duration,
) -> ProviderTestResult {
    let started = Instant::now();
    let client = match reqwest::Client::builder().timeout(timeout).build() {
        Ok(client) => client,
        Err(_) => {
            return provider_test_result(
                "unreachable",
                false,
                None,
                started.elapsed().as_millis() as u64,
                None,
                "no se pudo preparar la conexión HTTP".to_owned(),
                base_url,
            );
        }
    };
    let mut call = client
        .get(models_endpoint(base_url))
        .header("Accept", "application/json");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = match call.send().await {
        Ok(response) => response,
        Err(error) => {
            let latency_ms = started.elapsed().as_millis() as u64;
            let (status, detail) = if error.is_timeout() {
                let waited = if timeout.as_millis() < 1_000 {
                    format!("{} ms", timeout.as_millis())
                } else {
                    format!("{} segundos", timeout.as_secs())
                };
                (
                    "timeout",
                    format!(
                        "el proveedor no respondió en {waited}; revisá que Ollama/servicio esté encendido y la URL"
                    ),
                )
            } else if error.is_connect() {
                (
                    "unreachable",
                    "no se pudo conectar: el servicio está apagado, la URL es incorrecta o un firewall bloquea el puerto"
                        .to_owned(),
                )
            } else {
                (
                    "unreachable",
                    "la conexión con el proveedor falló antes de recibir respuesta".to_owned(),
                )
            };
            return provider_test_result(status, false, None, latency_ms, None, detail, base_url);
        }
    };
    let http_status = response.status().as_u16();
    let latency_ms = started.elapsed().as_millis() as u64;
    if !response.status().is_success() {
        let (status, detail) = http_failure_detail(http_status);
        return provider_test_result(
            status,
            false,
            Some(http_status),
            latency_ms,
            None,
            detail,
            base_url,
        );
    }
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(_) => {
            return provider_test_result(
                "invalid-response",
                false,
                Some(http_status),
                latency_ms,
                None,
                "el proveedor respondió pero el cuerpo no se pudo leer".to_owned(),
                base_url,
            );
        }
    };
    if body.len() > MAX_MODELS_BODY_BYTES {
        return provider_test_result(
            "invalid-response",
            false,
            Some(http_status),
            latency_ms,
            None,
            "la lista de modelos supera el límite de 2 MB".to_owned(),
            base_url,
        );
    }
    let Some(models) = parse_model_ids(&body) else {
        return provider_test_result(
            "invalid-response",
            false,
            Some(http_status),
            latency_ms,
            None,
            "el proveedor respondió 200 pero el cuerpo no es una lista de modelos compatible"
                .to_owned(),
            base_url,
        );
    };
    if models.iter().any(|id| id == configured_model.trim()) {
        return provider_test_result(
            "ok",
            true,
            Some(http_status),
            latency_ms,
            Some(configured_model.trim().to_owned()),
            format!(
                "conexión correcta: el modelo configurado «{}» está disponible en el proveedor",
                configured_model.trim()
            ),
            base_url,
        );
    }
    if let Some(first) = models.first() {
        return provider_test_result(
            "ok",
            true,
            Some(http_status),
            latency_ms,
            Some(first.clone()),
            format!(
                "conexión correcta, pero el modelo configurado «{}» no aparece en la lista (por ejemplo «{first}»); revisá el nombre o descargalo",
                configured_model.trim()
            ),
            base_url,
        );
    }
    provider_test_result(
        "ok",
        true,
        Some(http_status),
        latency_ms,
        None,
        "conexión correcta, pero el proveedor no listó ningún modelo; verificá el nombre del modelo con una generación"
            .to_owned(),
        base_url,
    )
}

#[cfg(test)]
mod tests {
    use super::super::test_server::{http_response, serve};
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn provider_test_reports_success_with_the_configured_model() {
        let (base, server) = serve(vec![http_response(
            "200 OK",
            r#"{"data":[{"id":"llama3.1"},{"id":"qwen2.5"}]}"#,
        )])
        .await;
        let result = probe_models(&base, "llama3.1", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(result.ok, "{result:?}");
        assert_eq!(result.status, "ok");
        assert_eq!(result.http_status, Some(200));
        assert_eq!(result.model.as_deref(), Some("llama3.1"));
        assert!(result.detail.contains("llama3.1"), "{result:?}");
    }

    #[tokio::test]
    async fn provider_test_warns_when_the_configured_model_is_not_listed() {
        let (base, server) = serve(vec![http_response(
            "200 OK",
            r#"{"data":[{"id":"llama3.1"}]}"#,
        )])
        .await;
        let result = probe_models(&base, "modelo-inexistente", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(result.ok);
        assert_eq!(result.model.as_deref(), Some("llama3.1"));
        assert!(result.detail.contains("no aparece"), "{result:?}");
    }

    #[tokio::test]
    async fn provider_test_classifies_401_and_404() {
        let (base, server) = serve(vec![http_response(
            "401 Unauthorized",
            r#"{"error":"bad key"}"#,
        )])
        .await;
        let unauthorized = probe_models(&base, "m", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(!unauthorized.ok);
        assert_eq!(unauthorized.status, "unauthorized");
        assert_eq!(unauthorized.http_status, Some(401));
        assert!(unauthorized.detail.contains("401"), "{unauthorized:?}");

        let (base, server) =
            serve(vec![http_response("404 Not Found", r#"{"error":"nope"}"#)]).await;
        let not_found = probe_models(&base, "m", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(!not_found.ok);
        assert_eq!(not_found.status, "not-found");
        assert_eq!(not_found.http_status, Some(404));
        assert!(not_found.detail.contains("/v1"), "{not_found:?}");
    }

    #[tokio::test]
    async fn provider_test_reports_timeout() {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("puerto de prueba");
        let address = listener.local_addr().expect("dirección");
        let slow = tokio::spawn(async move {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let mut buffer = [0u8; 4096];
            let _ = socket.read(&mut buffer).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let timeout = probe_models(
            &format!("http://{address}/v1"),
            "m",
            None,
            Duration::from_millis(150),
        )
        .await;
        slow.abort();
        assert!(!timeout.ok);
        assert_eq!(timeout.status, "timeout", "{timeout:?}");
        assert!(timeout.detail.contains("150 ms"), "{timeout:?}");
    }

    #[tokio::test]
    async fn provider_test_classifies_transport_failures_as_unreachable() {
        // URL no parseable: el error de transporte no debe confundirse con un
        // rechazo del proveedor ni con un timeout.
        let invalid = probe_models("sin esquema", "m", None, Duration::from_millis(300)).await;
        assert!(!invalid.ok);
        assert_eq!(invalid.status, "unreachable", "{invalid:?}");

        // Puerto cerrado: según el stack de red el error puede ser un rechazo
        // inmediato o un timeout de conexión; ambos son fallos de transporte.
        let closed = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("puerto libre");
        let port = closed.local_addr().expect("dirección").port();
        drop(closed);
        let refused = probe_models(
            &format!("http://127.0.0.1:{port}/v1"),
            "m",
            None,
            Duration::from_millis(400),
        )
        .await;
        assert!(!refused.ok, "{refused:?}");
        assert!(
            matches!(refused.status.as_str(), "unreachable" | "timeout"),
            "{refused:?}"
        );
    }
}
