//! Espejo serde del `ProductionPlanSchema` de `packages/project-schema`.
//!
//! El schema zod sigue siendo la autoridad: valida, aplica defaults y rechaza
//! referencias cruzadas. Estos tipos existen para que el orquestador y los
//! puertos de `crate::ports::studio` manejen el plan de forma tipada. Si el
//! contrato cambia, cambia primero el schema y después este espejo.

use serde::{Deserialize, Serialize};

pub const STUDIO_PLAN_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StudioStage {
    Brief,
    Plan,
    Acquire,
    Analyze,
    Scenes,
    Edit,
    Render,
    Review,
    Deliver,
}

impl Default for StudioStage {
    fn default() -> Self {
        Self::Plan
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StudioResourceKind {
    Video,
    Image,
    Audio,
    Music,
    Sfx,
    Voice,
    Animation,
    Graphic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CommercialUseRequirement {
    Allowed,
    RequiresAttribution,
    NotForRedistribution,
    Unknown,
}

impl Default for CommercialUseRequirement {
    fn default() -> Self {
        Self::Allowed
    }
}

/// Orden de "mejor a peor" para comparar contra el resultado de una fuente.
fn commercial_use_rank(value: CommercialUseRequirement) -> u8 {
    match value {
        CommercialUseRequirement::Allowed => 3,
        CommercialUseRequirement::RequiresAttribution => 2,
        CommercialUseRequirement::NotForRedistribution => 1,
        CommercialUseRequirement::Unknown => 0,
    }
}

impl CommercialUseRequirement {
    /// ¿El uso comercial declarado satisface el piso pedido por el plan?
    pub fn satisfies(self, required: CommercialUseRequirement) -> bool {
        commercial_use_rank(self) >= commercial_use_rank(required)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionBrief {
    pub objective: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    #[serde(default)]
    pub key_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRequirement {
    pub id: String,
    pub kind: StudioResourceKind,
    pub query: String,
    #[serde(default = "default_max_count")]
    pub max_count: u32,
    #[serde(default)]
    pub min_commercial_use: CommercialUseRequirement,
    #[serde(default = "default_true")]
    pub prefer_local: bool,
    #[serde(default)]
    pub optional: bool,
    /// Voz pedida para generación `voice` (p.ej. nombre SAPI); `None` =
    /// la del proveedor. La ignoran las fuentes de adquisición.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
}

fn default_max_count() -> u32 {
    3
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanScene {
    pub id: String,
    pub order: u32,
    pub title: String,
    pub intent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_duration_frames: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narration_text: Option<String>,
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetPlatform {
    Youtube,
    Shorts,
    Reels,
    Tiktok,
    Other,
}

impl Default for TargetPlatform {
    fn default() -> Self {
        Self::Youtube
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionTarget {
    #[serde(default)]
    pub platform: TargetPlatform,
    pub aspect_ratio: String,
    pub target_duration_frames: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_profile_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QualityCheckKind {
    MissingResources,
    ClipRange,
    CaptionSync,
    Loudness,
    Resolution,
    Color,
    RenderVerify,
    Rights,
}

impl QualityCheckKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissingResources => "missing-resources",
            Self::ClipRange => "clip-range",
            Self::CaptionSync => "caption-sync",
            Self::Loudness => "loudness",
            Self::Resolution => "resolution",
            Self::Color => "color",
            Self::RenderVerify => "render-verify",
            Self::Rights => "rights",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCriteria {
    pub required_checks: Vec<QualityCheckKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_vmaf: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loudness_target_lufs: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

impl Default for SubtitleSpec {
    fn default() -> Self {
        Self {
            enabled: false,
            language: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
}

impl Default for MusicSpec {
    fn default() -> Self {
        Self {
            enabled: false,
            query: None,
        }
    }
}

/// Transición de entrada que `edit` aplica a los clips visuales de
/// producción (espejo del `transition` opcional del schema TS; mismo
/// subconjunto seguro de `ClipTransitionSchema`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanTransitionType {
    Dissolve,
    FadeBlack,
    FadeWhite,
    SlideLeft,
    SlideRight,
    SlideUp,
    SlideDown,
    WipeLeft,
    WipeRight,
    WipeUp,
    WipeDown,
    Iris,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTransition {
    #[serde(rename = "type")]
    pub transition_type: PlanTransitionType,
    pub frames: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionPlan {
    pub schema_version: u32,
    pub id: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    pub brief: ProductionBrief,
    pub target: ProductionTarget,
    #[serde(default)]
    pub requirements: Vec<ResourceRequirement>,
    #[serde(default)]
    pub scenes: Vec<PlanScene>,
    #[serde(default)]
    pub subtitles: SubtitleSpec,
    #[serde(default)]
    pub music: MusicSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<PlanTransition>,
    pub quality: QualityCriteria,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_cents: Option<u64>,
    #[serde(default)]
    pub stage: StudioStage,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_a_plan_written_by_the_typescript_schema() {
        let json = serde_json::json!({
            "schemaVersion": 1,
            "id": "plan-1",
            "createdAt": "2026-02-20T12:00:00.000Z",
            "updatedAt": "2026-02-20T12:00:00.000Z",
            "brief": { "objective": "Explicar el producto", "keyPoints": ["barato"] },
            "target": {
                "platform": "youtube",
                "aspectRatio": "16:9",
                "targetDurationFrames": 1800
            },
            "requirements": [{
                "id": "req-broll",
                "kind": "video",
                "query": "oficina moderna",
                "maxCount": 5,
                "minCommercialUse": "allowed",
                "preferLocal": true,
                "optional": false
            }],
            "scenes": [{
                "id": "scene-hook",
                "order": 0,
                "title": "Hook",
                "intent": "hook",
                "requirementIds": ["req-broll"]
            }],
            "subtitles": { "enabled": true, "language": "es" },
            "music": { "enabled": true, "query": "lofi" },
            "quality": { "requiredChecks": ["missing-resources", "clip-range"] },
            "stage": "acquire"
        });
        let plan: ProductionPlan = serde_json::from_value(json).expect("plan válido");
        assert_eq!(plan.schema_version, STUDIO_PLAN_VERSION);
        assert_eq!(plan.stage, StudioStage::Acquire);
        assert_eq!(plan.requirements[0].kind, StudioResourceKind::Video);
        assert_eq!(plan.scenes[0].requirement_ids, vec!["req-broll".to_owned()]);
        assert!(plan.subtitles.enabled);
        assert_eq!(plan.quality.required_checks.len(), 2);
    }

    #[test]
    fn commercial_use_floor_compares_by_rank() {
        assert!(CommercialUseRequirement::Allowed.satisfies(CommercialUseRequirement::Allowed));
        assert!(CommercialUseRequirement::Allowed.satisfies(CommercialUseRequirement::Unknown));
        assert!(!CommercialUseRequirement::Unknown.satisfies(CommercialUseRequirement::Allowed));
        assert!(CommercialUseRequirement::RequiresAttribution
            .satisfies(CommercialUseRequirement::RequiresAttribution));
    }
}
