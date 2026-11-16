//! Lectura acotada de cuerpos HTTP de proveedores (motores locales,
//! APIs de voz, diarización). Los bodies de respuesta no se conocen por
//! adelantado: `Content-Length` es sólo un filtro preliminar — puede
//! faltar o mentir— así que el stream se corta en cuanto se supera
//! `limit`, sin reservar el cuerpo entero en memoria.

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Lee el cuerpo por chunks con tope estricto. `code`, `too_large` e
/// `interrupted` los elige el llamador: cada proveedor tiene su propio
/// código de error y redacta sus mensajes.
pub async fn read_body_capped(
    mut response: reqwest::Response,
    limit: usize,
    code: ProjectErrorCode,
    too_large: &str,
    interrupted: &str,
) -> Result<Vec<u8>, ProjectError> {
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err(ProjectError::message(code, too_large));
    }
    let mut buf = Vec::new();
    loop {
        let chunk = response
            .chunk()
            .await
            .map_err(|_| ProjectError::message(code, interrupted))?;
        let Some(chunk) = chunk else { break };
        if buf.len() + chunk.len() > limit {
            return Err(ProjectError::message(code, too_large));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Sirve una respuesta HTTP/1.1 cruda en loopback y devuelve la URL.
    /// `head` va tal cual (sin la línea de estado); el cuerpo se escribe y
    /// el socket se cierra, lo que delimita bodies sin Content-Length.
    fn spawn_raw_server(head: &'static str, body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\n");
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(b"\r\n\r\n");
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
        });
        format!("http://{addr}/")
    }

    async fn fetch(url: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(url)
            .send()
            .await
            .expect("respuesta del servidor de prueba")
    }

    #[tokio::test]
    async fn rejects_on_content_length_before_reading() {
        let body = vec![0u8; 8192];
        let url = spawn_raw_server("Content-Length: 5000\r\nConnection: close", body);
        let response = fetch(&url).await;
        let error = read_body_capped(
            response,
            1024,
            ProjectErrorCode::InvalidProviderResponse,
            "supera el límite",
            "se cortó",
        )
        .await
        .expect_err("Content-Length mayor que el límite debe fallar");
        assert!(error.message.contains("supera el límite"), "{error:?}");
    }

    #[tokio::test]
    async fn cuts_the_stream_at_the_limit() {
        // Sin Content-Length el cuerpo llega delimitado por el cierre:
        // el tope debe actuar a mitad del stream, no al final.
        let body = vec![0xABu8; 8192];
        let url = spawn_raw_server("Connection: close", body);
        let response = fetch(&url).await;
        let error = read_body_capped(
            response,
            1024,
            ProjectErrorCode::InvalidProviderResponse,
            "supera el límite",
            "se cortó",
        )
        .await
        .expect_err("el stream debe cortarse al superar el límite");
        assert!(error.message.contains("supera el límite"), "{error:?}");
    }

    #[tokio::test]
    async fn returns_the_body_under_the_limit() {
        let url = spawn_raw_server("Connection: close", b"hola".to_vec());
        let response = fetch(&url).await;
        let body = read_body_capped(
            response,
            1024,
            ProjectErrorCode::InvalidProviderResponse,
            "supera el límite",
            "se cortó",
        )
        .await
        .expect("cuerpo chico debe leerse completo");
        assert_eq!(body, b"hola");
    }
}
