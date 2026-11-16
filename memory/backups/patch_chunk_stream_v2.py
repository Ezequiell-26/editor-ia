from pathlib import Path

path = Path(r"D:\Users\ofici\QODER-WORK\editor-ia-architecture\apps\desktop\src-tauri\src\commands\domains\media\object_track.rs")
source = path.read_text(encoding="utf-8")
start = source.index("fn track_stream(")
end = source.index("\n#[cfg(test)]\nmod tests", start)

replacement = r'''fn track_stream(
    app: Option<&AppHandle>,
    ffmpeg: &PathBuf,
    input: &std::path::Path,
    start_seconds: f64,
    duration: f64,
    rect: ObjectTrackRect,
    width: u32,
    height: u32,
) -> Result<Vec<ObjectTrackSample>, ProjectError> {
    const CHUNK_FRAMES: usize = (SAMPLE_FPS as usize) * 5;
    let seed_rect = rect.clone();
    let filter = format!("fps={SAMPLE_FPS},scale={width}:{height}");
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .arg("-ss")
        .arg(format!("{start_seconds:.3}"))
        .arg("-t")
        .arg(format!("{duration:.3}"))
        .arg("-i")
        .arg(input)
        .args(["-vf", &filter, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    crate::commands::hide_console(&mut command);
    let mut child = command
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo lanzar FFmpeg para el seguimiento: {error}").as_str(),
            )
        })?;
    let mut stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no devolvió frames")
    })?;

    let frame_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(3))
        .filter(|bytes| *bytes > 0)
        .ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::InvalidProject, "dimensiones de frame inválidas")
        })?;
    let mut frame = vec![0u8; frame_bytes];
    let mut first_byte = [0u8; 1];
    let mut chunk = Vec::with_capacity(CHUNK_FRAMES);
    let mut samples = Vec::new();
    let seed_max_side = (seed_rect.w * width as f64)
        .max(seed_rect.h * height as f64)
        .max(1.0);

    loop {
        let read = stdout.read(&mut first_byte).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudieron leer los frames del seguimiento: {error}").as_str(),
            )
        })?;
        if read == 0 {
            break;
        }
        frame[0] = first_byte[0];
        if let Err(error) = stdout.read_exact(&mut frame[1..]) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                format!("FFmpeg devolvió un frame incompleto durante el seguimiento: {errror}")
                    .as_str(),
            ));
        }
        chunk.push(frame.clone());

        // Track only a short window at a time. This bounds decoded-frame memory
        // to ~5 seconds and re-seeds the next chunk at the previous target box.
        if chunk.len() >= CHUNK_FRLES:
            let mut tracked = track_frames(&chunk, width, height, &rect);
            let offset = samples.len() as f64 / f64::from(SAMPLE_FPS);
            for sample in &mut tracked {
                sample.time += offset;
            }
            if let Some(last) = tracked.last() {
                let scale = (last.size * f64::from(width.max(height)) / seed_max_side)
                    .clamp(MIN_SCALE, MAX_SCALE);
                let next_w = (seed_rect.w * scale).clamp(0.005, 1.0);
                let next_h = (seed_rect.h * scale).clamp(0.005, 1.0);
                rect = ObjectTrackRect {
                    x: (last.center_x - next_w / 2.0).clamp(0.0, 1.0 - next_w),
                    y: (last.center_y - next_h / 2.0).clamp(0.0, 1.0 - next_h),
                    w: next_w,
                    h: next_h,
                };
            }
            samples.extend(tracked);
            chunk.clear();
        }
    }

    if !chunk.is_empty() {
        let mut tracked = track_frames(&chunk, width, height, &rect);
        let offset = samples.len() as f64 / f64::from(SAMPLE_FPS);
        for sample in &mut tracked {
            sample.time += offset;
        }
        samples.extend(tracked);
    }

    let status = child.wait().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo completar FFmpeg: {error}").as_str(),
        )
    })?;
    if !status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg terminó con error durante el seguimiento del objeto",
        ));
    }
    if samples.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no produjo frames para el seguimiento",
        ));
    }
    let _ = app;
    Ok(samples)
}
'''
source = source[:start] + replacement + source[end:]
source = source.replace(
    "//! Los frames se extraen con FFmpeg a rwavideo rgb24 escalado a un lado\n//! máximo de `MAX_DIM` px y se consumen en streaming (nunca se acumulan en\n//! memoria). La salida usa la misma forma que `FaceSample`, asé el frontend"
    "//! Los frames se extraen con FFmpeg a rawvideo rgb24 escalado a un lado\n//! máximo de `MAX_DIM` px y se procesan en ventanas de cinco segundos; la\n//! memoria de frames queda acotada y sólo se conservan muestras del track.",
    1,
)
path.write_text(source, encoding="utf-8")
print("replaced track_stream with bounded five-second chunk processing")
