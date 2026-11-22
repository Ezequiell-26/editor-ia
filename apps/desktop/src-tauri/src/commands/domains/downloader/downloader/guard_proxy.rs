// Proxy HTTP local de validación para yt-dlp (cierre del residual AUD-032).
//
// yt-dlp resuelve DNS y conecta por su cuenta: las URLs de medios que
// descubre el extractor nunca pasaban por `net_guard`. Al lanzar el
// motor con `--proxy http://127.0.0.1:<puerto>`, cada destino pedido por
// el subproceso entra por este listener y se valida antes de abrir el
// upstream:
//
// - `CONNECT host:port` (https): se valida el authority y se hace
//   tunnel TCP opaco — el TLS va dentro, como en cualquier proxy.
// - URI absoluta `http://…` (http): se valida la URL completa y se
//   reenvía la request verbatim con `Connection: close` forzado, así el
//   cliente abre una conexión nueva —y revalidada— por cada request.
//
// La validación usa las mismas reglas que `net_guard` (esquema, host,
// IP literal y DNS) y además **fija la IP**: resuelve una vez y conecta
// al socket ya validado, sin la ventana TOCTOU de validar-y-reconectar
// por nombre.
//
// Este archivo entra por `include!` en `downloader.rs`: no declarar
// imports que el módulo padre ya tenga (Read, Arc, thread, Duration,
// AtomicBool/Ordering) ni doc comments `//!`.

use std::io::Write;
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};

use crate::application::net_guard::{check_url_parts as guard_check_url_parts, ip_is_forbidden};

/// Tope del head HTTP (request line + headers). Las cookies de yt-dlp
/// entran holgadas; más que esto es un cliente abusivo.
const MAX_HEAD_BYTES: usize = 256 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(20);

/// Proxy escuchando en loopback. Vive lo que dure la descarga/probe que
/// lo creó: `Drop` baja el listener (las conexiones en curso terminan
/// solas cuando el subproceso cierra el socket).
pub(crate) struct GuardProxy {
    addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
}

impl GuardProxy {
    /// Abre el listener en `127.0.0.1:0` y devuelve la URL para `--proxy`.
    pub(crate) fn start() -> Result<Self, String> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|error| format!("no se pudo abrir el proxy local: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("no se pudo abrir el proxy local: {error}"))?;
        let addr = listener
            .local_addr()
            .map_err(|error| format!("no se pudo abrir el proxy local: {error}"))?;
        let shutdown = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&shutdown);
        thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        thread::spawn(move || handle_connection(stream));
                    }
                    Err(_) => thread::sleep(Duration::from_millis(50)),
                }
            }
        });
        Ok(Self { addr, shutdown })
    }

    pub(crate) fn proxy_url(&self) -> String {
        format!("http://{}", self.addr)
    }
}

impl Drop for GuardProxy {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Conexión de cortesía para despertar al accept si estaba en
        // `accept()` bloqueante; el flag igual lo apaga en ≤50 ms.
        let _ = TcpStream::connect(self.addr);
    }
}

fn handle_connection(mut client: TcpStream) {
    let _ = client.set_nodelay(true);
    let mut reader = match client.try_clone() {
        Ok(stream) => stream,
        Err(_) => return,
    };
    // Head completo (request line + headers + lo que ya haya llegado del
    // body): se reenvía verbatim en modo http:// y se descarta el extra
    // en CONNECT (el cliente espera el 200 antes de mandar TLS).
    let mut head = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        if let Some(pos) = find_subslice(&head, b"\r\n\r\n") {
            break pos + 4;
        }
        if head.len() > MAX_HEAD_BYTES {
            respond(&mut reader, 431, "Request Header Fields Too Large");
            return;
        }
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => head.extend_from_slice(&chunk[..n]),
        }
    };
    let request_line = String::from_utf8_lossy(&head[..header_end])
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method.is_empty() || target.is_empty() {
        respond(&mut reader, 400, "Bad Request");
        return;
    }

    let upstream = if method.eq_ignore_ascii_case("CONNECT") {
        match open_connect(target) {
            Ok(stream) => {
                if client
                    .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    .is_err()
                {
                    return;
                }
                stream
            }
            Err(status) => {
                respond(&mut reader, status.0, status.1);
                return;
            }
        }
    } else {
        match open_plain_http(&head[..header_end], target) {
            Ok((stream, rewritten)) => {
                // `rewritten` reemplaza al head original: misma request con
                // `Connection: close` para forzar re-validación por request.
                let mut up = match stream.try_clone() {
                    Ok(s) => s,
                    Err(_) => return,
                };
                if up.write_all(&rewritten).is_err() {
                    return;
                }
                if let Some(extra) = head.get(header_end..) {
                    if !extra.is_empty() && up.write_all(extra).is_err() {
                        return;
                    }
                }
                stream
            }
            Err(status) => {
                respond(&mut reader, status.0, status.1);
                return;
            }
        }
    };

    if method.eq_ignore_ascii_case("CONNECT") {
        // Payload ya recibido tras el head del CONNECT (raro pero posible).
        if let Some(extra) = head.get(header_end..) {
            if !extra.is_empty() {
                let mut up = match upstream.try_clone() {
                    Ok(s) => s,
                    Err(_) => return,
                };
                if up.write_all(extra).is_err() {
                    return;
                }
            }
        }
    }
    tunnel(client, upstream);
}

/// `CONNECT authority` → upstream. Devuelve `(status, reason)` para la
/// respuesta de error al cliente.
fn open_connect(authority: &str) -> Result<TcpStream, (u16, &'static str)> {
    let (host, port) = parse_authority(authority)
        .ok_or((400, "Bad Request"))?;
    let url = url_for(&host, port, "https")
        .ok_or((403, "Forbidden"))?;
    guard_check_url_parts(&url).map_err(|_| (403, "Forbidden"))?;
    connect_public(&host, port).map_err(|_| (403, "Forbidden"))
}

/// Request en forma absoluta `http://host[:port]/path`. Devuelve el
/// upstream y el head reescrito con `Connection: close`.
fn open_plain_http(
    head_bytes: &[u8],
    target: &str,
) -> Result<(TcpStream, Vec<u8>), (u16, &'static str)> {
    if !target.starts_with("http://") {
        return Err((403, "Forbidden"));
    }
    let url = reqwest::Url::parse(target).map_err(|_| (400, "Bad Request"))?;
    if url.scheme() != "http" {
        return Err((403, "Forbidden"));
    }
    guard_check_url_parts(&url).map_err(|_| (403, "Forbidden"))?;
    let host = url.host_str().unwrap_or("").to_string();
    let port = url.port_or_known_default().unwrap_or(80);
    if host.is_empty() {
        return Err((400, "Bad Request"));
    }
    let stream = connect_public(&host, port).map_err(|_| (403, "Forbidden"))?;
    let rewritten = force_connection_close(head_bytes);
    Ok((stream, rewritten))
}

/// `host:port` o `[v6]:port` del authority de CONNECT.
fn parse_authority(authority: &str) -> Option<(String, u16)> {
    let authority = authority.trim();
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = rest[..end].to_string();
        let port = rest[end + 1..].strip_prefix(':')?.parse().ok()?;
        Some((host, port))
    } else {
        let (host, port) = authority.rsplit_once(':')?;
        if host.is_empty() {
            return None;
        }
        Some((host.to_string(), port.parse().ok()?))
    }
}

fn url_for(host: &str, port: u16, scheme: &str) -> Option<reqwest::Url> {
    let literal = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    reqwest::Url::parse(&format!("{scheme}://{literal}:{port}/")).ok()
}

/// Resuelve el nombre UNA vez y conecta a la IP ya validada: si cualquier
/// respuesta de DNS es privada/local se rechaza (misma regla que
/// `ensure_public_resolution`) y no hay ventana de re-resolución.
fn connect_public(host: &str, port: u16) -> Result<TcpStream, String> {
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| "no se pudo resolver el destino".to_string())?
        .collect();
    if addrs.is_empty() {
        return Err("no se pudo resolver el destino".to_string());
    }
    if addrs.iter().any(|addr| ip_is_forbidden(&addr.ip())) {
        return Err("el destino resuelve a una dirección local o privada".to_string());
    }
    TcpStream::connect_timeout(&addrs[0], UPSTREAM_TIMEOUT)
        .map_err(|error| format!("no se pudo conectar con el destino: {error}"))
}

/// Reescribe el head HTTP para que el origen cierre la conexión: así cada
/// request siguiente del cliente abre un socket nuevo que vuelve a pasar
/// por la validación (sin esto, keep-alive dejaría requests posteriores
/// fuera del guardia).
fn force_connection_close(head: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(head);
    let mut kept: Vec<&str> = Vec::new();
    for (index, line) in text.split_inclusive('\n').enumerate() {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if index == 0 || trimmed.is_empty() {
            kept.push(line);
            continue;
        }
        if trimmed.len() >= 11 && trimmed[..11].eq_ignore_ascii_case("connection:") {
            continue;
        }
        kept.push(line);
    }
    let mut out: Vec<u8> = kept.concat().into_bytes();
    if let Some(pos) = find_subslice(&out, b"\r\n\r\n") {
        let mut with = out[..pos].to_vec();
        with.extend_from_slice(b"\r\nConnection: close");
        with.extend_from_slice(&out[pos..]);
        out = with;
    }
    out
}

fn respond(stream: &mut TcpStream, status: u16, reason: &'static str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
}

/// Copia en ambos sentidos hasta que un lado cierre; al terminar baja los
/// dos sockets para liberar al otro hilo de copia.
fn tunnel(client: TcpStream, upstream: TcpStream) {
    let Ok(mut client_read) = client.try_clone() else { return };
    let Ok(mut upstream_write) = upstream.try_clone() else { return };
    let Ok(mut upstream_read) = upstream.try_clone() else { return };
    let Ok(mut client_write) = client.try_clone() else { return };
    let to_upstream = thread::spawn(move || {
        let _ = std::io::copy(&mut client_read, &mut upstream_write);
        let _ = upstream_write.shutdown(Shutdown::Write);
    });
    let _ = std::io::copy(&mut upstream_read, &mut client_write);
    let _ = client_write.shutdown(Shutdown::Write);
    let _ = client.shutdown(Shutdown::Both);
    let _ = upstream.shutdown(Shutdown::Both);
    let _ = to_upstream.join();
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod guard_proxy_tests {
    use super::*;

    #[test]
    fn authority_parse_acepta_host_y_v6() {
        assert_eq!(
            parse_authority("example.com:443"),
            Some(("example.com".to_string(), 443))
        );
        assert_eq!(
            parse_authority("[2001:4860:4860::8888]:443"),
            Some(("2001:4860:4860::8888".to_string(), 443))
        );
        assert_eq!(parse_authority("sin-puerto"), None);
        assert_eq!(parse_authority("host:notaport"), None);
        assert_eq!(parse_authority("[::1]"), None);
    }

    #[test]
    fn connect_public_rechaza_loopback_y_privadas() {
        assert!(connect_public("127.0.0.1", 443).is_err());
        assert!(connect_public("10.0.0.1", 443).is_err());
        assert!(connect_public("192.168.1.1", 443).is_err());
        assert!(connect_public("169.254.169.254", 443).is_err());
        assert!(connect_public("[::1]", 443).is_err() || connect_public("::1", 443).is_err());
    }

    #[test]
    fn url_parts_rechaza_localhost_y_local() {
        let url = url_for("localhost", 443, "https").unwrap();
        assert!(guard_check_url_parts(&url).is_err());
        let url = url_for("router.local", 443, "https").unwrap();
        assert!(guard_check_url_parts(&url).is_err());
        let url = url_for("example.com", 443, "https").unwrap();
        assert!(guard_check_url_parts(&url).is_ok());
    }

    #[test]
    fn force_close_quita_connection_existente() {
        let head = b"GET http://example.com/x HTTP/1.1\r\nHost: example.com\r\nConnection: keep-alive\r\n\r\n";
        let out = force_connection_close(head);
        let text = String::from_utf8_lossy(&out);
        assert!(!text.contains("keep-alive"));
        assert!(text.contains("Connection: close"));
        assert!(text.starts_with("GET http://example.com/x"));
    }

    #[test]
    fn force_close_agrega_header_si_falta() {
        let head = b"GET http://example.com/x HTTP/1.1\r\nHost: example.com\r\n\r\n";
        let out = force_connection_close(head);
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("\r\nConnection: close\r\n\r\n"));
    }

    #[test]
    fn proxy_rechaza_connect_loopback() {
        let proxy = GuardProxy::start().expect("proxy");
        let addr: SocketAddr = proxy.addr;
        let mut client = TcpStream::connect(addr).expect("connect");
        client
            .write_all(b"CONNECT 127.0.0.1:9 HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403"), "{response}");
    }

    #[test]
    fn proxy_rechaza_http_a_ip_privada() {
        let proxy = GuardProxy::start().expect("proxy");
        let mut client = TcpStream::connect(proxy.addr).expect("connect");
        client
            .write_all(b"GET http://169.254.169.254/latest/meta-data HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403"), "{response}");
    }

    #[test]
    fn proxy_rechaza_authority_malformado() {
        let proxy = GuardProxy::start().expect("proxy");
        let mut client = TcpStream::connect(proxy.addr).expect("connect");
        client
            .write_all(b"CONNECT no-es-authority HTTP/1.1\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 400"), "{response}");
    }
}
