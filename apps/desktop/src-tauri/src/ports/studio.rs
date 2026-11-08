//! Ports del estudio audiovisual autónomo.
//!
//! Fronteras para el futuro Production Orchestrator: catálogo multimedia,
//! adquisición de recursos con derechos declarados y generación de contenido
//! por capacidad. Ningún provider concreto vive aquí — las implementaciones
//! llegarán como adaptadores en `crate::infrastructure` cuando exista la
//! primera fuente real.
//!
//! Regla de diseño: los tipos son serializables porque cruzan la frontera IPC
//! y el documento de producción; los traits describen capacidades, no
//! proveedores.

use serde::{Deserialize, Serialize};

use crate::projects::service::ProjectError;
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};
use crate::studio::run::{ProductionRun, StageOutcome};

// ---------------------------------------------------------------------------
// Catálogo multimedia
// ---------------------------------------------------------------------------

/// Entrada del catálogo: un recurso local o indexado con sus metadatos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub kind: StudioResourceKind,
    /// Ruta relativa al proyecto o referencia opaca del recurso.
    pub reference: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_frames: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    /// Resumen del análisis automático (escenas, objetos, tono…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// Procedencia: quién lo hizo, de dónde salió, bajo qué licencia.
    pub source: ResourceSource,
}

/// Quién provee el recurso y con qué derechos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSource {
    /// `user`, `catalog-local`, `acquisition:<source-id>`, `generation:<provider>`.
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub license: ResourceLicense,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Texto de atribución requerido, si la licencia lo exige.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
    /// Hash de contenido para deduplicar y verificar integridad.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceLicense {
    /// Identificador de licencia (`cc0`, `user-declared`, `all-rights-reserved`…).
    pub id: String,
    pub commercial_use: CommercialUseRequirement,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl ResourceLicense {
    /// ¿Esta licencia habilita el uso que el plan exige como mínimo?
    pub fn satisfies(&self, required: CommercialUseRequirement) -> bool {
        self.commercial_use.satisfies(required)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogQuery {
    pub kind: Option<StudioResourceKind>,
    pub text: Option<String>,
    pub tags: Vec<String>,
    pub limit: u32,
}

impl Default for CatalogQuery {
    fn default() -> Self {
        Self {
            kind: None,
            text: None,
            tags: Vec::new(),
            limit: 20,
        }
    }
}

/// Índice incremental y recuperable de la biblioteca multimedia.
///
/// La implementación inicial puede ser un escaneo del proyecto + caché local;
/// la búsqueda semántica es optativa y nunca exige un servicio remoto.
pub trait MediaCatalog: Send + Sync {
    fn search(&self, query: &CatalogQuery) -> Result<Vec<CatalogEntry>, ProjectError>;
    fn get(&self, id: &str) -> Result<Option<CatalogEntry>, ProjectError>;
    /// Registra o actualiza una entrada (importación, análisis, indexación).
    fn upsert(&self, entry: &CatalogEntry) -> Result<(), ProjectError>;
    /// Quita del índice lo que ya no existe en disco.
    fn prune_missing(&self) -> Result<u32, ProjectError>;
}

// ---------------------------------------------------------------------------
// Adquisición de recursos
// ---------------------------------------------------------------------------

/// Una fuente autorizada declara sus condiciones antes de buscar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDescriptor {
    pub id: String,
    pub name: String,
    /// Condiciones de uso en texto libre para revisión humana.
    pub terms: String,
    /// Coste por descarga en centavos de USD; 0 = gratuito.
    pub cost_cents_per_download: u32,
    pub rate_limit_per_hour: Option<u32>,
    pub requires_attribution: bool,
    pub availability: SourceAvailability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceAvailability {
    Available,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionQuery {
    pub requirement_id: String,
    pub kind: StudioResourceKind,
    pub text: String,
    pub limit: u32,
    /// Piso de derechos: resultados por debajo se descartan.
    pub min_commercial_use: CommercialUseRequirement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionCandidate {
    pub source_id: String,
    pub external_id: String,
    /// Kind de recurso que el candidato satisface (lo fija `search`).
    pub kind: StudioResourceKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub license: ResourceLicense,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(default)]
    pub cost_cents: u32,
}

/// Recurso adquirido: bytes ya en disco del proyecto + su ficha de derechos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquiredResource {
    /// Path relativo al root del proyecto donde quedaron los bytes.
    pub path: String,
    pub bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub candidate: AcquisitionCandidate,
}

/// Puerto de adquisición: buscar y traer material de fuentes autorizadas.
///
/// Cada implementación declara `sources()` para que el orquestador pueda
/// mostrar condiciones, límites y costes antes de gastar.
pub trait ResourceAcquisition: Send + Sync {
    fn sources(&self) -> Vec<SourceDescriptor>;
    fn search(
        &self,
        source_id: &str,
        query: &AcquisitionQuery,
    ) -> Result<Vec<AcquisitionCandidate>, ProjectError>;
    /// Descarga y registra el recurso. Debe verificar licencia y registrar la
    /// procedencia; nunca debe entregar bytes sin ficha de derechos.
    fn acquire(
        &self,
        source_id: &str,
        candidate: &AcquisitionCandidate,
        project_root: &std::path::Path,
    ) -> Result<AcquiredResource, ProjectError>;
}

// ---------------------------------------------------------------------------
// Generación de contenido
// ---------------------------------------------------------------------------

/// Capacidad declarada por un proveedor de generación.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationCapability {
    pub provider: String,
    pub model: String,
    pub kind: StudioResourceKind,
    /// Coste estimado por llamada, en centavos; `None` = desconocido/gratis.
    pub estimated_cost_cents: Option<u32>,
    /// Límites declarados (p.ej. duración máxima de vídeo en segundos).
    #[serde(default)]
    pub limits: Vec<String>,
    /// `true` si el proveedor necesita red; `false` si corre local.
    pub requires_network: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    /// Id de correlación para auditoría y reintentos.
    pub request_id: String,
    pub kind: StudioResourceKind,
    /// Prompt o payload específico del tipo de generación.
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    /// Path relativo al root del proyecto con el recurso generado.
    pub path: String,
    pub bytes: u64,
    pub provider: String,
    pub model: String,
    /// Coste real informado por el proveedor, si lo declara.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_cents: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<ResourceLicense>,
}

/// Puerto de generación: texto, imagen, vídeo, voz, música, sfx, animación.
///
/// Un provider implementa este trait por capacidad; el orquestador elige por
/// `capabilities()` sin conocer al proveedor. La generación nunca se mezcla
/// con el renderer: produce assets que luego entran al proyecto.
pub trait ContentGenerator: Send + Sync {
    fn provider_id(&self) -> &str;
    fn capabilities(&self) -> Vec<GenerationCapability>;
    fn generate(
        &self,
        request: &GenerationRequest,
        project_root: &std::path::Path,
    ) -> Result<GenerationResult, ProjectError>;
}

// ---------------------------------------------------------------------------
// Orquestador de producción
// ---------------------------------------------------------------------------

/// Persistencia de ejecuciones: la corrida sobrevive a reinicios de la app.
pub trait ProductionStore: Send + Sync {
    fn save(&self, run: &ProductionRun) -> Result<(), ProjectError>;
    fn load(&self, run_id: &str) -> Result<Option<ProductionRun>, ProjectError>;
    fn list(&self) -> Result<Vec<ProductionRun>, ProjectError>;
    fn remove(&self, run_id: &str) -> Result<(), ProjectError>;
}

/// Contexto mínimo que el ejecutor de etapas necesita: proyecto destino,
/// plan y presupuesto restante. Los adaptadores reales lo completan con sus
/// dependencias (catálogo, generadores, render).
#[derive(Debug, Clone)]
pub struct StageContext {
    /// Raíz del proyecto donde la etapa escribe sus artefactos.
    pub project_root: std::path::PathBuf,
    /// Ruta del documento del proyecto abierto (`.editoria.json` o el
    /// `.json` que la sesión tenga comprometido).
    pub document_path: std::path::PathBuf,
    /// Plan de producción serializado (el ejecutor lo interpreta).
    pub plan: serde_json::Value,
    /// Presupuesto restante en centavos; `None` = sin límite.
    pub remaining_budget_cents: Option<u64>,
    /// Intento actual de la etapa (1-based).
    pub attempt: u32,
    /// Output del intento anterior de ESTA etapa (sondeos async: jobId,
    /// rutas publicadas…). `None` en el primer intento.
    pub previous_output: Option<serde_json::Value>,
    /// Outputs de las etapas ya cerradas, indexados por nombre de etapa en
    /// kebab-case (`{"render": {...}, "review": {...}}`). Permite que
    /// `deliver` encuentre el MP4 que `render` produjo.
    pub stage_outputs: serde_json::Value,
}

/// Ejecuta UNA etapa del pipeline. La implementación decide qué hacer con
/// ella (adquirir, analizar, editar, renderizar…); el orquestador sólo
/// interpreta el `StageOutcome` y actualiza checkpoints/presupuesto.
///
/// Debe ser honesta: si no puede ejecutar la etapa devuelve
/// `completed: false` con `error`, nunca simula un resultado.
///
/// No exige `Send + Sync`: `advance` corre síncrono en el hilo del comando;
/// los ejecutores que toman deps de `AppState` no son `Sync`.
pub trait StageExecutor {
    /// Etapas que este ejecutor sabe correr (para composición y diagnóstico).
    fn supported_stages(&self) -> Vec<crate::studio::plan::StudioStage>;
    fn execute(
        &self,
        stage: crate::studio::plan::StudioStage,
        ctx: &StageContext,
    ) -> Result<StageOutcome, ProjectError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::plan::CommercialUseRequirement;

    #[test]
    fn license_satisfies_the_plan_floor() {
        let allowed = ResourceLicense {
            id: "cc0".to_owned(),
            commercial_use: CommercialUseRequirement::Allowed,
            url: None,
        };
        assert!(allowed.satisfies(CommercialUseRequirement::Allowed));
        assert!(allowed.satisfies(CommercialUseRequirement::Unknown));

        let unknown = ResourceLicense {
            id: "all-rights-reserved".to_owned(),
            commercial_use: CommercialUseRequirement::Unknown,
            url: None,
        };
        assert!(!unknown.satisfies(CommercialUseRequirement::Allowed));
    }

    #[test]
    fn catalog_query_defaults_are_safe() {
        let query = CatalogQuery::default();
        assert_eq!(query.limit, 20);
        assert!(query.kind.is_none());
        assert!(query.tags.is_empty());
    }
}
