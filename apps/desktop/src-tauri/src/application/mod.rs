//! Casos de uso de la aplicación.
//!
//! Cada función recibe los ports que necesita, valida la entrada, aplica las
//! reglas del dominio y devuelve una vista tipada. No conoce Tauri, ni
//! diálogos, ni `AppState`: eso entra por `crate::ports`.

pub mod agent;
pub mod assistant;
pub mod conversion;
pub mod export_tools;
pub mod localization;
pub mod lossless;
pub mod mcp;
pub mod mcp_server;
pub mod media;
mod media_analysis;
mod media_subtitles;
pub mod motion;
pub mod production;
pub mod projects;
pub mod providers;
pub mod proxies;
pub mod quality_gate;
pub mod render_lifecycle;
pub mod render_queue;
pub mod timeline_export;
pub mod timeline_import;
