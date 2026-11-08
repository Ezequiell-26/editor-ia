//! Dominio del estudio audiovisual: plan de producción y revisión de calidad.
//!
//! `plan` refleja el contrato versionado `ProductionPlanSchema` de
//! `packages/project-schema` (la autoridad de validación es el schema zod;
//! aquí vive la forma que el orquestador consume en Rust).
//! `quality` contiene las comprobaciones puras del Quality Gate sobre el
//! documento del proyecto.

pub mod plan;
pub mod quality;
pub mod run;
