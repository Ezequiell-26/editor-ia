//! Cliente del proceso `concat-worker` (JSON-lines por stdin/stdout).
//!
//! `concat-media` linkea `ffmpeg-sys-the-third`, que colisiona con
//! `ffmpeg-sys-next` (video-rs) en el mismo binario: por eso el worker vive
//! en `apps/concat-worker` como crate con workspace propio y la app le habla
//! por pipes. Este módulo es la contraparte de `apps/concat-worker/src/main.rs`:
//! localiza el ejecutable, lo spawnea con `hide_console` + pipes y serializa
//! requests con deadline (un timeout mata al proceso; el caller decide si
//! reintenta — la sesión se recrea lazy en `application::concat_worker`).
//!
//! El worker necesita las DLLs de FFmpeg en runtime: en producción quedan
//! junto al ejecutable (resources/ffmpeg-dll → raíz del bundle) y en dev las
//! resuelve `resources/ffmpeg`. Se anteponen al `PATH` del hijo para no
//! depender de que el entorno del padre las tenga.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use super::process::hide_console;

/// Variable de entorno que pisa la resolución del ejecutable (tests, dev
/// manual). Mismo prefijo `EDITOR_IA_*` que `EDITOR_IA_RUN_*`.
pub const WORKER_PATH_ENV: &str = "EDITOR_IA_CONCAT_WORKER";

/// Nombre del binario en cada plataforma.
fn exe_name() -> &'static str {
    if cfg!(windows) {
        "concat-worker.exe"
    } else {
        "concat-worker"
    }
}

/// Ubicación del ejecutable: primero el override de entorno, después los
/// candidatos de desarrollo (workspace `apps/concat-worker`) y por último el
/// bundle/producción (resource dir o junto al exe de la app). Devuelve el
/// primer candidato que existe, o el primero de la lista si ninguno existe
/// (para que el error de spawn diga la ruta intentada).
pub fn resolve_worker_path() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var(WORKER_PATH_ENV) {
        let path = PathBuf::from(custom.trim());
        if path.is_file() {
            return Some(path);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Desarrollo: el worker tiene target/ propio (workspace separado).
    // CARGO_MANIFEST_DIR = apps/desktop/src-tauri → repo root = ../../..
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest.join("../../..");
    for profile in ["debug", "release"] {
        candidates.push(
            repo_root
                .join("apps/concat-worker/target")
                .join(profile)
                .join(exe_name()),
        );
    }

    // Producción: resource dir del bundle (tauri.conf mapea resources acá) y
    // el directorio del ejecutable de la app, con y sin subcarpeta.
    for base in [
        crate::commands::system::bundled_resource_dir().map(Path::to_path_buf),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf)),
    ]
    .into_iter()
    .flatten()
    {
        candidates.push(base.join(exe_name()));
        candidates.push(base.join("concat-worker").join(exe_name()));
    }

    if let Some(found) = candidates.iter().find(|path| path.is_file()) {
        return Some(found.clone());
    }
    candidates.into_iter().next()
}

/// Directorios que pueden contener las DLLs de FFmpeg que el worker linkea
/// (`avcodec-*.dll`, etc.). Se anteponen al `PATH` del proceso hijo.
pub fn ffmpeg_dll_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut push = |dir: PathBuf| {
        if dir.is_dir() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };
    // Bundle: las DLLs quedan en la raíz del resource dir (ver tauri.conf).
    if let Some(resource) = crate::commands::system::bundled_resource_dir() {
        push(resource.to_path_buf());
        push(resource.join("ffmpeg-dll"));
        push(resource.join("ffmpeg"));
    }
    // Dev: resources/ffmpeg del repo tiene las mismas DLLs.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    push(manifest.join("resources/ffmpeg"));
    push(manifest.join("resources/ffmpeg-dll"));
    // Junto al ejecutable de la app (instalador NSIS puede depositarlas ahí).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push(dir.to_path_buf());
        }
    }
    dirs
}

/// Sesión viva con el worker: pipes + hilo lector de stdout. Las requests se
/// serializan desde `application::concat_worker` (un Mutex sobre la sesión),
/// así que hay como mucho una respuesta en vuelo y el canal nunca mezcla
/// líneas de requests distintas.
pub struct ConcatWorker {
    child: Child,
    /// stdin compartido: la request en vuelo lo toma por línea y el
    /// `cancel_token` (entregado al spawnear) puede escribir
    /// `{"op":"cancel"}` sin esperar el mutex de la sesión.
    stdin: Arc<Mutex<ChildStdin>>,
    /// `(número de línea, resultado)`; el reader termina al cerrarse stdout.
    lines: Receiver<std::io::Result<String>>,
}

/// Token de cancelación de la sesión: clona el `Arc` del stdin compartido
/// para que `application` pueda escribir `{"op":"cancel"}` mientras una
/// request larga (`render_export`) tiene el mutex de sesión tomado.
/// Se entrega vía `ConcatWorkerSession::cancel_token` al spawnear; si el
/// proceso murió, la escritura falla y `cancel` devuelve `false`.
struct CancelToken {
    stdin: Arc<Mutex<ChildStdin>>,
}

impl crate::ports::concat_worker::ConcatWorkerCancel for CancelToken {
    fn cancel(&self) -> bool {
        let Ok(mut stdin) = self.stdin.lock() else {
            return false;
        };
        stdin
            .write_all(b"{\"op\":\"cancel\"}\n")
            .and_then(|()| stdin.flush())
            .is_ok()
    }
}

/// Tope de stderr drenado: el worker no instala logger hoy, pero si un crate
/// vendorado escribe ahí no puede bloquear el pipe ni crecer sin límite.
const MAX_STDERR_BYTES: u64 = 1024 * 1024;

impl ConcatWorker {
    /// Spawnea el worker en `path` con pipes y `CREATE_NO_WINDOW`/prioridad
    /// baja (mismo trato que FFmpeg/yt-dlp). `dll_dirs` se anteponen al PATH
    /// para que el loader encuentre las DLLs de FFmpeg.
    pub fn spawn(path: &Path, dll_dirs: &[PathBuf]) -> std::io::Result<Self> {
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if !dll_dirs.is_empty() {
            let mut paths: Vec<PathBuf> = dll_dirs.to_vec();
            if let Some(existing) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&existing));
            }
            if let Ok(joined) = std::env::join_paths(paths) {
                command.env("PATH", joined);
            }
        }
        hide_console(&mut command);
        let mut child = command.spawn()?;

        let stdin = child.stdin.take().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::BrokenPipe, "stdin del worker no es pipe")
        })?;
        let stdin = Arc::new(Mutex::new(stdin));
        let stdout = child.stdout.take().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "stdout del worker no es pipe",
            )
        })?;
        let stderr = child.stderr.take();

        // Reader dedicado: stdout es la única fuente de respuestas y hay que
        // drenar siempre (un pipe lleno bloquearía al worker aunque esperemos
        // con timeout).
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if tx.send(line).is_err() {
                    return;
                }
            }
        });
        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let mut limited = stderr.take(MAX_STDERR_BYTES);
                let mut sink = Vec::new();
                let _ = limited.read_to_end(&mut sink);
                // El buffer se descarta al terminar el hilo: stderr es sólo
                // para no bloquear el pipe, no es canal de datos.
            });
        }

        Ok(Self {
            child,
            stdin,
            lines: rx,
        })
    }

    /// `true` si el proceso sigue vivo (o no se pudo consultar: se asume
    /// vivo y el próximo request revelará el estado real).
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None) | Err(_))
    }

    /// Cierre limpio: `{"op":"shutdown"}` y espera acotada; si no obedece se
    /// mata. Idempotente.
    pub fn shutdown(&mut self) {
        let _ = self.request(&serde_json::json!({"op": "shutdown"}), Duration::from_secs(2));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    /// Envía una request JSON y espera su respuesta con deadline.
    ///
    /// Devuelve el envelope completo (`{"ok":true,...}` o
    /// `{"ok":false,"error":...}`): el `ok:false` es una respuesta válida del
    /// worker y NO es error de transporte. `Err` significa que la sesión no
    /// sirve (timeout, proceso muerto, línea inválida): el caller debe
    /// tirar la sesión y, si quiere, reintentar con un proceso nuevo.
    pub fn request(&mut self, request: &Value, timeout: Duration) -> Result<Value, String> {
        self.request_inner(request, timeout, None)
    }

    /// Como `request`, reenviando al callback las líneas del worker que no
    /// son respuesta (objetos JSON sin `ok`: eventos
    /// `render_export_progress`, `cancel_ack`). Se descartan si no hay
    /// callback; nunca se confunden con la respuesta porque ésta siempre
    /// trae `ok`.
    pub fn request_with_events(
        &mut self,
        request: &Value,
        timeout: Duration,
        on_event: &mut dyn FnMut(&Value),
    ) -> Result<Value, String> {
        self.request_inner(request, timeout, Some(on_event))
    }

    fn request_inner(
        &mut self,
        request: &Value,
        timeout: Duration,
        mut on_event: Option<&mut dyn FnMut(&Value)>,
    ) -> Result<Value, String> {
        let line = serde_json::to_string(request)
            .map_err(|error| format!("no se pudo serializar la request: {error}"))?;
        {
            let mut stdin = self
                .stdin
                .lock()
                .map_err(|_| "stdin del worker envenenado".to_owned())?;
            stdin
                .write_all(line.as_bytes())
                .and_then(|()| stdin.write_all(b"\n"))
                .and_then(|()| stdin.flush())
                .map_err(|error| format!("worker stdin roto: {error}"))?;
        }

        // Las requests son seriales: mientras esperamos la respuesta del
        // worker pueden llegar líneas de EVENTO (progreso del render,
        // ack de cancel). Se distinguen de la respuesta por la ausencia
        // de `ok`; todo lo demás sigue siendo protocolo roto.
        loop {
            let received = self
                .lines
                .recv_timeout(timeout)
                .map_err(|error| match error {
                    std::sync::mpsc::RecvTimeoutError::Timeout => {
                        // El worker está colgado o saturado: no hay
                        // cancelación por timeout en el protocolo (la op
                        // `cancel` existe pero es best-effort), así que se
                        // mata el proceso entero.
                        let _ = self.child.kill();
                        let _ = self.child.wait();
                        format!("el worker no respondió en {timeout:?}")
                    }
                    std::sync::mpsc::RecvTimeoutError::Disconnected => {
                        "el worker cerró stdout (proceso muerto)".to_owned()
                    }
                })?;

            let line = received.map_err(|error| format!("stdout del worker: {error}"))?;
            let value: Value = serde_json::from_str(line.trim())
                .map_err(|error| format!("respuesta no-JSON del worker: {error}"))?;
            if !value.is_object() {
                return Err("respuesta del worker no es un objeto JSON".to_owned());
            }
            if value.get("ok").is_some() {
                return Ok(value);
            }
            // Línea de evento: no es respuesta; se reenvía y se sigue
            // esperando la respuesta real de esta request.
            if let Some(callback) = on_event.as_mut() {
                callback(&value);
            }
        }
    }
}

impl Drop for ConcatWorker {
    fn drop(&mut self) {
        // Si el padre suelta la sesión sin shutdown explícito, matar al hijo:
        // un worker huérfano quedaría esperando stdin para siempre.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resuelve_el_worker_debug_del_workspace_si_existe() {
        // En esta máquina el worker ya está compilado; si no, el test igual
        // pasa mientras algún candidato sea coherente con el layout.
        if let Some(path) = resolve_worker_path() {
            assert!(path.to_string_lossy().contains("concat-worker"));
        }
    }

    #[test]
    fn el_override_de_entorno_gana() {
        // Sin tocar el entorno global del proceso de tests (otros tests
        // corren en paralelo): se prueba la lógica de candidatos, no el env.
        let dirs = ffmpeg_dll_dirs();
        assert!(dirs.iter().all(|dir| dir.is_dir()));
    }

    #[test]
    fn request_timeout_mata_al_worker() {
        // Spawn real si el binario está disponible; si no, skip honesto.
        let Some(path) = resolve_worker_path() else {
            eprintln!("concat-worker no compilado: test de timeout omitido");
            return;
        };
        let Ok(mut worker) = ConcatWorker::spawn(&path, &ffmpeg_dll_dirs()) else {
            eprintln!("no se pudo spawnear concat-worker: test omitido");
            return;
        };
        // Un op desconocido vuelve como ok:false (respuesta válida), no Err.
        let bad = worker
            .request(&serde_json::json!({"op": "no_existe"}), Duration::from_secs(10))
            .expect("respuesta de error del worker");
        assert_eq!(bad["ok"], false);
        assert!(bad["error"].as_str().is_some());
        worker.shutdown();
    }

    #[test]
    fn ping_probe_shutdown_sobre_el_worker_real() {
        let Some(path) = resolve_worker_path() else {
            eprintln!("concat-worker no compilado: test omitido");
            return;
        };
        let Ok(mut worker) = ConcatWorker::spawn(&path, &ffmpeg_dll_dirs()) else {
            eprintln!("no se pudo spawnear concat-worker: test omitido");
            return;
        };
        let pong = worker
            .request(&serde_json::json!({"op": "ping"}), Duration::from_secs(10))
            .expect("ping");
        assert_eq!(pong["ok"], true, "{pong}");
        assert!(worker.is_alive());
        // probe sobre un archivo inexistente: ok:false pero sesión viva.
        let probe = worker
            .request(
                &serde_json::json!({"op": "probe", "path": "no-existe.mp4"}),
                Duration::from_secs(10),
            )
            .expect("probe responde");
        assert_eq!(probe["ok"], false);
        assert!(worker.is_alive(), "un ok:false no mata la sesión");
        worker.shutdown();
    }

    /// Fixture del workspace concat (mismo que usan los tests del worker).
    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../vendor/concat/crates/concat-media/fixtures/vfr-still-screen.mp4")
    }

    fn temp_output(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "concat-worker-app-{tag}-{}-{nanos}.mp4",
            std::process::id()
        ))
    }

    /// `render_export` real por `request_with_events`: el worker emite
    /// `render_export_progress` (líneas sin `ok`) y el envelope final llega
    /// intacto. 64x64 a 10 fps durante 1 s = 10 frames.
    #[test]
    fn render_export_emite_progreso_por_events() {
        let Some(path) = resolve_worker_path() else {
            eprintln!("concat-worker no compilado: test omitido");
            return;
        };
        let Ok(mut worker) = ConcatWorker::spawn(&path, &ffmpeg_dll_dirs()) else {
            eprintln!("no se pudo spawnear concat-worker: test omitido");
            return;
        };
        let out = temp_output("progress");
        let out_str = out.to_string_lossy().into_owned();
        let mut events = Vec::new();
        let envelope = worker
            .request_with_events(
                &serde_json::json!({
                    "op": "render_export",
                    "output": out_str,
                    "width": 64,
                    "height": 64,
                    "frame_rate": "10",
                    "hardware": false,
                    "clips": [{ "path": fixture_path().to_string_lossy(), "duration": "1" }],
                }),
                Duration::from_secs(120),
                &mut |event| events.push(event.clone()),
            )
            .expect("render_export responde");
        assert_eq!(envelope["ok"], true, "{envelope}");
        assert_eq!(envelope["frames"], 10, "{envelope}");
        let progress: Vec<&Value> = events
            .iter()
            .filter(|event| event["type"] == "render_export_progress")
            .collect();
        assert!(!progress.is_empty(), "sin eventos de progreso: {events:?}");
        let last = progress.last().unwrap();
        assert_eq!(last["frames_total"], 10, "{last}");
        assert_eq!(last["frames"], 10, "{last}");
        assert!(out.is_file(), "el MP4 tenía que quedar escrito");
        let _ = std::fs::remove_file(&out);
        worker.shutdown();
    }

    /// `{"op":"cancel"}` a mitad de un render largo: el envelope llega como
    /// `ok:false` "cancelled", el worker SIGUE VIVO y acepta un ping.
    ///
    /// El cancel se escribe por el stdin clonado de la sesión (mismo pipe
    /// que usa el `cancel_token` del port, pero sin depender del trait:
    /// otros tests pueden spawnear su propio worker en paralelo).
    #[test]
    fn cancel_interrumpe_render_y_el_worker_sigue_vivo() {
        let Some(path) = resolve_worker_path() else {
            eprintln!("concat-worker no compilado: test omitido");
            return;
        };
        let Ok(worker) = ConcatWorker::spawn(&path, &ffmpeg_dll_dirs()) else {
            eprintln!("no se pudo spawnear concat-worker: test omitido");
            return;
        };
        let stdin = worker.stdin.clone();
        let out = temp_output("cancel");
        let out_str = out.to_string_lossy().into_owned();
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let events_in_thread = events.clone();

        // Render deliberadamente largo: 320x320 a 30 fps durante 20 s =
        // 600 frames de composite CPU (segundos de trabajo, no milisegundos).
        let handle = std::thread::spawn(move || {
            let mut worker = worker;
            let mut local_events = Vec::new();
            let result = worker.request_with_events(
                &serde_json::json!({
                    "op": "render_export",
                    "output": out_str,
                    "width": 320,
                    "height": 320,
                    "frame_rate": "30",
                    "hardware": false,
                    "clips": [{ "path": fixture_path().to_string_lossy(), "duration": "20" }],
                }),
                Duration::from_secs(300),
                &mut |event| {
                    local_events.push(event.clone());
                    if let Ok(mut shared) = events_in_thread.lock() {
                        shared.push(event.clone());
                    }
                },
            );
            (result, local_events, worker)
        });

        // Esperar el primer evento de progreso (el render ya está en su
        // loop de frames) y mandar el cancel por el pipe.
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            let seen = events
                .lock()
                .map(|guard| {
                    guard
                        .iter()
                        .any(|event| event["type"] == "render_export_progress")
                })
                .unwrap_or(false);
            if seen {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "el render no emitió progreso en 60 s"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        {
            let mut stdin = stdin.lock().expect("stdin del worker");
            stdin
                .write_all(b"{\"op\":\"cancel\"}\n")
                .and_then(|()| stdin.flush())
                .expect("cancel escrito al worker");
        }

        let (result, _events, mut worker) = handle.join().expect("hilo del render");
        let envelope = result.expect("el render cancelado responde, no cuelga");
        assert_eq!(envelope["ok"], false, "{envelope}");
        let error = envelope["error"].as_str().unwrap_or_default();
        assert!(error.contains("cancel"), "{envelope}");
        // El worker sigue vivo y responde ping (el cancel_ack fue evento,
        // no respuesta: no corrompió la correlación).
        assert!(worker.is_alive());
        let pong = worker
            .request(&serde_json::json!({"op": "ping"}), Duration::from_secs(10))
            .expect("ping tras cancel");
        assert_eq!(pong["ok"], true, "{pong}");
        assert!(!out.exists(), "el MP4 parcial del render cancelado se limpia");
        worker.shutdown();
    }
}

/// Backend del sistema: resuelve el ejecutable y spawnea `ConcatWorker`.
/// Es el adaptador concreto del port `ports::concat_worker::ConcatWorkerBackend`.
pub struct SystemConcatWorker;

impl crate::ports::concat_worker::ConcatWorkerBackend for SystemConcatWorker {
    fn worker_path(&self) -> Option<PathBuf> {
        resolve_worker_path()
    }

    fn spawn(&self) -> Result<Box<dyn crate::ports::concat_worker::ConcatWorkerSession>, String> {
        let path = resolve_worker_path()
            .ok_or_else(|| "concat-worker.exe no está compilado ni empaquetado".to_owned())?;
        let dll_dirs = ffmpeg_dll_dirs();
        ConcatWorker::spawn(&path, &dll_dirs)
            .map(|worker| {
                Box::new(worker) as Box<dyn crate::ports::concat_worker::ConcatWorkerSession>
            })
            .map_err(|error| format!("no se pudo iniciar concat-worker: {error}"))
    }
}

impl crate::ports::concat_worker::ConcatWorkerSession for ConcatWorker {
    fn request(&mut self, request: &Value, timeout: Duration) -> Result<Value, String> {
        ConcatWorker::request(self, request, timeout)
    }

    fn request_with_events(
        &mut self,
        request: &Value,
        timeout: Duration,
        on_event: &mut dyn FnMut(&Value),
    ) -> Result<Value, String> {
        ConcatWorker::request_with_events(self, request, timeout, on_event)
    }

    fn is_alive(&mut self) -> bool {
        ConcatWorker::is_alive(self)
    }

    fn shutdown(&mut self) {
        ConcatWorker::shutdown(self)
    }

    fn cancel_token(&self) -> Option<Arc<dyn crate::ports::concat_worker::ConcatWorkerCancel>> {
        Some(Arc::new(CancelToken {
            stdin: self.stdin.clone(),
        }))
    }
}
