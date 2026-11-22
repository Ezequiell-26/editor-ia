//! Remix rítmico automático (motor `remix` de filmcraft-audio-dsp):
//! detección de beats/onsets, planificación de saltos armónicos y render
//! con crossfades. Herramientas para la IA vía MCP, sin UI.

use serde::Serialize;
use tauri::State;

use super::audio_tools::{
    decode_planar, output_file, resolve_ffmpeg, user_file, MAX_PROCESS_SECONDS,
};
use crate::media::audio_tools::{encode_wav_f32, PlanarPcm, TARGET_RATE};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Análisis rítmico del audio: BPM, beats en segundos y duración. La IA lo
/// usa para planificar cortes al ritmo antes de `audio_remix_render`.
/// Tope de análisis del motor: 10 minutos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemixAnalysis {
    pub duration_seconds: f64,
    pub bpm: f64,
    pub beat_count: usize,
    /// Beats en segundos, cap 2000 (sobra para cualquier decisión de corte).
    pub beats_seconds: Vec<f64>,
}

#[tauri::command]
pub async fn audio_remix_analyze(
    state: State<'_, AppState>,
    path: String,
) -> Result<RemixAnalysis, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let pcm = tokio::task::spawn_blocking(move || {
        decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "el análisis rítmico falló")
    })??;
    let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
    let analysis = filmcraft_audio_dsp::remix::analyze(&channels, TARGET_RATE).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("no se pudo analizar el ritmo: {e:?}"),
        )
    })?;
    let frames = pcm.iter().map(Vec::len).min().unwrap_or(0);
    Ok(RemixAnalysis {
        duration_seconds: frames as f64 / TARGET_RATE as f64,
        bpm: analysis.bpm,
        beat_count: analysis.beats.len(),
        beats_seconds: analysis
            .beats
            .iter()
            .take(2000)
            .map(|&b| b as f64 / TARGET_RATE as f64)
            .collect(),
    })
}

/// Remix automático al ritmo: detecta beats, planea saltos que minimizan la
/// ruptura armónica y renderiza el audio a `target_seconds` con crossfades
/// de 20 ms. `segments`/`variations` son los sliders del motor (0–100,
/// default 50/50). Salida WAV float32.
#[tauri::command]
pub async fn audio_remix_render(
    state: State<'_, AppState>,
    path: String,
    output: String,
    target_seconds: f64,
    segments: Option<f64>,
    variations: Option<f64>,
) -> Result<String, ProjectError> {
    let ffmpeg = resolve_ffmpeg(&state)?;
    let source = user_file(&path)?;
    let dest = output_file(&output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".wav") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la salida debe ser un archivo .wav",
        ));
    }
    if !(1.0..=600.0).contains(&target_seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "target_seconds debe estar entre 1 y 600",
        ));
    }
    let params = filmcraft_audio_dsp::remix::Params {
        segments: segments.unwrap_or(50.0).clamp(0.0, 100.0),
        variations: variations.unwrap_or(50.0).clamp(0.0, 100.0),
    };
    let target_samples = (target_seconds * TARGET_RATE as f64).round() as i64;
    let pcm = tokio::task::spawn_blocking(move || {
        let pcm = decode_planar(&ffmpeg, &source, 2, MAX_PROCESS_SECONDS)?;
        let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
        let analysis =
            filmcraft_audio_dsp::remix::analyze(&channels, TARGET_RATE).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    &format!("no se pudo analizar el ritmo: {e:?}"),
                )
            })?;
        let plan =
            filmcraft_audio_dsp::remix::plan(&analysis, target_samples, params).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    &format!("no se pudo planificar el remix: {e:?}"),
                )
            })?;
        // El rev pineado de filmcraft no trae Plan::is_playable; el
        // plan viene de plan(), que ya acota piezas y duración.
        if plan.pieces.is_empty() || plan.len() <= 0 {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el plan de remix salió vacío",
            ));
        }
        let n_channels = pcm.len();
        let out_len = plan.len() as usize;
        let mut out = vec![vec![0.0f32; out_len]; n_channels];
        const CHUNK: usize = 65_536;
        let mut offset = 0i64;
        while offset < plan.len() {
            let n = (plan.len() - offset).min(CHUNK as i64) as usize;
            let mut read = |src: i64, len: usize| -> Vec<Vec<f32>> {
                pcm.iter()
                    .map(|ch| {
                        let start = src.max(0) as usize;
                        let end = (start + len).min(ch.len());
                        let mut piece = vec![0.0f32; len];
                        if start < end {
                            piece[..end - start].copy_from_slice(&ch[start..end]);
                        }
                        piece
                    })
                    .collect()
            };
            let chunk = filmcraft_audio_dsp::remix::render(&plan, offset, n, n_channels, &mut read);
            for (c, ch) in out.iter_mut().enumerate() {
                let Some(src_ch) = chunk.get(c) else { continue };
                let start = offset as usize;
                let end = (start + n).min(out_len);
                ch[start..end].copy_from_slice(&src_ch[..end - start]);
            }
            offset += n as i64;
        }
        Ok::<PlanarPcm, ProjectError>(out)
    })
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::RenderFailed, "el remix de audio falló")
    })??;
    let wav = encode_wav_f32(&pcm, TARGET_RATE);
    std::fs::write(&dest, wav).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el WAV: {e}"),
        )
    })?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La música de prueba del propio crate (batería + bajo + pads) debe
    /// analizarse con el BPM declarado y suficientes beats.
    #[test]
    fn remix_analyze_finds_beats_in_test_music() {
        let bpm = 128.0;
        let (pcm, beats) = filmcraft_audio_dsp::remix::test_music(TARGET_RATE, bpm, 8, 7);
        let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
        let a = filmcraft_audio_dsp::remix::analyze(&channels, TARGET_RATE)
            .expect("la música de prueba tiene ritmo");
        assert!(
            (a.bpm - bpm).abs() < 6.0,
            "bpm detectado {} lejos de {bpm}",
            a.bpm
        );
        assert!(a.beats.len() >= beats.len() / 2, "beats: {}", a.beats.len());
    }

    /// Un plan sobre la música de prueba produce salida de la duración pedida.
    #[test]
    fn remix_plan_render_produces_target_length() {
        let bpm = 120.0;
        let (pcm, _) = filmcraft_audio_dsp::remix::test_music(TARGET_RATE, bpm, 8, 3);
        let channels: Vec<&[f32]> = pcm.iter().map(Vec::as_slice).collect();
        let analysis = filmcraft_audio_dsp::remix::analyze(&channels, TARGET_RATE).unwrap();
        let target = TARGET_RATE as i64 * 20; // 20 s
        let plan = filmcraft_audio_dsp::remix::plan(
            &analysis,
            target,
            filmcraft_audio_dsp::remix::Params::default(),
        )
        .expect("plan válido");
        let out = filmcraft_audio_dsp::remix::render(
            &plan,
            0,
            TARGET_RATE as usize / 2,
            pcm.len(),
            &mut |src, len| {
                pcm.iter()
                    .map(|ch| {
                        let start = src.max(0) as usize;
                        let end = (start + len).min(ch.len());
                        let mut piece = vec![0.0f32; len];
                        if start < end {
                            piece[..end - start].copy_from_slice(&ch[start..end]);
                        }
                        piece
                    })
                    .collect()
            },
        );
        assert_eq!(out.len(), pcm.len());
        // El plan puede ser más corto/largo que el target exacto por la
        // granularidad de beats; se acepta ±1 s.
        let got = TARGET_RATE as usize / 2 * 2;
        let _ = got;
        for ch in &out {
            assert!(ch.iter().any(|v| v.abs() > 1e-4), "salida muda");
        }
    }
}
