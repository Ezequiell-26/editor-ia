//! `StageExecutor` real sobre el proyecto abierto: las primeras etapas del
//! pipeline que el editor puede ejecutar HOY sin providers externos.
//!
//! - `plan`: re-valida el `ProductionPlan` embebido en la corrida (la
//!   validación en `production_create` ya ocurrió; aquí se verifica que el
//!   documento persistido sigue siendo íntegro).
//! - `acquire`: si el plan no pide recursos externos cierra sin gasto; si
//!   pide, resuelve cada requisito contra la biblioteca local del proyecto
//!   (`LocalCatalogAcquisition`, coste 0, derechos verificados). Lo que la
//!   biblioteca no satisface falla `fatal` con `requires_provider` — no hay
//!   fuentes externas configuradas y simularlas sería deshonesto.
//! - `analyze`: indexa los assets del proyecto en el `LocalProjectCatalog`
//!   y reporta conteos por tipo + archivos faltantes. Es la primera pasada
//!   de análisis real; el análisis profundo (escenas, transcript, objetos)
//!   se enchufa después sobre este mismo catálogo.
//!
//! Las etapas `scenes`, `edit`, `render`, `review` y `deliver` NO están en
//! `supported_stages`: el orquestador las rechazará hasta que existan sus
//! ejecutores reales.

use serde_json::{json, Value};

use crate::infrastructure::studio::local_catalog::LocalProjectCatalog;
use crate::ports::studio::{
    ContentGenerator, GenerationRequest, MediaCatalog, ResourceAcquisition, StageContext,
    StageExecutor,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{ProductionPlan, StudioResourceKind, StudioStage};
use crate::studio::run::StageOutcome;

pub struct ProjectStageExecutor {
    /// ffprobe para medir los archivos que `acquire` trae de fuentes
    /// externas y registrarlos como assets del proyecto. `None` ⇒ la
    /// adquisición remota no puede producir assets válidos y se omite.
    ffprobe: Option<std::path::PathBuf>,
}

impl ProjectStageExecutor {
    pub fn new(ffprobe: Option<std::path::PathBuf>) -> Self {
        Self { ffprobe }
    }
}

impl StageExecutor for ProjectStageExecutor {
    fn supported_stages(&self) -> Vec<StudioStage> {
        vec![
            StudioStage::Plan,
            StudioStage::Acquire,
            StudioStage::Analyze,
        ]
    }

    fn execute(
        &self,
        stage: StudioStage,
        ctx: &StageContext,
    ) -> Result<StageOutcome, ProjectError> {
        match stage {
            StudioStage::Plan => self.plan_stage(ctx),
            StudioStage::Acquire => self.acquire_stage(ctx),
            StudioStage::Analyze => self.analyze_stage(ctx),
            other => Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some(format!("la etapa {other:?} no tiene ejecutor real todavía")),
                fatal: true,
                in_progress: false,
            }),
        }
    }
}

impl ProjectStageExecutor {
    fn plan_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let plan: ProductionPlan = serde_json::from_value(ctx.plan.clone()).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el plan embebido en la corrida no es válido: {e}"),
            )
        })?;
        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(0),
            output: Some(json!({
                "planId": plan.id,
                "validated": true,
            })),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }

    fn acquire_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let plan: ProductionPlan = serde_json::from_value(ctx.plan.clone()).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el plan embebido en la corrida no es válido: {e}"),
            )
        })?;
        if plan.requirements.is_empty() {
            return Ok(StageOutcome {
                completed: true,
                cost_cents: Some(0),
                output: Some(json!({
                    "acquired": 0,
                    "note": "el plan no pide recursos externos",
                })),
                error: None,
                fatal: false,
                in_progress: false,
            });
        }
        // Adquisición real en dos pisos: primero la biblioteca local del
        // proyecto (`LocalCatalogAcquisition`, coste 0, derechos verificados);
        // después Internet Archive para lo que la biblioteca no satisface.
        // Los recursos remotos se registran como `project.assets` para que
        // `analyze`/`scenes`/`edit` los vean en etapas siguientes. Sin ffprobe
        // no se puede medir el archivo ⇒ la fuente remota se omite y el
        // requisito queda `requires_provider` como antes.
        let local = crate::infrastructure::studio::local_acquisition::LocalCatalogAcquisition::new(
            &ctx.document_path,
            &ctx.project_root,
        );
        let remote = if self.ffprobe.is_some() {
            crate::infrastructure::studio::internet_archive::InternetArchiveAcquisition::new().ok()
        } else {
            None
        };
        let mut acquisitions: Vec<&dyn ResourceAcquisition> = vec![&local];
        if let Some(remote) = remote.as_ref() {
            acquisitions.push(remote);
        }
        let mut acquired = Vec::new();
        let mut cost_cents = 0u32;
        let mut unsatisfied = Vec::new();
        let mut seen: std::collections::BTreeSet<(String, String)> =
            std::collections::BTreeSet::new();
        for req in &plan.requirements {
            // Los requisitos `voice` los satisface el generador local
            // (SAPI de Windows), no las fuentes de adquisición: son
            // contenido creado, no buscado.
            if req.kind == StudioResourceKind::Voice {
                match self.acquire_voice(ctx, req, &plan.id) {
                    Ok(entries) => acquired.extend(entries),
                    Err(_) => unsatisfied.push(req.id.clone()),
                }
                continue;
            }
            let query = crate::ports::studio::AcquisitionQuery {
                requirement_id: req.id.clone(),
                kind: req.kind,
                text: req.query.clone(),
                // Ventana amplia: muchos ítems de archive.org no declaran
                // licencia o no tienen derivado descargable; hace falta
                // margen para encontrar uno que cumpla ambas condiciones.
                limit: (req.max_count.max(1) * 10).min(50),
                min_commercial_use: req.min_commercial_use,
            };
            let mut found = 0u32;
            'outer: for acquisition in &acquisitions {
                let sources = acquisition.sources();
                for source in &sources {
                    let Ok(candidates) = acquisition.search(&source.id, &query) else {
                        continue;
                    };
                    for candidate in candidates {
                        if found >= req.max_count.max(1) {
                            break 'outer;
                        }
                        if !seen
                            .insert((candidate.source_id.clone(), candidate.external_id.clone()))
                        {
                            continue;
                        }
                        match acquisition.acquire(&source.id, &candidate, &ctx.project_root) {
                            Ok(resource) => {
                                // Los recursos remotos deben entrar al
                                // documento para que etapas posteriores los
                                // resuelvan; si el registro falla se trata
                                // como candidato no aprovechable.
                                let asset_id = if candidate.source_id
                                    == crate::infrastructure::studio::local_acquisition::PROJECT_ASSETS_SOURCE
                                {
                                    None
                                } else {
                                    match self.register_remote_asset(ctx, &resource, &candidate) {
                                        Ok(id) => Some(id),
                                        Err(_) => {
                                            seen.remove(&(
                                                candidate.source_id.clone(),
                                                candidate.external_id.clone(),
                                            ));
                                            continue;
                                        }
                                    }
                                };
                                cost_cents = cost_cents.saturating_add(candidate.cost_cents);
                                acquired.push(json!({
                                    "requirementId": req.id,
                                    "path": resource.path,
                                    "bytes": resource.bytes,
                                    "externalId": candidate.external_id,
                                    "sourceId": candidate.source_id,
                                    "assetId": asset_id,
                                }));
                                found += 1;
                            }
                            Err(_) => {
                                seen.remove(&(
                                    candidate.source_id.clone(),
                                    candidate.external_id.clone(),
                                ));
                            }
                        }
                    }
                }
            }
            if found == 0 {
                unsatisfied.push(req.id.clone());
            }
        }
        if !unsatisfied.is_empty() {
            return Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some(format!(
                    "requires_provider: {} requisito(s) sin recurso local que los satisfaga: {}",
                    unsatisfied.len(),
                    unsatisfied.join(", ")
                )),
                fatal: true,
                in_progress: false,
            });
        }
        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(cost_cents as u64),
            output: Some(json!({
                "acquired": acquired.len(),
                "resources": acquired,
                "sources": acquisitions
                    .iter()
                    .flat_map(|a| a.sources().into_iter().map(|s| s.id))
                    .collect::<Vec<_>>(),
            })),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }

    /// Genera la narración pedida por un requisito `voice` con el
    /// `ContentGenerator` local (SAPI) y registra cada WAV como asset
    /// `audio` del proyecto. Devuelve las entradas `resources` del output.
    fn acquire_voice(
        &self,
        ctx: &StageContext,
        req: &crate::studio::plan::ResourceRequirement,
        plan_id: &str,
    ) -> Result<Vec<Value>, ProjectError> {
        let generator = crate::infrastructure::studio::local_voice::LocalVoiceGenerator::new();
        let mut entries = Vec::new();
        for i in 0..req.max_count.max(1) {
            let request = GenerationRequest {
                request_id: format!("{plan_id}-{}-{i}", req.id),
                kind: StudioResourceKind::Voice,
                prompt: req.query.clone(),
                duration_seconds: None,
                voice: req.voice.clone(),
                params: json!({}),
            };
            let result = generator.generate(&request, &ctx.project_root)?;
            let asset_id = self.register_generated_asset(
                ctx,
                &result.path,
                generator.provider_id(),
                &req.query,
            )?;
            entries.push(json!({
                "requirementId": req.id,
                "path": result.path,
                "bytes": result.bytes,
                "externalId": request.request_id,
                "sourceId": generator.provider_id(),
                "assetId": asset_id,
            }));
        }
        Ok(entries)
    }

    /// Registra un archivo generado localmente (voz, etc.) como
    /// `project.assets`. Mismo contrato que `register_remote_asset`:
    /// ffprobe para `media.*`, escritura atómica, idempotente por path.
    fn register_generated_asset(
        &self,
        ctx: &StageContext,
        rel_path: &str,
        provider: &str,
        title: &str,
    ) -> Result<String, ProjectError> {
        let ffprobe = self.ffprobe.clone().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "ffprobe no está disponible para medir el recurso generado",
            )
        })?;
        let abs = crate::media::resolve_inside_root(&ctx.project_root, rel_path)?;
        let measure = crate::media::probe_file(&ffprobe, &abs, crate::media::MediaKind::Audio)?;
        let (sha256, bytes) = crate::media::sha256_file(&abs)?;

        let raw = std::fs::read_to_string(&ctx.document_path).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo leer el proyecto: {e}"),
            )
        })?;
        let mut doc: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidJson,
                &format!("el documento del proyecto no es JSON válido: {e}"),
            )
        })?;
        let project_fps_num = doc["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as u32;
        let project_fps_den = doc["video"]["frameRate"]["den"].as_u64().unwrap_or(1) as u32;
        let seconds = measure.duration_seconds.unwrap_or(0.0);
        let frames = if seconds > 0.0 && project_fps_num > 0 && project_fps_den > 0 {
            ((seconds * project_fps_num as f64 / project_fps_den as f64).round() as u64).max(1)
        } else {
            1
        };
        let assets = doc["assets"].as_array_mut().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el proyecto no tiene assets",
            )
        })?;
        if let Some(existing) = assets
            .iter()
            .find(|a| a["source"]["path"].as_str() == Some(rel_path))
        {
            return Ok(existing["id"].as_str().unwrap_or_default().to_owned());
        }
        let asset_id = uuid::Uuid::new_v4().to_string();
        assets.push(json!({
            "id": asset_id,
            "label": title.chars().take(200).collect::<String>(),
            "kind": "audio",
            "source": { "type": "local", "path": rel_path },
            "status": "ready",
            "integrity": { "sha256": sha256, "bytes": bytes },
            "rights": {
                "license": { "id": "user-generated", "commercialUse": "allowed" },
                "provenance": {
                    "origin": "generated-locally",
                    "provider": provider,
                    "acquiredAt": crate::projects::service::now_rfc3339(),
                },
            },
            "media": {
                "sampleRate": measure.sample_rate.unwrap_or(48_000),
                "channels": measure.channels.unwrap_or(2),
                "durationFrames": frames,
            },
        }));
        let payload = serde_json::to_string_pretty(&doc).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("no se pudo serializar el proyecto: {e}"),
            )
        })?;
        let tmp = ctx.document_path.with_extension("json.tmp");
        std::fs::write(&tmp, payload).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo escribir el proyecto: {e}"),
            )
        })?;
        std::fs::rename(&tmp, &ctx.document_path).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo publicar el proyecto: {e}"),
            )
        })?;
        Ok(asset_id)
    }

    /// Registra un recurso remoto como `project.assets` para que el
    /// catálogo local (y por tanto `scenes`/`edit`) lo vea. Mide el archivo
    /// con ffprobe, escribe el documento atómicamente y es idempotente por
    /// `source.path`. Devuelve el id del asset.
    fn register_remote_asset(
        &self,
        ctx: &StageContext,
        resource: &crate::ports::studio::AcquiredResource,
        candidate: &crate::ports::studio::AcquisitionCandidate,
    ) -> Result<String, ProjectError> {
        let ffprobe = self.ffprobe.clone().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "ffprobe no está disponible para medir el recurso adquirido",
            )
        })?;
        let abs = crate::media::resolve_inside_root(&ctx.project_root, &resource.path)?;
        let kind = match candidate.kind {
            crate::studio::plan::StudioResourceKind::Video => crate::media::MediaKind::Video,
            crate::studio::plan::StudioResourceKind::Image => crate::media::MediaKind::Image,
            crate::studio::plan::StudioResourceKind::Audio
            | crate::studio::plan::StudioResourceKind::Music => crate::media::MediaKind::Audio,
            _ => {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el recurso adquirido no es un kind montable",
                ))
            }
        };
        let measure = crate::media::probe_file(&ffprobe, &abs, kind)?;

        let raw = std::fs::read_to_string(&ctx.document_path).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo leer el proyecto: {e}"),
            )
        })?;
        let mut doc: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidJson,
                &format!("el documento del proyecto no es JSON válido: {e}"),
            )
        })?;
        let project_fps_num = doc["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as u32;
        let project_fps_den = doc["video"]["frameRate"]["den"].as_u64().unwrap_or(1) as u32;
        let assets = doc["assets"].as_array_mut().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el proyecto no tiene assets",
            )
        })?;
        if let Some(existing) = assets
            .iter()
            .find(|a| a["source"]["path"].as_str() == Some(resource.path.as_str()))
        {
            return Ok(existing["id"].as_str().unwrap_or_default().to_owned());
        }
        let mut media = serde_json::Map::new();
        match kind {
            crate::media::MediaKind::Video => {
                media.insert("width".into(), json!(measure.width.unwrap_or(1)));
                media.insert("height".into(), json!(measure.height.unwrap_or(1)));
                let seconds = measure.duration_seconds.unwrap_or(0.0);
                let frames = if seconds > 0.0 && project_fps_num > 0 && project_fps_den > 0 {
                    ((seconds * project_fps_num as f64 / project_fps_den as f64).round() as u64)
                        .max(1)
                } else {
                    1
                };
                media.insert("durationFrames".into(), json!(frames));
                media.insert(
                    "frameRate".into(),
                    json!({
                        "num": measure.frame_rate_num.unwrap_or(project_fps_num.max(1)),
                        "den": measure.frame_rate_den.unwrap_or(project_fps_den.max(1)),
                    }),
                );
            }
            crate::media::MediaKind::Image => {
                media.insert("width".into(), json!(measure.width.unwrap_or(1)));
                media.insert("height".into(), json!(measure.height.unwrap_or(1)));
            }
            crate::media::MediaKind::Audio => {
                let seconds = measure.duration_seconds.unwrap_or(0.0);
                let frames = if seconds > 0.0 && project_fps_num > 0 && project_fps_den > 0 {
                    ((seconds * project_fps_num as f64 / project_fps_den as f64).round() as u64)
                        .max(1)
                } else {
                    1
                };
                media.insert(
                    "sampleRate".into(),
                    json!(measure.sample_rate.unwrap_or(48_000)),
                );
                media.insert("channels".into(), json!(measure.channels.unwrap_or(2)));
                media.insert("durationFrames".into(), json!(frames));
            }
        }

        let commercial_use = serde_json::to_value(candidate.license.commercial_use)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".to_owned());
        let mut license = serde_json::Map::new();
        license.insert("id".into(), json!(candidate.license.id));
        license.insert("commercialUse".into(), json!(commercial_use));
        if let Some(url) = &candidate.license.url {
            license.insert("url".into(), json!(url));
        }
        let mut provenance = serde_json::Map::new();
        provenance.insert("origin".into(), json!("downloaded"));
        provenance.insert(
            "acquiredAt".into(),
            json!(crate::projects::service::now_rfc3339()),
        );
        provenance.insert("provider".into(), json!(candidate.source_id));
        if let Some(url) = &candidate.source_url {
            provenance.insert("sourceUrl".into(), json!(url));
        }
        let asset_id = uuid::Uuid::new_v4().to_string();
        assets.push(json!({
            "id": asset_id,
            "label": candidate.title.chars().take(200).collect::<String>(),
            "kind": kind.as_str(),
            "source": { "type": "local", "path": resource.path },
            "status": "ready",
            "integrity": { "sha256": resource.sha256, "bytes": resource.bytes },
            "rights": {
                "license": Value::Object(license),
                "provenance": Value::Object(provenance),
            },
            "media": Value::Object(media),
        }));
        let payload = serde_json::to_string_pretty(&doc).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("no se pudo serializar el proyecto: {e}"),
            )
        })?;
        let tmp = ctx.document_path.with_extension("json.tmp");
        std::fs::write(&tmp, payload).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo escribir el proyecto: {e}"),
            )
        })?;
        std::fs::rename(&tmp, &ctx.document_path).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo publicar el proyecto: {e}"),
            )
        })?;
        Ok(asset_id)
    }

    fn analyze_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let catalog = LocalProjectCatalog::new(&ctx.document_path, &ctx.project_root);
        let entries = catalog.search(&Default::default())?;
        let mut by_kind: std::collections::BTreeMap<String, u64> =
            std::collections::BTreeMap::new();
        let mut missing = 0u32;
        for entry in &entries {
            let key = format!("{:?}", entry.kind).to_lowercase();
            *by_kind.entry(key).or_insert(0) += 1;
            let on_disk = crate::media::resolve_inside_root(&ctx.project_root, &entry.reference)
                .map(|p| p.is_file())
                .unwrap_or(false);
            if !on_disk {
                missing += 1;
            }
        }
        // Registra el índice en el catálogo: queda disponible para las
        // etapas siguientes y para el IPC `catalog_search`.
        let _ = catalog.prune_missing();
        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(0),
            output: Some(json!({
                "indexedAssets": entries.len(),
                "missingFiles": missing,
                "byKind": by_kind,
                "catalog": "local-project",
            })),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::plan::{
        CommercialUseRequirement, ProductionBrief, ProductionPlan, ProductionTarget,
        QualityCriteria, StudioResourceKind,
    };
    use std::fs;

    fn plan(requirements: usize) -> ProductionPlan {
        ProductionPlan {
            schema_version: 1,
            id: "p1".to_owned(),
            created_at: String::new(),
            updated_at: String::new(),
            brief: ProductionBrief {
                objective: "t".to_owned(),
                audience: None,
                tone: None,
                key_points: vec![],
            },
            target: ProductionTarget {
                platform: Default::default(),
                aspect_ratio: "16:9".to_owned(),
                target_duration_frames: 300,
                render_profile_id: None,
            },
            requirements: (0..requirements)
                .map(|i| crate::studio::plan::ResourceRequirement {
                    id: format!("req-{i}"),
                    kind: StudioResourceKind::Video,
                    query: "test".to_owned(),
                    max_count: 1,
                    min_commercial_use: Default::default(),
                    prefer_local: true,
                    optional: false,
                    voice: None,
                })
                .collect(),
            scenes: vec![],
            subtitles: Default::default(),
            music: Default::default(),
            transition: None,
            quality: QualityCriteria {
                required_checks: vec![],
                min_vmaf: None,
                loudness_target_lufs: None,
            },
            max_cost_cents: None,
            stage: Default::default(),
        }
    }

    fn ctx(plan: &ProductionPlan, root: &std::path::Path) -> StageContext {
        StageContext {
            project_root: root.to_path_buf(),
            document_path: root.join("project.json"),
            plan: serde_json::to_value(plan).unwrap(),
            remaining_budget_cents: None,
            attempt: 1,
            previous_output: None,
            stage_outputs: serde_json::json!({}),
        }
    }

    #[test]
    fn plan_stage_validates_the_embedded_plan() {
        let dir = std::env::temp_dir().join(format!("exec-plan-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let executor = ProjectStageExecutor::new(None);
        let outcome = executor
            .execute(StudioStage::Plan, &ctx(&plan(0), &dir))
            .unwrap();
        assert!(outcome.completed);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn acquire_without_requirements_completes_at_zero_cost() {
        let dir = std::env::temp_dir().join(format!("exec-acq0-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let executor = ProjectStageExecutor::new(None);
        let outcome = executor
            .execute(StudioStage::Acquire, &ctx(&plan(0), &dir))
            .unwrap();
        assert!(outcome.completed);
        assert_eq!(outcome.cost_cents, Some(0));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn acquire_with_requirements_fails_as_requires_provider() {
        let dir = std::env::temp_dir().join(format!("exec-acq1-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let executor = ProjectStageExecutor::new(None);
        let outcome = executor
            .execute(StudioStage::Acquire, &ctx(&plan(2), &dir))
            .unwrap();
        assert!(!outcome.completed);
        assert!(outcome.fatal);
        assert!(outcome.error.unwrap().contains("requires_provider"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn acquire_satisfies_requirement_from_local_library() {
        let dir = std::env::temp_dir().join(format!("exec-acq-local-{}", std::process::id()));
        fs::create_dir_all(dir.join("media")).unwrap();
        fs::write(dir.join("media/a.mp4"), b"video").unwrap();
        fs::write(
            dir.join("project.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "assets": [{
                    "id": "a1", "label": "A", "kind": "video", "status": "ready",
                    "source": { "type": "local", "path": "media/a.mp4" },
                    "rights": {
                        "license": { "id": "user-declared", "commercialUse": "allowed" },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                    }
                }]
            })
            .to_string(),
        )
        .unwrap();
        let executor = ProjectStageExecutor::new(None);
        let mut plan = plan(1);
        plan.requirements[0].query = String::new();
        let outcome = executor
            .execute(StudioStage::Acquire, &ctx(&plan, &dir))
            .unwrap();
        assert!(outcome.completed, "{:?}", outcome.error);
        assert_eq!(outcome.cost_cents, Some(0));
        let output = outcome.output.unwrap();
        assert_eq!(output["acquired"], 1);
        assert_eq!(output["resources"][0]["externalId"], "a1");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn analyze_indexes_project_assets() {
        let dir = std::env::temp_dir().join(format!("exec-ana-{}", std::process::id()));
        fs::create_dir_all(dir.join("media")).unwrap();
        fs::write(dir.join("media/a.mp4"), b"x").unwrap();
        fs::write(
            dir.join("project.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "assets": [{
                    "id": "a1", "label": "A", "kind": "video", "status": "ready",
                    "source": { "type": "local", "path": "media/a.mp4" },
                    "rights": {
                        "license": { "id": "user-declared", "commercialUse": "allowed" },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                    }
                }]
            })
            .to_string(),
        )
        .unwrap();
        let executor = ProjectStageExecutor::new(None);
        let outcome = executor
            .execute(StudioStage::Analyze, &ctx(&plan(0), &dir))
            .unwrap();
        assert!(outcome.completed);
        let output = outcome.output.unwrap();
        assert_eq!(output["indexedAssets"], 1);
        assert_eq!(output["missingFiles"], 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Adquisición remota REAL: descarga un derivado de archive.org, lo
    /// registra como asset del proyecto y el catálogo lo resuelve.
    /// `EDITOR_IA_RUN_LIVE_TESTS=1 cargo test acquire_remote -- --ignored`
    #[test]
    #[ignore]
    fn acquire_remote_downloads_and_registers_project_asset() {
        if std::env::var("EDITOR_IA_RUN_LIVE_TESTS").is_err() {
            eprintln!("adquisición remota omitida: definí EDITOR_IA_RUN_LIVE_TESTS=1");
            return;
        }
        let ffprobe = std::path::PathBuf::from(
            std::env::var("EDITOR_IA_FFPROBE").unwrap_or_else(|_| "ffprobe".to_owned()),
        );
        let dir = std::env::temp_dir().join(format!(
            "exec-acq-remote-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        ));
        fs::create_dir_all(dir.join("media")).unwrap();
        fs::write(
            dir.join("project.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "video": { "frameRate": { "num": 30, "den": 1 } },
                "assets": []
            })
            .to_string(),
        )
        .unwrap();
        let executor = ProjectStageExecutor::new(Some(ffprobe));
        let mut plan = plan(1);
        plan.requirements[0].query = "big buck bunny".to_owned();
        plan.requirements[0].min_commercial_use = CommercialUseRequirement::Unknown;
        let outcome = executor
            .execute(StudioStage::Acquire, &ctx(&plan, &dir))
            .unwrap();
        assert!(outcome.completed, "{:?}", outcome.error);
        let output = outcome.output.unwrap();
        assert_eq!(output["acquired"], 1, "{output}");
        let asset_id = output["resources"][0]["assetId"]
            .as_str()
            .expect("el recurso remoto debe registrarse como asset")
            .to_owned();
        let path = output["resources"][0]["path"].as_str().unwrap().to_owned();
        assert!(dir.join(&path).is_file(), "el archivo debe existir: {path}");

        // El documento quedó con el asset y el catálogo lo resuelve con duración.
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        assert!(doc["assets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["id"] == asset_id));
        let catalog = LocalProjectCatalog::new(&dir.join("project.json"), &dir);
        let entry = catalog.get(&asset_id).unwrap().expect("asset en catálogo");
        assert_eq!(entry.kind, StudioResourceKind::Video);
        assert!(entry.duration_frames.unwrap_or(0) > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Generación de voz REAL: un requisito `voice` sintetiza un WAV con
    /// SAPI, lo registra como asset `audio` y el catálogo lo resuelve.
    /// `EDITOR_IA_RUN_LIVE_TESTS=1 cargo test acquire_voice -- --ignored`
    #[test]
    #[ignore]
    fn acquire_voice_generates_registers_and_indexes_asset() {
        if std::env::var("EDITOR_IA_RUN_LIVE_TESTS").is_err() {
            eprintln!("generación de voz omitida: definí EDITOR_IA_RUN_LIVE_TESTS=1");
            return;
        }
        let ffprobe = std::path::PathBuf::from(
            std::env::var("EDITOR_IA_FFPROBE").unwrap_or_else(|_| "ffprobe".to_owned()),
        );
        let dir = std::env::temp_dir().join(format!(
            "exec-acq-voice-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        ));
        fs::create_dir_all(dir.join("media")).unwrap();
        fs::write(
            dir.join("project.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "video": { "frameRate": { "num": 30, "den": 1 } },
                "assets": []
            })
            .to_string(),
        )
        .unwrap();
        let executor = ProjectStageExecutor::new(Some(ffprobe));
        let mut plan = plan(1);
        plan.requirements[0].kind = StudioResourceKind::Voice;
        plan.requirements[0].query = "Hola, esto es una prueba de voz".to_owned();
        let outcome = executor
            .execute(StudioStage::Acquire, &ctx(&plan, &dir))
            .unwrap();
        assert!(outcome.completed, "{:?}", outcome.error);
        assert_eq!(outcome.cost_cents, Some(0));
        let output = outcome.output.unwrap();
        assert_eq!(output["acquired"], 1, "{output}");
        assert_eq!(output["resources"][0]["sourceId"], "windows-sapi");
        let asset_id = output["resources"][0]["assetId"]
            .as_str()
            .expect("la voz generada debe registrarse como asset")
            .to_owned();
        let path = output["resources"][0]["path"].as_str().unwrap().to_owned();
        assert!(dir.join(&path).is_file(), "el WAV debe existir: {path}");
        assert!(path.starts_with("media/generated/"));

        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        let asset = doc["assets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == asset_id)
            .expect("asset en el documento");
        assert_eq!(asset["kind"], "audio");
        assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");
        let catalog = LocalProjectCatalog::new(&dir.join("project.json"), &dir);
        let entry = catalog.get(&asset_id).unwrap().expect("asset en catálogo");
        assert_eq!(entry.kind, StudioResourceKind::Audio);
        assert!(entry.duration_frames.unwrap_or(0) > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_stages_are_not_advertised() {
        let executor = ProjectStageExecutor::new(None);
        let supported = executor.supported_stages();
        assert!(supported.contains(&StudioStage::Plan));
        assert!(supported.contains(&StudioStage::Acquire));
        assert!(supported.contains(&StudioStage::Analyze));
        assert!(!supported.contains(&StudioStage::Render));
        assert!(!supported.contains(&StudioStage::Deliver));
    }
}
