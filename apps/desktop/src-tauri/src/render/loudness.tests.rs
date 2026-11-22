use super::*;
use std::io::Cursor;

#[test]
fn parses_the_loudnorm_json_block() {
    let stderr = "ffmpeg version 9\n{\n    \"input_i\" : \"-17.32\",\n    \"input_tp\" : \"-1.20\",\n    \"input_lra\" : \"5.40\",\n    \"input_thresh\" : \"-27.50\"\n}\ntrailing";
    let parsed = parse_loudnorm_json(stderr).expect("json");
    assert!((parsed.integrated_lufs + 17.32).abs() < 1e-6);
    assert!((parsed.true_peak_db + 1.20).abs() < 1e-6);
    assert!((parsed.lra_lu - 5.40).abs() < 1e-6);
    assert!(parse_loudnorm_json("sin json").is_none());
    // `-inf` no es serializable: cae al piso de la escala EBU.
    assert_eq!(
        parse_loudnorm_json("{\"input_i\":\"-inf\",\"input_tp\":\"-1.0\"}")
            .map(|value| value.integrated_lufs),
        Some(LUFS_FLOOR)
    );
}

/// Seno estereo de 997 Hz a −23 dBFS: la señal de alineación de BS.1770-4,
/// que debe medir −23 LUFS integrados.
fn alignment_sine_pcm(seconds: f64) -> Vec<u8> {
    let rate = 48_000.0f64;
    let amplitude = 10f32.powf(-23.0 / 20.0);
    let mut pcm = Vec::with_capacity((seconds * rate) as usize * 8);
    for frame in 0..(seconds * rate) as usize {
        let t = frame as f64 / rate;
        let value = (amplitude as f64 * (2.0 * std::f64::consts::PI * 997.0 * t).sin()) as f32;
        pcm.extend_from_slice(&value.to_le_bytes());
        pcm.extend_from_slice(&value.to_le_bytes());
    }
    pcm
}

#[test]
fn bs1770_alignment_sine_measures_minus_23_lufs() {
    let pcm = alignment_sine_pcm(6.0);
    let (meter, history, seconds) =
        run_meter_over_pcm(Cursor::new(pcm), 48_000.0, 2, 6.0, |_, _, _, _| {})
            .expect("medir el tono");
    assert!((seconds - 6.0).abs() < 0.05, "duración medida: {seconds}");
    let integrated = meter.integrated();
    assert!(
        (integrated - (-23.0)).abs() < 0.1,
        "el tono de alineación debe medir −23 LUFS, midió {integrated}"
    );
    let short_term = meter.short_term();
    assert!(
        (short_term - (-23.0)).abs() < 0.2,
        "short-term del tono continuo ≈ −23, midió {short_term}"
    );
    assert_eq!(history.len(), 60, "una muestra cada 100 ms");
}

#[test]
fn silence_is_floored_never_infinite() {
    let pcm = vec![0u8; 48_000 * 2 * 4]; // 1 s de silencio estéreo.
    let report = build_report_from_pcm(pcm);
    assert_eq!(report.integrated_lufs, LUFS_FLOOR);
    assert_eq!(report.sample_peak_dbfs, DB_FLOOR);
    assert_eq!(report.true_peak_dbtp, DB_FLOOR);
    assert!(report
        .samples
        .iter()
        .all(|sample| sample.momentary_lufs.is_finite()));
    let json = serde_json::to_string(&report).expect("serializable");
    assert!(!json.contains("null"), "sin nulls por infinitos: {json}");
}

fn build_report_from_pcm(pcm: Vec<u8>) -> MixLoudnessReport {
    let (meter, history, seconds) =
        run_meter_over_pcm(Cursor::new(pcm), 48_000.0, 2, 1.0, |_, _, _, _| {})
            .expect("medir el silencio");
    build_report(meter, history, seconds, None).expect("reporte del silencio")
}

#[test]
fn history_is_decimated_and_keeps_last() {
    let mut history: Vec<LoudnessSample> = (0..MAX_HISTORY * 3)
        .map(|index| LoudnessSample {
            seconds: index as f64 / 10.0,
            momentary_lufs: -23.0,
            short_term_lufs: -23.0,
        })
        .collect();
    history.push(LoudnessSample {
        seconds: 999.0,
        momentary_lufs: -10.0,
        short_term_lufs: -10.0,
    });
    let decimated = decimate_history(history);
    assert!(
        decimated.len() <= MAX_HISTORY + 1,
        "diezmado a lo sumo al tope"
    );
    assert_eq!(decimated.last().expect("última").seconds, 999.0);
}

#[test]
fn target_delta_rounds_to_one_decimal() {
    let pcm = alignment_sine_pcm(2.0);
    let (meter, history, seconds) =
        run_meter_over_pcm(Cursor::new(pcm), 48_000.0, 2, 2.0, |_, _, _, _| {}).expect("medir");
    let report = build_report(meter, history, seconds, Some(-14.0)).expect("reporte");
    let delta = report.target_delta_db.expect("delta");
    assert!((delta - 9.0).abs() <= 0.25, "delta ≈ +9 dB, dio {delta}");
    assert!(
        (delta * 10.0).fract().abs() < 1e-9,
        "redondeado a 1 decimal"
    );
}

/// El plan de medición es audio puro: sin `-progress` (stdout lleva el
/// PCM), sin loudnorm, sin encoder de video, salida f32le a stdout.
#[test]
fn audio_only_plan_streams_raw_mix() {
    use serde_json::json;
    let root = std::env::temp_dir().join(format!("editor-ia-lufs-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let project = json!({
        "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "a1", "kind": "audio", "order": 0, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "c1", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 60 } }
            ]
        },
        "assets": [
            { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 }, "loudnessTarget": { "integratedLufs": -14, "truePeakDb": -1.5 } }
    });
    let profile = crate::render::ffmpeg::Profile {
        id: "p".into(),
        name: "YouTube 1080p".into(),
        width: 1920,
        height: 1080,
        fps_num: 30,
        fps_den: 1,
        crf: Some(20),
        target_bps: None,
        video_preset: "veryfast".into(),
        fit: "contain".into(),
        audio_bps: 128_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1,
        duration_tolerance_frames: 2,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let plan = crate::render::ffmpeg::build_plan(crate::render::ffmpeg::BuildPlanInput {
        project: &project,
        root: &root,
        profile: &profile,
        output_path: std::path::Path::new(""),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: std::path::Path::new("ffprobe"),
        motion_ass: None,
        audio_only: true,
    })
    .expect("plan de medición");
    let joined = plan.args.join(" ");
    assert!(joined.contains("-f f32le"), "salida PCM: {joined}");
    assert!(joined.contains("-map [aout]"), "sólo audio: {joined}");
    assert!(!joined.contains("-progress"), "stdout es PCM: {joined}");
    assert!(!joined.contains("loudnorm"), "sin normalización: {joined}");
    assert!(!joined.contains("-c:v"), "sin encoder de video: {joined}");
    assert!(!joined.contains("alimiter"), "sin limitador: {joined}");
    assert_eq!(plan.args.last().map(String::as_str), Some("-"), "stdout");
    assert_eq!(plan.min_output_bytes, 0);
    let _ = std::fs::remove_dir_all(root);
}

/// Prueba live opcional con FFmpeg real (corrí con
/// `EDITOR_IA_FFMPEG=ruta\a\ffmpeg.exe cargo test -- --ignored`): el tono de
/// alineación generado por lavfi debe medir −23 LUFS de punta a punta.
#[test]
#[ignore]
fn live_ffmpeg_sine_measures_reference_lufs() {
    let ffmpeg = std::env::var("EDITOR_IA_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_owned());
    let mut command = std::process::Command::new(&ffmpeg);
    command.args([
        "-hide_banner",
        "-v",
        "error",
        "-f",
        "lavfi",
        // `sine` de FFmpeg no llega a plena escala (pico ≈ −18 dBFS), así que
        // `volume=-23dB` dejaba la señal a −44 dB y el medidor leía −44 LUFS
        // correctamente. `aevalsrc` da amplitud 1.0 explícita en estéreo
        // directo (`|`): `aformat` upmix mono→stéreo aplicaba −3 dB extra.
        // Resultado: la misma seno de alineación BS.1770 que el test sintético.
        "-i",
        "aevalsrc=sin(2*PI*997*t)|sin(2*PI*997*t):s=48000:d=6",
        "-af",
        "volume=-23dB",
        "-f",
        "f32le",
        "-",
    ]);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let mut child = command.spawn().expect("ffmpeg disponible");
    let stdout = child.stdout.take().expect("pcm");
    let (meter, history, seconds) =
        run_meter_over_pcm(stdout, 48_000.0, 2, 6.0, |_, _, _, _| {}).expect("medir");
    assert!(child.wait().expect("wait").success());
    assert!((seconds - 6.0).abs() < 0.2, "duración: {seconds}");
    assert_eq!(history.len(), 60);
    let integrated = meter.integrated();
    assert!(
        (integrated - (-23.0)).abs() < 0.5,
        "live: integrado ≈ −23 LUFS, midió {integrated}"
    );
}
