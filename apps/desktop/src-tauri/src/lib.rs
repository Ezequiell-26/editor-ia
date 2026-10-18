//! Biblioteca del escritorio de Editor IA.
//!
//! El crate todavía no trae Tauri: este módulo es el borde de proyecto que la
//! interfaz invoca por nombre de comando. Toda escritura de archivos vive acá,
//! después de validar, y nunca arma comandos de shell.

pub mod projects;
