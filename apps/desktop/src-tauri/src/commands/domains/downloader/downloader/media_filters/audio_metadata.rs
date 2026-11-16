// Los filtros de audio del pipeline (tratamiento, master, mezcla con ruido)
// viven en `media::download_filters` y llegan por el `pub(crate) use` de
// visual_filters.rs.

fn read_download_subtitles(files: &[DownloadedFile]) -> Vec<DownloadedSubtitle> {
    files
        .iter()
        .filter(|file| {
            matches!(
                media_extension(Path::new(&file.path)).as_str(),
                "srt" | "vtt" | "ass" | "ssa"
            )
        })
        .filter_map(|file| {
            let bytes = std::fs::metadata(&file.path).ok()?.len();
            if bytes == 0 || bytes > 2_000_000 {
                return None;
            }
            let text = std::fs::read_to_string(&file.path).ok()?;
            Some(DownloadedSubtitle {
                path: file.path.clone(),
                name: file.name.clone(),
                text,
            })
        })
        .collect()
}

fn probe_chapters(ffprobe: Option<&Path>, path: &Path) -> Vec<DownloadedChapter> {
    let Some(ffprobe) = ffprobe else {
        return Vec::new();
    };
    let mut command = Command::new(ffprobe);
    command
        .args(["-v", "error", "-show_chapters", "-of", "json"])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return Vec::new();
    };
    value["chapters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|chapter| {
            let start = chapter["start_time"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .or_else(|| chapter["start_time"].as_f64())?;
            let title = chapter["tags"]["title"]
                .as_str()
                .or_else(|| chapter["title"].as_str())
                .unwrap_or("Capítulo")
                .trim()
                .chars()
                .take(120)
                .collect::<String>();
            (!title.is_empty()).then_some(DownloadedChapter {
                start_seconds: start.max(0.0),
                title,
            })
        })
        .take(200)
        .collect()
}

fn probe_duration(ffprobe: Option<&Path>, input: &Path) -> Option<f64> {
    let ffprobe = ffprobe?;
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}
