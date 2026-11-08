struct MediaInfo {
    duration: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    fps: f64,
}

fn probe_media(ffprobe: Option<&Path>, path: &Path) -> MediaInfo {
    let unknown = MediaInfo {
        duration: None,
        width: None,
        height: None,
        fps: 30.0,
    };
    let Some(ffprobe) = ffprobe else {
        return unknown;
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return unknown;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return unknown;
    };
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok());
    let stream = value["streams"].as_array().and_then(|items| items.first());
    let width = stream
        .and_then(|item| item["width"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let height = stream
        .and_then(|item| item["height"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let fps = stream
        .and_then(|item| item["r_frame_rate"].as_str())
        .and_then(|text| {
            let (num, den) = text.split_once('/')?;
            let num: f64 = num.parse().ok()?;
            let den: f64 = den.parse().ok()?;
            (den > 0.0 && num > 0.0).then_some(num / den)
        })
        .filter(|value| value.is_finite() && *value > 0.0 && *value < 480.0)
        .unwrap_or(30.0);
    MediaInfo {
        duration,
        width,
        height,
        fps,
    }
}

fn encoder_listing(ffmpeg: &Path) -> Option<String> {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let output = command.output().ok()?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Elige un encoder H.264 que exista **y** inicialice en esta máquina.
/// Elige el primer encoder H.264 que realmente funcione en este FFmpeg.
pub(crate) fn resolve_encoder(ffmpeg: &Path) -> Result<String, ProjectError> {
    if let Ok(cache) = ENCODER_CACHE.lock() {
        if let Some((cached_path, cached)) = cache.as_ref() {
            if cached_path == ffmpeg {
                return Ok(cached.clone());
            }
        }
    }
    let listing = encoder_listing(ffmpeg).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo consultar los encoders de FFmpeg",
        )
    })?;
    for name in H264_CANDIDATES {
        if listing.lines().any(|line| line.contains(name))
            && crate::render::ffmpeg::encoder_works(ffmpeg, name)
        {
            let chosen = (*name).to_owned();
            if let Ok(mut cache) = ENCODER_CACHE.lock() {
                *cache = Some((ffmpeg.to_path_buf(), chosen.clone()));
            }
            return Ok(chosen);
        }
    }
    Err(ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        "este FFmpeg no tiene ningún encoder H.264 utilizable (probé libx264, NVENC, AMF, QSV y OpenH264)",
    ))
}

/// Argumentos de códec según la familia del encoder elegido.
pub(crate) fn video_codec_args(
    encoder: &str,
    crf: u32,
    width: u32,
    height: u32,
    fps: f64,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-c:v".to_owned(), encoder.to_owned()];
    if encoder == "libx264" {
        args.extend([
            "-preset".to_owned(),
            "slow".to_owned(),
            "-crf".to_owned(),
            crf.to_string(),
        ]);
    } else if encoder.ends_with("_nvenc") {
        args.extend([
            "-preset".to_owned(),
            "p5".to_owned(),
            "-rc".to_owned(),
            "vbr".to_owned(),
            "-cq".to_owned(),
            crf.to_string(),
            "-b:v".to_owned(),
            "0".to_owned(),
        ]);
    } else if encoder.ends_with("_amf") {
        args.extend([
            "-quality".to_owned(),
            "quality".to_owned(),
            "-rc".to_owned(),
            "cqp".to_owned(),
            "-qp_i".to_owned(),
            crf.to_string(),
            "-qp_p".to_owned(),
            crf.to_string(),
        ]);
    } else if encoder.ends_with("_qsv") {
        args.extend(["-global_quality".to_owned(), crf.to_string()]);
    } else {
        // libopenh264 no acepta CRF: se pide un bitrate proporcional al área y
        // a los cuadros por segundo. 0,22 bit/píxel da una entrega casi sin
        // pérdida visible a 1080p y 4K.
        let pixels = f64::from(width.max(1)) * f64::from(height.max(1));
        let bitrate = (pixels * fps * 0.22)
            .round()
            .clamp(2_000_000.0, 120_000_000.0) as u64;
        args.extend([
            "-b:v".to_owned(),
            bitrate.to_string(),
            "-maxrate".to_owned(),
            (bitrate * 2).to_string(),
            "-bufsize".to_owned(),
            (bitrate * 4).to_string(),
        ]);
    }
    args
}
