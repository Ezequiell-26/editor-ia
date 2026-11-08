//! `ResourceAcquisition` real sobre la biblioteca local del proyecto.
//!
//! Es el primer adaptador del puerto de adquisición: para cada requisito del
//! plan busca en el `LocalProjectCatalog` (assets ya importados por el
//! usuario), verifica el piso de derechos comerciales y que el archivo
//! exista en disco. "Adquirir" un asset local significa confirmarlo como
//! recurso del plan: los bytes ya están en el proyecto, el coste es 0 y la
//! ficha de derechos viaja en el candidato.
//!
//! Lo que NO hace: descargar nada ni inventar providers externos. Si un
//! requisito no se satisface con la biblioteca local, la etapa `acquire`
//! falla `requires_provider` — nunca simula una adquisición.

use std::path::Path;

use crate::infrastructure::studio::local_catalog::LocalProjectCatalog;
use crate::ports::studio::{
    AcquiredResource, AcquisitionCandidate, AcquisitionQuery, CatalogQuery, MediaCatalog,
    ResourceAcquisition, SourceAvailability, SourceDescriptor,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Id de la única fuente que este adaptador declara.
pub const PROJECT_ASSETS_SOURCE: &str = "project-assets";

/// Adquisición sobre los assets ya presentes en el proyecto abierto.
pub struct LocalCatalogAcquisition {
    catalog: LocalProjectCatalog,
}

impl LocalCatalogAcquisition {
    pub fn new(doc_path: &Path, root: &Path) -> Self {
        Self {
            catalog: LocalProjectCatalog::new(doc_path, root),
        }
    }

    fn entry_to_candidate(
        &self,
        entry: &crate::ports::studio::CatalogEntry,
    ) -> AcquisitionCandidate {
        AcquisitionCandidate {
            source_id: PROJECT_ASSETS_SOURCE.to_owned(),
            external_id: entry.id.clone(),
            kind: entry.kind,
            title: entry.reference.clone(),
            author: entry.source.author.clone(),
            license: entry.source.license.clone(),
            source_url: entry.source.source_url.clone(),
            preview_url: entry.thumbnail.clone(),
            duration_seconds: entry.duration_frames.map(|f| f as f64 / 30.0),
            cost_cents: 0,
        }
    }
}

impl ResourceAcquisition for LocalCatalogAcquisition {
    fn sources(&self) -> Vec<SourceDescriptor> {
        vec![SourceDescriptor {
            id: PROJECT_ASSETS_SOURCE.to_owned(),
            name: "Biblioteca del proyecto".to_owned(),
            terms: "Assets importados por el usuario; derechos según `rights` de cada asset."
                .to_owned(),
            cost_cents_per_download: 0,
            rate_limit_per_hour: None,
            requires_attribution: false,
            availability: SourceAvailability::Available,
        }]
    }

    fn search(
        &self,
        source_id: &str,
        query: &AcquisitionQuery,
    ) -> Result<Vec<AcquisitionCandidate>, ProjectError> {
        if source_id != PROJECT_ASSETS_SOURCE {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "fuente de adquisición desconocida",
            ));
        }
        let text = if query.text.trim().is_empty() {
            None
        } else {
            Some(query.text.clone())
        };
        let entries = self.catalog.search(&CatalogQuery {
            kind: Some(query.kind),
            text,
            tags: Vec::new(),
            limit: query.limit.max(1),
        })?;
        Ok(entries
            .iter()
            .filter(|entry| entry.source.license.satisfies(query.min_commercial_use))
            .map(|entry| self.entry_to_candidate(entry))
            .collect())
    }

    fn acquire(
        &self,
        source_id: &str,
        candidate: &AcquisitionCandidate,
        project_root: &Path,
    ) -> Result<AcquiredResource, ProjectError> {
        if source_id != PROJECT_ASSETS_SOURCE || candidate.source_id != PROJECT_ASSETS_SOURCE {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "fuente de adquisición desconocida",
            ));
        }
        let entry = self.catalog.get(&candidate.external_id)?.ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el asset ya no está en el catálogo del proyecto",
            )
        })?;
        // El asset debe existir en disco dentro del root (anti path-traversal
        // vía resolve_inside_root).
        let abs =
            crate::media::resolve_inside_root(project_root, &entry.reference).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "la referencia del asset escapa del root del proyecto",
                )
            })?;
        if !abs.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "el asset referenciado no existe en disco",
            ));
        }
        let bytes = std::fs::metadata(&abs).map(|m| m.len()).unwrap_or(0);
        Ok(AcquiredResource {
            path: entry.reference.clone(),
            bytes,
            sha256: entry.source.sha256.clone(),
            candidate: candidate.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::studio::ResourceAcquisition;
    use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

    fn fixture_dir(tag: &str) -> std::path::PathBuf {
        fixture_dir_with_license(tag, "allowed")
    }

    fn fixture_dir_with_license(tag: &str, commercial_use: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("acq-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("media")).unwrap();
        std::fs::write(dir.join("media/clip.mp4"), b"video").unwrap();
        std::fs::write(
            dir.join("project.editoria.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "name": "test",
                "assets": [{
                    "id": "a1",
                    "label": "Clip",
                    "kind": "video",
                    "status": "ready",
                    "source": { "type": "local", "path": "media/clip.mp4" },
                    "rights": {
                        "license": { "id": "user-declared", "commercialUse": commercial_use },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                    },
                    "media": { "width": 1920, "height": 1080, "durationFrames": 300, "frameRate": 30 }
                }]
            })
            .to_string(),
        )
        .unwrap();
        dir
    }

    #[test]
    fn search_finds_project_asset_and_acquire_confirms_it() {
        let dir = fixture_dir("ok");
        let acq = LocalCatalogAcquisition::new(&dir.join("project.editoria.json"), &dir);
        let query = AcquisitionQuery {
            requirement_id: "r1".to_owned(),
            kind: StudioResourceKind::Video,
            text: String::new(),
            limit: 5,
            min_commercial_use: CommercialUseRequirement::Allowed,
        };
        let candidates = acq.search(PROJECT_ASSETS_SOURCE, &query).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].external_id, "a1");
        let acquired = acq
            .acquire(PROJECT_ASSETS_SOURCE, &candidates[0], &dir)
            .unwrap();
        assert_eq!(acquired.path, "media/clip.mp4");
        assert_eq!(acquired.bytes, 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn license_floor_filters_candidates() {
        // Asset con licencia "unknown" (rank 0): no satisface el piso Allowed.
        let dir = fixture_dir_with_license("lic", "unknown");
        let acq = LocalCatalogAcquisition::new(&dir.join("project.editoria.json"), &dir);
        let query = AcquisitionQuery {
            requirement_id: "r1".to_owned(),
            kind: StudioResourceKind::Video,
            text: String::new(),
            limit: 5,
            min_commercial_use: CommercialUseRequirement::Allowed,
        };
        assert!(acq
            .search(PROJECT_ASSETS_SOURCE, &query)
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn acquire_rejects_missing_file_and_unknown_source() {
        let dir = fixture_dir("missing");
        let acq = LocalCatalogAcquisition::new(&dir.join("project.editoria.json"), &dir);
        std::fs::remove_file(dir.join("media/clip.mp4")).unwrap();
        let query = AcquisitionQuery {
            requirement_id: "r1".to_owned(),
            kind: StudioResourceKind::Video,
            text: String::new(),
            limit: 5,
            min_commercial_use: CommercialUseRequirement::Allowed,
        };
        let candidates = acq.search(PROJECT_ASSETS_SOURCE, &query).unwrap();
        assert!(acq
            .acquire(PROJECT_ASSETS_SOURCE, &candidates[0], &dir)
            .is_err());
        assert!(acq.acquire("otra-fuente", &candidates[0], &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
