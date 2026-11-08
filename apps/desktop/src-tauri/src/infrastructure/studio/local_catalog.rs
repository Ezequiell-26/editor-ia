//! `MediaCatalog` sobre los assets del proyecto abierto.
//!
//! Es el primer adaptador real del puerto: indexa `project.assets` del
//! documento `.editoria.json` (fuente de verdad) y combina un índice de
//! enriquecimiento local (`<root>/.olyvia/catalog-index.json`) con
//! transcripts/análisis/thumbnails que los stages vayan produciendo.
//!
//! Reglas:
//! - La entrada deriva SIEMPRE del documento; el índice sólo aporta campos
//!   extra (`transcript`, `analysis`, `thumbnail`). Un asset borrado del
//!   proyecto desaparece del catálogo aunque el índice lo recuerde.
//! - `reference` es la ruta relativa al root del proyecto (nunca absoluta).
//! - Licencia y procedencia se traducen 1:1 desde `asset.rights`/`provenance`.
//! - `font`/`text` no son recursos producibles: se omiten del catálogo.
//! - `prune_missing` limpia el índice de ids que ya no existen en el
//!   documento o cuyo archivo no está en disco.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ports::studio::{
    CatalogEntry, CatalogQuery, MediaCatalog, ResourceLicense, ResourceSource,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

const INDEX_RELATIVE: &str = ".olyvia/catalog-index.json";
const INDEX_VERSION: u32 = 1;

/// Enriquecimiento por asset que el índice local persiste entre sesiones.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transcript: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    analysis: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    extra_tags: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogIndex {
    version: u32,
    entries: BTreeMap<String, IndexEntry>,
}

/// Catálogo ligado a un proyecto concreto: documento + root + índice.
pub struct LocalProjectCatalog {
    /// Ruta del `.editoria.json` abierto.
    doc_path: PathBuf,
    /// Raíz del proyecto (las rutas de assets son relativas a ella).
    root: PathBuf,
    index_path: PathBuf,
}

impl LocalProjectCatalog {
    pub fn new(doc_path: &Path, root: &Path) -> Self {
        Self {
            doc_path: doc_path.to_path_buf(),
            root: root.to_path_buf(),
            index_path: root.join(INDEX_RELATIVE),
        }
    }

    fn read_document(&self) -> Result<Value, ProjectError> {
        let raw = fs::read_to_string(&self.doc_path).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo leer el proyecto: {e}"),
            )
        })?;
        serde_json::from_str(&raw).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el documento del proyecto no es JSON válido: {e}"),
            )
        })
    }

    fn read_index(&self) -> CatalogIndex {
        let Ok(raw) = fs::read_to_string(&self.index_path) else {
            return CatalogIndex {
                version: INDEX_VERSION,
                entries: BTreeMap::new(),
            };
        };
        serde_json::from_str(&raw).unwrap_or(CatalogIndex {
            version: INDEX_VERSION,
            entries: BTreeMap::new(),
        })
    }

    fn write_index(&self, index: &CatalogIndex) -> Result<(), ProjectError> {
        if let Some(parent) = self.index_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo crear el índice: {e}"),
                )
            })?;
        }
        let payload = serde_json::to_string_pretty(index)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
        let tmp = self.index_path.with_extension("json.tmp");
        fs::write(&tmp, payload)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        fs::rename(&tmp, &self.index_path)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))
    }

    /// Traduce un `asset` del documento a `CatalogEntry`. `None` si el kind
    /// no es un recurso producible.
    fn asset_to_entry(&self, asset: &Value, index: &CatalogIndex) -> Option<CatalogEntry> {
        let kind = match asset["kind"].as_str()? {
            "video" => StudioResourceKind::Video,
            "image" => StudioResourceKind::Image,
            "audio" => StudioResourceKind::Audio,
            _ => return None,
        };
        let id = asset["id"].as_str()?.to_owned();
        let reference = asset["source"]["path"].as_str()?.to_owned();
        let enrichment = index.entries.get(&id);

        let mut tags: Vec<String> = asset["tags"]
            .as_array()
            .map(|tags| {
                tags.iter()
                    .filter_map(|t| t.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        if let Some(extra) = enrichment {
            tags.extend(extra.extra_tags.iter().cloned());
        }

        let license = &asset["rights"]["license"];
        let commercial_use = license["commercialUse"]
            .as_str()
            .and_then(|raw| {
                serde_json::from_value::<CommercialUseRequirement>(Value::String(raw.to_owned()))
                    .ok()
            })
            .unwrap_or_default();
        let provenance = &asset["rights"]["provenance"];

        let media = &asset["media"];
        Some(CatalogEntry {
            id,
            kind,
            reference,
            duration_frames: media["durationFrames"].as_u64(),
            width: media["width"].as_u64().map(|v| v as u32),
            height: media["height"].as_u64().map(|v| v as u32),
            tags,
            transcript: enrichment.and_then(|e| e.transcript.clone()),
            analysis: enrichment.and_then(|e| e.analysis.clone()),
            thumbnail: enrichment.and_then(|e| e.thumbnail.clone()),
            source: ResourceSource {
                provider: match provenance["origin"].as_str() {
                    Some("user-imported") | Some("template-default") => "project-asset".to_owned(),
                    Some("downloaded") => "downloaded".to_owned(),
                    Some("generated-by-provider") | Some("generated-locally") => provenance
                        ["provider"]
                        .as_str()
                        .map(|p| format!("generation:{p}"))
                        .unwrap_or_else(|| "generation:local".to_owned()),
                    _ => "project-asset".to_owned(),
                },
                author: provenance["provider"].as_str().map(str::to_owned),
                license: ResourceLicense {
                    id: license["id"].as_str().unwrap_or("unknown").to_owned(),
                    commercial_use,
                    url: license["url"].as_str().map(str::to_owned),
                },
                source_url: asset["source"]["url"]
                    .as_str()
                    .or_else(|| provenance["sourceUrl"].as_str())
                    .map(str::to_owned),
                attribution: license["attributionText"].as_str().map(str::to_owned),
                sha256: asset["integrity"]["sha256"].as_str().map(str::to_owned),
            },
        })
    }

    fn all_entries(&self) -> Result<Vec<CatalogEntry>, ProjectError> {
        let doc = self.read_document()?;
        let index = self.read_index();
        let entries = doc["assets"]
            .as_array()
            .map(|assets| {
                assets
                    .iter()
                    .filter_map(|asset| self.asset_to_entry(asset, &index))
                    .collect()
            })
            .unwrap_or_default();
        Ok(entries)
    }
}

impl MediaCatalog for LocalProjectCatalog {
    fn search(&self, query: &CatalogQuery) -> Result<Vec<CatalogEntry>, ProjectError> {
        let text = query.text.as_deref().map(str::to_lowercase);
        let mut results: Vec<CatalogEntry> = self
            .all_entries()?
            .into_iter()
            .filter(|entry| {
                if let Some(kind) = query.kind {
                    if entry.kind != kind {
                        return false;
                    }
                }
                if !query.tags.is_empty()
                    && !query
                        .tags
                        .iter()
                        .any(|tag| entry.tags.iter().any(|t| t == tag))
                {
                    return false;
                }
                if let Some(text) = &text {
                    let haystack =
                        format!("{} {} {}", entry.id, entry.reference, entry.tags.join(" "))
                            .to_lowercase();
                    if !haystack.contains(text.as_str()) {
                        return false;
                    }
                }
                true
            })
            .collect();
        results.sort_by(|a, b| a.id.cmp(&b.id));
        results.truncate(query.limit.max(1) as usize);
        Ok(results)
    }

    fn get(&self, id: &str) -> Result<Option<CatalogEntry>, ProjectError> {
        Ok(self.all_entries()?.into_iter().find(|entry| entry.id == id))
    }

    /// Fusiona el enriquecimiento en el índice. Los campos que vienen en la
    /// entrada (transcript/analysis/thumbnail/extra_tags vía `tags` no aplica:
    /// los tags del documento ganan) se guardan por `id`. Si el id no existe
    /// en el documento, el upsert se rechaza: el catálogo no inventa assets.
    fn upsert(&self, entry: &CatalogEntry) -> Result<(), ProjectError> {
        let doc = self.read_document()?;
        let exists = doc["assets"]
            .as_array()
            .map(|assets| {
                assets
                    .iter()
                    .any(|asset| asset["id"].as_str() == Some(entry.id.as_str()))
            })
            .unwrap_or(false);
        if !exists {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el asset no existe en el proyecto: el catálogo no crea recursos",
            ));
        }
        let mut index = self.read_index();
        let slot = index.entries.entry(entry.id.clone()).or_default();
        if entry.transcript.is_some() {
            slot.transcript = entry.transcript.clone();
        }
        if entry.analysis.is_some() {
            slot.analysis = entry.analysis.clone();
        }
        if entry.thumbnail.is_some() {
            slot.thumbnail = entry.thumbnail.clone();
        }
        self.write_index(&index)
    }

    /// Quita del índice ids que ya no están en el documento o cuyo archivo
    /// falta en disco. Devuelve cuántas entradas se podaron.
    fn prune_missing(&self) -> Result<u32, ProjectError> {
        let doc = self.read_document()?;
        let mut index = self.read_index();
        let before = index.entries.len();
        index.entries.retain(|id, _| {
            let asset = doc["assets"].as_array().and_then(|assets| {
                assets
                    .iter()
                    .find(|asset| asset["id"].as_str() == Some(id.as_str()))
            });
            match asset {
                None => false,
                Some(asset) => {
                    let rel = asset["source"]["path"].as_str().unwrap_or("");
                    crate::media::resolve_inside_root(&self.root, rel)
                        .map(|p| p.is_file())
                        .unwrap_or(false)
                }
            }
        });
        let pruned = (before - index.entries.len()) as u32;
        if pruned > 0 {
            self.write_index(&index)?;
        }
        Ok(pruned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("catalog-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("media")).unwrap();
        fs::write(dir.join("media/clip.mp4"), b"fake").unwrap();
        fs::write(
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
                        "license": { "id": "user-declared", "commercialUse": "allowed" },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                    },
                    "media": { "width": 1920, "height": 1080, "durationFrames": 300, "frameRate": 30 },
                    "tags": ["broll"]
                }, {
                    "id": "f1",
                    "label": "Font",
                    "kind": "font",
                    "status": "ready",
                    "source": { "type": "local", "path": "media/font.ttf" },
                    "rights": {
                        "license": { "id": "user-declared", "commercialUse": "allowed" },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                    }
                }]
            })
            .to_string(),
        )
        .unwrap();
        dir
    }

    #[test]
    fn indexes_project_assets_and_skips_fonts() {
        let dir = fixture_dir("basic");
        let catalog = LocalProjectCatalog::new(&dir.join("project.editoria.json"), &dir);
        let all = catalog.search(&CatalogQuery::default()).unwrap();
        assert_eq!(all.len(), 1);
        let entry = &all[0];
        assert_eq!(entry.id, "a1");
        assert_eq!(entry.kind, StudioResourceKind::Video);
        assert_eq!(entry.reference, "media/clip.mp4");
        assert_eq!(entry.width, Some(1920));
        assert_eq!(entry.duration_frames, Some(300));
        assert_eq!(entry.source.provider, "project-asset");
        assert_eq!(entry.tags, vec!["broll".to_owned()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_merges_enrichment_and_get_returns_it() {
        let dir = fixture_dir("upsert");
        let catalog = LocalProjectCatalog::new(&dir.join("project.editoria.json"), &dir);
        catalog
            .upsert(&CatalogEntry {
                id: "a1".to_owned(),
                kind: StudioResourceKind::Video,
                reference: String::new(),
                duration_frames: None,
                width: None,
                height: None,
                tags: vec![],
                transcript: Some("hola mundo".to_owned()),
                analysis: Some(serde_json::json!({"scenes": 2})),
                thumbnail: Some("media/clip.jpg".to_owned()),
                source: ResourceSource {
                    provider: String::new(),
                    author: None,
                    license: ResourceLicense {
                        id: String::new(),
                        commercial_use: CommercialUseRequirement::Allowed,
                        url: None,
                    },
                    source_url: None,
                    attribution: None,
                    sha256: None,
                },
            })
            .unwrap();
        let got = catalog.get("a1").unwrap().unwrap();
        assert_eq!(got.transcript.as_deref(), Some("hola mundo"));
        assert_eq!(got.analysis, Some(serde_json::json!({"scenes": 2})));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_rejects_unknown_asset_ids() {
        let dir = fixture_dir("reject");
        let catalog = LocalProjectCatalog::new(&dir.join("project.editoria.json"), &dir);
        let entry = catalog.get("a1").unwrap().unwrap();
        let mut fake = entry.clone();
        fake.id = "ghost".to_owned();
        assert!(catalog.upsert(&fake).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_missing_drops_index_entries_without_asset_or_file() {
        let dir = fixture_dir("prune");
        let catalog = LocalProjectCatalog::new(&dir.join("project.editoria.json"), &dir);
        // Siembra entradas huérfanas directo en el índice.
        let index_path = dir.join(INDEX_RELATIVE);
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(
            &index_path,
            serde_json::json!({
                "version": 1,
                "entries": {
                    "a1": { "transcript": "ok" },
                    "ghost": { "transcript": "huérfano" }
                }
            })
            .to_string(),
        )
        .unwrap();
        let pruned = catalog.prune_missing().unwrap();
        assert_eq!(pruned, 1);
        let index: CatalogIndex =
            serde_json::from_str(&fs::read_to_string(&index_path).unwrap()).unwrap();
        assert!(index.entries.contains_key("a1"));
        assert!(!index.entries.contains_key("ghost"));
        let _ = fs::remove_dir_all(&dir);
    }
}
