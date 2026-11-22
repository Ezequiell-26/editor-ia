//! Inventario de capacidades del estudio autónomo para la IA in-app:
//! providers de generación, fuentes de adquisición, etapas del pipeline
//! y disponibilidad de ffmpeg/ffprobe. Comparte la implementación con la
//! tool MCP `studio_capabilities` (que el backend ejecuta sin ventana).

use serde_json::Value;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn studio_capabilities(state: State<'_, AppState>) -> Value {
    crate::infrastructure::mcp_studio::studio_capabilities(&state)
}
