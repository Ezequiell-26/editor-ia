/// ffprobe lee cabeceras del archivo de entrada; 60 s cubre archivos
/// grandes o discos lentos. Sin deadline un sondeo colgado congelaba el
/// comando de doblaje para siempre.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

fn probe_json(ffprobe: &Path, path: &Path) -> Option<serde_json::Value> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=width,height,codec_type,channels:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let timed = crate::commands::output_with_timeout(&mut command, PROBE_TIMEOUT).ok()?;
    if timed.timed_out {
        return None;
    }
    let output = timed.into_output()?;
    serde_json::from_slice(&output.stdout).ok()
}

/// Duración y canales de la primera pista de audio del archivo.
pub(crate) fn probe_audio_info(ffprobe: &Path, path: &Path) -> Option<(f64, Option<u32>)> {
    let value = probe_json(ffprobe, path)?;
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)?;
    let channels = value["streams"]
        .as_array()
        .and_then(|streams| {
            streams.iter().find(|stream| {
                stream["codec_type"].as_str() == Some("audio")
            })
        })
        .and_then(|stream| stream["channels"].as_u64())
        .and_then(|count| u32::try_from(count).ok());
    Some((duration, channels))
}

/// Canales de la primera pista de audio (para el lecho `[0:a]` del input).
pub(crate) fn probe_audio_channels(ffprobe: &Path, path: &Path) -> Option<u32> {
    let value = probe_json(ffprobe, path)?;
    value["streams"]
        .as_array()
        .and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream["codec_type"].as_str() == Some("audio"))
        })
        .and_then(|stream| stream["channels"].as_u64())
        .and_then(|count| u32::try_from(count).ok())
}

fn probe_video(ffprobe: &Path, path: &Path) -> (Option<u32>, Option<u32>, Option<f64>) {
    let Some(value) = probe_json(ffprobe, path) else {
        return (None, None, None);
    };
    let stream = value["streams"].as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item["codec_type"].as_str() == Some("video"))
    });
    let width = stream
        .and_then(|item| item["width"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let height = stream
        .and_then(|item| item["height"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
    (width, height, duration)
}

fn unique_output(dir: &Path, stem: &str, language: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}-dub-{language}.mp4"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-dub-{language}-{index}.mp4"));
        index += 1;
    }
    candidate
}

fn safe_stem(value: &str) -> String {
    let mapped: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if trimmed.is_empty() {
        "video".to_owned()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn source_has_audio(ffprobe: &Path, path: &Path) -> bool {
    let Some(value) = probe_json(ffprobe, path) else {
        return false;
    };
    value["streams"]
        .as_array()
        .map(|streams| {
            streams
                .iter()
                .any(|stream| stream["codec_type"].as_str() == Some("audio"))
        })
        .unwrap_or(false)
}
