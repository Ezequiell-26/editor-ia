//! Conversión e inspección de subtítulos en 7 formatos (filmcraft-captions):
//! SRT, WebVTT, SCC (CEA-608), MCC (CEA-608/708), EBU STL, TTML (IMSC1) y
//! DFXP. La IA puede importar subtítulos broadcast y convertir entre
//! formatos sin UI.

use serde::Serialize;
use tauri::State;

use crate::commands::audio_tools::user_file;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_SUBTITLE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CUES_PREVIEW: usize = 20;

/// Vista previa de un archivo de subtítulos parseado.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleInspectResult {
    pub format: String,
    pub format_name: String,
    pub cue_count: usize,
    pub duration_seconds: f64,
    pub warnings: Vec<String>,
    /// Primeras cues: [inicio_s, fin_s, texto (primeras 120 chars)].
    pub preview: Vec<[serde_json::Value; 3]>,
}

fn read_caption_file(path: &str) -> Result<(std::path::PathBuf, Vec<u8>), ProjectError> {
    let file = user_file(path)?;
    let meta = std::fs::metadata(&file).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo leer el archivo de subtítulos: {e}"),
        )
    })?;
    if meta.len() > MAX_SUBTITLE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos supera 64 MB",
        ));
    }
    let bytes = std::fs::read(&file).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo leer el archivo de subtítulos: {e}"),
        )
    })?;
    Ok((file, bytes))
}

fn detect_format(
    bytes: &[u8],
    file: &std::path::Path,
) -> Result<filmcraft_captions::Format, ProjectError> {
    let ext = file.extension().and_then(|e| e.to_str());
    filmcraft_captions::detect(bytes, ext).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "formato de subtítulos no reconocido (srt/vtt/scc/mcc/stl/ttml/dfxp)",
        )
    })
}

/// Inspecciona un archivo de subtítulos: detecta formato, cuenta cues,
/// duración y devuelve un preview. Read-only.
#[tauri::command]
pub fn subtitles_inspect_file(path: String) -> Result<SubtitleInspectResult, ProjectError> {
    let (file, bytes) = read_caption_file(&path)?;
    let format = detect_format(&bytes, &file)?;
    let doc = filmcraft_captions::parse(&bytes, format).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("no se pudo parsear el archivo: {e}"),
        )
    })?;
    let mut duration = 0.0f64;
    for cue in &doc.cues {
        duration = duration.max(cue.end.seconds());
    }
    let preview = doc
        .cues
        .iter()
        .take(MAX_CUES_PREVIEW)
        .map(|cue| {
            [
                serde_json::json!(cue.start.seconds()),
                serde_json::json!(cue.end.seconds()),
                serde_json::json!(cue.text.chars().take(120).collect::<String>()),
            ]
        })
        .collect();
    Ok(SubtitleInspectResult {
        format_name: format.name().to_string(),
        format: format.extension().to_string(),
        cue_count: doc.cues.len(),
        duration_seconds: duration,
        warnings: doc.warnings.iter().take(20).cloned().collect(),
        preview,
    })
}

/// Convierte un archivo de subtítulos a otro formato. El formato de salida
/// se deduce de la extensión del `output` (srt|vtt|scc|mcc|stl|ttml|dfxp).
#[tauri::command]
pub fn subtitles_convert_file(
    state: State<'_, AppState>,
    input: String,
    output: String,
) -> Result<String, ProjectError> {
    let _ = &state;
    let (in_file, bytes) = read_caption_file(&input)?;
    let in_format = detect_format(&bytes, &in_file)?;
    let doc = filmcraft_captions::parse(&bytes, in_format).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("no se pudo parsear la entrada: {e}"),
        )
    })?;

    let dest = crate::commands::audio_tools::output_file(&output)?;
    let out_ext = dest
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let out_format = filmcraft_captions::Format::from_name(&out_ext).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "extensión de salida no soportada: usar .srt/.vtt/.scc/.mcc/.stl/.ttml/.dfxp",
        )
    })?;
    if in_format == out_format {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "entrada y salida son el mismo formato",
        ));
    }
    let opts = filmcraft_captions::WriteOptions::default();
    let out_bytes = filmcraft_captions::write(&doc, out_format, opts);
    std::fs::write(&dest, out_bytes).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el archivo convertido: {e}"),
        )
    })?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convert_srt_to_vtt_roundtrip() {
        let dir = std::env::temp_dir().join(format!("olyvia-subs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let srt = dir.join("in.srt");
        std::fs::write(
            &srt,
            "1\n00:00:01,000 --> 00:00:03,500\nHola mundo\n\n2\n00:00:04,000 --> 00:00:06,000\nSegunda cue\n",
        )
        .unwrap();
        let bytes = std::fs::read(&srt).unwrap();
        let format = filmcraft_captions::detect(&bytes, Some("srt")).unwrap();
        assert_eq!(format, filmcraft_captions::Format::Srt);
        let doc = filmcraft_captions::parse(&bytes, format).unwrap();
        assert_eq!(doc.cues.len(), 2);
        assert!((doc.cues[0].start.seconds() - 1.0).abs() < 0.01);
        let vtt =
            filmcraft_captions::write(&doc, filmcraft_captions::Format::WebVtt, Default::default());
        let text = String::from_utf8(vtt).unwrap();
        assert!(text.contains("WEBVTT"));
        assert!(text.contains("Hola mundo"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inspect_detects_srt_and_counts_cues() {
        let dir = std::env::temp_dir().join(format!("olyvia-subs-insp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let srt = dir.join("subs.srt");
        std::fs::write(
            &srt,
            "1
00:00:01,000 --> 00:00:03,500
Hola mundo

2
00:00:04,000 --> 00:00:08,000
Segunda cue
",
        )
        .unwrap();
        let result = subtitles_inspect_file(srt.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.format, "srt");
        assert_eq!(result.cue_count, 2);
        assert!((result.duration_seconds - 8.0).abs() < 0.01);
        assert_eq!(result.preview.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
