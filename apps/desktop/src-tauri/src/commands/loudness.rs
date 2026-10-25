//! Monitor de loudness de la mezcla (ITU-R BS.1770-4 / EBU R128).
//!
//! Mide exactamente la mezcla que exporta el render: el mismo grafo de audio
//! (DSP por clip, EQ/paneo por pista, ducking y ganancia master) se decodifica
//! a PCM f32le y alimenta el `LoudnessMeter` de `filmcraft-audio-dsp`, que
//! implementa el filtro K, las ventanas momentary (400 ms) y short-term (3 s),
//! el integrated con doble compuerta y el rango LRA según especificación.
//!
//! La medición es **previa** a loudnorm y al limitador de entrega: mide la
//! mezcla real y devuelve además el delta contra el objetivo configurado, así
//! la persona decide si subir el master o confiar en la normalización.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use filmcraft_audio_dsp::LoudnessMeter;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::system::resolve_tools;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{expand_compounds, parse_profile, BuildPlanInput};
use crate::state::AppState;

/// Piso de la escala EBU: por debajo de −70 LUFS no hay señal útil y los −inf
/// del medidor no son serializables como número JSON.
const LUFS_FLOOR: f64 = -70.0;
const DB_FLOOR: f64 = -120.0;
/// Historial máximo devuelto a la UI (10 muestras/s ⇒ 2 minutos al detalle;
/// más largo se diezma manteniendo siempre la última muestra).
const MAX_HISTORY: usize = 1200;
/// Frecuencia de eventos de progreso: uno cada 500 ms de audio medido.
const EMIT_EVERY: usize = 5;

fn floor_lufs(value: f64) -> f64 {
    if value.is_finite() {
        value.max(LUFS_FLOOR)
    } else {
        LUFS_FLOOR
    }
}

fn floor_db(value: f64) -> f64 {
    if value.is_finite() {
        value.max(DB_FLOOR)
    } else {
        DB_FLOOR
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessSample {
    pub seconds: f64,
    pub momentary_lufs: f64,
    pub short_term_lufs: f64,
}

impl PartialEq for LoudnessSample {
    fn eq(&self, other: &Self) -> bool {
        (self.seconds - other.seconds).abs() < 0.001
            && (self.momentary_lufs - other.momentary_lufs).abs() < 0.01
            && (self.short_term_lufs - other.short_term_lufs).abs() < 0.01
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixLoudnessReport {
    pub duration_seconds: f64,
    pub integrated_lufs: f64,
    pub loudness_range_lu: f64,
    pub max_momentary_lufs: f64,
    pub max_short_term_lufs: f64,
    pub sample_peak_dbfs: f64,
    pub true_peak_dbtp: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_lufs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_delta_db: Option<f64>,
    pub samples: Vec<LoudnessSample>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessProgressEvent {
    pub percent: f64,
    pub seconds: f64,
    pub total_seconds: f64,
}

fn decode_f32_le(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Lee PCM f32le intercalado y alimenta el medidor por sub-bloques de 100 ms
/// (el paso exacto al que BS.1770 evalúa las ventanas). Cada sub-bloque agrega
/// una muestra al historial; `on_sample` recibe `(segundos, momentary,
/// short_term, porcentaje)` para que la UI muestre avance.
fn run_meter_over_pcm<R: Read>(
    mut reader: R,
    sample_rate: f64,
    channels: usize,
    total_seconds: f64,
    mut on_sample: impl FnMut(f64, f64, f64, f64),
) -> Result<(LoudnessMeter, Vec<LoudnessSample>, f64), ProjectError> {
    let frame_bytes = channels.max(1).saturating_mul(4);
    let chunk_frames = ((sample_rate / 10.0).floor() as usize).max(1);
    let chunk_bytes = chunk_frames * frame_bytes;
    let step = chunk_frames as f64 / sample_rate;
    let mut meter = LoudnessMeter::new(sample_rate, channels);
    let mut history: Vec<LoudnessSample> = Vec::new();
    let mut carry: Vec<u8> = Vec::with_capacity(chunk_bytes * 2);
    let mut buffer = vec![0u8; chunk_bytes];
    let mut seconds = 0.0f64;
    loop {
        let read = reader.read(&mut buffer).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "no se pudo leer el PCM de la mezcla",
            )
        })?;
        if read == 0 {
            break;
        }
        carry.extend_from_slice(&buffer[..read]);
        while carry.len() >= chunk_bytes {
            let frames = decode_f32_le(&carry[..chunk_bytes]);
            meter.process_interleaved(&frames);
            seconds += step;
            let sample = LoudnessSample {
                seconds,
                momentary_lufs: floor_lufs(meter.momentary()),
                short_term_lufs: floor_lufs(meter.short_term()),
            };
            on_sample(
                sample.seconds,
                sample.momentary_lufs,
                sample.short_term_lufs,
                (seconds / total_seconds.max(0.001)).min(1.0),
            );
            history.push(sample);
            carry.drain(..chunk_bytes);
        }
    }
    // Resto final menor a 100 ms: también cuenta para el integrated.
    let usable = carry.len() - carry.len() % frame_bytes;
    if usable > 0 {
        let frames = decode_f32_le(&carry[..usable]);
        meter.process_interleaved(&frames);
        seconds += (usable / frame_bytes) as f64 / sample_rate;
        history.push(LoudnessSample {
            seconds,
            momentary_lufs: floor_lufs(meter.momentary()),
            short_term_lufs: floor_lufs(meter.short_term()),
        });
    }
    Ok((meter, history, seconds))
}

/// Diezma el historial a lo sumo a `MAX_HISTORY` muestras conservando la
/// última (la más fresca para la UI).
fn decimate_history(history: Vec<LoudnessSample>) -> Vec<LoudnessSample> {
    if history.len() <= MAX_HISTORY {
        return history;
    }
    let stride = history.len() as f64 / MAX_HISTORY as f64;
    let mut out = Vec::with_capacity(MAX_HISTORY + 1);
    let mut index = 0usize;
    while index < history.len() {
        out.push(history[index]);
        index = ((index as f64 + stride).round() as usize).max(index + 1);
    }
    if let Some(last) = history.last() {
        if out.last() != Some(last) {
            out.push(*last);
        }
    }
    out
}

fn build_report(
    meter: LoudnessMeter,
    history: Vec<LoudnessSample>,
    seconds: f64,
    target_lufs: Option<f64>,
) -> Result<MixLoudnessReport, ProjectError> {
    if history.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la mezcla no produjo audio para medir",
        ));
    }
    let integrated = floor_lufs(meter.integrated());
    let target_delta_db = target_lufs.map(|target| ((target - integrated) * 10.0).round() / 10.0);
    Ok(MixLoudnessReport {
        duration_seconds: seconds,
        integrated_lufs: integrated,
        loudness_range_lu: meter.loudness_range(),
        max_momentary_lufs: floor_lufs(meter.max_momentary()),
        max_short_term_lufs: floor_lufs(meter.max_short_term()),
        sample_peak_dbfs: floor_db(20.0 * meter.sample_peak().log10()),
        true_peak_dbtp: floor_db(meter.true_peak_dbtp()),
        target_delta_db,
        target_lufs,
        samples: decimate_history(history),
    })
}

#[tauri::command]
pub async fn analyze_mix_loudness(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<MixLoudnessReport, ProjectError> {
    // Los préstamos de `State` no cruzan el await de `spawn_blocking`: todo lo
    // que el hilo necesita se clona antes.
    let (project_path, project_root, cache_dir, ffmpeg, ffprobe) = {
        let session = state.require_session()?;
        let settings = state.settings_snapshot()?;
        let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
        let Some(ffmpeg) = ffmpeg else {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "ffmpeg no está disponible; elegí ffmpeg.exe en Ajustes → Herramientas",
            ));
        };
        let Some(ffprobe) = ffprobe else {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "ffprobe no está disponible; sin él no se puede armar el grafo de la mezcla",
            ));
        };
        (
            session.path.clone(),
            session.root.clone(),
            state.cache_dir.clone(),
            ffmpeg,
            ffprobe,
        )
    };

    // La medición abre el proyecto guardado, igual que el export: lo que se
    // mide es exactamente lo que se exporta.
    let opened = service::open_project(&project_path)?;
    let project = expand_compounds(&opened.project)?;
    let profiles = project["renderProfiles"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if profiles.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto no tiene perfiles de exportación",
        ));
    }
    let profile_json = match profile_id.as_deref() {
        Some(id) if !id.is_empty() => profiles
            .iter()
            .find(|profile| profile["id"].as_str() == Some(id))
            .cloned()
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el perfil de exportación elegido ya no existe",
                )
            })?,
        _ => profiles[0].clone(),
    };
    let profile = parse_profile(&profile_json)?;
    let sample_rate = f64::from(profile.audio_rate);
    let channels = profile.audio_channels as usize;
    let target_lufs = project["audio"]["loudnessTarget"]["integratedLufs"].as_f64();

    let job = uuid::Uuid::new_v4().simple().to_string();
    let temp_dir = cache_dir.join(format!("loudness-{job}"));
    std::fs::create_dir_all(&temp_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo preparar la carpeta temporal",
        )
    })?;

    let plan = match crate::render::ffmpeg::build_plan(BuildPlanInput {
        project: &project,
        root: &project_root,
        profile: &profile,
        output_path: Path::new(""),
        include_captions: false,
        temp_dir: &temp_dir,
        ffprobe: &ffprobe,
        motion_ass: None,
        audio_only: true,
    }) {
        Ok(plan) => plan,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    let total_seconds = plan.duration_seconds;
    let working_dir: PathBuf = plan.working_dir.clone();

    let progress_app = app.clone();
    let handle =
        tauri::async_runtime::spawn_blocking(move || -> Result<MixLoudnessReport, ProjectError> {
            let mut child = crate::render::ffmpeg::spawn(&ffmpeg, &plan).map_err(|error| {
                let _ = std::fs::remove_dir_all(&working_dir);
                error
            })?;
            let stdout = child.stdout.take();
            let stderr_tail = Arc::new(Mutex::new(String::new()));
            let stderr_thread = child.stderr.take().map(|mut stderr| {
                let tail = stderr_tail.clone();
                std::thread::spawn(move || {
                    let mut buffer = Vec::new();
                    let mut chunk = [0u8; 8_192];
                    loop {
                        match stderr.read(&mut chunk) {
                            Ok(0) | Err(_) => break,
                            Ok(read) => {
                                buffer.extend_from_slice(&chunk[..read]);
                                if buffer.len() > 16_384 {
                                    let drain = buffer.len() - 16_384;
                                    buffer.drain(..drain);
                                }
                            }
                        }
                    }
                    if let Ok(mut guard) = tail.lock() {
                        *guard = String::from_utf8_lossy(&buffer).into_owned();
                    }
                })
            });
            let mut seen = 0usize;
            let measured = stdout.map(|reader| {
                run_meter_over_pcm(
                    reader,
                    sample_rate,
                    channels,
                    total_seconds,
                    |seconds, _momentary, _short_term, percent| {
                        seen += 1;
                        if seen % EMIT_EVERY == 1 {
                            let _ = progress_app.emit(
                                "loudness-analysis-progress",
                                LoudnessProgressEvent {
                                    percent: percent * 100.0,
                                    seconds,
                                    total_seconds,
                                },
                            );
                        }
                    },
                )
            });
            if let Some(thread) = stderr_thread {
                let _ = thread.join();
            }
            let status = child.wait().map_err(|_| {
                ProjectError::message(ProjectErrorCode::RenderFailed, "ffmpeg terminó mal")
            })?;
            let (meter, history, seconds) = match measured {
                Some(result) => result?,
                None => {
                    return Err(ProjectError::message(
                        ProjectErrorCode::RenderFailed,
                        "ffmpeg no expuso el PCM de la mezcla",
                    ))
                }
            };
            if !status.success() {
                let detail = stderr_tail
                    .lock()
                    .map(|guard| crate::render::ffmpeg::sanitize_log(&guard, &working_dir, 400))
                    .unwrap_or_default();
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    if detail.is_empty() {
                        "ffmpeg no pudo decodificar la mezcla"
                    } else {
                        detail.as_str()
                    },
                ));
            }
            build_report(meter, history, seconds, target_lufs)
        });
    let report = match handle.await {
        Ok(result) => result,
        Err(_) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "el análisis de loudness se interrumpió",
            ));
        }
    };
    let _ = std::fs::remove_dir_all(&temp_dir);
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Seno estereo de 997 Hz a −23 dBFS: la señal de alineación de BS.1770-4,
    /// que debe medir −23 LUFS integrados.
    fn alignment_sine_pcm(seconds: f64) -> Vec<u8> {
        let rate = 48_000.0f64;
        let amplitude = 10f32.powf(-23.0 / 20.0);
        let mut pcm = Vec::with_capacity((seconds * rate) as usize * 8);
        for frame in 0..(seconds * rate) as usize {
            let t = frame as f64 / rate;
            let value = (amplitude as f64 * (2.0 * std::f64::consts::PI * 997.0 * t).sin()) as f32;
            pcm.extend_from_slice(&value.to_le_bytes());
            pcm.extend_from_slice(&value.to_le_bytes());
        }
        pcm
    }

    #[test]
    fn bs1770_alignment_sine_measures_minus_23_lufs() {
        let pcm = alignment_sine_pcm(6.0);
        let (meter, history, seconds) =
            run_meter_over_pcm(Cursor::new(pcm), 48_000.0, 2, 6.0, |_, _, _, _| {})
                .expect("medir el tono");
        assert!((seconds - 6.0).abs() < 0.05, "duración medida: {seconds}");
        let integrated = meter.integrated();
        assert!(
            (integrated - (-23.0)).abs() < 0.1,
            "el tono de alineación debe medir −23 LUFS, midió {integrated}"
        );
        let short_term = meter.short_term();
        assert!(
            (short_term - (-23.0)).abs() < 0.2,
            "short-term del tono continuo ≈ −23, midió {short_term}"
        );
        assert_eq!(history.len(), 60, "una muestra cada 100 ms");
    }

    #[test]
    fn silence_is_floored_never_infinite() {
        let pcm = vec![0u8; 48_000 * 2 * 4]; // 1 s de silencio estéreo.
        let report = build_report_from_pcm(pcm);
        assert_eq!(report.integrated_lufs, LUFS_FLOOR);
        assert_eq!(report.sample_peak_dbfs, DB_FLOOR);
        assert_eq!(report.true_peak_dbtp, DB_FLOOR);
        assert!(report
            .samples
            .iter()
            .all(|sample| sample.momentary_lufs.is_finite()));
        let json = serde_json::to_string(&report).expect("serializable");
        assert!(!json.contains("null"), "sin nulls por infinitos: {json}");
    }

    fn build_report_from_pcm(pcm: Vec<u8>) -> MixLoudnessReport {
        let (meter, history, seconds) =
            run_meter_over_pcm(Cursor::new(pcm), 48_000.0, 2, 1.0, |_, _, _, _| {})
                .expect("medir el silencio");
        build_report(meter, history, seconds, None).expect("reporte del silencio")
    }

    #[test]
    fn history_is_decimated_and_keeps_last() {
        let mut history: Vec<LoudnessSample> = (0..MAX_HISTORY * 3)
            .map(|index| LoudnessSample {
                seconds: index as f64 / 10.0,
                momentary_lufs: -23.0,
                short_term_lufs: -23.0,
            })
            .collect();
        history.push(LoudnessSample {
            seconds: 999.0,
            momentary_lufs: -10.0,
            short_term_lufs: -10.0,
        });
        let decimated = decimate_history(history);
        assert!(
            decimated.len() <= MAX_HISTORY + 1,
            "diezmado a lo sumo al tope"
        );
        assert_eq!(decimated.last().expect("última").seconds, 999.0);
    }

    #[test]
    fn target_delta_rounds_to_one_decimal() {
        let pcm = alignment_sine_pcm(2.0);
        let (meter, history, seconds) =
            run_meter_over_pcm(Cursor::new(pcm), 48_000.0, 2, 2.0, |_, _, _, _| {}).expect("medir");
        let report = build_report(meter, history, seconds, Some(-14.0)).expect("reporte");
        let delta = report.target_delta_db.expect("delta");
        assert!((delta - 9.0).abs() <= 0.25, "delta ≈ +9 dB, dio {delta}");
        assert!(
            (delta * 10.0).fract().abs() < 1e-9,
            "redondeado a 1 decimal"
        );
    }

    /// El plan de medición es audio puro: sin `-progress` (stdout lleva el
    /// PCM), sin loudnorm, sin encoder de video, salida f32le a stdout.
    #[test]
    fn audio_only_plan_streams_raw_mix() {
        use serde_json::json;
        let root = std::env::temp_dir().join(format!("editor-ia-lufs-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let project = json!({
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "a1", "kind": "audio", "order": 0, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "c1", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 60 } }
                ]
            },
            "assets": [
                { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 }, "loudnessTarget": { "integratedLufs": -14, "truePeakDb": -1.5 } }
        });
        let profile = crate::render::ffmpeg::Profile {
            id: "p".into(),
            name: "YouTube 1080p".into(),
            width: 1920,
            height: 1080,
            fps_num: 30,
            fps_den: 1,
            crf: Some(20),
            target_bps: None,
            video_preset: "veryfast".into(),
            fit: "contain".into(),
            audio_bps: 128_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1,
            duration_tolerance_frames: 2,
            hardware_encoder: None,
        };
        let plan = crate::render::ffmpeg::build_plan(BuildPlanInput {
            project: &project,
            root: &root,
            profile: &profile,
            output_path: Path::new(""),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
            audio_only: true,
        })
        .expect("plan de medición");
        let joined = plan.args.join(" ");
        assert!(joined.contains("-f f32le"), "salida PCM: {joined}");
        assert!(joined.contains("-map [aout]"), "sólo audio: {joined}");
        assert!(!joined.contains("-progress"), "stdout es PCM: {joined}");
        assert!(!joined.contains("loudnorm"), "sin normalización: {joined}");
        assert!(!joined.contains("-c:v"), "sin encoder de video: {joined}");
        assert!(!joined.contains("alimiter"), "sin limitador: {joined}");
        assert_eq!(plan.args.last().map(String::as_str), Some("-"), "stdout");
        assert_eq!(plan.min_output_bytes, 0);
        let _ = std::fs::remove_dir_all(root);
    }

    /// Prueba live opcional con FFmpeg real (corrí con
    /// `EDITOR_IA_FFMPEG=ruta\a\ffmpeg.exe cargo test -- --ignored`): el tono de
    /// alineación generado por lavfi debe medir −23 LUFS de punta a punta.
    #[test]
    #[ignore]
    fn live_ffmpeg_sine_measures_reference_lufs() {
        let ffmpeg = std::env::var("EDITOR_IA_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_owned());
        let mut command = std::process::Command::new(&ffmpeg);
        command.args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=997:sample_rate=48000:duration=6",
            "-af",
            "volume=-23dB,aformat=channel_layouts=stereo",
            "-f",
            "f32le",
            "-",
        ]);
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let mut child = command.spawn().expect("ffmpeg disponible");
        let stdout = child.stdout.take().expect("pcm");
        let (meter, history, seconds) =
            run_meter_over_pcm(stdout, 48_000.0, 2, 6.0, |_, _, _, _| {}).expect("medir");
        assert!(child.wait().expect("wait").success());
        assert!((seconds - 6.0).abs() < 0.2, "duración: {seconds}");
        assert_eq!(history.len(), 60);
        let integrated = meter.integrated();
        assert!(
            (integrated - (-23.0)).abs() < 0.5,
            "live: integrado ≈ −23 LUFS, midió {integrated}"
        );
    }
}
