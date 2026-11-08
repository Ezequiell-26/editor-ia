/// Catálogo de efectos, presets y transiciones con la disponibilidad medida
/// de los filtros de FFmpeg. La UI puede ocultar lo que este build no soporta.
#[tauri::command]
pub fn list_visual_catalog(state: State<'_, AppState>) -> VisualCatalog {
    let settings = state.settings_snapshot().ok();
    let ffmpeg = settings
        .as_ref()
        .and_then(|settings| resolve_tools(settings).0);
    let filters = available_filters(ffmpeg.as_deref());
    let effects = catalog_effects()
        .into_iter()
        .map(|mut effect| {
            effect.available = effect.filters.iter().all(|name| filters.contains(name));
            effect
        })
        .collect();
    let transitions = catalog_transitions()
        .into_iter()
        .map(|mut transition| {
            transition.available = ffmpeg.is_some();
            transition
        })
        .collect();
    VisualCatalog {
        ffmpeg_available: ffmpeg.is_some(),
        effects,
        presets: catalog_presets(),
        transitions,
        filters: required_filters()
            .into_iter()
            .map(|(name, label)| FilterSupport {
                name: name.to_owned(),
                label: label.to_owned(),
                available: filters.contains(name),
            })
            .collect(),
    }
}
