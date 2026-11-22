fn sanitize_device(device: &str) -> Result<String, ProjectError> {
    let trimmed = device.trim();
    // dshow parsea `-i video=...:audio=...` con ':' como separador y ffmpeg
    // usa ','/';' en grafos: sin estos filtros un nombre podría inyectar
    // opciones extra dentro del argumento -i.
    if trimmed.is_empty()
        || trimmed.len() > 200
        || trimmed.contains('"')
        || trimmed.contains('\'')
        || trimmed.contains(':')
        || trimmed.contains(',')
        || trimmed.contains(';')
    {
        return Err(invalid("el nombre del dispositivo de webcam no es válido"));
    }
    Ok(trimmed.to_owned())
}

/// Argumentos `-f gdigrab ...` compartidos por la grabación y el snapshot
/// de preview: mismo target (desktop/window/region), mismos offsets.
// clippy::too_many_arguments: construye los flags de gdigrab; cada opción
// mapea 1:1 a un flag de FFmpeg.
#[allow(clippy::too_many_arguments)]
fn gdigrab_input_args(
    target: &str,
    window_title: Option<&str>,
    region_x: Option<i32>,
    region_y: Option<i32>,
    region_width: Option<i32>,
    region_height: Option<i32>,
    fps: u32,
    draw_mouse: bool,
) -> Vec<String> {
    let mut args = vec![
        "-f".to_owned(),
        "gdigrab".to_owned(),
        "-framerate".to_owned(),
        fps.to_string(),
        "-draw_mouse".to_owned(),
        if draw_mouse { "1" } else { "0" }.to_owned(),
    ];
    match target {
        "window" => args.extend([
            "-i".to_owned(),
            format!("title={}", window_title.unwrap_or("")),
        ]),
        "region" => args.extend([
            "-offset_x".to_owned(),
            region_x.unwrap_or(0).to_string(),
            "-offset_y".to_owned(),
            region_y.unwrap_or(0).to_string(),
            "-video_size".to_owned(),
            format!(
                "{}x{}",
                region_width.unwrap_or(0),
                region_height.unwrap_or(0)
            ),
            "-i".to_owned(),
            "desktop".to_owned(),
        ]),
        _ => args.extend(["-i".to_owned(), "desktop".to_owned()]),
    }
    args
}

/// Args de vídeo para el mejor encoder H.264 de software que el binario
/// declare. El bundle LGPL no trae `libx264` (es GPL): pedirlo fijo mataba
/// ffmpeg con «Unknown encoder» después de reportar la grabación como
/// iniciada. Se elige el primero disponible, igual que el render principal.
fn h264_software_video_args(ffmpeg: &std::path::Path, crf: u32) -> Result<Vec<String>, String> {
    let available = crate::render::ffmpeg::encoder_names(ffmpeg);
    let pick = ["libx264", "h264_mf", "libopenh264"]
        .into_iter()
        .find(|name| available.iter().any(|candidate| candidate == name));
    let to_args = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let args: Vec<String> = match pick {
        Some("libx264") => {
            let mut args = to_args(&["-c:v", "libx264", "-preset", "veryfast", "-crf"]);
            args.push(crf.to_string());
            args.extend(to_args(&["-pix_fmt", "yuv420p"]));
            args
        }
        Some("h264_mf") => to_args(&[
            "-c:v",
            "h264_mf",
            "-rate_control",
            "quality",
            "-pix_fmt",
            "yuv420p",
        ]),
        Some("libopenh264") => {
            to_args(&["-c:v", "libopenh264", "-b:v", "8M", "-pix_fmt", "yuv420p"])
        }
        _ => {
            return Err(
                "ningún encoder H.264 de software utilizable en este FFmpeg (se probaron libx264, h264_mf y libopenh264)"
                    .to_owned(),
            )
        }
    };
    Ok(args)
}

/// Args `-c:v …` según el encoder elegido ("x264"|"nvenc"|"qsv"|"amf"|"mf").
/// "x264" y cualquier valor desconocido caen al mejor H.264 de software
/// disponible — los NVENC/QSV/AMF/MF son atajos de hardware que liberan CPU.
fn h264_encoder_video_args(
    ffmpeg: &std::path::Path,
    encoder: &str,
    crf: u32,
) -> Result<Vec<String>, String> {
    let to_args = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<String>>();
    Ok(match encoder {
        "nvenc" => to_args(&[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-cq",
            "23",
            "-pix_fmt",
            "yuv420p",
        ]),
        "qsv" => to_args(&[
            "-c:v",
            "h264_qsv",
            "-global_quality",
            "23",
            "-pix_fmt",
            "yuv420p",
        ]),
        "amf" => to_args(&[
            "-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23",
        ]),
        "mf" => to_args(&["-c:v", "h264_mf", "-rate_control", "quality"]),
        _ => h264_software_video_args(ffmpeg, crf)?,
    })
}

fn dshow_video_args(device: &str) -> Vec<String> {
    vec![
        "-f".to_owned(),
        "dshow".to_owned(),
        "-rtbufsize".to_owned(),
        "100M".to_owned(),
        "-i".to_owned(),
        format!("video={device}"),
    ]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevices {
    pub cameras: Vec<String>,
    pub microphones: Vec<String>,
}
