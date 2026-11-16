fn read_http(stream: &mut TcpStream) -> Option<HttpRequest> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let mut data: Vec<u8> = Vec::with_capacity(8_192);
    let mut buffer = [0u8; 8_192];
    loop {
        // Head completo pero inválido → request rechazada de una vez.
        if find_header_end(&data).is_some() {
            let head = parse_http_head(&data)?;
            while data.len() < head.body_start + head.content_length {
                let read = stream.read(&mut buffer).ok()?;
                if read == 0 {
                    break;
                }
                data.extend_from_slice(&buffer[..read]);
            }
            let body = data
                .get(head.body_start..head.body_start.saturating_add(head.content_length))
                .unwrap_or(&[])
                .to_vec();
            return Some(HttpRequest {
                method: head.method,
                path: head.path,
                headers: head.headers,
                body,
            });
        }
        if data.len() > MAX_HEADER_BYTES {
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
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    if status != 204 {
        let _ = stream.write_all(body.as_bytes());
    }
    let _ = stream.flush();
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
