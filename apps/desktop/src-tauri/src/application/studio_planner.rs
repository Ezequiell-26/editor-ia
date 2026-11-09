//! Planner determinista brief → `ProductionPlan`.
//!
//! Es el "modelo determinista" del spec: el LLM (o el usuario) propone el
//! brief; ESTE módulo estructura el plan de forma validada y reproducible,
//! sin llamar a ningún proveedor. No inventa recursos: las queries de B-roll
//! se derivan del texto del usuario y la etapa `acquire` decide después si
//! hay fuente autorizada que las satisfaga.
//!
//! Regla honesta: el plan es una ESTRUCTURA, no una promesa de resultado.
//! Si el brief es pobre (sin key points ni query útil), el plan resultante
//! tiene pocas escenas y `acquire` puede declarar `requires_provider` —
//! eso es información correcta, no un fallo del planner.

use crate::ai::providers::{extract_json, json_repair_messages, MAX_REPAIR_ECHO_CHARS};
use crate::ports::ai::{ChatCall, ProviderChat, ProviderConfig};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{
    CommercialUseRequirement, MusicSpec, PlanScene, ProductionBrief, ProductionPlan,
    ProductionTarget, QualityCheckKind, QualityCriteria, ResourceRequirement, StudioResourceKind,
    StudioStage, SubtitleSpec, TargetPlatform,
};

/// Pedido de plan: lo que un cliente (UI, MCP, asistente) puede expresar
/// sin conocer el schema interno del plan.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanRequest {
    pub objective: String,
    pub audience: Option<String>,
    pub tone: Option<String>,
    pub key_points: Vec<String>,
    /// Escenas deseadas como pista; `None` = una por key point (máx. 8) o 1.
    pub scene_count: Option<u32>,
    /// Duración objetivo total en segundos (default 30).
    pub duration_seconds: Option<u32>,
    /// `youtube` (default), `shorts`, `reels`, `tiktok`.
    pub platform: Option<String>,
    /// `16:9` (default youtube) u `9:16`/`1:1` para verticales.
    pub aspect_ratio: Option<String>,
    /// Voz del generador local para narrar (p.ej. nombre SAPI).
    pub voice: Option<String>,
    /// Cama musical ambiental generada localmente.
    pub music: Option<bool>,
    /// Tarjeta de título inicial generada localmente.
    pub title_card: Option<bool>,
    /// Query explícita para el B-roll; default = objective recortado.
    pub broll_query: Option<String>,
    pub max_cost_cents: Option<u64>,
}

const MAX_SCENES: usize = 8;
const DEFAULT_DURATION_SECONDS: u32 = 30;
const DEFAULT_FPS: u64 = 30;

fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("unix:{}", d.as_secs()))
        .unwrap_or_else(|_| "unix:0".to_owned())
}

fn slug(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(40)
        .collect()
}

/// Plataforma y aspect ratio: Shorts/Reels/TikTok comparten target
/// vertical 9:16 salvo que el usuario pida otro explícito.
fn platform_and_ratio(request: &PlanRequest) -> (TargetPlatform, String) {
    let normalized = request
        .platform
        .as_deref()
        .unwrap_or("youtube")
        .to_ascii_lowercase();
    let platform = match normalized.as_str() {
        "shorts" => TargetPlatform::Shorts,
        "reels" => TargetPlatform::Reels,
        "tiktok" => TargetPlatform::Tiktok,
        _ => TargetPlatform::Youtube,
    };
    let vertical = matches!(normalized.as_str(), "shorts" | "reels" | "tiktok");
    let aspect = request.aspect_ratio.clone().unwrap_or_else(|| {
        if vertical {
            "9:16".to_owned()
        } else {
            "16:9".to_owned()
        }
    });
    (platform, aspect)
}

fn base_requirement(
    id: &str,
    kind: StudioResourceKind,
    query: &str,
    max_count: u32,
) -> ResourceRequirement {
    ResourceRequirement {
        id: id.to_owned(),
        kind,
        query: query.to_owned(),
        max_count,
        min_commercial_use: CommercialUseRequirement::Allowed,
        prefer_local: true,
        optional: false,
        voice: None,
    }
}

/// Construye un `ProductionPlan` válido a partir de un brief. Errores sólo
/// por entrada realmente inválida (objetivo vacío, platform desconocida
/// severa no — se normaliza a youtube).
pub fn plan_from_brief(request: &PlanRequest) -> Result<ProductionPlan, ProjectError> {
    let objective = request.objective.trim();
    if objective.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el objetivo de la producción no puede estar vacío",
        ));
    }
    if objective.len() > 2000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el objetivo supera el máximo de 2000 caracteres",
        ));
    }

    if let Some(ratio) = request.aspect_ratio.as_deref() {
        if !matches!(ratio, "16:9" | "9:16" | "1:1" | "4:5") {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "aspectRatio debe ser 16:9, 9:16, 1:1 o 4:5",
            ));
        }
    }

    let stamp = now();
    let plan_id = format!("plan-{}", uuid::Uuid::new_v4().simple());
    let (platform, aspect_ratio) = platform_and_ratio(request);
    let duration_seconds = request
        .duration_seconds
        .unwrap_or(DEFAULT_DURATION_SECONDS)
        .clamp(3, 3600);
    let target_duration_frames = u64::from(duration_seconds) * DEFAULT_FPS;

    // --- Escenas: una por key point (tope MAX_SCENES); sin puntos, una
    // sola escena con el objetivo. El texto de cada escena es su
    // narración: habilita subtítulos y voz sin pasos extra.
    let mut scene_texts: Vec<String> = request
        .key_points
        .iter()
        .map(|point| point.trim().to_owned())
        .filter(|point| !point.is_empty() && point.len() <= 2000)
        .take(MAX_SCENES)
        .collect();
    if scene_texts.is_empty() {
        scene_texts.push(objective.to_owned());
    }
    let requested_scenes = request.scene_count.unwrap_or(0) as usize;
    if requested_scenes > 0 && requested_scenes < scene_texts.len() {
        scene_texts.truncate(requested_scenes.max(1));
    }

    let mut requirements: Vec<ResourceRequirement> = Vec::new();
    let mut scenes: Vec<PlanScene> = Vec::new();

    // B-roll: una requirement de vídeo compartida por todas las escenas.
    // La query es la del usuario o el objetivo recortado — acquire decide
    // si biblioteca local o Internet Archive la satisfacen.
    let broll_query = request
        .broll_query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .unwrap_or(objective)
        .chars()
        .take(120)
        .collect::<String>();
    let req_broll = "req-broll".to_owned();
    requirements.push(base_requirement(
        &req_broll,
        StudioResourceKind::Video,
        &broll_query,
        scene_texts.len().clamp(1, 6) as u32,
    ));

    for (index, text) in scene_texts.iter().enumerate() {
        let scene_id = format!("scene-{}", slug(text).chars().take(24).collect::<String>());
        let scene_id = if scene_id == "scene-" {
            format!("scene-{}", index + 1)
        } else {
            scene_id
        };
        scenes.push(PlanScene {
            id: scene_id.clone(),
            order: index as u32,
            title: text.chars().take(80).collect(),
            intent: "narrative".to_owned(),
            target_duration_frames: Some(target_duration_frames / scene_texts.len() as u64),
            narration_text: Some(text.clone()),
            requirement_ids: vec![req_broll.clone()],
            notes: None,
        });

        // Voz: un requisito `voice` por escena narrada + escena de audio
        // adicional (misma convención que el builder del frontend).
        if let Some(voice) = request
            .voice
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            let req_id = format!("req-voz-{scene_id}");
            let mut req = base_requirement(&req_id, StudioResourceKind::Voice, text, 1);
            req.voice = Some(voice.to_owned());
            requirements.push(req);
            scenes.push(PlanScene {
                id: format!("voz-{scene_id}"),
                order: scenes.len() as u32,
                title: format!("{} (voz)", text.chars().take(60).collect::<String>()),
                intent: "explainer".to_owned(),
                target_duration_frames: None,
                narration_text: None,
                requirement_ids: vec![req_id],
                notes: None,
            });
        }
    }

    // Tarjeta de título: escena `portada` inicial con requisito `title:`.
    if request.title_card.unwrap_or(false) {
        let title_text = objective.chars().take(80).collect::<String>();
        requirements.push(base_requirement(
            "req-portada",
            StudioResourceKind::Image,
            &format!("title:{title_text}"),
            1,
        ));
        scenes.insert(
            0,
            PlanScene {
                id: "portada".to_owned(),
                order: 0,
                title: title_text,
                intent: "explainer".to_owned(),
                target_duration_frames: None,
                narration_text: None,
                requirement_ids: vec!["req-portada".to_owned()],
                notes: None,
            },
        );
        for (index, scene) in scenes.iter_mut().enumerate() {
            scene.order = index as u32;
        }
    }

    // Música ambiental generada localmente.
    let music_enabled = request.music.unwrap_or(false);
    if music_enabled {
        requirements.push(base_requirement(
            "req-musica",
            StudioResourceKind::Music,
            "music:ambient",
            1,
        ));
    }

    let has_narration = scenes.iter().any(|scene| scene.narration_text.is_some());

    Ok(ProductionPlan {
        schema_version: 1,
        id: plan_id,
        created_at: stamp.clone(),
        updated_at: stamp,
        brief: ProductionBrief {
            objective: objective.to_owned(),
            audience: request.audience.clone(),
            tone: request.tone.clone(),
            key_points: request.key_points.clone(),
        },
        target: ProductionTarget {
            platform,
            aspect_ratio,
            target_duration_frames,
            render_profile_id: None,
        },
        requirements,
        scenes,
        subtitles: SubtitleSpec {
            enabled: has_narration,
            language: has_narration.then(|| "es".to_owned()),
        },
        music: MusicSpec {
            enabled: music_enabled,
            query: music_enabled.then(|| "music:ambient".to_owned()),
        },
        transition: None,
        quality: QualityCriteria {
            required_checks: vec![
                QualityCheckKind::MissingResources,
                QualityCheckKind::ClipRange,
                QualityCheckKind::RenderVerify,
                QualityCheckKind::Rights,
            ],
            min_vmaf: None,
            loudness_target_lufs: None,
        },
        max_cost_cents: request.max_cost_cents,
        stage: StudioStage::Plan,
    })
}

// ---------------------------------------------------------------------------
// Interpretación de lenguaje natural → PlanRequest → ProductionPlan
// ---------------------------------------------------------------------------
//
// El provider de chat del usuario (BYOK) convierte texto libre en el brief
// estructurado; `plan_from_brief` sigue siendo quien valida y construye.
// La salida del modelo es texto no confiable: se parsea a `PlanRequest`
// acotado y se repara UNA vez si no es JSON válido (mismo contrato que
// `generate_script`). El provider `mock` NO interpreta: devuelve error
// honesto en vez de simular comprensión.

/// Pedido de plan desde texto libre. `approvedCost` autoriza gasto del
/// provider remoto (misma regla que `generate_script`).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTextRequest {
    pub text: String,
    #[serde(default)]
    pub approved_cost: Option<bool>,
}

pub const MAX_BRIEF_TEXT_CHARS: usize = 2_000;

const PLAN_SYSTEM_PROMPT: &str = "Sos el planificador de producción audiovisual de Olyvia. \
Convertí el pedido del usuario en un objeto JSON con el brief de producción. \
Devolvé SOLO JSON válido, sin markdown ni explicaciones, con estas claves opcionales: \
\"objective\" (string, requerido, el objetivo del video), \
\"audience\" (string), \"tone\" (string), \
\"keyPoints\" (array de strings, 1 a 8 puntos narrativos), \
\"sceneCount\" (entero 1-8), \"durationSeconds\" (entero 3-3600), \
\"platform\" (\"youtube\"|\"shorts\"|\"reels\"|\"tiktok\"), \
\"aspectRatio\" (\"16:9\"|\"9:16\"|\"1:1\"|\"4:5\"), \
\"voice\" (string, nombre de voz si el usuario la pide), \
\"music\" (boolean, cama musical de fondo), \
\"titleCard\" (boolean, tarjeta de título inicial), \
\"brollQuery\" (string, búsqueda de material de apoyo en inglés o el idioma del video), \
\"maxCostCents\" (entero, tope de gasto si el usuario lo menciona). \
Reglas: se breve y concreto; si el usuario no pide voz/música/tarjeta, omitirlas o false; \
para verticales (shorts/reels/tiktok) usar aspectRatio 9:16; no inventes datos que el usuario no dio.";

/// Parsea la respuesta del modelo a `PlanRequest`. Acepta JSON puro o
/// JSON embebido en texto (`extract_json`).
pub fn parse_plan_request(content: &str) -> Result<PlanRequest, ProjectError> {
    let json_text = extract_json(content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el modelo no devolvió un brief JSON interpretable",
        )
    })?;
    serde_json::from_str::<PlanRequest>(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el brief del modelo no cumple el contrato PlanRequest",
        )
    })
}

/// Texto libre → `ProductionPlan` usando el provider de chat configurado.
///
/// `config`/`key` ya vienen resueltos y autorizados por el caller (la
/// política de coste se aplica antes de llegar acá). Errores honestos:
/// provider `mock` no interpreta, JSON inválido tras UN reintento de
/// reparación ⇒ `InvalidProviderResponse`.
pub async fn plan_from_text(
    chat: &dyn ProviderChat,
    config: &ProviderConfig,
    key: Option<String>,
    text: &str,
) -> Result<ProductionPlan, ProjectError> {
    let text = text.trim();
    if text.chars().count() < 10 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí la producción con al menos 10 caracteres",
        ));
    }
    if text.chars().count() > MAX_BRIEF_TEXT_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el texto supera los {MAX_BRIEF_TEXT_CHARS} caracteres"),
        ));
    }
    if config.kind == "mock" {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor mock no interpreta lenguaje natural; configurá un proveedor real",
        ));
    }
    let messages = vec![
        serde_json::json!({ "role": "system", "content": PLAN_SYSTEM_PROMPT }),
        serde_json::json!({ "role": "user", "content": text }),
    ];
    let call = |messages: Vec<serde_json::Value>| ChatCall {
        base_url: config.base_url.clone(),
        model: config.model.clone(),
        temperature: 0.2,
        messages,
        key: key.clone(),
    };
    let content = chat.chat(call(messages.clone())).await?;
    let request = match parse_plan_request(&content) {
        Ok(request) => request,
        Err(_) => {
            // Un reintento de reparación: el modelo ve su salida inválida
            // y debe devolver sólo el JSON corregido.
            let echo: String = content.chars().take(MAX_REPAIR_ECHO_CHARS).collect();
            let repaired = chat
                .chat(call(json_repair_messages(messages, &echo)))
                .await?;
            parse_plan_request(&repaired)?
        }
    };
    plan_from_brief(&request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> PlanRequest {
        PlanRequest {
            objective: "Video sobre energía solar".to_owned(),
            key_points: vec![
                "El sol es gratis".to_owned(),
                "Los paneles duran 25 años".to_owned(),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn brief_with_key_points_builds_one_scene_each() {
        let plan = plan_from_brief(&request()).unwrap();
        assert_eq!(plan.scenes.len(), 2);
        assert!(plan
            .scenes
            .iter()
            .all(|scene| scene.narration_text.is_some()));
        assert!(plan.subtitles.enabled);
        assert_eq!(plan.subtitles.language.as_deref(), Some("es"));
        assert_eq!(plan.target.aspect_ratio, "16:9");
        assert_eq!(plan.target.platform, TargetPlatform::Youtube);
        assert_eq!(plan.target.target_duration_frames, 900);
        assert_eq!(plan.requirements.len(), 1);
        assert_eq!(plan.requirements[0].kind, StudioResourceKind::Video);
    }

    #[test]
    fn voice_music_and_title_card_add_their_requirements() {
        let mut req = request();
        req.voice = Some("Microsoft Sabina Desktop".to_owned());
        req.music = Some(true);
        req.title_card = Some(true);
        let plan = plan_from_brief(&req).unwrap();
        // portada + 2 escenas + 2 voz + música
        assert_eq!(plan.scenes.len(), 5);
        assert_eq!(plan.scenes[0].id, "portada");
        let kinds: Vec<StudioResourceKind> = plan.requirements.iter().map(|r| r.kind).collect();
        assert!(kinds.contains(&StudioResourceKind::Voice));
        assert!(kinds.contains(&StudioResourceKind::Music));
        assert!(kinds.contains(&StudioResourceKind::Image));
        assert!(plan.music.enabled);
        assert_eq!(plan.music.query.as_deref(), Some("music:ambient"));
        let voice_req = plan
            .requirements
            .iter()
            .find(|r| r.kind == StudioResourceKind::Voice)
            .unwrap();
        assert_eq!(voice_req.voice.as_deref(), Some("Microsoft Sabina Desktop"));
    }

    #[test]
    fn vertical_platform_defaults_to_9_16() {
        let mut req = request();
        req.platform = Some("tiktok".to_owned());
        let plan = plan_from_brief(&req).unwrap();
        assert_eq!(plan.target.aspect_ratio, "9:16");
        assert_eq!(plan.target.platform, TargetPlatform::Tiktok);
    }

    #[test]
    fn empty_objective_is_rejected() {
        let mut req = request();
        req.objective = "   ".to_owned();
        assert!(plan_from_brief(&req).is_err());
    }

    #[test]
    fn no_key_points_falls_back_to_single_scene() {
        let mut req = request();
        req.key_points = vec![];
        let plan = plan_from_brief(&req).unwrap();
        assert_eq!(plan.scenes.len(), 1);
        assert_eq!(
            plan.scenes[0].narration_text.as_deref(),
            Some("Video sobre energía solar")
        );
    }

    #[test]
    fn broll_query_override_is_used() {
        let mut req = request();
        req.broll_query = Some("paneles solares campo".to_owned());
        let plan = plan_from_brief(&req).unwrap();
        assert_eq!(plan.requirements[0].query, "paneles solares campo");
    }

    #[test]
    fn invalid_aspect_ratio_is_rejected() {
        let mut req = request();
        req.aspect_ratio = Some("21:9".to_owned());
        assert!(plan_from_brief(&req).is_err());
    }

    #[test]
    fn oversized_objective_is_rejected() {
        let mut req = request();
        req.objective = "x".repeat(2001);
        assert!(plan_from_brief(&req).is_err());
    }

    // --- plan_from_text (NL → PlanRequest vía provider de chat) -----------

    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// ProviderChat falso: devuelve las respuestas encoladas y cuenta
    /// cuántas veces fue llamado (para verificar el reintento de reparación).
    struct FakeChat {
        responses: Mutex<VecDeque<String>>,
        calls: Mutex<u32>,
    }

    impl FakeChat {
        fn new(responses: Vec<String>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                calls: Mutex::new(0),
            }
        }
        fn calls(&self) -> u32 {
            *self.calls.lock().unwrap()
        }
    }

    impl ProviderChat for FakeChat {
        fn chat<'a>(
            &'a self,
            _call: ChatCall,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<String, ProjectError>> + Send + 'a>,
        > {
            Box::pin(async move {
                *self.calls.lock().unwrap() += 1;
                self.responses.lock().unwrap().pop_front().ok_or_else(|| {
                    ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        "sin respuesta encolada",
                    )
                })
            })
        }
    }

    fn chat_config(kind: &str) -> ProviderConfig {
        ProviderConfig {
            kind: kind.to_owned(),
            base_url: "http://127.0.0.1:9/v1".to_owned(),
            model: "fake".to_owned(),
        }
    }

    #[tokio::test]
    async fn plan_from_text_builds_plan_from_model_json() {
        let chat = FakeChat::new(vec![
            r#"{"objective":"Video sobre energía solar","keyPoints":["El sol es gratis","Paneles duraderos"],"platform":"tiktok","music":true}"#
                .to_owned(),
        ]);
        let plan = plan_from_text(
            &chat,
            &chat_config("openai-compatible"),
            None,
            "haceme un video corto de paneles solares para tiktok",
        )
        .await
        .unwrap();
        assert_eq!(plan.scenes.len(), 2);
        assert_eq!(plan.target.platform, TargetPlatform::Tiktok);
        assert_eq!(plan.target.aspect_ratio, "9:16");
        assert!(plan.music.enabled);
        assert_eq!(chat.calls(), 1);
    }

    #[tokio::test]
    async fn plan_from_text_repairs_invalid_json_once() {
        let chat = FakeChat::new(vec![
            "acá va el plan: {no es json".to_owned(),
            r#"{"objective":"Repaso de licencias open source","keyPoints":["Qué es una licencia"]}"#
                .to_owned(),
        ]);
        let plan = plan_from_text(
            &chat,
            &chat_config("openai-compatible"),
            None,
            "explicame las licencias open source en un video",
        )
        .await
        .unwrap();
        assert_eq!(plan.scenes.len(), 1);
        assert_eq!(chat.calls(), 2);
    }

    #[tokio::test]
    async fn plan_from_text_fails_after_two_bad_responses() {
        let chat = FakeChat::new(vec!["nada".to_owned(), "tampoco json".to_owned()]);
        let error = plan_from_text(
            &chat,
            &chat_config("openai-compatible"),
            None,
            "contame algo interesante para un video",
        )
        .await
        .expect_err("dos respuestas inválidas ⇒ error");
        assert_eq!(chat.calls(), 2);
        assert_eq!(error.code, ProjectErrorCode::InvalidProviderResponse);
    }

    #[tokio::test]
    async fn plan_from_text_rejects_mock_and_short_input() {
        let chat = FakeChat::new(vec![]);
        // mock: error antes de llamar
        plan_from_text(
            &chat,
            &chat_config("mock"),
            None,
            "haceme un video de prueba válido",
        )
        .await
        .expect_err("mock no interpreta");
        assert_eq!(chat.calls(), 0);
        // texto corto: error de validación antes del provider
        let error = plan_from_text(&chat, &chat_config("openai-compatible"), None, "hola")
            .await
            .expect_err("texto < 10 chars");
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
        assert_eq!(chat.calls(), 0);
    }
}
