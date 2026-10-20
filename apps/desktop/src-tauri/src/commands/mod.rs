//! Allowlisted Tauri commands. Everything privileged lives behind these
//! functions: project persistence, media import, rendering, provider
//! credentials and local narration.

pub mod analysis;
pub mod audio_providers;
pub mod convert;
pub mod intelligence;
pub mod mcp;
pub mod media;
pub mod memory;
pub mod narration;
pub mod projects;
pub mod providers;
pub mod publish;
pub mod render;
pub mod system;
pub mod transcribe;
pub mod variants;
