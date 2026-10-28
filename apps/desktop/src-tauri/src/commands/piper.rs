//! Piper TTS local, empaquetado con el instalador.
//!
//! El motor y la voz viven en `resources/piper`: no hay red, credenciales ni
//! servicios externos. La síntesis escribe un WAV temporal que el pipeline de
//! descarga usa como pista final.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Manager};

use crate::commands::hide_console;
use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone)]
pub struct PiperAssets {
    pub root: PathBuf,
    pub exe: PathBuf,
    pub model: PathBuf,
    pub config: PathBuf,
}

impl PiperAssets {
    pub fn from_root(root: &Path) -> Option<Self> {
        let exe = root.join("piper.exe");
        let model = root.join("es_voice.onnx");
        let config = root.join("es_voice.onnx.json");
        if exe.is_file() && model.is_file() && config.is_file() {
            Some(Self {
                root: root.to_path_buf(),
                exe,
                model,
                config,
            })
        } else {
            None
        }
    }
}

/// Busca el motor empaquetado primero en recursos y después en el checkout
/// de desarrollo. Devuelve `None` si el instalador no incluyó la voz.
pub fn resolve_assets(app: &AppHandle) -> Option<PiperAssets> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = app.path().resolve("piper", tauri::path::BaseDirectory::Resource) {
        candidates.push(path);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/piper"));
    candidates
        .into_iter()
        .find_map(|root| PiperAssets::from_root(&root))
}

pub fn resolve_watermark(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = app
        .path()
        .resolve("watermark.png", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(path);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/watermark.png"));
    candidates.into_iter().find(|path| path.is_file())
}

fn clean_script(text: &str) -> Result<String, ProjectError> {
    let cleaned = text
        .replace('\0', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el guion para la voz IA está vacío",
        ));
    }
    Ok(cleaned.chars().take(4_000).collect())
}

/// Sintetiza el guion en un WAV. Bloqueante: se llama desde el mismo worker
/// de descarga para que Piper y FFmpeg no compitan por la UI.
pub fn synthesize(
    assets: &PiperAssets,
    script: &str,
    output: &Path,
) -> Result<(), ProjectError> {
    let text = clean_script(script)?;
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar la carpeta de la voz IA",
            )
        })?;
    }
    let _ = std::fs::remove_file(output);
    let mut command = Command::new(&assets.exe);
    command
        .current_dir(&assets.root)
        .arg("--model")
        .arg(&assets.model)
        .arg("--config")
        .arg(&assets.config)
        .arg("--output_file")
        .arg(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command.env(
        "ESPEAK_DATA_PATH",
        assets.root.join("espeak-ng-data"),
    );
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar Piper TTS; revisá que el recurso piper esté instalado",
        )
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo enviar el guion a Piper")
        })?;
        stdin.write_all(b"\n").ok();
    }
    let result = child.wait_with_output().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "Piper no terminó correctamente")
    })?;
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        let last = detail
            .lines()
            .last()
            .unwrap_or("Piper no pudo sintetizar la voz");
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!("voz IA local falló: {}", last.chars().take(300).collect::<String>()),
        ));
    }
    let bytes = std::fs::metadata(output).map(|meta| meta.len()).unwrap_or(0);
    if bytes <= 44 {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "Piper devolvió un WAV vacío",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_scripts_are_rejected() {
        assert!(clean_script("   \n\t ").is_err());
        assert_eq!(clean_script("  Hola   mundo ").unwrap(), "Hola mundo");
    }

    #[test]
    fn script_is_limited_to_4000_chars() {
        let long = "a".repeat(5_000);
        assert_eq!(clean_script(&long).unwrap().chars().count(), 4_000);
    }

    #[test]
    fn bundled_voice_is_resolvable_in_the_checkout() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/piper");
        let assets = PiperAssets::from_root(&root).expect("la voz empaquetada debería existir");
        assert!(assets.exe.is_file());
        assert!(assets.model.is_file());
        assert!(assets.config.is_file());
    }

    /// Síntesis real con el modelo empaquetado. Se omite salvo pedido explícito.
    #[test]
    fn piper_synthesis_live_optional() {
        if std::env::var("EDITOR_IA_RUN_TTS_TESTS").ok().as_deref() != Some("1") {
            eprintln!("piper_synthesis_live omitido: definí EDITOR_IA_RUN_TTS_TESTS=1");
            return;
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/piper");
        let assets = PiperAssets::from_root(&root).expect("voz");
        let output = std::env::temp_dir().join(format!("olyvia-piper-{}.wav", uuid::Uuid::new_v4()));
        synthesize(&assets, "Hola, esta es una prueba local de Olyvia.", &output)
            .expect("Piper debería sintetizar");
        let bytes = std::fs::read(&output).unwrap();
        assert!(bytes.len() > 44);
        assert_eq!(&bytes[0..4], b"RIFF");
        let _ = std::fs::remove_file(output);
    }
}
