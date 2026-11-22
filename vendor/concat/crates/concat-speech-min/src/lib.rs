// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jareer Abdullah
// SPDX-FileCopyrightText: 2026 Olyvia (extracción y adaptaciones)

//! Transcripción de voz on-device, extraída de `concat-speech` de Concat.
//!
//! - [`transcribe`] - whisper.cpp en proceso (vía `whisper-rs`, que
//!   compila whisper.cpp con cmake en build time) convierte audio en
//!   segmentos de subtítulos con tiempos.
//!
//! Qué se extrajo y qué no: sólo el módulo de transcripción. Chatterbox
//! (TTS vía ONNX Runtime), el aislamiento de voz (DeepFilterNet vía
//! `ort`), la separación de voces y el TTS por voz del sistema quedaron
//! afuera: arrastran `ort`, `tokenizers`, `concat-vision`, `realfft` y
//! `concat-media`, ninguno vendorizable aquí. En su lugar este crate
//! recibe el audio ya decodificado: un WAV (cualquier formato PCM/float
//! que `wav` sepa leer, re-muestreado a 16 kHz mono) o directamente
//! samples `f32` a 16 kHz, que es lo que produce el pipeline FFmpeg de
//! Olyvia.
//!
//! Los modelos se descargan bajo demanda desde el mirror de Concat y
//! Hugging Face a `<modelos>/ggml-<id>.bin`, con progreso y verificación
//! SHA-256. `concat_host::models` se reemplazó por [`download`], una
//! versión reducida sin preferencias de fuente ni proxy explícito.
//! `concat_media::AudioDecoder` se reemplazó por [`wav`] más
//! [`Transcriber::transcribe_samples`].
//!
//! Una sola transcripción y una sola descarga a la vez: [`SingleFlight`]
//! rechaza una segunda corrida concurrente en vez de compartir un flag
//! de cancelación (misma semántica que `concat_host::jobs::SingleFlight`,
//! sin el "keep-awake" del host).

pub mod transcribe;
pub mod wav;

mod download;

pub use download::supply;
pub use transcribe::{Segment, TranscribeRequest, Transcriber, TranscriberStatus};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// How far a transcription or a model download has got, as it reports it:
/// the stage it is in, and in the work itself where it is and where the
/// step under way will leave it. See Concat's `concat-speech` lib.rs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum JobStage {
    /// Reading the sound in.
    Reading,
    /// Loading the model. Not reported when it is still loaded from the
    /// run before.
    Loading,
    /// The work itself.
    Working {
        /// How much of it is finished, `0..=1`.
        done: f32,
        /// Where the step under way ends, `done..=1`.
        next: f32,
    },
}

/// Progress for one model download.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DownloadProgress {
    /// Which model.
    pub id: String,
    /// Bytes received so far.
    pub received: u64,
    /// Content-Length when the server sent one, the table estimate otherwise.
    pub total: u64,
    /// True while an archive is being unpacked - bytes stop moving but the
    /// job is far from done, and the bar should say so.
    pub unpacking: bool,
    /// True on the final report.
    pub done: bool,
}

/// The slot: at most one running job, identified by its own cancel flag.
/// Portado de `concat-host/src/jobs.rs` (SingleFlight), sin `awake`.
pub struct SingleFlight {
    slot: Mutex<Option<Arc<AtomicBool>>>,
}

impl Default for SingleFlight {
    fn default() -> Self {
        Self::new()
    }
}

impl SingleFlight {
    /// An empty slot.
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }

    /// Claims the slot for a new job, or reports the one already running.
    ///
    /// `what` is the user-facing job name ("transcription", "model download", ...).
    pub fn begin(self: &Arc<Self>, what: &str) -> Result<Job, String> {
        let mut slot = self
            .slot
            .lock()
            .map_err(|_| format!("{what} state poisoned"))?;
        if slot.is_some() {
            return Err(format!(
                "a {what} is already running - wait for it or cancel it first"
            ));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *slot = Some(Arc::clone(&cancel));
        Ok(Job {
            owner: Arc::clone(self),
            cancel,
        })
    }

    /// Whether a job currently holds the slot.
    pub fn is_busy(&self) -> bool {
        self.slot.lock().map(|slot| slot.is_some()).unwrap_or(false)
    }

    /// Cancels the running job. Idle is a harmless no-op.
    pub fn cancel(&self) {
        if let Ok(slot) = self.slot.lock()
            && let Some(cancel) = slot.as_ref()
        {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

/// A claim on the slot, released on drop - however the job ended, panic
/// included, the slot frees and the next `begin` succeeds.
pub struct Job {
    owner: Arc<SingleFlight>,
    cancel: Arc<AtomicBool>,
}

impl Job {
    /// This run's stop flag, for the worker to poll.
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    /// An owned handle on the same flag, for callbacks that outlive borrows
    /// of the job (an FFI progress callback must be `'static`).
    pub fn cancel_handle(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }

    /// Whether this run has been asked to stop.
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.owner.slot.lock() {
            // Release only our own claim.
            if slot
                .as_ref()
                .is_some_and(|flag| Arc::ptr_eq(flag, &self.cancel))
            {
                *slot = None;
            }
        }
    }
}
