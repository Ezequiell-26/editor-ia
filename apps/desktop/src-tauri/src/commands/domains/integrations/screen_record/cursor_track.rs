// Cursor estilizado durante la grabación de pantalla.
//
// Dos piezas:
// - `CursorTracker`: hilo que muestrea `GetCursorPos` + `GetAsyncKeyState`
//   (sólo Windows; en otras plataformas produce una lista vacía).
// - `generate_cursor_ass`: convierte las muestras en un subtitle ASS con el
//   cursor vectorial y los anillos de click, que ffmpeg quema con `ass=`.
//
// Alcance honesto v1: sólo `captureTarget == "desktop"`. Ventana/región
// quedan fuera porque el origen del vídeo respecto al escritorio no siempre
// es trivial de conocer.

// Mutex, Duration, Instant, Arc y Serialize ya están importados por el
// módulo padre (screen_record.rs) que incluye este archivo.
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

pub(crate) use crate::media::cursor_overlay::{
    ass_filter_arg, generate_cursor_ass, ClickKind, CursorOverlaySpec, CursorSample,
};

/// Hilo de muestreo. `finish` lo detiene y devuelve las muestras.
pub struct CursorTracker {
    stop: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<CursorSample>>>,
    handle: Option<JoinHandle<()>>,
}

impl CursorTracker {
    pub fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let samples = Arc::new(Mutex::new(Vec::new()));
        #[cfg(windows)]
        let handle = {
            let (stop_t, samples_t) = (Arc::clone(&stop), Arc::clone(&samples));
            std::thread::Builder::new()
                .name("cursor-track".to_owned())
                .spawn(move || sample_loop(stop_t, samples_t))
                .ok()
        };
        #[cfg(not(windows))]
        let handle: Option<JoinHandle<()>> = None;
        Self {
            stop,
            samples,
            handle,
        }
    }

    pub fn finish(mut self) -> Vec<CursorSample> {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        std::mem::take(&mut *self.samples.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

fn sample_loop(stop: Arc<AtomicBool>, samples: Arc<Mutex<Vec<CursorSample>>>) {
    let started = Instant::now();
    let mut last_pos: Option<(i32, i32)> = None;
    let mut prev_buttons = 0u8;
    while !stop.load(Ordering::Relaxed) {
        let (x, y) = sys::cursor_position();
        let buttons = sys::mouse_buttons();
        let click = rising_click(prev_buttons, buttons);
        let moved = last_pos.map(|p| p != (x, y)).unwrap_or(true);
        if moved || click.is_some() {
            let sample = CursorSample {
                t_ms: started.elapsed().as_millis() as u64,
                x: x as f64,
                y: y as f64,
                click,
            };
            samples
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(sample);
        }
        last_pos = Some((x, y));
        prev_buttons = buttons;
        std::thread::sleep(Duration::from_millis(15));
    }
}

/// Botones recién presionados desde la lectura anterior (orden: izq, der, central).
fn rising_click(prev: u8, now: u8) -> Option<ClickKind> {
    let pressed = now & !prev;
    if pressed & 0b001 != 0 {
        Some(ClickKind::Izquierdo)
    } else if pressed & 0b010 != 0 {
        Some(ClickKind::Derecho)
    } else if pressed & 0b100 != 0 {
        Some(ClickKind::Central)
    } else {
        None
    }
}

#[cfg(windows)]
mod sys {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(pt: *mut Point) -> i32;
        fn GetAsyncKeyState(vkey: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
    }

    pub fn cursor_position() -> (i32, i32) {
        let mut pt = Point { x: 0, y: 0 };
        // SAFETY: GetCursorPos escribe un POINT de 8 bytes en `pt`.
        unsafe {
            GetCursorPos(&mut pt);
        }
        (pt.x, pt.y)
    }

    /// VK_LBUTTON/RBUTTON/MBUTTON = 0x01/0x02/0x04; el bit alto = presionado.
    pub fn mouse_buttons() -> u8 {
        let mut mask = 0u8;
        // SAFETY: GetAsyncKeyState es una consulta sin efectos laterales.
        unsafe {
            if GetAsyncKeyState(0x01) < 0 {
                mask |= 0b001;
            }
            if GetAsyncKeyState(0x02) < 0 {
                mask |= 0b010;
            }
            if GetAsyncKeyState(0x04) < 0 {
                mask |= 0b100;
            }
        }
        mask
    }

    /// Escritorio virtual completo (multi-monitor): origen y tamaño en px.
    /// SM_XVIRTUALSCREEN=76, SM_YVIRTUALSCREEN=77, SM_CXVIRTUALSCREEN=78,
    /// SM_CYVIRTUALSCREEN=79.
    pub fn virtual_screen() -> (i32, i32, i32, i32) {
        // SAFETY: GetSystemMetrics no tiene efectos laterales.
        unsafe {
            (
                GetSystemMetrics(76),
                GetSystemMetrics(77),
                GetSystemMetrics(78),
                GetSystemMetrics(79),
            )
        }
    }
}

#[cfg(not(windows))]
mod sys {
    pub fn cursor_position() -> (i32, i32) {
        (0, 0)
    }
    pub fn mouse_buttons() -> u8 {
        0
    }
    pub fn virtual_screen() -> (i32, i32, i32, i32) {
        (0, 0, 0, 0)
    }
}

#[cfg(test)]
mod cursor_tests {
    use super::*;

    #[test]
    fn rising_click_detecta_pulsaciones() {
        assert_eq!(rising_click(0b000, 0b001), Some(ClickKind::Izquierdo));
        assert_eq!(rising_click(0b001, 0b000), None);
        assert_eq!(rising_click(0b000, 0b011), Some(ClickKind::Izquierdo));
        assert_eq!(rising_click(0b010, 0b110), Some(ClickKind::Central));
        assert_eq!(rising_click(0b111, 0b111), None);
    }
}
