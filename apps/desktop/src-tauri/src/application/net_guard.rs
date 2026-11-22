//! Guardia anti-SSRF compartida: qué destinos puede tocar la app cuando
//! la URL no la eligió directamente el usuario (extractores, respuestas
//! de proveedores remotos, redirects).
//!
//! Vive en `application/` porque la necesitan tanto `commands/` (el
//! downloader) como `infrastructure/` (los generadores remotos del
//! studio) sin crear dependencias commands↔infrastructure.
//!
//! `ensure_public_resolution` hace DNS síncrono (`ToSocketAddrs`):
//! usar sólo en contextos bloqueantes (spawn_blocking/hilos dedicados).

use std::net::{IpAddr, ToSocketAddrs};

/// Rangos que nunca deben ser destino de una URL remota: loopback,
/// privadas, link-local, CGNAT, documentación, benchmarking, multicast
/// y las formas IPv6 que embeben una IPv4 (mapped/compatible, NAT64).
/// Se evalúa también sobre cada IP que devuelve el DNS.
pub(crate) fn ip_is_forbidden(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            if value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_unspecified()
                || value.is_broadcast()
                || value.is_multicast()
            {
                return true;
            }
            let o = value.octets();
            // TEST-NET-1/2/3 (192.0.2/24, 198.51.100/24, 203.0.113/24):
            // `is_documentation` es inestable, el rango se chequea a mano.
            let documentation = matches!(
                (o[0], o[1], o[2]),
                (192, 0, 2) | (198, 51, 100) | (203, 0, 113)
            );
            // CGNAT 100.64/10 (`is_shared` inestable) y benchmarking
            // 198.18/15 (`is_benchmarking` inestable).
            let shared = o[0] == 100 && (o[1] & 0xC0) == 64;
            let benchmarking = o[0] == 198 && (o[1] & 0xFE) == 18;
            documentation || shared || benchmarking
        }
        IpAddr::V6(value) => {
            if value.is_loopback()
                || value.is_unspecified()
                || value.is_unique_local()
                || value.is_unicast_link_local()
                || value.is_multicast()
            {
                return true;
            }
            let segments = value.segments();
            // 2001:db8::/32 documentación (`is_documentation` inestable).
            if segments[0] == 0x2001 && segments[1] == 0x0db8 {
                return true;
            }
            // 64:ff9b::/32 (NAT64 well-known y local-use) embebe IPv4.
            if segments[0] == 0x0064 && segments[1] == 0xff9b {
                return true;
            }
            // ::ffff:a.b.c.d (mapped) y ::a.b.c.d (compatible) heredan las
            // reglas IPv4: ::ffff:127.0.0.1 no es una IP pública.
            value
                .to_ipv4()
                .is_some_and(|mapped| ip_is_forbidden(&IpAddr::V4(mapped)))
        }
    }
}

/// Reglas sintácticas sobre una URL ya parseada: esquema http(s), host
/// presente, sin nombres localhost/.local/.internal y sin IP literal
/// prohibida. `Err` trae la razón en español para que cada dominio la
/// envuelva en su propio `ProjectError`.
pub(crate) fn check_url_parts(parsed: &reqwest::Url) -> Result<(), &'static str> {
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Sólo se aceptan URLs http o https.");
    }
    let host = parsed
        .host_str()
        .ok_or("La URL no tiene un host válido.")?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return Err("La URL no tiene un host válido.");
    }
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") {
        return Err("No se permiten direcciones locales.");
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        if ip_is_forbidden(&ip) {
            return Err("No se permiten direcciones privadas ni locales.");
        }
    }
    Ok(())
}

/// DNS de una URL ya validada: si el nombre resuelve a CUALQUIER IP
/// prohibida se rechaza, y también cuando no resuelve (fail-closed: si
/// el DNS falla, la conexión iba a fallar igual).
pub(crate) fn ensure_public_resolution(url: &reqwest::Url) -> Result<(), &'static str> {
    let Some(host) = url.host_str() else {
        return Ok(());
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.parse::<IpAddr>().is_ok() {
        return Ok(()); // las IP literales ya pasaron ip_is_forbidden
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let mut resolved = 0usize;
    for addr in (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| "No se pudo resolver el dominio de la URL.")?
    {
        resolved += 1;
        if ip_is_forbidden(&addr.ip()) {
            return Err("El dominio de la URL resuelve a una dirección local o privada.");
        }
    }
    if resolved == 0 {
        return Err("No se pudo resolver el dominio de la URL.");
    }
    Ok(())
}

/// Anti-SSRF para clientes reqwest que siguen redirects: cada salto
/// vuelve a pasar las mismas reglas (esquema, host, IP literal y DNS)
/// sobre la URL de destino, así un 302 a una IP interna no bypasea la
/// validación. No aplica a endpoints locales configurados por el
/// usuario (proveedores LAN/loopback): ésos legítimamente viven en
/// direcciones privadas.
pub(crate) fn ssrf_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let result =
            check_url_parts(attempt.url()).and_then(|_| ensure_public_resolution(attempt.url()));
        match result {
            Ok(()) => attempt.follow(),
            Err(reason) => attempt.error(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                reason,
            )),
        }
    })
}
