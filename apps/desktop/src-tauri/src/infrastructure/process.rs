//! Utilidades de procesos compartidas por la infraestructura.

use std::io::{self, Read};
use std::process::{Command, ExitStatus, Output};
use std::time::{Duration, Instant};

/// Prepara un proceso externo para que **no parpadee una consola** y para que
/// ceda CPU cuando la persona está editando o usando la IA.
///
/// Los hijos pesados (FFmpeg, yt-dlp, Python, PowerShell) corren en
/// `BELOW_NORMAL_PRIORITY_CLASS`: si no hay contención usan todos los núcleos
/// igual, pero cuando la UI o un modelo local compiten por CPU, el sistema
/// atiende primero a la app. Toda invocación debe pasar por acá antes de
/// `spawn()`/`output()`/`status()`.
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Salida de un subproceso con deadline: equivalente a `Command::output()`
/// pero mata al hijo si no termina a tiempo y drena stdout/stderr en threads
/// para que un pipe lleno no lo bloquee (AUD-008/028).
#[derive(Debug)]
pub struct TimedOutput {
    /// `None` cuando el proceso fue matado por timeout.
    pub status: Option<ExitStatus>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// `true` si se violó el deadline y el proceso fue terminado.
    pub timed_out: bool,
}

impl TimedOutput {
    /// Vista compatible con `std::process::Output` para el camino feliz.
    pub fn into_output(self) -> Option<Output> {
        self.status.map(|status| Output {
            status,
            stdout: self.stdout,
            stderr: self.stderr,
        })
    }
}

/// Límite de stdout+stderr combinado: un proceso que escupe sin parar no
/// debe crecer la memoria de la app sin techo.
const MAX_CAPTURE_BYTES: usize = 64 * 1024 * 1024;

/// Drena una tubería con el tope `MAX_CAPTURE_BYTES`: al llegar al límite se
/// deja de leer (el proceso puede bloquearse escribiendo, pero su salida ya
/// no se usa).
fn drain_capped(pipe: &mut impl Read) -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = pipe.take(MAX_CAPTURE_BYTES as u64).read_to_end(&mut buf);
    buf
}

/// Deadline para procesos que procesan media en proporción a su duración
/// (renders, medición de mezcla): 20× el tiempo realtime de la timeline, con
/// piso de 30 min y techo de 24 h. Un render legítimo raramente supera ~2×
/// realtime de forma sostenida; 20× deja margen enorme y el techo evita
/// esperas eternas en proyectos de varias horas.
pub fn proportional_media_timeout(total_seconds: f64) -> Duration {
    const FACTOR: f64 = 20.0;
    const FLOOR_SECS: f64 = 30.0 * 60.0;
    const CEILING_SECS: f64 = 24.0 * 60.0 * 60.0;
    Duration::from_secs_f64((total_seconds.max(0.0) * FACTOR).clamp(FLOOR_SECS, CEILING_SECS))
}

/// La política de deadlines de análisis vive en `ports::media` (la usan
/// `application` y `commands`); se re-exporta acá para los callers de
/// infraestructura que ya la importaban desde este módulo.
pub use crate::ports::media::{
    proportional_analysis_timeout, MEDIA_PROBE_TIMEOUT, MEDIA_TOOL_CHECK_TIMEOUT,
};

/// Espera al hijo hasta `timeout`, drenando ambas tuberías en paralelo.
/// Si vence el plazo se hace `kill()` y se devuelven las salidas parciales
/// con `timed_out = true` (el caller decide cómo reportarlo).
pub fn output_with_timeout(command: &mut Command, timeout: Duration) -> io::Result<TimedOutput> {
    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let stdout_reader = std::thread::spawn(move || match stdout_pipe.as_mut() {
        Some(pipe) => drain_capped(pipe),
        None => Vec::new(),
    });
    let stderr_reader = std::thread::spawn(move || match stderr_pipe.as_mut() {
        Some(pipe) => drain_capped(pipe),
        None => Vec::new(),
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait()? {
            Some(status) => break Some(status),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            None => std::thread::sleep(Duration::from_millis(40)),
        }
    };

    // Los readers terminan al cerrarse los pipes (proceso muerto o EOF).
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok(TimedOutput {
        status,
        stdout,
        stderr,
        timed_out: status.is_none(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    /// Proceso que no termina solo (~30 s): `ping` de Windows o `sleep` en
    /// unix. Va directo (sin `cmd /c`): matar al wrapper dejaría al hijo
    /// real huérfano con los pipes abiertos y el drain nunca vería EOF.
    fn sleeper() -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        }
    }

    #[test]
    fn un_proceso_que_termina_devuelve_salida_y_exito() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/c", "echo hola"]);
            command
        } else {
            let mut command = Command::new("echo");
            command.arg("hola");
            command
        };
        let started = Instant::now();
        let timed = output_with_timeout(&mut command, Duration::from_secs(30)).expect("spawn");
        assert!(!timed.timed_out);
        let status = timed.status.expect("status");
        assert!(status.success());
        assert!(String::from_utf8_lossy(&timed.stdout).contains("hola"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn un_proceso_lento_se_mata_al_vencer_el_deadline() {
        let mut command = sleeper();
        command.stdin(Stdio::null());
        let started = Instant::now();
        let timed = output_with_timeout(&mut command, Duration::from_millis(300)).expect("spawn");
        assert!(timed.timed_out);
        assert!(timed.status.is_none());
        // El kill tiene que ser rápido: no puede quedar esperando los ~30 s
        // que el proceso iba a tardar.
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn un_proceso_que_falla_devuelve_status_de_error() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/c", "exit /b 3"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "exit 3"]);
            command
        };
        let timed = output_with_timeout(&mut command, Duration::from_secs(30)).expect("spawn");
        assert!(!timed.timed_out);
        let status = timed.status.expect("status");
        #[cfg(windows)]
        assert_eq!(status.code(), Some(3));
        #[cfg(not(windows))]
        assert_eq!(status.code(), Some(3));
    }

    #[test]
    fn el_drenado_esta_topado_en_max_capture_bytes() {
        // 80 MiB de 'A': más que el tope, sin spawnear nada.
        let input = vec![b'A'; MAX_CAPTURE_BYTES + 16 * 1024 * 1024];
        let drained = drain_capped(&mut &input[..]);
        assert_eq!(drained.len(), MAX_CAPTURE_BYTES);
        // Y una entrada corta pasa entera.
        let small = b"hola".as_slice();
        assert_eq!(drain_capped(&mut &small[..]), b"hola");
    }

    #[test]
    fn el_deadline_proporcional_acota_realtime() {
        // Timeline corta: piso de 30 min. Timeline de 1 h: 20× = 20 h.
        // Timeline de 10 h: techo de 24 h.
        assert_eq!(
            proportional_media_timeout(10.0),
            Duration::from_secs(30 * 60)
        );
        assert_eq!(
            proportional_media_timeout(3600.0),
            Duration::from_secs(20 * 3600)
        );
        assert_eq!(
            proportional_media_timeout(10.0 * 3600.0),
            Duration::from_secs(24 * 3600)
        );
        assert_eq!(
            proportional_media_timeout(0.0),
            Duration::from_secs(30 * 60)
        );
    }

    #[test]
    fn el_deadline_de_analisis_es_proporcional_y_acotado() {
        // Clip corto: piso de 2 min. 10 min de medio: 5× = 50 min.
        // 2 h de medio: 5× = 10 h → techo de 3 h. Sin duración: techo.
        assert_eq!(
            proportional_analysis_timeout(10.0),
            Duration::from_secs(120)
        );
        assert_eq!(
            proportional_analysis_timeout(600.0),
            Duration::from_secs(5 * 600)
        );
        assert_eq!(
            proportional_analysis_timeout(2.0 * 3600.0),
            Duration::from_secs(3 * 3600)
        );
        assert_eq!(
            proportional_analysis_timeout(0.0),
            Duration::from_secs(3 * 3600)
        );
        assert_eq!(
            proportional_analysis_timeout(f64::NAN),
            Duration::from_secs(3 * 3600)
        );
    }
}
