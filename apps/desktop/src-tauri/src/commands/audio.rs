//! Picos de audio y aceleración por hardware.
//!
//! Los picos alimentan la visualización de ondas en la timeline: FFmpeg
//! decodifica el audio a PCM mono y acá se reducen las muestras a pares
//! mínimo/máximo por bucket, con memoria acotada (no se guarda el PCM).
//!
//! La detección de encoders permite que la creación de proxies use la GPU
//! (NVENC/QSV/AMF) cuando existe, que es donde más se nota la velocidad.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPeaks {
    pub asset_id: String,
    pub duration_seconds: f64,
    pub buckets: u32,
    pub peaks: Vec<PeakPair>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct PeakPair {
    pub min: f32,
    pub max: f32,
}

/// Tope de buckets: la UI no necesita más y evita payloads enormes.
const MAX_BUCKETS: u32 = 4000;
const MIN_BUCKETS: u32 = 16;

fn clamp_buckets(requested: u32) -> u32 {
    requested.clamp(MIN_BUCKETS, MAX_BUCKETS)
}

/// Resuelve el asset y valida que tenga audio posible.
fn resolve_audio_asset(
    session: &crate::state::Session,
    asset_id: &str,
) -> Result<(String, PathBuf), ProjectError> {
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|item| item["id"].as_str() == Some(asset_id))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material no está en el proyecto",
            )
        })?;
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "confirmá los derechos del material antes de analizar su audio",
        ));
    }
    let kind = asset["kind"].as_str().unwrap_or("").to_owned();
    if kind != "video" && kind != "audio" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "sólo los videos y audios tienen onda de sonido",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }
    Ok((kind, path))
}

/// Duración y frecuencia de muestreo de la primera pista de audio.
fn probe_audio(ffprobe: &Path, source: &Path) -> Result<(f64, f64), ProjectError> {
    let mut command = Command::new(ffprobe);
    command
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("a:0")
        .arg("-show_entries")
        .arg("stream=sample_rate,duration")
        .arg("-of")
        .arg("json")
        .arg(source)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFprobe para leer el audio",
        )
    })?;
    let text = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let stream = &value["streams"][0];
    let rate = stream["sample_rate"]
        .as_str()
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|rate| *rate > 0.0)
        .unwrap_or(48_000.0);
    let duration = stream["duration"]
        .as_str()
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|seconds| *seconds > 0.0)
        .unwrap_or(0.0);
    Ok((duration, rate))
}

/// Decodifica el audio a PCM mono f32 y lo reduce a `buckets` pares min/max.
fn decode_peaks(
    ffmpeg: &Path,
    source: &Path,
    buckets: u32,
    duration_seconds: f64,
    sample_rate: f64,
) -> Result<Vec<PeakPair>, ProjectError> {
    // Muestras por bucket: si no hay duración conocida se usa un tamaño fijo.
    let per_bucket = if duration_seconds > 0.0 {
        ((duration_seconds * sample_rate) / f64::from(buckets)).max(1.0)
    } else {
        1024.0
    };

    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-nostats")
        .arg("-i")
        .arg(source)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-f")
        .arg("f32le")
        .arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let mut child = command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para leer la onda",
        )
    })?;
    let mut stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no expuso el audio decodificado",
        )
    })?;

    let mut peaks: Vec<PeakPair> = Vec::with_capacity(buckets as usize);
    let mut current = PeakPair { min: 0.0, max: 0.0 };
    let mut in_bucket = 0usize;
    let mut pending = [0u8; 4];
    let mut read_buffer = [0u8; 64 * 1024];
    let mut carry: Vec<u8> = Vec::with_capacity(4);

    loop {
        let read = stdout.read(&mut read_buffer).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "falló la lectura del audio")
        })?;
        if read == 0 {
            break;
        }
        // Reconstruir muestras f32 (little endian) incluso si vienen partidas.
        let mut chunk: Vec<u8> = std::mem::take(&mut carry);
        chunk.extend_from_slice(&read_buffer[..read]);
        let usable = chunk.len() / 4 * 4;
        carry.extend_from_slice(&chunk[usable..]);
        for start in (0..usable).step_by(4) {
            pending.copy_from_slice(&chunk[start..start + 4]);
            let sample = f32::from_le_bytes(pending);
            if !sample.is_finite() {
                continue;
            }
            if in_bucket == 0 {
                current = PeakPair {
                    min: sample,
                    max: sample,
                };
            } else {
                current.min = current.min.min(sample);
                current.max = current.max.max(sample);
            }
            in_bucket += 1;
            if in_bucket as f64 >= per_bucket {
                peaks.push(current);
                in_bucket = 0;
                if peaks.len() as u32 >= MAX_BUCKETS {
                    break;
                }
            }
        }
        if peaks.len() as u32 >= MAX_BUCKETS {
            break;
        }
    }
    if in_bucket > 0 {
        peaks.push(current);
    }
    let status = child.wait().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no terminó de decodificar")
    })?;
    if !status.success() && peaks.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no pudo decodificar el audio de este material",
        ));
    }
    Ok(peaks)
}

/// Picos mínimo/máximo por bucket para dibujar la onda de un video o audio.
#[tauri::command]
pub async fn audio_peaks(
    state: State<'_, AppState>,
    asset_id: String,
    buckets: Option<u32>,
) -> Result<AudioPeaks, ProjectError> {
    let buckets = clamp_buckets(buckets.unwrap_or(600));
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para leer la onda",
        ));
    };
    let (_kind, source) = resolve_audio_asset(&session, &asset_id)?;
    let (duration, rate) = probe_audio(&ffprobe, &source)?;
    let peaks = decode_peaks(&ffmpeg, &source, buckets, duration, rate)?;
    if peaks.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "este material no tiene audio que mostrar",
        ));
    }
    Ok(AudioPeaks {
        asset_id,
        duration_seconds: duration,
        buckets,
        peaks,
    })
}

// --------------------------------------------------------------------------- //
// Aceleración por hardware
// --------------------------------------------------------------------------- //

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareEncoders {
    pub h264: Option<String>,
    pub hevc: Option<String>,
    pub checked: bool,
}

/// Encoders de hardware en orden de preferencia por marca.
const HW_H264: &[&str] = &["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"];
const HW_HEVC: &[&str] = &["hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox"];

/// La detección inicializa encoders de verdad (hasta 2 s). El hardware no
/// cambia durante la sesión, así que se guarda por ruta de FFmpeg; si el
/// usuario elige otro binario, se vuelve a medir.
static ENCODER_CACHE: std::sync::Mutex<Option<(PathBuf, HardwareEncoders)>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
fn first_available(encoders: &str, wanted: &[&str]) -> Option<String> {
    wanted
        .iter()
        .find(|name| encoders.lines().any(|line| line.contains(**name)))
        .map(|name| (*name).to_owned())
}

/// Elige el primer encoder compilado que además pueda inicializar hardware.
/// Estar en `ffmpeg -encoders` no garantiza que la GPU/driver exista.
fn first_working_with<F>(encoders: &str, wanted: &[&str], mut probe: F) -> Option<String>
where
    F: FnMut(&str) -> bool,
{
    for name in wanted {
        if encoders.lines().any(|line| line.contains(*name)) && probe(name) {
            return Some((*name).to_owned());
        }
    }
    None
}

fn encoder_works(ffmpeg: &Path, encoder: &str) -> bool {
    let mut command = Command::new(ffmpeg);
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x144:r=30:d=0.1",
        "-an",
        "-c:v",
        encoder,
        "-pix_fmt",
        "yuv420p",
        "-f",
        "null",
        "-",
    ]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn first_working(ffmpeg: &Path, encoders: &str, wanted: &[&str]) -> Option<String> {
    first_working_with(encoders, wanted, |name| encoder_works(ffmpeg, name))
}

/// Detección real, sin Tauri. La comparten la vista de exportación y el
/// pipeline de descargas.
pub(crate) fn detect_hardware(ffmpeg: &Path) -> HardwareEncoders {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-encoders")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return HardwareEncoders {
            h264: None,
            hevc: None,
            checked: false,
        };
    };
    let text = String::from_utf8_lossy(&output.stdout);
    HardwareEncoders {
        h264: first_working(ffmpeg, &text, HW_H264),
        hevc: first_working(ffmpeg, &text, HW_HEVC),
        checked: true,
    }
}

/// ¿La máquina tiene encoder de video por hardware? La primera consulta mide
/// de verdad y el resultado se cachea por binario de FFmpeg.
#[tauri::command]
pub async fn hardware_encoders(
    state: State<'_, AppState>,
) -> Result<HardwareEncoders, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Ok(HardwareEncoders {
            h264: None,
            hevc: None,
            checked: false,
        });
    };
    if let Ok(cache) = ENCODER_CACHE.lock() {
        if let Some((cached_path, cached)) = cache.as_ref() {
            if cached_path == &ffmpeg {
                return Ok(cached.clone());
            }
        }
    }
    let detected = detect_hardware(&ffmpeg);
    if let Ok(mut cache) = ENCODER_CACHE.lock() {
        *cache = Some((ffmpeg, detected.clone()));
    }
    Ok(detected)
}

/// Encoder de video a usar para proxies: GPU si existe, libx264 si no.
pub(crate) fn proxy_video_args(hardware: Option<&str>) -> Vec<String> {
    let Some(encoder) = hardware else {
        return vec![
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "26".into(),
        ];
    };
    let mut args = vec!["-c:v".into(), encoder.to_owned()];
    if encoder.ends_with("_nvenc") {
        args.extend(["-preset".into(), "p1".into(), "-cq".into(), "30".into()]);
    } else if encoder.ends_with("_amf") {
        // AMF no comparte el preset textual de NVENC.
        args.extend([
            "-quality".into(),
            "speed".into(),
            "-rc".into(),
            "cqp".into(),
            "-qp_i".into(),
            "30".into(),
            "-qp_p".into(),
            "30".into(),
        ]);
    } else if encoder.ends_with("_qsv") {
        args.extend([
            "-preset".into(),
            "veryfast".into(),
            "-global_quality".into(),
            "30".into(),
        ]);
    }
    args
}

/// Encoder H.264 por hardware disponible, consultando FFmpeg directo.
/// Devuelve `None` si sólo hay software (o si FFmpeg no responde).
pub(crate) fn hardware_h264(ffmpeg: &Path) -> Option<String> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-encoders")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    first_working(ffmpeg, &text, HW_H264)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_quedan_en_rango() {
        assert_eq!(clamp_buckets(0), MIN_BUCKETS);
        assert_eq!(clamp_buckets(1), MIN_BUCKETS);
        assert_eq!(clamp_buckets(600), 600);
        assert_eq!(clamp_buckets(999_999), MAX_BUCKETS);
    }

    #[test]
    fn detecta_encoders_de_hardware_en_la_lista() {
        let list = " V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA\n V....D hevc_qsv             Intel";
        assert_eq!(
            first_available(list, HW_H264).as_deref(),
            Some("h264_nvenc")
        );
        assert_eq!(first_available(list, HW_HEVC).as_deref(), Some("hevc_qsv"));
        let software_only = " V....D libx264              libx264 H.264";
        assert_eq!(first_available(software_only, HW_H264), None);
    }

    #[test]
    fn el_detector_solo_ofrece_encoders_que_funcionan() {
        let list = "h264_nvenc
h264_qsv
h264_amf";
        let mut probed: Vec<String> = Vec::new();
        let chosen = first_working_with(list, HW_H264, |name| {
            probed.push(name.to_owned());
            name == "h264_amf"
        });
        assert_eq!(chosen.as_deref(), Some("h264_amf"));
        assert_eq!(probed, vec!["h264_nvenc", "h264_qsv", "h264_amf"]);

        let none = first_working_with(list, HW_H264, |_| false);
        assert_eq!(none, None);
    }

    #[test]
    fn el_proxy_usa_gpu_cuando_existe() {
        let gpu = proxy_video_args(Some("h264_nvenc"));
        assert_eq!(gpu[1], "h264_nvenc");
        let cpu = proxy_video_args(None);
        assert_eq!(cpu[1], "libx264");
    }

    #[test]
    fn el_proxy_usa_los_flags_de_cada_fabricante() {
        let amf = proxy_video_args(Some("h264_amf")).join(" ");
        assert!(amf.contains("-quality speed") && amf.contains("-rc cqp"));
        assert!(!amf.contains("-preset p1") && !amf.contains("-cq 30"));
        let qsv = proxy_video_args(Some("hevc_qsv")).join(" ");
        assert!(qsv.contains("-global_quality 30") && qsv.contains("-preset veryfast"));
        assert!(!qsv.contains("-cq"));
    }

    #[test]
    fn los_picos_quedan_entre_menos_uno_y_uno() {
        // Muestras de prueba: silencio, pico positivo y negativo.
        let samples = [0.0f32, 0.5, -0.75, 1.0, -1.0, 0.25];
        let mut peaks: Vec<PeakPair> = Vec::new();
        let per_bucket = 2.0;
        let mut current = PeakPair { min: 0.0, max: 0.0 };
        let mut in_bucket = 0usize;
        for sample in samples {
            if in_bucket == 0 {
                current = PeakPair {
                    min: sample,
                    max: sample,
                };
            } else {
                current.min = current.min.min(sample);
                current.max = current.max.max(sample);
            }
            in_bucket += 1;
            if in_bucket as f64 >= per_bucket {
                peaks.push(current);
                in_bucket = 0;
            }
        }
        if in_bucket > 0 {
            peaks.push(current);
        }
        assert_eq!(peaks.len(), 3);
        assert!((peaks[0].max - 0.5).abs() < f32::EPSILON);
        assert!((peaks[1].min + 0.75).abs() < f32::EPSILON);
        assert!((peaks[1].max - 1.0).abs() < f32::EPSILON);
        for peak in &peaks {
            assert!(peak.min >= -1.0 && peak.max <= 1.0);
        }
    }
}
