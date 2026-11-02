//! Definición: nitidez perceptual en cinco etapas sobre FFmpeg.
//!
//! El orden de la cadena no es arbitrario; cada etapa prepara la siguiente:
//!
//! 1. **Limpieza** (`deblock` + `atadenoise`). Se saca el artefacto de
//!    compresión antes de tocar el contraste de borde: si se enfoca primero, el
//!    `unsharp` amplifica los cuadritos y el ruido.
//! 2. **Escalado** (`scale` con Lanczos3 en un espacio de trabajo de 16 bits).
//!    Se escala antes de enfocar para que el radio de la máscara caiga sobre la
//!    resolución final y no sobre la de origen.
//! 3. **Máscara de enfoque** (`unsharp`). Sube el contraste justo en el borde.
//! 4. **Curva S** (`curves`). Micro-contraste: negros más profundos y altas
//!    luces levantadas, sin recortar.
//! 5. **Grano** (`noise`). Última, para que el enfoque no lo amplifique.
//!
//! Filtros allowlisted y presentes tanto en el FFmpeg LGPL que se empaqueta
//! como en un FFmpeg completo del sistema: `deblock`, `atadenoise`, `scale`,
//! `format`, `unsharp`, `curves`, `noise`. Deliberadamente **no** se usa
//! `hqdn3d` ni `zscale`: el build LGPL empaquetado no los trae.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

/// Encoders H.264 en orden de preferencia. `libx264` es el mejor, pero el
/// FFmpeg LGPL que viaja con el instalador no puede incluirlo (es GPL): en una
/// instalación limpia el encoder real es `libopenh264` o el de la GPU.
const H264_CANDIDATES: &[&str] = &[
    "libx264",
    "h264_nvenc",
    "h264_amf",
    "h264_qsv",
    "libopenh264",
];

/// El binario de FFmpeg no cambia durante la sesión: se mide una vez.
static ENCODER_CACHE: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClarityMode {
    Video,
    Image,
}

impl ClarityMode {
    fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("video")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "video" => Ok(Self::Video),
            "image" | "imagen" => Ok(Self::Image),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "modo de definición inválido: usá video o image",
            )),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Video => "mp4",
            Self::Image => "png",
        }
    }
}

/// Parámetros ya resueltos de la cadena. Los presets los resuelve el frontend
/// para que los controles muestren el valor real que se va a aplicar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ClarityConfig {
    /// Fuerza de limpieza, 0–100. 0 apaga el suavizado temporal.
    pub denoise: u8,
    /// De-blocking de compresión (independiente de `denoise`).
    pub deblock: bool,
    /// Altura destino. 0 deja la resolución original.
    pub target_height: u32,
    /// Escalar en un espacio de trabajo de 16 bits por canal.
    pub high_precision: bool,
    /// Cantidad de la máscara de enfoque, 0–3.
    pub unsharp_amount: f32,
    /// Tamaño de la matriz de la máscara: 3, 5, 7 o 9.
    pub unsharp_size: u32,
    /// Fuerza de la curva S, 0–100.
    pub curve: u8,
    /// Intensidad del grano, 0–3 (%).
    pub grain: f32,
    /// El suavizado temporal necesita varios cuadros: en una imagen no aplica.
    pub temporal: bool,
}

impl Default for ClarityConfig {
    fn default() -> Self {
        Self {
            denoise: 0,
            deblock: false,
            target_height: 0,
            high_precision: true,
            unsharp_amount: 0.0,
            unsharp_size: 5,
            curve: 0,
            grain: 0.0,
            temporal: true,
        }
    }
}

/// Cadena de filtros, en el orden en que debe ejecutarse. Es pura para poder
/// probarla sin FFmpeg.
pub(crate) fn clarity_filters(config: &ClarityConfig, source_height: u32) -> Vec<String> {
    let mut filters: Vec<String> = Vec::new();

    // 1. Limpieza: primero el artefacto, después el detalle.
    if config.deblock {
        let strength = if config.denoise >= 60 {
            "strong"
        } else {
            "weak"
        };
        filters.push(format!("deblock=filter={strength}:block=8"));
    }
    if config.denoise > 0 && config.temporal {
        let base = f32::from(config.denoise.clamp(1, 100)) / 100.0;
        // atadenoise compara el cuadro con su vecindad temporal: umbrales bajos
        // conservan el detalle, altos borronean el movimiento.
        let luma_a = 0.005 + base * 0.045;
        let luma_b = 0.010 + base * 0.090;
        let chroma_a = 0.005 + base * 0.040;
        let chroma_b = 0.010 + base * 0.080;
        filters.push(format!(
            "atadenoise=0a={luma_a:.4}:0b={luma_b:.4}:1a={chroma_a:.4}:1b={chroma_b:.4}"
        ));
    }

    // 2. Escalado Lanczos3. El ancho se deriva del alto para no deformar.
    let needs_scale =
        config.target_height > 0 && (source_height == 0 || config.target_height != source_height);
    if needs_scale {
        if config.high_precision {
            // 16 bits por canal durante el remuestreo: menos cuantización en
            // los bordes que se están inventando.
            filters.push("format=gbrp16le".to_owned());
        }
        filters.push(format!(
            "scale=-2:{}:flags=lanczos+accurate_rnd+full_chroma_int",
            config.target_height
        ));
        filters.push("format=yuv420p".to_owned());
    }

    // 3. Máscara de enfoque sobre la resolución final. Solo luma: enfocar la
    // croma agrega flecos de color en los bordes duros.
    if config.unsharp_amount > 0.001 {
        let size = normalize_unsharp_size(config.unsharp_size);
        let amount = config.unsharp_amount.clamp(0.0, 3.0);
        filters.push(format!(
            "unsharp=luma_msize_x={size}:luma_msize_y={size}:luma_amount={amount:.2}"
        ));
    }

    // 4. Curva S de micro-contraste. Los extremos quedan fijos (0/0 y 1/1)
    // para no recortar información; se mueven los cuartos.
    if config.curve > 0 {
        let strength = f32::from(config.curve.clamp(1, 100)) / 100.0;
        let shadow = 0.25 - 0.12 * strength;
        let highlight = 0.75 + 0.12 * strength;
        filters.push(format!(
            "curves=master='0/0 0.2500/{shadow:.4} 0.7500/{highlight:.4} 1/1'"
        ));
    }

    // 5. Grano de película, al final: así el enfoque no lo amplifica.
    if config.grain > 0.05 {
        let amount = (config.grain.clamp(0.0, 3.0) * 2.2).round().clamp(1.0, 8.0);
        filters.push(format!("noise=alls={amount:.0}:allf=t+u"));
    }

    filters
}

fn normalize_unsharp_size(size: u32) -> u32 {
    match size {
        3 | 7 | 9 => size,
        _ => 5,
    }
}

fn unique_output(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let safe_stem: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let stem = safe_stem.trim().trim_matches('-');
    let stem = if stem.is_empty() { "archivo" } else { stem };
    let mut candidate = dir.join(format!("{stem}-definicion.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-definicion-{index}.{extension}"));
        index += 1;
    }
    candidate
}

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
            && crate::commands::audio::encoder_works(ffmpeg, name)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SharpenRequest {
    pub input_path: String,
    pub output_dir: Option<String>,
    pub mode: Option<String>,
    pub denoise: Option<u8>,
    pub deblock: Option<bool>,
    pub target_height: Option<u32>,
    pub high_precision: Option<bool>,
    pub unsharp_amount: Option<f32>,
    pub unsharp_size: Option<u32>,
    pub curve: Option<u8>,
    pub grain: Option<f32>,
    /// Etiqueta del preajuste aplicado, solo para el informe del resultado.
    pub preset: Option<String>,
}

impl Default for SharpenRequest {
    fn default() -> Self {
        Self {
            input_path: String::new(),
            output_dir: None,
            mode: None,
            denoise: None,
            deblock: None,
            target_height: None,
            high_precision: None,
            unsharp_amount: None,
            unsharp_size: None,
            curve: None,
            grain: None,
            preset: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharpenResult {
    pub path: String,
    pub bytes: u64,
    pub source_bytes: u64,
    /// La cadena realmente aplicada, tal como la ve FFmpeg.
    pub filter: String,
    pub encoder: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub preset: Option<String>,
}

/// Aplica la cadena de definición a una imagen o un video del disco.
///
/// Se escribe primero en un temporal oculto; si FFmpeg falla, el temporal se
/// borra y el original nunca se toca.
#[tauri::command]
pub async fn sharpen_media(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SharpenRequest,
) -> Result<SharpenResult, ProjectError> {
    let input_path = PathBuf::from(request.input_path.trim());
    if input_path.as_os_str().is_empty() || !input_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo para definir nitidez no está en disco",
        ));
    }
    let mode = ClarityMode::parse(request.mode.as_deref())?;
    let config = ClarityConfig {
        denoise: request.denoise.unwrap_or(0).min(100),
        deblock: request.deblock.unwrap_or(false),
        target_height: request.target_height.unwrap_or(0).min(8192),
        high_precision: request.high_precision.unwrap_or(true),
        unsharp_amount: request.unsharp_amount.unwrap_or(0.0).clamp(0.0, 3.0),
        unsharp_size: request.unsharp_size.unwrap_or(5),
        curve: request.curve.unwrap_or(0).min(100),
        grain: request.grain.unwrap_or(0.0).clamp(0.0, 3.0),
        temporal: mode == ClarityMode::Video,
    };

    let source_bytes = std::fs::metadata(&input_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let output_dir = match request.output_dir.as_deref() {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
    };
    if !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de la definición no existe",
        ));
    }

    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para aplicar definición",
        ));
    };

    let source = probe_media(ffprobe.as_deref(), &input_path);
    let filters = clarity_filters(&config, source.height.unwrap_or(0));
    if filters.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay ninguna etapa activa: activá al menos una mejora de definición",
        ));
    }
    let filter = filters.join(",");

    let encoder = resolve_encoder(&ffmpeg)?;
    let output_width = match (source.width, source.height) {
        (Some(width), Some(height)) if height > 0 && config.target_height > 0 => {
            // El mismo redondeo que hace `scale=-2:alto`.
            let scaled = f64::from(width) * f64::from(config.target_height) / f64::from(height);
            let even = ((scaled.round() as u32) / 2) * 2;
            even.max(2)
        }
        (Some(width), _) => width,
        _ => 0,
    };
    let output_height = if config.target_height > 0 {
        config.target_height
    } else {
        source.height.unwrap_or(0)
    };

    let stem = input_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let final_path = unique_output(&output_dir, &stem, mode.extension());
    let temp_path = output_dir.join(format!(
        ".definicion-{}.{}",
        Uuid::new_v4(),
        mode.extension()
    ));

    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&input_path)
        .arg("-vf")
        .arg(&filter);
    match mode {
        ClarityMode::Video => {
            command.args(["-map", "0:v:0", "-map", "0:a?"]);
            command.args(video_codec_args(
                &encoder,
                16,
                output_width,
                output_height,
                source.fps,
            ));
            command.args([
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
            ]);
        }
        ClarityMode::Image => {
            command.args(["-frames:v", "1", "-update", "1"]);
        }
    }
    command.args(["-progress", "pipe:1", "-nostats"]);
    command.arg(&temp_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para la definición: {error}").as_str(),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso el progreso")
    })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso el log"))?;

    let stderr_handle = thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr)
            .take(64 * 1024)
            .read_to_string(&mut text);
        text
    });

    let total_seconds = source.duration.unwrap_or(0.0);
    let emitter = app.clone();
    let progress_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(microseconds) = value.trim().parse::<f64>() {
                    if total_seconds > 0.0 {
                        let percent = (microseconds / (total_seconds * 1_000_000.0) * 100.0)
                            .clamp(0.0, 100.0);
                        let _ = emitter.emit(
                            "sharpen-progress",
                            serde_json::json!({ "percent": percent }),
                        );
                    }
                }
            }
        }
    });

    let status = child.wait().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("FFmpeg de definición no terminó: {error}").as_str(),
        )
    })?;
    let _ = progress_handle.join();
    let stderr_text = stderr_handle.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&temp_path);
        let sanitized = sanitize_log(&stderr_text, &output_dir, 24);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!("la definición falló: {sanitized}").as_str(),
        ));
    }
    if std::fs::metadata(&temp_path)
        .map(|meta| meta.len())
        .unwrap_or(0)
        == 0
    {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no produjo un archivo de definición válido",
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el archivo de definición: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let rendered = probe_media(ffprobe.as_deref(), &final_path);
    let _ = app.emit("sharpen-progress", serde_json::json!({ "percent": 100.0 }));
    Ok(SharpenResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        source_bytes,
        filter,
        encoder,
        width: rendered.width.or(Some(output_width)),
        height: rendered.height.or(Some(output_height)),
        source_width: source.width,
        source_height: source.height,
        duration_seconds: rendered.duration.or(source.duration),
        preset: request.preset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ClarityConfig {
        ClarityConfig {
            temporal: true,
            ..ClarityConfig::default()
        }
    }

    #[test]
    fn empty_config_produces_no_filters() {
        assert!(clarity_filters(&config(), 1080).is_empty());
    }

    #[test]
    fn cleaning_runs_before_sharpening_and_grain_runs_last() {
        let chain = clarity_filters(
            &ClarityConfig {
                denoise: 50,
                deblock: true,
                unsharp_amount: 1.2,
                curve: 40,
                grain: 1.5,
                ..config()
            },
            1080,
        );
        // Cada etapa es un segmento propio: se compara por prefijo y no por
        // `find`, porque «atadenoise» contiene «noise».
        let position = |prefix: &str| {
            chain
                .iter()
                .position(|filter| filter.starts_with(prefix))
                .unwrap_or_else(|| panic!("falta la etapa {prefix} en {chain:?}"))
        };
        let deblock = position("deblock=");
        let denoise = position("atadenoise=");
        let unsharp = position("unsharp=");
        let curves = position("curves=");
        let grain = position("noise=");
        assert!(deblock < denoise);
        assert!(denoise < unsharp);
        assert!(unsharp < curves);
        assert!(curves < grain);
        assert_eq!(
            chain.last().map(String::as_str),
            Some("noise=alls=3:allf=t+u")
        );
    }

    #[test]
    fn unsharp_matches_the_reference_ffmpeg_syntax() {
        let chain = clarity_filters(
            &ClarityConfig {
                unsharp_amount: 1.5,
                unsharp_size: 5,
                ..config()
            },
            1080,
        );
        assert_eq!(
            chain,
            vec!["unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.50".to_owned()]
        );
    }

    #[test]
    fn scaling_uses_lanczos_and_sixteen_bit_workspace() {
        let chain = clarity_filters(
            &ClarityConfig {
                target_height: 2160,
                high_precision: true,
                ..config()
            },
            1080,
        )
        .join(",");
        assert!(chain.contains("format=gbrp16le"));
        assert!(chain.contains("scale=-2:2160:flags=lanczos"));
        assert!(chain.contains("format=yuv420p"));
        // El formato de trabajo se abre antes de escalar y se cierra después.
        assert!(chain.find("gbrp16le").unwrap() < chain.find("scale=").unwrap());
        assert!(chain.find("scale=").unwrap() < chain.find("format=yuv420p").unwrap());
    }

    #[test]
    fn scaling_is_skipped_when_the_target_matches_the_source() {
        let chain = clarity_filters(
            &ClarityConfig {
                target_height: 1080,
                ..config()
            },
            1080,
        );
        assert!(chain.is_empty());
    }

    #[test]
    fn curve_strength_moves_the_quarter_points_without_clipping() {
        let soft = clarity_filters(
            &ClarityConfig {
                curve: 20,
                ..config()
            },
            1080,
        )
        .join(",");
        let hard = clarity_filters(
            &ClarityConfig {
                curve: 100,
                ..config()
            },
            1080,
        )
        .join(",");
        assert!(soft.contains("curves=master='0/0"));
        assert!(soft.contains("1/1'"));
        assert_ne!(soft, hard);
        // A más fuerza, más separación entre cuartos.
        let soft_shadow = soft
            .split("0.2500/")
            .nth(1)
            .and_then(|rest| rest.split(' ').next())
            .and_then(|value| value.parse::<f32>().ok())
            .expect("punto de sombra");
        let hard_shadow = hard
            .split("0.2500/")
            .nth(1)
            .and_then(|rest| rest.split(' ').next())
            .and_then(|value| value.parse::<f32>().ok())
            .expect("punto de sombra");
        assert!(hard_shadow < soft_shadow);
    }

    #[test]
    fn grain_stays_subtle_and_scales_with_intensity() {
        let light = clarity_filters(
            &ClarityConfig {
                grain: 1.0,
                ..config()
            },
            1080,
        )
        .join(",");
        let strong = clarity_filters(
            &ClarityConfig {
                grain: 3.0,
                ..config()
            },
            1080,
        )
        .join(",");
        assert_eq!(light, "noise=alls=2:allf=t+u");
        assert_eq!(strong, "noise=alls=7:allf=t+u");
    }

    #[test]
    fn deblock_strength_follows_the_cleaning_amount() {
        let gentle = clarity_filters(
            &ClarityConfig {
                deblock: true,
                denoise: 20,
                ..config()
            },
            1080,
        )
        .join(",");
        let harsh = clarity_filters(
            &ClarityConfig {
                deblock: true,
                denoise: 80,
                ..config()
            },
            1080,
        )
        .join(",");
        assert!(gentle.starts_with("deblock=filter=weak"));
        assert!(harsh.starts_with("deblock=filter=strong"));
    }

    #[test]
    fn images_skip_the_temporal_denoiser() {
        let chain = clarity_filters(
            &ClarityConfig {
                denoise: 60,
                temporal: false,
                ..config()
            },
            1080,
        );
        assert!(!chain.join(",").contains("atadenoise"));
    }

    #[test]
    fn unsharp_size_is_normalized_to_an_odd_kernel() {
        assert_eq!(normalize_unsharp_size(4), 5);
        assert_eq!(normalize_unsharp_size(9), 9);
        assert_eq!(normalize_unsharp_size(3), 3);
    }

    #[test]
    fn invalid_mode_is_rejected() {
        assert!(ClarityMode::parse(Some("gif")).is_err());
        assert!(ClarityMode::parse(Some("video")).is_ok());
        assert!(ClarityMode::parse(Some("imagen")).is_ok());
    }

    #[test]
    fn output_names_are_safe_and_unique() {
        let dir = std::env::temp_dir().join(format!("editoria-sharpen-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta temporal");
        let first = unique_output(&dir, "clip: raro/../uno", "mp4");
        assert!(first.to_string_lossy().ends_with("-definicion.mp4"));
        std::fs::write(&first, b"x").expect("archivo de prueba");
        let second = unique_output(&dir, "clip: raro/../uno", "mp4");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().contains("-definicion-2.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn openh264_gets_a_bitrate_instead_of_a_crf() {
        let args = video_codec_args("libopenh264", 16, 1920, 1080, 30.0).join(" ");
        assert!(args.contains("-b:v"));
        assert!(!args.contains("-crf"));
        let x264 = video_codec_args("libx264", 16, 1920, 1080, 30.0).join(" ");
        assert!(x264.contains("-crf 16"));
    }

    /// Prueba real contra el FFmpeg empaquetado: la cadena que arma este módulo
    /// tiene que parsear, elegir un encoder que exista y producir el alto
    /// pedido. Detrás de `EDITOR_IA_RUN_RENDER_TESTS` como las demás pruebas que
    /// necesitan binarios.
    #[test]
    fn live_chain_renders_the_requested_height() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el render real");
            return;
        }
        let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg")
            .join(if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            });
        assert!(ffmpeg.is_file(), "falta el FFmpeg de recursos");

        let config = ClarityConfig {
            denoise: 45,
            deblock: true,
            target_height: 2160,
            high_precision: true,
            unsharp_amount: 1.5,
            unsharp_size: 5,
            curve: 40,
            grain: 1.5,
            temporal: true,
        };
        let filter = clarity_filters(&config, 1080).join(",");
        let encoder = resolve_encoder(&ffmpeg).expect("encoder H.264 disponible");
        let output =
            std::env::temp_dir().join(format!("editoria-definicion-{}.mp4", Uuid::new_v4()));

        let mut command = Command::new(&ffmpeg);
        command.args([
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=1920x1080:r=25:d=0.4",
            "-vf",
            &filter,
        ]);
        command.args(video_codec_args(&encoder, 16, 3840, 2160, 25.0));
        command.args(["-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]);
        command.arg(&output);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let result = command.output().expect("FFmpeg arrancó");
        let log = String::from_utf8_lossy(&result.stderr).into_owned();
        assert!(
            result.status.success(),
            "el render falló con encoder {encoder}: {log}"
        );

        let info = probe_media(
            Some(&ffmpeg.with_file_name(if cfg!(windows) {
                "ffprobe.exe"
            } else {
                "ffprobe"
            })),
            &output,
        );
        assert_eq!(info.width, Some(3840), "ancho inesperado");
        assert_eq!(info.height, Some(2160), "alto inesperado");
        assert!(
            std::fs::metadata(&output)
                .map(|meta| meta.len())
                .unwrap_or(0)
                > 10_000,
            "el archivo salió vacío"
        );
        let _ = std::fs::remove_file(&output);
    }
}
