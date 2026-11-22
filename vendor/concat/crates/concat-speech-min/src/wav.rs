// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Olyvia

//! Minimal WAV reader for transcription input.
//!
//! Replaces `concat_media::AudioDecoder` for the speech-min crate: Olyvia's
//! FFmpeg pipeline hands over a WAV (or `transcribe_samples` hands over raw
//! `f32`), so only RIFF/WAVE is needed here. Reads PCM integer (8/16/24/32
//! bits), IEEE float (32/64 bits) and WAVE_FORMAT_EXTENSIBLE variants,
//! downmixes to mono by averaging, and resamples to 16 kHz mono `f32` by
//! linear interpolation - the rate whisper wants.
//!
//! `decode_window` reads only the part of the file the request covers,
//! skipping samples before `start` without decoding them.

use std::io::Read;
use std::path::Path;

/// The rate whisper hears at; also what `decode` always returns.
pub const SAMPLE_RATE: u32 = 16_000;

/// What a WAV file holds, enough to decode it.
struct Wave {
    /// Byte offset of the `data` chunk's payload.
    data_offset: u64,
    /// Payload size in bytes.
    data_len: u64,
    /// Samples per second as written.
    rate: u32,
    /// 1 = PCM integer, 3 = IEEE float, as in the fmt chunk.
    format: u16,
    /// Bits per sample.
    bits: u16,
    channels: u16,
}

fn fourcc(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..4]).into_owned()
}

/// Parses the RIFF header and fmt/data chunk positions. Chunks are walked
/// by their declared size (padded to even), so LIST/INFO metadata is skipped.
fn parse_wav(bytes: &[u8]) -> Result<Wave, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".to_owned());
    }
    let mut at = 12usize;
    let mut fmt: Option<(u16, u16, u32, u16)> = None; // format, channels, rate, bits
    let mut data: Option<(u64, u64)> = None;
    while at + 8 <= bytes.len() {
        let id = fourcc(&bytes[at..at + 4]);
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as u64;
        let body = at as u64 + 8;
        match id.as_str() {
            "fmt " => {
                if body as usize + size as usize > bytes.len() {
                    return Err("truncated fmt chunk".to_owned());
                }
                let b = &bytes[at + 8..at + 8 + size as usize];
                if b.len() < 16 {
                    return Err("fmt chunk too small".to_owned());
                }
                let format = u16::from_le_bytes([b[0], b[1]]);
                let channels = u16::from_le_bytes([b[2], b[3]]);
                let rate = u32::from_le_bytes([b[4], b[5], b[6], b[7]]);
                let bits = u16::from_le_bytes([b[14], b[15]]);
                // WAVE_FORMAT_EXTENSIBLE (0xFFFE): the real format tag is
                // the first two bytes of the SubFormat GUID at offset 24.
                let format = if format == 0xFFFE && b.len() >= 40 {
                    u16::from_le_bytes([b[24], b[25]])
                } else {
                    format
                };
                fmt = Some((format, channels, rate, bits));
            }
            "data" => {
                data = Some((body, size.min(bytes.len() as u64 - body)));
            }
            _ => {}
        }
        at += 8 + size as usize + (size as usize & 1);
    }
    let (format, channels, rate, bits) = fmt.ok_or_else(|| "no fmt chunk".to_owned())?;
    if channels == 0 || rate == 0 {
        return Err("fmt chunk has no channels or rate".to_owned());
    }
    let (data_offset, data_len) = data.ok_or_else(|| "no data chunk".to_owned())?;
    Ok(Wave {
        data_offset,
        data_len,
        rate,
        format,
        bits,
        channels,
    })
}

/// Reads the whole file, parses it, and decodes the window
/// `[start, start + duration)` seconds to 16 kHz mono `f32`.
/// `duration <= 0` means to the end of the sound.
pub fn decode_window(path: &Path, start: f64, duration: f64) -> Result<Vec<f32>, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    let len = file
        .metadata()
        .map_err(|error| format!("could not read {}: {error}", path.display()))?
        .len();
    // WAV headers are small; read it all - the data chunk follows and
    // decode reads on from there.
    let mut bytes = Vec::with_capacity(len.min(1024 * 1024) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let wave = parse_wav(&bytes)?;

    let channels = wave.channels as usize;
    let frame_bytes = channels * (wave.bits as usize / 8);
    if frame_bytes == 0 {
        return Err("fmt chunk has no payload".to_owned());
    }
    let frames_total = wave.data_len as usize / frame_bytes;
    let first_frame = ((start.max(0.0) * wave.rate as f64) as usize).min(frames_total);
    let last_frame = if duration > 0.0 {
        (((start + duration).max(0.0) * wave.rate as f64) as usize).min(frames_total)
    } else {
        frames_total
    };
    if last_frame <= first_frame {
        return Ok(Vec::new());
    }

    // Decode only the window's frames, straight out of the byte buffer.
    let mut mono = Vec::with_capacity(last_frame - first_frame);
    let data = &bytes[wave.data_offset as usize..];
    for frame in first_frame..last_frame {
        let at = frame * frame_bytes;
        if at + frame_bytes > data.len() {
            break;
        }
        let mut sum = 0.0f64;
        for channel in 0..channels {
            let off = at + channel * (wave.bits as usize / 8);
            sum += sample_at(&data[off..], wave.format, wave.bits)? as f64;
        }
        mono.push((sum / channels as f64) as f32);
    }
    Ok(resample(&mono, wave.rate, SAMPLE_RATE))
}

/// One sample at `bytes`, as an f32 in [-1, 1] (or the float's own scale).
fn sample_at(bytes: &[u8], format: u16, bits: u16) -> Result<f32, String> {
    Ok(match (format, bits) {
        (1, 8) => (bytes[0] as f32 - 128.0) / 128.0,
        (1, 16) => i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32768.0,
        (1, 24) => {
            let v = (bytes[0] as i32) | ((bytes[1] as i32) << 8) | ((bytes[2] as i32) << 16);
            let v = if v & 0x80_0000 != 0 {
                v | !0xFF_FFFF
            } else {
                v
            };
            v as f32 / 8_388_608.0
        }
        (1, 32) => i32::from_le_bytes(bytes[..4].try_into().unwrap()) as f32 / 2_147_483_648.0,
        (3, 32) => f32::from_le_bytes(bytes[..4].try_into().unwrap()),
        (3, 64) => f64::from_le_bytes(bytes[..8].try_into().unwrap()) as f32,
        _ => {
            return Err(format!(
                "unsupported WAV encoding: format {format}, {bits} bits"
            ));
        }
    })
}

/// Linear-interpolation resample from `from` Hz to `to` Hz. `from == to`
/// returns the input untouched.
fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let at = i as f64 * ratio;
        let base = at.floor() as usize;
        let frac = (at - base as f64) as f32;
        let a = samples[base.min(samples.len() - 1)];
        let b = samples[(base + 1).min(samples.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// Reads only the header: the file's rate, channels and length in seconds,
/// for a caller that wants to know what a WAV holds before decoding.
pub fn inspect(path: &Path) -> Result<(u32, u16, f64), String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    // Headers past a few KB are pathological; read enough for any chunk walk.
    let mut bytes = Vec::new();
    file.by_ref()
        .take(1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let wave = parse_wav(&bytes)?;
    let frame_bytes = wave.channels as usize * (wave.bits as usize / 8).max(1);
    let frames = wave.data_len as usize / frame_bytes.max(1);
    Ok((wave.rate, wave.channels, frames as f64 / wave.rate as f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a minimal PCM16 mono WAV at `rate` from `samples`.
    fn wav16(path: &Path, rate: u32, samples: &[i16]) {
        let data_len = (samples.len() * 2) as u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        std::fs::write(path, bytes).expect("write wav");
    }

    #[test]
    fn a_16khz_wav_decodes_to_the_same_samples() {
        let dir = std::env::temp_dir().join(format!("speech-min-wav-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tone.wav");
        let samples: Vec<i16> = (0..16_000).map(|i| ((i % 100) as i16 - 50) * 400).collect();
        wav16(&path, 16_000, &samples);
        let decoded = decode_window(&path, 0.0, 0.0).expect("decodes");
        assert_eq!(decoded.len(), 16_000);
        let close = |a: f32, b: i16| (a - b as f32 / 32768.0).abs() < 1e-4;
        assert!(decoded.iter().zip(&samples).all(|(a, b)| close(*a, *b)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_window_reads_only_its_span_and_other_rates_resample() {
        let dir = std::env::temp_dir().join(format!("speech-min-wav2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tone.wav");
        // 8 kHz, one second of a ramp; window 0.25..0.75 s -> 8000 samples at 16 kHz.
        let samples: Vec<i16> = (0..8_000).map(|i| i as i16 * 4).collect();
        wav16(&path, 8_000, &samples);
        let decoded = decode_window(&path, 0.25, 0.5).expect("decodes");
        assert_eq!(decoded.len(), 8_000);
        // The window's first sample is the source's at frame 2000.
        let expected = 2000f32 * 4.0 / 32768.0;
        assert!(
            (decoded[0] - expected).abs() < 1e-3,
            "{} vs {expected}",
            decoded[0]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
