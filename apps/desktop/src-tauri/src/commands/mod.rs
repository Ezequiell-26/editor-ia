//! Allowlisted Tauri commands. Everything privileged lives behind these
//! functions: project persistence, media import, rendering, provider
//! credentials and local narration.

pub mod media;
pub mod narration;
pub mod projects;
pub mod providers;
pub mod render;
pub mod system;
