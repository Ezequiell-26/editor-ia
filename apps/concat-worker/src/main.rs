// SPDX-License-Identifier: AGPL-3.0-or-later
// Concat es AGPL-3.0-or-later (ver vendor/concat/LICENSE).

//! concat-worker: binario standalone que habla JSON-lines por stdin/stdout.
//!
//! La app de escritorio lo invoca como proceso hijo (pipes) y le manda una
//! request por línea. `windows_subsystem = "windows"` evita que abra una
//! consola propia: el padre la crea con `CREATE_NO_WINDOW` o pipes sin
//! consola y el worker nunca flashea una ventana. stdin/stdout siguen
//! siendo pipes normales — el subsystem sólo cambia si hay consola
//! interactiva.
//!
//! Dos clases de línea por stdout:
//! - RESPUESTAS: el envelope `{"ok": ...}` de cada request (una por
//!   request, en orden de llegada — las requests son seriales del lado
//!   del cliente).
//! - EVENTOS: líneas JSON sin `ok` que no son respuesta de ninguna
//!   request: hoy `render_export_progress` (emitidas por el hilo del
//!   render) y `cancel_ack` (ack del `{"op":"cancel"}`). Un cliente viejo
//!   que no las espera las ve como líneas extra entre respuestas; el
//!   cliente actual las distingue por la ausencia de `ok`.
//!
//! `render_export` corre en su propio hilo: puede tardar minutos y el
//! loop principal tiene que seguir leyendo stdin para atender `cancel`
//! (y ops rápidas como `ping`). El flag de cancelación vive en
//! `render_export.rs`; el render lo consulta por frame y entre fases.

#![windows_subsystem = "windows"]

mod analyze_motion;
mod ops;
mod protocol;
mod render_export;
mod transitions;

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;

/// Serializa TODAS las escrituras a stdout: el hilo del `render_export` en
/// curso emite progreso y su respuesta final mientras el loop principal
/// responde otras ops. Sin este mutex dos hilos podrían entrelazar bytes
/// de líneas distintas.
static STDOUT_LOCK: Mutex<()> = Mutex::new(());

/// `true` mientras una op larga (`render_export` o `analyze_motion`)
/// corre en su hilo. Una segunda op larga se rechaza con `ok:false` en
/// vez de mezclarse: el canal de eventos es único y dos renders
/// concurrentes harían ambiguas las respuestas.
static LONG_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Qué op larga corre ahora mismo, para el `target` del `cancel_ack`:
/// 0 = ninguna, 1 = `render_export`, 2 = `analyze_motion`.
static LONG_OP_KIND: AtomicU8 = AtomicU8::new(0);

/// Escribe una línea JSON a stdout (respuesta o evento). Devuelve `false`
/// si el pipe está roto o el encode falla: el caller debe cortar el loop
/// (el padre murió, seguir es inútil).
fn write_line(value: &serde_json::Value) -> bool {
    // Si el mutex está envenenado (un panic ajeno escribiendo) se sigue:
    // una línea perdida es mejor que un worker mudo.
    let _guard = STDOUT_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let Ok(encoded) = protocol::encode(value) else {
        return false;
    };
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    lock.write_all(encoded.as_bytes()).is_ok()
        && lock.write_all(b"\n").is_ok()
        && lock.flush().is_ok()
}

fn main() {
    let stdin = std::io::stdin();

    for line in stdin.lock().lines() {
        // EOF o error de lectura: el padre cerró el pipe, salimos.
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let request = match protocol::parse(line) {
            Ok(request) => request,
            Err(error) => {
                if !write_line(&protocol::respond(Err(error))) {
                    break;
                }
                continue;
            }
        };

        // `cancel` no pasa por `ops::dispatch`: el render corre en otro
        // hilo y el flag es global al proceso. El ack es un EVENTO (sin
        // `ok`): si respondiera `{"ok":true}` el cliente en vuelo lo
        // confundiría con la respuesta del render que sigue corriendo.
        if matches!(request, protocol::Request::Cancel) {
            render_export::request_cancel();
            // El flag de cancelación es compartido por las ops largas;
            // el `target` dice cuál está corriendo (si hay una).
            let target = match LONG_OP_KIND.load(Ordering::SeqCst) {
                1 => "render_export",
                2 => "analyze_motion",
                _ => "none",
            };
            if !write_line(&serde_json::json!({
                "type": "cancel_ack",
                "target": target,
            })) {
                break;
            }
            continue;
        }

        // Las ops largas (`render_export`, `analyze_motion`) pueden tardar
        // minutos: corren en su hilo para que este loop siga leyendo
        // `cancel` y el resto de las ops. La respuesta la escribe el hilo
        // al terminar (mismo `write_line` serializado), así que el orden
        // request→response se mantiene: hay como mucho una op larga.
        let long_op = match &request {
            protocol::Request::RenderExport(_) => Some((1u8, "render_export")),
            protocol::Request::AnalyzeMotion(_) => Some((2u8, "analyze_motion")),
            _ => None,
        };
        if let Some((kind, op_name)) = long_op {
            if LONG_ACTIVE.swap(true, Ordering::SeqCst) {
                let busy = protocol::respond(Err(format!("un {op_name} ya está en curso")));
                if !write_line(&busy) {
                    break;
                }
                continue;
            }
            LONG_OP_KIND.store(kind, Ordering::SeqCst);
            let request = request.clone();
            std::thread::spawn(move || {
                let result = match request {
                    protocol::Request::RenderExport(export) => {
                        render_export::run_with_progress(&export, &mut |event| {
                            // Un evento que no se puede escribir (padre
                            // muerto) no aborta el render: la respuesta
                            // final también fallará y el proceso saldrá
                            // por EOF de stdin.
                            let _ = write_line(event);
                        })
                    }
                    protocol::Request::AnalyzeMotion(request) => {
                        analyze_motion::run_with_progress(&request, &mut |event| {
                            let _ = write_line(event);
                        })
                    }
                    _ => unreachable!("long_op solo matchea ops largas"),
                };
                LONG_ACTIVE.store(false, Ordering::SeqCst);
                LONG_OP_KIND.store(0, Ordering::SeqCst);
                let _ = write_line(&protocol::respond(result));
            });
            continue;
        }

        let shutdown = matches!(request, protocol::Request::Shutdown);
        let response = protocol::respond(ops::dispatch(&request));
        if !write_line(&response) {
            break;
        }
        if shutdown {
            break;
        }
    }
    // Si había un render en su hilo, el proceso sale igual: el hilo es
    // daemon en la práctica (main retorna → exit). El padre ya cerró
    // stdin o pidió shutdown; el MP4 parcial lo limpia el Drop/timeout.
}
