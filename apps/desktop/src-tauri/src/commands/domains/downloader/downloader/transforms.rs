// clippy::too_many_arguments: pipeline de transforms; cada flag es una
// etapa opcional del request de descarga ya normalizado.
#[allow(clippy::too_many_arguments)]
fn process_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    input: &Path,
    focus: &str,
    replacement_audio: Option<&Path>,
    auto_pipeline: bool,
    long_video: bool,
    audio_speed_noise: bool,
    preserve_original_audio: bool,
    audio_master: bool,
    delogo_corner: Option<&str>,
    manual_delogo: Option<DelogoManualRect>,
    upscale_mode: Option<&str>,
    watermark: Option<&Path>,
    profile: &crate::commands::pipeline_profile::PipelineProfile,
) -> Result<(PathBuf, Option<String>, Option<String>), String> {
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let output = input.with_file_name(format!("{stem} - cine analogico.mp4"));
    let (source_width, source_height) = dimensions(ffprobe, input).unwrap_or((0, 0));
    let source_duration = probe_duration(ffprobe, input);
    let delogo = manual_delogo
        .and_then(|rect| manual_delogo_rect(source_width, source_height, rect))
        .or_else(|| {
            delogo_corner.and_then(|corner| delogo_rect(source_width, source_height, corner))
        });
    let upscale =
        upscale_mode.and_then(|mode| upscale_target(source_width, source_height, long_video, mode));
    let color = probe_color(ffprobe, input);
    let mut filter = if auto_pipeline && long_video {
        fast_cinematic_filter_with(focus, delogo, upscale)
    } else if auto_pipeline {
        pipeline_filter_with(focus, delogo, upscale)
    } else {
        cinematic_filter_with(focus, delogo, upscale)
    };
    if color.is_hdr() {
        // El look manual y el pipeline cierran en yuv420p: sin tonemap, un
        // fuente HDR se vería lavada. Se convierte antes de cualquier efecto.
        filter = filter.replacen("[0:v]", &format!("[0:v]{HDR_TONEMAP},"), 1);
    }
    let mut extras = Vec::new();
    if color.is_hdr() {
        extras.push("HDR → SDR".to_owned());
    }
    if let Some(rect) = delogo {
        extras.push(format!(
            "logo {}×{} en ({}, {})",
            rect.w, rect.h, rect.x, rect.y
        ));
    }
    if let Some(plan) = upscale {
        extras.push(format!("Lanczos a {}×{}", plan.width, plan.height));
    }
    let detail = if extras.is_empty() {
        String::new()
    } else {
        format!(" · {}", extras.join(" · "))
    };
    let progress_message = if auto_pipeline {
        format!(
            "Pipeline automático con {}: denoise, delogo, Lanczos, grano y HEVC{detail}…",
            profile.label
        )
    } else {
        format!("Aplicando look cine analógico 35 mm: flujo óptico, grano y espejo{detail}…")
    };
    progress("compressing", None, &progress_message);
    let has_audio = input_has_audio(ffprobe, input);
    let use_noise_audio = audio_speed_noise && replacement_audio.is_none() && has_audio;
    let filter_complex = if use_noise_audio {
        format!("{filter};{}", audio_noise_mix_filter())
    } else {
        filter.clone()
    };
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-v", "error", "-y"]);
    if auto_pipeline {
        if let Some(hwaccel) = profile.hwaccel.as_deref() {
            command.args(["-hwaccel", hwaccel]);
        }
    }
    command.arg("-i").arg(input);
    if let Some(audio) = replacement_audio {
        command.arg("-i").arg(audio);
    } else if use_noise_audio {
        // Ruido rosa a -50 dB de amplitud: se mezcla con la voz y se limita
        // para que nunca sature el master.
        command.args([
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=color=pink:amplitude=0.003162",
        ]);
    }
    let watermark_index =
        1 + usize::from(replacement_audio.is_some()) + usize::from(use_noise_audio);
    if let Some(mark) = watermark {
        command.arg("-i").arg(mark);
    }
    let (filter_complex, video_label) = if watermark.is_some() {
        (
            format!(
                "{filter_complex};[{watermark_index}:v]scale=iw*0.22:-1,format=rgba,colorchannelmixer=aa=0.7[wm];[v][wm]overlay=W-w-32:H-h-32:format=auto,format=yuv420p[vout]"
            ),
            "[vout]",
        )
    } else {
        (filter_complex, "[v]")
    };
    command
        .args(["-filter_complex", &filter_complex, "-map", video_label])
        .args(["-pix_fmt", "yuv420p", "-r", "60", "-movflags", "+faststart"]);
    if auto_pipeline {
        command.args(&profile.args);
        if profile
            .args
            .iter()
            .any(|arg| arg.contains("hevc") || arg.contains("265"))
        {
            command.args(["-tag:v", "hvc1"]);
        }
    } else {
        // El look manual también cierra en H.265 para que cualquier asset
        // postprocesado por el hook sea HEVC, no una mezcla de códecs.
        command.args([
            "-c:v", "libx265", "-preset", "fast", "-crf", "22", "-tag:v", "hvc1",
        ]);
    }
    let keep_clean_audio = auto_pipeline && replacement_audio.is_none();
    if use_noise_audio {
        command.args(["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
    } else if replacement_audio.is_some() {
        // La banda nueva se normaliza a -14 LUFS y se rellena para que no
        // corte el video si es más corta que la imagen.
        command.args([
            "-map",
            "1:a:0",
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11,apad",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]);
    } else if audio_master && has_audio {
        // Corto o look manual sin banda/voz: conserva el audio original y lo
        // masteriza sin cambiar velocidad ni tono.
        command.args([
            "-map",
            "0:a:0",
            "-af",
            audio_master_filter(),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]);
    } else if preserve_original_audio && has_audio {
        // Música: no se toca velocidad, tono ni ruido. Se recodifica a AAC
        // sólo para garantizar compatibilidad con MP4.
        command.args(["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
    } else if keep_clean_audio && has_audio {
        // Sin banda elegida, el pipeline conserva el audio original limpio:
        // corte de graves, reducción de ruido y normalización de emisión.
        command.args([
            "-map",
            "0:a:0",
            "-af",
            audio_treatment_filter(),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]);
    } else {
        command.arg("-an");
    }
    command
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(&output);
    if let Err(message) =
        run_ffmpeg_with_progress(progress, &progress_message, &mut command, source_duration)
    {
        let _ = std::fs::remove_file(&output);
        return Err(message);
    }
    let bytes = std::fs::metadata(&output)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if bytes == 0 {
        let _ = std::fs::remove_file(&output);
        return Err("El post-proceso quedó vacío; se conservó el original.".to_owned());
    }
    // Todo asset postprocesado por el hook queda identificado con ambos
    // hashes: el archivo se reencodea por completo, no es el original.
    let md5 = match file_md5(&output) {
        Ok(hash) => hash,
        Err(message) => {
            let _ = std::fs::remove_file(&output);
            return Err(message);
        }
    };
    let sha256 = match file_sha256(&output) {
        Ok(hash) => hash,
        Err(message) => {
            let _ = std::fs::remove_file(&output);
            return Err(message);
        }
    };
    Ok((output, Some(md5), Some(sha256)))
}

#[cfg(test)]
fn cinematic_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    input: &Path,
    focus: &str,
    replacement_audio: Option<&Path>,
) -> Result<PathBuf, String> {
    process_video(
        progress,
        ffmpeg,
        None,
        input,
        focus,
        replacement_audio,
        false,
        false,
        false,
        false,
        false,
        None,
        None,
        None,
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .map(|(path, _, _)| path)
}

/// (ancho, alto, fps) para el bitrate de los encoders sin CRF. Si ffprobe
/// no puede medir, 1080p30 — bitrate conservador ~13 Mbps en el fallback.
fn probe_dims(ffprobe: Option<&Path>, input: &Path) -> (u32, u32, f64) {
    let Some(ffprobe) = ffprobe else {
        return (1920, 1080, 30.0);
    };
    crate::media::probe_file(ffprobe, input, crate::media::MediaKind::Video)
        .ok()
        .map(|measure| {
            (
                measure.width.unwrap_or(1920),
                measure.height.unwrap_or(1080),
                f64::from(measure.frame_rate_num.unwrap_or(30))
                    / f64::from(measure.frame_rate_den.unwrap_or(1).max(1)),
            )
        })
        .unwrap_or((1920, 1080, 30.0))
}

// clippy::too_many_arguments: compresión de un video; los parámetros son las
// opciones del request de descarga (crf/tamaño/codec/hdr).
#[allow(clippy::too_many_arguments)]
fn compress_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    input: &Path,
    crf: Option<u32>,
    target_size_mb: Option<u64>,
    codec: &str,
    hdr_mode: &str,
    keep_original: bool,
) -> Result<Option<PathBuf>, String> {
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let output = input.with_file_name(format!("{stem} - compacto.mp4"));
    let source_duration = probe_duration(ffprobe, input);
    let color = probe_color(ffprobe, input);
    let preserve_hdr = color.is_hdr() && hdr_mode == "preserve";
    if preserve_hdr && codec != "h265" && codec != "av1" {
        return Err(
            "Conservar HDR requiere H.265 o AV1: H.264 descarta la transferencia HDR.".to_owned(),
        );
    }
    // Medición sintética 1080p/5 s: medium 4,75 s · fast 4,35 s · faster
    // 3,41 s. `faster` recorta ~28 % con un tamaño casi igual; el CRF sigue
    // controlando la calidad y el peso final.
    //
    // Codec pedido → encoder real del binario. `libx264`/`libx265` son GPL y
    // no viajan en el bundle LGPL: h264 se resuelve con el sondeo de
    // sharpen (GPU primero, software después) y h265 con la detección de
    // hardware+software de `detect_hardware`. AV1 queda en libaom-av1.
    let encoder = if codec == "av1" {
        "libaom-av1".to_owned()
    } else if codec == "h264" {
        crate::commands::sharpen::resolve_encoder(ffmpeg)
            .map_err(|error| error.message)?
    } else {
        let detected = crate::render::ffmpeg::detect_hardware_cached(ffmpeg);
        detected
            .hevc
            .clone()
            .or_else(|| detected.hevc_software.clone())
            .unwrap_or_else(|| "libx265".to_owned())
    };
    let codec_label = if preserve_hdr {
        "H.265 HDR"
    } else {
        match codec {
            "h264" => "H.264",
            "av1" => "AV1",
            _ => "H.265",
        }
    };
    let progress_message = format!(
        "Comprimiendo {} con {codec_label}…",
        input
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default(),
    );
    progress("compressing", Some(0.0), &progress_message);
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-v", "error", "-y", "-i"]);
    command.arg(input);
    if color.is_hdr() && !preserve_hdr {
        command.args(["-vf", HDR_TONEMAP]);
    }
    command.args([
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-map_metadata",
        "0",
        "-map_chapters",
        "0",
    ]);
    // Presupuesto de tamaño objetivo: válido para cualquier encoder (todos
    // aceptan -b:v/-maxrate/-bufsize). Las validaciones de duración y el
    // piso de bitrate son las mismas de antes.
    let size_args: Option<Vec<String>> = if let Some(target_size_mb) = target_size_mb {
        let duration = source_duration
            .filter(|duration| *duration > 0.1)
            .ok_or_else(|| {
                "No se pudo medir la duración para calcular el tamaño objetivo.".to_owned()
            })?;
        let audio_kbps = 160.0;
        // MB decimales, igual que la UI (`formatBytes` divide por 1_000_000).
        let total_kbps = (target_size_mb as f64 * 8.0 * 1_000_000.0 / 1000.0) / duration;
        let video_kbps = total_kbps - audio_kbps;
        if video_kbps < 120.0 {
            let minimum_mb = ((120.0 + audio_kbps) * duration / 8.0 / 1_000.0)
                .ceil()
                .max(1.0);
            return Err(format!(
                "El tamaño objetivo ({target_size_mb} MB) es demasiado chico para {duration:.0} s. \
                 Elegí al menos {minimum_mb:.0} MB."
            ));
        }
        let video_kbps = video_kbps.min(100_000.0);
        Some(vec![
            "-b:v".into(),
            format!("{video_kbps:.0}k"),
            "-maxrate".into(),
            format!("{:.0}k", video_kbps * 1.35),
            "-bufsize".into(),
            format!("{:.0}k", video_kbps * 2.0),
        ])
    } else {
        None
    };
    if codec == "av1" {
        command.args(["-c:v", encoder.as_str(), "-cpu-used", "6", "-row-mt", "1"]);
        if let Some(bitrate) = size_args {
            command.args(&bitrate);
        } else {
            command.args(["-crf", "32", "-b:v", "0"]);
        }
    } else if let Some(bitrate) = size_args {
        command.args(["-c:v", encoder.as_str()]);
        // `-preset` sólo existe en la familia x26x; el resto (nvenc, mf,
        // openh264, kvazaar…) va directo por bitrate.
        if !preserve_hdr
            && (encoder.starts_with("libx264") || encoder.starts_with("libx265"))
        {
            command.args(["-preset", "faster"]);
        }
        command.args(&bitrate);
    } else {
        // Modo calidad: rate control según la familia del encoder resuelto
        // (x26x → preset+CRF; nvenc/amf/qsv → sus flags; openh264/mf/kvazaar
        // → bitrate por píxeles×fps). HDR conserva el preset medium de x265.
        let (width, height, fps) = probe_dims(ffprobe, input);
        let preset = if preserve_hdr { "medium" } else { "faster" };
        let crf_value = crf.unwrap_or(24);
        command.args(crate::commands::sharpen::video_codec_args_preset(
            &encoder, crf_value, width, height, fps, preset,
        ));
    }
    if preserve_hdr {
        let transfer = color
            .transfer
            .map(HdrTransfer::color_trc)
            .unwrap_or("smpte2084");
        command.args([
            "-pix_fmt",
            "yuv420p10le",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            transfer,
            "-colorspace",
            "bt2020nc",
        ]);
    } else {
        command.args(["-pix_fmt", "yuv420p"]);
    }
    command.args(["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]);
    if codec == "av1" {
        command.args(["-tag:v", "av01"]);
    } else if codec == "h265" || preserve_hdr {
        command.args(["-tag:v", "hvc1"]);
    }
    command
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(&output);
    if let Err(message) =
        run_ffmpeg_with_progress(progress, &progress_message, &mut command, source_duration)
    {
        let _ = std::fs::remove_file(&output);
        return Err(message);
    }
    let original_size = std::fs::metadata(input).map(|meta| meta.len()).unwrap_or(0);
    let compressed_size = std::fs::metadata(&output)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if compressed_size == 0 || compressed_size >= original_size {
        let _ = std::fs::remove_file(&output);
        return Ok(None);
    }
    if !keep_original {
        std::fs::remove_file(input).map_err(|_| {
            "Se comprimió el video pero no se pudo reemplazar el archivo original.".to_owned()
        })?;
    }
    Ok(Some(output))
}

fn apply_metadata_cover(
    ffmpeg: &Path,
    path: &Path,
    title: Option<&str>,
    artist: Option<&str>,
    comment: Option<&str>,
    cover: Option<&Path>,
) -> Result<(), String> {
    if title.is_none() && artist.is_none() && comment.is_none() && cover.is_none() {
        return Ok(());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_owned());
    let temp = path.with_file_name(format!("{stem}.meta.{extension}"));
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-v", "error", "-y", "-i"])
        .arg(path);
    let embed_cover = cover.is_some() && !matches!(extension.as_str(), "webm");
    if let Some(cover) = cover.filter(|_| embed_cover) {
        command.arg("-i").arg(cover);
    }
    if embed_cover {
        command.args([
            "-map",
            "0",
            "-map",
            "1",
            "-c",
            "copy",
            "-c:v:1",
            "mjpeg",
            "-disposition:v:1",
            "attached_pic",
        ]);
    } else {
        command.args(["-map", "0", "-c", "copy"]);
    }
    for (key, value) in [("title", title), ("artist", artist), ("comment", comment)] {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            command.args(["-metadata", &format!("{key}={value}")]);
        }
    }
    if extension == "mp4" || extension == "mov" {
        command.args(["-movflags", "+faststart"]);
    }
    command
        .arg(&temp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|_| "No se pudo ejecutar FFmpeg para los metadatos.".to_owned())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(2_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(tail);
    }
    std::fs::remove_file(path)
        .map_err(|_| "No se pudo reemplazar el archivo original.".to_owned())?;
    std::fs::rename(&temp, path)
        .map_err(|_| "No se pudo mover el archivo con metadatos.".to_owned())?;
    Ok(())
}

fn mute_audio_segments(
    ffmpeg: &Path,
    path: &Path,
    segments: &[SponsorSegment],
) -> Result<(), String> {
    let ranges = segments
        .iter()
        .map(|segment| {
            format!(
                "between(t,{:.3},{:.3})",
                segment.start_seconds.max(0.0),
                segment.end_seconds.max(segment.start_seconds + 0.05)
            )
        })
        .collect::<Vec<_>>()
        .join("+");
    if ranges.is_empty() {
        return Ok(());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "mp4" | "mkv" | "mov" | "webm") {
        return Err("El contenedor no permite silenciar sin reencodear el video.".to_owned());
    }
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let temp = path.with_file_name(format!("{stem}.muted.{extension}"));
    let audio_codec = if extension == "webm" {
        "libopus"
    } else {
        "aac"
    };
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-v", "error", "-y", "-i"])
        .arg(path)
        .args(["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy"])
        .args(["-c:a", audio_codec, "-b:a", "160k"])
        .args(["-af", &format!("volume=enable='{ranges}':volume=0")]);
    if extension == "mp4" || extension == "mov" {
        command.args(["-movflags", "+faststart"]);
    }
    command
        .arg(&temp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|_| "No se pudo ejecutar FFmpeg.".to_owned())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(2_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(tail);
    }
    std::fs::remove_file(path)
        .map_err(|_| "No se pudo reemplazar el video original.".to_owned())?;
    std::fs::rename(&temp, path).map_err(|_| "No se pudo mover el video silenciado.".to_owned())?;
    Ok(())
}
