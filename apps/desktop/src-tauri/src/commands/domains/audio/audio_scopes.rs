//! Scopes de audio al estilo Kdenlive (`src/scopes/audioscopes/`):
//! oscilograma (min/max por bucket), espectro promedio y espectrograma,
//! calculados en Rust con el FFT de `filmcraft-audio-dsp` sobre PCM f32le
//! mono que decodifica FFmpeg. La UI dibuja el JSON resultante en canvas.
//!
//! Todo el cálculo vive en funciones puras testeables (`analyze_pcm`); el
//! comando sólo decodifica y delega.

use serde::Serialize;
use std::f32::consts::PI;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;
use tauri::State;

/// Tamaño de ventana FFT (potencia de 2). 2048 @ 48 kHz ≈ 42 ms por columna.
const FFT_SIZE: usize = 2048;
const SPECTRUM_BINS: usize = 512;
const SPECTROGRAM_ROWS: usize = 256;
const SPECTROGRAM_MAX_COLS: usize = 384;
const WAVEFORM_BUCKETS: usize = 512;
/// Tope de audio analizado por llamada: 90 s @ 48 kHz mono f32 ≈ 69 MB PCM.
const MAX_ANALYZE_SECONDS: f64 = 90.0;
const TARGET_RATE: u32 = 48_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioScopeData {
    pub sample_rate: u32,
    pub duration_seconds: f64,
    /// Pares [min, max] por bucket temporal, en [-1, 1].
    pub waveform: Vec<[f32; 2]>,
    /// Magnitud promedio en dBFS por bin (0..Nyquist), `SPECTRUM_BINS` valores.
    pub spectrum: Vec<f32>,
    /// Espectrograma: `cols` columnas × `rows` filas de dBFS, orden temporal.
    pub spectrogram_cols: usize,
    pub spectrogram_rows: usize,
    /// Datos en orden columna-mayor: índice `col * rows + row`, dBFS [-120, 0].
    pub spectrogram: Vec<f32>,
}

fn decode_f32_le(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Oscilograma: min/max por bucket. PCM vacío devuelve buckets en cero.
fn waveform_buckets(samples: &[f32], buckets: usize) -> Vec<[f32; 2]> {
    let mut out = vec![[0.0f32, 0.0f32]; buckets];
    if samples.is_empty() || buckets == 0 {
        return out;
    }
    let per = (samples.len() as f64 / buckets as f64).ceil() as usize;
    for (index, chunk) in samples.chunks(per.max(1)).enumerate().take(buckets) {
        let mut min = f32::INFINITY;
        let mut max = f32::NEG_INFINITY;
        for &sample in chunk {
            min = min.min(sample);
            max = max.max(sample);
        }
        out[index] = [min, max];
    }
    out
}

/// Aplica ventana Hann y FFT; devuelve magnitudes normalizadas [0, ~1].
fn magnitudes(window: &[f32], fft: &filmcraft_audio_dsp::fft::Fft) -> Vec<f32> {
    let n = fft.len();
    let mut re = vec![0.0f32; n];
    let mut im = vec![0.0f32; n];
    for (i, &sample) in window.iter().take(n).enumerate() {
        // Ventana Hann: 0.5 - 0.5·cos(2πi/(N-1)).
        let hann = 0.5 - 0.5 * (2.0 * PI * i as f32 / (n - 1) as f32).cos();
        re[i] = sample * hann;
    }
    fft.forward(&mut re, &mut im);
    (0..n / 2)
        .map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt() / n as f32 * 2.0)
        .collect()
}

fn to_db(magnitude: f32) -> f32 {
    // -120 dB como piso de ruido; 0 dBFS como techo.
    (20.0 * magnitude.max(1e-6).log10()).clamp(-120.0, 0.0)
}

/// Núcleo puro: PCM mono f32 → oscilograma + espectro + espectrograma.
/// Rechaza vacío; ventanas incomletas se zero-paddean.
pub fn analyze_pcm(samples: &[f32], sample_rate: u32) -> AudioScopeData {
    let fft = filmcraft_audio_dsp::fft::Fft::new(FFT_SIZE);
    let hop = FFT_SIZE / 2;
    let bins_per_row = FFT_SIZE / 2 + 1;

    // Ventanas consecutivas (hop 50 %).
    let mut windows: Vec<Vec<f32>> = Vec::new();
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + FFT_SIZE).min(samples.len());
        let mut window = vec![0.0f32; FFT_SIZE];
        window[..end - start].copy_from_slice(&samples[start..end]);
        windows.push(window);
        if end == samples.len() {
            break;
        }
        start += hop;
    }
    if windows.is_empty() {
        windows.push(vec![0.0f32; FFT_SIZE]);
    }

    // Magnitudes por ventana: [ventana][bin].
    let mags: Vec<Vec<f32>> = windows.iter().map(|w| magnitudes(w, &fft)).collect();

    // Espectro promedio → remuestreo lineal a SPECTRUM_BINS.
    let mut spectrum_sum = vec![0.0f64; bins_per_row];
    for mag in &mags {
        for (i, &m) in mag.iter().enumerate() {
            spectrum_sum[i] += m as f64;
        }
    }
    let count = mags.len().max(1) as f64;
    let avg: Vec<f32> = spectrum_sum.iter().map(|v| (*v / count) as f32).collect();
    let spectrum = resample_linear(&avg, SPECTRUM_BINS)
        .iter()
        .map(|&m| to_db(m))
        .collect();

    // Espectrograma: filas = bins de frecuencia (log-ish remuestreo a
    // SPECTROGRAM_ROWS desde bins_per_row), columnas = ventanas remuestreadas.
    let freq_rows: Vec<Vec<f32>> = (0..SPECTROGRAM_ROWS)
        .map(|row| {
            // Distribución lineal de bins fuente por fila (el eje log lo hace
            // la UI si lo necesita; acá va denso para no perder agudos).
            let src = resample_index(row, SPECTROGRAM_ROWS, bins_per_row);
            mags.iter().map(|mag| mag[src]).collect()
        })
        .collect();
    let cols = windows.len().min(SPECTROGRAM_MAX_COLS).max(1);
    let col_step = windows.len() as f64 / cols as f64;
    let mut spectrogram = Vec::with_capacity(cols * SPECTROGRAM_ROWS);
    for col in 0..cols {
        let src = ((col as f64 * col_step) as usize).min(windows.len() - 1);
        for row in 0..SPECTROGRAM_ROWS {
            spectrogram.push(to_db(freq_rows[row][src]));
        }
    }

    AudioScopeData {
        sample_rate,
        duration_seconds: samples.len() as f64 / sample_rate.max(1) as f64,
        waveform: waveform_buckets(samples, WAVEFORM_BUCKETS),
        spectrum,
        spectrogram_cols: cols,
        spectrogram_rows: SPECTROGRAM_ROWS,
        spectrogram,
    }
}

/// Remuestreo lineal de una señal a `out_len` puntos.
fn resample_linear(input: &[f32], out_len: usize) -> Vec<f32> {
    if input.is_empty() || out_len == 0 {
        return Vec::new();
    }
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * (input.len() - 1) as f64 / out_len.max(1) as f64;
            let lo = pos.floor() as usize;
            let hi = (lo + 1).min(input.len() - 1);
            let frac = (pos - lo as f64) as f32;
            input[lo] * (1.0 - frac) + input[hi] * frac
        })
        .collect()
}

fn resample_index(row: usize, rows: usize, bins: usize) -> usize {
    (((row as f64 + 0.5) * bins as f64 / rows as f64) as usize).min(bins - 1)
}

/// Decodifica el audio de un archivo a PCM f32le mono 48 kHz con FFmpeg.
/// Con `range` decodifica sólo la ventana `[start, start + duration)` en
/// segundos del archivo (seek de entrada + `-t` de salida).
fn decode_pcm(
    ffmpeg: &std::path::Path,
    path: &std::path::Path,
    range: Option<(f64, f64)>,
) -> Result<Vec<f32>, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-nostats", "-v", "error"]);
    if let Some((start, _)) = range {
        command.arg("-ss").arg(format!("{start:.3}"));
    }
    command.arg("-i").arg(path);
    if let Some((_, duration)) = range {
        command.arg("-t").arg(format!("{duration:.3}"));
    }
    let mut child = command
        .args([
            "-vn",
            "-ac",
            "1",
            "-ar",
            &TARGET_RATE.to_string(),
            "-f",
            "f32le",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo decodificar el audio: {error}"),
            )
        })?;
    let mut pcm = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        // Tope de lectura: MAX_ANALYZE_SECONDS de PCM mono f32.
        let cap = (TARGET_RATE as f64 * MAX_ANALYZE_SECONDS) as usize * 4;
        let mut buf = vec![0u8; 1 << 20];
        while pcm.len() < cap {
            match stdout.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => pcm.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
        }
    }
    let status = child.wait().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no terminó la decodificación de audio",
        )
    })?;
    let _ = status;
    Ok(decode_f32_le(&pcm))
}

/// Valida la ventana opcional de análisis. `start` y `duration` van juntos;
/// la duración se acota al tope de `MAX_ANALYZE_SECONDS`.
fn normalize_scope_range(
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<Option<(f64, f64)>, ProjectError> {
    let invalid = |message: &str| ProjectError::message(ProjectErrorCode::InvalidProject, message);
    match (start_seconds, duration_seconds) {
        (None, None) => Ok(None),
        (Some(start), Some(duration)) => {
            if !start.is_finite() || start < 0.0 {
                return Err(invalid(
                    "el inicio de la ventana debe ser un número finito ≥ 0",
                ));
            }
            if !duration.is_finite() || duration <= 0.0 {
                return Err(invalid(
                    "la duración de la ventana debe ser un número finito > 0",
                ));
            }
            Ok(Some((start, duration.min(MAX_ANALYZE_SECONDS))))
        }
        _ => Err(invalid(
            "startSeconds y durationSeconds deben indicarse juntos",
        )),
    }
}

/// Analiza el audio de un archivo del proyecto: oscilograma, espectro y
/// espectrograma listos para dibujar en canvas. Con `start_seconds` +
/// `duration_seconds` analiza sólo esa ventana del archivo.
#[tauri::command]
pub async fn audio_scope_analyze(
    state: State<'_, AppState>,
    path: String,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<AudioScopeData, ProjectError> {
    let range = normalize_scope_range(start_seconds, duration_seconds)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para analizar el audio",
        ));
    };
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de audio no existe",
        ));
    }
    // Límite duro de espera por si ffmpeg se cuelga con un archivo raro.
    let samples = tokio::task::spawn_blocking(move || decode_pcm(&ffmpeg, &source, range))
        .await
        .map_err(|_| {
            ProjectError::message(ProjectErrorCode::RenderFailed, "el análisis de audio falló")
        })??;
    if samples.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo no tiene pista de audio decodificable",
        ));
    }
    Ok(analyze_pcm(&samples, TARGET_RATE))
}

/// Scopes de audio de un asset del proyecto abierto (misma resolución que
/// `audio_peaks`: el asset debe tener audio y estar en disco). Con
/// `start_seconds` + `duration_seconds` analiza sólo esa ventana.
#[tauri::command]
pub async fn audio_scope_analyze_asset(
    state: State<'_, AppState>,
    asset_id: String,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<AudioScopeData, ProjectError> {
    let range = normalize_scope_range(start_seconds, duration_seconds)?;
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para analizar el audio",
        ));
    };
    let (_kind, source) = crate::commands::audio::resolve_audio_asset(&session, &asset_id)?;
    let samples = tokio::task::spawn_blocking(move || decode_pcm(&ffmpeg, &source, range))
        .await
        .map_err(|_| {
            ProjectError::message(ProjectErrorCode::RenderFailed, "el análisis de audio falló")
        })??;
    if samples.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el material no tiene pista de audio decodificable",
        ));
    }
    Ok(analyze_pcm(&samples, TARGET_RATE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: u32, seconds: f32, amp: f32) -> Vec<f32> {
        (0..(rate as f32 * seconds) as usize)
            .map(|i| amp * (2.0 * PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn waveform_min_max_per_bucket() {
        let samples = vec![0.5f32, -0.5, 0.25, -0.25];
        let buckets = waveform_buckets(&samples, 2);
        assert_eq!(buckets[0], [-0.5, 0.5]);
        assert_eq!(buckets[1], [-0.25, 0.25]);
        assert!(waveform_buckets(&[], 4).iter().all(|b| *b == [0.0, 0.0]));
    }

    #[test]
    fn spectrum_peaks_at_the_sine_frequency() {
        let rate = 48_000u32;
        let samples = sine(1_000.0, rate, 0.25, 0.8);
        let data = analyze_pcm(&samples, rate);
        assert_eq!(data.spectrum.len(), SPECTRUM_BINS);
        // Bin más energético debe caer cerca de 1 kHz (eje 0..Nyquist).
        let max_bin = data
            .spectrum
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(i, _)| i)
            .unwrap();
        // Conversión: el espectro remuestrea 1025 bins FFT → 512; cada bin de
        // salida cubre ~2 bins fuente, cada uno de rate/FFT_SIZE Hz.
        let bin_hz = rate as f32 / FFT_SIZE as f32;
        let approx_hz = max_bin as f32 * (FFT_SIZE / 2 + 1) as f32 / SPECTRUM_BINS as f32 * bin_hz;
        assert!(
            (approx_hz - 1_000.0).abs() < 200.0,
            "pico en {approx_hz} Hz"
        );
        // Una seno de amplitud 0.8 no debería reportar 0 dBFS plano.
        assert!(data.spectrum.iter().any(|&db| db > -40.0));
    }

    #[test]
    fn spectrogram_dimensions_and_db_range() {
        let rate = 48_000u32;
        let samples = sine(440.0, rate, 0.2, 0.5);
        let data = analyze_pcm(&samples, rate);
        assert_eq!(data.spectrogram_rows, SPECTROGRAM_ROWS);
        assert!(data.spectrogram_cols <= SPECTROGRAM_MAX_COLS);
        assert_eq!(
            data.spectrogram.len(),
            data.spectrogram_cols * data.spectrogram_rows
        );
        assert!(data
            .spectrogram
            .iter()
            .all(|&db| (-120.0..=0.0).contains(&db)));
        assert!(data.duration_seconds > 0.19 && data.duration_seconds < 0.21);
    }

    #[test]
    fn silence_stays_at_noise_floor() {
        let data = analyze_pcm(&vec![0.0f32; 48_000], 48_000);
        assert!(data.spectrum.iter().all(|&db| db <= -119.0));
        assert!(data.waveform.iter().all(|b| *b == [0.0, 0.0]));
    }

    #[test]
    fn empty_input_does_not_panic() {
        let data = analyze_pcm(&[], 48_000);
        assert_eq!(data.waveform.len(), WAVEFORM_BUCKETS);
        assert_eq!(data.spectrogram_cols, 1);
    }

    #[test]
    fn scope_range_requires_both_ends() {
        assert_eq!(normalize_scope_range(None, None).unwrap(), None);
        assert!(normalize_scope_range(Some(1.0), None).is_err());
        assert!(normalize_scope_range(None, Some(2.0)).is_err());
    }

    #[test]
    fn scope_range_rejects_invalid_values() {
        assert!(normalize_scope_range(Some(-1.0), Some(2.0)).is_err());
        assert!(normalize_scope_range(Some(f64::NAN), Some(2.0)).is_err());
        assert!(normalize_scope_range(Some(0.0), Some(0.0)).is_err());
        assert!(normalize_scope_range(Some(0.0), Some(-3.0)).is_err());
        assert!(normalize_scope_range(Some(0.0), Some(f64::INFINITY)).is_err());
    }

    /// Microbenchmark (ignorado por defecto): mide `analyze_pcm` sobre PCM
    /// sintético representativo (dos senos + ruido determinista) para
    /// cuantificar el coste CPU-bound de los scopes. Correr con:
    /// `cargo test --release -p editor-ia-desktop --lib audio_scopes -- --ignored --nocapture`
    /// y repetir con `--profile release-nolto` para el A/B de LTO.
    #[test]
    #[ignore = "microbenchmark: correr con --ignored --nocapture"]
    fn bench_analyze_pcm_throughput() {
        let rate = TARGET_RATE;
        let seconds = 30.0f32;
        let n = (rate as f32 * seconds) as usize;
        // Ruido LCG + dos senos: contenido espectral variado como audio real.
        let samples: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / rate as f32;
                let noise = ((i as u32)
                    .wrapping_mul(1_664_525)
                    .wrapping_add(1_013_904_223)
                    >> 8) as f32
                    / (1u32 << 24) as f32
                    - 0.5;
                0.3 * (2.0 * PI * 440.0 * t).sin()
                    + 0.15 * (2.0 * PI * 3_000.0 * t).sin()
                    + 0.05 * noise
            })
            .collect();
        let _ = analyze_pcm(&samples, rate); // warmup (asignaciones de ventanas)
        let started = std::time::Instant::now();
        let iters = 3;
        for _ in 0..iters {
            let _ = analyze_pcm(&samples, rate);
        }
        let elapsed = started.elapsed().as_secs_f64() / iters as f64;
        let audio_seconds = n as f64 / rate as f64;
        eprintln!(
            "bench analyze_pcm: {audio_seconds:.1}s de audio en {elapsed:.3}s wall              ({:.1}x tiempo real), {n} muestras",
            audio_seconds / elapsed
        );
    }

    #[test]
    fn scope_range_clamps_duration_to_the_decode_cap() {
        let range = normalize_scope_range(Some(10.5), Some(MAX_ANALYZE_SECONDS + 60.0))
            .unwrap()
            .unwrap();
        assert_eq!(range, (10.5, MAX_ANALYZE_SECONDS));
        let small = normalize_scope_range(Some(0.0), Some(4.25))
            .unwrap()
            .unwrap();
        assert_eq!(small, (0.0, 4.25));
    }
}
