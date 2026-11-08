use super::*;

#[derive(Debug, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub crf: Option<u8>,
    pub target_bps: Option<u64>,
    pub video_preset: String,
    pub fit: String,
    pub audio_bps: u32,
    pub video_codec: String,
    pub audio_codec: String,
    pub container: String,
    pub audio_rate: u32,
    pub audio_channels: u32,
    pub min_output_bytes: u64,
    pub duration_tolerance_frames: u32,
    pub hardware_encoder: Option<String>,
    /// Submuestreo de croma del vídeo de salida (`yuv420p` por defecto).
    /// `yuv444p` sólo se admite en WebM VP9/AV1 por software: los encoders de
    /// hardware y H.264/H.265 de este pipeline son 4:2:0.
    pub pixel_format: String,
}

pub(crate) const HARDWARE_H264: [&str; 3] = ["h264_amf", "h264_nvenc", "h264_qsv"];

/// Encoders de software en orden de preferencia.
///
/// Los builds LGPL de FFmpeg no incluyen `libx264` (es GPL). Sin este orden, el
/// render fallaba con «Unknown encoder 'libx264'» aunque el binario tuviera
/// `h264_mf` o `libopenh264`. Se elige el primero que el binario declare.
pub(crate) const SOFTWARE_H264: [&str; 6] = [
    "libx264",
    "h264_mf",
    "libopenh264",
    "h264_nvenc",
    "h264_qsv",
    "h264_amf",
];
pub(crate) const SOFTWARE_H265: [&str; 5] =
    ["libx265", "hevc_mf", "hevc_nvenc", "hevc_qsv", "hevc_amf"];
/// VP9 sólo tiene encoder de software en la práctica (`libvpx-vp9`); `vp9_qsv`
/// existe pero es nicho y se ofrece por `hardwareEncoder` explícito.
pub(crate) const SOFTWARE_VP9: [&str; 1] = ["libvpx-vp9"];
/// AV1: SVT-AV1 primero (el más rápido de los software), después los de
/// hardware como fallback y libaom como último recurso compatible.
pub(crate) const SOFTWARE_AV1: [&str; 5] =
    ["libsvtav1", "av1_nvenc", "av1_qsv", "av1_amf", "libaom-av1"];

pub(crate) static ENCODER_CACHE: std::sync::Mutex<Option<(PathBuf, Vec<String>)>> =
    std::sync::Mutex::new(None);

/// `ffmpeg` que acompaña al `ffprobe` configurado; si no existe, el del PATH.
pub(crate) fn sibling_ffmpeg(ffprobe: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let candidate = ffprobe.with_file_name(name);
    if candidate.is_file() {
        candidate
    } else {
        PathBuf::from("ffmpeg")
    }
}

/// Lista de encoders de video que el binario declara (`-encoders`), cacheada.
pub(crate) fn available_encoders(ffmpeg: &Path) -> Vec<String> {
    let mut guard = match ENCODER_CACHE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some((path, list)) = guard.as_ref() {
        if path == ffmpeg {
            return list.clone();
        }
    }
    let mut list = Vec::new();
    if let Ok(output) = std::process::Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let mut parts = line.split_whitespace();
            let (Some(flags), Some(name)) = (parts.next(), parts.next()) else {
                continue;
            };
            // Formato: " V....D libx264   ..." (seis letras de capacidades).
            if flags.len() == 6 && flags.starts_with('V') {
                list.push(name.to_owned());
            }
        }
    }
    *guard = Some((ffmpeg.to_path_buf(), list.clone()));
    list
}

/// Elige el encoder de software según lo que el binario realmente ofrece.
pub(crate) fn choose_encoder(available: &[String], codec: &str) -> String {
    let prefs: &[&str] = match codec {
        "h265" => &SOFTWARE_H265,
        "vp9" => &SOFTWARE_VP9,
        "av1" => &SOFTWARE_AV1,
        _ => &SOFTWARE_H264,
    };
    for name in prefs {
        if available.iter().any(|candidate| candidate == name) {
            return (*name).to_owned();
        }
    }
    // Sin información (sondeo fallido): se mantiene el comportamiento histórico.
    prefs[0].to_owned()
}

/// Nombres de encoders de video del binario, para `export_capabilities`.
pub(crate) fn encoder_names(ffmpeg: &Path) -> Vec<String> {
    available_encoders(ffmpeg)
}

/// Binario FFmpeg a sondear: el que acompaña al `ffprobe` configurado; si no
/// existe, el `ffmpeg` del PATH. En pruebas no se sondea el PATH: el resultado
/// dependería de la máquina y los planes esperados dejarían de ser
/// deterministas.
pub(crate) fn encoder_probe_target(ffprobe: &Path) -> Option<PathBuf> {
    let sibling = sibling_ffmpeg(ffprobe);
    if sibling.is_file() {
        Some(sibling)
    } else if cfg!(test) {
        None
    } else {
        Some(PathBuf::from("ffmpeg"))
    }
}

pub(crate) fn software_encoder(ffprobe: &Path, codec: &str) -> String {
    match encoder_probe_target(ffprobe) {
        Some(ffmpeg) => choose_encoder(&available_encoders(&ffmpeg), codec),
        None => choose_encoder(&[], codec),
    }
}

/// Encoder de software según el perfil. 4:4:4 es la excepción: ni
/// `libsvtav1` ni los encoders de hardware aceptan `yuv444p` (degradarían a
/// 4:2:0 en silencio), así que VP9 exige `libvpx-vp9` y AV1 exige
/// `libaom-av1`; si el binario no los tiene, se informa en vez de producir un
/// archivo que no cumple el perfil.
pub(crate) fn software_encoder_for(
    ffprobe: &Path,
    profile: &Profile,
) -> Result<String, ProjectError> {
    if profile.pixel_format == "yuv444p" {
        let (needed, label) = if profile.video_codec == "av1" {
            ("libaom-av1", "AV1")
        } else {
            ("libvpx-vp9", "VP9")
        };
        let available = match encoder_probe_target(ffprobe) {
            Some(ffmpeg) => available_encoders(&ffmpeg),
            None => Vec::new(),
        };
        if available.iter().any(|name| name == needed) {
            return Ok(needed.to_owned());
        }
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("{label} 4:4:4 requiere {needed} y este FFmpeg no lo incluye; usá 4:2:0"),
        ));
    }
    Ok(software_encoder(ffprobe, &profile.video_codec))
}
pub(crate) const HARDWARE_HEVC: [&str; 3] = ["hevc_amf", "hevc_nvenc", "hevc_qsv"];
pub(crate) const HARDWARE_AV1: [&str; 3] = ["av1_amf", "av1_nvenc", "av1_qsv"];
pub(crate) const HARDWARE_VP9: [&str; 2] = ["vp9_qsv", "vp9_amf"];

pub(crate) fn validate_hardware_encoder(
    video_codec: &str,
    encoder: &str,
    width: u32,
    height: u32,
) -> Result<(), ProjectError> {
    let supported = match video_codec {
        "h265" => HARDWARE_HEVC.contains(&encoder),
        "av1" => HARDWARE_AV1.contains(&encoder),
        "vp9" => HARDWARE_VP9.contains(&encoder),
        _ => HARDWARE_H264.contains(&encoder),
    };
    if !supported {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el encoder de hardware no coincide con el códec del perfil",
        ));
    }
    // Los encoders de hardware tienen límites más chicos que libx264/libx265.
    let max_side = if video_codec == "h265" { 8192 } else { 4096 };
    if width > max_side || height > max_side {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ese encoder de hardware no admite esta resolución; exportá con software",
        ));
    }
    Ok(())
}

impl Profile {
    pub fn fps(&self) -> f64 {
        if self.fps_den == 0 {
            30.0
        } else {
            self.fps_num as f64 / self.fps_den as f64
        }
    }

    pub(super) fn fps_arg(&self) -> String {
        format!("{}/{}", self.fps_num.max(1), self.fps_den.max(1))
    }
}

#[derive(Debug, Clone)]
pub struct RenderPlan {
    pub args: Vec<String>,
    pub output_path: PathBuf,
    pub working_dir: PathBuf,
    pub duration_seconds: f64,
    pub min_output_bytes: u64,
    pub duration_tolerance_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgress {
    pub percent: f64,
    pub processed_seconds: f64,
    pub total_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderVerification {
    pub output_bytes: u64,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

pub(crate) fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

pub fn parse_profile(value: &Value) -> Result<Profile, ProjectError> {
    let width = value["resolution"]["width"].as_u64().unwrap_or(0);
    let height = value["resolution"]["height"].as_u64().unwrap_or(0);
    let fps_num = value["frameRate"]["num"].as_u64().unwrap_or(0) as u32;
    let fps_den = value["frameRate"]["den"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 || fps_num == 0 || fps_den == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el perfil de render no declara resolución y tasa de cuadros válidas",
        ));
    }
    let container = text(value, "container").unwrap_or("mp4").to_owned();
    let video_codec = text(value, "videoCodec").unwrap_or("h264").to_owned();
    let audio_codec = text(value, "audioCodec").unwrap_or("aac").to_owned();
    // Misma matriz que `CONTAINER_MATRIX` de packages/project-schema/delivery.ts:
    // MP4/MOV llevan H.264/H.265 + AAC; WebM lleva VP9/AV1 + Opus.
    let webm = container == "webm";
    if container != "mp4" && container != "mov" && !webm {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "esta versión exporta MP4/MOV/WebM; el perfil pide otro contenedor",
        ));
    }
    let codec_ok = if webm {
        video_codec == "vp9" || video_codec == "av1"
    } else {
        video_codec == "h264" || video_codec == "h265"
    };
    if !codec_ok {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el códec de video no corresponde al contenedor del perfil",
        ));
    }
    // libx264 rechaza anchos/altos de más de 16 384; libx265 sí acepta 32K.
    // Se avisa antes de lanzar FFmpeg para no perder el render.
    if video_codec == "h264" && (width > 16_384 || height > 16_384) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "H.264 no admite más de 16 384 px por lado; para 32K elegí H.265",
        ));
    }
    let audio_ok = if webm {
        audio_codec == "opus"
    } else {
        audio_codec == "aac"
    };
    if !audio_ok {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el códec de audio no corresponde al contenedor del perfil",
        ));
    }
    let bitrate_mode = value["bitrate"]["mode"].as_str().unwrap_or("crf");
    let crf = (bitrate_mode == "crf")
        .then(|| {
            value["bitrate"]["crf"]
                .as_u64()
                .map(|value| value.clamp(0, 51) as u8)
        })
        .flatten()
        .or_else(|| (bitrate_mode != "target").then_some(20));
    let target_bps = (bitrate_mode == "target")
        .then(|| value["bitrate"]["videoBitsPerSecond"].as_u64())
        .flatten();
    const PRESETS: [&str; 8] = [
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
    ];
    // Default medido en esta máquina (30,1 s de 1080p30, CRF 20, libx264):
    //   veryfast 3,02 s / 1,59 MB | faster 3,73 s | fast 4,00 s / 1,67 MB | medium 3,98 s
    // `fast` era ~32 % mas lento y ademas mas grande al mismo CRF, sin beneficio de
    // tamano, asi que se mantiene `veryfast` (que es lo que ya usan audio.rs,
    // creator.rs y lossless.rs). El frontend no manda `videoPreset`: este valor
    // es el que decide la velocidad real del export.
    let requested_preset = text(value, "videoPreset").unwrap_or("veryfast");
    if !PRESETS.contains(&requested_preset) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el perfil pide un preset de encoder desconocido",
        ));
    }
    let fit = text(value, "fit").unwrap_or("contain");
    if fit != "contain" && fit != "cover" {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el perfil pide un encuadre desconocido",
        ));
    }
    let hardware_encoder = text(value, "hardwareEncoder").map(str::to_owned);
    if let Some(encoder) = hardware_encoder.as_deref() {
        validate_hardware_encoder(&video_codec, encoder, width as u32, height as u32)?;
    }
    let pixel_format =
        pixel_format_for(value, &container, &video_codec, hardware_encoder.as_deref())?;
    Ok(Profile {
        id: text(value, "id").unwrap_or_default().to_owned(),
        name: text(value, "name").unwrap_or("Render").to_owned(),
        width: width as u32,
        height: height as u32,
        fps_num,
        fps_den,
        crf,
        target_bps,
        video_preset: requested_preset.to_owned(),
        fit: fit.to_owned(),
        audio_bps: value["audioBitsPerSecond"]
            .as_u64()
            .unwrap_or(128_000)
            .clamp(16_000, 512_000) as u32,
        video_codec,
        audio_codec,
        container,
        audio_rate: value["audioSampleRate"].as_u64().unwrap_or(48_000) as u32,
        audio_channels: value["audioChannels"].as_u64().unwrap_or(2).clamp(1, 8) as u32,
        min_output_bytes: value["qualityGate"]["minOutputBytes"]
            .as_u64()
            .unwrap_or(100_000),
        duration_tolerance_frames: value["qualityGate"]["durationToleranceFrames"]
            .as_u64()
            .unwrap_or(10) as u32,
        hardware_encoder,
        pixel_format,
    })
}

/// Pixel format declarado por el perfil, validado contra lo que el pipeline
/// puede emitir de verdad. `yuv444p` existe sólo en WebM VP9 (`libvpx-vp9`)
/// y AV1 (`libaom-av1`): H.264/H.265, los encoders de hardware y `rgb24`
/// (que ningún encoder de entrega acepta) se rechazan con motivo honesto.
pub(crate) fn pixel_format_for(
    value: &Value,
    container: &str,
    video_codec: &str,
    hardware_encoder: Option<&str>,
) -> Result<String, ProjectError> {
    let requested = text(value, "pixelFormat").unwrap_or("yuv420p");
    match requested {
        "yuv420p" => Ok("yuv420p".to_owned()),
        "yuv444p" => {
            let webm_444 = container == "webm" && (video_codec == "vp9" || video_codec == "av1");
            if webm_444 && hardware_encoder.is_none() {
                Ok("yuv444p".to_owned())
            } else {
                Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "4:4:4 sólo se exporta en WebM VP9/AV1 por software; para MP4/MOV o hardware usá 4:2:0",
                ))
            }
        }
        "rgb24" => Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "rgb24 es un formato intermedio: ningún encoder de entrega lo acepta; elegí yuv420p o yuv444p",
        )),
        _ => Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el perfil pide un pixel format desconocido",
        )),
    }
}

pub(crate) fn hardware_encoder_args(profile: &Profile) -> Option<Vec<String>> {
    let encoder = profile.hardware_encoder.as_deref()?;
    let quality = profile.crf.unwrap_or(20).clamp(0, 51).to_string();
    let mut args = vec!["-c:v".to_owned(), encoder.to_owned()];
    if let Some(bps) = profile.target_bps {
        args.extend(["-b:v".to_owned(), bps.to_string()]);
    } else if encoder.ends_with("_amf") {
        args.extend([
            "-rc".to_owned(),
            "cqp".to_owned(),
            "-qp_i".to_owned(),
            quality.clone(),
            "-qp_p".to_owned(),
            quality,
            "-quality".to_owned(),
            "quality".to_owned(),
        ]);
    } else if encoder.ends_with("_nvenc") {
        args.extend([
            "-rc".to_owned(),
            "vbr".to_owned(),
            "-cq".to_owned(),
            quality,
            "-b:v".to_owned(),
            "0".to_owned(),
            "-preset".to_owned(),
            "p6".to_owned(), // p6 (default) = 2x más rápido que p5 con ~5% menos calidad
            "-tune".to_owned(),
            "hq".to_owned(), // Mantener alta calidad
        ]);
    } else if encoder.ends_with("_qsv") {
        args.extend(["-global_quality".to_owned(), quality]);
    }
    Some(args)
}

/// Argumentos de calidad por familia de encoder de software.
///
/// Cada familia habla un dialecto distinto: x264/x265 usan `-preset`+`-crf`;
/// libvpx-vp9 y libaom-av1 exigen `-b:v 0` en modo CRF; libsvtav1 usa su propia
/// escala de presets (0-13); el resto (mf/openh264) sólo entiende bitrate.
/// Encoder y sample rate de audio según el códec del perfil.
/// Opus sólo existe como `libopus` y trabaja a 48 kHz: se fuerza el rate
/// aunque el perfil pida otra cosa (FFmpeg rechazaría el resto).
pub(crate) fn audio_encoder_for(profile: &Profile) -> (&'static str, u32) {
    if profile.audio_codec == "opus" {
        ("libopus", 48_000)
    } else {
        ("aac", profile.audio_rate)
    }
}

pub(crate) fn software_video_args(encoder: &str, profile: &Profile) -> Vec<String> {
    let mut args = vec!["-c:v".to_owned(), encoder.to_owned()];
    let crf = profile.crf.map(|value| value.to_string());
    let bps = profile.target_bps.map(|value| value.to_string());
    if encoder.starts_with("libx26") {
        args.extend(["-preset".into(), profile.video_preset.clone()]);
        if let Some(crf) = crf {
            args.extend(["-crf".into(), crf]);
        }
        if let Some(bps) = bps {
            args.extend(["-b:v".into(), bps]);
        }
    } else if encoder == "libvpx-vp9" {
        // cpu-used 0-8: más alto = más rápido (8 es el tope de libvpx).
        let cpu_used = match profile.video_preset.as_str() {
            "ultrafast" | "superfast" => 8,
            "veryfast" => 7,
            "faster" => 6,
            "fast" => 5,
            "medium" => 4,
            "slow" => 3,
            _ => 2,
        };
        args.extend([
            "-cpu-used".into(),
            cpu_used.to_string(),
            "-row-mt".into(),
            "1".into(),
        ]);
        match (crf, bps) {
            (Some(crf), _) => args.extend(["-crf".into(), crf, "-b:v".into(), "0".into()]),
            (None, Some(bps)) => args.extend(["-b:v".into(), bps]),
            (None, None) => args.extend(["-b:v".into(), "0".into(), "-crf".into(), "32".into()]),
        }
    } else if encoder == "libsvtav1" {
        // SVT-AV1: presets 0-13, más alto = más rápido.
        let preset = match profile.video_preset.as_str() {
            "ultrafast" => 13,
            "superfast" => 12,
            "veryfast" => 11,
            "faster" => 10,
            "fast" => 9,
            "medium" => 8,
            "slow" => 7,
            _ => 6,
        };
        args.extend(["-preset".into(), preset.to_string()]);
        if let Some(crf) = crf {
            args.extend(["-crf".into(), crf]);
        }
        if let Some(bps) = bps {
            args.extend(["-b:v".into(), bps]);
        }
    } else if encoder == "libaom-av1" {
        // libaom es el más lento: cpu-used 0-8 con multithreading por filas.
        let cpu_used = match profile.video_preset.as_str() {
            "ultrafast" | "superfast" => 8,
            "veryfast" => 7,
            "faster" => 6,
            "fast" => 5,
            "medium" => 4,
            "slow" => 3,
            _ => 2,
        };
        args.extend([
            "-cpu-used".into(),
            cpu_used.to_string(),
            "-row-mt".into(),
            "1".into(),
        ]);
        match (crf, bps) {
            (Some(crf), _) => args.extend(["-crf".into(), crf, "-b:v".into(), "0".into()]),
            (None, Some(bps)) => args.extend(["-b:v".into(), bps]),
            (None, None) => args.extend(["-b:v".into(), "0".into(), "-crf".into(), "40".into()]),
        }
    } else {
        // h264_mf/libopenh264/av1_mf no aceptan CRF: sólo bitrate.
        if let Some(bps) = bps {
            args.extend(["-b:v".into(), bps]);
        } else {
            args.extend(["-b:v".into(), "8000000".into()]);
        }
    }
    args
}
