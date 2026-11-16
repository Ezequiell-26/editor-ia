//! Biblioteca de efectos de sonido (paridad `sons.js` de AlaukCut).
//!
//! Los WAV se generan proceduralmente con `scripts/generate-sfx.mjs` y se
//! empaquetan como recurso `sfx/`. El comando devuelve la ruta absoluta de
//! cada archivo para que el frontend lo reproduzca (`convertFileSrc`) y lo
//! importe al proyecto (`import_media_paths`).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxItem {
    pub id: String,
    pub file: String,
    pub label: String,
    pub description: String,
    pub duration_seconds: f64,
    /// Grupo colapsable del panel (paridad `som-grupo` de `sons.js`).
    pub group: String,
    /// Ruta absoluta al WAV dentro del recurso empaquetado.
    pub path: String,
}

/// Catálogo fijo: ids alineados con `SFX_PRESETS` de EditorAssets.tsx.
/// Las duraciones son las del generador (segundos exactos del render).
/// El grupo ordena las tarjetas en secciones colapsables como el panel
/// «Sons» de AlaukCut (grabación/UX/transiciones → UX/Transiciones/…).
const CATALOG: &[(&str, &str, &str, f64, &str)] = &[
    ("sfx-click", "Click Táctil", "Pulsación de interfaz", 0.08, "UX"),
    ("sfx-pop", "Pop Burbuja", "Aparición de sticker o texto", 0.22, "UX"),
    ("sfx-ding", "Ding Campana", "Notificación de atención", 0.70, "UX"),
    ("sfx-woosh", "Woosh Rápido", "Transición dinámica de aire", 0.45, "Transiciones"),
    ("sfx-riser", "Riser Tensión", "Crescendo para anticipación", 2.00, "Transiciones"),
    ("sfx-boom", "Impacto Boom", "Golpe grave cinematográfico", 1.20, "Impactos"),
    ("sfx-subdrop", "Sub-Drop", "Bajo envolvente para clímax", 1.80, "Impactos"),
    ("sfx-glitch", "Glitch Digital", "Interferencia cibernética", 0.50, "Digital"),
];

fn resolve_sfx_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = app
        .path()
        .resolve("sfx", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(path);
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sfx"),
    );
    candidates.into_iter().find(|dir| dir.is_dir())
}

/// Lista los efectos de sonido disponibles con su ruta absoluta.
/// Devuelve lista vacía si el recurso no está (build sin `resources/sfx`).
#[tauri::command]
pub fn sfx_library(app: AppHandle) -> Vec<SfxItem> {
    let Some(dir) = resolve_sfx_dir(&app) else {
        return Vec::new();
    };
    CATALOG
        .iter()
        .filter_map(|(id, label, description, duration, group)| {
            let file = format!("{id}.wav");
            let path = dir.join(&file);
            if !path.is_file() {
                return None;
            }
            Some(SfxItem {
                id: (*id).to_owned(),
                file,
                label: (*label).to_owned(),
                description: (*description).to_owned(),
                duration_seconds: *duration,
                group: (*group).to_owned(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_match_wav_files() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sfx");
        for (id, _, _, _, _) in CATALOG {
            assert!(
                dir.join(format!("{id}.wav")).is_file(),
                "falta el WAV de {id} — corré `node scripts/generate-sfx.mjs`"
            );
        }
    }

    #[test]
    fn catalog_has_eight_entries_with_unique_ids() {
        assert_eq!(CATALOG.len(), 8);
        let mut ids: Vec<&str> = CATALOG.iter().map(|entry| entry.0).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
    }

    #[test]
    fn catalog_groups_are_non_empty_and_cover_every_item() {
        for (_, _, _, _, group) in CATALOG {
            assert!(!group.is_empty(), "item sin grupo");
        }
        let groups: std::collections::BTreeSet<&str> =
            CATALOG.iter().map(|entry| entry.4).collect();
        assert!(groups.len() >= 3, "el catálogo debería tener varios grupos");
    }
}
