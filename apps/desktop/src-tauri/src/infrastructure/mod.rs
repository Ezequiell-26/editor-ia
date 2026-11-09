//! Adaptadores de infraestructura.
//!
//! Implementan los ports de `crate::ports` con las capacidades reales de la
//! app: el documento de proyecto (`projects::service`), los diálogos y el
//! asset protocol de Tauri, el `AppState` de sesión, el versionado de
//! `.olyvia-history/` y la recuperación de assets en disco.

pub mod agent;
pub mod ai;
pub mod conversion;
pub mod mcp;
pub mod mcp_server;
pub mod mcp_studio;
pub mod media;
pub mod process;
pub mod projects;
pub mod projects_history;
pub mod projects_recovery;
pub mod proxies;
pub mod render_jobs;
pub mod render_lossless;
pub mod render_queue;
pub mod studio;
