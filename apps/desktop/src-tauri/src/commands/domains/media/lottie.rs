//! Secuencias Lottie rasterizadas por el WebView → WebM VP9 con alfa.
//!
//! El motor Lottie (MIT, JavaScript puro) vive en el frontend: dibuja cada
//! frame en un canvas y manda el PNG RGBA codificado en base64. Acá se valida
//! la secuencia, se codifica con `libvpx-vp9` en `yuva420p` y se importa a
//! `media/` como cualquier otro asset, con `media.alpha` para que el renderer
//! fuerce el decoder que expone el canal alfa.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::import_file;
use crate::media::lottie::{
    frame_path, invalid, sequence_dir, validate_sequence, MAX_BATCH, MAX_FRAMES, MAX_FRAME_BYTES,
    PNG_SIGNATURE,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

fn failure(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

/// Escribe un lote de PNG. El lote 0 reinicia la carpeta para que una
/// conversión nueva no reutilice frames de un intento anterior.
#[tauri::command]
pub async fn write_alpha_frames(
    token: String,
    start_index: u32,
    frames: Vec<String>,
) -> Result<(), ProjectError> {
    let dir = sequence_dir(&token)?;
    if frames.is_empty() {
        return Err(invalid("el lote de frames está vacío"));
    }
    if frames.len() > MAX_BATCH {
        return Err(invalid("el lote de frames supera el máximo permitido"));
    }
    if start_index == 0 {
        let _ = fs::remove_dir_all(&dir);
    }
    fs::create_dir_all(&dir)
        .map_err(|_| failure("no se pudo crear la carpeta temporal de la secuencia"))?;
    for (offset, payload) in frames.iter().enumerate() {
        let index = start_index
            .checked_add(offset as u32)
            .ok_or_else(|| invalid("el lote de frames desborda el índice"))?;
        if index >= MAX_FRAMES {
            return Err(invalid("la secuencia supera el máximo de frames"));
        }
        let bytes = STANDARD
            .decode(payload)
            .map_err(|_| invalid("un frame de la secuencia no es base64 válido"))?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(invalid("un frame de la secuencia es demasiado pesado"));
        }
        if !bytes.starts_with(&PNG_SIGNATURE) {
            return Err(invalid("un frame de la secuencia no es un PNG"));
        }
        fs::write(frame_path(&dir, index), bytes)
            .map_err(|_| failure("no se pudo escribir un frame de la secuencia"))?;
    }
    Ok(())
}

/// Borra la secuencia temporal cuando el frontend cancela o falla antes de
/// cerrarla. Si ya no existe, no es un error.
#[tauri::command]
pub async fn discard_alpha_frames(token: String) -> Result<(), ProjectError> {
    let dir = sequence_dir(&token)?;
    let _ = fs::remove_dir_all(&dir);
    Ok(())
}

pub(crate) fn encode_sequence(
    ffmpeg: &Path,
    dir: &Path,
    output: &Path,
    frame_count: u32,
    fps_num: u32,
    fps_den: u32,
) -> Result<(), ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "image2",
            "-start_number",
            "0",
            "-framerate",
            &format!("{fps_num}/{fps_den}"),
            "-i",
        ])
        .arg(dir.join("frame-%05d.png"))
        .args([
            "-frames:v",
            &frame_count.to_string(),
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            "-b:v",
            "0",
            "-crf",
            "30",
            "-cpu-used",
            "2",
            "-row-mt",
            "1",
            "-an",
            "-y",
        ])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let result = command
        .output()
        .map_err(|_| failure("no se pudo iniciar FFmpeg para la secuencia Lottie"))?;
    if !result.status.success() {
        let log = String::from_utf8_lossy(&result.stderr);
        let detail: String = log.trim().chars().take(400).collect();
        return Err(failure(&format!(
            "FFmpeg no pudo codificar la secuencia con alfa: {detail}"
        )));
    }
    if fs::metadata(output).map(|meta| meta.len()).unwrap_or(0) == 0 {
        return Err(failure("FFmpeg no produjo el video de la secuencia"));
    }
    Ok(())
}

/// Parámetros de la secuencia Lottie: rotulan el asset y describen el
/// video con alfa que se va a importar.
struct SequenceSpec {
    label: String,
    width: u32,
    height: u32,
    frame_count: u32,
    fps_num: u32,
    fps_den: u32,
}

/// Construye el asset final: el WebM ya está en `media/` con su hash y su
/// probe; se fijan los conteos exactos y la marca de alfa que lee el renderer.
fn build_asset(
    root: &Path,
    webm: &Path,
    ffprobe: &Path,
    spec: &SequenceSpec,
) -> Result<Value, ProjectError> {
    let mut asset = import_file(root, webm, ffprobe, spec.fps_num, spec.fps_den)?;
    let clean_label: String = spec
        .label
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    if let Some(object) = asset.as_object_mut() {
        object.insert(
            "label".into(),
            json!(if clean_label.is_empty() {
                "Lottie".to_owned()
            } else {
                clean_label
            }),
        );
        if let Some(provenance) = object
            .get_mut("rights")
            .and_then(Value::as_object_mut)
            .and_then(|rights| rights.get_mut("provenance"))
            .and_then(Value::as_object_mut)
        {
            provenance.insert("origin".into(), json!("generated-locally"));
        }
        if let Some(media) = object.get_mut("media").and_then(Value::as_object_mut) {
            media.insert("width".into(), json!(spec.width));
            media.insert("height".into(), json!(spec.height));
            media.insert("durationFrames".into(), json!(spec.frame_count));
            media.insert(
                "frameRate".into(),
                json!({ "num": spec.fps_num, "den": spec.fps_den }),
            );
            media.insert("alpha".into(), json!(true));
        }
    }
    Ok(asset)
}

/// Lógica de conversión sin el wrapper `State` de Tauri, para que los tests
/// ejerciten el flujo completo (sesión → herramientas → codificación → asset)
/// sin levantar una app.
async fn alpha_frames_to_asset_impl(
    state: &AppState,
    token: String,
    spec: SequenceSpec,
) -> Result<Value, ProjectError> {
    validate_sequence(
        spec.width,
        spec.height,
        spec.frame_count,
        spec.fps_num,
        spec.fps_den,
    )?;
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffmpeg =
        ffmpeg.ok_or_else(|| failure("FFmpeg es necesario para codificar la secuencia Lottie"))?;
    let ffprobe = ffprobe
        .ok_or_else(|| failure("FFprobe es necesario para registrar la secuencia Lottie"))?;
    let dir = sequence_dir(&token)?;
    if !dir.is_dir() {
        return Err(invalid("la secuencia temporal ya no está en disco"));
    }
    for index in 0..spec.frame_count {
        if !frame_path(&dir, index).is_file() {
            return Err(invalid(&format!(
                "falta el frame {index} de la secuencia Lottie"
            )));
        }
    }
    let webm = std::env::temp_dir().join(format!("olyvia-lottie-{token}.webm"));
    // AUD-129 (resto del dominio media): la codificación VP9 de la
    // secuencia (hasta 3600 frames) y el probe de importación son
    // bloqueantes; van a spawn_blocking.
    let ffmpeg_path = ffmpeg.clone();
    let ffprobe_path = ffprobe.clone();
    let root_path = session.root.clone();
    let encoded = tauri::async_runtime::spawn_blocking(move || {
        let encoded = encode_sequence(
            &ffmpeg_path,
            &dir,
            &webm,
            spec.frame_count,
            spec.fps_num,
            spec.fps_den,
        );
        if let Err(error) = encoded {
            let _ = fs::remove_dir_all(&dir);
            let _ = fs::remove_file(&webm);
            return Err(error);
        }
        let result = build_asset(&root_path, &webm, &ffprobe_path, &spec);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(&webm);
        result
    })
    .await
    .map_err(|_| failure("la conversión de la secuencia se interrumpió"))?;
    encoded
}

/// Codifica los frames escritos para `token` y devuelve el asset ya importado.
/// La carpeta temporal y el WebM intermedio se borran siempre.
#[tauri::command]
// clippy::too_many_arguments: la aridad es el contrato IPC con el frontend;
// los parámetros planos son los que el cliente ya envía.
#[allow(clippy::too_many_arguments)]
pub async fn alpha_frames_to_asset(
    state: State<'_, AppState>,
    token: String,
    label: String,
    width: u32,
    height: u32,
    frame_count: u32,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    alpha_frames_to_asset_impl(
        &state,
        token,
        SequenceSpec {
            label,
            width,
            height,
            frame_count,
            fps_num,
            fps_den,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgba, RgbaImage};

    fn write_frame(dir: &Path, index: u32) {
        let mut image = RgbaImage::from_pixel(64, 64, Rgba([0, 0, 0, 0]));
        let left = 8 + index * 6;
        for y in 20..44 {
            for x in left..(left + 18).min(58) {
                image.put_pixel(x, y, Rgba([240, 30, 30, 255]));
            }
        }
        image
            .save_with_format(frame_path(dir, index), ImageFormat::Png)
            .unwrap();
    }

    fn first_frame_png() -> Vec<u8> {
        let dir = std::env::temp_dir().join(format!("olyvia-frame-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_frame(&dir, 0);
        let bytes = fs::read(frame_path(&dir, 0)).unwrap();
        let _ = fs::remove_dir_all(&dir);
        bytes
    }

    #[test]
    fn rejects_tokens_that_could_escape_the_temp_directory() {
        assert!(sequence_dir("../../etc").is_err());
        assert!(sequence_dir("A".repeat(35).as_str()).is_err());
        assert!(sequence_dir("0123456789abcdef0123456789abcdef0123").is_ok());
    }

    #[test]
    fn validates_sequence_limits() {
        assert!(validate_sequence(1920, 1080, 90, 30, 1).is_ok());
        assert!(validate_sequence(1921, 1080, 90, 30, 1).is_err());
        assert!(validate_sequence(1920, 1080, 0, 30, 1).is_err());
        assert!(validate_sequence(1920, 1080, 3601, 30, 1).is_err());
        assert!(validate_sequence(1920, 1080, 90, 0, 1).is_err());
        assert!(validate_sequence(1920, 1080, 90, 240, 1).is_err());
        assert!(validate_sequence(1920, 1080, 90, 60_000, 1001).is_ok());
    }

    #[test]
    fn encodes_a_sequence_with_real_alpha() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("encode_sequence real omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root =
            std::env::temp_dir().join(format!("olyvia-lottie-test-{}", uuid::Uuid::new_v4()));
        let dir = root.join("frames");
        fs::create_dir_all(&dir).unwrap();
        let frame_count = 6u32;
        for index in 0..frame_count {
            write_frame(&dir, index);
        }
        let webm = root.join("salida.webm");
        encode_sequence(&ffmpeg, &dir, &webm, frame_count, 30, 1).unwrap();

        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=width,height,nb_read_frames:stream_tags=alpha_mode",
                "-of",
                "default=nw=1",
            ])
            .arg(&webm)
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&probe.stdout).into_owned();
        // El WebM guarda el alfa como BlockAdditional: el contenedor lo marca
        // con `alpha_mode=1` y sólo el decoder de libvpx lo expone.
        assert!(text.contains("alpha_mode=1"), "sin marca de alfa: {text}");
        assert!(
            text.contains("width=64") && text.contains("height=64"),
            "tamaño: {text}"
        );
        assert!(text.contains("nb_read_frames=6"), "frames: {text}");

        let raw = Command::new(&ffmpeg)
            .args(["-v", "error", "-c:v", "libvpx-vp9", "-i"])
            .arg(&webm)
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
            .output()
            .unwrap();
        assert_eq!(raw.stdout.len(), 64 * 64 * 4);
        let alpha_at = |x: usize, y: usize| raw.stdout[(y * 64 + x) * 4 + 3];
        assert_eq!(alpha_at(63, 63), 0, "la esquina debe seguir transparente");
        assert_eq!(alpha_at(0, 0), 0, "el borde debe seguir transparente");
        assert!(alpha_at(16, 32) > 240, "el sujeto debe ser opaco");

        let media_root = root.join("proyecto");
        fs::create_dir_all(&media_root).unwrap();
        let asset = build_asset(
            &media_root,
            &webm,
            &ffprobe,
            &SequenceSpec {
                label: "Logo Lottie".to_owned(),
                width: 64,
                height: 64,
                frame_count,
                fps_num: 30,
                fps_den: 1,
            },
        )
        .unwrap();
        assert_eq!(asset["kind"], "video");
        assert_eq!(asset["label"], "Logo Lottie");
        assert_eq!(asset["media"]["alpha"], true);
        assert_eq!(asset["media"]["durationFrames"], 6);
        assert_eq!(asset["media"]["width"], 64);
        assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");
        assert!(media_root.join("media").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    /// Flujo completo de la feature: `write_alpha_frames` por lotes (el
    /// comando IPC real) → `alpha_frames_to_asset_impl` (sesión, herramientas,
    /// codificación VP9+alfa e importación) → verificación del WebM en disco
    /// con ffprobe. Sólo falta el transporte serde de Tauri.
    #[tokio::test]
    async fn converts_written_frames_into_an_imported_webm_asset() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("conversión Lottie completa omitida: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        use crate::state::{AppState, Session, Settings};
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex};

        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");

        let root = std::env::temp_dir().join(format!("olyvia-lottie-e2e-{}", uuid::Uuid::new_v4()));
        let project_dir = root.join("proyecto");
        fs::create_dir_all(&project_dir).unwrap();
        let state = AppState {
            app: None,
            session: Mutex::new(Some(Session::new(
                project_dir.join("sesion.olyvia"),
                "proyecto-e2e".to_owned(),
            ))),
            settings: Mutex::new(Settings::default()),
            config_dir: root.join("config"),
            cache_dir: root.join("cache"),
            render_jobs: Arc::new(Mutex::new(HashMap::new())),
            thumbnails: Mutex::new(HashMap::new()),
            analysis_cache: Mutex::new(HashMap::new()),
            downloader_bridge: Mutex::new(None),
        };

        let token = uuid::Uuid::new_v4().to_string();
        let payload = STANDARD.encode(first_frame_png());
        // Dos lotes, como hace el frontend al rasterizar por tandas.
        write_alpha_frames(
            token.clone(),
            0,
            vec![payload.clone(), payload.clone(), payload.clone()],
        )
        .await
        .unwrap();
        write_alpha_frames(
            token.clone(),
            3,
            vec![payload.clone(), payload.clone(), payload.clone()],
        )
        .await
        .unwrap();

        let asset = alpha_frames_to_asset_impl(
            &state,
            token.clone(),
            SequenceSpec {
                label: "Badge Lottie".to_owned(),
                width: 64,
                height: 64,
                frame_count: 6,
                fps_num: 30,
                fps_den: 1,
            },
        )
        .await
        .unwrap();

        assert_eq!(asset["kind"], "video");
        assert_eq!(asset["label"], "Badge Lottie");
        assert_eq!(asset["media"]["alpha"], true);
        assert_eq!(asset["media"]["durationFrames"], 6);
        assert_eq!(asset["media"]["width"], 64);
        assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");

        let relative = asset["source"]["path"].as_str().unwrap().to_owned();
        let imported = project_dir.join(&relative);
        assert!(
            imported.is_file(),
            "el WebM importado debe existir: {relative}"
        );

        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=width,height,nb_read_frames:stream_tags=alpha_mode",
                "-of",
                "default=nw=1",
            ])
            .arg(&imported)
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&probe.stdout).into_owned();
        assert!(text.contains("alpha_mode=1"), "sin marca de alfa: {text}");
        assert!(
            text.contains("width=64") && text.contains("height=64"),
            "tamaño: {text}"
        );
        assert!(text.contains("nb_read_frames=6"), "frames: {text}");

        // La secuencia temporal y el WebM intermedio se limpiaron siempre.
        assert!(!sequence_dir(&token).unwrap().exists());
        assert!(!std::env::temp_dir()
            .join(format!("olyvia-lottie-{token}.webm"))
            .exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn writes_and_discards_a_frame_batch() {
        let token = uuid::Uuid::new_v4().to_string();
        let payload = STANDARD.encode(first_frame_png());
        write_alpha_frames(token.clone(), 0, vec![payload.clone(), payload.clone()])
            .await
            .unwrap();
        let dir = sequence_dir(&token).unwrap();
        assert!(frame_path(&dir, 0).is_file());
        assert!(frame_path(&dir, 1).is_file());
        let rejected =
            write_alpha_frames(token.clone(), 0, vec![STANDARD.encode(b"no es un png")]).await;
        assert!(rejected.is_err());
        discard_alpha_frames(token.clone()).await.unwrap();
        assert!(!dir.exists());
    }
}
