//! Perfil adaptativo de encode para el pipeline de descargas.
//!
//! La detección de encoders ya existe para proxies/exportación; acá se traduce
//! a una decisión única: GPU dedicada -> hardware; si no, CPU multihilo con un
//! preset barato. La decisión se toma una vez por descarga y se reutiliza para
//! todos los videos del lote.

use std::path::Path;

use crate::commands::audio::detect_hardware;

#[derive(Debug, Clone)]
pub struct PipelineProfile {
    /// Etiqueta legible para logs y UI: NVENC, AMF, QSV, CPU.
    pub label: String,
    /// Argumentos completos de `-c:v` (incluye encoder, preset y calidad).
    pub args: Vec<String>,
    /// Aceleración de decodificación previa al `-i`, si corresponde.
    pub hwaccel: Option<String>,
    pub hardware: bool,
    pub low_memory: bool,
}

impl PipelineProfile {
    pub fn software() -> Self {
        Self {
            label: "CPU · HEVC ultrafast".to_owned(),
            args: vec![
                "-c:v".into(),
                "libx265".into(),
                "-preset".into(),
                "ultrafast".into(),
                "-crf".into(),
                "24".into(),
                "-threads".into(),
                "0".into(),
            ],
            hwaccel: None,
            hardware: false,
            low_memory: true,
        }
    }

    /// Perfil para tests sin depender del hardware del runner. También es el
    /// encode del look manual cuando se pide un asset H.265 de calidad.
    pub fn software_hq() -> Self {
        Self {
            label: "CPU · HEVC veryfast".to_owned(),
            args: vec![
                "-c:v".into(),
                "libx265".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "20".into(),
            ],
            hwaccel: None,
            hardware: false,
            low_memory: false,
        }
    }
}

#[cfg(windows)]
fn total_ram_gb() -> Option<u64> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetPhysicallyInstalledSystemMemory(total_memory_in_kilobytes: *mut u64) -> i32;
    }
    let mut kilobytes = 0u64;
    // SAFETY: el puntero apunta a un u64 local y la API sólo escribe allí.
    let ok = unsafe { GetPhysicallyInstalledSystemMemory(&mut kilobytes) };
    if ok == 0 {
        None
    } else {
        Some((kilobytes / (1024 * 1024)).max(1))
    }
}

#[cfg(not(windows))]
fn total_ram_gb() -> Option<u64> {
    None
}

fn cpu_profile(low_memory: bool) -> PipelineProfile {
    // El pipeline final siempre es H.265/HEVC. En CPU se usa x265 ultrafast
    // (baja latencia) y con RAM ajustada se sube un punto el CRF para bajar
    // CPU y memoria. El perfil se informa en las advertencias del resultado.
    let args = vec![
        "-c:v".into(),
        "libx265".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-crf".into(),
        if low_memory { "24" } else { "23" }.into(),
        "-threads".into(),
        "0".into(),
    ];
    PipelineProfile {
        label: if low_memory {
            "CPU · HEVC ultrafast · RAM ajustada".to_owned()
        } else {
            "CPU · HEVC ultrafast".to_owned()
        },
        args,
        hwaccel: None,
        hardware: false,
        low_memory,
    }
}

/// Elige el encoder de mayor valor disponible. En esta máquina el probe real
/// decide; no se asume una marca por el nombre del sistema.
pub fn detect(ffmpeg: &Path) -> PipelineProfile {
    let ram = total_ram_gb();
    let low_memory = ram.is_some_and(|gb| gb <= 9);
    let hardware = detect_hardware(ffmpeg);
    // Se exige HEVC también en hardware: si el equipo sólo ofrece H.264 se
    // prefiere x265 ultrafast para que el asset final sea siempre H.265.
    if let Some(encoder) = hardware.hevc.as_ref() {
        let is_nvenc = encoder.ends_with("_nvenc");
        let is_amf = encoder.ends_with("_amf");
        let is_qsv = encoder.ends_with("_qsv");
        let mut args = vec!["-c:v".into(), encoder.clone()];
        if is_nvenc {
            // p3 = perfil rápido de NVENC, con tuning de baja latencia.
            args.extend([
                "-preset".into(),
                "p3".into(),
                "-cq".into(),
                "23".into(),
                "-tune".into(),
                "ll".into(),
            ]);
        } else if is_amf {
            args.extend([
                "-quality".into(),
                "speed".into(),
                "-rc".into(),
                "cqp".into(),
                "-qp_i".into(),
                "23".into(),
                "-qp_p".into(),
                "23".into(),
            ]);
        } else if is_qsv {
            args.extend([
                "-preset".into(),
                "fast".into(),
                "-global_quality".into(),
                "23".into(),
            ]);
        }
        let label = if is_nvenc {
            "NVIDIA · NVENC"
        } else if is_amf {
            "AMD · AMF"
        } else if is_qsv {
            "Intel · QSV"
        } else {
            "GPU"
        };
        return PipelineProfile {
            label: label.to_owned(),
            args,
            hwaccel: is_nvenc.then(|| "cuda".to_owned()),
            hardware: true,
            low_memory,
        };
    }
    cpu_profile(low_memory)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn software_profile_is_hevc_fast_and_bounded() {
        let profile = PipelineProfile::software();
        assert!(profile.args.iter().any(|arg| arg == "libx265"));
        assert!(profile.args.iter().any(|arg| arg == "ultrafast"));
        assert!(profile.args.iter().any(|arg| arg == "24"));
        assert!(!profile.hardware);
    }

    #[test]
    fn hq_software_profile_keeps_hevc_veryfast() {
        let profile = PipelineProfile::software_hq();
        assert!(profile.args.iter().any(|arg| arg == "libx265"));
        assert!(profile.args.iter().any(|arg| arg == "veryfast"));
        assert!(profile.args.iter().any(|arg| arg == "20"));
    }

    #[test]
    fn cpu_profile_uses_more_crf_only_when_ram_is_tight() {
        let normal = cpu_profile(false);
        let low = cpu_profile(true);
        assert!(normal.args.iter().any(|arg| arg == "libx265"));
        assert!(normal.args.iter().any(|arg| arg == "23"));
        assert!(low.args.iter().any(|arg| arg == "24"));
        assert!(normal.args.iter().any(|arg| arg == "ultrafast"));
        assert!(low.label.contains("RAM ajustada"));
        assert!(!normal.hardware);
    }
}
