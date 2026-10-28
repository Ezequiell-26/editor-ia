//! Shared native state: the currently open project, the user settings and the
//! live render jobs.
//!
//! Credentials never live here. The provider API key is written to the Windows
//! Credential Manager through the `keyring` crate and only read when a request
//! is about to be issued.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::license::LicenseTier;

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
    pub tts_voice: Option<String>,
    pub language: Option<String>,
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
        self
    }
}

pub struct RenderJob {
    pub child: Child,
    pub cancelled: Arc<AtomicBool>,
}

pub type SharedRenderJobs = Arc<Mutex<HashMap<String, Arc<Mutex<RenderJob>>>>>;

pub struct AppState {
    pub session: Mutex<Option<Session>>,
    pub settings: Mutex<Settings>,
    pub license: Mutex<crate::commands::license::LicenseState>,
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
        let license = crate::commands::license::LicenseState::load(&config_dir);

        // yt-dlp que vino con el instalador, si la carpeta gestionada está vacía.
        crate::commands::downloader::ensure_bundled_engine(&config_dir);

        let settings = std::fs::read_to_string(config_dir.join("settings.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .unwrap_or_default()
            .sanitized();

        Self {
            session: Mutex::new(None),
            settings: Mutex::new(settings),
            license: Mutex::new(license),
            config_dir,
            cache_dir,
            render_jobs: Arc::new(Mutex::new(HashMap::new())),
            thumbnails: Mutex::new(HashMap::new()),
            analysis_cache: Mutex::new(HashMap::new()),
            downloader_bridge: Mutex::new(None),
        }
    }

    pub fn license_tier(&self) -> LicenseTier {
        self.license
            .lock()
            .map(|license| license.tier)
            .unwrap_or(LicenseTier::Free)
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
                if let Ok(mut guard) = job.lock() {
                    guard
                        .cancelled
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = guard.child.kill();
                }
                let _ = std::fs::remove_dir_all(self.cache_dir.join(format!("render-{}", job_id)));
            }
        }
    }
}
