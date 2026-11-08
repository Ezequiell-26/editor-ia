#[derive(Serialize)]
pub struct SampledColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

/// Averages a small frame from a video or image. Used by color match; the
/// frontend turns the two samples into bounded per-channel gains.
#[tauri::command]
pub async fn sample_asset_color(
    state: State<'_, AppState>,
    path: String,
    seconds: f64,
) -> Result<SampledColor, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para muestrear el color",
        ));
    };
    if !seconds.is_finite() || !(0.0..=86_400.0).contains(&seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tiempo del muestreo no es válido",
        ));
    }
    let source = resolve_inside_root(&session.root, path.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del muestreo no está en disco",
        ));
    }
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg(format!("{seconds:.6}"))
        .arg("-i")
        .arg(&source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=8:8",
            "-an",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar el muestreo de color",
        )
    })?;
    if !output.status.success() || output.stdout.len() < 8 * 8 * 3 {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo muestrear un frame de color",
        ));
    }
    let mut sums = [0u64; 3];
    for pixel in output.stdout.as_chunks::<3>().0.iter().take(8 * 8) {
        sums[0] += pixel[0] as u64;
        sums[1] += pixel[1] as u64;
        sums[2] += pixel[2] as u64;
    }
    let count = 8.0 * 8.0;
    Ok(SampledColor {
        r: (sums[0] as f64 / count * 10.0).round() / 10.0,
        g: (sums[1] as f64 / count * 10.0).round() / 10.0,
        b: (sums[2] as f64 / count * 10.0).round() / 10.0,
    })
}

#[derive(Serialize)]
pub struct ProxyCreated {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

#[tauri::command]
pub async fn create_video_proxy(
    state: State<'_, AppState>,
    path: String,
) -> Result<ProxyCreated, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para crear un proxy",
        ));
    };
    let source = resolve_inside_root(&session.root, path.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del proxy ya no está en disco",
        ));
    }
    let directory = session.root.join("media").join("proxies");
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/proxies")
    })?;
    let file_name = format!("proxy-{}.mp4", uuid::Uuid::new_v4());
    let target = directory.join(&file_name);
    // Proxy con GPU si la máquina tiene encoder de hardware: es material de
    // vista previa, donde la velocidad pesa más que la máxima calidad.
    let hw = crate::commands::audio::hardware_h264(&ffmpeg);
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .args(["-map", "0:v:0", "-map", "0:a?"])
        .args([
            "-vf",
            "scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        ])
        .args(crate::commands::audio::proxy_video_args(hw.as_deref()))
        .args([
            "-c:a",
            "aac",
            "-b:a",
            "96000",
            "-movflags",
            "+faststart",
        ])
        .arg(&target);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para el proxy",
        )
    })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&target);
        let message = String::from_utf8_lossy(&output.stderr);
        let tail: String = message
            .chars()
            .rev()
            .take(300)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("FFmpeg no pudo crear el proxy: {tail}"),
        ));
    }
    let measure = probe_file(&ffprobe, &target, MediaKind::Video)?;
    let width = measure.width.unwrap_or(0);
    let height = measure.height.unwrap_or(0);
    if width == 0 || height == 0 {
        let _ = std::fs::remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el proxy se generó sin dimensiones legibles",
        ));
    }
    let bytes = std::fs::metadata(&target)
        .map(|value| value.len())
        .unwrap_or(0);
    Ok(ProxyCreated {
        path: format!("media/proxies/{file_name}"),
        width,
        height,
        bytes,
    })
}

#[tauri::command]
pub async fn extract_freeze_frame(
    state: State<'_, AppState>,
    path: String,
    seconds: f64,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para congelar un frame",
        ));
    };
    if !seconds.is_finite() || !(0.0..=86_400.0).contains(&seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tiempo del frame no es válido",
        ));
    }
    let source = resolve_inside_root(&session.root, path.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del frame ya no está en disco",
        ));
    }
    let temp = std::env::temp_dir().join(format!("freeze-{}.png", uuid::Uuid::new_v4()));
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .arg("-ss")
        .arg(format!("{seconds:.6}"))
        .arg("-frames:v")
        .arg("1")
        .arg("-an")
        .arg(&temp);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para congelar",
        )
    })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let message = String::from_utf8_lossy(&output.stderr);
        let tail: String = message
            .chars()
            .rev()
            .take(300)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("FFmpeg no pudo extraer el frame: {tail}"),
        ));
    }
    let imported = import_file(
        &session.root,
        &temp,
        &ffprobe,
        fps_num.max(1),
        fps_den.max(1),
    );
    let _ = std::fs::remove_file(&temp);
    imported
}
