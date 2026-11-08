//! Caso de uso `generate_motion`: sugiere props de motion graphics con el
//! proveedor configurado o el simulador local.

use serde_json::Value;

use crate::ai::motion::{
    clean_motion_props, extract_message_content, mock_motion, motion_system_prompt,
    motion_template, motion_user_prompt, validate_brief, MotionRequest, MotionSuggestion,
};
use crate::ai::providers::{extract_json, is_local_endpoint, validate_provider_base_url};
use crate::ports::ai::{MotionChat, MotionChatCall, ProviderSecrets, ProviderSettingsStore};
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub async fn generate_motion(
    store: &dyn ProviderSettingsStore,
    secrets: &dyn ProviderSecrets,
    chat: &dyn MotionChat,
    request: MotionRequest,
) -> Result<MotionSuggestion, ProjectError> {
    let brief = validate_brief(&request.brief)?;
    let template = motion_template(&request.template_id).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la plantilla de motion no es válida",
        )
    })?;
    let provider = store.provider()?;
    if provider.kind == "mock" {
        return Ok(mock_motion(template, &brief));
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
            "confirmá que esta llamada puede consumir cuota antes de generar el motion",
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
            system: motion_system_prompt(template),
            user: motion_user_prompt(&brief),
            key,
            temperature: 0.4,
        })
        .await?;
    let content = extract_message_content(&payload)?;
    let json_text = extract_json(&content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el modelo no devolvió un objeto JSON",
        )
    })?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el JSON del motion no se pudo parsear",
        )
    })?;
    let props = clean_motion_props(template, &value).map_err(|detail| {
        ProjectError::message(ProjectErrorCode::InvalidProviderResponse, &detail)
    })?;
    Ok(MotionSuggestion {
        template_id: template.to_owned(),
        props,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
    })
}
