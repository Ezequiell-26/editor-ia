//! Medición de loudness BS.1770-4 / EBU R128 — dominio puro.
//!
//! `LoudnessMeter` de `filmcraft-audio-dsp` implementa el filtro K, las
//! ventanas momentary (400 ms) y short-term (3 s), el integrated con doble
//! compuerta y el rango LRA según especificación. Aquí vive la alimentación
//! del medidor desde PCM f32le, el historial para la UI, el reporte y el
//! parseo del JSON de `loudnorm`. Los comandos en
//! `commands/domains/audio/loudness.rs` resuelven sesión, perfil, herramientas
//! y spawn de FFmpeg.

use std::io::Read;

use filmcraft_audio_dsp::LoudnessMeter;
use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Piso de la escala EBU: por debajo de −70 LUFS no hay señal útil y los −inf
/// del medidor no son serializables como número JSON.
pub(crate) const LUFS_FLOOR: f64 = -70.0;
pub(crate) const DB_FLOOR: f64 = -120.0;
/// Historial máximo devuelto a la UI (10 muestras/s ⇒ 2 minutos al detalle;
/// más largo se diezma manteniendo siempre la última muestra).
pub(crate) const MAX_HISTORY: usize = 1200;
/// Frecuencia de eventos de progreso: uno cada 500 ms de audio medido.
pub(crate) const EMIT_EVERY: usize = 5;

pub(crate) fn floor_lufs(value: f64) -> f64 {
    if value.is_finite() {
        value.max(LUFS_FLOOR)
    } else {
        LUFS_FLOOR
    }
}

pub(crate) fn floor_db(value: f64) -> f64 {
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
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect()
}

/// Lee PCM f32le intercalado y alimenta el medidor por sub-bloques de 100 ms
/// (el paso exacto al que BS.1770 evalúa las ventanas). Cada sub-bloque agrega
/// una muestra al historial; `on_sample` recibe `(segundos, momentary,
/// short_term, porcentaje)` para que la UI muestre avance.
pub(crate) fn run_meter_over_pcm<R: Read>(
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

pub(crate) fn build_report(
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

/// Loudness medido sobre un archivo ya renderizado.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLoudness {
    pub integrated_lufs: f64,
    pub true_peak_db: f64,
    pub lra_lu: f64,
}

/// Extrae el bloque JSON que imprime `loudnorm=print_format=json`.
pub(crate) fn parse_loudnorm_json(stderr: &str) -> Option<FileLoudness> {
    let start = stderr.rfind('{')?;
    let end = stderr[start..].find('}')? + start;
    let value: serde_json::Value = serde_json::from_str(&stderr[start..=end]).ok()?;
    let number = |key: &str| {
        value
            .get(key)
            .and_then(|item| item.as_str())
            .and_then(|text| text.parse::<f64>().ok())
    };
    Some(FileLoudness {
        integrated_lufs: floor_lufs(number("input_i")?),
        true_peak_db: floor_db(number("input_tp")?),
        lra_lu: number("input_lra").unwrap_or(0.0),
    })
}

#[cfg(test)]
#[path = "loudness.tests.rs"]
mod tests;
