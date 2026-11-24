//! Utilidades de mezcla del motor `ducking`/`channels` de
//! filmcraft-audio-dsp, expuestas como herramientas IPC para la IA:
//! plan de sidechain ducking (regiones de voz + keyframes de ganancia) y
//! conversión de layouts de canales (mono/stéreo/5.1 con mixdowns BS.775).

use serde::Serialize;
use tauri::State;

use super::audio_tools::{
    decode_planar, output_file, resolve_ffmpeg, user_file, MAX_PROCESS_SECONDS,
};
use crate::media::audio_tools::{PlanarPcm, TARGET_RATE};
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

fn invalid(msg: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, msg)
}

fn render_failed(msg: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::RenderFailed, msg)
}

/// Plan de ducking sidechain sobre un archivo (típicamente la voz/narración
/// como `key`): detecta las regiones donde hay señal por encima del umbral
/// y devuelve los keyframes de ganancia que un clip de música debería
/// seguir (baja `reduceDb` durante la voz, sube con `fadeSeconds` de rampa).
/// Es solo análisis: no modifica ningún archivo ni el proyecto.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckPlan {
    pub duration_seconds: f64,
    /// Regiones de actividad (voz) en segundos: [inicio, fin].
    pub regions: Vec<(f64, f64)>,
    /// Keyframes (tiempo_s, ganancia_db) listos para automatización de volumen.
    pub keyframes: Vec<(f64, f64)>,
    /// Envolvente de nivel cada ~50 ms, en dB (para que la IA vea la forma).
    pub envelope_db: Vec<f64>,
    pub threshold_db: f64,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn audio_duck_plan(
    state: State<'_, AppState>,
    path: String,
    sensitivity: Option<f64>,
    min_on_seconds: Option<f64>,
    bridge_seconds: Option<f64>,
    clip_start_seconds: Option<f64>,
    clip_end_seconds: Option<f64>,
    base_db: Option<f64>,
    reduce_db: Option<f64>,
    fade_seconds: Option<f64>,
) -> Result<DuckPlan, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let sensitivity = sensitivity.unwrap_or(0.5).clamp(0.0, 1.0);
    let min_on = min_on_seconds.unwrap_or(0.15).clamp(0.02, 5.0);
    let bridge = bridge_seconds.unwrap_or(0.3).clamp(0.0, 2.0);
    let base = base_db.unwrap_or(0.0).clamp(-60.0, 12.0);
    let reduce = reduce_db.unwrap_or(-12.0).clamp(-60.0, 0.0);
    let fade = fade_seconds.unwrap_or(0.15).clamp(0.01, 2.0);
    let pcm = tokio::task::spawn_blocking(move || {
        decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)
    })
    .await
    .map_err(|_| render_failed("el análisis de ducking falló"))??;
    let frames = pcm.iter().map(Vec::len).min().unwrap_or(0);
    let duration = frames as f64 / TARGET_RATE as f64;
    if duration <= 0.0 {
        return Err(render_failed("el archivo no tiene audio decodificable"));
    }
    let clip_start = clip_start_seconds.unwrap_or(0.0).clamp(0.0, duration);
    let clip_end = clip_end_seconds
        .unwrap_or(duration)
        .clamp(clip_start, duration);
    if clip_end - clip_start < 0.05 {
        return Err(invalid("la ventana de clip es demasiado corta"));
    }
    // Mono promediado para la envolvente.
    let n = frames;
    let mono: Vec<f32> = (0..n)
        .map(|i| {
            pcm.iter()
                .map(|ch| ch.get(i).copied().unwrap_or(0.0))
                .sum::<f32>()
                / pcm.len().max(1) as f32
        })
        .collect();
    let channels: Vec<&[f32]> = vec![mono.as_slice()];
    // hop 10 ms / ventana 50 ms: resolución fina sin costo excesivo.
    let hop_s = 0.01f32;
    let window_s = 0.05f32;
    let env =
        filmcraft_audio_dsp::ducking::envelope_db(&channels, TARGET_RATE as f32, hop_s, window_s);
    let threshold = filmcraft_audio_dsp::ducking::sensitivity_threshold_db(sensitivity as f32);
    let regions = filmcraft_audio_dsp::ducking::activity(
        &env,
        hop_s,
        threshold,
        min_on as f32,
        bridge as f32,
    );
    let keyframes = filmcraft_audio_dsp::ducking::duck_keyframes(
        &regions, clip_start, clip_end, base, reduce, fade,
    );
    // Envolvente reducida a ~20 puntos/segundo para no inflar la respuesta.
    // La envolvente tiene un punto cada `hop_s` (100/s con hop 10 ms):
    // el stride es en ÍNDICES de envolvente, no en samples — stride=5.
    let stride = (1.0 / (hop_s * 20.0)).round().max(1.0) as usize;
    let envelope_db: Vec<f64> = env
        .iter()
        .step_by(stride.max(1))
        .map(|&v| v as f64)
        .collect();
    Ok(DuckPlan {
        duration_seconds: duration,
        regions,
        keyframes,
        envelope_db,
        threshold_db: threshold as f64,
    })
}

/// Conversión de layout de canales con las matrices de filmcraft
/// (`channels::convert`): mono ↔ estéreo ↔ 5.1. Para 5.1→estéreo el
/// `mixdown` elige el folding (front/frontRear/frontLfe/frontRearLfe,
/// default BS.775 frontRear). `from_layout` se autodetecta con ffprobe si
/// se omite. Salida WAV con el layout destino.
#[tauri::command]
pub async fn audio_channels_convert(
    state: State<'_, AppState>,
    path: String,
    output: String,
    to_layout: String,
    mixdown: Option<String>,
    from_layout: Option<String>,
) -> Result<String, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = crate::commands::system::resolve_tools(&settings);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para procesar audio",
        )
    })?;
    let source = user_file(&path)?;
    let dest = output_file(&output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".wav") {
        return Err(invalid("la salida debe ser un archivo .wav"));
    }
    let to =
        parse_layout(&to_layout).ok_or_else(|| invalid("to_layout debe ser mono, stereo o 5.1"))?;
    let mix = match mixdown.as_deref() {
        None | Some("") => filmcraft_audio_dsp::channels::Mixdown::default(),
        Some(id) => filmcraft_audio_dsp::channels::Mixdown::from_id(id)
            .ok_or_else(|| invalid("mixdown debe ser front, frontRear, frontLfe o frontRearLfe"))?,
    };
    // Layout de entrada: explícito o autodetectado por ffprobe.
    let from = match from_layout.as_deref() {
        Some(raw) if !raw.is_empty() => {
            parse_layout(raw).ok_or_else(|| invalid("from_layout debe ser mono, stereo o 5.1"))?
        }
        _ => {
            let ffprobe = ffprobe.ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "ffprobe es necesario para detectar el layout",
                )
            })?;
            let ffprobe = ffprobe.clone();
            let source_probe = source.clone();
            let measure = tauri::async_runtime::spawn_blocking(move || {
                probe_file(&ffprobe, &source_probe, MediaKind::Audio)
            })
            .await
            .map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    format!("no se pudo medir el audio: {error}").as_str(),
                )
            })??;
            filmcraft_audio_dsp::channels::Layout::from_channels(
                measure.channels.unwrap_or(2) as usize
            )
        }
    };
    if from == to {
        return Err(invalid("el layout de salida es igual al de entrada"));
    }
    let pcm = tokio::task::spawn_blocking(move || {
        decode_planar(&ffmpeg, &source, from.channels(), MAX_PROCESS_SECONDS)
    })
    .await
    .map_err(|_| render_failed("la conversión de canales falló"))??;
    if pcm.len() != from.channels() {
        return Err(render_failed(
            "la decodificación no produjo el layout esperado",
        ));
    }
    let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
    let converted = filmcraft_audio_dsp::channels::convert(&channels, from, to, mix);
    let out: PlanarPcm = converted
        .into_iter()
        .map(|ch| {
            ch.into_iter()
                .map(|v| v.clamp(-1.0, 1.5))
                .collect::<Vec<f32>>()
        })
        .collect();
    let dest_write = dest.clone();
    tokio::task::spawn_blocking(move || {
        crate::media::audio_tools::write_wav_atomic(&out, TARGET_RATE, &dest_write)
    })
    .await
    .map_err(|_| render_failed("la escritura del WAV falló"))?
    .map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el WAV: {e}"),
        )
    })?;
    Ok(dest.to_string_lossy().to_string())
}

fn parse_layout(raw: &str) -> Option<filmcraft_audio_dsp::channels::Layout> {
    match raw.trim().to_lowercase().as_str() {
        "mono" | "m" | "1" => Some(filmcraft_audio_dsp::channels::Layout::Mono),
        "stereo" | "st" | "2" => Some(filmcraft_audio_dsp::channels::Layout::Stereo),
        "5.1" | "51" | "surround" | "6" => Some(filmcraft_audio_dsp::channels::Layout::Surround51),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use filmcraft_audio_dsp::channels::{convert, Layout, Mixdown};
    use filmcraft_audio_dsp::ducking::{
        activity, duck_keyframes, envelope_db, sensitivity_threshold_db,
    };

    const SR: f32 = 48_000.0;

    fn tone(freq: f32, secs: f32) -> Vec<f32> {
        let n = (SR * secs) as usize;
        (0..n)
            .map(|i| (i as f32 * freq * std::f32::consts::TAU / SR).sin() * 0.5)
            .collect()
    }

    #[test]
    fn duck_plan_finds_speech_regions() {
        // "Voz" = tono 300 ms, silencio, tono 300 ms.
        let mut mono = vec![0.0f32; (SR * 0.3) as usize];
        mono.extend(tone(220.0, 0.3));
        mono.extend(vec![0.0f32; (SR * 0.3) as usize]);
        mono.extend(tone(330.0, 0.3));
        let channels: Vec<&[f32]> = vec![mono.as_slice()];
        let env = envelope_db(&channels, SR, 0.01, 0.05);
        let thr = sensitivity_threshold_db(0.5);
        let regions = activity(&env, 0.01, thr, 0.15, 0.3);
        // Con bridge 0.3 s los dos tonos quedan en una sola región.
        assert_eq!(regions.len(), 1, "regiones: {regions:?}");
        assert!(regions[0].0 < 0.4 && regions[0].1 > 0.5);
        let kf = duck_keyframes(&regions, 0.0, 1.2, 0.0, -12.0, 0.15);
        assert!(kf.len() >= 3, "keyframes: {kf:?}");
        // Debe haber un tramo ducked a -12 dB.
        assert!(kf.iter().any(|(_, v)| (*v - -12.0).abs() < 0.5));
    }

    #[test]
    fn channels_stereo_to_mono_downmixes() {
        // L=tono, R=silencio → mono debe tener K=1/sqrt(2) de amplitud.
        let l = tone(440.0, 0.1);
        let r = vec![0.0f32; l.len()];
        let input: Vec<&[f32]> = vec![l.as_slice(), r.as_slice()];
        let out = convert(&input, Layout::Stereo, Layout::Mono, Mixdown::default());
        assert_eq!(out.len(), 1);
        let peak_in = input[0].iter().fold(0f32, |a, &b| a.max(b.abs()));
        let peak_out = out[0].iter().fold(0f32, |a, &b| a.max(b.abs()));
        assert!(
            (peak_out - peak_in * std::f32::consts::FRAC_1_SQRT_2).abs() < 0.02,
            "{peak_in} -> {peak_out}"
        );
    }

    #[test]
    fn channels_51_to_stereo_front_rear() {
        // 5.1: solo el canal surround izquierdo (índice 4) tiene señal.
        let n = (SR * 0.05) as usize;
        let mut chans: Vec<Vec<f32>> = vec![vec![0.0; n]; 6];
        chans[4] = tone(500.0, 0.05);
        let input: Vec<&[f32]> = chans.iter().map(Vec::as_slice).collect();
        let out = convert(
            &input,
            Layout::Surround51,
            Layout::Stereo,
            Mixdown::FrontRear,
        );
        assert_eq!(out.len(), 2);
        // BS.775: LS→L y RS→R por separado; con solo LS activo, R queda muda.
        assert!(out[0].iter().any(|v| v.abs() > 1e-3));
        assert!(out[1].iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn parse_layout_aliases() {
        assert_eq!(parse_layout("mono"), Some(Layout::Mono));
        assert_eq!(parse_layout("Stereo"), Some(Layout::Stereo));
        assert_eq!(parse_layout("5.1"), Some(Layout::Surround51));
        assert_eq!(parse_layout("quad"), None);
    }
}
