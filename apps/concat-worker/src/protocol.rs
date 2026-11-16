// SPDX-License-Identifier: AGPL-3.0-or-later
// Concat es AGPL-3.0-or-later (ver vendor/concat/LICENSE); este worker es
// parte del mismo trabajo derivado.

//! Protocolo JSON-lines del concat-worker.
//!
//! Cada request es una línea `{"op": "...", ...}` por stdin; cada respuesta
//! es una línea `{"ok": true, ...}` o `{"ok": false, "error": "..."}` por
//! stdout. Nunca se escribe nada más en stdout: los crates vendorados
//! escriben sus propios logs por `log` (stderr si hay logger).

use serde::Deserialize;
use serde_json::{json, Value};

/// Una request, tal como llega por stdin.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    /// Healthcheck: responde `{"ok":true}` sin tocar medios.
    Ping,
    /// Cierre limpio: el proceso responde y sale al terminar la línea.
    Shutdown,
    /// Metadata del archivo: duración, streams de video/audio.
    Probe {
        /// Ruta del archivo de medio.
        path: String,
    },
    /// Un frame RGBA en un instante dado, escrito a disco como PNG o JPEG.
    DecodeFrame {
        /// Ruta del archivo de medio.
        path: String,
        /// Instante a decodificar: `"1.5"`, `"30000/1001"` o `"2"`.
        time: String,
        /// Dónde escribir la imagen (`.png`, `.jpg`/`.jpeg` elige formato;
        /// `format` lo pisa).
        out: String,
        /// Escala de salida; van juntas o ninguna.
        width: Option<u32>,
        /// Ver `width`.
        height: Option<u32>,
        /// `"png"` (default) o `"jpeg"`.
        format: Option<String>,
        /// Calidad JPEG 1..=100 (default 92). Ignorada en PNG.
        quality: Option<u8>,
    },
    /// Exporta una composición simple a un archivo de video.
    ///
    /// `clips` se reproducen en orden sobre un canvas `width`x`height`; cada
    /// clip decide su ventana `[start, start+duration)` y su rectángulo de
    /// destino. Sin `concat-project` ni GPU: el muestreo es CPU (ver
    /// `render_export.rs` para el alcance exacto).
    RenderExport(ExportRequest),
    /// Mide el movimiento de cámara de un tramo de video.
    ///
    /// Decodifica el rango a tamaño de análisis y corre el tracking de
    /// `concat_vision::stabilize` (Lucas-Kanade + RANSAC, aritmética
    /// pura — sin ONNX ni modelos). Con `project` el resultado se
    /// cachea en `<project>/cache/stabilize/<hash>-v1/motion` y las
    /// corridas siguientes sólo miden lo que falta; sin `project` el
    /// análisis es en memoria y no escribe nada. Como `render_export`
    /// corre en su hilo y reporta `analyze_motion_progress`.
    AnalyzeMotion(AnalyzeMotionRequest),
    /// Pide cancelar el `render_export` en curso.
    ///
    /// No es una request común: el loop principal la intercepta antes de
    /// despachar (un `render_export` ocupa un hilo y el loop sigue leyendo
    /// stdin), marca el flag de cancelación y responde con una línea de
    /// EVENTO `{"type":"cancel_ack",...}` —sin `ok`— para no confundirla con
    /// la respuesta del render que sigue en vuelo. Si no hay render activo
    /// el flag queda armado y el próximo `render_export` lo limpia al
    /// empezar.
    Cancel,
}

/// Los campos de `{"op":"render_export"}`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ExportRequest {
    /// Dónde escribir el archivo (`.mp4`, `.mov`, `.webm` según codec).
    pub output: String,
    /// Ancho del canvas en píxeles. Van juntos o ninguno; si faltan se
    /// usa el tamaño del primer clip.
    #[serde(default)]
    pub width: Option<u32>,
    /// Ver `width`.
    #[serde(default)]
    pub height: Option<u32>,
    /// Frame rate de salida: `"30/1"`, `"29.97"`, `"30000/1001"` o un
    /// número JSON. Default: el frame rate del primer clip (o 30).
    #[serde(default)]
    pub frame_rate: Option<Value>,
    /// Duración total en segundos (string racional/decimal). Default:
    /// el final del último clip. Nunca acorta lo que los clips cubren.
    #[serde(default)]
    pub duration: Option<String>,
    /// Codec de video: `"h264"` (default), `"hevc"`, `"av1"`,
    /// `"prores-4444"`, `"vp9-alpha"`.
    #[serde(default)]
    pub codec: Option<String>,
    /// Preset del encoder (`"medium"` default).
    #[serde(default)]
    pub preset: Option<String>,
    /// CRF 0..=51 (`18` default).
    #[serde(default)]
    pub crf: Option<u8>,
    /// `false` fuerza encoder por software (default: el preferido por
    /// `concat-media`, que puede ser hardware).
    #[serde(default)]
    pub hardware: Option<bool>,
    /// Clips en orden de pintado: los últimos cubren a los primeros.
    pub clips: Vec<ExportClip>,
}

/// Un clip de `render_export`: un tramo de un archivo sobre el canvas.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ExportClip {
    /// Ruta del archivo de medio.
    pub path: String,
    /// Punto de entrada en la fuente, en segundos (`"1.5"`, `"3/2"`).
    /// JSON `"in"`; `input` es el nombre interno. Default `"0"`.
    #[serde(rename = "in", default)]
    pub input: Option<String>,
    /// Dónde empieza el clip en la línea de tiempo, en segundos. Default:
    /// el final del clip anterior (el primero, `0`).
    #[serde(default)]
    pub start: Option<String>,
    /// Cuánto dura en la línea de tiempo, en segundos. Default: lo que
    /// queda del medio desde `in` hasta su final.
    #[serde(default)]
    pub duration: Option<String>,
    /// Rectángulo de destino en píxeles del canvas. `x`/`y` default `0`;
    /// `width`/`height` default: todo el canvas.
    #[serde(default)]
    pub x: Option<f64>,
    /// Ver `x`.
    #[serde(default)]
    pub y: Option<f64>,
    /// Ver `x`.
    #[serde(default)]
    pub width: Option<f64>,
    /// Ver `x`.
    #[serde(default)]
    pub height: Option<f64>,
    /// `"contain"` (default: entra entero, barras negras), `"cover"`
    /// (llena el rect recortando) o `"fill"` (estira sin aspecto).
    #[serde(default)]
    pub fit: Option<String>,
    /// `true` mezcla el audio del clip en la salida (48 kHz estéreo AAC,
    /// vía `concat_media::audio`). Default `false`.
    #[serde(default)]
    pub audio: bool,
    /// Velocidad de reproducción: segundos de fuente por segundo de
    /// timeline (`2` = el doble de rápido). Acepta número JSON o string
    /// (`"2"`, `"3/2"`). Default `1`; rango efectivo 0.0625..=16 como el
    /// motor de audio de Concat. Sólo hacia adelante (speed > 0).
    /// Cuando hay `speed_curve`, éste manda y `speed` se ignora.
    #[serde(default)]
    pub speed: Option<Value>,
    /// Curva de velocidad: puntos `(at, speed)` donde `at` es la fracción
    /// `0..=1` de la duración del clip en el timeline y `speed` son
    /// segundos de fuente por segundo de timeline (el mismo rango que
    /// `speed`). `slope` es opcional por punto: si TODOS los puntos lo
    /// traen la curva se dobla suave (Hermite, `SpeedCurve::with_tangents`
    /// de concat-core); si no, interpola en líneas rectas — la misma
    /// regla que `concat_project::speed`. El motor ordena los puntos y
    /// clampea `at`/`speed` a sus rangos; una lista vacía o sin ningún
    /// punto usable es error. El video remuestrea por la integral de la
    /// curva y el audio por pasos `atempo` (`AudioClip.tempo`).
    #[serde(default)]
    pub speed_curve: Option<Vec<SpeedCurvePoint>>,
    /// Transición con el clip anterior (el de índice menor en `clips`):
    /// durante sus primeros `duration`/`frames` segundos el frame es una
    /// mezcla CPU de "escena sin este clip, con el anterior extendido" y
    /// "escena completa" — las mismas formas xfade que dibuja el
    /// compositor de Concat sin GPU (`src/transitions.rs`).
    #[serde(default)]
    pub transition: Option<ExportTransition>,
}

/// El `transition` de un clip: cómo se funde con el clip anterior.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ExportTransition {
    /// Tipo: nombre `xfade` de FFmpeg que el catálogo de Concat conoce —
    /// `"dissolve"`/`"fade"` (crossfade), `"fadeblack"`, `"fadewhite"`,
    /// `"wipeleft"`/`"wiperight"`/`"wipeup"`/`"wipedown"` (y diagonales
    /// `wipetl`/`wipetr`/`wipebl`/`wipebr`), `"smooth*"`, `"radial"`,
    /// `"circleopen"`/`"circleclose"`, `"horzopen"`/`"horzclose"`,
    /// `"vertopen"`/`"vertclose"`, `"slide*"`, `"cover*"`, `"reveal*"`,
    /// `"zoomin"`, `"pixelize"`, `"rectcrop"`. JSON `"type"`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Duración en segundos (string de tiempo: `"0.5"`, `"3/2"`). Se
    /// combina con `frames`: hay que dar uno solo.
    #[serde(default)]
    pub duration: Option<String>,
    /// Duración en frames de salida (entero). Alternativa a `duration`.
    #[serde(default)]
    pub frames: Option<u64>,
    /// Crossfade de audio durante la ventana de la transición: el clip
    /// saliente hace fade out y el entrante fade in a lo largo de la
    /// misma duración (el saliente se extiende para sonar durante la
    /// ventana, como el video). Default `true`: se aplica cuando la
    /// transición existe y ambos clips tienen `audio` con stream;
    /// `false` lo desactiva.
    #[serde(default)]
    pub audio_crossfade: Option<bool>,
}

/// Los campos de `{"op":"analyze_motion"}`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct AnalyzeMotionRequest {
    /// Ruta del archivo de medio.
    pub path: String,
    /// Inicio del tramo en segundos de fuente (`"1.5"`, `"3/2"`).
    /// Default `"0"`.
    #[serde(default)]
    pub from: Option<String>,
    /// Fin del tramo en segundos de fuente. Default: la duración del
    /// medio según `probe`; si el probe no la reporta, hay que darla.
    #[serde(default)]
    pub to: Option<String>,
    /// Carpeta del proyecto para cachear la medición
    /// (`concat_vision::stabilize::motion_dir`). Sin ella no se escribe
    /// nada y el análisis es sólo en memoria.
    #[serde(default)]
    pub project: Option<String>,
    /// Tamaño de análisis en píxeles; van juntos o ninguno. Default: el
    /// lado mayor a `ANALYSIS_SIDE` (480 px) conservando el aspecto.
    #[serde(default)]
    pub width: Option<u32>,
    /// Ver `width`.
    #[serde(default)]
    pub height: Option<u32>,
}

/// Un punto de `speed_curve`: velocidad en la fracción `at` del clip.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SpeedCurvePoint {
    /// Dónde cae el punto: fracción `0..=1` de la duración del clip en el
    /// timeline (`0` = inicio, `1` = fin). El motor lo clampea al rango.
    pub at: f64,
    /// Segundos de fuente por segundo de timeline en ese punto (número
    /// JSON; el motor lo clampea a 0.0625..=16).
    pub speed: f64,
    /// Pendiente de la curva en ese punto (velocidad por unidad de `at`).
    /// Sólo cuenta si TODOS los puntos lo traen: con pendientes parciales
    /// la curva juega en líneas rectas.
    #[serde(default)]
    pub slope: Option<f64>,
}

/// Parsea una línea de entrada. El error ya viene listo para el envelope.
pub fn parse(line: &str) -> Result<Request, String> {
    serde_json::from_str::<Request>(line).map_err(|error| format!("bad request: {error}"))
}

/// Envuelve el resultado de una op en la línea de respuesta.
///
/// `Ok` debe ser un objeto JSON: se le inserta `"ok": true`. Cualquier otro
/// valor se emite tal cual (los ops siempre devuelven objetos).
/// `Err` produce `{"ok": false, "error": "..."}`.
pub fn respond(result: Result<Value, String>) -> Value {
    match result {
        Ok(mut value) => {
            if let Value::Object(ref mut map) = value {
                map.insert("ok".to_owned(), json!(true));
            }
            value
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

/// Serializa la respuesta a una sola línea JSON.
pub fn encode(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_op() {
        assert_eq!(parse(r#"{"op":"ping"}"#).unwrap(), Request::Ping);
        assert_eq!(parse(r#"{"op":"shutdown"}"#).unwrap(), Request::Shutdown);
        assert_eq!(parse(r#"{"op":"cancel"}"#).unwrap(), Request::Cancel);
        assert_eq!(
            parse(r#"{"op":"probe","path":"C:/clip.mp4"}"#).unwrap(),
            Request::Probe {
                path: "C:/clip.mp4".to_owned()
            }
        );
        assert_eq!(
            parse(
                r#"{"op":"decode_frame","path":"a.mp4","time":"1.5","out":"f.png",
                    "width":320,"height":180,"format":"png","quality":80}"#
            )
            .unwrap(),
            Request::DecodeFrame {
                path: "a.mp4".to_owned(),
                time: "1.5".to_owned(),
                out: "f.png".to_owned(),
                width: Some(320),
                height: Some(180),
                format: Some("png".to_owned()),
                quality: Some(80),
            }
        );
    }

    #[test]
    fn decode_frame_defaults_are_none() {
        let Request::DecodeFrame {
            width,
            height,
            format,
            quality,
            ..
        } = parse(r#"{"op":"decode_frame","path":"a","time":"0","out":"o.png"}"#).unwrap()
        else {
            panic!("not a decode_frame")
        };
        assert_eq!((width, height, format, quality), (None, None, None, None));
    }

    #[test]
    fn parses_render_export() {
        let request = parse(
            r#"{"op":"render_export","output":"out.mp4","width":320,"height":180,
                "frame_rate":"30000/1001","codec":"h264","crf":20,
                "clips":[{"path":"a.mp4","in":"0.5","duration":"2",
                          "fit":"cover","audio":true},
                         {"path":"b.mp4","start":"1","x":10,"y":20,
                          "width":100,"height":50}]}"#,
        )
        .unwrap();
        let Request::RenderExport(request) = &request else {
            panic!("not a render_export")
        };
        assert_eq!(request.output, "out.mp4");
        assert_eq!((request.width, request.height), (Some(320), Some(180)));
        assert_eq!(request.frame_rate, Some(json!("30000/1001")));
        assert_eq!(request.codec.as_deref(), Some("h264"));
        assert_eq!(request.crf, Some(20));
        let clips = &request.clips;
        assert_eq!(clips.len(), 2);
        assert_eq!(clips[0].input.as_deref(), Some("0.5"));
        assert_eq!(clips[0].fit.as_deref(), Some("cover"));
        assert!(clips[0].audio);
        assert_eq!(clips[1].x, Some(10.0));
        assert_eq!(clips[1].width, Some(100.0));
        assert!(!clips[1].audio);
        // Los defaults quedan en None/false.
        assert_eq!(clips[1].input, None);
        assert_eq!(clips[1].duration, None);
        assert_eq!(clips[1].height, Some(50.0));
    }

    #[test]
    fn parses_clip_speed_and_transition() {
        let request = parse(
            r#"{"op":"render_export","output":"o.mp4","clips":[
                {"path":"a.mp4","duration":"2"},
                {"path":"b.mp4","speed":"3/2",
                 "transition":{"type":"wipeleft","duration":"0.5"}},
                {"path":"c.mp4","speed":2.0,
                 "transition":{"type":"dissolve","frames":15}}]}"#,
        )
        .unwrap();
        let Request::RenderExport(request) = &request else {
            panic!("not a render_export")
        };
        let clips = &request.clips;
        assert_eq!(clips[0].speed, None);
        assert_eq!(clips[0].transition, None);
        assert_eq!(clips[1].speed, Some(json!("3/2")));
        let transition = clips[1].transition.as_ref().unwrap();
        assert_eq!(transition.kind, "wipeleft");
        assert_eq!(transition.duration.as_deref(), Some("0.5"));
        assert_eq!(transition.frames, None);
        assert_eq!(clips[2].speed, Some(json!(2.0)));
        let transition = clips[2].transition.as_ref().unwrap();
        assert_eq!(transition.kind, "dissolve");
        assert_eq!(transition.frames, Some(15));
        assert_eq!(transition.duration, None);
    }

    #[test]
    fn parses_speed_curve_and_audio_crossfade() {
        let request = parse(
            r#"{"op":"render_export","output":"o.mp4","clips":[
                {"path":"a.mp4","duration":"2"},
                {"path":"b.mp4","duration":"2",
                 "speed_curve":[{"at":0,"speed":0.5},{"at":0.5,"speed":2,"slope":0},
                                {"at":1,"speed":1,"slope":0}],
                 "transition":{"type":"dissolve","duration":"0.5",
                               "audio_crossfade":false}}]}"#,
        )
        .unwrap();
        let Request::RenderExport(request) = &request else {
            panic!("not a render_export")
        };
        let clip = &request.clips[1];
        let curve = clip.speed_curve.as_ref().expect("curve parsed");
        assert_eq!(curve.len(), 3);
        assert_eq!(curve[0].at, 0.0);
        assert_eq!(curve[1].speed, 2.0);
        assert_eq!(curve[1].slope, Some(0.0));
        assert_eq!(curve[2].slope, Some(0.0));
        let transition = clip.transition.as_ref().unwrap();
        assert_eq!(transition.audio_crossfade, Some(false));
        // La transición sin el campo queda en None (= crossfade activo).
        assert_eq!(request.clips[0].speed_curve, None);
    }

    #[test]
    fn speed_curve_rejects_non_numeric_points() {
        assert!(parse(
            r#"{"op":"render_export","output":"o","clips":[
                {"path":"a","speed_curve":[{"at":"x","speed":1}]}]}"#,
        )
        .is_err());
        assert!(parse(
            r#"{"op":"render_export","output":"o","clips":[
                {"path":"a","speed_curve":"fast"}]}"#,
        )
        .is_err());
    }

    #[test]
    fn parses_analyze_motion() {
        let request = parse(
            r#"{"op":"analyze_motion","path":"a.mp4","from":"1.5","to":"10",
                "project":"C:/proj","width":320,"height":180}"#,
        )
        .unwrap();
        let Request::AnalyzeMotion(request) = &request else {
            panic!("not an analyze_motion")
        };
        assert_eq!(request.path, "a.mp4");
        assert_eq!(request.from.as_deref(), Some("1.5"));
        assert_eq!(request.to.as_deref(), Some("10"));
        assert_eq!(request.project.as_deref(), Some("C:/proj"));
        assert_eq!((request.width, request.height), (Some(320), Some(180)));
        // Sin opcionales: defaults en None.
        let minimal = parse(r#"{"op":"analyze_motion","path":"a.mp4"}"#).unwrap();
        let Request::AnalyzeMotion(minimal) = &minimal else {
            panic!("not an analyze_motion")
        };
        assert_eq!(minimal.from, None);
        assert_eq!(minimal.project, None);
        // Falta `path`: error de parseo.
        assert!(parse(r#"{"op":"analyze_motion"}"#).is_err());
    }

    #[test]
    fn unknown_op_and_malformed_lines_are_errors() {
        // render_export existe pero sin `output` ni `clips` no parsea.
        assert!(parse(r#"{"op":"render_export"}"#).is_err());
        assert!(parse(r#"{"op":"render_export","output":"o.mp4","clips":[]}"#).is_ok());
        assert!(parse("not json").is_err());
        assert!(parse(r#"{"op":"probe"}"#).is_err(), "path is required");
    }

    #[test]
    fn respond_marks_ok_and_wraps_errors() {
        let ok = respond(Ok(json!({ "duration": 1.5 })));
        assert_eq!(ok, json!({ "ok": true, "duration": 1.5 }));
        let err = respond(Err("no such file".to_owned()));
        assert_eq!(err, json!({ "ok": false, "error": "no such file" }));
        // El envelope ocupa una sola línea.
        assert!(!encode(&ok).unwrap().contains('\n'));
    }
}
