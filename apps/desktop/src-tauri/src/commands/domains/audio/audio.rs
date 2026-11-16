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
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::time::{Duration, Instant};

use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::state::AppState;

// El sondeo de encoders por hardware vive en `render::ffmpeg::probe` (lo
// comparten exportación, descargas y proxies). Estos `pub use` mantienen las
// rutas `commands::audio::*` que ya consumen otros módulos.
pub(crate) use crate::media::proxy::proxy_video_args;
pub use crate::render::ffmpeg::{detect_hardware, hardware_h264, HardwareEncoders};

// DTOs, clamp de buckets, parser de ffprobe y reductor min/max: `media::peaks`.
pub use crate::media::peaks::{
    clamp_buckets, parse_audio_probe, AudioPeaks, PeakPair, PeakReducer, MAX_BUCKETS,
    MIN_BUCKETS,
};

/// Resuelve el asset y valida que tenga audio posible.
pub(crate) fn resolve_audio_asset(
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
    // La onda es una lectura, no una operación de entrega: un material
    // "sin verificar" (narraciones generadas, audios recién importados) ya
    // tiene archivo en disco y se puede dibujar. Antes sólo se aceptaba
    // "ready", así que esos clips quedaban como bloques planos sin onda.
    if !matches!(asset["status"].as_str(), Some("ready") | Some("unverified")) {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el archivo del material no está disponible para leer su onda",
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

/// ffprobe lee sólo cabeceras; 60 s es margen de sobra incluso en archivos
/// grandes o discos lentos. Sin deadline un ffprobe colgado congelaba el
/// comando IPC para siempre.
const AUDIO_PROBE_TIMEOUT: Duration = Duration::from_secs(60);

/// Duración y frecuencia de muestreo de la primera pista de audio.
/// `pub(crate)`: la transcripción nativa la usa para decidir si el archivo
/// entra en el presupuesto de memoria/tiempo del motor in-process.
pub(crate) fn probe_audio(ffprobe: &Path, source: &Path) -> Result<(f64, f64), ProjectError> {
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
    let timed = crate::commands::output_with_timeout(&mut command, AUDIO_PROBE_TIMEOUT)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo iniciar FFprobe para leer el audio",
            )
        })?;
    if timed.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe tardó demasiado leyendo el audio",
        ));
    }
    let output = timed.into_output().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no devolvió la lectura del audio",
        )
    })?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(parse_audio_probe(&text))
}

/// El decode PCM mono corre ~30-100× realtime; 10× la duración del archivo
/// (acotado entre 2 min y 2 h) da margen amplio sin esperas eternas si
/// FFmpeg se cuelga a mitad del stream.
fn peaks_decode_timeout(duration_seconds: f64) -> Duration {
    const FACTOR: f64 = 10.0;
    const FLOOR_SECS: f64 = 120.0;
    const CEILING_SECS: f64 = 2.0 * 3600.0;
    Duration::from_secs_f64(
        (duration_seconds.max(0.0) * FACTOR).clamp(FLOOR_SECS, CEILING_SECS),
    )
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

    // stdout se drena en un thread hacia un canal acotado: el consumo PCM
    // queda en este hilo (lleva el PeakReducer) y el deadline se chequea
    // entre chunks, así una lectura bloqueada no puede congelar el comando.
    let (tx, rx) = sync_channel::<Vec<u8>>(16);
    let reader = std::thread::spawn(move || {
        let mut buffer = [0u8; 64 * 1024];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if tx.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let deadline = Instant::now() + peaks_decode_timeout(duration_seconds);
    let mut reducer = PeakReducer::new(per_bucket, MAX_BUCKETS);
    let mut pending = [0u8; 4];
    let mut carry: Vec<u8> = Vec::with_capacity(4);
    let mut reducer_full = false;
    let mut timed_out = false;

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                // Reconstruir muestras f32 (little endian) incluso si vienen partidas.
                let mut data: Vec<u8> = std::mem::take(&mut carry);
                data.extend_from_slice(&chunk);
                let usable = data.len() / 4 * 4;
                carry.extend_from_slice(&data[usable..]);
                for start in (0..usable).step_by(4) {
                    pending.copy_from_slice(&data[start..start + 4]);
                    let sample = f32::from_le_bytes(pending);
                    if !reducer.push(sample) {
                        reducer_full = true;
                        break;
                    }
                }
                if reducer_full {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    // Si cortamos antes de que FFmpeg termine (reducer lleno o deadline) hay
    // que matarlo: si no, queda bloqueado escribiendo al pipe sin lector y
    // `wait()` nunca vuelve.
    if reducer_full || timed_out {
        let _ = child.kill();
    }
    let _ = reader.join();
    let status = child.wait().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no terminó de decodificar")
    })?;
    let peaks = reducer.finish();
    if timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la decodificación del audio tardó demasiado; probá con un archivo más corto",
        ));
    }
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

/// Picos de un archivo arbitrario, sin proyecto abierto.
///
/// La cola de carpeta trabaja sobre material que todavía no está en ningún
/// proyecto y necesita los picos para medir el perfil adaptativo antes de armar
/// la timeline. Es la misma decodificación que `audio_peaks`, sólo cambia de
/// dónde sale la ruta.
#[tauri::command]
pub async fn audio_peaks_path(
    state: State<'_, AppState>,
    path: String,
    buckets: Option<u32>,
) -> Result<AudioPeaks, ProjectError> {
    let buckets = clamp_buckets(buckets.unwrap_or(600));
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para leer la onda",
        ));
    };
    // La cola de carpeta trabaja con archivos del usuario fuera del
    // proyecto: política de lectura de `fs_*` (absoluta, sin credenciales).
    let source = crate::application::fs::resolve_user_file_path(&path)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el archivo no existe",
        ));
    }
    let (duration, rate) = probe_audio(&ffprobe, &source)?;
    let peaks = decode_peaks(&ffmpeg, &source, buckets, duration, rate)?;
    if peaks.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "este material no tiene audio que mostrar",
        ));
    }
    Ok(AudioPeaks {
        asset_id: source.to_string_lossy().to_string(),
        duration_seconds: duration,
        buckets,
        peaks,
    })
}

// --------------------------------------------------------------------------- //
// Aceleración por hardware
// --------------------------------------------------------------------------- //
//
// El sondeo (`detect_hardware`, `hardware_h264`, `HardwareEncoders`, listas
// `HW_*` y la prueba funcional `encoder_works`) vive en
// `render::ffmpeg::probe`; acá quedan el comando IPC y los argumentos de
// proxy que consume el pipeline de medios.

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
            av1: None,
            vp9: None,
            h264_software: None,
            hevc_software: None,
            checked: false,
        });
    };
    Ok(crate::render::ffmpeg::detect_hardware_cached(&ffmpeg))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn el_proxy_cubre_el_fallback_de_software_del_bundle() {
        // El FFmpeg LGPL no trae libx264: la detección ofrece libopenh264
        // (o h264_mf) y el proxy va por bitrate, no por preset/CRF.
        let openh264 = proxy_video_args(Some("libopenh264")).join(" ");
        assert!(openh264.contains("-c:v libopenh264"));
        assert!(openh264.contains("-b:v 4M"));
        assert!(!openh264.contains("-crf") && !openh264.contains("-preset"));
        // Si el FFmpeg del usuario sí trae x264, conserva preset/CRF.
        let x264 = proxy_video_args(Some("libx264")).join(" ");
        assert!(x264.contains("-preset veryfast") && x264.contains("-crf 26"));
    }
}
