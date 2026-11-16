//! Casos de uso del `concat-worker`: sesión persistente, ops permitidas y
//! mapeo a `ProjectError` para los comandos IPC.
//!
//! El proceso vive en `infrastructure::concat_worker` (pipes JSON-lines);
//! acá está la sesión global perezosa, la allowlist de ops y la validación
//! mínima por op.
//!
//! Progreso y cancelación del `render_export`: el worker emite líneas de
//! EVENTO (JSON sin `ok`) por stdout mientras el render corre en su hilo;
//! `request_with_events` las reenvía al caller, que las publica como evento
//! Tauri. `cancel_render` escribe `{"op":"cancel"}` directo al stdin del
//! proceso vía el `ConcatWorkerCancel` token que la sesión entrega al
//! spawnear —no puede ir por `request` porque el mutex de sesión está
//! tomado por el render en vuelo— y el worker aborta en el próximo frame
//! o cambio de fase respondiendo `ok:false` ("render_export cancelled"),
//! quedando vivo para las próximas requests. Vencer el timeout sigue
//! siendo el último recurso: mata al proceso y obliga a respawnear.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::ports::concat_worker::{
    ConcatWorkerBackend, ConcatWorkerCancel, ConcatWorkerSession,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Ops que el worker implementa hoy (`apps/concat-worker/src/protocol.rs`).
pub const WORKER_OPS: &[&str] = &[
    "ping",
    "probe",
    "decode_frame",
    "render_export",
    "shutdown",
];

/// Default y techo del timeout por request. `probe`/`decode_frame` sobre
/// archivos grandes pueden tardar; el techo evita esperas eternas (a
/// diferencia, el timeout mata al worker entero — no hay cancelación fina).
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MIN_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatWorkerStatus {
    /// `true` si el ejecutable se encontró en disco (no implica que corra).
    pub available: bool,
    /// Ruta resuelta del binario, si existe.
    pub path: Option<String>,
    /// Por qué no está disponible, cuando `available` es false.
    pub reason: Option<String>,
    /// Ops implementadas por el protocolo actual.
    pub ops: Vec<String>,
    /// `true` si hay un proceso hijo vivo ahora mismo.
    pub running: bool,
}

fn session() -> &'static Mutex<Option<Box<dyn ConcatWorkerSession>>> {
    static SESSION: OnceLock<Mutex<Option<Box<dyn ConcatWorkerSession>>>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(None))
}

/// Token de cancelación de la sesión viva. Vive en un mutex APARTE del de
/// sesión a propósito: `cancel_render` puede correr mientras una request
/// (`render_export`) tiene el mutex de sesión tomado. Se pisa en cada
/// spawn y se limpia cuando la sesión se descarta.
fn cancel_token() -> &'static Mutex<Option<Arc<dyn ConcatWorkerCancel>>> {
    static TOKEN: OnceLock<Mutex<Option<Arc<dyn ConcatWorkerCancel>>>> = OnceLock::new();
    TOKEN.get_or_init(|| Mutex::new(None))
}

fn set_cancel_token(token: Option<Arc<dyn ConcatWorkerCancel>>) {
    if let Ok(mut guard) = cancel_token().lock() {
        *guard = token;
    }
}

/// Estado del worker sin tocarlo: resolución del ejecutable + sesión viva.
pub fn status(backend: &dyn ConcatWorkerBackend) -> ConcatWorkerStatus {
    let path = backend.worker_path();
    let available = path.as_ref().is_some_and(|p| p.is_file());
    let running = session()
        .lock()
        .ok()
        .and_then(|mut guard| guard.as_mut().map(|worker| worker.is_alive()))
        .unwrap_or(false);
    ConcatWorkerStatus {
        available,
        path: path.map(|p| p.to_string_lossy().into_owned()),
        reason: if available {
            None
        } else {
            Some("concat-worker.exe no está compilado ni empaquetado".to_owned())
        },
        ops: WORKER_OPS.iter().map(|op| op.to_string()).collect(),
        running,
    }
}

fn unavailable() -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        "concat-worker no está disponible: compilalo con `cargo build` en apps/concat-worker o reinstalá la app",
    )
}

fn transport_error(detail: &str) -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::Io,
        &format!("el concat-worker falló: {detail}"),
    )
}

/// Spawnea (o re-spawnea) la sesión. El caller ya tiene el mutex tomado.
fn ensure_worker(
    guard: &mut Option<Box<dyn ConcatWorkerSession>>,
    backend: &dyn ConcatWorkerBackend,
) -> Result<(), ProjectError> {
    // Si hay sesión pero el proceso murió (crash, kill por timeout previo),
    // se descarta antes de reintentar: la respuesta en vuelo nunca se pierde
    // porque las requests son seriales.
    let alive = guard
        .as_mut()
        .map(|worker| worker.is_alive())
        .unwrap_or(false);
    if !alive {
        *guard = None;
        set_cancel_token(None);
    }
    if guard.is_some() {
        return Ok(());
    }
    match backend.spawn() {
        Ok(worker) => {
            // El token se toma ANTES de que la sesión quede detrás del
            // mutex: es la única vía de cancel mientras una request larga
            // tiene la sesión tomada.
            let token = worker.cancel_token();
            *guard = Some(worker);
            set_cancel_token(token);
            Ok(())
        }
        Err(error) => Err(ProjectError::message(ProjectErrorCode::Io, &error)),
    }
}

/// Valida `op` contra la allowlist y devuelve el request JSON completo.
/// `params` debe ser un objeto (o null): se mezcla con `{"op": ...}`.
pub fn build_request(op: &str, params: &Value) -> Result<Value, ProjectError> {
    if !WORKER_OPS.contains(&op) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("op de concat-worker desconocida: {op}"),
        ));
    }
    if !params.is_object() && !params.is_null() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "los parámetros de concat-worker tienen que ser un objeto",
        ));
    }
    // Los params van primero y `op` se fuerza después: un "op" dentro de
    // params nunca puede reescribir la op validada contra la allowlist.
    let mut request = match params {
        Value::Object(map) => Value::Object(map.clone()),
        _ => json!({}),
    };
    if let Value::Object(ref mut map) = request {
        map.insert("op".to_owned(), json!(op));
    }
    // Validación mínima por op para fallar antes de spawnear el proceso.
    match op {
        "probe" | "decode_frame" => {
            if request["path"].as_str().is_none_or(|p| p.trim().is_empty()) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "falta `path` (archivo de medio)",
                ));
            }
            if op == "decode_frame"
                && (request["time"].as_str().is_none() || request["out"].as_str().is_none())
            {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "decode_frame necesita `time` y `out`",
                ));
            }
        }
        "render_export" => {
            if request["output"].as_str().is_none_or(|p| p.trim().is_empty()) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "render_export necesita `output` (archivo de destino)",
                ));
            }
            let clips_ok = request["clips"].as_array().is_some_and(|clips| {
                !clips.is_empty()
                    && clips.iter().all(|clip| {
                        clip["path"].as_str().is_some_and(|p| !p.trim().is_empty())
                    })
            });
            if !clips_ok {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "render_export necesita `clips` no vacío y cada clip un `path`",
                ));
            }
            // Validación mínima de los campos nuevos del protocolo: el
            // worker valida la semántica completa (tipos xfade conocidos,
            // ventanas disjuntas, speed > 0); acá sólo se exige la forma.
            for clip in request["clips"].as_array().into_iter().flatten() {
                if let Some(transition) = clip.get("transition") {
                    let has = |key: &str| {
                        transition.get(key).is_some_and(|v| !v.is_null())
                    };
                    let ok = transition.is_object()
                        && transition["type"].as_str().is_some_and(|t| !t.trim().is_empty())
                        && !(has("duration") && has("frames"));
                    if !ok {
                        return Err(ProjectError::message(
                            ProjectErrorCode::InvalidProject,
                            "clip `transition` necesita `type` y `duration` o `frames`, no ambos",
                        ));
                    }
                }
                if let Some(speed) = clip.get("speed") {
                    // Número o string (`"2"`, `"3/2"`): el contenido exacto
                    // lo valida el worker; acá sólo el tipo grosero.
                    let ok = speed.is_number() || speed.is_string();
                    if !ok {
                        return Err(ProjectError::message(
                            ProjectErrorCode::InvalidProject,
                            "clip `speed` tiene que ser número o string numérico",
                        ));
                    }
                }
                if let Some(curve) = clip.get("speed_curve") {
                    // Puntos `{at, speed}` numéricos (slope opcional): la
                    // semántica (rangos, curva usable) la valida el worker.
                    let ok = curve.as_array().is_some_and(|points| {
                        !points.is_empty()
                            && points.iter().all(|point| {
                                point.is_object()
                                    && point["at"].is_number()
                                    && point["speed"].is_number()
                                    && point
                                        .get("slope")
                                        .is_none_or(|slope| slope.is_number())
                            })
                    });
                    if !ok {
                        return Err(ProjectError::message(
                            ProjectErrorCode::InvalidProject,
                            "clip `speed_curve` tiene que ser una lista no vacía de {\"at\", \"speed\"[, \"slope\"]} numéricos",
                        ));
                    }
                }
                if let Some(transition) = clip.get("transition") {
                    if let Some(crossfade) = transition.get("audio_crossfade") {
                        if !crossfade.is_boolean() {
                            return Err(ProjectError::message(
                                ProjectErrorCode::InvalidProject,
                                "transition `audio_crossfade` tiene que ser boolean",
                            ));
                        }
                    }
                }
            }
        }
        _ => {}
    }
    Ok(request)
}

fn clamp_timeout(timeout_ms: Option<u64>) -> Duration {
    match timeout_ms {
        Some(ms) => Duration::from_millis(ms.clamp(MIN_TIMEOUT.as_millis() as u64, MAX_TIMEOUT.as_millis() as u64)),
        None => DEFAULT_TIMEOUT,
    }
}

/// Ejecuta una op del worker con sesión persistente y timeout. Devuelve el
/// envelope del worker (con `ok` y payload). Si la sesión murió a mitad de
/// request se descarta y se reintenta UNA vez con proceso nuevo — cubre el
/// caso "worker crasheó" sin duplicar side-effects (las ops son idempotentes
/// en la práctica: probe lee, decode_frame escribe el mismo `out`).
pub fn request(
    backend: &dyn ConcatWorkerBackend,
    op: &str,
    params: &Value,
    timeout_ms: Option<u64>,
) -> Result<Value, ProjectError> {
    request_inner(backend, op, params, timeout_ms, None)
}

/// Como `request`, pero las líneas de EVENTO del worker (objetos JSON sin
/// `ok`: `render_export_progress` durante un render, `cancel_ack` tras un
/// cancel) se reenvían a `on_event` mientras se espera la respuesta. Es la
/// vía del progreso real del `render_export`.
pub fn request_with_events(
    backend: &dyn ConcatWorkerBackend,
    op: &str,
    params: &Value,
    timeout_ms: Option<u64>,
    on_event: &mut dyn FnMut(&Value),
) -> Result<Value, ProjectError> {
    request_inner(backend, op, params, timeout_ms, Some(on_event))
}

fn request_inner(
    backend: &dyn ConcatWorkerBackend,
    op: &str,
    params: &Value,
    timeout_ms: Option<u64>,
    mut on_event: Option<&mut dyn FnMut(&Value)>,
) -> Result<Value, ProjectError> {
    let request = build_request(op, params)?;
    let timeout = clamp_timeout(timeout_ms);

    let mut guard = session()
        .lock()
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "estado interno no disponible"))?;

    for attempt in 0..2 {
        ensure_worker(&mut guard, backend)?;
        // ensure_worker garantiza Some; si el lock está envenenado se llega
        // acá con None sólo si spawn falló (ya devolvió Err).
        let Some(worker) = guard.as_mut() else {
            return Err(unavailable());
        };
        let result = match on_event.as_mut() {
            Some(callback) => worker.request_with_events(&request, timeout, callback),
            None => worker.request(&request, timeout),
        };
        match result {
            Ok(envelope) => return Ok(envelope),
            Err(detail) => {
                // Error de transporte: la sesión ya fue matada por el
                // cliente (timeout) o está rota. Se descarta y, si queda
                // intento, se re-spawnea.
                *guard = None;
                set_cancel_token(None);
                if attempt == 0 && op != "shutdown" {
                    continue;
                }
                return Err(transport_error(&detail));
            }
        }
    }
    unreachable!("el loop siempre devuelve")
}

/// Pide cancelar el `render_export` en curso del worker activo.
///
/// No pasa por `request_inner`: ese camino toma el mutex de sesión, que
/// está tomado por la request del render hasta que responde — cancelar por
/// ahí llegaría tarde o nunca. Acá se usa el `ConcatWorkerCancel` token
/// que la sesión entregó al spawnear (guarda el handle del stdin del
/// proceso, fuera del mutex de sesión).
///
/// Devuelve `true` si la notificación se escribió en el pipe. El render
/// aborta en el próximo frame o cambio de fase y responde
/// `{"ok":false,"error":"render_export cancelled"}`; el worker sigue vivo
/// para las próximas requests. `false` = no había worker o ya no leía.
pub fn cancel_render() -> bool {
    cancel_token()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|token| token.cancel()))
        .unwrap_or(false)
}

/// Cierre ordenado al salir de la app (opcional: el Drop del proceso mata al
/// hijo si no se llama).
pub fn shutdown() {
    if let Ok(mut guard) = session().lock() {
        if let Some(mut worker) = guard.take() {
            worker.shutdown();
        }
    }
    set_cancel_token(None);
}

#[path = "concat_worker.tests.rs"]
#[cfg(test)]
mod tests;
