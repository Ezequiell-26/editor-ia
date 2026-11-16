// SPDX-License-Identifier: AGPL-3.0-or-later
// Concat es AGPL-3.0-or-later (ver vendor/concat/LICENSE); este worker es
// parte del mismo trabajo derivado.

//! `{"op":"analyze_motion"}`: medición del movimiento de cámara de un
//! tramo de video, con `concat_vision::stabilize` (vendor/concat, SIN la
//! feature `infer`: no hay ONNX Runtime ni modelos — es puros píxeles).
//!
//! Es el equivalente acotado del `Stabilizers::analyse` de concat-host
//! (que no se vendoriza): decodifica el rango pedido a tamaño de análisis
//! (`ANALYSIS_SIDE` = 480 px de lado mayor), sigue el frame a frame con
//! `track::Tracker` (esquinas Shi-Tomasi → flujo óptico Lucas-Kanade
//! piramidal → ajuste RANSAC de una similitud) y registra cada frame en
//! un `Motion`.
//!
//! Con `project` el `Motion` vive en `motion_dir(project, path)`
//! (`<project>/cache/stabilize/<hash>-v1/motion`) y la corrida sólo mide
//! los rangos que `Motion::missing` reporta como no cubiertos — una
//! segunda llamada sobre el mismo tramo mide cero frames. Sin `project`
//! el `Motion` queda en memoria: la respuesta trae las mismas cifras y
//! nada se escribe.
//!
//! La respuesta incluye una `correction` de referencia calculada con
//! `path::correct` sobre el rango pedido a velocidad 1 y los defaults de
//! estabilización (`smoothness` 0.5, `max_zoom` 1.2 — los
//! `DEFAULT_STABILIZE_*` de concat-project): `shake` es el RMS del
//! desvío del camino suave como fracción de la altura del frame, `zoom`
//! el zoom que la corrección usaría y `needed` el que haría falta sin
//! el tope. Es una métrica, no una corrección aplicada: el render que la
//! consuma es trabajo posterior.

use std::path::Path;

use concat_core::frame::Depth;
use concat_core::time::Rational;
use concat_media::{DecodeOptions, Decoder, FrameSource};
use concat_vision::stabilize::path::{self, Settings};
use concat_vision::stabilize::track::{Gray, Measured, Tracker};
use concat_vision::stabilize::{
    ANALYSIS_SIDE, FrameMotion, Motion, Similarity, Step, motion_dir,
};
use serde_json::{json, Value};

use crate::protocol::AnalyzeMotionRequest;

/// Defaults de corrección de referencia: los `DEFAULT_STABILIZE_*` de
/// concat-project (`smoothness` 0.5, `max_zoom` 1.2) pasados al `Settings`
/// de concat-vision, que es otro tipo con los mismos campos.
fn reference_settings() -> Settings {
    Settings {
        smoothness: 0.5,
        max_zoom: 1.2,
        tripod: false,
        keep_rotation: false,
    }
}

/// Ejecuta `analyze_motion`. Devuelve el payload JSON de la respuesta.
///
/// Sin callback ni cancelación fina: es la forma que usan los tests y
/// `ops::dispatch`. El binario usa `run_with_progress`, que corre en su
/// propio hilo para que el loop principal siga leyendo `cancel`.
pub fn run(request: &AnalyzeMotionRequest) -> Result<Value, String> {
    run_with_progress(request, &mut |_| {})
}

/// Como `run`, pero reporta eventos `{"type":"analyze_motion_progress",
/// "phase":"track", "percent":…}` SIN `ok` y aborta limpio cuando
/// `{"op":"cancel"}` armó el flag compartido: `Err("analyze_motion
/// cancelled")`. Lo medido hasta ahí ya quedó mergeado y escrito en el
/// cache (si hay `project`), como en concat-host.
pub fn run_with_progress(
    request: &AnalyzeMotionRequest,
    emit: &mut dyn FnMut(&Value),
) -> Result<Value, String> {
    // Mismo flag que `render_export`: hay a lo sumo una op larga a la vez
    // (LONG_ACTIVE en main.rs), así que un cancel siempre apunta a ésta.
    crate::render_export::clear_cancel();

    let info =
        concat_media::probe(&request.path).map_err(|e| format!("probe {}: {e}", request.path))?;
    if info.video.is_none() {
        return Err(format!("{}: no video stream to measure", request.path));
    }

    let from = match &request.from {
        Some(text) => parse_seconds(text, "from")?,
        None => 0.0,
    };
    let to = match &request.to {
        Some(text) => parse_seconds(text, "to")?,
        None => info
            .duration
            .map(|duration| duration.as_f64())
            .ok_or_else(|| {
                format!(
                    "{}: sin `to` y el probe no reportó duración: hay que darlo",
                    request.path
                )
            })?,
    };
    if from < 0.0 || to <= from {
        return Err(format!(
            "{}: rango inválido from={from} to={to}",
            request.path
        ));
    }

    let (width, height) = analysis_size(request, &info)?;
    let dir = request
        .project
        .as_deref()
        .map(|project| motion_dir(Path::new(project), &request.path));

    // El cache existente (si hay `project`): sólo se mide lo que falta.
    let mut motion = dir
        .as_ref()
        .and_then(|dir| Motion::read(dir))
        .map(|motion| (*motion).clone())
        .unwrap_or_default();
    if motion.aspect <= 0.0 {
        motion.aspect = f64::from(width) / f64::from(height);
    }
    let wanted: Vec<(f64, f64)> = match &dir {
        Some(_) => motion.missing(&[(from, to)]),
        None => vec![(from, to)],
    };
    let total_seconds: f64 = wanted.iter().map(|(a, b)| b - a).sum();

    let mut measured = 0usize;
    let mut done_seconds = 0.0;
    let mut tracker = Tracker::new();
    emit(&json!({
        "type": "analyze_motion_progress",
        "phase": "track",
        "percent": 0.0,
        "frames": 0,
    }));

    for &(range_from, range_to) in &wanted {
        // Un poco antes del rango, como concat-host: el primer frame del
        // tramo queda medido contra el anterior cuando existe y la
        // cobertura se empalma con lo ya cacheado.
        let lead = (range_from - 0.1).max(0.0);
        let options = DecodeOptions::default()
            .starting_at(Rational::approximate(lead).unwrap_or(Rational::ZERO))
            .scaled_to(width, height);
        let mut decoder = Decoder::open(Path::new(&request.path), &options)
            .map_err(|error| format!("{}: {error}", request.path))?;
        tracker.reset();
        let mut run: Vec<FrameMotion> = Vec::new();
        let mut reached = range_from;
        let mut cancelled = false;
        loop {
            if crate::render_export::cancel_requested() {
                cancelled = true;
                break;
            }
            let Some(frame) = decoder.next_frame().map_err(|error| error.to_string())? else {
                // El archivo se agotó antes de `to`: lo medido es lo que
                // hay y el resto cuenta como cubierto para no repedirlo.
                reached = range_to;
                break;
            };
            if frame.depth() != Depth::Eight {
                return Err(format!(
                    "{}: frames de 16 bits (HDR) no se analizan todavía",
                    request.path
                ));
            }
            let at = decoder
                .position()
                .map(|position| position.as_f64())
                .unwrap_or_else(|| run.last().map_or(lead, |last| last.at + 1.0 / 30.0));
            let (step, movement) = match tracker.push(Gray::of_frame(&frame)) {
                Measured::First => (Step::Start, Similarity::IDENTITY),
                Measured::Moved(similarity) => (Step::Tracked, similarity),
                Measured::Flat => (Step::Flat, Similarity::IDENTITY),
            };
            run.push(FrameMotion {
                at,
                step,
                motion: movement,
            });
            measured += 1;
            reached = at.min(range_to);
            let percent = if total_seconds > 0.0 {
                ((done_seconds + (reached - range_from).max(0.0)) / total_seconds)
                    .clamp(0.0, 1.0)
            } else {
                0.0
            };
            emit(&json!({
                "type": "analyze_motion_progress",
                "phase": "track",
                "percent": percent,
                "frames": measured,
            }));
            if at >= range_to {
                break;
            }
        }
        if let Some(first) = run.first() {
            let span = (first.at.min(range_from), if cancelled { reached } else { range_to });
            motion.merge(&run, span);
            if let Some(dir) = &dir {
                motion.write(dir)?;
            }
        } else if !cancelled {
            // Nada que leer en el rango (archivo más corto que `from`).
            motion.merge(&[], (range_from, range_to));
            if let Some(dir) = &dir {
                motion.write(dir)?;
            }
        }
        if cancelled {
            return Err("analyze_motion cancelled".to_owned());
        }
        done_seconds += range_to - range_from;
    }

    // La corrección de referencia sobre el rango pedido: métrica del
    // resultado, no una corrección aplicada al video.
    let correction = path::correct(&motion, (from, to), 1.0, &reference_settings());

    Ok(json!({
        "path": request.path,
        "motion_dir": dir,
        "measured": measured,
        "stored_frames": motion.frames.len(),
        "covered": motion
            .covered
            .iter()
            .map(|(a, b)| json!([a, b]))
            .collect::<Vec<_>>(),
        "interval": motion.interval(),
        "aspect": motion.aspect,
        "correction": {
            "shake": correction.shake,
            "zoom": correction.zoom,
            "needed": correction.needed,
            "empty": correction.is_empty(),
        },
    }))
}

/// Segundos `f64` desde un string de tiempo (`"1.5"`, `"3/2"`, `"2"`).
fn parse_seconds(text: &str, what: &str) -> Result<f64, String> {
    let value = Rational::parse(text)
        .ok_or_else(|| format!("bad {what} {text:?}: use seconds, num/den or an integer"))?;
    let seconds = value.as_f64();
    if !seconds.is_finite() {
        return Err(format!("bad {what} {text:?}: not a finite time"));
    }
    Ok(seconds)
}

/// Tamaño al que se decodifica el análisis: el pedido, o el lado mayor a
/// `ANALYSIS_SIDE` conservando el aspecto (ambos lados pares, mínimo 16).
fn analysis_size(
    request: &AnalyzeMotionRequest,
    info: &concat_media::MediaInfo,
) -> Result<(u32, u32), String> {
    if let (Some(width), Some(height)) = (request.width, request.height) {
        if width == 0 || height == 0 {
            return Err(format!("{}: width/height must be positive", request.path));
        }
        return Ok((width, height));
    }
    if request.width.is_some() != request.height.is_some() {
        return Err("width and height must be given together or not at all".to_owned());
    }
    let (width, height) = match info.video.as_ref() {
        Some(video) => (video.width, video.height),
        None => {
            let decoder = Decoder::open(
                Path::new(&request.path),
                &DecodeOptions::default().limited_to(1),
            )
            .map_err(|error| format!("{}: {error}", request.path))?;
            (decoder.width(), decoder.height())
        }
    };
    if width == 0 || height == 0 {
        return Err(format!("{}: no picture to measure", request.path));
    }
    let longest = width.max(height);
    let scale = (f64::from(ANALYSIS_SIDE) / f64::from(longest)).min(1.0);
    let even = |side: u32| (((f64::from(side) * scale).round() as u32).max(16)) & !1;
    Ok((even(width), even(height)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    /// Fixture con video (64x64, 10 fps, ~4.7 s).
    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../vendor/concat/crates/concat-media/fixtures/sound-behind-the-picture.mpg"
    );

    fn request(extra: Value) -> AnalyzeMotionRequest {
        let mut base = json!({ "path": FIXTURE });
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        serde_json::from_value(base).expect("request parses")
    }

    fn temp_project(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "concat-worker-motion-{tag}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn analyzes_a_range_in_memory_without_writing() {
        let result = run(&request(json!({ "from": "0", "to": "1" }))).expect("analysis");
        assert!(result["measured"].as_u64().unwrap() > 0, "{result}");
        assert!(result["motion_dir"].is_null(), "{result}");
        assert!(result["covered"].as_array().unwrap().len() >= 1, "{result}");
        assert!(result["correction"]["shake"].as_f64().is_some(), "{result}");
    }

    #[test]
    fn project_cache_measures_once_then_is_a_no_op() {
        let project = temp_project("cache");
        let first = run(&request(json!({
            "from": "0", "to": "1", "project": project.to_string_lossy(),
        })))
        .expect("first analysis");
        let measured = first["measured"].as_u64().unwrap();
        assert!(measured > 0, "{first}");
        let dir = first["motion_dir"].as_str().unwrap().to_owned();
        assert!(Path::new(&dir).join("motion").is_file(), "motion file in {dir}");

        // Segunda corrida sobre el mismo tramo: nada que medir.
        let second = run(&request(json!({
            "from": "0", "to": "1", "project": project.to_string_lossy(),
        })))
        .expect("second analysis");
        assert_eq!(second["measured"], 0, "{second}");
        assert_eq!(second["stored_frames"], first["stored_frames"], "{second}");

        let _ = std::fs::remove_dir_all(&project);
    }

    #[test]
    fn rejects_bad_ranges_and_missing_video() {
        assert!(run(&request(json!({ "from": "abc", "to": "1" }))).is_err());
        assert!(run(&request(json!({ "from": "2", "to": "1" }))).is_err());
        assert!(run(&request(json!({ "width": 64 }))).is_err());
        assert!(run(&AnalyzeMotionRequest {
            path: FIXTURE.replace("sound-behind-the-picture.mpg", "nope.mp4"),
            from: None,
            to: None,
            project: None,
            width: None,
            height: None,
        })
        .is_err());
    }

    #[test]
    fn cancel_aborts_the_analysis() {
        let mut cancel_sent = false;
        let result = run_with_progress(
            &request(json!({ "from": "0", "to": "30" })),
            &mut |event| {
                if event["type"] == "analyze_motion_progress" && !cancel_sent {
                    cancel_sent = true;
                    crate::render_export::request_cancel();
                }
            },
        );
        let error = result.err().expect("cancel must abort");
        assert!(error.contains("cancel"), "{error}");
    }
}
