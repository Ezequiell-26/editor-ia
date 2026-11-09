//! Shared native state: the currently open project, the user settings and the
//! live render jobs.
//!
//! Credentials never live here. The provider API key is written to the Windows
//! Credential Manager through the `keyring` crate and only read when a request
//! is about to be issued.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::ports::media::MediaTools;
use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone)]
pub struct Session {
    pub path: PathBuf,
    pub root: PathBuf,
    pub project_id: String,
}

impl Session {
    pub fn new(path: PathBuf, project_id: String) -> Self {
        let root = path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            path,
            root,
            project_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderSettings {
    /// `openai-compatible` or `mock`.
    pub kind: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioProviderSettings {
    /// `windows-sapi`, `elevenlabs` or `external-web`.
    pub kind: String,
    pub voice_id: String,
    pub model_id: String,
    pub approved: bool,
    pub external_url: String,
}

impl Default for AudioProviderSettings {
    fn default() -> Self {
        Self {
            kind: "windows-sapi".to_owned(),
            voice_id: String::new(),
            model_id: "eleven_multilingual_v2".to_owned(),
            approved: false,
            external_url: "https://elevenlabs.io/app/speech-synthesis".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub provider: ProviderSettings,
    pub audio_provider: AudioProviderSettings,
    pub diarize: DiarizeSettings,
    pub tts_voice: Option<String>,
    pub language: Option<String>,
}

/// Proveedor de diarización (hablantes). La clave vive en el almacén de Windows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiarizeSettings {
    /// `none`, `deepgram` o `assemblyai`.
    pub kind: String,
    /// Sólo para proveedores compatibles; vacío usa el endpoint oficial.
    pub base_url: String,
    pub language: String,
}

impl Default for DiarizeSettings {
    fn default() -> Self {
        Self {
            kind: "none".to_owned(),
            base_url: String::new(),
            language: "es".to_owned(),
        }
    }
}

impl Settings {
    fn sanitized(mut self) -> Self {
        if self.provider.kind.is_empty() {
            self.provider.kind = "openai-compatible".to_owned();
        }
        if self.audio_provider.kind.is_empty() {
            self.audio_provider.kind = "windows-sapi".to_owned();
        }
        if self.audio_provider.model_id.trim().is_empty() {
            self.audio_provider.model_id = "eleven_multilingual_v2".to_owned();
        }
        if self.language.is_none() {
            self.language = Some("es".to_owned());
        }
        if self.diarize.kind.is_empty() {
            self.diarize.kind = "none".to_owned();
        }
        if self.diarize.language.trim().is_empty() {
            self.diarize.language = "es".to_owned();
        }
        self
    }
}

/// Registro de renders activos: `job_id → proceso FFmpeg` (el handle vive
/// detrás del port `RenderProcess`; la infraestructura es
/// `ChildRenderProcess`).
pub type SharedRenderJobs =
    Arc<Mutex<HashMap<String, Arc<dyn crate::ports::render::RenderProcess>>>>;

pub struct AppState {
    /// Handle de la app para adaptadores Tauri (eventos, diálogos).
    /// `None` sólo en tests que construyen `AppState` a mano.
    pub app: Option<AppHandle>,
    pub session: Mutex<Option<Session>>,
    pub settings: Mutex<Settings>,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub render_jobs: SharedRenderJobs,
    pub thumbnails: Mutex<HashMap<String, String>>,
    pub analysis_cache: Mutex<HashMap<String, crate::commands::intelligence::MediaAnalysis>>,
    pub downloader_bridge: Mutex<Option<crate::commands::downloader_bridge::BridgeRuntime>>,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Self {
        crate::commands::system::init_resource_dir(app);
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("editor-ia"));
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("editor-ia-cache"));
        let _ = std::fs::create_dir_all(&config_dir);
        let _ = std::fs::create_dir_all(&cache_dir);

        // yt-dlp que vino con el instalador, si la carpeta gestionada está vacía.
        crate::commands::downloader::ensure_bundled_engine(&config_dir);

        let settings = std::fs::read_to_string(config_dir.join("settings.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .unwrap_or_default()
            .sanitized();

        Self {
            app: Some(app.clone()),
            session: Mutex::new(None),
            settings: Mutex::new(settings),
            config_dir,
            cache_dir,
            render_jobs: Arc::new(Mutex::new(HashMap::new())),
            thumbnails: Mutex::new(HashMap::new()),
            analysis_cache: Mutex::new(HashMap::new()),
            downloader_bridge: Mutex::new(None),
        }
    }

    pub fn settings_snapshot(&self) -> Result<Settings, ProjectError> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
            })
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), ProjectError> {
        let text = serde_json::to_string_pretty(settings).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudieron serializar los ajustes",
            )
        })?;
        std::fs::write(self.config_dir.join("settings.json"), text).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudieron guardar los ajustes")
        })
    }

    pub fn session_snapshot(&self) -> Result<Option<Session>, ProjectError> {
        self.session
            .lock()
            .map(|session| session.clone())
            .map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
            })
    }

    pub fn require_session(&self) -> Result<Session, ProjectError> {
        self.session_snapshot()?.ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "no hay un proyecto abierto; creá o abrí uno primero",
            )
        })
    }

    pub fn set_session(&self, session: Option<Session>) -> Result<(), ProjectError> {
        let mut guard = self.session.lock().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
        })?;
        *guard = session;
        Ok(())
    }

    /// Kill every active render and drain its handle. Used when the native
    /// session changes or the app exits, so a render never outlives the project
    /// it belongs to.
    pub fn cancel_all_renders(&self) {
        if let Ok(mut jobs) = self.render_jobs.lock() {
            for (job_id, job) in jobs.drain() {
                job.request_cancel();
                let _ = std::fs::remove_dir_all(self.cache_dir.join(format!("render-{}", job_id)));
            }
        }
    }
}

impl AppState {
    /// AppHandle para los adaptadores Tauri; nunca `None` en runtime real.
    fn app_handle(&self) -> AppHandle {
        self.app_handle_ref().clone()
    }

    /// Préstamo del AppHandle para adaptadores que lo referencian.
    fn app_handle_ref(&self) -> &AppHandle {
        self.app
            .as_ref()
            .expect("AppHandle no inicializado (sólo pasa en tests)")
    }
}

// ---------------------------------------------------------------------------
// Composición de adaptadores de infraestructura.
//
// Los comandos IPC no construyen tipos de `infrastructure` directamente:
// piden el adaptador ya cableado desde aquí. Los tipos devueltos son los
// concretos porque varios son vistas prestadas de `AppState` (no pueden
// vivir dentro del propio estado); el contrato que consume `application/`
// sigue siendo el trait de `ports/`.
// ---------------------------------------------------------------------------

impl AppState {
    // Media / proyectos
    pub fn media_tools(&self) -> crate::infrastructure::media::StateMediaTools<'_> {
        crate::infrastructure::media::StateMediaTools::new(self)
    }
    pub fn media_runner(&self) -> crate::infrastructure::media::SystemMediaRunner {
        crate::infrastructure::media::SystemMediaRunner
    }
    pub fn project_session(&self) -> crate::infrastructure::projects::StateProjectSession<'_> {
        crate::infrastructure::projects::StateProjectSession::new(self)
    }
    pub fn project_documents(&self) -> crate::infrastructure::projects::LocalProjectDocuments {
        crate::infrastructure::projects::LocalProjectDocuments
    }
    pub fn project_environment(
        &self,
    ) -> crate::infrastructure::projects::TauriProjectEnvironment<'_> {
        crate::infrastructure::projects::TauriProjectEnvironment::new(self.app_handle_ref())
    }
    pub fn project_versioning(
        &self,
    ) -> crate::infrastructure::projects_history::LocalProjectVersioning {
        crate::infrastructure::projects_history::LocalProjectVersioning
    }
    pub fn project_asset_files(&self) -> crate::infrastructure::projects::NativeProjectAssetFiles {
        crate::infrastructure::projects::NativeProjectAssetFiles
    }
    pub fn project_asset_recovery(
        &self,
    ) -> crate::infrastructure::projects_recovery::LocalProjectAssetRecovery {
        crate::infrastructure::projects_recovery::LocalProjectAssetRecovery
    }
    // Archivos y exportación
    pub fn subtitle_files(&self) -> crate::infrastructure::media::LocalSubtitleFiles {
        crate::infrastructure::media::LocalSubtitleFiles
    }
    pub fn localized_subtitle_files(
        &self,
    ) -> crate::infrastructure::media::LocalLocalizedSubtitleFiles {
        crate::infrastructure::media::LocalLocalizedSubtitleFiles::new()
    }
    pub fn timeline_export_files(&self) -> crate::infrastructure::media::LocalTimelineExportFiles {
        crate::infrastructure::media::LocalTimelineExportFiles
    }
    pub fn lossless_outputs(&self) -> crate::infrastructure::render_lossless::LocalLosslessOutputs {
        crate::infrastructure::render_lossless::LocalLosslessOutputs
    }
    // Proxies
    pub fn proxy_files(&self) -> crate::infrastructure::proxies::LocalProxyFiles {
        crate::infrastructure::proxies::LocalProxyFiles
    }
    pub fn proxy_runtime(&self) -> crate::infrastructure::proxies::LocalProxyRuntime {
        crate::infrastructure::proxies::LocalProxyRuntime
    }
    pub fn proxy_events(&self) -> crate::infrastructure::proxies::TauriProxyEvents {
        crate::infrastructure::proxies::TauriProxyEvents::new(self.app_handle())
    }
    pub fn proxy_generator(&self) -> crate::infrastructure::proxies::StdioProxyGenerator {
        crate::infrastructure::proxies::StdioProxyGenerator::new(
            Arc::new(crate::infrastructure::proxies::LocalProxyRuntime),
            Arc::new(crate::infrastructure::proxies::TauriProxyEvents::new(
                self.app_handle(),
            )),
            Arc::new(crate::infrastructure::proxies::LocalProxyFiles),
        )
    }
    // Render
    pub fn render_runtime(&self) -> crate::infrastructure::render_jobs::SharedRenderRuntime {
        crate::infrastructure::render_jobs::SharedRenderRuntime::new(self.render_jobs.clone())
    }
    pub fn render_events(&self) -> crate::infrastructure::render_jobs::TauriRenderEvents {
        crate::infrastructure::render_jobs::TauriRenderEvents::new(self.app_handle())
    }
    pub fn render_dialogs(&self) -> crate::infrastructure::render_jobs::TauriRenderDialogs {
        crate::infrastructure::render_jobs::TauriRenderDialogs::new(self.app_handle())
    }
    pub fn render_files(&self) -> crate::infrastructure::render_jobs::LocalRenderFiles {
        crate::infrastructure::render_jobs::LocalRenderFiles
    }
    pub fn render_encoder(&self) -> crate::infrastructure::render_jobs::SystemRenderEncoder {
        crate::infrastructure::render_jobs::SystemRenderEncoder
    }
    pub fn render_verifier(&self) -> crate::infrastructure::render_jobs::SystemRenderVerifier {
        crate::infrastructure::render_jobs::SystemRenderVerifier
    }
    pub fn render_launcher(&self) -> crate::infrastructure::render_jobs::StdioRenderLauncher {
        crate::infrastructure::render_jobs::StdioRenderLauncher::new(
            Arc::new(self.render_runtime()),
            Arc::new(self.render_events()),
            Arc::new(self.render_files()),
            Arc::new(self.render_verifier()),
        )
    }
    pub fn render_queue_store(&self) -> crate::infrastructure::render_queue::LocalRenderQueueStore {
        crate::infrastructure::render_queue::LocalRenderQueueStore::local()
    }
    // Conversión
    pub fn conversion_files(&self) -> crate::infrastructure::conversion::LocalConversionFiles {
        crate::infrastructure::conversion::LocalConversionFiles
    }
    pub fn conversion_events(&self) -> crate::infrastructure::conversion::TauriConversionEvents {
        crate::infrastructure::conversion::TauriConversionEvents {
            app: self.app_handle(),
        }
    }
    pub fn conversion_runner(&self) -> crate::infrastructure::conversion::SystemConversionRunner {
        crate::infrastructure::conversion::SystemConversionRunner
    }
    pub fn conversion_hardware(
        &self,
    ) -> crate::infrastructure::conversion::SystemConversionHardware {
        crate::infrastructure::conversion::SystemConversionHardware
    }
    // Proveedores IA
    pub fn provider_settings(&self) -> crate::infrastructure::ai::StateProviderSettings<'_> {
        crate::infrastructure::ai::StateProviderSettings::new(self)
    }
    pub fn provider_secrets(&self) -> crate::infrastructure::ai::KeyringProviderSecrets {
        crate::infrastructure::ai::KeyringProviderSecrets
    }
    pub fn provider_chat(&self) -> crate::infrastructure::ai::ReqwestProviderChat {
        crate::infrastructure::ai::ReqwestProviderChat
    }
    pub fn provider_probe(&self) -> crate::infrastructure::ai::ReqwestProviderProbe {
        crate::infrastructure::ai::ReqwestProviderProbe
    }
    pub fn motion_chat(&self) -> crate::infrastructure::ai::ReqwestMotionChat {
        crate::infrastructure::ai::ReqwestMotionChat
    }
    pub fn media_match_chat(&self) -> crate::infrastructure::ai::ReqwestMediaMatchChat {
        crate::infrastructure::ai::ReqwestMediaMatchChat
    }
    // Agentes / watchdog
    pub fn watchdog(&self) -> crate::infrastructure::agent::SchtasksWatchdog {
        crate::infrastructure::agent::SchtasksWatchdog::new()
    }
    // Estudio autónomo
    pub fn production_store(
        &self,
    ) -> crate::infrastructure::studio::production_store::LocalProductionStore {
        crate::infrastructure::studio::production_store::LocalProductionStore::new(&self.config_dir)
    }
    /// Generador remoto de imágenes BYOK si el proveedor de chat está
    /// configurado para ello (`openai-compatible` + URL + modelo; remoto
    /// además exige clave en el Credential Manager). `None` ⇒ los
    /// requisitos `gen:` del estudio quedan `requires_provider`.
    /// Nunca expone la clave: sólo la pasa al generador en memoria.
    pub fn remote_image_generator(
        &self,
    ) -> Option<crate::infrastructure::studio::remote_image::RemoteImageGenerator> {
        use crate::ports::ai::ProviderSecrets as _;
        let settings = self.settings_snapshot().ok()?;
        let provider = &settings.provider;
        if provider.kind != "openai-compatible"
            || provider.base_url.trim().is_empty()
            || provider.model.trim().is_empty()
        {
            return None;
        }
        let config = crate::ports::ai::ProviderConfig {
            kind: provider.kind.clone(),
            base_url: provider.base_url.clone(),
            model: provider.model.clone(),
        };
        let key = crate::infrastructure::ai::KeyringProviderSecrets.read_key();
        let generator =
            crate::infrastructure::studio::remote_image::RemoteImageGenerator::new(config, key);
        generator.usable().then_some(generator)
    }

    /// Generador remoto de voz TTS BYOK con la misma configuración del
    /// provider de chat (`openai-compatible` + URL + modelo + clave en el
    /// Credential Manager). `None` ⇒ los requisitos `voice` con convención
    /// `remote:` quedan insatisfechos. Nunca expone la clave.
    pub fn remote_voice_generator(
        &self,
    ) -> Option<crate::infrastructure::studio::remote_voice::RemoteVoiceGenerator> {
        use crate::ports::ai::ProviderSecrets as _;
        let settings = self.settings_snapshot().ok()?;
        let provider = &settings.provider;
        if provider.kind != "openai-compatible"
            || provider.base_url.trim().is_empty()
            || provider.model.trim().is_empty()
        {
            return None;
        }
        let config = crate::ports::ai::ProviderConfig {
            kind: provider.kind.clone(),
            base_url: provider.base_url.clone(),
            model: provider.model.clone(),
        };
        let key = crate::infrastructure::ai::KeyringProviderSecrets.read_key();
        let generator =
            crate::infrastructure::studio::remote_voice::RemoteVoiceGenerator::new(config, key);
        generator.usable().then_some(generator)
    }

    /// Ejecuta las etapas del pipeline que el proyecto abierto permite hoy
    /// (plan/acquire/analyze/scenes/edit). Las demás devuelven error de
    /// etapa no soportada — ver `CompositeStageExecutor`.
    pub fn project_stage_executor(
        &self,
    ) -> crate::infrastructure::studio::composite::CompositeStageExecutor<'static> {
        crate::infrastructure::studio::composite::CompositeStageExecutor::new(
            self.media_tools().ffprobe_path(),
        )
        .with_ffmpeg(self.media_tools().ffmpeg_path())
        .with_remote_image(self.remote_image_generator())
        .with_remote_voice(self.remote_voice_generator())
    }
    /// Catálogo de medios del proyecto abierto (assets + índice local).
    pub fn project_catalog(
        &self,
        doc_path: &std::path::Path,
        root: &std::path::Path,
    ) -> crate::infrastructure::studio::local_catalog::LocalProjectCatalog {
        crate::infrastructure::studio::local_catalog::LocalProjectCatalog::new(doc_path, root)
    }
    /// Avanza la corrida UNA etapa con el ejecutor del proyecto abierto.
    /// Camino único de ejecución: lo usan el comando IPC, el driver de
    /// corridas y las tools MCP — todos serializados por corrida para que
    /// una etapa nunca corra dos veces en paralelo.
    pub fn advance_production_run(
        &self,
        run_id: &str,
    ) -> Result<crate::studio::run::ProductionRun, ProjectError> {
        use crate::ports::projects::ProjectSession as _;
        let guard = crate::infrastructure::studio::run_driver::advance_guard(run_id)?;
        let _serialized = guard.lock().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "el avance de la corrida está bloqueado",
            )
        })?;
        let session = self.project_session();
        let info = session.require()?;
        let store = self.production_store();

        let documents = self.project_documents();
        let tools = self.media_tools();
        let runtime = self.render_runtime();
        let events = self.render_events();
        let files = self.render_files();
        let dialogs = self.render_dialogs();
        let encoder = self.render_encoder();
        let launcher = self.render_launcher();
        let verifier = self.render_verifier();
        let render_deps = crate::application::render_lifecycle::RenderDeps {
            session: &session,
            documents: &documents,
            tools: &tools,
            runtime: &runtime,
            events: &events,
            files: &files,
            dialogs: &dialogs,
            encoder: &encoder,
            launcher: &launcher,
            cache_dir: self.cache_dir.clone(),
        };
        let tail = self.render_tail_executor(render_deps, &verifier);
        let executor = self.project_stage_executor().with_extra(&tail);
        let run = crate::application::production::advance(
            &store, &executor, run_id, &info.root, &info.path,
        )?;
        crate::application::production::repair_review_failure(
            &store, run, &info.path, &info.root, &documents,
        )
    }

    /// Ejecutor de las etapas render/review/deliver, con las dependencias
    /// de render que el comando ya prestó desde `AppState`.
    pub fn render_tail_executor<'a>(
        &'a self,
        deps: crate::application::render_lifecycle::RenderDeps<'a>,
        verifier: &'a dyn crate::ports::render::RenderVerifier,
    ) -> crate::infrastructure::studio::render_executor::RenderReviewDeliverExecutor<'a> {
        crate::infrastructure::studio::render_executor::RenderReviewDeliverExecutor::new(
            deps, verifier,
        )
    }
    // MCP cliente
    pub fn mcp_store(&self) -> crate::infrastructure::mcp::LocalMcpServerStore {
        crate::infrastructure::mcp::config_dir_store(&self.config_dir)
    }
    pub fn mcp_env(&self) -> crate::infrastructure::mcp::KeyringMcpEnv {
        crate::infrastructure::mcp::keyring_env()
    }
    pub fn mcp_factory(&self) -> crate::infrastructure::mcp::StdioMcpTransportFactory {
        crate::infrastructure::mcp::stdio_factory()
    }
}
