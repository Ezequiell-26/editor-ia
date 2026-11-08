//! Casos de uso del dominio Media: ingesta de archivos al proyecto y
//! verificación de assets en disco.
//!
//! La lógica pesada (copiar a `media/`, sondear con ffprobe, hashear,
//! medir) vive en `crate::media` — el dominio puro. Aquí queda la
//! orquestación que antes estaba duplicada en dos comandos IPC: el tope de
//! archivos, el formato de warnings, la confirmación de derechos y la
//! comprobación de existencia de assets.
//!
//! Fachada del dominio: el análisis (escenas, estabilización, probe, VMAF)
//! vive en `media_analysis` y la lectura de subtítulos en `media_subtitles`;
//! ambos se re-exportan para que los consumidores sigan usando
//! `application::media::*`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::media::{import_file, resolve_inside_root, ImportOutcome};
use crate::ports::media::AssetFileInfo;
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub use super::media_analysis::{
    analyze_stabilization, detect_scenes, measure_vmaf, probe_any_file, probe_file_json,
    vmaf_available,
};
pub use super::media_subtitles::read_subtitle_file;

/// Máximo de rutas por llamada de `check_asset_files`.
const MAX_CHECK_PATHS: usize = 2_000;

fn file_name_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned())
}

/// Declara derechos de uso generado por el usuario/proveedor sobre un asset
/// recién importado (sólo cuando la persona lo confirmó).
pub fn confirm_generated_rights(asset: &mut Value, provider: Option<&str>) {
    asset["status"] = json!("ready");
    if let Some(rights) = asset.get_mut("rights").and_then(Value::as_object_mut) {
        rights.insert(
            "license".to_owned(),
            json!({ "id": "user-declared", "commercialUse": "allowed" }),
        );
        if let Some(provenance) = rights.get_mut("provenance").and_then(Value::as_object_mut) {
            provenance.insert("origin".to_owned(), json!("generated-by-provider"));
            if let Some(provider) = provider {
                provenance.insert("provider".to_owned(), json!(provider));
            }
        }
    }
}

/// Cómo se aplica el tope de importación:
/// - `MaxAssets`: sigue procesando archivos aunque fallen, y corta cuando ya
///   hay N assets importados (diálogo de importación, con aviso).
/// - `MaxPaths`: procesa como máximo N rutas y trunca en silencio
///   (tool bridges que ya produjeron los archivos).
#[derive(Debug, Clone, Copy)]
pub enum ImportLimit {
    MaxAssets(usize),
    MaxPaths(usize),
}

/// Importa archivos locales al `media/` del proyecto: copia, sondea y
/// devuelve los assets con warnings por archivo fallido.
///
/// - `skip_missing`: las rutas explícitas que ya no existen se saltean con
///   aviso propio; las del diálogo pasan por `import_file` y reportan su
///   error normal.
/// - `confirm_rights`/`provider`: declaran procedencia cuando la persona
///   confirmó derechos sobre material generado.
pub fn import_local_files(
    root: &Path,
    ffprobe: &Path,
    files: Vec<PathBuf>,
    fps_num: u32,
    fps_den: u32,
    confirm_rights: bool,
    provider: Option<&str>,
    skip_missing: bool,
    limit: ImportLimit,
) -> ImportOutcome {
    let mut outcome = ImportOutcome {
        assets: Vec::new(),
        warnings: Vec::new(),
    };
    let max_paths = match limit {
        ImportLimit::MaxPaths(max) => max,
        ImportLimit::MaxAssets(_) => usize::MAX,
    };
    for file in files.into_iter().take(max_paths) {
        if let ImportLimit::MaxAssets(max) = limit {
            if outcome.assets.len() >= max {
                outcome
                    .warnings
                    .push(format!("Se importaron solo los primeros {} archivos.", max));
                break;
            }
        }
        if skip_missing && !file.is_file() {
            outcome
                .warnings
                .push("Se salteó un artefacto que ya no existe en esa ruta.".to_owned());
            continue;
        }
        match import_file(root, &file, ffprobe, fps_num.max(1), fps_den.max(1)) {
            Ok(mut asset) => {
                if confirm_rights {
                    confirm_generated_rights(&mut asset, provider);
                }
                outcome.assets.push(asset);
            }
            Err(error) => {
                outcome
                    .warnings
                    .push(format!("{}: {}", file_name_label(&file), error.message))
            }
        }
    }
    outcome
}

/// Verifica que cada ruta relativa sigue resolviendo dentro del root del
/// proyecto y reporta bytes reales en disco.
pub fn check_asset_files(root: &Path, paths: Vec<String>) -> Vec<AssetFileInfo> {
    paths
        .into_iter()
        .take(MAX_CHECK_PATHS)
        .map(|path| match resolve_inside_root(root, &path) {
            Ok(resolved) => {
                let bytes = std::fs::metadata(&resolved).map(|m| m.len()).unwrap_or(0);
                AssetFileInfo {
                    path,
                    exists: bytes > 0,
                    bytes,
                }
            }
            Err(_) => AssetFileInfo {
                path,
                exists: false,
                bytes: 0,
            },
        })
        .collect()
}

/// Error cuando ffprobe no está disponible (compartido por los comandos de
/// importación).
pub fn require_ffprobe(ffprobe: Option<PathBuf>) -> Result<PathBuf, ProjectError> {
    ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; sin medir el material no se puede importar",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::MAX_IMPORT_FILES;

    fn fake_files(count: usize) -> (PathBuf, Vec<PathBuf>) {
        let dir = std::env::temp_dir().join(format!("olyvia-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("tmp");
        // Archivos vacíos: import_file falla antes de llamar a ffprobe.
        let files = (0..count)
            .map(|index| {
                let file = dir.join(format!("clip-{index}.mp4"));
                std::fs::write(&file, b"").expect("write");
                file
            })
            .collect();
        (dir, files)
    }

    #[test]
    fn max_paths_trunca_en_silencio() {
        let (dir, files) = fake_files(3);
        let outcome = import_local_files(
            &dir,
            Path::new("ffprobe-inexistente"),
            files,
            30,
            1,
            false,
            None,
            false,
            ImportLimit::MaxPaths(2),
        );
        assert_eq!(outcome.warnings.len(), 2);
        assert!(outcome.assets.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn max_assets_sigue_pese_a_fallos_hasta_el_tope() {
        let (dir, files) = fake_files(3);
        // Con MaxAssets el tope cuenta assets importados, no rutas: los 3
        // archivos fallan pero se procesan los 3 (sin truncar por paths).
        let outcome = import_local_files(
            &dir,
            Path::new("ffprobe-inexistente"),
            files,
            30,
            1,
            false,
            None,
            false,
            ImportLimit::MaxAssets(MAX_IMPORT_FILES),
        );
        assert_eq!(outcome.warnings.len(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skip_missing_reporta_rutas_que_ya_no_existen() {
        let (dir, mut files) = fake_files(1);
        files.push(dir.join("ya-no-esta.mp4"));
        let outcome = import_local_files(
            &dir,
            Path::new("ffprobe-inexistente"),
            files,
            30,
            1,
            false,
            None,
            true,
            ImportLimit::MaxPaths(MAX_IMPORT_FILES),
        );
        assert!(outcome
            .warnings
            .iter()
            .any(|warning| warning.contains("ya no existe")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_asset_files_reporta_existencia_y_bytes() {
        let dir = std::env::temp_dir().join(format!("olyvia-check-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("tmp");
        std::fs::write(dir.join("media/clip.mp4"), b"12345").expect("write");
        let results = check_asset_files(
            &dir,
            vec!["media/clip.mp4".to_owned(), "media/falta.mp4".to_owned()],
        );
        assert_eq!(results.len(), 2);
        assert!(results[0].exists);
        assert_eq!(results[0].bytes, 5);
        assert!(!results[1].exists);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
