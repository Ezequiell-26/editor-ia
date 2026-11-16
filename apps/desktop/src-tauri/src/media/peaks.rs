//! Picos de audio para la onda de la timeline: DTOs IPC, clamp de buckets,
//! parsing del sondeo ffprobe y el reductor puro muestra→pares min/max.
//! La decodificación PCM (spawn de FFmpeg) queda en `commands::audio`.

use serde::Serialize;

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
pub const MAX_BUCKETS: u32 = 4000;
pub const MIN_BUCKETS: u32 = 16;

pub fn clamp_buckets(requested: u32) -> u32 {
    requested.clamp(MIN_BUCKETS, MAX_BUCKETS)
}

/// Parsea la salida JSON de `ffprobe -show_entries stream=sample_rate,duration`
/// y devuelve `(duration_seconds, sample_rate)` con defaults seguros.
pub fn parse_audio_probe(text: &str) -> (f64, f64) {
    let value: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
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
    (duration, rate)
}

/// Reduce muestras f32 a pares min/max por bucket sin guardar el PCM.
/// `push` devuelve `false` cuando se alcanzó `max_buckets` y hay que cortar.
pub struct PeakReducer {
    per_bucket: f64,
    max_buckets: u32,
    current: PeakPair,
    in_bucket: usize,
    peaks: Vec<PeakPair>,
}

impl PeakReducer {
    pub fn new(per_bucket: f64, max_buckets: u32) -> Self {
        Self {
            per_bucket: per_bucket.max(1.0),
            max_buckets,
            current: PeakPair { min: 0.0, max: 0.0 },
            in_bucket: 0,
            peaks: Vec::new(),
        }
    }

    /// `true` mientras se puedan seguir empujando muestras.
    pub fn push(&mut self, sample: f32) -> bool {
        if !sample.is_finite() {
            return true;
        }
        if in_bucket_is_first(self.in_bucket) {
            self.current = PeakPair {
                min: sample,
                max: sample,
            };
        } else {
            self.current.min = self.current.min.min(sample);
            self.current.max = self.current.max.max(sample);
        }
        self.in_bucket += 1;
        if self.in_bucket as f64 >= self.per_bucket {
            self.peaks.push(self.current);
            self.in_bucket = 0;
            if self.peaks.len() as u32 >= self.max_buckets {
                return false;
            }
        }
        true
    }

    /// Cierra el bucket parcial y devuelve los pares acumulados.
    pub fn finish(mut self) -> Vec<PeakPair> {
        if self.in_bucket > 0 {
            self.peaks.push(self.current);
        }
        self.peaks
    }
}

fn in_bucket_is_first(in_bucket: usize) -> bool {
    in_bucket == 0
}

#[cfg(test)]
#[path = "peaks.tests.rs"]
mod tests;
