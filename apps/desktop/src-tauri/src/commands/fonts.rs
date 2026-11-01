//! Catálogo de familias tipográficas instaladas en el sistema.
//!
//! Los títulos y las plantillas de motion usan el nombre de la familia para
//! libass/FFmpeg. Escribirlo a mano genera errores silenciosos (la fuente cae a
//! Segoe UI); este comando expone las familias reales para un datalist.
//!
//! `fontdb` (MIT) se carga una sola vez con `OnceLock`. El escaneo puede tardar
//! unos cientos de ms en el primer arranque, por eso el comando es async y corre
//! en `spawn_blocking`.

use std::sync::OnceLock;

static FONTS: OnceLock<Vec<String>> = OnceLock::new();

/// Normaliza, ordena y deduplica familias sin depender del SO (testeable).
fn normalize_families(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut families: Vec<String> = names
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 120
                && !name.chars().any(|character| character.is_control())
        })
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    families.truncate(500);
    families
}

fn installed_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    normalize_families(
        database
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone())),
    )
}

/// Lista las familias instaladas (hasta 500, orden alfabético).
#[tauri::command]
pub async fn list_system_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| FONTS.get_or_init(installed_families).clone())
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_ordena_y_deduplica() {
        let result = normalize_families(vec![
            "Segoe UI".into(),
            "segoe ui".into(),
            " Arial ".into(),
            "".into(),
            "Inter".into(),
            "  ".into(),
            "Con\nSalto".into(),
        ]);
        assert_eq!(result, vec!["Arial", "Inter", "Segoe UI"]);
    }

    #[test]
    fn limita_la_lista() {
        let names = (0..600).map(|index| format!("Fuente {index:03}"));
        let result = normalize_families(names);
        assert_eq!(result.len(), 500);
        assert_eq!(result[0], "Fuente 000");
    }
}
