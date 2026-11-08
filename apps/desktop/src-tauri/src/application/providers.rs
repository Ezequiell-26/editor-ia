//! Casos de uso del subsistema de proveedores de IA.
//!
//! Reglas de validación, short-circuit del proveedor `mock`, aprobación de
//! costo para endpoints remotos y el reintento único de reparación JSON se
//! conservan exactamente como estaban en los comandos IPC. Secretos, settings
//! y HTTP viven detrás de los puertos `ProviderSecrets`,
//! `ProviderSettingsStore`, `ProviderChat` y `ProviderProbe`.

use serde_json::json;

use crate::ai::providers::{
    clean_effect, clean_text, extract_json, is_local_endpoint, language_name, mock_effect_recipe,
    mock_plan, mock_translation, parse_script_content, parse_translations, plan_from_raw,
    provider_info, validate_provider_base_url, validate_translation, EffectRecipe, EffectRequest,
    GenerateRequest, ProviderInfo, ProviderTestResult, ScriptPlan, TranslateRequest,
    TranslatedTexts, MAX_BRIEF_CHARS, MAX_GLOSSARY_CHARS, MAX_SCENES, PROVIDER_TEST_TIMEOUT,
};
use crate::ports::ai::{
    ChatCall, ProviderChat, ProviderProbe, ProviderSecrets, ProviderSettingsStore,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Vista pública del proveedor configurado.
pub fn get_provider(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
) -> Result<ProviderInfo, ProjectError> {
    let config = store.provider()?;
    Ok(provider_info(
        &config,
        secrets.read_key().is_some(),
        secrets.available(),
    ))
}

/// Guarda kind/url/model y, si viene, la API key en el Credential Manager.
pub fn save_provider(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<ProviderInfo, ProjectError> {
    let kind = match kind.as_str() {
        "mock" => "mock",
        _ => "openai-compatible",
    };
    let base_url = base_url.trim().to_owned();
    let model = model.trim().to_owned();
    if kind != "mock" && base_url.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor necesita una URL base (por ejemplo http://127.0.0.1:11434/v1)",
        ));
    }
    if kind != "mock" {
        validate_provider_base_url(&base_url)?;
    }
    if kind != "mock" && model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor necesita un nombre de modelo",
        ));
    }

    if let Some(secret) = api_key {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            if trimmed.chars().count() < 8 {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "la clave del proveedor es demasiado corta",
                ));
            }
            secrets.set_key(trimmed)?;
        }
    }

    let config = crate::ports::ai::ProviderConfig {
        kind: kind.to_owned(),
        base_url,
        model,
    };
    store.save_provider(&config)?;
    Ok(provider_info(
        &config,
        secrets.read_key().is_some(),
        secrets.available(),
    ))
}

/// Borra la API key del Credential Manager.
pub fn clear_provider_key(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
) -> Result<ProviderInfo, ProjectError> {
    secrets.clear_key();
    get_provider(store, secrets)
}

/// Resuelve el proveedor para una generación: mock corta antes; remoto exige
/// URL válida, costo aprobado y clave (los mensajes se pasan por caso de uso
/// porque cada comando tiene redacción propia).
fn generation_provider(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    approved_cost: bool,
    unconfigured: &str,
    cost_message: &str,
) -> Result<(crate::ports::ai::ProviderConfig, bool, Option<String>), ProjectError> {
    let config = store.provider()?;
    if config.kind == "mock" {
        return Ok((config, true, None));
    }
    if config.base_url.is_empty() || config.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            unconfigured,
        ));
    }
    validate_provider_base_url(&config.base_url)?;
    let local = is_local_endpoint(&config.base_url);
    if !local && !approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            cost_message,
        ));
    }
    let key = secrets.read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    Ok((config, false, key))
}

async fn call_chat(
    chat: &dyn ProviderChat,
    config: &crate::ports::ai::ProviderConfig,
    temperature: f64,
    messages: Vec<serde_json::Value>,
    key: Option<String>,
) -> Result<String, ProjectError> {
    chat.chat(ChatCall {
        base_url: config.base_url.clone(),
        model: config.model.clone(),
        temperature,
        messages,
        key,
    })
    .await
}

/// Genera el plan de guion. `mock` devuelve una plantilla marcada como
/// simulada; el remoto valida, llama con JSON mode y repara una vez.
pub async fn generate_script(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    chat: &dyn ProviderChat,
    request: GenerateRequest,
) -> Result<ScriptPlan, ProjectError> {
    let brief = request.brief.trim().to_owned();
    if brief.chars().count() < 10 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí el video con al menos 10 caracteres",
        ));
    }
    if brief.chars().count() > MAX_BRIEF_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el brief supera los 4000 caracteres",
        ));
    }
    if !(1..=MAX_SCENES as u32).contains(&request.scene_count) {
        let message = format!("la cantidad de escenas debe estar entre 1 y {MAX_SCENES}");
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &message,
        ));
    }

    let (provider, simulated, key) = generation_provider(
        store,
        secrets,
        request.approved_cost,
        "configurá un proveedor en Ajustes o usá el proveedor simulado",
        "confirmá que esta llamada puede consumir cuota antes de generar",
    )?;
    if simulated {
        return Ok(mock_plan(&request, "mock"));
    }

    let language = match request.language.to_ascii_lowercase().as_str() {
        "en" | "en-us" | "en-gb" => "inglés",
        _ => "español rioplatense",
    };
    let system = format!(
        "Sos un guionista y productor de video. Escribís en {language}. Devolvés SOLO un objeto JSON válido, sin markdown ni comentarios. El objeto tiene {{\"title\": string, \"scenes\": [{{\"title\": string, \"intent\": \"hook\"|\"context\"|\"explainer\"|\"demo\"|\"proof\"|\"cta\"|\"outro\", \"narration\": string, \"visual\": string, \"estimatedSeconds\": number}}]}}. Escribí narración natural para leer en voz alta, sin acotaciones. Máximo {max_scenes} escenas.",
        max_scenes = request.scene_count,
    );
    let user = format!(
        "Brief del video:\n{brief}\n\nGenerá exactamente {} escenas con una progresión narrativa clara.",
        request.scene_count
    );
    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user }),
    ];
    let first = call_chat(chat, &provider, 0.6, messages.clone(), key.clone()).await?;
    let raw = match parse_script_content(&first) {
        Ok(raw) => raw,
        Err(first_detail) => {
            // Un solo reintento de reparación, también en JSON mode: si el
            // modelo devolvió texto o un JSON roto, se le muestra y se le pide
            // sólo el objeto corregido.
            let repaired = call_chat(
                chat,
                &provider,
                0.6,
                crate::ai::providers::json_repair_messages(messages, &first),
                key,
            )
            .await?;
            parse_script_content(&repaired).map_err(|detail| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    &format!(
                        "el plan del modelo no cumple el contrato ni tras un reintento de reparación: {detail} (primer intento: {first_detail})"
                    ),
                )
            })?
        }
    };
    Ok(plan_from_raw(
        raw,
        "openai-compatible",
        &provider.model,
        false,
        request.approved_cost,
    ))
}

/// Genera una receta de efecto visual. El remoto usa el mismo contrato de
/// chat; el port pide JSON mode y el endpoint que lo rechaza reintenta sin
/// él (mismo fallback que guion y traducción).
pub async fn generate_video_effect(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    chat: &dyn ProviderChat,
    request: EffectRequest,
) -> Result<EffectRecipe, ProjectError> {
    let prompt = request.prompt.trim().to_owned();
    if !(3..=500).contains(&prompt.chars().count()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí el efecto con 3 a 500 caracteres",
        ));
    }
    let (provider, simulated, key) = generation_provider(
        store,
        secrets,
        request.approved_cost,
        "configurá un proveedor en Ajustes o usá el simulador",
        "confirmá que esta llamada puede consumir cuota antes de generar el efecto",
    )?;
    if simulated {
        return Ok(mock_effect_recipe());
    }
    let system = "Sos colorista de video. Devolvés SOLO un objeto JSON válido, sin markdown: {\"name\": string, \"description\": string, \"effects\": {\"brightness\": -1..1, \"contrast\": 0..3, \"saturation\": 0..3, \"temperature\": -1..1, \"vignette\": 0..1, \"sharpen\": 0..5, \"blur\": 0..50, \"hueRotateDeg\": -180..180, \"grayscale\": boolean, \"sepia\": boolean}}. Usá sólo los parámetros necesarios y valores moderados.";
    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": format!("Efecto pedido: {prompt}") }),
    ];
    let content = call_chat(chat, &provider, 0.2, messages, key).await?;
    let json_text = extract_json(&content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el modelo no devolvió un objeto JSON",
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el JSON del efecto no se pudo parsear",
        )
    })?;
    let effects = clean_effect(&value).map_err(|detail| {
        ProjectError::message(ProjectErrorCode::InvalidProviderResponse, &detail)
    })?;
    Ok(EffectRecipe {
        name: clean_text(value["name"].as_str().map(str::to_owned), 80)
            .unwrap_or_else(|| "Efecto IA".to_owned()),
        description: clean_text(value["description"].as_str().map(str::to_owned), 300)
            .unwrap_or_default(),
        effects,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
    })
}

/// Traduce un lote de subtítulos. `mock` devuelve el texto original marcado
/// como simulado para que la UI no lo presente como traducido.
pub async fn translate_subtitles(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    chat: &dyn ProviderChat,
    request: TranslateRequest,
) -> Result<TranslatedTexts, ProjectError> {
    let (texts, target) = validate_translation(&request)?;
    let (provider, simulated, key) = generation_provider(
        store,
        secrets,
        request.approved_cost,
        "configurá un proveedor en Ajustes para traducir",
        "autorizá el consumo de cuota antes de traducir con un proveedor remoto",
    )?;
    if simulated {
        return Ok(mock_translation(&request));
    }
    let source = request.source_language.trim().to_ascii_lowercase();
    let source_label = if source == "auto" {
        "detección automática".to_owned()
    } else {
        language_name(&source)
            .unwrap_or("origen desconocido")
            .to_owned()
    };
    let target_label = language_name(&target).unwrap_or("destino");
    let glossary = request
        .glossary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(MAX_GLOSSARY_CHARS).collect::<String>())
        .unwrap_or_default();
    let glossary_block = if glossary.is_empty() {
        String::new()
    } else {
        format!("\nGlosario que NO se traduce (respetá estas grafías): {glossary}")
    };
    let system = format!(
        "Sos un traductor profesional de subtítulos. Traducís de {source_label} a {target_label}. Devolvés SOLO un objeto JSON válido, sin markdown ni comentarios, con la forma {{\"texts\": [string, ...]}}. Traducí cada entrada en el mismo orden, sin numerarlas ni agregar notas, con lenguaje natural y compacto para leer en pantalla. No omitas, fusiones ni agregues entradas. Respondé exactamente {} entradas.{glossary_block}",
        texts.len()
    );
    let user = serde_json::json!({ "texts": texts }).to_string();
    let expected = texts.len();
    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user }),
    ];
    let first = call_chat(chat, &provider, 0.2, messages.clone(), key.clone()).await?;
    let translated = match parse_translations(&first, expected) {
        Ok(translated) => translated,
        Err(_) => {
            // Un reintento de reparación: mismo contrato, misma cantidad de
            // entradas; si tampoco cumple, gana el error del segundo intento.
            let repaired = call_chat(
                chat,
                &provider,
                0.2,
                crate::ai::providers::json_repair_messages(messages, &first),
                key,
            )
            .await?;
            parse_translations(&repaired, expected)?
        }
    };
    Ok(TranslatedTexts {
        texts: translated,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model.clone(),
        simulated: false,
    })
}

/// Prueba la conexión con el proveedor configurado. Devuelve un estado
/// tipado y accionable que la interfaz muestra tal cual.
pub async fn test_provider(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    probe: &dyn ProviderProbe,
) -> Result<ProviderTestResult, ProjectError> {
    let provider = store.provider()?;
    let base_url = provider.base_url.trim().to_owned();
    if provider.kind == "mock" {
        return Ok(crate::ai::providers::provider_test_result(
            "mock",
            false,
            None,
            0,
            None,
            "el proveedor simulado no hace llamadas de red: configurá Ollama o una API compatible para probar la conexión"
                .to_owned(),
            &base_url,
        ));
    }
    if base_url.is_empty() || provider.model.trim().is_empty() {
        return Ok(crate::ai::providers::provider_test_result(
            "unconfigured",
            false,
            None,
            0,
            None,
            "configurá la URL base y el modelo en Ajustes → IA antes de probar la conexión"
                .to_owned(),
            &base_url,
        ));
    }
    validate_provider_base_url(&base_url)?;
    let local = is_local_endpoint(&base_url);
    let key = secrets.read_key();
    if !local && key.is_none() {
        return Ok(crate::ai::providers::provider_test_result(
            "missing-key",
            false,
            None,
            0,
            None,
            "falta la clave del proveedor en el almacén de Windows; guardala en Ajustes → IA"
                .to_owned(),
            &base_url,
        ));
    }
    Ok(probe
        .probe(&base_url, provider.model.trim(), key, PROVIDER_TEST_TIMEOUT)
        .await)
}
