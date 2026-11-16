//! Scopes de audio al estilo Kdenlive (`src/scopes/audioscopes/`):
//! oscilograma (min/max por bucket), espectro promedio y espectrograma,
//! calculados en Rust con el FFT de `filmcraft-audio-dsp` sobre PCM f32le
//! mono. La UI dibuja el JSON resultante en canvas.
//!
//! Todo el cálculo vive en funciones puras testeables (`analyze_pcm`); el
//! comando `audio_scope_analyze*` sólo decodifica con FFmpeg y delega.

use serde::Serialize;
use std::f32::consts::PI;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Tamaño de ventana FFT (potencia de 2). 2048 @ 48 kHz ≈ 42 ms por columna.
pub const FFT_SIZE: usize = 2048;
pub const SPECTRUM_BINS: usize = 512;
pub const SPECTROGRAM_ROWS: usize = 256;
pub const SPECTROGRAM_MAX_COLS: usize = 384;
pub const WAVEFORM_BUCKETS: usize = 512;
/// Tope de audio analizado por llamada: 90 s @ 48 kHz mono f32 ≈ 69 MB PCM.
pub const MAX_ANALYZE_SECONDS: f64 = 90.0;
pub const TARGET_RATE: u32 = 48_000;

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

pub fn decode_f32_le(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
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
    let cols = windows.len().clamp(1, SPECTROGRAM_MAX_COLS);
    let col_step = windows.len() as f64 / cols as f64;
    let mut spectrogram = Vec::with_capacity(cols * SPECTROGRAM_ROWS);
    for col in 0..cols {
        let src = ((col as f64 * col_step) as usize).min(windows.len() - 1);
        for freq_row in &freq_rows {
            spectrogram.push(to_db(freq_row[src]));
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
/// Valida la ventana opcional de análisis. `start` y `duration` van juntos;
/// la duración se acota al tope de `MAX_ANALYZE_SECONDS`.
pub fn normalize_scope_range(
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

#[cfg(test)]
#[path = "audio_scope.tests.rs"]
mod tests;
