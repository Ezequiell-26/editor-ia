//! Invoker MCP compuesto: las tools del estudio autónomo las ejecuta el
//! backend directo sobre los casos de uso de `application::production` —
//! no dependen de que la ventana de React esté montada. El resto de
//! tools siguen yendo al bridge de la ventana (`TauriMcpToolInvoker`).
//!
//! Los errores se devuelven como JSON `{"error":{"code","message"}}` con
//! el código tipado de `ProjectErrorCode`, nunca stack traces ni rutas
//! internas en el mensaje.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::application::production as use_cases;
use crate::mcp::server::{is_studio_tool, McpReply};
use crate::ports::mcp_server::McpToolInvoker;
use crate::ports::media::MediaTools as _;
use crate::ports::render::RenderRuntime as _;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;
use crate::studio::plan::ProductionPlan;

use super::mcp_server::TauriMcpToolInvoker;

pub struct StudioMcpInvoker {
    app: AppHandle,
    frontend: TauriMcpToolInvoker,
}

impl StudioMcpInvoker {
    pub fn new(app: AppHandle) -> Self {
        Self {
            frontend: TauriMcpToolInvoker::new(app.clone()),
            app,
        }
    }

    fn error_reply(error: &ProjectError) -> McpReply {
        McpReply {
            ok: false,
            text: json!({
                "error": {
                    "code": error.code.name(),
                    "message": error.message,
                }
            })
            .to_string(),
        }
    }

    fn ok_json(value: Value) -> McpReply {
        McpReply {
            ok: true,
            text: value.to_string(),
        }
    }

    fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ProjectError> {
        args[key]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    &format!("falta o es inválido el argumento `{key}`"),
                )
            })
    }

    /// Ejecuta la tool de estudio sobre los casos de uso reales. Todo es
    /// síncrono (los stages pesados corren en `spawn_blocking` del driver,
    /// no aquí): `advance` puede tardar lo que tarde una etapa.
    fn studio_result(&self, tool: &str, args: &Value) -> Result<Value, ProjectError> {
        let state = self.app.state::<AppState>();
        let store = state.production_store();
        match tool {
            "production_list" => use_cases::list_runs(&store)
                .map(|runs| json!({ "runs": runs, "count": runs.len() })),
            "production_status" => {
                let run_id = Self::arg_str(args, "runId")?;
                use_cases::run_status(&store, run_id).map(|run| json!({ "run": run }))
            }
            "production_create" => {
                let plan_value = args.get("plan").cloned().unwrap_or(Value::Null);
                let parsed = serde_json::from_value::<ProductionPlan>(plan_value).map_err(|e| {
                    ProjectError::message(
                        ProjectErrorCode::InvalidProject,
                        &format!("el plan no cumple el schema de producción: {e}"),
                    )
                })?;
                let run_id = args
                    .get("runId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty() && value.len() <= 128)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("run-{}", uuid::Uuid::new_v4()));
                let max_cost = args
                    .get("maxCostCents")
                    .and_then(Value::as_u64)
                    .or(parsed.max_cost_cents);
                use_cases::create_run(&store, &parsed, &run_id, max_cost)
                    .map(|run| json!({ "run": run }))
            }
            "production_start" => {
                let run_id = Self::arg_str(args, "runId")?;
                crate::infrastructure::studio::run_driver::start(&self.app, run_id)?;
                Ok(json!({
                    "runId": run_id,
                    "active": crate::infrastructure::studio::run_driver::is_active(run_id),
                }))
            }
            "production_advance" => {
                let run_id = Self::arg_str(args, "runId")?;
                state
                    .advance_production_run(run_id)
                    .map(|run| json!({ "run": run }))
            }
            "production_cancel" => {
                let run_id = Self::arg_str(args, "runId")?;
                use_cases::cancel_run(&store, run_id).map(|run| {
                    let runtime = state.render_runtime();
                    if let Some(job_id) = run
                        .stage_record(crate::studio::plan::StudioStage::Render)
                        .and_then(|record| record.output.as_ref())
                        .and_then(|output| output["jobId"].as_str().map(str::to_owned))
                    {
                        let _ = runtime.cancel(&job_id);
                    }
                    json!({ "run": run })
                })
            }
            "production_resume" => {
                let run_id = Self::arg_str(args, "runId")?;
                let run = use_cases::resume_run(&store, run_id)?;
                let _ = crate::infrastructure::studio::run_driver::start(&self.app, run_id);
                Ok(json!({ "run": run }))
            }
            "production_pause" => {
                let run_id = Self::arg_str(args, "runId")?;
                use_cases::pause_run(&store, run_id).map(|run| json!({ "run": run }))
            }
            "studio_capabilities" => Ok(studio_capabilities(&state)),
            "quality_gate_review" => {
                let session = state.project_session();
                let documents = state.project_documents();
                crate::application::quality_gate::review_open_project(&session, &documents)
                    .map(|report| json!({ "report": report }))
            }
            "production_plan_from_brief" => {
                let parsed: crate::application::studio_planner::PlanRequest =
                    serde_json::from_value(args.clone()).map_err(|e| {
                        ProjectError::message(
                            ProjectErrorCode::InvalidProject,
                            &format!("el brief no es válido: {e}"),
                        )
                    })?;
                crate::application::studio_planner::plan_from_brief(&parsed)
                    .map(|plan| json!({ "plan": plan }))
            }
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("tool de estudio desconocida: {tool}"),
            )),
        }
    }

    /// `production_plan_from_text` es async: llama al provider de chat
    /// (BYOK) para interpretar texto libre. Misma política de coste que el
    /// comando IPC: remoto exige `approvedCost`, mock no interpreta.
    async fn plan_from_text_result(&self, args: &Value) -> Result<Value, ProjectError> {
        let parsed: crate::application::studio_planner::PlanTextRequest =
            serde_json::from_value(args.clone()).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    &format!("el pedido de plan no es válido: {e}"),
                )
            })?;
        let state = self.app.state::<AppState>();
        let settings = crate::infrastructure::ai::StateProviderSettings::new(&state);
        let secrets = crate::infrastructure::ai::KeyringProviderSecrets;
        let (config, _simulated, key) = crate::application::providers::generation_provider(
            &settings,
            &secrets,
            parsed.approved_cost.unwrap_or(false),
            "el proveedor de chat no está configurado para interpretar texto libre",
            "interpretar texto libre con un proveedor remoto requiere approvedCost=true",
        )?;
        if config.kind == "mock" {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "el proveedor mock no interpreta lenguaje natural; configurá un proveedor real",
            ));
        }
        let chat = crate::infrastructure::ai::ReqwestProviderChat;
        crate::application::studio_planner::plan_from_text(&chat, &config, key, &parsed.text)
            .await
            .map(|plan| json!({ "plan": plan }))
    }
}

impl McpToolInvoker for StudioMcpInvoker {
    fn invoke(
        &self,
        tool: &str,
        args: &Value,
        wait: Duration,
    ) -> Pin<Box<dyn Future<Output = McpReply> + Send + '_>> {
        if !is_studio_tool(tool) {
            return self.frontend.invoke(tool, args, wait);
        }
        let tool = tool.to_owned();
        let args = args.clone();
        Box::pin(async move {
            if tool == "production_plan_from_text" {
                return match self.plan_from_text_result(&args).await {
                    Ok(value) => Self::ok_json(value),
                    Err(error) => Self::error_reply(&error),
                };
            }
            match self.studio_result(&tool, &args) {
                Ok(value) => Self::ok_json(value),
                Err(error) => Self::error_reply(&error),
            }
        })
    }
}

/// Inventario real de capacidades del estudio autónomo: instancia cada
/// provider y reporta lo que declara (coste, red, límites) más la
/// disponibilidad de ffmpeg/ffprobe. Nada hardcodeado: si un provider no
/// puede construirse, simplemente no aparece.
fn studio_capabilities(state: &AppState) -> Value {
    use crate::ports::studio::{ContentGenerator, ResourceAcquisition};

    let tools = state.media_tools();
    let ffmpeg = tools.ffmpeg_path();
    let ffprobe = tools.ffprobe_path();

    let mut generators: Vec<Box<dyn ContentGenerator>> = vec![
        Box::new(crate::infrastructure::studio::local_voice::LocalVoiceGenerator::new()),
        Box::new(
            crate::infrastructure::studio::local_titlecard::LocalTitleCardGenerator::new(
                ffmpeg.clone(),
            ),
        ),
        Box::new(
            crate::infrastructure::studio::local_music::LocalMusicGenerator::new(ffmpeg.clone()),
        ),
        Box::new(
            crate::infrastructure::studio::local_pattern::LocalPatternGenerator::new(
                ffmpeg.clone(),
            ),
        ),
    ];
    // Generador remoto BYOK: aparece en la lista sólo si está configurado
    // y usable (nunca expone la clave, sólo capabilities declaradas).
    let remote_image_info = state.remote_image_generator().map(|generator| {
        let info = json!({
            "configured": true,
            "provider": generator.provider_id().to_owned(),
            "requiresNetwork": !generator.is_local(),
            "capabilities": generator.capabilities(),
        });
        generators.push(Box::new(generator));
        info
    });
    // Generador remoto de voz BYOK (misma configuración que la imagen):
    // `remote:`/`remote:<voz>` en `req.voice`. `null` si no está listo.
    let remote_voice_info = state.remote_voice_generator().map(|generator| {
        let info = json!({
            "configured": true,
            "provider": generator.provider_id().to_owned(),
            "requiresNetwork": !generator.is_local(),
            "capabilities": generator.capabilities(),
        });
        generators.push(Box::new(generator));
        info
    });
    let generator_reports: Vec<Value> = generators
        .iter()
        .map(|generator| {
            json!({
                "provider": generator.provider_id(),
                "capabilities": generator.capabilities(),
            })
        })
        .collect();

    let mut acquisitions: Vec<Box<dyn ResourceAcquisition>> = vec![Box::new(
        crate::infrastructure::studio::local_acquisition::LocalCatalogAcquisition::new(
            &state.config_dir.join("catalog"),
            &state.config_dir,
        ),
    )];
    if let Ok(remote) =
        crate::infrastructure::studio::internet_archive::InternetArchiveAcquisition::new()
    {
        acquisitions.push(Box::new(remote));
    }
    let acquisition_reports: Vec<Value> = acquisitions
        .iter()
        .map(|acquisition| json!({ "sources": acquisition.sources() }))
        .collect();

    json!({
        "schemaVersion": 1,
        "pipelineStages": crate::studio::run::PIPELINE_STAGES,
        "mediaTools": {
            "ffmpeg": ffmpeg.is_some(),
            "ffprobe": ffprobe.is_some(),
        },
        "generators": generator_reports,
        "acquisitions": acquisition_reports,
        // Generador remoto BYOK: `null` si no está configurado; nunca
        // incluye la clave, sólo si está listo y si requiere red.
        "remoteImage": remote_image_info,
        "remoteVoice": remote_voice_info,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_reply_carries_typed_code() {
        let error = ProjectError::message(ProjectErrorCode::NotFound, "corrida no encontrada");
        let reply = StudioMcpInvoker::error_reply(&error);
        assert!(!reply.ok);
        let parsed: Value = serde_json::from_str(&reply.text).unwrap();
        assert_eq!(parsed["error"]["code"], "NOT_FOUND");
        assert_eq!(parsed["error"]["message"], "corrida no encontrada");
    }

    #[test]
    fn arg_str_rejects_missing_and_oversized() {
        let args = json!({ "runId": "run-1" });
        assert_eq!(StudioMcpInvoker::arg_str(&args, "runId").unwrap(), "run-1");
        assert!(StudioMcpInvoker::arg_str(&args, "other").is_err());
        let long = json!({ "runId": "x".repeat(200) });
        assert!(StudioMcpInvoker::arg_str(&long, "runId").is_err());
    }
}
