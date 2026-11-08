//! Dominio puro de proxies de vista previa.
//!
//! El proxy es un MP4 H.264/AAC de 960×540 o 1280×720 en
//! `<root>/media/proxies/proxy-<assetId>-<quality>-<mtimeMs>-<bytes>.mp4`.
//! La huella (mtime+bytes) en el nombre es la invalidación de caché: si el
//! origen cambia, el proxy viejo queda `upToDate: false` y se regenera.
//!
//! Contrato frontend (camelCase, ver `ProxyStatus` en `services/project-service.ts`):
//! - `proxy_status(assetId)` → ProxyStatus (nunca genera)
//! - `ensure_proxy(assetId, quality?)` → ProxyStatus (arranca en background)
//! - `cancel_proxy(assetId)` → ProxyStatus
//! - `cleanup_proxies(assetId?)` → { removed, bytesFreed }
//! - evento `proxy-progress` con `{ assetId, quality, state, percent, phase }`

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

pub const PROXY_DIR: &str = "media/proxies";
pub const DEFAULT_QUALITY: &str = "540p";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub asset_id: String,
    pub state: String,
    pub quality: Option<String>,
    pub path: Option<String>,
    pub exists: bool,
    pub up_to_date: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub percent: f64,
    pub phase: String,
    pub error: Option<String>,
    pub source_mtime_ms: Option<u64>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProgressEvent {
    pub asset_id: String,
    pub quality: String,
    pub state: String,
    pub percent: f64,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyCleanupResult {
    pub removed: u64,
    pub bytes_freed: u64,
}

/// Candidato de proxy encontrado en `media/proxies` para un asset.
#[derive(Debug, Clone)]
pub struct ExistingProxy {
    pub file: std::path::PathBuf,
    pub quality: String,
    pub mtime_ms: u64,
    pub up_to_date: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn normalized(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn parse_quality(value: &str) -> Option<&'static str> {
    match value {
        "540p" => Some("540p"),
        "720p" => Some("720p"),
        _ => None,
    }
}

pub fn scale_for(quality: &str) -> (&'static str, u32, u32) {
    if quality == "720p" {
        ("scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", 1280, 720)
    } else {
        ("scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", 960, 540)
    }
}

/// Nombre canónico del proxy; el orden lo fija el contrato del backend.
pub fn proxy_file_name(asset_id: &str, quality: &str, mtime_ms: u64, bytes: u64) -> String {
    format!("proxy-{asset_id}-{quality}-{mtime_ms}-{bytes}.mp4")
}

/// (quality, mtime, bytes) desde el nombre, o None si no es un proxy nuestro.
pub fn parse_proxy_name(name: &str) -> Option<(String, u64, u64)> {
    let stem = name.strip_suffix(".mp4")?;
    let mut parts = stem.rsplitn(4, '-');
    let bytes = parts.next()?.parse::<u64>().ok()?;
    let mtime = parts.next()?.parse::<u64>().ok()?;
    let quality = parse_quality(parts.next()?)?;
    Some((quality.to_owned(), mtime, bytes))
}

/// Id del asset dentro del nombre `proxy-<assetId>-<quality>-<mtime>-<bytes>.mp4`.
/// El assetId puede tener guiones (UUID): se toma todo lo que queda después de
/// quitar los tres últimos segmentos numéricos/cualidad. `None` si el nombre
/// no es un proxy nuestro.
pub fn proxy_asset_id(name: &str) -> Option<String> {
    let stem = name.strip_prefix("proxy-")?.strip_suffix(".mp4")?;
    let mut parts = stem.rsplitn(4, '-');
    parts.next()?.parse::<u64>().ok()?;
    parts.next()?.parse::<u64>().ok()?;
    parse_quality(parts.next()?)?;
    let asset_id = parts.next()?;
    if asset_id.is_empty() {
        None
    } else {
        Some(asset_id.to_owned())
    }
}

/// Encoder de video a usar para proxies: GPU si existe, libx264 si no.
pub fn proxy_video_args(hardware: Option<&str>) -> Vec<String> {
    let Some(encoder) = hardware else {
        return vec![
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "26".into(),
        ];
    };
    let mut args = vec!["-c:v".into(), encoder.to_owned()];
    if encoder.ends_with("_nvenc") {
        args.extend(["-preset".into(), "p1".into(), "-cq".into(), "30".into()]);
    } else if encoder.ends_with("_amf") {
        // AMF no comparte el preset textual de NVENC.
        args.extend([
            "-quality".into(),
            "speed".into(),
            "-rc".into(),
            "cqp".into(),
            "-qp_i".into(),
            "30".into(),
            "-qp_p".into(),
            "30".into(),
        ]);
    } else if encoder.ends_with("_qsv") {
        args.extend([
            "-preset".into(),
            "veryfast".into(),
            "-global_quality".into(),
            "30".into(),
        ]);
    }
    args
}

/// Parsea `out_time_us=` del stream `-progress pipe:1` y devuelve el
/// porcentaje 0–99 para la duración dada. Líneas ajenas → None.
pub fn progress_percent_from_line(line: &str, duration_seconds: f64) -> Option<f64> {
    let raw = line.strip_prefix("out_time_us=")?.trim();
    let micros = raw.parse::<f64>().ok()?;
    if duration_seconds <= 0.0 {
        return None;
    }
    Some((micros / 1_000_000.0 / duration_seconds * 100.0).clamp(0.0, 99.0))
}

/// Estado inicial "missing" para un asset sin proxy ni job en curso.
pub fn empty_status(asset_id: &str) -> ProxyStatus {
    ProxyStatus {
        asset_id: asset_id.to_owned(),
        state: "missing".to_owned(),
        quality: None,
        path: None,
        exists: false,
        up_to_date: false,
        width: None,
        height: None,
        bytes: None,
        duration_seconds: None,
        percent: 0.0,
        phase: "missing".to_owned(),
        error: None,
        source_mtime_ms: None,
        updated_at_ms: now_ms(),
    }
}

/// Elige el mejor candidato: prefiere el que coincide con la huella del
/// origen; a igual condición, el de mtime más reciente.
pub fn pick_existing(candidates: Vec<ExistingProxy>) -> Option<ExistingProxy> {
    let mut best: Option<ExistingProxy> = None;
    for candidate in candidates {
        let replace = match &best {
            None => true,
            Some(current) => {
                (!current.up_to_date && candidate.up_to_date)
                    || (current.up_to_date == candidate.up_to_date
                        && candidate.mtime_ms > current.mtime_ms)
            }
        };
        if replace {
            best = Some(candidate);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nombre_y_parseo_de_proxy() {
        let name = proxy_file_name("11111111-2222-4333-8444-555555555555", "720p", 100, 200);
        assert_eq!(
            name,
            "proxy-11111111-2222-4333-8444-555555555555-720p-100-200.mp4"
        );
        let parsed = parse_proxy_name(&name).expect("parsea");
        assert_eq!(parsed.0, "720p");
        assert_eq!(parsed.1, 100);
        assert_eq!(parsed.2, 200);
        assert!(parse_proxy_name("otro.mp4").is_none());
        assert!(parse_proxy_name(&name.replace("720p", "999p")).is_none());
    }

    #[test]
    fn calidad_y_escala_estan_acotadas() {
        assert_eq!(parse_quality("540p"), Some("540p"));
        assert_eq!(parse_quality("1080p"), None);
        let (filter, width, height) = scale_for("720p");
        assert!(filter.contains("1280"));
        assert_eq!((width, height), (1280, 720));
        let (filter, width, height) = scale_for("540p");
        assert!(filter.contains("960"));
        assert_eq!((width, height), (960, 540));
    }

    #[test]
    fn la_huella_del_origen_se_lee_del_nombre() {
        let name = proxy_file_name("a", "540p", 1_700_000_000_000, 42);
        let (quality, mtime, bytes) = parse_proxy_name(&name).expect("parsea");
        assert_eq!(quality, "540p");
        assert_eq!(mtime, 1_700_000_000_000);
        assert_eq!(bytes, 42);
    }

    #[test]
    fn el_progreso_sale_del_out_time_us() {
        assert_eq!(
            progress_percent_from_line("out_time_us=5000000", 10.0),
            Some(50.0)
        );
        assert_eq!(
            progress_percent_from_line("out_time_us=99999999", 10.0),
            Some(99.0)
        );
        assert_eq!(progress_percent_from_line("frame=120", 10.0), None);
        assert_eq!(progress_percent_from_line("out_time_us=1", 0.0), None);
    }

    #[test]
    fn pick_existing_prefiere_la_huella_vigente() {
        let stale = ExistingProxy {
            file: Path::new("a.mp4").to_path_buf(),
            quality: "540p".to_owned(),
            mtime_ms: 1,
            up_to_date: false,
        };
        let fresh = ExistingProxy {
            file: Path::new("b.mp4").to_path_buf(),
            quality: "720p".to_owned(),
            mtime_ms: 2,
            up_to_date: true,
        };
        let picked = pick_existing(vec![stale, fresh]).expect("hay candidato");
        assert!(picked.up_to_date);
        assert_eq!(picked.quality, "720p");
    }
}
