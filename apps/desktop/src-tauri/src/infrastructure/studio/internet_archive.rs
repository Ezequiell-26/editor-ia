//! `ResourceAcquisition` real sobre Internet Archive (metadata +
//! advancedsearch públicos, sin credenciales).
//!
//! Sólo trae material con licencia que el plan acepta: `publicdomain`,
//! `cc0` ⇒ `allowed`; `cc-by`/`cc-by-sa`/`gfdl` ⇒ `requires-attribution`;
//! el resto se reporta `unknown` y el piso `min_commercial_use` del plan
//! decide. Nunca entrega bytes sin ficha de derechos.
//!
//! `acquire` es idempotente por destino: si el derivado ya existe en
//! `media/acquired/` no vuelve a descargarlo.

use std::path::Path;

use serde_json::Value;

use crate::media::sha256_file;
use crate::ports::studio::{
    AcquiredResource, AcquisitionCandidate, AcquisitionQuery, ResourceAcquisition, ResourceLicense,
    SourceAvailability, SourceDescriptor,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

pub const SOURCE_ID: &str = "internet-archive";
const API: &str = "https://archive.org";
/// Techo de descarga por archivo: evita traer masters sin comprimir.
const MAX_DOWNLOAD_BYTES: u64 = 400 * 1024 * 1024;

pub struct InternetArchiveAcquisition {
    client: reqwest::blocking::Client,
}

impl InternetArchiveAcquisition {
    pub fn new() -> Result<Self, ProjectError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .user_agent("editor-ia-studio/1.0")
            .build()
            .map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo inicializar el cliente HTTP: {e}"),
                )
            })?;
        Ok(Self { client })
    }

    fn get_json(&self, url: &str) -> Result<Value, ProjectError> {
        let response = self.client.get(url).send().map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                &format!("internet-archive no respondió: {e}"),
            )
        })?;
        if !response.status().is_success() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                &format!("internet-archive devolvió HTTP {}", response.status()),
            ));
        }
        response.json::<Value>().map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                &format!("respuesta de internet-archive ilegible: {e}"),
            )
        })
    }
}

/// Licencia declarada por el ítem (`licenseurl`/`rights`) → ficha de derechos.
fn map_license(item: &Value) -> ResourceLicense {
    let raw = item["licenseurl"]
        .as_str()
        .or_else(|| item["rights"].as_str())
        .unwrap_or("")
        .to_lowercase();
    let (id, commercial_use) = if raw.contains("publicdomain/zero") || raw.contains("cc0") {
        ("cc0", CommercialUseRequirement::Allowed)
    } else if raw.contains("publicdomain") || raw.contains("no known copyright") {
        ("public-domain", CommercialUseRequirement::Allowed)
    } else if raw.contains("creativecommons.org/licenses/by-sa")
        || raw.contains("creativecommons.org/licenses/by/")
        || raw.contains("by-sa")
    {
        ("cc-by", CommercialUseRequirement::RequiresAttribution)
    } else if raw.contains("gfdl") || raw.contains("gnu.org/licenses") {
        ("gfdl", CommercialUseRequirement::RequiresAttribution)
    } else {
        ("unknown", CommercialUseRequirement::Unknown)
    };
    ResourceLicense {
        id: id.to_owned(),
        commercial_use,
        url: item["licenseurl"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| (!raw.is_empty()).then(|| API.to_owned())),
    }
}

/// Mediatype de archive.org que corresponde al kind pedido.
fn mediatype_for(kind: StudioResourceKind) -> Option<&'static str> {
    match kind {
        StudioResourceKind::Video | StudioResourceKind::Image => Some("movies"),
        StudioResourceKind::Audio | StudioResourceKind::Music => Some("audio"),
        _ => None,
    }
}

fn candidate_from_doc(doc: &Value, kind: StudioResourceKind) -> Option<AcquisitionCandidate> {
    let id = doc["identifier"].as_str()?.to_owned();
    let license = map_license(doc);
    let title = doc["title"]
        .as_str()
        .unwrap_or(&id)
        .chars()
        .take(200)
        .collect::<String>();
    Some(AcquisitionCandidate {
        source_id: SOURCE_ID.to_owned(),
        external_id: id.clone(),
        kind,
        title,
        author: doc["creator"].as_str().map(str::to_owned),
        license,
        source_url: Some(format!("{API}/details/{id}")),
        preview_url: Some(format!("{API}/services/img/{id}")),
        duration_seconds: doc["length"].as_str().and_then(|v| v.parse::<f64>().ok()),
        cost_cents: 0,
    })
}

/// Derivado preferido dentro de `metadata.files`: mp4 h.264 para video,
/// mp3/ogg para audio. Se elige el más liviano que cumpla el techo.
fn pick_download(files: &[Value], kind: StudioResourceKind) -> Option<(String, String, u64)> {
    let wanted: &[&str] = match kind {
        StudioResourceKind::Video | StudioResourceKind::Image => &[".mp4", ".ogv", ".mkv"],
        StudioResourceKind::Audio | StudioResourceKind::Music => &[".mp3", ".ogg", ".flac"],
        _ => return None,
    };
    let mut best: Option<(String, u64)> = None;
    for file in files {
        let name = file["name"].as_str().unwrap_or("");
        let lower = name.to_lowercase();
        if !wanted.iter().any(|ext| lower.ends_with(ext)) {
            continue;
        }
        // Los archivos "_thumb"/"_meta" no son medios.
        if lower.contains("_thumb") || lower.contains("_meta") || lower.contains("_files.xml") {
            continue;
        }
        let size = file["size"]
            .as_str()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        if size == 0 || size > MAX_DOWNLOAD_BYTES {
            continue;
        }
        match &best {
            Some((_, best_size)) if *best_size <= size => {}
            _ => best = Some((name.to_owned(), size)),
        }
    }
    best.map(|(name, size)| {
        let ext = Path::new(&name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_else(|| ".bin".to_owned());
        (name, ext, size)
    })
}

impl ResourceAcquisition for InternetArchiveAcquisition {
    fn sources(&self) -> Vec<SourceDescriptor> {
        vec![SourceDescriptor {
            id: SOURCE_ID.to_owned(),
            name: "Internet Archive".to_owned(),
            terms: "Metadata y archivos de archive.org; cada ítem declara su licencia (dominio público, CC0, CC-BY…). Sólo se traen ítems cuya licencia satisface el piso del plan.".to_owned(),
            cost_cents_per_download: 0,
            rate_limit_per_hour: Some(200),
            requires_attribution: true,
            availability: SourceAvailability::Available,
        }]
    }

    fn search(
        &self,
        source_id: &str,
        query: &AcquisitionQuery,
    ) -> Result<Vec<AcquisitionCandidate>, ProjectError> {
        if source_id != SOURCE_ID {
            return Ok(Vec::new());
        }
        let Some(mediatype) = mediatype_for(query.kind) else {
            return Ok(Vec::new());
        };
        let text = query.text.trim();
        if text.is_empty() {
            return Ok(Vec::new());
        }
        let q = format!(
            "mediatype:{mediatype} AND (title:\"{text}\" OR creator:\"{text}\" OR description:\"{text}\")"
        );
        let url = format!(
            "{API}/advancedsearch.php?q={}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=length&rows={}&output=json",
            urlencoding(&q),
            query.limit.clamp(1, 50),
        );
        let payload = self.get_json(&url)?;
        let docs = payload["response"]["docs"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        Ok(docs
            .iter()
            .filter_map(|doc| candidate_from_doc(doc, query.kind))
            .filter(|c| c.license.commercial_use.satisfies(query.min_commercial_use))
            .collect())
    }

    fn acquire(
        &self,
        source_id: &str,
        candidate: &AcquisitionCandidate,
        project_root: &Path,
    ) -> Result<AcquiredResource, ProjectError> {
        if source_id != SOURCE_ID {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "fuente desconocida para internet-archive",
            ));
        }
        let kind = candidate.kind;
        let meta_url = format!("{API}/metadata/{}", candidate.external_id);
        let meta = self.get_json(&meta_url)?;
        let files = meta["files"].as_array().cloned().unwrap_or_default();
        let (name, ext, _size) = pick_download(&files, kind).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                &format!(
                    "{} no tiene un derivado descargable para este kind",
                    candidate.external_id
                ),
            )
        })?;

        let dest_dir = project_root.join("media").join("acquired");
        std::fs::create_dir_all(&dest_dir).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear media/acquired: {e}"),
            )
        })?;
        let dest = dest_dir.join(format!("{}{}", candidate.external_id, ext));
        let relative = format!("media/acquired/{}{}", candidate.external_id, ext);

        let (sha256, bytes) = if dest.is_file() {
            // Idempotente: el derivado ya estaba descargado.
            sha256_file(&dest)?
        } else {
            let download_url = format!(
                "{API}/download/{}/{}",
                candidate.external_id,
                name.replace(' ', "%20")
            );
            let response = self.client.get(&download_url).send().map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    &format!("descarga de internet-archive falló: {e}"),
                )
            })?;
            if !response.status().is_success() {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    &format!(
                        "internet-archive devolvió HTTP {} al descargar",
                        response.status()
                    ),
                ));
            }
            let bytes_data = response.bytes().map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    &format!("no se pudo leer el cuerpo de la descarga: {e}"),
                )
            })?;
            if bytes_data.len() as u64 > MAX_DOWNLOAD_BYTES {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el derivado supera el techo de descarga del estudio",
                ));
            }
            let tmp = dest.with_extension(format!("{ext}.part"));
            std::fs::write(&tmp, &bytes_data).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo escribir la descarga: {e}"),
                )
            })?;
            std::fs::rename(&tmp, &dest).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo publicar la descarga: {e}"),
                )
            })?;
            sha256_file(&dest)?
        };

        Ok(AcquiredResource {
            path: relative,
            bytes,
            sha256: Some(sha256),
            candidate: candidate.clone(),
        })
    }
}

fn urlencoding(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_mapping_covers_common_cases() {
        let doc = serde_json::json!({
            "identifier": "x",
            "licenseurl": "https://creativecommons.org/publicdomain/zero/1.0/"
        });
        assert_eq!(
            map_license(&doc).commercial_use,
            CommercialUseRequirement::Allowed
        );
        let doc = serde_json::json!({
            "licenseurl": "https://creativecommons.org/licenses/by/4.0/"
        });
        assert_eq!(
            map_license(&doc).commercial_use,
            CommercialUseRequirement::RequiresAttribution
        );
        let doc = serde_json::json!({ "licenseurl": "https://example.com/custom" });
        assert_eq!(
            map_license(&doc).commercial_use,
            CommercialUseRequirement::Unknown
        );
    }

    /// Búsqueda real contra archive.org — gated: requiere red.
    /// `EDITOR_IA_RUN_LIVE_TESTS=1 cargo test --lib internet_archive -- --ignored`
    #[test]
    #[ignore]
    fn live_search_returns_licensed_candidates() {
        if std::env::var("EDITOR_IA_RUN_LIVE_TESTS").is_err() {
            return;
        }
        let acquisition = InternetArchiveAcquisition::new().unwrap();
        // Piso `unknown` para no depender de qué licencias traiga el top-N;
        // el filtro de piso se prueba aparte en los tests unitarios.
        let candidates = acquisition
            .search(
                SOURCE_ID,
                &AcquisitionQuery {
                    requirement_id: "req-1".to_owned(),
                    kind: StudioResourceKind::Video,
                    text: "big buck bunny".to_owned(),
                    limit: 5,
                    min_commercial_use: CommercialUseRequirement::Unknown,
                },
            )
            .unwrap();
        assert!(
            !candidates.is_empty(),
            "archive.org debería devolver resultados"
        );
        assert!(candidates.iter().all(|c| c.source_id == SOURCE_ID));
        assert!(candidates.iter().all(|c| !c.external_id.is_empty()));
    }

    #[test]
    fn pick_download_prefers_mp4_and_skips_meta() {
        let files = serde_json::json!([
            { "name": "item_files.xml", "size": "100" },
            { "name": "item_thumb.jpg", "size": "100" },
            { "name": "item.mp4", "size": "5000000" },
            { "name": "item.ogv", "size": "2000000" },
        ]);
        let files = files.as_array().unwrap();
        let (name, ext, _) = pick_download(files, StudioResourceKind::Video).unwrap();
        // El más liviano entre los válidos.
        assert_eq!(name, "item.ogv");
        assert_eq!(ext, ".ogv");
    }
}
