//! Ports: interfaces que la capa de aplicación necesita del exterior.
//!
//! Los casos de uso dependen de estos traits, nunca de Tauri, del filesystem
//! concreto ni de los comandos IPC. Las implementaciones viven en
//! `crate::infrastructure`.

pub mod agent;
pub mod ai;
pub mod conversion;
pub mod mcp;
pub mod mcp_server;
pub mod media;
pub mod projects;
pub mod proxies;
pub mod render;
