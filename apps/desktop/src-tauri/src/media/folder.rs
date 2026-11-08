//! Nombres de carpeta de medios: el modelo sólo manda un nombre, nunca una
//! ruta. Se rechazan separadores, `..`, unidades y caracteres reservados de
//! Windows.

/// Sanitiza el nombre de carpeta proveniente del asistente/frontend.
/// Devuelve `None` si no es un nombre simple y seguro.
pub fn sanitize_media_folder_name(folder: &str) -> Option<String> {
    let name = folder.trim().trim_matches(['"', '\'', '“', '”', '«', '»']);
    if name.is_empty() || name.chars().count() > 120 {
        return None;
    }
    if name == "." || name == ".." {
        return None;
    }
    if name
        .chars()
        .any(|value| matches!(value, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return None;
    }
    Some(name.to_owned())
}
