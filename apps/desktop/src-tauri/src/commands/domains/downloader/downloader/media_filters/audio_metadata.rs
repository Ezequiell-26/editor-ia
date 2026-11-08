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

/// Ruta rápida para videos largos: sin flujo óptico, denoise ni grano.
#[cfg(test)]
pub(crate) fn fast_cinematic_filter(focus: &str) -> String {
    fast_cinematic_filter_with(focus, None, None)
}

pub(crate) fn fast_cinematic_filter_with(
    focus: &str,
    delogo: Option<DelogoRect>,
    upscale: Option<UpscalePlan>,
) -> String {
    let effects = spatial_effects(delogo, upscale);
    let zoom = zoom_filters(focus, upscale);
    // En la ruta larga se evita el flujo óptico y el grano, pero si hay
    // upscaling se mantiene el denoise previo para no ampliar el pixelado.
    let denoise = if upscale.is_some() {
        "hqdn3d=1.86:1.39:2.80:2.15,"
    } else {
        ""
    };
    format!(
        "[0:v]{denoise}{effects}fps=60,setpts=PTS/0.98,eq=gamma=0.98:contrast=1.05:saturation=1.05,{zoom}\
hflip,format=yuv420p[v]"
    )
}

pub(crate) fn audio_treatment_filter() -> &'static str {
    "atempo=1.02,highpass=f=80,afftdn=nr=12:nf=-30,loudnorm=I=-14:TP=-1.5:LRA=11,apad"
}

/// Master transparente para conservar el audio original de un video corto:
/// sin cambiar velocidad ni tono, sólo limpieza suave y nivel de emisión.
/// No es un mecanismo para evadir Content ID; es mastering de material propio.
pub(crate) fn audio_master_filter() -> &'static str {
    "highpass=f=55,lowpass=f=18000,acompressor=threshold=-18dB:ratio=2:attack=5:release=120,loudnorm=I=-14:TP=-1.5:LRA=11,apad"
}

pub(crate) fn audio_noise_mix_filter() -> &'static str {
    "[0:a]atempo=1.02,highpass=f=80,afftdn=nr=12:nf=-30,loudnorm=I=-14:TP=-1.5:LRA=11,apad[voice];[1:a]volume=1.0[noise];[voice][noise]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.891[a]"
}
