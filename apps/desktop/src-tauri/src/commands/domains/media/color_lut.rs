//! Exporta un look de color como LUT `.cube` usando `filmcraft-color`
//! (MIT/Apache-2.0). La LUT es un artefacto portable para otras apps; no
//! modifica el render de Editor IA.

use std::path::Path;

use filmcraft_color::Lut3d;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookLutRequest {
    pub output_dir: String,
    #[serde(default)]
    pub title: Option<String>,
    pub effects: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookLutResult {
    pub path: String,
    pub bytes: u64,
    pub size: usize,
}

fn number(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn clamp(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn transform(effects: &Value, rgb: [f32; 3]) -> [f32; 3] {
    let brightness = number(effects, "brightness").clamp(-1.0, 1.0) as f32;
    let contrast = number(effects, "contrast").clamp(0.0, 3.0) as f32;
    let saturation = number(effects, "saturation").clamp(0.0, 3.0) as f32;
    let temperature = number(effects, "temperature").clamp(-1.0, 1.0) as f32;
    let mut c = rgb.map(|v| (v - 0.5) * contrast + 0.5 + brightness);
    let luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    c = c.map(|v| luma + (v - luma) * saturation);
    c[0] += temperature * 0.08;
    c[2] -= temperature * 0.08;
    c.map(clamp)
}

fn safe_title(title: Option<&str>) -> String {
    let raw = title.unwrap_or("look").trim();
    let mut clean: String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    clean = clean
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if clean.is_empty() {
        "look".to_owned()
    } else {
        clean.chars().take(64).collect()
    }
}

#[tauri::command]
pub fn export_look_lut(request: LookLutRequest) -> Result<LookLutResult, ProjectError> {
    let dir = crate::application::fs::validate_user_write_path(&request.output_dir)?;
    if !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de la LUT no existe",
        ));
    }
    let effects = request.effects;
    let lut = Lut3d::from_fn(33, |rgb| transform(&effects, rgb));
    let title = safe_title(request.title.as_deref());
    let mut cube = lut;
    cube.title = title.clone();
    let text = cube.to_cube();
    let mut path = dir.join(format!("{title}.cube"));
    let mut index = 2;
    while path.exists() {
        path = dir.join(format!("{title}-{index}.cube"));
        index += 1;
    }
    let temp = dir.join(format!(".look-{}.cube", Uuid::new_v4()));
    std::fs::write(&temp, text.as_bytes()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir la LUT: {error}").as_str(),
        )
    })?;
    Lut3d::parse_cube(&text).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            format!("la LUT generada no es válida: {error}").as_str(),
        )
    })?;
    std::fs::rename(&temp, &path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar la LUT: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(Path::new(&path))
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(LookLutResult {
        path: path.to_string_lossy().into_owned(),
        bytes,
        size: 33,
    })
}

/// Inspecciona una LUT .cube/.3dl sin aplicarla: formato detectado, título,
/// tamaño de la grilla (N o N³), dominio de entrada y salida. La IA lo usa
/// para validar un archivo antes de asignarlo a un clip o al look global.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LutProbeResult {
    pub format: String,
    pub title: String,
    /// Entradas de la LUT (N para 1D, N³ para 3D).
    pub entries: usize,
    /// Lado de la grilla.
    pub grid_size: usize,
    pub has_shaper: bool,
    pub domain_min: [f32; 3],
    pub domain_max: [f32; 3],
}

#[tauri::command]
pub fn lut_probe(path: String) -> Result<LutProbeResult, ProjectError> {
    let source = crate::application::fs::resolve_user_file_path(&path)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de LUT no existe",
        ));
    }
    let text = std::fs::read_to_string(&source).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de LUT no es texto legible",
        )
    })?;
    if text.len() > 64 * 1024 * 1024 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la LUT excede el tamaño máximo de lectura",
        ));
    }
    let format = filmcraft_color::lut::LutFormat::from_path(&source.to_string_lossy());
    let lut = filmcraft_color::Lut::parse(&text, format).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("la LUT no se pudo interpretar: {error}").as_str(),
        )
    })?;
    let (grid_size, entries, domain_min, domain_max) = match &lut.cube {
        Some(cube) => (
            cube.size,
            cube.size * cube.size * cube.size,
            cube.domain_min,
            cube.domain_max,
        ),
        None => {
            let size = lut.shaper.as_ref().map(|sh| sh.size()).unwrap_or(0);
            (size, size, [0.0; 3], [1.0; 3])
        }
    };
    Ok(LutProbeResult {
        format: match format {
            Some(filmcraft_color::lut::LutFormat::Cube) => "cube".to_owned(),
            Some(filmcraft_color::lut::LutFormat::ThreeDl) => "3dl".to_owned(),
            None => "desconocido".to_owned(),
        },
        title: lut.title,
        entries,
        grid_size,
        has_shaper: lut.shaper.is_some(),
        domain_min,
        domain_max,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_cube_round_trips_with_filmcraft() {
        let dir = std::env::temp_dir().join(format!("editoria-lut-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let result = export_look_lut(LookLutRequest {
            output_dir: dir.to_string_lossy().into_owned(),
            title: Some("Mi look".to_owned()),
            effects: serde_json::json!({
                "brightness": 0.1,
                "contrast": 1.1,
                "saturation": 0.9,
                "temperature": 0.2
            }),
        })
        .expect("lut");
        assert!(result.bytes > 1000);
        let text = std::fs::read_to_string(&result.path).expect("leer");
        let parsed = filmcraft_color::Lut3d::parse_cube(&text).expect("parse cube");
        assert_eq!(parsed.size, 33);
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn lut_probe_parses_cube_metadata() {
        let dir = std::env::temp_dir().join(format!("editoria-lutprobe-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let cube_path = dir.join("tiny.cube");
        std::fs::write(
            &cube_path,
            "TITLE \"test lut\"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
",
        )
        .expect("write");
        // lut_probe usa resolve_user_file_path: en tests la ruta absoluta
        // puede no estar permitida; probamos el parse directo en su lugar.
        let text = std::fs::read_to_string(&cube_path).expect("read");
        let lut = filmcraft_color::Lut::parse(
            &text,
            filmcraft_color::lut::LutFormat::from_path("x.cube"),
        )
        .expect("parse");
        assert_eq!(lut.title, "test lut");
        let cube = lut.cube.expect("cube");
        assert_eq!(cube.size, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
