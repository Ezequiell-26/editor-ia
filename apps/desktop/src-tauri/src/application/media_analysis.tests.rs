//! Tests del caso de uso `detect_scenes`: sesión → asset del proyecto →
//! FFmpeg `select/showinfo` → cortes en frames de timeline del asset.
//!
//! El runner es un fake que devuelve stderr de showinfo grabado; la prueba
//! live (video con cortes reales) queda detrás de
//! `EDITOR_IA_RUN_RENDER_TESTS=1` como el resto de los tests de render.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use super::detect_scenes;
use crate::ports::media::{MediaRunner, MediaTools};
use crate::ports::projects::{ProjectDocuments, ProjectSession, ProjectSessionInfo};
use crate::projects::service::{OpenedProject, ProjectError, SaveProjectResult};

fn exit_status(code: i32) -> std::process::ExitStatus {
    #[cfg(windows)]
    {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(code.max(0) as u32)
    }
    #[cfg(not(windows))]
    {
        let _ = code;
        Command::new("sh")
            .args(["-c", "exit 0"])
            .output()
            .expect("status de prueba")
            .status
    }
}

/// Documents en memoria: `open` devuelve el proyecto JSON del fixture.
struct MemDocs {
    project: Value,
}

impl ProjectDocuments for MemDocs {
    fn open(&self, path: &Path) -> Result<OpenedProject, ProjectError> {
        Ok(OpenedProject {
            project: self.project.clone(),
            path: path.to_string_lossy().to_string(),
        })
    }
    fn create_with_video(
        &self,
        _path: &Path,
        _name: &str,
        _video: Option<Value>,
    ) -> Result<OpenedProject, ProjectError> {
        unimplemented!()
    }
    fn save(&self, _path: &Path, _project: &Value) -> Result<SaveProjectResult, ProjectError> {
        unimplemented!()
    }
}

struct FixedSession {
    info: ProjectSessionInfo,
}

impl ProjectSession for FixedSession {
    fn current(&self) -> Result<Option<ProjectSessionInfo>, ProjectError> {
        Ok(Some(self.info.clone()))
    }
    fn require(&self) -> Result<ProjectSessionInfo, ProjectError> {
        Ok(self.info.clone())
    }
    fn adopt(&self, _info: &ProjectSessionInfo) -> Result<(), ProjectError> {
        Ok(())
    }
    fn clear(&self) -> Result<(), ProjectError> {
        Ok(())
    }
}

struct FakeTools {
    ffmpeg: Option<PathBuf>,
}

impl MediaTools for FakeTools {
    fn ffmpeg_path(&self) -> Option<PathBuf> {
        self.ffmpeg.clone()
    }
    fn ffprobe_path(&self) -> Option<PathBuf> {
        None
    }
}

/// Runner que graba los args y devuelve un stderr de `showinfo` enlatado.
struct FakeRunner {
    stderr: String,
    ok: bool,
    calls: Mutex<Vec<Vec<String>>>,
}

impl MediaRunner for FakeRunner {
    fn run_ffmpeg(
        &self,
        _ffmpeg: &Path,
        args: &[String],
        _cwd: Option<&Path>,
    ) -> Result<Output, ProjectError> {
        self.calls.lock().unwrap().push(args.to_vec());
        Ok(Output {
            status: exit_status(if self.ok { 0 } else { 1 }),
            stdout: Vec::new(),
            stderr: self.stderr.clone().into_bytes(),
        })
    }
    fn run_ffprobe(&self, _ffprobe: &Path, _args: &[String]) -> Result<Output, ProjectError> {
        unimplemented!()
    }
    fn run_ffmpeg_with_timeout(
        &self,
        ffmpeg: &Path,
        args: &[String],
        cwd: Option<&Path>,
        _timeout: Duration,
    ) -> Result<Output, ProjectError> {
        self.run_ffmpeg(ffmpeg, args, cwd)
    }
    fn run_ffprobe_with_timeout(
        &self,
        ffprobe: &Path,
        args: &[String],
        _timeout: Duration,
    ) -> Result<Output, ProjectError> {
        self.run_ffprobe(ffprobe, args)
    }
    fn ensure_dir(&self, _path: &Path) -> Result<(), ProjectError> {
        Ok(())
    }
    fn file_exists(&self, _path: &Path) -> bool {
        true
    }
    fn remove_file(&self, _path: &Path) {}
}

/// Proyecto mínimo con un asset de video `ready` en `media/toma.mp4`.
fn project_with_video() -> Value {
    json!({
        "assets": [{
            "id": "asset-1",
            "kind": "video",
            "status": "ready",
            "label": "Toma",
            "source": { "type": "local", "path": "media/toma.mp4" },
            "media": {
                "frameRate": { "num": 30, "den": 1 },
                "durationFrames": 300
            }
        }]
    })
}

/// Root temporal con `media/toma.mp4` existente (el caso de uso exige que el
/// archivo esté en disco) y las dependencias listas para `detect_scenes`.
fn fixture(stderr: &str, ok: bool) -> (FixedSession, MemDocs, FakeTools, FakeRunner, PathBuf) {
    let root = std::env::temp_dir().join(format!("editoria-scenes-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).expect("media dir");
    std::fs::write(media.join("toma.mp4"), b"fixture").expect("asset file");
    let session = FixedSession {
        info: ProjectSessionInfo {
            path: root.join("fixture.editoria.json"),
            root: root.clone(),
            project_id: "fixture".to_owned(),
        },
    };
    let docs = MemDocs {
        project: project_with_video(),
    };
    let tools = FakeTools {
        ffmpeg: Some(PathBuf::from("ffmpeg")),
    };
    let runner = FakeRunner {
        stderr: stderr.to_owned(),
        ok,
        calls: Mutex::new(Vec::new()),
    };
    (session, docs, tools, runner, root)
}

const SHOWINFO: &str = r#"
[Parsed_showinfo_1 @ 0x1] n:   2 pts:     512 pts_time:0.512       pos: 1
[Parsed_showinfo_1 @ 0x1] n:  60 pts:   30720 pts_time:2           pos: 2
[Parsed_showinfo_1 @ 0x1] n:  60 pts:   30720 pts_time:2           pos: 2
[Parsed_showinfo_1 @ 0x1] n: 150 pts:   76800 pts_time:5           pos: 3
"#;

#[test]
fn detect_scenes_ordena_cortes_en_frames_del_asset() {
    let (session, docs, tools, runner, root) = fixture(SHOWINFO, true);
    let result =
        detect_scenes(&session, &docs, &tools, &runner, "asset-1", 0.35).expect("detección");
    let _ = std::fs::remove_dir_all(&root);
    assert_eq!(result.threshold, 0.35);
    assert_eq!(result.duration_frames, 300);
    assert_eq!(result.fps_num, 30);
    // 0.512 s → frame 15 (fuera del rango de clip real pero dentro del asset),
    // 2 s → 60, 5 s → 150; deduplicados y ordenados.
    assert_eq!(
        result.cuts.iter().map(|cut| cut.frame).collect::<Vec<_>>(),
        vec![15, 60, 150]
    );
    assert_eq!(result.cuts[1].seconds, 2.0);
    // El runner recibió el filtro select+showinfo con el umbral pedido.
    let calls = runner.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let vf = calls[0]
        .iter()
        .position(|arg| arg == "-vf")
        .map(|index| calls[0][index + 1].clone())
        .expect("flag -vf");
    assert!(vf.contains("gt(scene,0.350)"), "filtro inesperado: {vf}");
    assert!(vf.contains("showinfo"), "filtro inesperado: {vf}");
}

#[test]
fn detect_scenes_sin_cortes_devuelve_lista_vacia() {
    let (session, docs, tools, runner, root) = fixture("sin showinfo\n", true);
    let result =
        detect_scenes(&session, &docs, &tools, &runner, "asset-1", 0.5).expect("detección");
    let _ = std::fs::remove_dir_all(&root);
    assert!(result.cuts.is_empty());
    assert_eq!(result.threshold, 0.5);
}

#[test]
fn detect_scenes_filtra_frames_fuera_del_asset() {
    // pts_time:0 produce frame 0 (descartado) y 12 s → frame 360 ≥ duration.
    let stderr = "[x] pts_time:0\n[x] pts_time:12\n";
    let (session, docs, tools, runner, root) = fixture(stderr, true);
    let result =
        detect_scenes(&session, &docs, &tools, &runner, "asset-1", 0.35).expect("detección");
    let _ = std::fs::remove_dir_all(&root);
    assert!(result.cuts.is_empty());
}

#[test]
fn detect_scenes_propaga_error_de_ffmpeg() {
    let (session, docs, tools, runner, root) = fixture("boom", false);
    let error =
        detect_scenes(&session, &docs, &tools, &runner, "asset-1", 0.35).expect_err("ffmpeg falló");
    let _ = std::fs::remove_dir_all(&root);
    assert!(error.message.contains("FFmpeg"));
}

#[test]
fn detect_scenes_rechaza_sin_ffmpeg_o_asset_invalido() {
    let (session, docs, _tools, _runner, root) = fixture(SHOWINFO, true);
    let sin_ffmpeg = FakeTools { ffmpeg: None };
    let runner = FakeRunner {
        stderr: String::new(),
        ok: true,
        calls: Mutex::new(Vec::new()),
    };
    let error = detect_scenes(&session, &docs, &sin_ffmpeg, &runner, "asset-1", 0.35)
        .expect_err("sin ffmpeg");
    assert!(error.message.contains("ffmpeg"));
    let _ = std::fs::remove_dir_all(&root);
}

/// Prueba real de extremo a extremo: FFmpeg genera un video con tres tramos
/// (testsrc2 → rojo → testsrc) y el caso de uso devuelve los dos cortes.
/// Se activa con `EDITOR_IA_RUN_RENDER_TESTS=1` porque necesita FFmpeg.
#[test]
fn live_detect_scenes_encuentra_cortes_en_video_generado() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la detección real");
        return;
    }
    let settings = crate::state::Settings::default();
    let (Some(ffmpeg), Some(ffprobe), _) = crate::commands::system::resolve_tools(&settings) else {
        eprintln!("FFmpeg no está disponible; se omite");
        return;
    };
    let root = std::env::temp_dir().join(format!("editoria-scenes-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).expect("media dir");
    let video = media.join("toma.mp4");
    let mut command = Command::new(&ffmpeg);
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x120:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:size=160x120:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x120:rate=30:duration=2",
        "-filter_complex",
        "[0:v][1:v][2:v]concat=n=3:v=1[v]",
        "-map",
        "[v]",
        "-pix_fmt",
        "yuv420p",
    ]);
    command.arg(&video);
    crate::commands::hide_console(&mut command);
    let built = command.output().expect("correr ffmpeg");
    assert!(
        built.status.success(),
        "ffmpeg no generó el video de prueba"
    );

    let session = FixedSession {
        info: ProjectSessionInfo {
            path: root.join("live.editoria.json"),
            root: root.clone(),
            project_id: "live".to_owned(),
        },
    };
    let docs = MemDocs {
        project: project_with_video(),
    };
    let tools = FakeTools {
        ffmpeg: Some(ffmpeg.clone()),
    };
    let _ = ffprobe;
    let runner = crate::infrastructure::media::SystemMediaRunner;
    let result =
        detect_scenes(&session, &docs, &tools, &runner, "asset-1", 0.35).expect("detección live");
    let _ = std::fs::remove_dir_all(&root);
    // Cortes esperados en t=2 s (frame 60) y t=5 s (frame 150) a 30 fps.
    assert_eq!(
        result.cuts.iter().map(|cut| cut.frame).collect::<Vec<_>>(),
        vec![60, 150]
    );
}

// ---------------------------------------------------------------------------
// Política de rutas de archivos sueltos (F7): `probe_any_file` y
// `measure_vmaf` reciben rutas absolutas del usuario.
// ---------------------------------------------------------------------------

/// Runner que devuelve un ffprobe JSON enlatado para `run_ffprobe*`.
struct ProbeJsonRunner {
    stdout: String,
}

impl MediaRunner for ProbeJsonRunner {
    fn run_ffmpeg(
        &self,
        _ffmpeg: &Path,
        _args: &[String],
        _cwd: Option<&Path>,
    ) -> Result<Output, ProjectError> {
        unimplemented!()
    }
    fn run_ffprobe(&self, _ffprobe: &Path, _args: &[String]) -> Result<Output, ProjectError> {
        unimplemented!()
    }
    fn run_ffmpeg_with_timeout(
        &self,
        _ffmpeg: &Path,
        _args: &[String],
        _cwd: Option<&Path>,
        _timeout: Duration,
    ) -> Result<Output, ProjectError> {
        unimplemented!()
    }
    fn run_ffprobe_with_timeout(
        &self,
        _ffprobe: &Path,
        _args: &[String],
        _timeout: Duration,
    ) -> Result<Output, ProjectError> {
        Ok(Output {
            status: exit_status(0),
            stdout: self.stdout.clone().into_bytes(),
            stderr: Vec::new(),
        })
    }
    fn ensure_dir(&self, _path: &Path) -> Result<(), ProjectError> {
        Ok(())
    }
    fn file_exists(&self, _path: &Path) -> bool {
        true
    }
    fn remove_file(&self, _path: &Path) {}
}

struct FakeToolsWithProbe {
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
}
impl MediaTools for FakeToolsWithProbe {
    fn ffmpeg_path(&self) -> Option<PathBuf> {
        self.ffmpeg.clone()
    }
    fn ffprobe_path(&self) -> Option<PathBuf> {
        self.ffprobe.clone()
    }
}

const PROBE_JSON: &str = r#"{
    "streams": [
        { "codec_type": "video", "codec_name": "h264", "width": 640, "height": 360 }
    ],
    "format": { "format_name": "mov,mp4", "duration": "2.0", "size": "1024" }
}"#;

fn sensitive_fixture() -> (std::path::PathBuf, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("editoria-probe-policy-{}", uuid::Uuid::new_v4()));
    let ssh = root.join(".ssh");
    std::fs::create_dir_all(&ssh).expect("ssh");
    let key = ssh.join("id_rsa");
    std::fs::write(&key, "CLAVE-FALSA").expect("key");
    (root, key)
}

#[test]
fn probe_any_file_rechaza_rutas_fuera_de_la_politica() {
    let tools = FakeTools { ffmpeg: None };
    let runner = FakeRunner {
        stderr: String::new(),
        ok: true,
        calls: Mutex::new(Vec::new()),
    };
    // Relativa: la política exige absoluta.
    assert!(super::probe_any_file(&tools, &runner, "clip.mp4").is_err());
    // Dentro de credenciales: rechazada aunque el archivo exista.
    let (root, key) = sensitive_fixture();
    let err = super::probe_any_file(&tools, &runner, &key.to_string_lossy())
        .expect_err("ruta con credenciales debe fallar");
    assert!(err.message.contains("credenciales"), "{}", err.message);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn probe_any_file_acepta_archivo_valido_del_usuario() {
    let dir = std::env::temp_dir().join(format!("editoria-probe-ok-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let file = dir.join("clip.mp4");
    std::fs::write(&file, b"fixture").expect("file");
    let tools = FakeToolsWithProbe {
        ffmpeg: Some(PathBuf::from("ffmpeg")),
        ffprobe: Some(PathBuf::from("ffprobe")),
    };
    let runner = ProbeJsonRunner {
        stdout: PROBE_JSON.to_owned(),
    };
    let probe = super::probe_any_file(&tools, &runner, &file.to_string_lossy())
        .expect("archivo válido debe sondearse");
    assert_eq!(probe.video_codec.as_deref(), Some("h264"));
    assert_eq!(probe.width, Some(640));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn measure_vmaf_rechaza_rutas_fuera_de_la_politica() {
    let tools = FakeTools { ffmpeg: None };
    let runner = FakeRunner {
        stderr: String::new(),
        ok: true,
        calls: Mutex::new(Vec::new()),
    };
    // Relativa y credenciales: rechazadas antes de gastar FFmpeg.
    assert!(super::measure_vmaf(&tools, &runner, "a.mp4", "b.mp4").is_err());
    let (root, key) = sensitive_fixture();
    let other = root.join("normal.mp4");
    std::fs::write(&other, b"x").expect("other");
    let err = super::measure_vmaf(
        &tools,
        &runner,
        &key.to_string_lossy(),
        &other.to_string_lossy(),
    )
    .expect_err("original con credenciales debe fallar");
    assert!(err.message.contains("credenciales"), "{}", err.message);
    // Inexistente absoluta: pasa la política y cae en el chequeo de disco.
    let missing = root.join("no-existe.mp4");
    let err = super::measure_vmaf(
        &tools,
        &runner,
        &missing.to_string_lossy(),
        &other.to_string_lossy(),
    )
    .expect_err("inexistente debe fallar");
    assert!(err.message.contains("no están en disco"), "{}", err.message);
    let _ = std::fs::remove_dir_all(&root);
}
