//! Bitácora de renders (`export_diario.js` de AlaukCut): un JSONL por cache
//! dir que registra cada intento de export — perfil, codec, encoder,
//! resultado, duración y causa del fallo — para diagnóstico y auditoría.
//!
//! Se escribe una línea por job terminado (completed/failed/cancelled) y se
//! recorta a las últimas `DIARY_KEEP` entradas para no crecer sin límite.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// Entradas máximas conservadas en `render-diary.jsonl`.
const DIARY_KEEP: usize = 400;

/// Una entrada de la bitácora. Todos los campos son opcionales salvo
/// `ts`/`jobId`/`status`: un render cancelado temprano no tiene output.
#[derive(Debug, Clone)]
pub struct RenderDiaryEntry {
    pub job_id: String,
    pub project: String,
    pub profile_name: String,
    pub codec: String,
    pub encoder: String,
    pub encoder_fallback: Option<String>,
    pub status: String,
    pub output_name: Option<String>,
    pub output_bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub elapsed_ms: u64,
    pub code: Option<String>,
    pub message: Option<String>,
}

/// Ruta del JSONL dentro del cache dir del render.
pub fn diary_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join("render-diary.jsonl")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Agrega una entrada al final del JSONL y recorta si supera `DIARY_KEEP`.
/// Nunca falla al caller: la bitácora es diagnóstico, no parte del render.
pub fn append(cache_dir: &Path, entry: &RenderDiaryEntry) {
    let path = diary_path(cache_dir);
    let line = json!({
        "ts": now_ms(),
        "jobId": entry.job_id,
        "project": entry.project,
        "profile": entry.profile_name,
        "codec": entry.codec,
        "encoder": entry.encoder,
        "encoderFallback": entry.encoder_fallback,
        "status": entry.status,
        "output": entry.output_name,
        "outputBytes": entry.output_bytes,
        "durationSeconds": entry.duration_seconds,
        "elapsedMs": entry.elapsed_ms,
        "code": entry.code,
        "message": entry.message,
    });
    let mut lines: Vec<String> = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect();
    lines.push(line.to_string());
    if lines.len() > DIARY_KEEP {
        lines.drain(..lines.len() - DIARY_KEEP);
    }
    let body = lines.join("\n") + "\n";
    let _ = std::fs::create_dir_all(cache_dir);
    let _ = std::fs::write(&path, body);
}

/// Lee las últimas `limit` entradas (más nuevas primero) del JSONL.
/// Las líneas corruptas se descartan silenciosamente.
pub fn tail(cache_dir: &Path, limit: usize) -> Vec<Value> {
    let Ok(body) = std::fs::read_to_string(diary_path(cache_dir)) else {
        return Vec::new();
    };
    body.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .rev()
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(status: &str) -> RenderDiaryEntry {
        RenderDiaryEntry {
            job_id: "job-1".to_owned(),
            project: "demo".to_owned(),
            profile_name: "YouTube 1080p".to_owned(),
            codec: "h264".to_owned(),
            encoder: "software".to_owned(),
            encoder_fallback: None,
            status: status.to_owned(),
            output_name: Some("demo.mp4".to_owned()),
            output_bytes: Some(1234),
            duration_seconds: Some(12.5),
            elapsed_ms: 4200,
            code: None,
            message: None,
        }
    }

    #[test]
    fn append_and_tail_roundtrip() {
        let dir = std::env::temp_dir().join(format!("diary-{}", uuid::Uuid::new_v4()));
        append(&dir, &entry("completed"));
        append(&dir, &entry("failed"));
        let entries = tail(&dir, 10);
        assert_eq!(entries.len(), 2);
        // Más nuevas primero.
        assert_eq!(entries[0]["status"], "failed");
        assert_eq!(entries[1]["status"], "completed");
        assert_eq!(entries[1]["profile"], "YouTube 1080p");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_on_missing_file_is_empty() {
        let dir = std::env::temp_dir().join(format!("diary-missing-{}", uuid::Uuid::new_v4()));
        assert!(tail(&dir, 10).is_empty());
    }

    #[test]
    fn corrupt_lines_are_skipped() {
        let dir = std::env::temp_dir().join(format!("diary-corrupt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(diary_path(&dir), "no-json\n{\"status\":\"ok\"}\n").unwrap();
        let entries = tail(&dir, 10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["status"], "ok");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
