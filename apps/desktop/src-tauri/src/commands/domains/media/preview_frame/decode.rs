fn profile_for(project: &Value) -> Result<Profile, ProjectError> {
    let width = project["video"]["width"].as_u64().unwrap_or(0);
    let height = project["video"]["height"].as_u64().unwrap_or(0);
    let fps_num = project["video"]["frameRate"]["num"].as_u64().unwrap_or(0) as u32;
    let fps_den = project["video"]["frameRate"]["den"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 || fps_num == 0 || fps_den == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto no tiene resolución o fps válidos para el preview",
        ));
    }
    Ok(Profile {
        id: "preview".to_owned(),
        name: "preview".to_owned(),
        width: width as u32,
        height: height as u32,
        fps_num,
        fps_den,
        crf: None,
        target_bps: None,
        video_preset: "veryfast".to_owned(),
        fit: "contain".to_owned(),
        audio_bps: 128_000,
        video_codec: "h264".to_owned(),
        audio_codec: "aac".to_owned(),
        container: "mp4".to_owned(),
        audio_rate: 48_000,
        audio_channels: 2,
        pixel_format: "yuv420p".to_owned(),
        min_output_bytes: 1,
        duration_tolerance_frames: 1,
        hardware_encoder: None,
    })
}

fn source_time(clip: &Value, frame: u64, fps: f64) -> (f64, bool) {
    let start = clip["startFrame"].as_u64().unwrap_or(0);
    let duration = clip["durationFrames"].as_u64().unwrap_or(1).max(1);
    let local = frame.saturating_sub(start).min(duration.saturating_sub(1));
    let source = &clip["source"];
    let kind = clip["kind"].as_str().unwrap_or("video");
    if kind == "image" || kind == "graphic" || source["type"].as_str() != Some("asset") {
        return (0.0, true);
    }
    let in_frame = source["inFrame"].as_u64().unwrap_or(0) as f64;
    let out_frame = source["outFrame"].as_u64().unwrap_or(0) as f64;
    let speed_num = clip["speed"]["num"].as_f64().unwrap_or(1.0).max(0.01);
    let speed_den = clip["speed"]["den"].as_f64().unwrap_or(1.0).max(0.01);
    let local_seconds = local as f64 / fps.max(1.0);
    let reverse = clip["reverse"].as_bool().unwrap_or(false);
    let time = if reverse {
        out_frame / fps.max(1.0) - local_seconds * speed_num / speed_den
    } else {
        in_frame / fps.max(1.0) + local_seconds * speed_num / speed_den
    };
    (time.max(0.0), false)
}

/// Metadatos medidos del contenedor: dimensiones codificadas, rotación de
/// presentación y relación de aspecto de píxel. Se leen con libavformat, sin
/// lanzar ffprobe, para decidir si el frame nativo se puede decodificar en
/// proceso o si conviene delegar en el ejecutable.
#[derive(Debug, Clone, Copy)]
struct SourceProbe {
    width: u32,
    height: u32,
    rotation_degrees: f64,
    sample_aspect: f64,
}

/// Resuelve las dimensiones visibles del medio: aplica SAR y sólo intercambia
/// ancho/alto para rotaciones de 90°/270°.
fn display_dimensions(probe: &SourceProbe) -> (u32, u32) {
    let rotation = probe.rotation_degrees.abs();
    let swapped = rotation > 45.0 && rotation < 135.0;
    let mut width = (probe.width as f64 * probe.sample_aspect).round() as u32;
    let mut height = probe.height;
    if swapped {
        std::mem::swap(&mut width, &mut height);
    }
    (width, height)
}

fn probe_source(input: &Path) -> Option<SourceProbe> {
    use video_rs::ffmpeg;

    let context = ffmpeg::format::input(input).ok()?;
    let stream = context.streams().best(ffmpeg::media::Type::Video)?;
    let parameters = stream.parameters();
    let raw = unsafe { &*parameters.as_ptr() };
    if raw.width <= 0 || raw.height <= 0 {
        return None;
    }
    let sample_aspect = if raw.sample_aspect_ratio.num > 0 && raw.sample_aspect_ratio.den > 0 {
        raw.sample_aspect_ratio.num as f64 / raw.sample_aspect_ratio.den as f64
    } else {
        1.0
    };
    let rotation_degrees = stream
        .side_data()
        .find(|side| {
            matches!(
                side.kind(),
                ffmpeg::codec::packet::side_data::Type::DisplayMatrix
            )
        })
        .and_then(|side| {
            let data = side.data();
            if data.len() < 36 {
                return None;
            }
            let mut matrix = [0_i32; 9];
            for (index, slot) in matrix.iter_mut().enumerate() {
                let offset = index * 4;
                *slot = i32::from_le_bytes([
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                    data[offset + 3],
                ]);
            }
            let radians = (matrix[1] as f64).atan2(matrix[0] as f64);
            radians.is_finite().then(|| radians.to_degrees())
        })
        .unwrap_or(0.0);
    Some(SourceProbe {
        width: raw.width as u32,
        height: raw.height as u32,
        rotation_degrees,
        sample_aspect,
    })
}

/// PTS del primer frame del stream. `video-rs` entrega timestamps absolutos;
/// sumar este desfase evita elegir un frame equivocado en contenedores con
/// edit lists o start_time distinto de cero.
fn stream_start_seconds(input: &Path) -> Option<f64> {
    use video_rs::ffmpeg;

    let context = ffmpeg::format::input(input).ok()?;
    let stream = context.streams().best(ffmpeg::media::Type::Video)?;
    let start = stream.start_time();
    if start <= 0 || start == i64::MIN {
        return Some(0.0);
    }
    let base = stream.time_base();
    Some(start as f64 * base.numerator() as f64 / base.denominator() as f64)
}

fn ensure_video_rs() -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| video_rs::init().map_err(|error| error.to_string()))
        .clone()
}

struct DecodedFrame {
    path: PathBuf,
    width: u32,
    height: u32,
}

/// Decodifica un frame en proceso y lo guarda como PNG RGB. Devuelve un error
/// explicable para que el llamador pueda caer al ejecutable de FFmpeg.
fn decode_native_frame(input: &Path, time: f64, output_dir: &Path) -> Result<DecodedFrame, String> {
    ensure_video_rs()?;
    let mut decoder = video_rs::decode::Decoder::new(input)
        .map_err(|error| format!("video-rs no pudo abrir el medio: {error}"))?;
    let target = stream_start_seconds(input).unwrap_or(0.0) + time.max(0.0);
    if target > 0.05 {
        let milliseconds = (target * 1000.0).round().clamp(0.0, i64::MAX as f64) as i64;
        decoder
            .seek(milliseconds)
            .map_err(|error| format!("video-rs no pudo buscar el frame: {error}"))?;
    }
    let mut best: Option<(f64, video_rs::Frame)> = None;
    for _ in 0..900 {
        match decoder.decode() {
            Ok((timestamp, frame)) => {
                let seconds = timestamp.as_secs_f64();
                let better = best
                    .as_ref()
                    .is_none_or(|(current, _)| (seconds - target).abs() < (current - target).abs());
                if better {
                    best = Some((seconds, frame));
                }
                if seconds + 0.0005 >= target {
                    break;
                }
            }
            Err(video_rs::Error::DecodeExhausted) => break,
            Err(error) => {
                return Err(format!("video-rs no pudo decodificar el frame: {error}"));
            }
        }
    }
    let (_, frame) = best.ok_or_else(|| "video-rs no devolvió ningún frame".to_owned())?;
    let (height, width, _) = frame.dim();
    if width == 0 || height == 0 {
        return Err("video-rs devolvió un frame vacío".to_owned());
    }
    let pixels = frame
        .as_slice()
        .ok_or_else(|| "video-rs devolvió un frame no contiguo".to_owned())?;
    let path = output_dir.join(format!("native-{}.png", Uuid::new_v4()));
    image::save_buffer_with_format(
        &path,
        pixels,
        width as u32,
        height as u32,
        image::ColorType::Rgb8,
        image::ImageFormat::Png,
    )
    .map_err(|error| format!("no se pudo escribir el frame nativo: {error}"))?;
    Ok(DecodedFrame {
        path,
        width: width as u32,
        height: height as u32,
    })
}

/// Copia el perfil del proyecto con las dimensiones reales del medio. La
/// cadena de efectos vuelve a escalar a este tamaño, así que el resultado
/// conserva el grade y la máscara sin perder píxeles.
fn at_dimensions(profile: &Profile, width: u32, height: u32) -> Profile {
    let mut native = profile.clone();
    native.id = "preview-native".to_owned();
    native.name = "preview-native".to_owned();
    native.width = (width.max(2)) & !1;
    native.height = (height.max(2)) & !1;
    native
}

struct NativeInput {
    profile: Profile,
    path: PathBuf,
    /// El path de entrada ya es una imagen: no se le aplica `-ss`.
    still: bool,
    decoder: &'static str,
    native: bool,
    cleanup: Option<PathBuf>,
}

/// Resuelve la entrada del preview nativo. Para videos sin rotación y con
/// píxeles cuadrados se decodifica en proceso con `video-rs`; el resto usa el
/// ejecutable, que aplica autorrotación y SAR, o vuelve al perfil del lienzo
/// si el contenedor no se puede sondear.
fn native_input(
    input: &Path,
    is_image: bool,
    time: f64,
    base: &Profile,
    output_dir: &Path,
) -> NativeInput {
    if is_image {
        let (width, height) = image::image_dimensions(input).unwrap_or((base.width, base.height));
        return NativeInput {
            profile: at_dimensions(base, width, height),
            path: input.to_path_buf(),
            still: true,
            decoder: "ffmpeg",
            native: true,
            cleanup: None,
        };
    }
    if let Some(probe) = probe_source(input) {
        let rotation = probe.rotation_degrees.abs();
        let rotated = rotation > 45.0;
        let square_pixels = (probe.sample_aspect - 1.0).abs() < 0.01;
        if !rotated && square_pixels {
            match decode_native_frame(input, time, output_dir) {
                Ok(decoded) => {
                    if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
                        eprintln!(
                            "preview nativo: video-rs {}x{} en {:.3}s",
                            decoded.width, decoded.height, time
                        );
                    }
                    return NativeInput {
                        profile: at_dimensions(base, decoded.width, decoded.height),
                        path: decoded.path.clone(),
                        still: true,
                        decoder: "video-rs",
                        native: true,
                        cleanup: Some(decoded.path),
                    };
                }
                Err(error) => {
                    if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
                        eprintln!("preview nativo: video-rs falló, uso FFmpeg: {error}");
                    }
                }
            }
        }
        let (width, height) = display_dimensions(&probe);
        return NativeInput {
            profile: at_dimensions(base, width, height),
            path: input.to_path_buf(),
            still: false,
            decoder: "ffmpeg",
            native: true,
            cleanup: None,
        };
    }
    NativeInput {
        profile: base.clone(),
        path: input.to_path_buf(),
        still: false,
        decoder: "ffmpeg",
        native: false,
        cleanup: None,
    }
}

/// Borra el PNG intermedio aunque el render falle a mitad de camino.
struct Cleanup(Option<PathBuf>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}
