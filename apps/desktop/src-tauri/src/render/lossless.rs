//! Exportación sin recodificar — reglas puras del dominio.
//!
//! Sacar un rango de un archivo grande no necesita render: FFmpeg copia los
//! paquetes y termina en segundos. La contra es que el corte cae en el keyframe
//! anterior al pedido; por eso se devuelve la duración real y cuánto se corrió
//! el inicio, en vez de fingir precisión.
//!
//! La orquestación vive en `application::lossless`; la reserva de nombres y
//! el filesystem en `infrastructure::render_lossless`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LosslessResult {
    pub path: String,
    pub bytes: u64,
    pub requested_seconds: f64,
    pub actual_seconds: f64,
    /// Diferencia entre el inicio pedido y el real (keyframe anterior).
    pub start_shift_seconds: f64,
}

/// Contenedores que aceptamos como destino de un remux.
pub fn valid_container(extension: &str) -> bool {
    matches!(
        extension.trim().to_ascii_lowercase().as_str(),
        "mp4" | "mkv" | "mov" | "webm"
    )
}

/// Un rango válido: fin después del inicio y ambos no negativos.
pub fn valid_range(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end > start + 0.05
}

/// `format=duration` de ffprobe → segundos.
pub fn parse_probe_duration(stdout: &str) -> Option<f64> {
    stdout.trim().parse::<f64>().ok()
}

/// `stream=codec_name` del primer audio → nombre de códec.
pub fn parse_audio_codec(stdout: &str) -> Option<String> {
    let codec = stdout.trim().to_owned();
    if codec.is_empty() {
        None
    } else {
        Some(codec)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInput {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersResult {
    pub path: String,
    pub bytes: u64,
    pub chapters: usize,
}

/// Arma el archivo `ffmetadata` con los capítulos.
pub fn chapters_metadata(title: Option<&str>, chapters: &[ChapterInput]) -> String {
    let mut text = String::from(";FFMETADATA1\n");
    if let Some(value) = title.filter(|value| !value.trim().is_empty()) {
        text.push_str(&format!("title={}\n", value.replace('\n', " ")));
    }
    for chapter in chapters {
        let start = (chapter.start_seconds.max(0.0) * 1000.0).round() as i64;
        let end = (chapter.end_seconds.max(0.0) * 1000.0).round() as i64;
        if end <= start {
            continue;
        }
        text.push_str("[CHAPTER]\nTIMEBASE=1/1000\n");
        text.push_str(&format!("START={start}\nEND={end}\n"));
        text.push_str(&format!(
            "title={}\n",
            chapter.title.trim().replace('\n', " ")
        ));
    }
    text
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    pub path: String,
    pub bytes: u64,
    pub codec: String,
}

/// Contenedor de audio que acepta el códec sin recodificar.
pub fn audio_container(codec: &str) -> &'static str {
    match codec.trim().to_ascii_lowercase().as_str() {
        "aac" | "alac" => "m4a",
        _ => "mka",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_forward_range() {
        assert!(valid_range(0.0, 10.0));
        assert!(valid_range(5.5, 6.0));
    }

    #[test]
    fn picks_a_container_that_accepts_the_codec() {
        assert_eq!(audio_container("aac"), "m4a");
        assert_eq!(audio_container("ALAC"), "m4a");
        assert_eq!(audio_container("opus"), "mka");
        assert_eq!(audio_container("mp3"), "mka");
    }

    #[test]
    fn writes_ffmetadata_chapters() {
        let chapters = vec![
            ChapterInput {
                start_seconds: 0.0,
                end_seconds: 2.5,
                title: "Intro".to_owned(),
            },
            ChapterInput {
                start_seconds: 2.5,
                end_seconds: 5.0,
                title: "Cierre".to_owned(),
            },
        ];
        let text = chapters_metadata(Some("Mi video"), &chapters);
        assert!(text.starts_with(";FFMETADATA1\ntitle=Mi video\n"));
        assert!(text.contains("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2500\ntitle=Intro"));
        assert!(text.contains("START=2500\nEND=5000\ntitle=Cierre"));
    }

    #[test]
    fn skips_chapters_without_duration() {
        let chapters = vec![
            ChapterInput {
                start_seconds: 3.0,
                end_seconds: 3.0,
                title: "Vacío".to_owned(),
            },
            ChapterInput {
                start_seconds: 4.0,
                end_seconds: 6.0,
                title: "Válido".to_owned(),
            },
        ];
        let text = chapters_metadata(None, &chapters);
        assert!(!text.contains("Vacío"));
        assert!(text.contains("Válido"));
    }

    #[test]
    fn accepts_common_containers_only() {
        assert!(valid_container("mp4"));
        assert!(valid_container("MKV"));
        assert!(!valid_container("avi"));
        assert!(!valid_container(""));
    }

    #[test]
    fn rejects_inverted_or_empty_ranges() {
        assert!(!valid_range(10.0, 10.0));
        assert!(!valid_range(10.0, 5.0));
        assert!(!valid_range(-1.0, 5.0));
        assert!(!valid_range(f64::NAN, 5.0));
    }
}
