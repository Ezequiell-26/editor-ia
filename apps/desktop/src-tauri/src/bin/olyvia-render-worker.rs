//! Worker de render headless: comparte el motor FFmpeg de la app sin abrir la
//! UI. Lee un proyecto `.editoria.json`, elige un perfil por destino y escribe
//! un MP4 verificando el archivo. Emite JSON por stdout y progreso por stderr.
use std::path::{Path, PathBuf};

use editor_ia_desktop_lib::projects::service;
use editor_ia_desktop_lib::render::ffmpeg::{
    build_plan, execute_sync, expand_compounds, parse_profile, verify_output, BuildPlanInput,
};
use serde_json::json;

fn arg(name: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(current) = args.next() {
        if current == name {
            return args.next();
        }
        if let Some(value) = current.strip_prefix(&format!("{name}=")) {
            return Some(value.to_string());
        }
    }
    None
}

fn fail(code: &str, message: &str) -> ! {
    println!(
        "{}",
        json!({ "ok": false, "code": code, "message": message })
    );
    std::process::exit(4);
}

fn tool_path(explicit: Option<String>, name: &str) -> PathBuf {
    if let Some(path) = explicit {
        return PathBuf::from(path);
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let dir = exe.parent().unwrap_or_else(|| Path::new("."));
    let candidates = [
        dir.join("ffmpeg").join(format!("{name}.exe")),
        dir.join("resources").join("ffmpeg").join(format!("{name}.exe")),
        dir.join("resources").join(format!("{name}.exe")),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(format!("{name}.exe"))
}

fn main() {
    let project_path = arg("--project").unwrap_or_default();
    let output_path = arg("--output").unwrap_or_default();
    let profile_name = arg("--profile").unwrap_or_else(|| "mp4-h264-1080p-16x9".into());
    if project_path.is_empty() || output_path.is_empty() {
        fail(
            "INVALID_REQUEST",
            "faltan --project y --output (rutas absolutas)",
        );
    }
    let project_path = PathBuf::from(project_path);
    let output_path = PathBuf::from(output_path);
    if !project_path.is_file() {
        fail("PROJECT_FILE_MISSING", "no existe el proyecto indicado");
    }
    if output_path.exists() {
        fail("OUTPUT_WRITE_FAILED", "el archivo de salida ya existe");
    }
    let opened = match service::open_project(&project_path) {
        Ok(opened) => opened,
        Err(error) => fail("INVALID_REQUEST", &format!("proyecto inválido: {}", error.message)),
    };
    let root = project_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let project = match expand_compounds(&opened.project) {
        Ok(project) => project,
        Err(error) => fail("INVALID_REQUEST", &format!("no se pudieron expandir compuestos: {}", error.message)),
    };
    let profiles = project["renderProfiles"].as_array().cloned().unwrap_or_default();
    if profiles.is_empty() {
        fail("INVALID_REQUEST", "el proyecto no tiene perfiles de render");
    }
    let (codec, width, height) = match profile_name.as_str() {
        "mp4-h264-1080p-16x9" => ("h264", 1920u64, 1080u64),
        "mp4-h264-vertical-9x16" => ("h264", 1080, 1920),
        "webm-vp9-1080p-16x9" => ("vp9", 1920, 1080),
        other => fail("INVALID_REQUEST", &format!("perfil desconocido: {other}")),
    };
    let profile_json = profiles
        .iter()
        .find(|profile| {
            profile["videoCodec"].as_str() == Some(codec)
                && profile["resolution"]["width"].as_u64() == Some(width)
                && profile["resolution"]["height"].as_u64() == Some(height)
        })
        .cloned()
        .unwrap_or_else(|| {
            fail(
                "INVALID_REQUEST",
                "el proyecto no tiene un perfil compatible con la resolución/códec pedidos",
            )
        });
    let profile = match parse_profile(&profile_json) {
        Ok(profile) => profile,
        Err(error) => fail("INVALID_REQUEST", &format!("perfil inválido: {}", error.message)),
    };
    let ffmpeg = tool_path(arg("--ffmpeg"), "ffmpeg");
    let ffprobe = tool_path(arg("--ffprobe"), "ffprobe");
    if !ffmpeg.is_file() || !ffprobe.is_file() {
        fail("RENDERER_UNAVAILABLE", "no se encontraron ffmpeg/ffprobe");
    }
    let temp_dir = output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(".olyvia-worker-{}", std::process::id()));
    if let Err(error) = std::fs::create_dir_all(&temp_dir) {
        fail("OUTPUT_WRITE_FAILED", &format!("no se pudo preparar el temporal: {error}"));
    }
    let plan = match build_plan(BuildPlanInput {
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output_path,
        include_captions: false,
        temp_dir: &temp_dir,
        ffprobe: &ffprobe,
        motion_ass: None,
        audio_only: false,
    }) {
        Ok(plan) => plan,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            fail("RENDERER_UNIMPLEMENTED", &format!("no se pudo armar el plan: {}", error.message));
        }
    };
    let verification = match execute_sync(&ffmpeg, &ffprobe, &plan, |progress| {
        eprintln!(
            "{}",
            json!({ "percent": progress.percent, "processedSeconds": progress.processed_seconds, "totalSeconds": progress.total_seconds })
        );
    }) {
        Ok(verification) => verification,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            fail("OUTPUT_WRITE_FAILED", &format!("el render falló: {}", error.message));
        }
    };
    if let Err(error) = verify_output(&ffprobe, &plan) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        fail("OUTPUT_TOO_SMALL", &format!("la verificación falló: {}", error.message));
    }
    let _ = std::fs::remove_dir_all(&temp_dir);
    println!(
        "{}",
        json!({
            "ok": true,
            "bytes": verification.output_bytes,
            "durationSeconds": verification.duration_seconds,
            "width": verification.width,
            "height": verification.height,
        })
    );
}
