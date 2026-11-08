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
fn gdigrab_input_args(
    target: &str,
    window_title: Option<&str>,
    region_x: Option<i32>,
    region_y: Option<i32>,
    region_width: Option<i32>,
    region_height: Option<i32>,
    fps: u32,
) -> Vec<String> {
    let mut args = vec![
        "-f".to_owned(),
        "gdigrab".to_owned(),
        "-framerate".to_owned(),
        fps.to_string(),
        "-draw_mouse".to_owned(),
        "1".to_owned(),
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
