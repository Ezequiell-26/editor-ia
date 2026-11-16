// SPDX-License-Identifier: AGPL-3.0-or-later
// Concat es AGPL-3.0-or-later (ver vendor/concat/LICENSE).

//! Operaciones del worker sobre `concat-media`.
//!
//! Cada op devuelve el payload JSON de su respuesta; `protocol::respond`
//! les agrega el envelope `ok`/`error`. Los tipos de concat-core no son
//! serde: acá se traducen a mano a campos JSON estables para la app.

use std::path::{Path, PathBuf};

use concat_core::frame::{Depth, Frame, Signal};
use concat_core::time::Rational;
use concat_media::{ColorRange, DecodeOptions, Decoder, FrameSource};
use serde_json::{json, Value};

use crate::protocol::Request;

/// Ejecuta una request ya parseada. `Shutdown` responde ok vacío; el
/// caller decide cuándo cortar el loop.
pub fn dispatch(request: &Request) -> Result<Value, String> {
    match request {
        Request::Ping => Ok(json!({})),
        Request::Shutdown => Ok(json!({})),
        Request::Probe { path } => probe(path),
        Request::DecodeFrame {
            path,
            time,
            out,
            width,
            height,
            format,
            quality,
        } => decode_frame(path, time, out, *width, *height, format.as_deref(), *quality),
        Request::RenderExport(request) => crate::render_export::run(request),
        // Igual que render_export: el binario la corre en su hilo con
        // progreso y cancelación; acá va la forma síncrona para tests.
        Request::AnalyzeMotion(request) => crate::analyze_motion::run(request),
        // El loop principal intercepta `cancel` antes de llegar acá (ver
        // main.rs): responde un evento `cancel_ack` sin `ok` para no
        // pisar la respuesta del render en vuelo. Este brazo queda para
        // exhaustividad y tests: arma el mismo flag.
        Request::Cancel => {
            crate::render_export::request_cancel();
            Ok(json!({ "cancelled": true }))
        }
    }
}

/// `num/den` exacto; lo que un Rational es en el documento de Concat.
fn rational_json(value: Rational) -> Value {
    json!(format!("{}/{}", value.numerator(), value.denominator()))
}

/// Segundos `f64` para clientes que sólo quieren un número.
fn seconds_json(value: Rational) -> Value {
    json!(value.as_f64())
}

fn signal_json(signal: Signal) -> &'static str {
    match signal {
        Signal::Sdr => "sdr",
        Signal::SdrWide => "sdr_wide",
        Signal::Hlg => "hlg",
        Signal::Pq => "pq",
    }
}

/// `{"op":"probe"}`: lo que `concat_media::probe` sabe del archivo.
pub fn probe(path: &str) -> Result<Value, String> {
    let info = concat_media::probe(path).map_err(|error| error.to_string())?;

    let video = info.video.as_ref().map(|stream| {
        json!({
            "index": stream.index,
            "codec": stream.codec,
            "width": stream.width,
            "height": stream.height,
            "frame_rate": rational_json(stream.frame_rate.fps()),
            "frame_rate_fps": seconds_json(stream.frame_rate.fps()),
            "cadence": rational_json(stream.cadence.fps()),
            "cadence_fps": seconds_json(stream.cadence.fps()),
            "color_range": stream.color_range.map(ColorRange::name),
            "signal": signal_json(stream.signal),
            "keyframes": stream
                .keyframes
                .iter()
                .map(|at| rational_json(*at))
                .collect::<Vec<_>>(),
        })
    });
    let audio = info.audio.as_ref().map(|stream| {
        json!({
            "index": stream.index,
            "codec": stream.codec,
            "sample_rate": stream.sample_rate,
            "channels": stream.channels,
            "title": stream.title,
            "language": stream.language,
        })
    });
    let audio_streams = info
        .audio_streams
        .iter()
        .map(|stream| {
            json!({
                "index": stream.index,
                "codec": stream.codec,
                "sample_rate": stream.sample_rate,
                "channels": stream.channels,
                "title": stream.title,
                "language": stream.language,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "path": info.path,
        "duration": info.duration.map(|d| json!(rational_json(d))),
        "duration_seconds": info.duration.map(|d| seconds_json(d)),
        "video": video,
        "audio": audio,
        "audio_streams": audio_streams,
    }))
}

/// `{"op":"decode_frame"}`: un frame en `time`, escrito a `out`.
///
/// El decoder busca el primer frame en o después del instante pedido (seek
/// al keyframe anterior + decodificación exacta). Devuelve las dimensiones
/// reales escritas y el PTS del frame.
pub fn decode_frame(
    path: &str,
    time: &str,
    out: &str,
    width: Option<u32>,
    height: Option<u32>,
    format: Option<&str>,
    quality: Option<u8>,
) -> Result<Value, String> {
    let at = Rational::parse(time)
        .ok_or_else(|| format!("bad time {time:?}: use seconds, num/den or an integer"))?;

    let mut options = DecodeOptions::default().starting_at(at).limited_to(1);
    match (width, height) {
        (Some(w), Some(h)) => options = options.scaled_to(w, h),
        (None, None) => {}
        _ => return Err("width and height must be given together or not at all".to_owned()),
    }

    let mut decoder = Decoder::open(Path::new(path), &options).map_err(|e| e.to_string())?;
    let frame = decoder
        .next_frame()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no frame at or after the requested time".to_owned())?;
    let position = decoder.position();
    drop(decoder);

    if frame.depth() != Depth::Eight {
        return Err("deep (16-bit) frames are not written yet".to_owned());
    }

    let out_path = PathBuf::from(out);
    write_image(&out_path, &frame, format, quality)?;

    Ok(json!({
        "path": out_path,
        "width": frame.width(),
        "height": frame.height(),
        "position": position.map(|at| json!(rational_json(at))),
        "position_seconds": position.map(|at| json!(at.as_f64())),
    }))
}

/// PNG por defecto; JPEG si `format` lo pide o la extensión es `.jpg/.jpeg`.
fn write_image(
    out: &Path,
    frame: &Frame,
    format: Option<&str>,
    quality: Option<u8>,
) -> Result<(), String> {
    let wanted = match format.map(str::to_ascii_lowercase) {
        Some(f) => f,
        None => out
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .filter(|e| e == "jpg" || e == "jpeg" || e == "png")
            .unwrap_or_else(|| "png".to_owned()),
    };
    match wanted.as_str() {
        "png" => write_png(out, frame),
        "jpg" | "jpeg" => write_jpeg(out, frame, quality.unwrap_or(92)),
        other => Err(format!("unsupported image format {other:?} (png or jpeg)")),
    }
}

fn write_png(out: &Path, frame: &Frame) -> Result<(), String> {
    let file = std::fs::File::create(out)
        .map_err(|e| format!("create {}: {e}", out.display()))?;
    let mut encoder = png::Encoder::new(file, frame.width(), frame.height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|e| format!("png header: {e}"))?;
    writer
        .write_image_data(frame.pixels())
        .map_err(|e| format!("png data: {e}"))?;
    writer.finish().map_err(|e| format!("png finish: {e}"))
}

fn write_jpeg(out: &Path, frame: &Frame, quality: u8) -> Result<(), String> {
    let bytes = concat_media::jpeg(frame, quality).map_err(|e| e.to_string())?;
    std::fs::write(out, bytes).map_err(|e| format!("write {}: {e}", out.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../vendor/concat/crates/concat-media/fixtures/vfr-still-screen.mp4"
    );
    /// Fixture con video Y audio (64x64, 10 fps, ~4.7 s).
    const AV_FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../vendor/concat/crates/concat-media/fixtures/sound-behind-the-picture.mpg"
    );

    /// El camino real: request → dispatch → envelope con `ok`.
    fn round_trip(request: Value) -> Value {
        let line = serde_json::to_string(&request).expect("request serializes");
        let request = crate::protocol::parse(&line).expect("request parses");
        crate::protocol::respond(dispatch(&request))
    }

    #[test]
    fn probe_reports_video_and_audio_streams() {
        let value = round_trip(json!({ "op": "probe", "path": FIXTURE }));
        assert_eq!(value["ok"], true, "{value}");
        let video = &value["video"];
        assert!(video["width"].as_u64().unwrap() > 0, "{video}");
        assert!(video["codec"].as_str().is_some_and(|c| !c.is_empty()));
        assert!(value["duration_seconds"].as_f64().unwrap() > 0.0);
        // audio_streams existe aunque esté vacío.
        assert!(value["audio_streams"].is_array());
    }

    #[test]
    fn probe_missing_file_is_an_error_not_a_panic() {
        assert!(probe("definitely-not-here.mp4").is_err());
    }

    #[test]
    fn decode_frame_writes_a_real_png() {
        let out = std::env::temp_dir().join(format!("concat-worker-test-{}.png", std::process::id()));
        let value = round_trip(json!({
            "op": "decode_frame", "path": FIXTURE, "time": "1.0",
            "out": out.to_string_lossy(),
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["width"], value["height"]); // el fixture es cuadrado
        let bytes = std::fs::read(&out).expect("file written");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "PNG magic");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn decode_frame_rejects_half_a_scale_and_bad_time() {
        let out = std::env::temp_dir().join("unused.png");
        let out = out.to_str().unwrap();
        assert!(decode_frame(FIXTURE, "1", out, Some(64), None, None, None).is_err());
        assert!(decode_frame(FIXTURE, "abc", out, None, None, None, None).is_err());
    }

    #[test]
    fn render_export_writes_a_real_mp4() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-render-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [{ "path": FIXTURE, "duration": "1" }],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["frames"], 10, "{value}");
        assert_eq!(value["codec"], "h264", "{value}");
        // El archivo producido se puede reprobar: es un MP4 con video real.
        let probe = round_trip(json!({ "op": "probe", "path": out_str }));
        assert_eq!(probe["ok"], true, "{probe}");
        assert!(probe["video"]["width"].as_u64().unwrap() > 0, "{probe}");
        let _ = std::fs::remove_file(&out);
    }

    /// Dos clips con transición dissolve (5 frames a 10 fps = 0.5 s de
    /// ventana) y speed 3/2 en el primero: el MP4 sale y se reproba.
    #[test]
    fn render_export_writes_transitions_and_speed() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-xfade-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [
                { "path": FIXTURE, "duration": "1", "speed": "3/2" },
                { "path": FIXTURE, "duration": "1",
                  "transition": { "type": "dissolve", "frames": 5 } },
            ],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["frames"], 20, "{value}");
        assert_eq!(value["transitions"], 1, "{value}");
        let probe = round_trip(json!({ "op": "probe", "path": out_str }));
        assert_eq!(probe["ok"], true, "{probe}");
        assert!(probe["video"]["width"].as_u64().unwrap() > 0, "{probe}");
        let _ = std::fs::remove_file(&out);
    }

    /// Una transición wipeleft por duración en segundos también exporta.
    #[test]
    fn render_export_accepts_a_timed_wipe() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-wipe-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [
                { "path": FIXTURE, "duration": "1" },
                { "path": FIXTURE, "duration": "1",
                  "transition": { "type": "wipeleft", "duration": "0.4" } },
            ],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["transitions"], 1, "{value}");
        let _ = std::fs::remove_file(&out);
    }

    /// Los casos que el worker rechaza ANTES de escribir: transición en el
    /// primer clip, tipo desconocido, duración mayor que el clip, speed
    /// no positiva y ventanas de transición superpuestas.
    #[test]
    fn render_export_rejects_bad_transitions_and_speeds() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-bad-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let render = |clips: Value| {
            round_trip(json!({
                "op": "render_export", "output": out_str,
                "width": 64, "height": 64, "frame_rate": "10",
                "hardware": false, "clips": clips,
            }))
        };
        // Transición en el primer clip: no hay "anterior".
        let first = render(json!([
            { "path": FIXTURE, "duration": "1",
              "transition": { "type": "dissolve", "duration": "0.2" } },
            { "path": FIXTURE, "duration": "1" },
        ]));
        assert_eq!(first["ok"], false, "{first}");
        // Tipo que ninguna forma conoce.
        let unknown = render(json!([
            { "path": FIXTURE, "duration": "1" },
            { "path": FIXTURE, "duration": "1",
              "transition": { "type": "hlslice", "duration": "0.2" } },
        ]));
        assert_eq!(unknown["ok"], false, "{unknown}");
        // Transición más larga que el clip entrante.
        let too_long = render(json!([
            { "path": FIXTURE, "duration": "1" },
            { "path": FIXTURE, "duration": "0.3",
              "transition": { "type": "dissolve", "duration": "0.5" } },
        ]));
        assert_eq!(too_long["ok"], false, "{too_long}");
        // Speed cero / negativa.
        let zero = render(json!([
            { "path": FIXTURE, "duration": "1", "speed": 0 },
        ]));
        assert_eq!(zero["ok"], false, "{zero}");
        // Ventanas superpuestas: clip2 (start 1, dur 2, transición 1.5 →
        // ventana [1, 2.5)) y clip3 (start 2, transición 0.5 → [2, 2.5))
        // se pisan.
        let overlap = render(json!([
                { "path": FIXTURE, "duration": "1" },
                { "path": FIXTURE, "start": "1", "duration": "2",
                  "transition": { "type": "dissolve", "duration": "1.5" } },
                { "path": FIXTURE, "start": "2", "duration": "1",
                  "transition": { "type": "wipeleft", "duration": "0.5" } },
        ]));
        assert_eq!(overlap["ok"], false, "{overlap}");
        // Y ningún intento dejó archivo.
        assert!(!out.exists());
    }

    /// `speed_curve` retime el clip por la integral de la curva: el MP4
    /// sale, cuenta la curva en la respuesta y se reproba.
    #[test]
    fn render_export_speed_curve_writes_a_real_mp4() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-curve-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [{
                "path": FIXTURE,
                "duration": "1",
                "speed_curve": [
                    { "at": 0.0, "speed": 0.5 },
                    { "at": 1.0, "speed": 1.5 }
                ]
            }],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["speed_curves"], 1, "{value}");
        assert_eq!(value["frames"], 10, "{value}");
        let probe = round_trip(json!({ "op": "probe", "path": out_str }));
        assert_eq!(probe["ok"], true, "{probe}");
        let _ = std::fs::remove_file(&out);
    }

    /// Una curva suave (slopes en todos los puntos) también exporta, y la
    /// duración default consume el medio a la velocidad media de la curva.
    #[test]
    fn render_export_eased_curve_and_default_duration() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-eased-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [{
                "path": FIXTURE,
                "speed_curve": [
                    { "at": 0.0, "speed": 1.0, "slope": 0.0 },
                    { "at": 0.5, "speed": 2.0, "slope": 0.0 },
                    { "at": 1.0, "speed": 1.0, "slope": 0.0 }
                ]
            }],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["speed_curves"], 1, "{value}");
        // Media 1.5 sobre 2.3 s de fuente ≈ 1.53 s de timeline ≈ 16 frames.
        let frames = value["frames"].as_u64().unwrap();
        assert!((14..=18).contains(&frames), "{value}");
        let _ = std::fs::remove_file(&out);
    }

    /// Curvas inválidas: lista vacía es error claro, no panic ni archivo.
    #[test]
    fn render_export_rejects_bad_speed_curves() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-badcurve-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let empty = round_trip(json!({
            "op": "render_export", "output": out_str,
            "width": 64, "height": 64, "frame_rate": "10",
            "clips": [{ "path": FIXTURE, "speed_curve": [] }],
        }));
        assert_eq!(empty["ok"], false, "{empty}");
        assert!(empty["error"].as_str().unwrap().contains("speed_curve"));
        assert!(!out.exists());
    }

    /// Dos clips con audio y transición dissolve: el crossfade por
    /// defecto mezcla fade out del saliente + fade in del entrante, y el
    /// MP4 sale con pista de audio.
    #[test]
    fn render_export_transition_crossfades_audio() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-xfade-audio-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [
                { "path": AV_FIXTURE, "duration": "1", "audio": true },
                { "path": AV_FIXTURE, "duration": "1", "audio": true,
                  "transition": { "type": "dissolve", "duration": "0.5" } },
            ],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["audio"], true, "{value}");
        assert_eq!(value["audio_crossfades"], 1, "{value}");
        let probe = round_trip(json!({ "op": "probe", "path": out_str }));
        assert_eq!(probe["ok"], true, "{probe}");
        assert!(probe["audio"].is_object(), "{probe}");
        // `audio_crossfade: false` apaga el fundido: los clips suenan
        // enteros y el corte es seco como antes.
        let dry = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [
                { "path": AV_FIXTURE, "duration": "1", "audio": true },
                { "path": AV_FIXTURE, "duration": "1", "audio": true,
                  "transition": { "type": "dissolve", "duration": "0.5",
                                  "audio_crossfade": false } },
            ],
        }));
        assert_eq!(dry["ok"], true, "{dry}");
        assert_eq!(dry["audio_crossfades"], 0, "{dry}");
        let _ = std::fs::remove_file(&out);
    }

    /// Speed curve + audio: el `tempo` del mixer sigue la curva (el
    /// `speed_curves` cuenta y el audio sale muxado).
    #[test]
    fn render_export_speed_curve_with_audio() {
        let out = std::env::temp_dir().join(format!(
            "concat-worker-test-curve-audio-{}.mp4",
            std::process::id()
        ));
        let out_str = out.to_string_lossy().into_owned();
        let value = round_trip(json!({
            "op": "render_export",
            "output": out_str,
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [{
                "path": AV_FIXTURE,
                "duration": "1",
                "audio": true,
                "speed_curve": [
                    { "at": 0.0, "speed": 0.5 },
                    { "at": 1.0, "speed": 1.5 }
                ]
            }],
        }));
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["speed_curves"], 1, "{value}");
        assert_eq!(value["audio"], true, "{value}");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn render_export_rejects_empty_clips_and_missing_files() {
        let out = std::env::temp_dir().join("unused.mp4");
        let out_str = out.to_string_lossy().into_owned();
        let empty = round_trip(json!({
            "op": "render_export", "output": out_str, "clips": [],
        }));
        assert_eq!(empty["ok"], false, "{empty}");
        let missing = round_trip(json!({
            "op": "render_export", "output": out_str,
            "clips": [{ "path": "definitely-not-here.mp4" }],
        }));
        assert_eq!(missing["ok"], false, "{missing}");
        // El archivo del usuario no se toca cuando el fallo es anterior al
        // encode: `out` no debe existir.
        assert!(!out.exists());
    }
}
