//! Sondeo real de encoders de video por hardware.
//!
//! Estar en `ffmpeg -encoders` no garantiza que la GPU/driver exista: cada
//! candidato se prueba con una codificación lavfi de 0,1 s antes de ofrecerse.
//! Lo comparten la vista de exportación (`hardware_encoders`), el pipeline de
//! descargas (`pipeline_profile`) y los proxies de medios.
//!
//! La lista declarada (`-encoders`) se cachea por binario en
//! `profile::available_encoders`; el resultado del sondeo funcional se cachea
//! aparte en `DETECTED_ENCODER_CACHE` porque inicializar hardware es caro
//! (hasta ~2 s por codec).

use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareEncoders {
    pub h264: Option<String>,
    pub hevc: Option<String>,
    pub av1: Option<String>,
    pub vp9: Option<String>,
    pub checked: bool,
}

/// Encoders de hardware en orden de preferencia por marca.
pub(crate) const HW_H264: &[&str] = &["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"];
pub(crate) const HW_HEVC: &[&str] = &["hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox"];
pub(crate) const HW_AV1: &[&str] = &["av1_nvenc", "av1_qsv", "av1_amf"];
pub(crate) const HW_VP9: &[&str] = &["vp9_qsv", "vp9_amf"];

/// La detección inicializa encoders de verdad (hasta 2 s). El hardware no
/// cambia durante la sesión, así que se guarda por ruta de FFmpeg; si el
/// usuario elige otro binario, se vuelve a medir.
static DETECTED_ENCODER_CACHE: std::sync::Mutex<Option<(PathBuf, HardwareEncoders)>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
fn first_available(encoders: &str, wanted: &[&str]) -> Option<String> {
    wanted
        .iter()
        .find(|name| encoders.lines().any(|line| line.contains(**name)))
        .map(|name| (*name).to_owned())
}

/// Elige el primer encoder compilado que además pueda inicializar hardware.
/// Estar en `ffmpeg -encoders` no garantiza que la GPU/driver exista.
fn first_working_with<F>(encoders: &str, wanted: &[&str], mut probe: F) -> Option<String>
where
    F: FnMut(&str) -> bool,
{
    for name in wanted {
        if encoders.lines().any(|line| line.contains(*name)) && probe(name) {
            return Some((*name).to_owned());
        }
    }
    None
}

pub(crate) fn encoder_works(ffmpeg: &Path, encoder: &str) -> bool {
    let mut command = Command::new(ffmpeg);
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x144:r=30:d=0.1",
        "-an",
        "-c:v",
        encoder,
        "-pix_fmt",
        "yuv420p",
        "-f",
        "null",
        "-",
    ]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn first_working(ffmpeg: &Path, encoders: &str, wanted: &[&str]) -> Option<String> {
    first_working_with(encoders, wanted, |name| encoder_works(ffmpeg, name))
}

/// Detección real, sin Tauri. La comparten la vista de exportación y el
/// pipeline de descargas.
pub fn detect_hardware(ffmpeg: &Path) -> HardwareEncoders {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-encoders")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return HardwareEncoders {
            h264: None,
            hevc: None,
            av1: None,
            vp9: None,
            checked: false,
        };
    };
    let text = String::from_utf8_lossy(&output.stdout);
    HardwareEncoders {
        h264: first_working(ffmpeg, &text, HW_H264),
        hevc: first_working(ffmpeg, &text, HW_HEVC),
        av1: first_working(ffmpeg, &text, HW_AV1),
        vp9: first_working(ffmpeg, &text, HW_VP9),
        checked: true,
    }
}

/// `detect_hardware` con caché por binario de FFmpeg.
pub fn detect_hardware_cached(ffmpeg: &Path) -> HardwareEncoders {
    if let Ok(cache) = DETECTED_ENCODER_CACHE.lock() {
        if let Some((cached_path, cached)) = cache.as_ref() {
            if cached_path == ffmpeg {
                return cached.clone();
            }
        }
    }
    let detected = detect_hardware(ffmpeg);
    if let Ok(mut cache) = DETECTED_ENCODER_CACHE.lock() {
        *cache = Some((ffmpeg.to_path_buf(), detected.clone()));
    }
    detected
}

/// Encoder H.264 por hardware disponible, consultando FFmpeg directo.
/// Devuelve `None` si sólo hay software (o si FFmpeg no responde).
pub fn hardware_h264(ffmpeg: &Path) -> Option<String> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-encoders")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    first_working(ffmpeg, &text, HW_H264)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_encoders_de_hardware_en_la_lista() {
        let list = " V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA\n V....D hevc_qsv             Intel";
        assert_eq!(
            first_available(list, HW_H264).as_deref(),
            Some("h264_nvenc")
        );
        assert_eq!(first_available(list, HW_HEVC).as_deref(), Some("hevc_qsv"));
        let software_only = " V....D libx264              libx264 H.264";
        assert_eq!(first_available(software_only, HW_H264), None);
    }

    #[test]
    fn detecta_encoders_av1_y_vp9_en_la_lista() {
        let list =
            " V....D av1_nvenc             NVIDIA AV1\n V....D vp9_qsv              Intel VP9";
        assert_eq!(first_available(list, HW_AV1).as_deref(), Some("av1_nvenc"));
        assert_eq!(first_available(list, HW_VP9).as_deref(), Some("vp9_qsv"));
        // libsvtav1/libvpx-vp9 son software: no entran en las listas de GPU.
        let software_only =
            " V....D libsvtav1             SVT-AV1\n V....D libvpx-vp9            VP9";
        assert_eq!(first_available(software_only, HW_AV1), None);
        assert_eq!(first_available(software_only, HW_VP9), None);
    }

    #[test]
    fn el_detector_solo_ofrece_encoders_que_funcionan() {
        let list = "h264_nvenc
h264_qsv
h264_amf";
        let mut probed: Vec<String> = Vec::new();
        let chosen = first_working_with(list, HW_H264, |name| {
            probed.push(name.to_owned());
            name == "h264_amf"
        });
        assert_eq!(chosen.as_deref(), Some("h264_amf"));
        assert_eq!(probed, vec!["h264_nvenc", "h264_qsv", "h264_amf"]);

        let none = first_working_with(list, HW_H264, |_| false);
        assert_eq!(none, None);
    }
}
