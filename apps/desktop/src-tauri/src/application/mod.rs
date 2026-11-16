//! Casos de uso de la aplicación.
//!
//! Cada función recibe los ports que necesita, valida la entrada, aplica las
//! reglas del dominio y devuelve una vista tipada. No conoce Tauri, ni
//! diálogos, ni `AppState`: eso entra por `crate::ports`.

pub mod agent;
pub mod assistant;
pub mod audio_providers;
pub mod browser_instances;
pub mod cdp;
pub mod channel_analytics;
pub mod concat_worker;
pub mod conversion;
pub mod diarize;
pub mod downloads;
pub mod download_automation;
pub mod download_plan;
pub mod downloader_bridge;
pub mod export_tools;
pub mod fs;
pub mod localization;
pub mod lossless;
pub mod mcp;
pub mod mcp_audit;
pub mod mcp_server;
pub mod media;
pub mod models;
pub mod obs_scenes;
mod media_analysis;
mod media_subtitles;
pub mod lip_sync;
pub mod motion;
pub mod narration;
pub mod object_track;
pub mod plugins;
pub mod production;
pub mod projects;
pub mod providers;
pub mod proxies;
pub mod quality_gate;
pub mod render_lifecycle;
pub mod render_queue;
pub mod studio_planner;
pub mod studio_reacquire;
pub mod studio_repair;
pub mod timeline_export;
pub mod timeline_import;
pub mod transcribe;
pub mod variants;
pub mod vpn;
pub mod voice_isolation;
pub mod web_sessions;
pub mod whiteboard;
