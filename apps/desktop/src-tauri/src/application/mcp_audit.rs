//! Lectura del audit log JSONL del servidor MCP embebido
//! (`<config_dir>/mcp-audit.jsonl`, escrito por
//! `infrastructure::mcp_server::JsonlMcpAuditSink`).
//!
//! Las entradas ya se sanitizan al escribirse; acá se vuelven a pasar por el
//! mismo sanitizador como defensa en profundidad (el archivo es texto plano
//! y podría venir de una versión vieja o editarse a mano).

use serde::Serialize;
use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Tope de líneas por consulta: el archivo rota a 4 MB, pero la cauda útil
/// para la UI son las últimas decenas.
const MAX_TAIL_LINES: usize = 500;

/// Tope de bytes por línea leída: una línea corrupta gigante no debe
/// gastarse entera en memoria.
const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditTail {
    /// Entradas parseadas (JSON), en orden cronológico, ya sanitizadas.
    pub entries: Vec<Value>,
    /// Líneas no vacías que no parsearon como JSON (cuenta, no contenido).
    pub skipped: usize,
    /// `true` si el archivo tiene más líneas de las devueltas.
    pub truncated: bool,
}

/// Devuelve las últimas `limit` entradas del JSONL en `path`.
///
/// `limit` se acota a `MAX_TAIL_LINES`. Si el archivo no existe devuelve una
/// cola vacía (el servidor MCP puede no haberse usado nunca). Un archivo
/// ilegible sí es error: la UI tiene que distinguir "sin auditoría" de
/// "no pude leerla".
pub fn tail(path: &std::path::Path, limit: usize) -> Result<AuditTail, ProjectError> {
    let limit = limit.clamp(1, MAX_TAIL_LINES);
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AuditTail {
                entries: Vec::new(),
                skipped: 0,
                truncated: false,
            });
        }
        Err(_) => {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo leer el audit log del MCP",
            ));
        }
    };

    let non_empty: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let truncated = non_empty.len() > limit;
    let mut entries = Vec::new();
    let mut skipped = 0usize;
    for &line in non_empty.iter().skip(non_empty.len().saturating_sub(limit)) {
        if line.len() > MAX_LINE_BYTES {
            skipped += 1;
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(entry) => entries.push(crate::mcp::server::sanitize_audit_args(&entry)),
            Err(_) => skipped += 1,
        }
    }
    Ok(AuditTail {
        entries,
        skipped,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture_dir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("olyvia-audit-tail-{tag}-{}", std::process::id()))
    }

    #[test]
    fn archivo_inexistente_devuelve_cola_vacia() {
        let dir = fixture_dir("missing");
        let _ = std::fs::remove_dir_all(&dir);
        let result = tail(&dir.join("mcp-audit.jsonl"), 10).expect("missing ok");
        assert!(result.entries.is_empty());
        assert_eq!(result.skipped, 0);
        assert!(!result.truncated);
    }

    #[test]
    fn devuelve_las_ultimas_n_lineas_parseadas() {
        let dir = fixture_dir("basic");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp-audit.jsonl");
        let mut content = String::new();
        for i in 0..5 {
            content.push_str(&serde_json::to_string(&json!({"ts": i, "tool": "t"})).unwrap());
            content.push('\n');
        }
        content.push_str("esto no es json\n");
        content.push('\n'); // línea vacía se ignora
        std::fs::write(&path, content).unwrap();

        // 6 líneas no vacías (5 JSON + 1 rota): con limit=4 entran
        // ts2, ts3, ts4 y la rota al final.
        let result = tail(&path, 4).expect("tail ok");
        assert_eq!(result.entries.len(), 3);
        assert_eq!(result.entries[0]["ts"], 2);
        assert_eq!(result.entries[2]["ts"], 4);
        assert_eq!(result.skipped, 1, "la línea rota cuenta como skipped");
        assert!(result.truncated);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanea_secretos_en_lineas_parseadas() {
        let dir = fixture_dir("secrets");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp-audit.jsonl");
        // Una línea escrita a mano con una clave sensible: el sanitizador
        // debe taparla aunque el writer ya lo haga.
        let line = json!({
            "ts": 1,
            "tool": "probe",
            "args": {"api_key": "sk-supersecreta", "path": "ok.mp4"}
        });
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string(&line).unwrap()),
        )
        .unwrap();

        let result = tail(&path, 10).expect("tail ok");
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0]["args"]["api_key"], "[redacted]");
        assert_eq!(result.entries[0]["args"]["path"], "ok.mp4");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn el_limite_tiene_tope_duro() {
        let dir = fixture_dir("limit");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp-audit.jsonl");
        std::fs::write(&path, "").unwrap();
        let result = tail(&path, usize::MAX).expect("tail ok");
        assert!(result.entries.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
