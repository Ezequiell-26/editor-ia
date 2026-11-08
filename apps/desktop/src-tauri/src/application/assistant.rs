//! Casos de uso del asistente flotante y del emparejado narración↔imágenes.

use serde_json::Value;

use crate::ai::assistant::{
    assistant_body_messages, assistant_context, clean_match_inputs, clean_messages, clean_reply,
    match_user_prompt, mock_reply, parse_reply_content, validate_assignments, AssistantReply,
    AssistantRequest, MatchMediaReply, MatchMediaRequest, MATCH_SYSTEM_PROMPT, MAX_MATCH_IMAGES,
    MAX_MATCH_SENTENCES,
};
use crate::ai::motion::extract_message_content;
use crate::ai::providers::{
    extract_json, is_local_endpoint, json_repair_messages, validate_provider_base_url,
};
use crate::ports::ai::{
    ChatCall, MediaMatchChat, MotionChatCall, ProviderChat, ProviderSecrets, ProviderSettingsStore,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Una completion del asistente con el contrato JSON + un reintento de
/// reparación tolerante (igual que el comando histórico).
pub(crate) async fn assistant_provider_call(
    chat: &dyn ProviderChat,
    base_url: &str,
    model: &str,
    body_messages: Vec<Value>,
    key: Option<String>,
) -> Result<(String, Vec<Value>), ProjectError> {
    let first = chat
        .chat(ChatCall {
            base_url: base_url.to_owned(),
            model: model.to_owned(),
            temperature: 0.3,
            messages: body_messages.clone(),
            key: key.clone(),
        })
        .await?;
    if let Some(parsed) = parse_reply_content(&first) {
        return Ok(parsed);
    }
    // Texto plano o JSON roto: reintento de reparación con el mismo contrato;
    // si tampoco cumple se conserva el texto (fallback tolerante de siempre).
    let repaired = chat
        .chat(ChatCall {
            base_url: base_url.to_owned(),
            model: model.to_owned(),
            temperature: 0.3,
            messages: json_repair_messages(body_messages, &first),
            key,
        })
        .await?;
    Ok(parse_reply_content(&repaired).unwrap_or_else(|| (clean_reply(&repaired), Vec::new())))
}

pub async fn assistant_chat(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    chat: &dyn ProviderChat,
    request: AssistantRequest,
) -> Result<AssistantReply, ProjectError> {
    let messages = clean_messages(&request.messages)?;
    let provider = store.provider()?;
    if provider.kind == "mock" {
        return Ok(mock_reply(&messages, &provider.model));
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes o usá el simulador",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de enviar el mensaje",
        ));
    }
    let key = secrets.read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    // El catálogo de herramientas y sus esquemas se conserva separado del
    // resumen del proyecto: el límite de contexto breve no debe truncarlo.
    let context = assistant_context(request.context.as_ref());
    let body_messages = assistant_body_messages(&context, &messages);
    let (reply, actions) = assistant_provider_call(
        chat,
        &provider.base_url,
        &provider.model,
        body_messages,
        key,
    )
    .await?;
    let action = actions.first().cloned();
    Ok(AssistantReply {
        reply,
        action,
        actions,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
    })
}

/// Empareja frases de la narración con imágenes usando el proveedor
/// configurado. El frontend valida de nuevo y cae al orden de archivos si
/// esto falla.
pub async fn match_media_plan(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    chat: &dyn MediaMatchChat,
    request: MatchMediaRequest,
) -> Result<MatchMediaReply, ProjectError> {
    if request.sentences.is_empty() || request.images.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "faltan frases o imágenes para emparejar",
        ));
    }
    if request.sentences.len() > MAX_MATCH_SENTENCES || request.images.len() > MAX_MATCH_IMAGES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "hay demasiadas frases o imágenes para emparejar en una sola llamada",
        ));
    }
    let (sentences, images) = clean_match_inputs(&request.sentences, &request.images)?;
    let provider = store.provider()?;
    if provider.kind == "mock" || provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor real para emparejar la narración",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que la IA puede consumir cuota antes de emparejar",
        ));
    }
    let key = secrets.read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let payload = chat
        .complete(MotionChatCall {
            base_url: provider.base_url.clone(),
            model: provider.model.clone(),
            system: MATCH_SYSTEM_PROMPT.to_owned(),
            user: match_user_prompt(&sentences, &images, &request.image_descriptions),
            key,
            temperature: 0.2,
        })
        .await?;
    let content = extract_message_content(&payload)?;
    let json_text = extract_json(&content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la IA no devolvió un objeto JSON",
        )
    })?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el JSON de la IA no se pudo leer",
        )
    })?;
    let assignments = validate_assignments(&value, sentences.len(), images.len())?;
    Ok(MatchMediaReply {
        assignments,
        model: provider.model,
    })
}
