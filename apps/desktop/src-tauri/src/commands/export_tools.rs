//! Fase 1 · capacidades reales de export y verificación FFprobe.
//!
//! `export_capabilities` sondea el FFmpeg empaquetado (`-encoders`) para que la
//! UI sólo ofrezca lo que este build LGPL realmente puede producir. La matriz
//! sigue el contrato de `packages/project-schema/src/delivery.ts`.
//!
//! `verify_export` lee un archivo ya exportado y devuelve el reporte legible
//! (codec/contenedor/bitrate/resolución/fps/pixel format/color/HDR/duration).
//! HDR: este build no inyecta metadata HDR; `hdr` sólo reporta lo que el archivo
//! declara (PQ/HLG). La UI no debe ofrecer exportar en HDR.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::encoder_names;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerCapability {
    pub container: String,
    pub video_codecs: Vec<String>,
    pub audio_codecs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecCapability {
    pub software: Vec<String>,
    pub hardware: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCapabilities {
    pub containers: Vec<ContainerCapability>,
    pub pixel_formats: Vec<String>,
    pub video_codecs: HashMap<String, CodecCapability>,
    pub audio_codecs: Vec<String>,
    pub hdr: bool,
    pub max_width: u32,
    pub max_height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportVerification {
    pub path: String,
    pub container: String,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps_num: u32,
    pub fps_den: u32,
    pub pixel_format: Option<String>,
    pub video_bitrate: Option<u64>,
    pub audio_bitrate: Option<u64>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub hdr: bool,
    pub duration_seconds: Option<f64>,
    pub bytes: u64,
    pub warnings: Vec<String>,
}

fn has(encoders: &[String], name: &str) -> bool {
    encoders.iter().any(|candidate| candidate == name)
}

fn codec_availability(
    encoders: &[String],
    software: &[&str],
    hardware: &[&str],
) -> CodecCapability {
    CodecCapability {
        software: software
            .iter()
            .filter(|name| has(encoders, name))
            .map(|name| (*name).to_owned())
            .collect(),
        hardware: hardware
            .iter()
            .filter(|name| has(encoders, name))
            .map(|name| (*name).to_owned())
            .collect(),
    }
}

// La matriz se interseca con lo que el pipeline de render puede emitir.

fn matrix_from_encoders(encoders: &[String]) -> ExportCapabilities {
    // El renderer (render/ffmpeg.rs) emite MP4/MOV H.264/H.265 + AAC y
    // WebM VP9/AV1 + Opus. La matriz se reporta sólo con lo que el binario
    // declara: si falta libvpx-vp9 o libopus, la UI no los ofrece.
    let h264 = codec_availability(
        encoders,
        &["libx264", "h264_mf", "libopenh264"],
        &["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"],
    );
    let h265 = codec_availability(
        encoders,
        &["libx265", "hevc_mf"],
        &["hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox"],
    );
    let vp9 = codec_availability(encoders, &["libvpx-vp9"], &["vp9_qsv", "vp9_amf"]);
    let av1 = codec_availability(
        encoders,
        &["libsvtav1", "libaom-av1"],
        &["av1_nvenc", "av1_qsv", "av1_amf"],
    );
    let aac_available = ["aac", "aac_mf"]
        .iter()
        .any(|encoder| has(encoders, encoder));
    let opus_available = has(encoders, "libopus");
    // Pixel formats que el renderer emite de verdad: 4:2:0 siempre; 4:4:4
    // sólo cuando hay un encoder de software que lo acepte (libvpx-vp9 para
    // VP9, libaom-av1 para AV1 — libsvtav1 y el hardware degradan a 4:2:0).
    let mut pixel_formats = vec!["yuv420p".to_owned()];
    let has_444 = vp9.software.iter().any(|e| e == "libvpx-vp9")
        || av1.software.iter().any(|e| e == "libaom-av1");
    if has_444 {
        pixel_formats.push("yuv444p".to_owned());
    }
    let mut video = HashMap::new();
    let mut mp4_video = Vec::new();
    if !h264.software.is_empty() || !h264.hardware.is_empty() {
        video.insert("h264".to_owned(), h264);
        mp4_video.push("h264".to_owned());
    }
    if !h265.software.is_empty() || !h265.hardware.is_empty() {
        video.insert("h265".to_owned(), h265);
        mp4_video.push("h265".to_owned());
    }
    let mut webm_video = Vec::new();
    if !vp9.software.is_empty() || !vp9.hardware.is_empty() {
        video.insert("vp9".to_owned(), vp9);
        webm_video.push("vp9".to_owned());
    }
    if !av1.software.is_empty() || !av1.hardware.is_empty() {
        video.insert("av1".to_owned(), av1);
        webm_video.push("av1".to_owned());
    }
    let audio = if aac_available {
        vec!["aac".to_owned()]
    } else {
        Vec::new()
    };
    let webm_audio = if opus_available {
        vec!["opus".to_owned()]
    } else {
        Vec::new()
    };
    let mut containers = Vec::new();
    if !mp4_video.is_empty() && !audio.is_empty() {
        containers.push(ContainerCapability {
            container: "mp4".to_owned(),
            video_codecs: mp4_video.clone(),
            audio_codecs: audio.clone(),
        });
        containers.push(ContainerCapability {
            container: "mov".to_owned(),
            video_codecs: mp4_video,
            audio_codecs: audio.clone(),
        });
    }
    if !webm_video.is_empty() && !webm_audio.is_empty() {
        containers.push(ContainerCapability {
            container: "webm".to_owned(),
            video_codecs: webm_video,
            audio_codecs: webm_audio.clone(),
        });
    }
    ExportCapabilities {
        containers,
        pixel_formats,
        video_codecs: video,
        audio_codecs: audio.into_iter().chain(webm_audio).collect(),
        hdr: false,
        max_width: 16_384,
        max_height: 16_384,
    }
}

#[tauri::command]
pub async fn export_capabilities(
    state: State<'_, AppState>,
) -> Result<ExportCapabilities, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está configurado; no se pueden detectar los códecs disponibles",
        ));
    };
    Ok(matrix_from_encoders(&encoder_names(&ffmpeg)))
}

fn rate(value: &Value) -> (u32, u32) {
    let raw = value.as_str().unwrap_or("");
    let mut parts = raw.split('/');
    let num = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    let den = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1);
    (num, den)
}

fn stream<'a>(document: &'a Value, kind: &str) -> Option<&'a Value> {
    document["streams"]
        .as_array()?
        .iter()
        .find(|stream| stream["codec_type"].as_str() == Some(kind))
}

fn fps_of(stream: &Value) -> (u32, u32) {
    let (num, den) = rate(&stream["avg_frame_rate"]);
    if num > 0 {
        return (num, den);
    }
    rate(&stream["r_frame_rate"])
}

fn container_of(format: &Value, path: &Path) -> String {
    let format_name = format["format_name"].as_str().unwrap_or("");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // La extensión manda: `mov,mp4,m4a,...` es el mismo demuxer para MP4 y MOV.
    match extension.as_str() {
        "webm" => return "webm".to_owned(),
        "mov" => return "mov".to_owned(),
        "mp4" | "m4v" => return "mp4".to_owned(),
        _ => {}
    }
    if format_name.contains("webm") || format_name.contains("matroska") {
        "webm".to_owned()
    } else if format_name.contains("mov") {
        "mov".to_owned()
    } else {
        "mp4".to_owned()
    }
}

fn number(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
    })
}

fn parse_verification(path: &Path, document: &Value, bytes: u64) -> ExportVerification {
    let video = stream(document, "video");
    let audio = stream(document, "audio");
    let format = &document["format"];
    let mut warnings = Vec::new();
    if video.is_none() {
        warnings.push("el archivo no tiene pista de video".to_owned());
    }
    if audio.is_none() {
        warnings.push("el archivo no tiene pista de audio".to_owned());
    }
    let text_of = |source: Option<&Value>, key: &str| -> Option<String> {
        source
            .and_then(|value| value.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|value| !value.is_empty())
    };
    let number_of = |source: Option<&Value>, key: &str| -> Option<u64> {
        source.and_then(|value| number(value.get(key)))
    };
    let (fps_num, fps_den) = video.map(fps_of).unwrap_or((0, 1));
    if fps_num == 0 {
        warnings.push("FFprobe no declaró una tasa de cuadros válida".to_owned());
    }
    let transfer = text_of(video, "color_transfer");
    let hdr = matches!(
        transfer.as_deref(),
        Some("smpte2084") | Some("arib-std-b67")
    );
    ExportVerification {
        path: path.to_string_lossy().into_owned(),
        container: container_of(format, path),
        video_codec: text_of(video, "codec_name"),
        audio_codec: text_of(audio, "codec_name"),
        width: video
            .and_then(|stream| stream["width"].as_u64())
            .map(|value| value as u32),
        height: video
            .and_then(|stream| stream["height"].as_u64())
            .map(|value| value as u32),
        fps_num,
        fps_den,
        pixel_format: text_of(video, "pix_fmt"),
        video_bitrate: number_of(video, "bit_rate").or_else(|| number_of(Some(format), "bit_rate")),
        audio_bitrate: number_of(audio, "bit_rate"),
        color_space: text_of(video, "color_space"),
        color_transfer: transfer,
        color_primaries: text_of(video, "color_primaries"),
        hdr,
        duration_seconds: text_of(Some(format), "duration")
            .and_then(|value| value.parse::<f64>().ok()),
        bytes,
        warnings,
    }
}

/// Verifica un archivo existente con FFprobe; usado por el comando y por el
/// worker de render al terminar (`render-finished.verification`).
pub fn verify_file(ffprobe: &Path, path: &Path) -> Result<ExportVerification, ProjectError> {
    let bytes = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if bytes == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo exportado no existe o está vacío",
        ));
    }
    let mut command = std::process::Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFprobe para verificar el archivo",
        )
    })?;
    let document: Value = serde_json::from_slice(&output.stdout).unwrap_or(Value::Null);
    if !output.status.success() || document["streams"].is_null() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFprobe no pudo leer el archivo exportado",
        ));
    }
    Ok(parse_verification(path, &document, bytes))
}

#[tauri::command]
pub async fn verify_export(
    state: State<'_, AppState>,
    path: String,
) -> Result<ExportVerification, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (_ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no está configurado",
        ));
    };
    verify_file(&ffprobe, Path::new(path.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoders() -> Vec<String> {
        vec![
            "aac".to_owned(),
            "libopenh264".to_owned(),
            "h264_nvenc".to_owned(),
            "libvpx-vp9".to_owned(),
            "libopus".to_owned(),
        ]
    }

    #[test]
    fn la_matriz_solo_reporta_lo_que_el_pipeline_soporta() {
        let matrix = matrix_from_encoders(&encoders());
        assert!(!matrix.hdr);
        // El worker emite MP4/MOV H.264/H.265 + AAC y WebM VP9/AV1 + Opus.
        assert_eq!(matrix.video_codecs["h264"].software, vec!["libopenh264"]);
        assert_eq!(matrix.video_codecs["h264"].hardware, vec!["h264_nvenc"]);
        assert!(matrix.video_codecs.get("h265").is_none());
        // Sin libsvtav1/libaom-av1 ni hardware AV1, AV1 no se ofrece.
        assert!(matrix.video_codecs.get("av1").is_none());
        assert_eq!(matrix.video_codecs["vp9"].software, vec!["libvpx-vp9"]);
        assert_eq!(matrix.audio_codecs, vec!["aac", "opus"]);
        let containers: Vec<&str> = matrix
            .containers
            .iter()
            .map(|container| container.container.as_str())
            .collect();
        assert_eq!(containers, vec!["mp4", "mov", "webm"]);
        assert!(matrix
            .containers
            .iter()
            .all(|container| container.audio_codecs.len() == 1));
        let webm = matrix
            .containers
            .iter()
            .find(|container| container.container == "webm")
            .unwrap();
        assert_eq!(webm.video_codecs, vec!["vp9"]);
        assert_eq!(webm.audio_codecs, vec!["opus"]);
        // libvpx-vp9 está en la lista: el build puede emitir 4:4:4.
        assert_eq!(matrix.pixel_formats, vec!["yuv420p", "yuv444p"]);
    }

    #[test]
    fn pixel_444_solo_cuando_hay_encoder_software_que_lo_acepte() {
        // Sin libvpx-vp9 ni libaom-av1 no se ofrece 4:4:4.
        let list = vec!["aac".to_owned(), "libopenh264".to_owned()];
        let matrix = matrix_from_encoders(&list);
        assert_eq!(matrix.pixel_formats, vec!["yuv420p"]);

        // libsvtav1 degrada 4:4:4 a 4:2:0 en silencio: no cuenta.
        let mut list = encoders();
        list.retain(|name| name != "libvpx-vp9");
        list.push("libsvtav1".to_owned());
        let matrix = matrix_from_encoders(&list);
        assert_eq!(matrix.pixel_formats, vec!["yuv420p"]);

        // libaom-av1 sí emite 4:4:4 de verdad.
        let mut list = encoders();
        list.retain(|name| name != "libvpx-vp9");
        list.push("libaom-av1".to_owned());
        let matrix = matrix_from_encoders(&list);
        assert_eq!(matrix.pixel_formats, vec!["yuv420p", "yuv444p"]);
    }

    #[test]
    fn av1_entra_en_webm_cuando_hay_encoder() {
        let mut list = encoders();
        list.push("libsvtav1".to_owned());
        list.push("av1_nvenc".to_owned());
        let matrix = matrix_from_encoders(&list);
        assert_eq!(matrix.video_codecs["av1"].software, vec!["libsvtav1"]);
        assert_eq!(matrix.video_codecs["av1"].hardware, vec!["av1_nvenc"]);
        let webm = matrix
            .containers
            .iter()
            .find(|container| container.container == "webm")
            .unwrap();
        assert_eq!(webm.video_codecs, vec!["vp9", "av1"]);
    }

    #[test]
    fn sin_opus_no_hay_webm_aunque_haya_vp9() {
        let mut list = encoders();
        list.retain(|encoder| encoder != "libopus");
        let matrix = matrix_from_encoders(&list);
        assert!(matrix
            .containers
            .iter()
            .all(|container| container.container != "webm"));
        assert!(!matrix.audio_codecs.iter().any(|codec| codec == "opus"));
    }

    #[test]
    fn sin_aac_no_hay_contenedores() {
        let only_video: Vec<String> = vec!["libopenh264".to_owned()];
        let matrix = matrix_from_encoders(&only_video);
        assert!(matrix.containers.is_empty());
        assert!(matrix.audio_codecs.is_empty());
    }

    #[test]
    fn tasa_de_cuadros_se_parsea_o_cae_a_default() {
        let stream = serde_json::json!({ "avg_frame_rate": "30000/1001", "r_frame_rate": "30/1" });
        assert_eq!(fps_of(&stream), (30_000, 1_001));
        let broken = serde_json::json!({ "avg_frame_rate": "0/0", "r_frame_rate": "24/1" });
        assert_eq!(fps_of(&broken), (24, 1));
    }

    #[test]
    fn contenedor_por_formato_y_extension() {
        let format = serde_json::json!({ "format_name": "matroska,webm" });
        assert_eq!(container_of(&format, Path::new("out.webm")), "webm");
        let format = serde_json::json!({ "format_name": "mov,mp4,m4a,3gp,3g2,mj2" });
        assert_eq!(container_of(&format, Path::new("out.mov")), "mov");
        assert_eq!(container_of(&format, Path::new("out.mp4")), "mp4");
    }

    #[test]
    fn parsea_un_probe_de_mp4_h264() {
        let document = serde_json::json!({
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "30/1",
                    "pix_fmt": "yuv420p",
                    "bit_rate": "8000000",
                    "color_space": "bt709",
                    "color_transfer": "bt709",
                    "color_primaries": "bt709"
                },
                { "codec_type": "audio", "codec_name": "aac", "bit_rate": "192000" }
            ],
            "format": { "format_name": "mov,mp4,m4a", "duration": "10.5", "bit_rate": "8300000" }
        });
        let verification = parse_verification(Path::new("out.mp4"), &document, 1_000);
        assert_eq!(verification.container, "mp4");
        assert_eq!(verification.video_codec.as_deref(), Some("h264"));
        assert_eq!(verification.width, Some(1920));
        assert_eq!(verification.fps_num, 30);
        assert_eq!(verification.pixel_format.as_deref(), Some("yuv420p"));
        assert!(!verification.hdr);
        assert_eq!(verification.duration_seconds, Some(10.5));
        assert!(verification.warnings.is_empty());
    }

    #[test]
    fn detecta_hdr_por_transfer() {
        let document = serde_json::json!({
            "streams": [{
                "codec_type": "video",
                "codec_name": "hevc",
                "width": 3840,
                "height": 2160,
                "avg_frame_rate": "24/1",
                "pix_fmt": "yuv420p10le",
                "color_transfer": "smpte2084"
            }],
            "format": { "format_name": "mov,mp4", "duration": "5" }
        });
        let verification = parse_verification(Path::new("hdr.mp4"), &document, 10);
        assert!(verification.hdr);
        assert_eq!(verification.color_transfer.as_deref(), Some("smpte2084"));
    }
}
