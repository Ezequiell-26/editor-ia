//! Dominio puro del servidor MCP embebido: catálogo de herramientas,
//! validación JSON-RPC, política de lotes paralelos, parsers HTTP de
//! headers y merge de configuración de clientes externos.
//!
//! Nada de esto toca sockets, keyring, filesystem ni `AppHandle`.

use std::collections::HashSet;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

pub const MCP_PORT: u16 = 31417;
pub const MCP_KEYRING_SERVICE: &str = "editor-ia.mcp";
pub const MCP_KEYRING_USER: &str = "olyvia-server-token";
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
pub const BRIDGE_TIMEOUT: Duration = Duration::from_secs(900);
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
pub const BODY_READ_TIMEOUT: Duration = Duration::from_secs(30);
pub const MAX_CONNECTIONS: usize = 32;
pub const MAX_PARALLEL_BATCH_READS: usize = 8;

/// Respuesta del frontend a un `tools/call` pendiente.
#[derive(Debug)]
pub struct McpReply {
    pub ok: bool,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub url: String,
    pub token: String,
}

/// Cliente de IA externo (Claude Desktop, Antigravity…) que Olyvia sabe
/// conectar con un botón, y si lo encontró instalado en este equipo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedClient {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoconnectResult {
    pub client: String,
    pub config_path: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Catálogo de herramientas
// ---------------------------------------------------------------------------

pub fn normalize_json_schema(schema: &mut Value) {
    if schema["type"].as_str() == Some("object") && schema.get("additionalProperties").is_none() {
        schema["additionalProperties"] = Value::Bool(false);
    }
    if let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) {
        for child in properties.values_mut() {
            normalize_json_schema(child);
        }
    }
    if let Some(items) = schema.get_mut("items") {
        normalize_json_schema(items);
    }
}

fn is_read_only(name: &str) -> bool {
    matches!(
        name,
        "diagnostics"
            | "app_status"
            | "project_summary"
            | "project_snapshot"
            | "timeline_clips"
            | "captions_list"
            | "assets_list"
            | "tracks_list"
            | "export_profiles"
            | "critic_run"
            | "settings_get"
            | "review_build"
            | "factory_job_status"
            | "factory_job_list"
            | "production_list"
            | "production_status"
            | "studio_capabilities"
            | "quality_gate_review"
            | "production_plan_from_brief"
            | "mcp_tool_schema"
    )
}

fn is_additive(name: &str) -> bool {
    matches!(
        name,
        "track_add"
            | "clip_add"
            | "caption_add"
            | "asset_import"
            | "marker_add"
            | "multicam_build"
            | "multicam_smart_switch"
            | "navigate"
            | "playhead"
    )
}

fn is_open_world(name: &str) -> bool {
    matches!(
        name,
        "project_open"
            | "project_save"
            | "project_save_as"
            | "diarize"
            | "multicam_smart_switch"
            | "export_render"
            | "export_interchange"
            | "factory_run"
            | "extract_audio"
            | "write_chapters"
            | "remux"
            | "export_lossless"
            | "asset_import"
            | "package_project"
            | "run_command"
            | "production_plan_from_text"
    )
}

// ---------------------------------------------------------------------------
// Scopes por herramienta (least privilege sobre el Bearer token)
// ---------------------------------------------------------------------------
//
// El token sólo demuestra identidad: qué puede hacer cada cliente lo decide
// el header `X-Olyvia-Scopes` de cada request (lista separada por comas).
// Sin header se otorgan `read`+`write`: las tools destructivas y admin
// quedan cerradas hasta que el cliente las pida explícitamente. Las entradas
// que escribe `client_entry` (autoconnect) ya traen `read,write,destructive`;
// `admin` nunca se regala: queda para configuración manual.
//
// Jerarquía: read < write < destructive < admin. Un scope otorga todos los
// inferiores (`scopes_satisfy` compara rango, no membresía exacta).

/// Header HTTP que transporta los scopes del cliente.
pub const MCP_SCOPES_HEADER: &str = "x-olyvia-scopes";
/// Scopes que tiene cualquier cliente con token válido y sin header.
pub const DEFAULT_SCOPES: &[&str] = &["read", "write"];
/// Scopes que reciben las entradas de autoconnect (clientes del propio
/// usuario). `admin` queda fuera a propósito.
pub const AUTOCONNECT_SCOPES: &str = "read,write,destructive";
/// Código JSON-RPC de "scope insuficiente" (rango -32000 de error de servidor).
pub const SCOPE_DENIED_CODE: i64 = -32004;

/// Lecturas puras: no mutan proyecto, sesión ni filesystem del usuario.
const SCOPE_READ_TOOLS: &[&str] = &[
    "diagnostics",
    "app_status",
    "project_summary",
    "project_snapshot",
    "timeline_clips",
    "captions_list",
    "assets_list",
    "tracks_list",
    "export_profiles",
    "markers_list",
    "markers_export",
    "transitions_list",
    "media_folder_list",
    "media_search",
    "fs_list",
    "fs_read",
    "fs_check",
    "settings_get",
    "media_analyze",
    "critic_run",
    "review_build",
    "factory_job_status",
    "factory_job_list",
    "production_list",
    "production_status",
    "studio_capabilities",
    "tts_voices",
    "text_fonts_list",
    "subtitles_inspect_file",
    "quality_gate_review",
    "production_plan_from_brief",
    "voice_isolation_status",
    "flow_browser_status",
    "flow_embed_status",
    "web_sessions_status",
    "browser_instances",
    "audio_effects_list",
    "audio_loudness_analyze",
    "audio_sync_offset",
    "audio_remix_analyze",
    "audio_duck_plan",
    "lut_probe",
    "video_scopes_analyze",
    "render_frame",
    "media_thumbnail",
    "scene_detect",
    "stabilization_analyze",
    "sample_asset_color",
    "find_missing_assets",
    "find_duplicate_assets",
    "sfx_library",
    "list_capabilities",
    "export_capabilities",
    "extract_subtitles",
    "mix_loudness_analyze",
    "audio_scope_analyze",
    "file_loudness_measure",
    "media_probe_color",
    "memory_list",
    "voice_list",
    "verify_export",
    "thumbnail_pick",
    "render_diary",
    "project_versions_list",
    "visual_audit",
    "media_probe_file",
    "audio_peaks_path",
    "proxy_status",
    "catalog_search",
    "catalog_get",
    "provider_test",
    "render_queue",
    "vmaf_measure",
    "downloader_status",
    "downloader_bridge_info",
    "download_probe",
    "playlist_entries",
    "audio_tracks_url",
    "sponsorblock_preview",
    "source_checksum",
    "rss_fetch",
    "watch_folder_scan",
    "proxy_test",
    "vpn_list",
    "watchdog_status",
    "platform_rules",
    "youtube_channel_analyze",
    "analyze_face_track",
    "clip_face_track",
    "track_object",
    "analyze_images",
    "analyze_media_frames",
    "models_list",
    "check_asset_files",
    "plugins_list",
    "extension_status",
    "system_info",
    "mcp_servers_list",
    "mcp_server_probe",
    "mcp_session_status",
    "mcp_audit_tail",
    "flow_proxies_get",
    "audio_peaks",
    "visual_catalog",
    "mcp_server_status",
    "mcp_detect_clients",
    "__catalog",
    "keyframe_snapshot",
    "keyframe_capture",
    "keyframe_transform_at",
    "clip_gain_at",
    "caption_text_split",
    "caption_wrap",
    "caption_plan_cues",
    "narration_plan_build",
    "smart_bin_list",
    "assets_smart_bin_filter",
    "luma_mate_candidates",
    "adaptive_profile",
    "beat_detect",
    "beat_ramp_suggest",
    "motion_templates_list",
    "image_traits",
    "visual_plan_assignments",
    "project_quality_evaluate",
    "platform_rules_list",
    "platform_rules_audit",
    "title_templates_list",
    "speed_ramp_presets",
    "effect_presets_list",
    "audio_presets_list",
    "safe_area_presets",
    "clip_source_info",
    "director_memory_get",
    "render_queue_status",
    "project_io_range_get",
    "subtitles_export_content",
    "catalog_favorites_list",
    "video_format_presets",
    "production_plan_from_project",
    "factory_variants_plan",
    "publication_metadata",
    "publication_audit",
    "effect_templates_list",
    "project_search",
    "caption_motion_presets",
    "color_looks_list",
    "export_presets_list",
    "export_size_estimate",
    "grade_presets_list",
    "file_url_absolute",
    "whiteboard_status",
    "system_fonts_list",
    "hardware_encoders",
    "download_disk_space",
    "render_active",
    "audio_provider_get",
    "whisper_model_status",
    "vpn_wireguard",
    "recent_project_thumbnail",
    "recovery_status",
    "preferences_export",
    "effect_catalog_search",
    "effect_stack_list",
    "effect_catalog_get",
    "node_graph_list",
    "node_graph_get",
    "node_graph_validate",
    "ai_skills_list",
    "ai_skill_compose",
    "mcp_tool_schema",
    "autoedit_variants",
    "autoedit_status",
    "qc_media",
];

/// Escrituras acotadas y reversibles: edits de timeline, navegación,
/// ciclo de vida del documento del proyecto y lotes de efectos.
const SCOPE_WRITE_TOOLS: &[&str] = &[
    "project_new",
    "project_open",
    "project_save",
    "project_save_as",
    "undo",
    "redo",
    "navigate",
    "playhead",
    "track_add",
    "track_update",
    "clip_add",
    "clip_update",
    "clip_move",
    "clip_split",
    "clip_slip",
    "clip_slide",
    "clip_roll",
    "clip_speed_ramp",
    "clip_speed_curve",
    "clip_stabilize",
    "clip_freeze",
    "clip_detach_audio",
    "clip_split_edit",
    "clip_morph_cut",
    "clip_remix",
    "clip_link",
    "clip_unlink",
    "timeline_morph_cuts",
    "clip_face_zoom",
    "timeline_auto_sfx",
    "timeline_auto_zoom",
    "timeline_apply_broll",
    "timeline_music_ducking",
    "timeline_add_vox_graphic",
    "timeline_auto_vox_graphics",
    "clip_duplicate",
    "clip_compound",
    "compound_expand",
    "adjustment_add",
    "clip_replace",
    "clip_split_multi",
    "track_split",
    "split_at_markers",
    "cut_at_frame",
    "captions_from_scenes",
    "audio_preset_apply_all",
    "transition_apply_cuts",
    "timeline_trim_start",
    "clip_mask_set",
    "mask_keyframe_add",
    "mask_keyframe_remove",
    "mask_keyframes_clear",
    "project_look_set",
    "marker_update",
    "markers_clear",
    "markers_from_scenes",
    "markers_from_cuts",
    "caption_title_add",
    "scene_add",
    "scene_update",
    "scene_remove",
    "scene_reorder",
    "overlay_face_center",
    "overlay_face_blur",
    "overlay_mask_track",
    "overlay_breathing",
    "overlay_click_pulse",
    "delivery_compression",
    "delivery_profile_fit",
    "delivery_pixel_format",
    "clip_effects",
    "clip_effects_apply",
    "clip_effects_clear",
    "clip_effects_preset",
    "caption_add",
    "caption_update",
    "caption_style_update",
    "marker_add",
    "transition_add",
    "text_layer_add",
    "text_layer_update",
    "lower_third_add",
    "keyframe_add",
    "animation_preset_apply",
    "audio_effect_eq",
    "audio_effect_voice",
    "audio_ducking",
    "color_wheels_adjust",
    "color_preset_cinematic",
    "batch_clips_select",
    "batch_effects_apply",
    "batch_audio_normalize",
    "batch_transitions_add",
    "batch_speed_change",
    "timeline_gaps_remove",
    "timeline_align_clips",
    "autoedit_apply",
    "asset_import",
    "audio_effects_render",
    "audio_loudness_normalize",
    "audio_time_stretch",
    "audio_remix_render",
    "audio_channels_convert",
    "tts_synthesize",
    "text_render_preview",
    "subtitles_convert_file",
    "memory_add",
    "memory_forget",
    "download_pause",
    "download_resume",
    "download_cancel",
    "production_pause",
    "subtitles_save_localized",
    "plugin_set_enabled",
    "notify_user",
    "flow_proxy_set",
    "model_download",
    "proxy_cancel",
    "narration_synthesize",
    "dialogue_enhance",
    "dub_synthesize",
    "transcribe_asset",
    "background_remove_file",
    "background_remove_asset",
    "upscale_image",
    "upscale_video",
    "denoise_media",
    "sharpen_media",
    "freeze_frame_extract",
    "video_merge",
    "video_trim",
    "video_watermark",
    "video_metadata",
    "proxy_apply",
    "relink_asset",
    "keyframe_remove",
    "keyframe_clear",
    "keyframe_paste_at_frame",
    "keyframe_bezier_apply",
    "gain_keyframe_add",
    "gain_keyframe_remove",
    "gain_keyframes_clear",
    "clip_slowmo_smoothing",
    "track_gain_keyframe_add",
    "track_gain_keyframe_remove",
    "track_gain_keyframes_clear",
    "track_pan_keyframe_add",
    "track_pan_keyframe_remove",
    "track_pan_keyframes_clear",
    "smart_bin_create",
    "smart_bin_remove",
    "auto_edit_build",
    "auto_edit_prepare",
    "autoedit_measure",
    "luma_mate_move_track",
    "luma_mate_place_freeze",
    "director_apply",
    "beat_cut_track",
    "motion_graphic_add",
    "storyboard_build",
    "project_io_range_set",
    "project_title_card_apply",
    "speed_ramp_preset_apply",
    "effect_preset_apply",
    "project_retime",
    "catalog_favorite_toggle",
    "render_queue_enqueue",
    "render_queue_clear_settled",
    "director_outcome_record",
    "delivery_package_build",
    "subtitle_import",
    "folder_timeline_build",
    "auto_cleanup_run",
    "effect_template_apply",
    "sfx_add",
    "color_look_apply",
    "export_preset_save",
    "export_preset_delete",
    "grade_preset_save",
    "grade_preset_delete",
    "grade_preset_apply",
    "transcribe_project",
    "audio_import_bytes",
    "media_copy_into",
    "alpha_frames_write",
    "alpha_frames_to_asset",
    "alpha_frames_discard",
    "tool_choose",
    "reveal_output",
    "vpn_wireguard_open",
    "mcp_session_close",
    "publication_manifest_save",
    "whisper_model_download",
    "whisper_model_download_cancel",
    "director_memory_reset",
    "preferences_import",
    "effect_stack_add",
    "effect_stack_remove",
    "effect_stack_set_enabled",
    "effect_stack_set_param",
    "effect_stack_reset",
    "effect_stack_move",
    "effect_stack_duplicate",
    "node_graph_save",
    "node_graph_remove",
    "node_graph_execute",
    "text_edit_build",
    "custom_skill_save",
    "custom_skill_delete",
];

/// Lo que puede destruir trabajo, gastar dinero/compute o salir del
/// sandbox del proyecto: borrados, cierres, renders, pipelines remotos,
/// grabación de pantalla y generación con costo.
const SCOPE_DESTRUCTIVE_TOOLS: &[&str] = &[
    "project_close",
    "track_delete",
    "clip_delete",
    "caption_delete",
    "marker_delete",
    "transition_remove",
    "timeline_ripple_delete",
    "asset_remove",
    "factory_job_cancel",
    "factory_run",
    "production_create",
    "production_start",
    "production_advance",
    "production_cancel",
    "production_resume",
    "production_plan_from_text",
    "run_automation",
    "diarize",
    "voice_isolate",
    "voice_isolation_prepare",
    "media_convert",
    "subtitles_translate",
    "subtitles_pipeline",
    "screen_record",
    "stickman_render",
    "obs_scenes",
    "flow_browser_launch",
    "flow_browser_stop",
    "flow_embed_open",
    "flow_embed_close",
    "flow_embed_nav",
    "flow_generate_image",
    "flow_generate_assets",
    "export_render",
    "export_interchange",
    "export_lossless",
    "remux",
    "extract_audio",
    "write_chapters",
    "package_project",
    "multicam_build",
    "multicam_smart_switch",
    "review_apply",
    "critic_fix",
    "audio_mix",
    "voice_clone",
    "lip_sync",
    "import_timeline",
    "project_version_restore",
    "download_media",
    "cleanup_download",
    "install_downloader",
    "update_downloader",
    "vpn_connect",
    "vpn_disconnect",
    "watchdog_install",
    "watchdog_remove",
    "export_short",
    "clip_export_short",
    "convert_media_batch",
    "model_delete",
    "plugin_install",
    "plugin_remove",
    "mcp_server_delete",
    "mcp_external_call",
    "convert_file",
    "compress_asset",
    "mcp_autoconnect",
    "proxy_ensure",
    "proxy_cleanup",
    "compress_file",
    "production_remove",
    "creator_hook",
    "creator_export_multi_aspect",
    "creator_inject_cta",
    "creator_interleave_broll",
    "creator_split_chapters",
    "creator_burn_subtitles",
    "script_generate",
    "effect_recipe_generate",
    "motion_suggest",
    "media_plan_match",
    "whiteboard_generate",
    "render_start",
    "render_variant",
    "render_cancel",
    "render_cache_prune",
    "render_queue_clear_finished",
    "project_variant_write",
    "autoedit_export",
    "lottie_import",
    "audio_provider_save",
    "audio_provider_clear_key",
    "extension_prepare",
    "web_session_nav",
    "open_external_url",
    "recovery_restore",
    "recovery_dismiss",
];

/// Las más peligrosas: ejecución de comandos arbitrarios, evaluación JS en
/// un navegador embebido, escritura/borrado de filesystem y cambios de
/// configuración del sistema. Nunca se otorgan por autoconnect.
const SCOPE_ADMIN_TOOLS: &[&str] = &[
    "run_command",
    "flow_embed_eval",
    "fs_write",
    "fs_delete",
    "tools_batch",
    "relink_assets_folder",
    "fs_mkdir",
    "fs_move",
    "settings_set",
    "settings_set_tools",
    "mcp_server_save",
    "web_session_eval",
];

/// Scope mínimo que exige una herramienta. Las desconocidas caen en
/// `destructive`: un nombre nuevo no abre la puerta por omisión.
pub fn tool_required_scope(name: &str) -> &'static str {
    if SCOPE_ADMIN_TOOLS.contains(&name) {
        return "admin";
    }
    if SCOPE_DESTRUCTIVE_TOOLS.contains(&name) {
        return "destructive";
    }
    if SCOPE_WRITE_TOOLS.contains(&name) {
        return "write";
    }
    if SCOPE_READ_TOOLS.contains(&name) || is_read_only(name) {
        return "read";
    }
    "destructive"
}

fn scope_rank(scope: &str) -> u8 {
    match scope {
        "read" => 1,
        "write" => 2,
        "destructive" => 3,
        "admin" => 4,
        _ => 0,
    }
}

/// Scopes otorgados por el header `X-Olyvia-Scopes` (CSV, case-insensitive).
/// Valores desconocidos se descartan; un header vacío equivale a ausente.
pub fn scopes_from_header(value: &str) -> HashSet<String> {
    value
        .split(',')
        .map(str::trim)
        .map(|part| part.to_ascii_lowercase())
        .filter(|part| scope_rank(part) > 0)
        .collect()
}

/// Scopes efectivos de un request: los del header, o el default seguro.
pub fn request_scopes(header: Option<&str>) -> HashSet<String> {
    header
        .map(scopes_from_header)
        .filter(|scopes| !scopes.is_empty())
        .unwrap_or_else(|| DEFAULT_SCOPES.iter().map(|s| s.to_string()).collect())
}

/// `true` si el mejor scope otorgado alcanza para el requerido.
pub fn scopes_satisfy(granted: &HashSet<String>, required: &str) -> bool {
    let need = scope_rank(required);
    granted.iter().any(|scope| scope_rank(scope) >= need)
}

// ---------------------------------------------------------------------------
// Sanitización para el audit log (nunca secretos ni args crudos)
// ---------------------------------------------------------------------------

const AUDIT_MAX_STRING: usize = 240;
const AUDIT_MAX_TEXT: usize = 800;
const AUDIT_MAX_ARGS_BYTES: usize = 8 * 1024;

/// Claves de argumentos cuyo valor jamás va al audit log.
fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "passwd",
        "apikey",
        "api_key",
        "api-key",
        "authorization",
        "auth",
        "credential",
        "privatekey",
        "private_key",
        "cookie",
        "session",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn sanitize_audit_string(text: &str) -> Value {
    let truncated: String = if text.chars().count() > AUDIT_MAX_STRING {
        let mut kept: String = text.chars().take(AUDIT_MAX_STRING - 1).collect();
        kept.push('…');
        kept
    } else {
        text.to_owned()
    };
    // Redacción de patrones tipo credencial aunque la clave no delate:
    // "Bearer xxx", "key=value" con nombre sensible.
    Value::String(redact_sensitive_text(&truncated, &[]))
}

fn sanitize_audit_value(value: &Value) -> Value {
    match value {
        Value::String(text) => sanitize_audit_string(text),
        Value::Array(items) => {
            Value::Array(items.iter().take(50).map(sanitize_audit_value).collect())
        }
        Value::Object(map) => {
            let mut clean = serde_json::Map::new();
            for (key, item) in map.iter().take(100) {
                if is_sensitive_key(key) {
                    clean.insert(key.clone(), Value::String("[redacted]".to_owned()));
                } else {
                    clean.insert(key.clone(), sanitize_audit_value(item));
                }
            }
            Value::Object(clean)
        }
        other => other.clone(),
    }
}

/// Argumentos de una llamada para el audit log: secretos redactados,
/// strings truncados y tope de tamaño serializado.
pub fn sanitize_audit_args(args: &Value) -> Value {
    let clean = sanitize_audit_value(args);
    match serde_json::to_string(&clean) {
        Ok(text) if text.len() <= AUDIT_MAX_ARGS_BYTES => clean,
        _ => Value::String(format!(
            "[args omitidos: superan {} bytes serializados]",
            AUDIT_MAX_ARGS_BYTES
        )),
    }
}

/// Texto de resultado/error para el audit log: truncado y sin patrones
/// de credenciales evidentes (`Bearer …`, `clave=valor`).
pub fn sanitize_audit_text(text: &str) -> String {
    let truncated: String = text.chars().take(AUDIT_MAX_TEXT).collect();
    redact_sensitive_text(&truncated, &[])
}

/// Redacción genérica de secretos en texto libre: valores tras `Bearer`,
/// y asignaciones `nombre=valor`/`nombre: valor` con nombre sensible.
/// `secrets` permite tapar literales conocidos (p.ej. env vars inyectadas).
pub fn redact_sensitive_text(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_owned();
    for secret in secrets {
        if secret.chars().count() >= 6 {
            out = out.replace(secret.as_str(), "***");
        }
    }
    // Bearer primero: si el pase de "clave: valor" corriera antes, en
    // `Authorization: Bearer <tok>` taparía la palabra Bearer y dejaría
    // el token expuesto.
    out = redact_bearer_tokens(&out);
    redact_labeled_secrets(&out)
}

fn is_sensitive_label(label: &str) -> bool {
    let label = label.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "passwd",
        "apikey",
        "api_key",
        "api-key",
        "authorization",
        "auth",
        "credential",
        "privatekey",
        "private_key",
        "cookie",
        "session",
        "bearer",
    ]
    .iter()
    .any(|needle| label.contains(needle))
}

/// `nombre=valor` / `nombre: valor` / `nombre": "valor"` → el valor se
/// reemplaza por `***` conservando nombre, separador y comillas.
fn redact_labeled_secrets(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b != b'=' && b != b':' {
            i += 1;
            continue;
        }
        // Nombre hacia atrás: caracteres de identificador.
        let mut start = i;
        while start > 0 {
            let c = bytes[start - 1];
            if c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.' | b'"' | b'\'') {
                start -= 1;
            } else {
                break;
            }
        }
        let label: String = text[start..i]
            .trim_matches(|c| matches!(c, '"' | '\'' | ' '))
            .to_owned();
        if !is_sensitive_label(&label) {
            i += 1;
            continue;
        }
        // Valor hacia adelante: salta espacios y comilla inicial.
        let mut j = i + 1;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j < bytes.len() && matches!(bytes[j], b'"' | b'\'') {
            j += 1;
        }
        let value_start = j;
        while j < bytes.len() {
            let c = bytes[j];
            if c == b'"'
                || c == b'\''
                || c == b','
                || c == b'}'
                || c == b']'
                || c == b' '
                || c == b'\t'
                || c == b'\r'
                || c == b'\n'
            {
                break;
            }
            j += 1;
        }
        if j == value_start {
            i += 1;
            continue;
        }
        // Conserva todo hasta el inicio del valor y tapa sólo el valor.
        result.push_str(&text[cursor..value_start]);
        result.push_str("***");
        cursor = j;
        i = j;
    }
    result.push_str(&text[cursor..]);
    result
}

/// `Bearer <token>` → `Bearer ***` (cubre Authorization en texto libre).
fn redact_bearer_tokens(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let mut search = 0usize;
    while let Some(found) = lower[search..].find("bearer") {
        let pos = search + found;
        // Debe ser palabra completa y seguida de espacio + token.
        let before_ok = pos == 0 || !lower.as_bytes()[pos - 1].is_ascii_alphanumeric();
        let after = pos + 6;
        let after_ok = after < text.len()
            && text[after..]
                .chars()
                .next()
                .is_some_and(|c| c.is_whitespace());
        if !before_ok || !after_ok {
            search = pos + 6;
            continue;
        }
        let mut token_start = after;
        while token_start < text.len() {
            let c = text[token_start..].chars().next().unwrap();
            if !c.is_whitespace() {
                break;
            }
            token_start += c.len_utf8();
        }
        let mut token_end = token_start;
        while token_end < text.len() {
            let c = text[token_end..].chars().next().unwrap();
            if c.is_whitespace() || matches!(c, '"' | '\'' | ',' | '}' | ']') {
                break;
            }
            token_end += c.len_utf8();
        }
        result.push_str(&text[cursor..pos + 6]);
        result.push_str(" ***");
        cursor = token_end;
        search = token_end;
    }
    result.push_str(&text[cursor..]);
    result
}

/// Catálogo fallback que sirve el backend cuando la ventana no responde.
/// El catálogo real vive en el frontend (`mcp-catalog.ts`): así una
/// herramienta nueva no se declara dos veces.
pub fn tools() -> Value {
    let mut catalog = json!([
        {
            "name": "diagnostics",
            "description": "Diagnóstico básico de Olyvia sin credenciales.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "app_status",
            "description": "Estado del editor: si hay proyecto abierto y cuál.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "project_summary",
            "description": "Resumen del proyecto abierto: formato, fps, duración, pistas, clips, subtítulos y assets.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "project_snapshot",
            "description": "Fotografía consolidada del proyecto: resumen, pistas, clips, subtítulos, medios, marcadores y perfiles.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include": { "type": "array", "minItems": 1, "maxItems": 6, "uniqueItems": true, "items": { "type": "string", "enum": ["tracks", "clips", "captions", "assets", "markers", "profiles"] } },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500, "description": "Máximo de elementos por sección (1–500; por defecto 200)." }
                }
            }
        },
        {
            "name": "timeline_clips",
            "description": "Lista los clips de la timeline con id, pista, tipo, inicio, duración, motion y ganancia.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "captions_list",
            "description": "Lista los subtítulos con id, tiempos, texto y hablante.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "assets_list",
            "description": "Lista los medios del proyecto con id, tipo, ruta y metadatos.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tracks_list",
            "description": "Lista las pistas con id, tipo, nombre, bloqueo, silencio y cantidad de clips.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "export_profiles",
            "description": "Lista los perfiles de exportación con formato, resolución y bitrate.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "clip_update",
            "description": "Cambia etiqueta, habilitado, ganancia o movimiento de un clip.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clipId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "label": { "type": "string", "maxLength": 200 },
                    "enabled": { "type": "boolean" },
                    "gainDb": { "type": "number", "minimum": -60, "maximum": 24 },
                    "motion": { "type": ["string", "null"], "enum": ["zoom-in", "zoom-out", "pan-left", "pan-right", null] },
                    "motionIntensity": { "type": "number", "minimum": 0, "maximum": 1 }
                },
                "required": ["clipId"],
                "minProperties": 2
            }
        },
        {
            "name": "clip_move",
            "description": "Mueve un clip a un frame de inicio y, opcionalmente, a otra pista.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clipId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "startFrame": { "type": "integer", "minimum": 0, "maximum": 10000000 },
                    "trackId": { "type": "string", "minLength": 1, "maxLength": 256 }
                },
                "required": ["clipId", "startFrame"]
            }
        },
        {
            "name": "clip_delete",
            "description": "Elimina un clip de la timeline.",
            "inputSchema": {
                "type": "object",
                "properties": { "clipId": { "type": "string", "minLength": 1, "maxLength": 256 } },
                "required": ["clipId"]
            }
        },
        {
            "name": "clip_split",
            "description": "Divide un clip en un frame.",
            "inputSchema": {
                "type": "object",
                "properties": { "clipId": { "type": "string", "minLength": 1, "maxLength": 256 }, "atFrame": { "type": "integer", "minimum": 1, "maximum": 10000000 } },
                "required": ["clipId", "atFrame"]
            }
        },
        {
            "name": "caption_add",
            "description": "Agrega un subtítulo en un frame con una duración.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "minLength": 1, "maxLength": 2000 },
                    "startFrame": { "type": "integer", "minimum": 0, "maximum": 10000000 },
                    "durationFrames": { "type": "integer", "minimum": 1, "maximum": 10000000 }
                },
                "required": ["text", "startFrame", "durationFrames"]
            }
        },
        {
            "name": "caption_update",
            "description": "Cambia texto o tiempos de un subtítulo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cueId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "text": { "type": "string", "minLength": 1, "maxLength": 2000 },
                    "startFrame": { "type": "integer", "minimum": 0, "maximum": 10000000 },
                    "endFrame": { "type": "integer", "minimum": 1, "maximum": 10000000 }
                },
                "required": ["cueId"],
                "minProperties": 2
            }
        },
        {
            "name": "caption_delete",
            "description": "Elimina un subtítulo.",
            "inputSchema": {
                "type": "object",
                "properties": { "cueId": { "type": "string", "minLength": 1, "maxLength": 256 } },
                "required": ["cueId"]
            }
        },
        {
            "name": "track_update",
            "description": "Cambia nombre, bloqueo, silencio u ocultamiento de una pista.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trackId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "label": { "type": "string", "maxLength": 120 },
                    "locked": { "type": "boolean" },
                    "muted": { "type": "boolean" },
                    "hidden": { "type": "boolean" }
                },
                "required": ["trackId"],
                "minProperties": 2
            }
        },
        {
            "name": "run_automation",
            "description": "Ejecuta automatizaciones: cut_silences, cut_pauses, auto_cleanup, auto_pilot o export.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["cut_silences", "cut_pauses", "auto_cleanup", "auto_pilot", "export"] },
                    "outputDir": { "type": "string", "maxLength": 32768 },
                    "profileId": { "type": "string", "maxLength": 256 }
                },
                "required": ["kind"]
            }
        },
        {
            "name": "export_render",
            "description": "Renderiza y verifica la entrega (MP4) en una carpeta.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "outputDir": { "type": "string", "maxLength": 32768 },
                    "profileId": { "type": "string", "maxLength": 256 },
                    "qualityCheck": { "type": "boolean" }
                }
            }
        },
        {
            "name": "navigate",
            "description": "Abre una vista de la app (editor, inicio, fabrica, produccion, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": { "view": { "type": "string", "minLength": 1, "maxLength": 80 } },
                "required": ["view"]
            }
        },
        {
            "name": "run_command",
            "description": "Ejecuta un comando del editor en lenguaje natural (cortar silencios, limpiar, pilotar).",
            "inputSchema": {
                "type": "object",
                "properties": { "command": { "type": "string", "minLength": 1, "maxLength": 2000 } },
                "required": ["command"]
            }
        },
        {
            "name": "factory_run",
            "description": "Encola la creación completa de un video y devuelve un jobId.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "brief": { "type": "string", "minLength": 10, "maxLength": 4000 },
                    "outputDir": { "type": "string", "maxLength": 32768 },
                    "scenes": { "type": "integer", "minimum": 1, "maximum": 12 },
                    "width": { "type": "integer", "minimum": 2, "maximum": 7680 },
                    "height": { "type": "integer", "minimum": 2, "maximum": 4320 },
                    "language": { "type": "string", "minLength": 2, "maxLength": 12 },
                    "render": { "type": "boolean" }
                },
                "required": ["brief"]
            }
        },
        {
            "name": "factory_job_status",
            "description": "Consulta el estado y progreso de un trabajo de fábrica.",
            "inputSchema": {
                "type": "object",
                "properties": { "jobId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["jobId"]
            }
        },
        {
            "name": "factory_job_list",
            "description": "Lista trabajos de fábrica recientes.",
            "inputSchema": {
                "type": "object",
                "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 50 } }
            }
        },
        {
            "name": "factory_job_cancel",
            "description": "Solicita cancelación cooperativa de un trabajo de fábrica.",
            "inputSchema": {
                "type": "object",
                "properties": { "jobId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["jobId"]
            }
        },
        {
            "name": "production_list",
            "description": "Lista las corridas de producción autónoma persistidas.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "production_status",
            "description": "Estado de una corrida de producción: etapa actual, etapas, presupuesto y error.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_create",
            "description": "Crea una corrida de producción desde un ProductionPlan serializado (schemaVersion 1). No la ejecuta: usar production_start o production_advance.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan": { "type": "object", "description": "ProductionPlan validado por el schema del proyecto." },
                    "runId": { "type": "string", "minLength": 1, "maxLength": 128 },
                    "maxCostCents": { "type": "integer", "minimum": 0, "maximum": 100000000 }
                },
                "required": ["plan"]
            }
        },
        {
            "name": "production_start",
            "description": "Arranca el driver backend que conduce la corrida hasta terminar, pausarse o fallar. Reanuda corridas pausadas/fallidas.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_advance",
            "description": "Avanza la corrida una etapa (avanzada manual; el driver hace esto solo).",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_cancel",
            "description": "Cancela la corrida y el render FFmpeg activo, si lo hay.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_resume",
            "description": "Reanuda una corrida pausada o fallida y arranca su driver.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_pause",
            "description": "Pausa la corrida entre etapas; el driver se detiene solo.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "studio_capabilities",
            "description": "Inventario real del estudio: providers de generación, fuentes de adquisición, etapas del pipeline y disponibilidad de ffmpeg/ffprobe.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "quality_gate_review",
            "description": "Quality Gate del proyecto abierto: valida documento (assets, clips, captions, derechos) y devuelve el reporte con hallazgos tipados errors/warnings. No modifica nada; evalúa el último estado guardado en disco.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "production_plan_from_brief",
            "description": "Construye un ProductionPlan válido desde un brief (objetivo, keyPoints, escenas, plataforma, voz, música, tarjeta). No crea ni ejecuta la corrida: revisar el plan y usar production_create.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objective": { "type": "string", "minLength": 1, "maxLength": 2000 },
                    "audience": { "type": "string", "maxLength": 500 },
                    "tone": { "type": "string", "maxLength": 500 },
                    "keyPoints": { "type": "array", "maxItems": 16, "items": { "type": "string", "maxLength": 2000 } },
                    "sceneCount": { "type": "integer", "minimum": 1, "maximum": 8 },
                    "durationSeconds": { "type": "integer", "minimum": 3, "maximum": 3600 },
                    "platform": { "type": "string", "enum": ["youtube", "shorts", "reels", "tiktok"] },
                    "aspectRatio": { "type": "string", "enum": ["16:9", "9:16", "1:1", "4:5"] },
                    "voice": { "type": "string", "maxLength": 200 },
                    "music": { "type": "boolean" },
                    "titleCard": { "type": "boolean" },
                    "brollQuery": { "type": "string", "maxLength": 500 },
                    "maxCostCents": { "type": "integer", "minimum": 0, "maximum": 100000000 }
                },
                "required": ["objective"]
            }
        },
        {
            "name": "production_plan_from_text",
            "description": "Interpreta texto libre con el provider de chat configurado (BYOK) y devuelve un ProductionPlan válido. Puede gastar en proveedor remoto: requiere approvedCost=true. No crea ni ejecuta la corrida.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "minLength": 10, "maxLength": 2000 },
                    "approvedCost": { "type": "boolean" }
                },
                "required": ["text"]
            }
        }
    ]);

    if let Some(items) = catalog.as_array_mut() {
        for item in items {
            let Some(name) = item["name"].as_str().map(str::to_owned) else {
                continue;
            };
            if let Some(schema) = item.get_mut("inputSchema") {
                normalize_json_schema(schema);
            }
            let read_only = is_read_only(&name);
            let additive = is_additive(&name);
            let idempotent = matches!(name.as_str(), "project_save" | "navigate" | "playhead");
            let open_world = is_open_world(&name);
            item["annotations"] = json!({
                "title": name.replace('_', " "),
                "readOnlyHint": read_only,
                "destructiveHint": !read_only && !additive,
                "idempotentHint": !read_only && idempotent,
                "openWorldHint": open_world
            });
        }
    }

    catalog
}

/// Herramientas del estudio autónomo que el BACKEND ejecuta directo
/// (casos de uso de `application::production`), sin pasar por la ventana:
/// deben funcionar aunque el frontend no esté montado.
pub fn is_studio_tool(name: &str) -> bool {
    matches!(
        name,
        "production_list"
            | "production_status"
            | "production_create"
            | "production_start"
            | "production_advance"
            | "production_cancel"
            | "production_resume"
            | "production_pause"
            | "studio_capabilities"
            | "quality_gate_review"
            | "production_plan_from_brief"
            | "production_plan_from_text"
    )
}

/// Catálogo de las tools de estudio tal como queda en `tools()` (con
/// anotaciones y schemas normalizados). Se usa para mezclar el catálogo
/// real del frontend con las tools que sólo el backend conoce.
pub fn studio_tools() -> Vec<Value> {
    tools()
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| item["name"].as_str().is_some_and(is_studio_tool))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub fn collect_read_only_tools(items: &[Value]) -> HashSet<String> {
    items
        .iter()
        .filter(|item| item["annotations"]["readOnlyHint"].as_bool() == Some(true))
        .filter_map(|item| item["name"].as_str().map(str::to_owned))
        .collect()
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

pub fn valid_rpc_id(value: &Value) -> bool {
    value.is_null() || value.is_string() || value.is_number()
}

pub fn tool_result(text: &str, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

pub fn rpc_result(id: &Value, value: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": value })
}

pub fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

/// Validación previa al despacho: devuelve el id si el mensaje es un
/// request bien formado, o la respuesta de error que corresponde.
/// `None` significa notificación (no generar respuesta).
pub enum RpcRequest {
    /// Request válido con su id.
    Call(Value),
    /// Notificación: no hay respuesta.
    Notification,
    /// Responder con este valor de error.
    Reject(Value),
}

pub fn classify_request(message: &Value) -> RpcRequest {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    if !message.is_object() || message.get("jsonrpc") != Some(&json!("2.0")) {
        return RpcRequest::Reject(rpc_error(&id, -32600, "solicitud JSON-RPC inválida"));
    }
    if message.get("id").is_some_and(|value| !valid_rpc_id(value)) {
        return RpcRequest::Reject(rpc_error(
            &Value::Null,
            -32600,
            "el id JSON-RPC debe ser texto, número o null",
        ));
    }
    if message
        .get("params")
        .is_some_and(|params| !params.is_object())
    {
        return RpcRequest::Reject(rpc_error(&id, -32602, "params debe ser un objeto JSON"));
    }
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return RpcRequest::Reject(rpc_error(&id, -32600, "falta el método JSON-RPC"));
    };
    if id.is_null() && method.starts_with("notifications/") {
        return RpcRequest::Notification;
    }
    RpcRequest::Call(id)
}

/// Extrae (method, name, args) de un request ya clasificado como Call.
pub fn call_parts(message: &Value) -> (&str, &str, &Value) {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let name = message["params"]["name"].as_str().unwrap_or("");
    let args = &message["params"]["arguments"];
    (method, name, args)
}

/// Sólo estas operaciones pueden adelantarse dentro de un lote JSON-RPC.
/// Cualquier escritura o herramienta desconocida conserva el orden secuencial.
pub fn is_parallel_read_request(read_only: &HashSet<String>, message: &Value) -> bool {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    match method {
        "initialize" | "ping" | "tools/list" => true,
        "tools/call" => {
            let Some(name) = message["params"]["name"].as_str() else {
                return false;
            };
            if name == "__catalog" {
                return true;
            }
            read_only.contains(name)
        }
        notification if notification.starts_with("notifications/") => {
            message.get("id").map(Value::is_null).unwrap_or(true)
        }
        _ => false,
    }
}

pub fn empty_batch_error() -> Value {
    rpc_error(
        &Value::Null,
        -32600,
        "el lote JSON-RPC no puede estar vacío",
    )
}

pub fn batch_task_error(id: &Value) -> Value {
    rpc_error(id, -32603, "falló una tarea del lote MCP")
}

// ---------------------------------------------------------------------------
// Clientes externos (autoconnect)
// ---------------------------------------------------------------------------

/// Entrada `mcpServers.olyvia` en la config de cada cliente. Claude Desktop
/// usa `type: "http"`; Antigravity usa `serverUrl`.
pub fn client_entry(client: &str, info: &McpServerInfo) -> Option<Value> {
    match client {
        // Las entradas de autoconnect habilitan read+write+destructive:
        // el usuario conectó a su propio asistente a propósito. `admin`
        // (run_command, fs_*, eval JS, settings) nunca se otorga solo.
        "claude-desktop" => Some(json!({
            "type": "http",
            "url": info.url,
            "headers": {
                "Authorization": format!("Bearer {}", info.token),
                "X-Olyvia-Scopes": AUTOCONNECT_SCOPES
            }
        })),
        "antigravity" => Some(json!({
            "serverUrl": info.url,
            "headers": {
                "Authorization": format!("Bearer {}", info.token),
                "X-Olyvia-Scopes": AUTOCONNECT_SCOPES
            }
        })),
        _ => None,
    }
}

/// Catálogo de clientes conocidos: id, etiqueta y URL de descarga.
pub fn known_clients() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "claude-desktop",
            "Claude Desktop",
            "https://claude.ai/download",
        ),
        ("antigravity", "Antigravity", "https://antigravity.google/"),
    ]
}

/// Inserta o reemplaza la entrada `mcpServers.olyvia` en la raíz de la
/// configuración del cliente sin tocar nada más: otros servidores MCP,
/// ajustes del cliente y campos extra se conservan. Si el archivo no era
/// un objeto JSON válido, se reinicia como `{}`.
pub fn merge_olyvia_entry(root: &mut Value, entry: Value) {
    if !root.is_object() {
        *root = json!({});
    }
    let servers = root
        .as_object_mut()
        .expect("root es un objeto JSON")
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers
        .as_object_mut()
        .expect("mcpServers es un objeto JSON")
        .insert("olyvia".to_owned(), entry);
}

// ---------------------------------------------------------------------------
// Parsers HTTP de headers (puros)
// ---------------------------------------------------------------------------

pub fn header_value(headers: &str, name: &str) -> Option<String> {
    for line in headers.lines().skip(1) {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case(name) {
            return Some(value.trim().to_owned());
        }
    }
    None
}

pub fn is_json_content_type(headers: &str) -> bool {
    header_value(headers, "content-type")
        .and_then(|value| value.split(';').next().map(str::trim).map(str::to_owned))
        .map(|value| value.eq_ignore_ascii_case("application/json"))
        .unwrap_or(false)
}

pub fn request_content_length(headers: &str) -> Result<usize, &'static str> {
    let mut content_length = None;
    for line in headers.lines().skip(1) {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.eq_ignore_ascii_case("transfer-encoding") && !value.eq_ignore_ascii_case("identity")
        {
            return Err("transfer-encoding no compatible");
        }
        if key.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err("content-length duplicado");
            }
            if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err("content-length inválido");
            }
            content_length = value.parse::<usize>().ok();
            if content_length.is_none() {
                return Err("content-length inválido");
            }
        }
    }
    content_length.ok_or("falta content-length")
}

#[cfg(test)]
#[path = "server.tests.rs"]
mod tests;
