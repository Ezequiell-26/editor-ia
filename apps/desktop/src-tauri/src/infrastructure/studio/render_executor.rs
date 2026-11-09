//! Etapas finales del pipeline: `render`, `review` y `deliver`.
//!
//! - `render`: arranca el pipeline de render REAL (`render_lifecycle::
//!   start_render`) con salida en `<root>/renders/` y sondea el job entre
//!   `advance`s vía `previous_output` (`jobId`+`outputPath`). Cuando el
//!   archivo publicado existe, lo verifica con ffprobe antes de cerrar.
//!   `RenderBusy` (hay otro render del usuario) se propaga como error
//!   reintentable: la etapa pausa y el próximo advance reintenta.
//! - `review`: corre el Quality Gate sobre el proyecto ya editado
//!   (`quality_gate::review_open_project`). Errores ⇒ etapa fallida fatal
//!   con el reporte en `output`; warnings ⇒ cierra con el reporte.
//! - `deliver`: copia el MP4 verificado a `<root>/deliverables/` y escribe
//!   `manifest.json` con plan, proyecto, calidad y fecha. El proyecto
//!   `.json` sigue siendo el entregable editable.
//!
//! El ejecutor toma `RenderDeps<'a>` prestado por el comando: sesión,
//! documentos y tools vienen de `AppState` en cada `production_advance`.

use std::fs;
use std::path::PathBuf;

use serde_json::json;
use uuid::Uuid;

use crate::application::quality_gate;
use crate::application::render_lifecycle::{self, RenderDeps};
use crate::ports::render::RenderVerifier;
use crate::ports::studio::{StageContext, StageExecutor};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::lifecycle::safe_name;
use crate::studio::plan::{ProductionPlan, StudioStage};
use crate::studio::run::StageOutcome;

pub struct RenderReviewDeliverExecutor<'a> {
    deps: RenderDeps<'a>,
    verifier: &'a dyn RenderVerifier,
}

impl<'a> RenderReviewDeliverExecutor<'a> {
    pub fn new(deps: RenderDeps<'a>, verifier: &'a dyn RenderVerifier) -> Self {
        Self { deps, verifier }
    }

    fn read_plan(&self, ctx: &StageContext) -> Result<ProductionPlan, ProjectError> {
        serde_json::from_value(ctx.plan.clone()).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el plan embebido en la corrida no es válido: {e}"),
            )
        })
    }

    fn render_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        // Sondeo de un render ya arrancado.
        if let Some(prev) = ctx.previous_output.as_ref() {
            let job_id = prev["jobId"].as_str().unwrap_or_default().to_owned();
            let output_path = PathBuf::from(prev["outputPath"].as_str().unwrap_or_default());
            if output_path.is_file() {
                let ffprobe = self.deps.tools.ffprobe_path().ok_or_else(|| {
                    ProjectError::message(
                        ProjectErrorCode::RenderFailed,
                        "ffprobe no está disponible para verificar la salida",
                    )
                })?;
                let verification = self.verifier.verify(&ffprobe, &output_path)?;
                return Ok(StageOutcome {
                    completed: true,
                    cost_cents: Some(0),
                    output: Some(json!({
                        "jobId": job_id,
                        "outputPath": output_path.to_string_lossy(),
                        "verification": verification,
                    })),
                    error: None,
                    fatal: false,
                    in_progress: false,
                });
            }
            // El archivo todavía no está: ¿sigue corriendo NUESTRO job?
            let active = self.deps.runtime.first_id();
            return match active.as_deref() {
                Some(active_id) if active_id == job_id => Ok(StageOutcome {
                    completed: false,
                    cost_cents: None,
                    output: Some(prev.clone()),
                    error: None,
                    fatal: false,
                    in_progress: true,
                }),
                _ => {
                    let detail = self.render_failure_detail(&job_id);
                    Ok(StageOutcome {
                        completed: false,
                        cost_cents: None,
                        output: Some(prev.clone()),
                        error: Some(match detail {
                            Some(detail) => format!(
                                "el render terminó sin publicar el archivo de salida: {detail}"
                            ),
                            None => {
                                "el render terminó sin publicar el archivo de salida".to_owned()
                            }
                        }),
                        fatal: true,
                        in_progress: false,
                    })
                }
            };
        }

        // Primer intento: arranca el render real con salida dedicada.
        let plan = self.read_plan(ctx)?;
        let renders_dir = ctx.project_root.join("renders");
        fs::create_dir_all(&renders_dir)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        let output_path = renders_dir.join(format!(
            "{}-{}.mp4",
            safe_name(&plan.id),
            &Uuid::new_v4().simple().to_string()[..8]
        ));
        let profile_id = plan.target.render_profile_id.clone();
        let include_captions = plan.subtitles.enabled;
        let started = render_lifecycle::start_render(
            &self.deps,
            profile_id,
            include_captions,
            None,
            None,
            None,
            Some(output_path.clone()),
        )?;
        let Some(started) = started else {
            return Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some("el render no arrancó".to_owned()),
                fatal: true,
                in_progress: false,
            });
        };
        Ok(StageOutcome {
            completed: false,
            cost_cents: None,
            output: Some(json!({
                "jobId": started.job_id,
                "outputPath": output_path.to_string_lossy(),
                "profile": started.profile_name,
            })),
            error: None,
            fatal: false,
            in_progress: true,
        })
    }

    /// Último motivo de fallo del render `job_id`, persistido por el worker
    /// en `<cache>/render-<job>.log` (stderr saneado de ffmpeg o el error
    /// de verificación/publicación). Se recorta a los últimos ~800 chars.
    fn render_failure_detail(&self, job_id: &str) -> Option<String> {
        let log = self.deps.cache_dir.join(format!("render-{job_id}.log"));
        let body = fs::read_to_string(log).ok()?;
        let tail: String = body
            .chars()
            .rev()
            .take(800)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let tail = tail.trim().to_owned();
        (!tail.is_empty()).then_some(tail)
    }

    fn review_stage(&self, _ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let summary = quality_gate::review_open_project(self.deps.session, self.deps.documents)?;
        let report = json!({
            "passed": summary.passed,
            "errors": summary.errors,
            "warnings": summary.warnings,
            "findings": summary.findings,
        });
        if summary.errors > 0 {
            return Ok(StageOutcome {
                completed: false,
                cost_cents: Some(0),
                output: Some(report),
                error: Some(format!(
                    "quality gate: {} error(es) en el proyecto editado",
                    summary.errors
                )),
                fatal: true,
                in_progress: false,
            });
        }
        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(0),
            output: Some(report),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }

    fn deliver_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let plan = self.read_plan(ctx)?;
        let render_output = ctx.stage_outputs["render"]["outputPath"]
            .as_str()
            .map(PathBuf::from)
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "la etapa render no produjo una salida verificable",
                )
            })?;
        if !render_output.is_file() {
            return Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some("el archivo renderizado ya no existe en disco".to_owned()),
                fatal: true,
                in_progress: false,
            });
        }
        let deliver_dir = ctx.project_root.join("deliverables");
        fs::create_dir_all(&deliver_dir)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        let video_name = format!("{}.mp4", safe_name(&plan.id));
        let video_path = deliver_dir.join(&video_name);
        fs::copy(&render_output, &video_path).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo copiar la entrega: {e}"),
            )
        })?;
        let manifest = json!({
            "version": 1,
            "planId": plan.id,
            "producedAt": ctx.stage_outputs["render"]["verification"]["path"],
            "video": video_name,
            "renderOutput": render_output.to_string_lossy(),
            "projectDocument": ctx.document_path.file_name().map(|n| n.to_string_lossy()),
            "quality": ctx.stage_outputs["review"],
            "editableProject": "el archivo .json del proyecto junto a deliverables/ es la fuente editable",
        });
        let manifest_path = deliver_dir.join(format!("{}.manifest.json", safe_name(&plan.id)));
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".to_owned()),
        )
        .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(0),
            output: Some(json!({
                "deliverablesDir": deliver_dir.to_string_lossy(),
                "video": video_path.to_string_lossy(),
                "manifest": manifest_path.to_string_lossy(),
            })),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }
}

impl<'a> StageExecutor for RenderReviewDeliverExecutor<'a> {
    fn supported_stages(&self) -> Vec<StudioStage> {
        vec![
            StudioStage::Render,
            StudioStage::Review,
            StudioStage::Deliver,
        ]
    }

    fn execute(
        &self,
        stage: StudioStage,
        ctx: &StageContext,
    ) -> Result<StageOutcome, ProjectError> {
        match stage {
            StudioStage::Render => self.render_stage(ctx),
            StudioStage::Review => self.review_stage(ctx),
            StudioStage::Deliver => self.deliver_stage(ctx),
            other => Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some(format!("el ejecutor de entrega no soporta {other:?}")),
                fatal: true,
                in_progress: false,
            }),
        }
    }
}

#[cfg(test)]
mod e2e_tests {
    //! Pipeline completo contra ffmpeg/ffprobe REALES. Ignorado por defecto:
    //! `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test production_e2e -- --ignored`.
    //! Usa el fixture `sample-vertical-slice` del project-schema como
    //! documento base y genera los medios con lavfi.

    use super::*;
    use crate::application::production;
    use crate::infrastructure::render_jobs::{
        LocalRenderFiles, SharedRenderRuntime, StdioRenderLauncher, SystemRenderEncoder,
        SystemRenderVerifier,
    };
    use crate::infrastructure::studio::composite::CompositeStageExecutor;
    use crate::infrastructure::studio::production_store::LocalProductionStore;
    use crate::ports::media::MediaTools;
    use crate::ports::projects::{ProjectSession, ProjectSessionInfo};
    use crate::ports::render::{RenderDialogs, RenderEvents, RenderProcess, RenderRuntime};
    use crate::ports::studio::ProductionStore;
    use crate::render::lifecycle::{RenderFinishedEvent, RenderProgressEvent};
    use crate::studio::plan::{
        PlanScene, ProductionBrief, ProductionPlan, ProductionTarget, QualityCriteria,
        ResourceRequirement, StudioResourceKind,
    };
    use crate::studio::run::RunStatus;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    fn ffmpeg() -> PathBuf {
        PathBuf::from(std::env::var("EDITOR_IA_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_owned()))
    }
    fn ffprobe() -> PathBuf {
        PathBuf::from(std::env::var("EDITOR_IA_FFPROBE").unwrap_or_else(|_| "ffprobe".to_owned()))
    }

    struct FixtureTools {
        ffmpeg: PathBuf,
        ffprobe: PathBuf,
    }
    impl MediaTools for FixtureTools {
        fn ffmpeg_path(&self) -> Option<PathBuf> {
            Some(self.ffmpeg.clone())
        }
        fn ffprobe_path(&self) -> Option<PathBuf> {
            Some(self.ffprobe.clone())
        }
    }

    struct FixtureSession {
        info: ProjectSessionInfo,
    }
    impl ProjectSession for FixtureSession {
        fn current(&self) -> Result<Option<ProjectSessionInfo>, ProjectError> {
            Ok(Some(self.info.clone()))
        }
        fn require(&self) -> Result<ProjectSessionInfo, ProjectError> {
            Ok(self.info.clone())
        }
        fn adopt(&self, _info: &ProjectSessionInfo) -> Result<(), ProjectError> {
            Ok(())
        }
        fn clear(&self) -> Result<(), ProjectError> {
            Ok(())
        }
    }

    struct NoopEvents;
    impl RenderEvents for NoopEvents {
        fn progress(&self, _event: &RenderProgressEvent) {}
        fn finished(&self, _event: &RenderFinishedEvent) {}
    }

    struct NoopDialogs;
    impl RenderDialogs for NoopDialogs {
        fn pick_output(
            &self,
            _root: &std::path::Path,
            _suggested: &str,
        ) -> Result<Option<PathBuf>, ProjectError> {
            Ok(None)
        }
        fn pick_directory(&self, _root: &std::path::Path) -> Result<Option<PathBuf>, ProjectError> {
            Ok(None)
        }
    }

    fn fixture_project(tag: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("prod-e2e-{tag}-{}", std::process::id()));
        eprintln!("fixture root: {}", root.display());
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("media")).unwrap();
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("packages")
            .join("project-schema")
            .join("fixtures")
            .join("sample-vertical-slice.editoria.json");
        let mut doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&fixture_path).unwrap()).unwrap();

        // Medios reales vía lavfi: el asset de video del fixture y su audio.
        // El audio dura 12 s para cubrir el clip (outFrame 330 a 30 fps).
        for (args, out) in [
            (
                vec![
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=duration=10:size=640x360:rate=30",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=10:sample_rate=48000",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-shortest",
                ],
                "media/demo.mp4",
            ),
            (
                vec![
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=220:duration=12:sample_rate=48000",
                    "-c:a",
                    "pcm_s16le",
                ],
                "media/narracion-escena-1.wav",
            ),
        ] {
            let mut cmd = std::process::Command::new(ffmpeg());
            cmd.args(&args)
                .arg(root.join(out).to_string_lossy().as_ref());
            let status = cmd.status().expect("ffmpeg disponible");
            assert!(status.success(), "ffmpeg falló generando {out}");
        }

        // El render verifica `integrity.bytes` contra el archivo real y las
        // dimensiones/duración contra el probe: se actualizan ambas fichas
        // con los valores de los medios generados (640x360@30, 10 s video;
        // wav 48 kHz mono, 12 s → 360 frames a 30 fps).
        for asset in doc["assets"].as_array_mut().unwrap() {
            let path = asset["source"]["path"].as_str().unwrap_or("");
            let abs = root.join(path);
            let bytes = fs::metadata(&abs).map(|m| m.len()).unwrap_or(0);
            asset["integrity"]["bytes"] = serde_json::json!(bytes);
            match asset["kind"].as_str() {
                Some("video") => {
                    asset["media"]["width"] = serde_json::json!(640);
                    asset["media"]["height"] = serde_json::json!(360);
                    asset["media"]["durationFrames"] = serde_json::json!(300);
                    asset["media"]["frameRate"] = serde_json::json!({"num": 30, "den": 1});
                }
                Some("audio") => {
                    asset["media"]["durationFrames"] = serde_json::json!(360);
                    asset["media"]["sampleRate"] = serde_json::json!(48000);
                    asset["media"]["channels"] = serde_json::json!(1);
                }
                _ => {}
            }
        }

        // El fixture trae un clip `graphic` que exige plan de motion; el E2E
        // de producción monta clips de medios, así que se quitan el clip, su
        // pista y el motion que la referencia para que el documento siga
        // siendo válido y el render no dependa de motion plans.
        let graphic_track = doc["timeline"]["clips"].as_array().and_then(|clips| {
            clips
                .iter()
                .find(|c| c["kind"].as_str() == Some("graphic"))
                .and_then(|c| c["trackId"].as_str().map(str::to_owned))
        });
        let graphic_clip = doc["timeline"]["clips"].as_array().and_then(|clips| {
            clips
                .iter()
                .find(|c| c["kind"].as_str() == Some("graphic"))
                .and_then(|c| c["id"].as_str().map(str::to_owned))
        });
        if let Some(clips) = doc["timeline"]["clips"].as_array_mut() {
            clips.retain(|c| c["kind"].as_str() != Some("graphic"));
        }
        // Las escenas del fixture listan el clip gráfico en `clipIds`:
        // quitarlo del documento deja la referencia colgada y la
        // validación v1 rechaza el proyecto.
        if let Some(clip_id) = &graphic_clip {
            if let Some(scenes) = doc["scenes"].as_array_mut() {
                for scene in scenes {
                    if let Some(ids) = scene["clipIds"].as_array_mut() {
                        ids.retain(|id| id.as_str() != Some(clip_id.as_str()));
                    }
                }
            }
        }
        if let Some(track_id) = &graphic_track {
            if let Some(tracks) = doc["timeline"]["tracks"].as_array_mut() {
                tracks.retain(|t| t["id"].as_str() != Some(track_id.as_str()));
            }
            if let Some(motion) = doc["motion"].as_array_mut() {
                motion.retain(|m| m["targetTrackId"].as_str() != Some(track_id.as_str()));
            }
        }
        let doc_path = root.join("obra.editoria.json");
        fs::write(&doc_path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();
        (root, doc_path)
    }

    fn e2e_plan() -> ProductionPlan {
        ProductionPlan {
            schema_version: 1,
            id: "e2e-plan".to_owned(),
            created_at: String::new(),
            updated_at: String::new(),
            brief: ProductionBrief {
                objective: "demostración e2e".to_owned(),
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
            requirements: vec![ResourceRequirement {
                id: "req-video".to_owned(),
                kind: StudioResourceKind::Video,
                query: "".to_owned(),
                max_count: 3,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            }],
            scenes: vec![
                PlanScene {
                    id: "scene-1".to_owned(),
                    order: 1,
                    title: "Escena E2E".to_owned(),
                    intent: "prueba".to_owned(),
                    target_duration_frames: Some(120),
                    narration_text: Some("Esto es una prueba del pipeline completo".to_owned()),
                    requirement_ids: vec!["req-video".to_owned()],
                    notes: None,
                },
                PlanScene {
                    id: "scene-2".to_owned(),
                    order: 2,
                    title: "Escena E2E 2".to_owned(),
                    intent: "cierre".to_owned(),
                    target_duration_frames: Some(90),
                    narration_text: Some("Y esto cierra la prueba".to_owned()),
                    requirement_ids: vec!["req-video".to_owned()],
                    notes: None,
                },
            ],
            subtitles: crate::studio::plan::SubtitleSpec {
                enabled: true,
                language: Some("es".to_owned()),
            },
            music: Default::default(),
            transition: Some(crate::studio::plan::PlanTransition {
                transition_type: crate::studio::plan::PlanTransitionType::Dissolve,
                frames: 24,
            }),
            quality: QualityCriteria {
                required_checks: vec![],
                min_vmaf: None,
                loudness_target_lufs: None,
            },
            max_cost_cents: None,
            stage: Default::default(),
        }
    }

    #[test]
    #[ignore = "requiere ffmpeg/ffprobe reales; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn production_e2e_runs_all_stages_to_deliverables() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("production_e2e omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let (root, doc_path) = fixture_project("full");
        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let plan = e2e_plan();
        production::create_run(&store, &plan, "e2e-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        let executor = CompositeStageExecutor::new(None).with_extra(&tail);

        let mut run = store.load("e2e-run").unwrap().unwrap();
        for _ in 0..240 {
            run = production::advance(&store, &executor, "e2e-run", &root, &doc_path).unwrap();
            if run.status == RunStatus::Done {
                break;
            }
            if run.status == RunStatus::Failed {
                panic!(
                    "la corrida falló en {:?}: {}",
                    run.current_stage,
                    run.last_error.unwrap_or_default()
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida no llegó a done: {:?}",
            run.status
        );

        let deliverables = root.join("deliverables");
        let videos: Vec<PathBuf> = fs::read_dir(&deliverables)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        let bytes = videos[0].metadata().unwrap().len();
        assert!(bytes > 10_000, "el MP4 está vacío");
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        let production_clips: Vec<&serde_json::Value> = doc["timeline"]["clips"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["label"] == "Escena E2E" || c["label"] == "Escena E2E 2")
            .collect();
        assert_eq!(production_clips.len(), 2, "faltan clips de escena");
        assert!(
            production_clips[1]["transitionIn"]["type"] == "dissolve",
            "el segundo clip no tiene transitionIn"
        );
        let cues = doc["captions"]["cues"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert!(
            cues.iter().any(|c| c["text"] == "Y esto cierra la prueba"),
            "el cue de la segunda escena no quedó en el documento"
        );
        let manifest = deliverables.join("e2e-plan.manifest.json");
        assert!(manifest.is_file(), "deliver no escribió el manifest");
        let manifest_doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&manifest).unwrap()).unwrap();
        assert_eq!(manifest_doc["planId"], "e2e-plan");
        assert_eq!(manifest_doc["quality"]["passed"], true);
        eprintln!("E2E OK: {} ({} bytes)", videos[0].display(), bytes);
        let _ = fs::remove_dir_all(&root);
    }

    /// Pipeline completo con recurso REMOTO real: el plan pide un clip que
    /// la biblioteca local no tiene ⇒ `acquire` lo baja de Internet Archive,
    /// lo registra como asset y las etapas siguientes lo montan y renderizan.
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 EDITOR_IA_RUN_LIVE_TESTS=1 cargo test
    /// production_e2e_remote -- --ignored`
    #[test]
    #[ignore = "requiere ffmpeg/ffprobe + red; correr con EDITOR_IA_RUN_RENDER_TESTS=1 EDITOR_IA_RUN_LIVE_TESTS=1"]
    fn production_e2e_remote_acquire_runs_all_stages() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1")
            || std::env::var("EDITOR_IA_RUN_LIVE_TESTS").ok().as_deref() != Some("1")
        {
            eprintln!(
                "e2e remoto omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1 y EDITOR_IA_RUN_LIVE_TESTS=1"
            );
            return;
        }
        let (root, doc_path) = fixture_project("remote");
        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let mut plan = e2e_plan();
        plan.id = "e2e-remote-plan".to_owned();
        plan.requirements = vec![ResourceRequirement {
            id: "req-remote".to_owned(),
            kind: StudioResourceKind::Video,
            // No matchea ningún asset del fixture ⇒ acquire cae a Internet Archive.
            query: "big buck bunny".to_owned(),
            max_count: 1,
            // Piso requires-attribution: archive.org devuelve ítems CC-BY y
            // el quality gate bloquea licencia `unknown` — el piso evita
            // traer material sin derechos declarados.
            min_commercial_use: crate::studio::plan::CommercialUseRequirement::RequiresAttribution,
            prefer_local: true,
            optional: false,
            voice: None,
        }];
        plan.scenes = vec![PlanScene {
            id: "scene-remote".to_owned(),
            order: 1,
            title: "Escena remota".to_owned(),
            intent: "prueba".to_owned(),
            target_duration_frames: Some(120),
            narration_text: Some("Material bajado de archive.org".to_owned()),
            requirement_ids: vec!["req-remote".to_owned()],
            notes: None,
        }];
        production::create_run(&store, &plan, "e2e-remote-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e-remote".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        // ffprobe habilita la fuente remota en `acquire`.
        let executor = CompositeStageExecutor::new(Some(ffprobe())).with_extra(&tail);

        let mut run = store.load("e2e-remote-run").unwrap().unwrap();
        for _ in 0..600 {
            run =
                production::advance(&store, &executor, "e2e-remote-run", &root, &doc_path).unwrap();
            if matches!(run.status, RunStatus::Done | RunStatus::Failed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1000));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida remota no llegó a done: {:?} — {}",
            run.status,
            run.last_error.unwrap_or_default()
        );

        // El stage acquire registró el asset remoto en el documento.
        let acquire = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Acquire)
            .unwrap();
        let resources = acquire
            .output
            .as_ref()
            .and_then(|o| o["resources"].as_array().cloned())
            .unwrap_or_default();
        assert_eq!(resources.len(), 1, "debía adquirir 1 recurso remoto");
        assert_eq!(resources[0]["sourceId"], "internet-archive");
        let asset_id = resources[0]["assetId"].as_str().unwrap().to_owned();
        let rel_path = resources[0]["path"].as_str().unwrap().to_owned();
        assert!(root.join(&rel_path).is_file());

        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        assert!(doc["assets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| { a["id"] == asset_id && a["source"]["path"] == rel_path }));
        // La escena remota quedó montada como clip de producción.
        assert!(doc["timeline"]["clips"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| { c["source"]["assetId"] == asset_id }));

        let videos: Vec<PathBuf> = fs::read_dir(root.join("deliverables"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        assert!(videos[0].metadata().unwrap().len() > 10_000);
        eprintln!(
            "E2E remoto OK: asset {} ({}), MP4 {}",
            asset_id,
            rel_path,
            videos[0].display()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Pipeline completo con NARRACIÓN generada: el plan pide un requisito
    /// `voice` ⇒ `acquire` lo sintetiza con SAPI, lo registra como asset
    /// `audio`, una escena lo monta como clip de audio y el render final lo
    /// mezcla. `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test production_e2e_voice
    /// -- --ignored`
    #[test]
    #[ignore = "requiere ffmpeg/ffprobe + SAPI de Windows; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn production_e2e_voice_narration_runs_all_stages() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("e2e voz omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let (root, doc_path) = fixture_project("voice");
        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let mut plan = e2e_plan();
        plan.id = "e2e-voice-plan".to_owned();
        plan.subtitles = Default::default();
        plan.transition = None;
        plan.requirements = vec![
            ResourceRequirement {
                id: "req-video".to_owned(),
                kind: StudioResourceKind::Video,
                query: "".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
            ResourceRequirement {
                id: "req-voice".to_owned(),
                kind: StudioResourceKind::Voice,
                query: "Hola, esto es la narración generada por el pipeline".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
        ];
        plan.scenes = vec![
            PlanScene {
                id: "scene-video".to_owned(),
                order: 1,
                title: "Escena con imagen".to_owned(),
                intent: "visual".to_owned(),
                target_duration_frames: Some(120),
                narration_text: None,
                requirement_ids: vec!["req-video".to_owned()],
                notes: None,
            },
            PlanScene {
                id: "scene-voice".to_owned(),
                order: 2,
                title: "Escena narrada".to_owned(),
                intent: "voz".to_owned(),
                target_duration_frames: Some(120),
                narration_text: None,
                requirement_ids: vec!["req-voice".to_owned()],
                notes: None,
            },
        ];
        production::create_run(&store, &plan, "e2e-voice-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e-voice".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        // ffprobe habilita el registro de assets (voz generada y remotos).
        let executor = CompositeStageExecutor::new(Some(ffprobe())).with_extra(&tail);

        let mut run = store.load("e2e-voice-run").unwrap().unwrap();
        for _ in 0..240 {
            run =
                production::advance(&store, &executor, "e2e-voice-run", &root, &doc_path).unwrap();
            if matches!(run.status, RunStatus::Done | RunStatus::Failed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida con voz no llegó a done: {:?} — {}",
            run.status,
            run.last_error.unwrap_or_default()
        );

        // acquire generó la voz con SAPI y la registró como asset de audio.
        let acquire = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Acquire)
            .unwrap();
        let resources = acquire
            .output
            .as_ref()
            .and_then(|o| o["resources"].as_array().cloned())
            .unwrap_or_default();
        let voice = resources
            .iter()
            .find(|r| r["sourceId"] == "windows-sapi")
            .expect("debía haber un recurso generado por SAPI");
        let voice_path = voice["path"].as_str().unwrap().to_owned();
        assert!(voice_path.starts_with("media/generated/"));
        assert!(root.join(&voice_path).is_file());
        let voice_asset = voice["assetId"].as_str().unwrap().to_owned();

        // La escena de voz quedó montada como clip de audio y el MP4 se entregó.
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        assert!(doc["timeline"]["clips"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["kind"] == "audio" && c["source"]["assetId"] == voice_asset));
        let videos: Vec<PathBuf> = fs::read_dir(root.join("deliverables"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        assert!(videos[0].metadata().unwrap().len() > 10_000);
        eprintln!(
            "E2E voz OK: {} ({}), MP4 {}",
            voice_asset,
            voice_path,
            videos[0].display()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Pipeline completo con montaje POR CONTENIDO: el asset de video es un
    /// MP4 real con un corte duro a los 2 s (rojo→azul). `analyze` lo
    /// detecta, `scenes` lo transporta y `edit` monta un clip por plano —
    /// la escena de 120 frames queda en 2 clips (0-60, 60-120) y la de
    /// 90 frames en 2 clips (0-60, 60-90).
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test production_e2e_content_aware -- --ignored`
    #[test]
    #[ignore = "requiere ffmpeg/ffprobe reales; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn production_e2e_content_aware_runs_all_stages() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("e2e por contenido omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let (root, doc_path) = fixture_project("content");
        // Reemplaza demo.mp4 por un video de 10 s con corte duro a los 2 s
        // (rojo→azul, frame 60 de 300): las fichas del fixture (300 frames)
        // siguen siendo válidas y el corte cae dentro de ambas escenas.
        let status = std::process::Command::new(ffmpeg())
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=red:size=640x360:rate=30:duration=2",
                "-f",
                "lavfi",
                "-i",
                "color=blue:size=640x360:rate=30:duration=8",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=10:sample_rate=48000",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1[v]",
                "-map",
                "[v]",
                "-map",
                "2:a",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(root.join("media/demo.mp4").to_string_lossy().as_ref())
            .status()
            .expect("ffmpeg disponible");
        assert!(status.success(), "ffmpeg no generó el video con corte");
        // El render verifica integrity.bytes contra el archivo real.
        let mut doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        let bytes = fs::metadata(root.join("media/demo.mp4")).unwrap().len();
        for asset in doc["assets"].as_array_mut().unwrap() {
            if asset["source"]["path"].as_str() == Some("media/demo.mp4") {
                asset["integrity"]["bytes"] = serde_json::json!(bytes);
            }
        }
        fs::write(&doc_path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();

        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let plan = e2e_plan();
        production::create_run(&store, &plan, "e2e-content-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e-content".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        // ffmpeg habilita thumbnails/cortes/silencios en `analyze`;
        // ffprobe el registro de assets y la verificación del render.
        let executor = CompositeStageExecutor::new(Some(ffprobe()))
            .with_ffmpeg(Some(ffmpeg()))
            .with_extra(&tail);

        let mut run = store.load("e2e-content-run").unwrap().unwrap();
        for _ in 0..240 {
            run = production::advance(&store, &executor, "e2e-content-run", &root, &doc_path)
                .unwrap();
            if matches!(run.status, RunStatus::Done | RunStatus::Failed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida por contenido no llegó a done: {:?} — {}",
            run.status,
            run.last_error.unwrap_or_default()
        );

        // `analyze` debió detectar el corte y `edit` debió montar 2 clips
        // por escena (uno por plano).
        let analyze = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Analyze)
            .unwrap();
        assert_eq!(analyze.output.as_ref().unwrap()["sceneAnalyses"], 1);

        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        let clips = doc["timeline"]["clips"].as_array().unwrap();
        let scene1: Vec<&serde_json::Value> = clips
            .iter()
            .filter(|c| c["label"] == "Escena E2E")
            .collect();
        let scene2: Vec<&serde_json::Value> = clips
            .iter()
            .filter(|c| c["label"] == "Escena E2E 2")
            .collect();
        assert_eq!(scene1.len(), 2, "escena 1 debía tener 2 planos: {scene1:?}");
        assert_eq!(scene2.len(), 2, "escena 2 debía tener 2 planos: {scene2:?}");
        assert_eq!(scene1[0]["source"]["inFrame"], 0);
        assert_eq!(scene1[0]["source"]["outFrame"], 60);
        assert_eq!(scene1[1]["source"]["inFrame"], 60);
        assert_eq!(scene1[1]["source"]["outFrame"], 120);
        assert_eq!(scene2[1]["source"]["outFrame"], 90);

        let videos: Vec<PathBuf> = fs::read_dir(root.join("deliverables"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        assert!(videos[0].metadata().unwrap().len() > 10_000);
        eprintln!("E2E por contenido OK: MP4 {}", videos[0].display());
        let _ = fs::remove_dir_all(&root);
    }

    /// Pipeline completo con TARJETA generada: requisito `image` con
    /// convención `title:` ⇒ acquire genera un PNG real con ffmpeg
    /// drawtext, lo registra como asset y edit lo monta en la pista de
    /// imagen. Las 8 etapas hasta el MP4 entregado.
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test production_e2e_title_card -- --ignored`
    #[test]
    #[ignore = "requiere ffmpeg/ffprobe reales; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn production_e2e_title_card_runs_all_stages() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("e2e tarjeta omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let (root, doc_path) = fixture_project("card");
        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let mut plan = e2e_plan();
        plan.id = "e2e-card-plan".to_owned();
        plan.transition = None;
        plan.requirements = vec![
            ResourceRequirement {
                id: "req-video".to_owned(),
                kind: StudioResourceKind::Video,
                query: "".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
            ResourceRequirement {
                id: "req-card".to_owned(),
                kind: StudioResourceKind::Image,
                query: "title:Apertura del pipeline".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
        ];
        plan.scenes = vec![
            PlanScene {
                id: "scene-video".to_owned(),
                order: 1,
                title: "Escena con video".to_owned(),
                intent: "visual".to_owned(),
                target_duration_frames: Some(120),
                narration_text: None,
                requirement_ids: vec!["req-video".to_owned()],
                notes: None,
            },
            PlanScene {
                id: "scene-card".to_owned(),
                order: 2,
                title: "Tarjeta de título".to_owned(),
                intent: "titulo".to_owned(),
                target_duration_frames: Some(90),
                narration_text: None,
                requirement_ids: vec!["req-card".to_owned()],
                notes: None,
            },
        ];
        production::create_run(&store, &plan, "e2e-card-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e-card".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        let executor = CompositeStageExecutor::new(Some(ffprobe()))
            .with_ffmpeg(Some(ffmpeg()))
            .with_extra(&tail);

        let mut run = store.load("e2e-card-run").unwrap().unwrap();
        for _ in 0..240 {
            run = production::advance(&store, &executor, "e2e-card-run", &root, &doc_path).unwrap();
            if matches!(run.status, RunStatus::Done | RunStatus::Failed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida con tarjeta no llegó a done: {:?} — {}",
            run.status,
            run.last_error.unwrap_or_default()
        );

        // acquire generó el PNG con el provider de tarjetas.
        let acquire = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Acquire)
            .unwrap();
        let resources = acquire
            .output
            .as_ref()
            .and_then(|o| o["resources"].as_array().cloned())
            .unwrap_or_default();
        let card = resources
            .iter()
            .find(|r| r["sourceId"] == "local-ffmpeg-titlecard")
            .expect("debía haber un recurso generado por el titlecard");
        let card_path = card["path"].as_str().unwrap().to_owned();
        assert!(card_path.starts_with("media/generated/tarjeta-"));
        assert!(root.join(&card_path).is_file());
        let card_asset = card["assetId"].as_str().unwrap().to_owned();

        // La escena de la tarjeta quedó montada como clip de imagen.
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        let image_clip = doc["timeline"]["clips"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["kind"] == "image" && c["source"]["assetId"] == card_asset)
            .expect("la tarjeta no quedó montada como clip de imagen");
        assert_eq!(image_clip["durationFrames"], 90);

        let videos: Vec<PathBuf> = fs::read_dir(root.join("deliverables"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        assert!(videos[0].metadata().unwrap().len() > 10_000);
        eprintln!(
            "E2E tarjeta OK: {} ({}), MP4 {}",
            card_asset,
            card_path,
            videos[0].display()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Pipeline completo con MÚSICA generada: requisito `music` con
    /// convención `music:` + `plan.music.enabled` ⇒ acquire sintetiza un
    /// MP3 ambiental real, edit lo monta como cama en "Producción Música"
    /// y el MP4 entregado la lleva mezclada.
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test production_e2e_music -- --ignored`
    #[test]
    #[ignore = "requiere ffmpeg/ffprobe reales; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn production_e2e_music_runs_all_stages() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("e2e música omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let (root, doc_path) = fixture_project("music");
        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let mut plan = e2e_plan();
        plan.id = "e2e-music-plan".to_owned();
        plan.transition = None;
        plan.subtitles = Default::default();
        plan.music = crate::studio::plan::MusicSpec {
            enabled: true,
            query: Some("music:ambient".to_owned()),
        };
        plan.requirements = vec![
            ResourceRequirement {
                id: "req-video".to_owned(),
                kind: StudioResourceKind::Video,
                query: "".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
            ResourceRequirement {
                id: "req-music".to_owned(),
                kind: StudioResourceKind::Music,
                query: "music:ambient".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
        ];
        plan.scenes = vec![PlanScene {
            id: "scene-video".to_owned(),
            order: 1,
            title: "Escena con video".to_owned(),
            intent: "visual".to_owned(),
            target_duration_frames: Some(120),
            narration_text: None,
            requirement_ids: vec!["req-video".to_owned()],
            notes: None,
        }];
        production::create_run(&store, &plan, "e2e-music-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e-music".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        let executor = CompositeStageExecutor::new(Some(ffprobe()))
            .with_ffmpeg(Some(ffmpeg()))
            .with_extra(&tail);

        let mut run = store.load("e2e-music-run").unwrap().unwrap();
        for _ in 0..240 {
            run =
                production::advance(&store, &executor, "e2e-music-run", &root, &doc_path).unwrap();
            if matches!(run.status, RunStatus::Done | RunStatus::Failed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida con música no llegó a done: {:?} — {}",
            run.status,
            run.last_error.unwrap_or_default()
        );

        // acquire generó el MP3 con el provider ambiental.
        let acquire = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Acquire)
            .unwrap();
        let resources = acquire
            .output
            .as_ref()
            .and_then(|o| o["resources"].as_array().cloned())
            .unwrap_or_default();
        let music = resources
            .iter()
            .find(|r| r["sourceId"] == "local-ffmpeg-ambient")
            .expect("debía haber un recurso generado por el ambient");
        let music_path = music["path"].as_str().unwrap().to_owned();
        assert!(music_path.starts_with("media/generated/musica-"));
        assert!(root.join(&music_path).is_file());
        let music_asset = music["assetId"].as_str().unwrap().to_owned();

        // edit montó la cama en "Producción Música" y lo reportó resuelto.
        let edit = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Edit)
            .unwrap();
        assert_eq!(
            edit.output.as_ref().unwrap()["music"]["resolved"],
            true,
            "la música generada no se montó como cama"
        );
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        let music_track = doc["timeline"]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == "Producción Música" || t["label"] == "Producción Música")
            .and_then(|t| t["id"].as_str().map(str::to_owned))
            .expect("falta la pista Producción Música");
        assert!(doc["timeline"]["clips"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["kind"] == "audio"
                && c["trackId"] == music_track
                && c["source"]["assetId"] == music_asset));

        let videos: Vec<PathBuf> = fs::read_dir(root.join("deliverables"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        assert!(videos[0].metadata().unwrap().len() > 10_000);
        eprintln!(
            "E2E música OK: {} ({}), MP4 {}",
            music_asset,
            music_path,
            videos[0].display()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Capstone: los cuatro providers locales/generados en UNA corrida —
    /// video de biblioteca + voz SAPI + tarjeta ffmpeg + música ambiental
    /// ffmpeg. Las 8 etapas hasta el MP4 entregado con todo montado.
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 EDITOR_IA_RUN_LIVE_TESTS=1 cargo test
    /// production_e2e_all_providers -- --ignored`
    #[test]
    #[ignore = "requiere ffmpeg/ffprobe + SAPI; correr con EDITOR_IA_RUN_RENDER_TESTS=1 EDITOR_IA_RUN_LIVE_TESTS=1"]
    fn production_e2e_all_providers_runs_all_stages() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1")
            || std::env::var("EDITOR_IA_RUN_LIVE_TESTS").ok().as_deref() != Some("1")
        {
            eprintln!("e2e completo omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1 y EDITOR_IA_RUN_LIVE_TESTS=1");
            return;
        }
        let (root, doc_path) = fixture_project("all");
        let config = root.join("config");
        let store = LocalProductionStore::new(&config);
        let mut plan = e2e_plan();
        plan.id = "e2e-all-plan".to_owned();
        plan.transition = None;
        plan.subtitles = Default::default();
        plan.music = crate::studio::plan::MusicSpec {
            enabled: true,
            query: Some("music:ambient".to_owned()),
        };
        plan.requirements = vec![
            ResourceRequirement {
                id: "req-video".to_owned(),
                kind: StudioResourceKind::Video,
                query: "".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
            ResourceRequirement {
                id: "req-card".to_owned(),
                kind: StudioResourceKind::Image,
                query: "title:Todo generado".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
            ResourceRequirement {
                id: "req-voice".to_owned(),
                kind: StudioResourceKind::Voice,
                query: "Este video fue producido enteramente por el estudio".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
            ResourceRequirement {
                id: "req-music".to_owned(),
                kind: StudioResourceKind::Music,
                query: "music:ambient".to_owned(),
                max_count: 1,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            },
        ];
        plan.scenes = vec![
            PlanScene {
                id: "scene-video".to_owned(),
                order: 1,
                title: "Escena con video".to_owned(),
                intent: "visual".to_owned(),
                target_duration_frames: Some(120),
                narration_text: None,
                requirement_ids: vec!["req-video".to_owned()],
                notes: None,
            },
            PlanScene {
                id: "scene-card".to_owned(),
                order: 2,
                title: "Tarjeta".to_owned(),
                intent: "titulo".to_owned(),
                target_duration_frames: Some(90),
                narration_text: None,
                requirement_ids: vec!["req-card".to_owned()],
                notes: None,
            },
            PlanScene {
                id: "scene-voice".to_owned(),
                order: 3,
                title: "Narración".to_owned(),
                intent: "voz".to_owned(),
                target_duration_frames: Some(120),
                narration_text: None,
                requirement_ids: vec!["req-voice".to_owned()],
                notes: None,
            },
        ];
        production::create_run(&store, &plan, "e2e-all-run", None).unwrap();

        let session = FixtureSession {
            info: ProjectSessionInfo {
                path: doc_path.clone(),
                root: root.clone(),
                project_id: "e2e-all".to_owned(),
            },
        };
        let documents = crate::infrastructure::projects::LocalProjectDocuments;
        let tools = FixtureTools {
            ffmpeg: ffmpeg(),
            ffprobe: ffprobe(),
        };
        let jobs: crate::state::SharedRenderJobs =
            Arc::new(Mutex::new(HashMap::<String, Arc<dyn RenderProcess>>::new()));
        let runtime_impl = SharedRenderRuntime::new(jobs);
        let runtime_dyn: Arc<dyn RenderRuntime> = Arc::new(runtime_impl);
        let events_dyn: Arc<dyn RenderEvents> = Arc::new(NoopEvents);
        let files_dyn: Arc<dyn crate::ports::render::RenderFiles> = Arc::new(LocalRenderFiles);
        let verifier_impl = SystemRenderVerifier;
        let verifier_dyn: Arc<dyn crate::ports::render::RenderVerifier> = Arc::new(verifier_impl);
        let launcher = StdioRenderLauncher::new(
            runtime_dyn.clone(),
            events_dyn.clone(),
            files_dyn.clone(),
            verifier_dyn.clone(),
        );
        let dialogs = NoopDialogs;
        let encoder = SystemRenderEncoder;
        let render_deps = RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: runtime_dyn.as_ref(),
            events: events_dyn.as_ref(),
            files: files_dyn.as_ref(),
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: root.join("cache"),
        };
        let tail = RenderReviewDeliverExecutor::new(render_deps, verifier_dyn.as_ref());
        let executor = CompositeStageExecutor::new(Some(ffprobe()))
            .with_ffmpeg(Some(ffmpeg()))
            .with_extra(&tail);

        let mut run = store.load("e2e-all-run").unwrap().unwrap();
        for _ in 0..240 {
            run = production::advance(&store, &executor, "e2e-all-run", &root, &doc_path).unwrap();
            if matches!(run.status, RunStatus::Done | RunStatus::Failed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert_eq!(
            run.status,
            RunStatus::Done,
            "la corrida completa no llegó a done: {:?} — {}",
            run.status,
            run.last_error.unwrap_or_default()
        );

        // Los tres providers generados aportaron su recurso.
        let acquire = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Acquire)
            .unwrap();
        let resources = acquire
            .output
            .as_ref()
            .and_then(|o| o["resources"].as_array().cloned())
            .unwrap_or_default();
        for provider in [
            "windows-sapi",
            "local-ffmpeg-titlecard",
            "local-ffmpeg-ambient",
        ] {
            assert!(
                resources.iter().any(|r| r["sourceId"] == provider),
                "falta el recurso de {provider}: {resources:?}"
            );
        }

        // Montaje: clip de imagen (tarjeta), clip de audio (voz) y cama
        // de música resuelta en el documento final.
        let edit = run
            .stages
            .iter()
            .find(|s| s.stage == crate::studio::plan::StudioStage::Edit)
            .unwrap();
        assert_eq!(edit.output.as_ref().unwrap()["music"]["resolved"], true);
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        let clips = doc["timeline"]["clips"].as_array().unwrap();
        assert!(
            clips.iter().any(|c| c["kind"] == "image"),
            "sin clip de tarjeta"
        );
        assert!(
            clips.iter().filter(|c| c["kind"] == "audio").count() >= 2,
            "debían estar la voz y la cama de música: {clips:?}"
        );
        assert!(
            clips.iter().any(|c| c["kind"] == "video"),
            "sin clip de video"
        );

        let videos: Vec<PathBuf> = fs::read_dir(root.join("deliverables"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("mp4"))
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(videos.len(), 1, "debía haber un MP4 entregado");
        assert!(videos[0].metadata().unwrap().len() > 10_000);
        eprintln!("E2E completo OK: MP4 {}", videos[0].display());
        let _ = fs::remove_dir_all(&root);
    }
}
