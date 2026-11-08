fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|window| window == b"\r\n\r\n")
}

fn read_http(stream: &mut TcpStream) -> Option<HttpRequest> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let mut data: Vec<u8> = Vec::with_capacity(8_192);
    let mut buffer = [0u8; 8_192];
    loop {
        if let Some(header_end) = find_header_end(&data) {
            let head = String::from_utf8_lossy(&data[..header_end]).into_owned();
            let mut lines = head.split("\r\n");
            let mut request_parts = lines.next()?.split_whitespace();
            let method = request_parts.next()?.to_ascii_uppercase();
            let path = request_parts.next()?.split('?').next()?.to_owned();
            let mut headers = BTreeMap::new();
            for line in lines {
                if let Some((key, value)) = line.split_once(':') {
                    headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
                }
            }
            let content_length = headers
                .get("content-length")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            if content_length > MAX_BODY_BYTES {
                return None;
            }
            let body_start = header_end + 4;
            while data.len() < body_start + content_length {
                let read = stream.read(&mut buffer).ok()?;
                if read == 0 {
                    break;
                }
                data.extend_from_slice(&buffer[..read]);
            }
            let body = data
                .get(body_start..body_start.saturating_add(content_length))
                .unwrap_or(&[])
                .to_vec();
            return Some(HttpRequest {
                method,
                path,
                headers,
                body,
            });
        }
        if data.len() > 128 * 1024 {
            return None;
        }
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 {
            return None;
        }
        data.extend_from_slice(&buffer[..read]);
    }
}

fn respond(mut stream: TcpStream, status: u16, body: String) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        _ => "Error",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type, x-editoria-token\r\nAccess-Control-Max-Age: 600\r\nConnection: close\r\n\r\n",
        body.as_bytes().len()
    );
    let _ = stream.write_all(headers.as_bytes());
    if status != 204 {
        let _ = stream.write_all(body.as_bytes());
    }
    let _ = stream.flush();
}

fn error_body(message: impl Into<String>) -> String {
    json!({ "error": message.into() }).to_string()
}

fn handle_connection(
    mut stream: TcpStream,
    app: &AppHandle,
    token: &str,
    job_state: &Arc<Mutex<Option<BridgeJob>>>,
    downloads_dir: &Path,
    cache_dir: &Path,
) {
    let Some(request) = read_http(&mut stream) else {
        respond(stream, 400, error_body("Solicitud local inválida."));
        return;
    };
    if request.method == "OPTIONS" {
        respond(stream, 204, String::new());
        return;
    }
    if request.method == "GET" && request.path == "/v1/health" {
        respond(
            stream,
            200,
            json!({
                "ok": true,
                "app": "editor-ia",
                "version": env!("CARGO_PKG_VERSION")
            })
            .to_string(),
        );
        return;
    }
    let authorized = request
        .headers
        .get("x-editoria-token")
        .map(|candidate| token_matches(candidate, token))
        .unwrap_or(false);
    if !authorized {
        respond(
            stream,
            401,
            error_body("Pegá el token de Editor IA en la extensión."),
        );
        return;
    }
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/v1/ping") => {
            respond(stream, 200, json!({ "ok": true }).to_string());
        }
        ("POST", "/v1/probe") => probe_route(stream, app, &request.body),
        ("POST", "/v1/download") => download_route(
            stream,
            app,
            job_state,
            downloads_dir,
            cache_dir,
            &request.body,
        ),
        ("GET", path) if path.starts_with("/v1/jobs/") => {
            let id = path.trim_start_matches("/v1/jobs/");
            let guard = match job_state.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    respond(
                        stream,
                        500,
                        error_body("El estado de descarga no está disponible."),
                    );
                    return;
                }
            };
            match guard.as_ref() {
                Some(job) if job.id == id => {
                    respond(
                        stream,
                        200,
                        serde_json::to_string(job)
                            .unwrap_or_else(|_| error_body("No se pudo leer el estado.")),
                    );
                }
                _ => respond(stream, 404, error_body("Esa descarga no existe.")),
            }
        }
        _ => respond(stream, 404, error_body("Ruta no encontrada.")),
    }
}
