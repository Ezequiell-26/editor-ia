//! Encoders de software disponibles en el FFmpeg LGPL que empaqueta Olyvia.
//!
//! `libx264`/`libx265` son GPL y no forman parte del build distribuido. En su
//! lugar se usan `libopenh264` (H.264, BSD-2-Clause) y `libkvazaar` (H.265,
//! LGPL-2.1). Ninguno comparte `-crf`/`-preset` con x264/x265: el control de
//! calidad se hace con bitrate, calculado desde resolución, fps y un CRF
//! equivalente. `libkvazaar` además exige ancho y alto múltiplos de 8.

pub(crate) const H264_SOFTWARE: &str = "libopenh264";
pub(crate) const HEVC_SOFTWARE: &str = "libkvazaar";

/// ¿El códec pedido es H.265/HEVC?
pub(crate) fn is_hevc(codec: &str) -> bool {
    matches!(
        codec.trim().to_ascii_lowercase().as_str(),
        "h265" | "hevc" | "h.265" | "hvc1"
    )
}

/// Encoder LGPL para el códec pedido. AV1 no se toca: `libaom-av1` ya es
/// compatible. Cualquier otro valor cae a H.264.
pub(crate) fn software_encoder(codec: &str) -> &'static str {
    if is_hevc(codec) {
        HEVC_SOFTWARE
    } else {
        H264_SOFTWARE
    }
}

/// `libkvazaar` rechaza dimensiones que no sean múltiplos de 8.
pub(crate) fn hevc_dimensions_ok(width: u32, height: u32) -> bool {
    width % 8 == 0 && height % 8 == 0
}

/// Bitrate de software equivalente a un CRF de x264/x265. La base es
/// 0.08 bpp para H.264 y 0.05 bpp para H.265 a CRF 23; cada 6 puntos de CRF
/// duplican o reducen el bitrate a la mitad.
pub(crate) fn software_bitrate_bps(
    codec: &str,
    width: u32,
    height: u32,
    fps: f64,
    crf: u32,
) -> u32 {
    let base = if is_hevc(codec) { 0.05 } else { 0.08 };
    let factor = 2f64.powf((23.0 - crf.min(51) as f64) / 6.0);
    let bps = width.max(2) as f64 * height.max(2) as f64 * fps.max(1.0) * base * factor;
    (bps.round() as u64).clamp(400_000, 60_000_000) as u32
}

/// Argumentos `-c:v …` para el encoder LGPL con control por bitrate.
pub(crate) fn software_video_args(
    codec: &str,
    width: u32,
    height: u32,
    fps: f64,
    crf: u32,
) -> Vec<String> {
    let bps = software_bitrate_bps(codec, width, height, fps, crf);
    software_video_args_for_bps(codec, bps)
}

/// Igual que [`software_video_args`] cuando el bitrate ya está calculado
/// (por ejemplo, un tamaño objetivo elegido por el usuario).
pub(crate) fn software_video_args_for_bps(codec: &str, bps: u32) -> Vec<String> {
    if is_hevc(codec) {
        vec![
            "-c:v".into(),
            HEVC_SOFTWARE.into(),
            "-b:v".into(),
            bps.to_string(),
        ]
    } else {
        vec![
            "-c:v".into(),
            H264_SOFTWARE.into(),
            "-rc_mode".into(),
            "bitrate".into(),
            "-b:v".into(),
            bps.to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hevc_maps_to_kvazaar_and_h264_to_openh264() {
        assert_eq!(software_encoder("h264"), "libopenh264");
        assert_eq!(software_encoder("h265"), "libkvazaar");
        assert_eq!(software_encoder("HEVC"), "libkvazaar");
        assert!(!software_encoder("h264").contains("x264"));
        assert!(!software_encoder("h265").contains("x265"));
    }

    #[test]
    fn bitrate_scales_with_resolution_and_crf() {
        let hd = software_bitrate_bps("h264", 1920, 1080, 30.0, 23);
        let sd = software_bitrate_bps("h264", 640, 360, 30.0, 23);
        assert!(hd > sd);
        let high_quality = software_bitrate_bps("h264", 1920, 1080, 30.0, 18);
        assert!(high_quality > hd, "{high_quality} vs {hd}");
        let hevc = software_bitrate_bps("h265", 1920, 1080, 30.0, 23);
        assert!(hevc < hd, "HEVC debería pedir menos bitrate que H.264");
        for bps in [hd, sd, high_quality, hevc] {
            assert!((400_000..=60_000_000).contains(&bps));
        }
    }

    #[test]
    fn args_use_lgpl_encoders_and_never_crf() {
        let h264 = software_video_args("h264", 1920, 1080, 30.0, 20);
        assert_eq!(h264[1], "libopenh264");
        assert!(!h264.iter().any(|arg| arg == "-crf"));
        assert!(h264.iter().any(|arg| arg == "-rc_mode"));
        let hevc = software_video_args("h265", 1920, 1080, 30.0, 20);
        assert_eq!(hevc[1], "libkvazaar");
        assert!(!hevc.iter().any(|arg| arg == "-crf"));
        assert!(hevc.iter().any(|arg| arg == "-b:v"));
    }

    #[test]
    fn kvazaar_requires_multiple_of_eight() {
        assert!(hevc_dimensions_ok(1920, 1080));
        assert!(hevc_dimensions_ok(3840, 2160));
        assert!(!hevc_dimensions_ok(320, 180));
    }
}
