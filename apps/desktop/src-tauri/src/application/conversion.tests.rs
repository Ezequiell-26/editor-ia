//! Tests del motor de conversión/compresión/lote.
//!
//! Las reglas puras viven en `media::conversion`; la orquestación en
//! `application::conversion` y el worker FFmpeg en
//! `infrastructure::conversion`. Acá se cubren ambas capas más las pruebas
//! live (detrás de `EDITOR_IA_RUN_RENDER_TESTS` / `EDITORIA_RUN_RENDER_TESTS`).

use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::application::conversion::compress_input;
use crate::infrastructure::conversion::LocalConversionFiles;
use crate::infrastructure::media::SystemMediaRunner;
use crate::media::analysis::parse_vmaf_score;
use crate::media::conversion::{
    audio_filter_chain, build_args, crf_for_quality, jpeg_qscale, parse_out_time_us,
    quality_bitrate_kbps, safe_stem, video_bitrate_for_target, video_filter_chain, webp_quality,
    CompressAnyRequest, CompressInput, CompressParams, ConversionTarget, ConvertOptions,
    EncoderPref, EnhanceOptions,
};
use crate::ports::conversion::ConversionFiles;
use crate::ports::media::MediaProbe;
use crate::render::ffmpeg::HardwareEncoders;

fn no_hardware() -> HardwareEncoders {
    HardwareEncoders {
        h264: None,
        hevc: None,
        av1: None,
        vp9: None,
        checked: true,
    }
}

#[test]
fn media_probe_reads_format_and_streams() {
    let value: serde_json::Value = serde_json::from_str(
        r#"{
                "streams": [
                    { "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080 },
                    { "codec_type": "audio", "codec_name": "aac" }
                ],
                "format": { "format_name": "mov,mp4,m4a", "duration": "12.5", "size": "10485760" }
            }"#,
    )
    .expect("json");
    let path = std::path::Path::new("C:////media////toma.mp4");
    let probe = MediaProbe::from_value(path, &value);
    assert_eq!(probe.bytes, 10_485_760);
    assert_eq!(probe.duration_seconds, Some(12.5));
    assert_eq!(probe.format_name, "mov,mp4,m4a");
    assert_eq!(probe.width, Some(1920));
    assert_eq!(probe.height, Some(1080));
    assert_eq!(probe.video_codec.as_deref(), Some("h264"));
    assert_eq!(probe.audio_codec.as_deref(), Some("aac"));
}

#[test]
fn media_probe_sin_pistas_no_inventa_datos() {
    let value: serde_json::Value =
        serde_json::from_str(r#"{ "streams": [], "format": {} }"#).expect("json");
    let probe = MediaProbe::from_value(std::path::Path::new("x.mp4"), &value);
    assert_eq!(probe.video_codec, None);
    assert_eq!(probe.audio_codec, None);
    assert_eq!(probe.width, None);
    assert_eq!(probe.duration_seconds, None);
    assert_eq!(probe.format_name, "");
}

/// Prueba real de extremo a extremo: FFmpeg genera un video de prueba, la
/// compresión por ruta lo reduce y el sondeo lo describe. Se activa con
/// `EDITOR_IA_RUN_RENDER_TESTS=1` porque necesita FFmpeg y segundos de CPU.
#[test]
fn live_compress_any_file_reduces_a_generated_clip() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la compresión real");
        return;
    }
    let settings = crate::state::Settings::default();
    let (Some(ffmpeg), Some(ffprobe), _) = crate::commands::system::resolve_tools(&settings) else {
        eprintln!("FFmpeg no está disponible; se omite");
        return;
    };
    let dir = std::env::temp_dir().join(format!("editoria-compress-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("carpeta temporal");
    let source = dir.join("clip-fuente.mp4");
    let mut command = Command::new(&ffmpeg);
    command
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=1280x720:rate=30:duration=2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source);
    crate::commands::hide_console(&mut command);
    let built = command.output().expect("correr ffmpeg");
    assert!(built.status.success(), "ffmpeg no generó el clip de prueba");
    let source_bytes = std::fs::metadata(&source).expect("metadata").len();
    assert!(source_bytes > 0);

    // El sondeo describe el clip.
    let value = crate::application::media::probe_file_json(
        &crate::infrastructure::media::SystemMediaRunner,
        Some(ffprobe.as_path()),
        &source,
    )
    .expect("sondeo");
    let probe = MediaProbe::from_value(&source, &value);
    assert_eq!(probe.video_codec.as_deref(), Some("h264"));
    assert_eq!(probe.width, Some(1280));

    // Y la compresión por ruta produce un MP4 más liviano.
    let output_dir = dir.join("salida");
    std::fs::create_dir_all(&output_dir).expect("salida");
    let request = CompressAnyRequest {
        input_path: source.to_string_lossy().into_owned(),
        output_dir: output_dir.to_string_lossy().into_owned(),
        target: "mp4".to_owned(),
        mode: "quality".to_owned(),
        quality: Some(45),
        target_megabytes: None,
        max_width: None,
        audio_kbps: None,
        encoder: None,
        enhance: None,
    };
    let hardware = crate::commands::audio::HardwareEncoders {
        h264: None,
        hevc: None,
        av1: None,
        vp9: None,
        checked: true,
    };
    let params = CompressParams {
        target: ConversionTarget::parse(&request.target).expect("mp4"),
        mode: &request.mode,
        quality: request.quality,
        target_megabytes: request.target_megabytes,
        audio_kbps: request.audio_kbps,
        encoder: request.encoder.as_deref(),
        max_width: request.max_width,
        enhance: request.enhance,
    };
    let input = CompressInput {
        path: source.clone(),
        kind: "video".to_owned(),
        label: source
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default(),
        source_bytes,
    };
    let result = compress_input(
        &LocalConversionFiles,
        &crate::infrastructure::conversion::SystemConversionRunner,
        &SystemMediaRunner,
        &ffmpeg,
        Some(&ffprobe),
        &hardware,
        &input,
        &params,
        &output_dir,
        &output_dir,
        None,
    )
    .expect("compresión");
    assert!(result.bytes > 0);
    assert!(result.bytes <= source_bytes, "no se redujo el peso");
    assert!(result.path.ends_with(".mp4"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn progress_line_parsing_only_accepts_out_time() {
    assert_eq!(parse_out_time_us("out_time_us=1234567"), Some(1_234_567));
    assert_eq!(parse_out_time_us("out_time_us= 42 "), Some(42));
    assert_eq!(parse_out_time_us("progress=continue"), None);
    assert_eq!(parse_out_time_us("out_time_us=no"), None);
    assert_eq!(parse_out_time_us(""), None);
}

#[test]
fn vmaf_score_extraction_from_stderr() {
    let stderr = "[libvmaf @ 0x0] VMAF score: 93.24\n otros datos";
    assert_eq!(parse_vmaf_score(stderr), Some(93.24));
    assert_eq!(parse_vmaf_score("sin puntaje"), None);
    assert_eq!(parse_vmaf_score("VMAF score: "), None);
}

/// VMAF real: genera original y comprimido, mide, y comprueba un puntaje
/// razonable. Detrás de `EDITOR_IA_RUN_RENDER_TESTS` como las demás pruebas
/// que necesitan FFmpeg.
#[test]
fn live_measure_vmaf_between_two_clips() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la medición VMAF");
        return;
    }
    let settings = crate::state::Settings::default();
    let (Some(ffmpeg), Some(ffprobe), _) = crate::commands::system::resolve_tools(&settings) else {
        eprintln!("FFmpeg no está disponible; se omite");
        return;
    };
    if !crate::commands::convert::vmaf_filter_available(&ffmpeg) {
        eprintln!("este build de FFmpeg no trae libvmaf; se omite");
        return;
    }
    let dir = std::env::temp_dir().join(format!("editoria-vmaf-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("carpeta temporal");
    let original = dir.join("original.mp4");
    let mut command = Command::new(&ffmpeg);
    command
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=30:duration=1",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&original);
    crate::commands::hide_console(&mut command);
    assert!(command.output().expect("ffmpeg").status.success());
    let compressed = dir.join("comprimido.mp4");
    let mut command = Command::new(&ffmpeg);
    command
        .args(["-y", "-i"])
        .arg(&original)
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "40",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&compressed);
    crate::commands::hide_console(&mut command);
    assert!(command.output().expect("ffmpeg").status.success());

    struct TestTools(PathBuf, Option<PathBuf>);
    impl crate::ports::media::MediaTools for TestTools {
        fn ffmpeg_path(&self) -> Option<PathBuf> {
            Some(self.0.clone())
        }
        fn ffprobe_path(&self) -> Option<PathBuf> {
            self.1.clone()
        }
    }
    let tools = TestTools(ffmpeg.clone(), Some(ffprobe.clone()));
    let score = crate::application::media::measure_vmaf(
        &tools,
        &crate::infrastructure::media::SystemMediaRunner,
        &original.to_string_lossy(),
        &compressed.to_string_lossy(),
    )
    .expect("medición");
    let score = score.expect("el build tiene libvmaf");
    assert!(
        (0.0..=100.0).contains(&score),
        "puntaje fuera de rango: {score}"
    );
    // Un CRF 40 sobre el mismo material no debería destruirlo.
    assert!(score > 50.0, "puntaje sospechosamente bajo: {score}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn target_allowlist_maps_extensions_and_kinds() {
    assert_eq!(
        ConversionTarget::parse("JPEG").map(|t| t.extension()),
        Some("jpg")
    );
    assert_eq!(ConversionTarget::parse("exe"), None);
    assert_eq!(
        ConversionTarget::parse("mp4-hevc"),
        Some(ConversionTarget::Hevc)
    );
    assert!(ConversionTarget::Png.accepts("image"));
    assert!(ConversionTarget::Png.accepts("video"));
    assert!(!ConversionTarget::Png.accepts("audio"));
    assert!(ConversionTarget::Mp4.accepts("video"));
    assert!(!ConversionTarget::Mp4.accepts("image"));
    assert!(ConversionTarget::Mp3.accepts("audio"));
    assert!(ConversionTarget::Mp3.accepts("video"));
    assert!(ConversionTarget::Opus.accepts("audio"));
    assert!(ConversionTarget::Flac.accepts("audio"));
    assert!(!ConversionTarget::Flac.accepts("image"));
    assert!(ConversionTarget::Mkv.accepts("video"));
    assert!(!ConversionTarget::Mkv.accepts("audio"));
}

#[test]
fn quality_maps_to_bounded_codec_values() {
    assert_eq!(crf_for_quality(1), 34);
    assert_eq!(crf_for_quality(100), 16);
    assert!(crf_for_quality(100) < crf_for_quality(1));
    assert_eq!(jpeg_qscale(100), 2);
    assert_eq!(jpeg_qscale(1), 31);
    assert!(webp_quality(100) > webp_quality(1));
    assert!(quality_bitrate_kbps(100) > quality_bitrate_kbps(1));
}

#[test]
fn target_size_becomes_a_bitrate_budget() {
    // 10 MB en 60 s con audio a 128 kbps ⇒ ~1350 kbps de video.
    let kbps = video_bitrate_for_target(10.0, 60.0, 128);
    assert!((1_200..1_500).contains(&kbps), "kbps calculados: {kbps}");
    // Sin duración medida no se inventa nada: valor conservador.
    assert_eq!(video_bitrate_for_target(10.0, 0.0, 128), 2_000);
    assert_eq!(video_bitrate_for_target(0.0, 60.0, 128), 2_000);
}

#[test]
fn stems_are_safe_and_keep_readable_names() {
    assert_eq!(safe_stem("Card verde.png"), "Card verde");
    assert_eq!(safe_stem("../../etc/passwd"), "passwd");
    assert_eq!(safe_stem("???"), "medio");
}

#[test]
fn batch_names_never_collide() {
    let dir = std::env::temp_dir().join(format!("editoria-nombres-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let first = LocalConversionFiles.unique_output(&dir, "toma", "mp4");
    assert_eq!(first.file_name().unwrap(), "toma.mp4");
    std::fs::write(&first, b"x").expect("write");
    let second = LocalConversionFiles.unique_output(&dir, "toma", "mp4");
    assert_eq!(second.file_name().unwrap(), "toma-1.mp4");
    std::fs::write(&second, b"x").expect("write");
    let third = LocalConversionFiles.unique_output(&dir, "toma", "mp4");
    assert_eq!(third.file_name().unwrap(), "toma-2.mp4");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn enhance_filters_are_allowlisted() {
    let plain = EnhanceOptions::default();
    assert_eq!(video_filter_chain(None, plain), None);
    assert_eq!(audio_filter_chain(plain), None);

    let mejorado = EnhanceOptions {
        denoise: true,
        sharpen: true,
        normalize_audio: true,
    };
    let chain = video_filter_chain(Some(1280), mejorado).expect("cadena");
    assert!(chain.contains("min(1280,iw)"));
    assert!(chain.contains("hqdn3d"));
    assert!(chain.contains("unsharp"));
    assert_eq!(
        audio_filter_chain(mejorado).as_deref(),
        Some("loudnorm=I=-16:TP=-1.5:LRA=11")
    );
}

#[test]
fn mp4_args_use_h264_and_never_the_shell() {
    let hardware = no_hardware();
    let (args, encoder) = build_args(
        Path::new("in.mp4"),
        Path::new("out.mp4"),
        ConversionTarget::Mp4,
        "video",
        ConvertOptions::simple(80, Some(1280)),
        &hardware,
    )
    .expect("args");
    assert_eq!(encoder, "libx264");
    assert!(args.contains(&"libx264".to_string()));
    assert!(args.iter().any(|arg| arg.contains("min(1280,iw)")));
    assert!(args.contains(&"-crf".to_string()));
    assert!(!args.iter().any(|arg| arg == "sh" || arg == "-c"));
}

#[test]
fn hardware_encoder_switches_to_bitrate_control() {
    let hardware = HardwareEncoders {
        h264: Some("h264_nvenc".into()),
        hevc: Some("hevc_nvenc".into()),
        av1: None,
        vp9: None,
        checked: true,
    };
    let (args, encoder) = build_args(
        Path::new("in.mp4"),
        Path::new("out.mp4"),
        ConversionTarget::Mp4,
        "video",
        ConvertOptions {
            encoder: EncoderPref::Hardware,
            ..ConvertOptions::simple(80, None)
        },
        &hardware,
    )
    .expect("args");
    assert_eq!(encoder, "h264_nvenc");
    assert!(args.contains(&"h264_nvenc".to_string()));
    assert!(args.contains(&"-b:v".to_string()));
    assert!(!args.contains(&"-crf".to_string()));
}

#[test]
fn hevc_target_uses_the_hevc_encoder_and_faststart() {
    let hardware = no_hardware();
    let (args, encoder) = build_args(
        Path::new("in.mp4"),
        Path::new("out.mp4"),
        ConversionTarget::Hevc,
        "video",
        ConvertOptions::simple(70, None),
        &hardware,
    )
    .expect("args");
    assert_eq!(encoder, "libx265");
    assert!(args.contains(&"libx265".to_string()));
    assert!(args.contains(&"+faststart".to_string()));
    assert_eq!(ConversionTarget::Hevc.extension(), "mp4");
}

#[test]
fn audio_targets_map_to_their_codecs() {
    let hardware = no_hardware();
    for (target, codec) in [
        (ConversionTarget::Opus, "libopus"),
        (ConversionTarget::Flac, "flac"),
        (ConversionTarget::M4a, "aac"),
        (ConversionTarget::Mp3, "libmp3lame"),
    ] {
        let (args, encoder) = build_args(
            Path::new("in.mkv"),
            Path::new("out.bin"),
            target,
            "audio",
            ConvertOptions::simple(80, None),
            &hardware,
        )
        .expect("args");
        assert_eq!(encoder, codec);
        assert!(
            args.contains(&codec.to_string()),
            "{codec} faltaba en {args:?}"
        );
        assert!(args.contains(&"-vn".to_string()));
    }
}

#[test]
fn image_targets_grab_a_single_frame_from_video() {
    let hardware = no_hardware();
    let (args, _) = build_args(
        Path::new("in.mp4"),
        Path::new("out.png"),
        ConversionTarget::Png,
        "video",
        ConvertOptions::simple(80, Some(640)),
        &hardware,
    )
    .expect("args");
    assert!(args.contains(&"-frames:v".to_string()));
    assert!(args.contains(&"png".to_string()));
}

#[test]
fn live_conversion_produces_real_files() {
    if std::env::var("EDITORIA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    let dir = std::env::temp_dir().join(format!("editoria-convert-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let input = dir.join("input.mp4");
    let source = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
        ])
        .arg(&input)
        .status()
        .expect("ffmpeg source");
    assert!(source.success());
    let hardware = no_hardware();
    let targets = [
        ConversionTarget::Png,
        ConversionTarget::Jpg,
        ConversionTarget::Webp,
        ConversionTarget::Mp4,
        ConversionTarget::Mkv,
        ConversionTarget::Webm,
        ConversionTarget::Mov,
        ConversionTarget::Gif,
        ConversionTarget::Mp3,
        ConversionTarget::Wav,
        ConversionTarget::Opus,
        ConversionTarget::Flac,
    ];
    for target in targets {
        let output = dir.join(format!("salida.{}", target.extension()));
        let (args, _) = build_args(
            &input,
            &output,
            target,
            "video",
            ConvertOptions::simple(70, Some(64)),
            &hardware,
        )
        .expect("build conversion args");
        let result = Command::new("ffmpeg")
            .args(&args)
            .output()
            .expect("ffmpeg run");
        assert!(
            result.status.success(),
            "{:?} falló: {}",
            target,
            String::from_utf8_lossy(&result.stderr)
        );
        let bytes = std::fs::metadata(&output).expect("output").len();
        assert!(bytes > 0, "{:?} produjo un archivo vacío", target);
    }
    let _ = std::fs::remove_dir_all(&dir);
}
