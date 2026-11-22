use super::*;

#[test]
fn validate_rect_rejects_invalid_and_clamps() {
    assert!(validate_rect(&ObjectTrackRect {
        x: 0.5,
        y: 0.5,
        w: 0.6,
        h: 0.4
    })
    .is_err());
    assert!(validate_rect(&ObjectTrackRect {
        x: -0.2,
        y: 0.0,
        w: 0.3,
        h: 0.3
    })
    .is_err());
    assert!(validate_rect(&ObjectTrackRect {
        x: 0.8,
        y: 0.0,
        w: 0.4,
        h: 0.3
    })
    .is_err());
    let ok = validate_rect(&ObjectTrackRect {
        x: 0.8,
        y: 0.0,
        w: 0.15,
        h: 0.3,
    })
    .unwrap();
    assert!((ok.w - 0.15).abs() < 1e-9);
}

#[test]
fn ncc_scores_identical_patch_high() {
    let patch: Vec<f32> = (0..64).map(|i| (i % 8) as f32).collect();
    let (template, norm) = centered_template(&patch);
    let score = ncc_centered(&template, norm, &patch);
    assert!(score > 0.99, "score={score}");
    let shifted: Vec<f32> = (0..64).map(|i| ((i + 3) % 8) as f32).collect();
    let score2 = ncc_centered(&template, norm, &shifted);
    assert!(score2 < score);
}

/// Genera frames rgb24 sintéticos con un cuadrado blanco que se mueve y
/// crece sobre fondo negro — ejercicio real de track_frames. El cuadrado
/// es más chico que la semilla para que el template tenga borde (un patch
/// uniforme tiene norma ~0 y el NCC no es válido).
fn synthetic_frames(count: usize, width: u32, height: u32, grow: f64) -> Vec<Vec<u8>> {
    let mut frames = Vec::with_capacity(count);
    for index in 0..count {
        let mut frame = vec![0u8; (width * height * 3) as usize];
        let side = (12.0 * (1.0 + grow * index as f64)) as u32;
        let cx = 36 + index as u32 * 2;
        let cy = 34;
        for row in 0..side {
            for col in 0..side {
                let x = cx + col;
                let y = cy + row;
                if x < width && y < height {
                    let base = ((y * width + x) * 3) as usize;
                    frame[base] = 240;
                    frame[base + 1] = 240;
                    frame[base + 2] = 240;
                }
            }
        }
        frames.push(frame);
    }
    frames
}

#[test]
fn track_frames_follows_moving_and_growing_object() {
    let (w, h) = (128u32, 96u32);
    let frames = synthetic_frames(6, w, h, 0.2);
    // Semilla 24×24 centrada en el cuadrado inicial (12px) + margen negro.
    let rect = ObjectTrackRect {
        x: 34.0 / w as f64,
        y: 32.0 / h as f64,
        w: 24.0 / w as f64,
        h: 24.0 / h as f64,
    };
    let samples = track_frames(&frames, w, h, &rect);
    assert_eq!(samples.len(), 6);
    // El centro avanza ~3px por frame en el frame escalado.
    let last = samples.last().unwrap();
    assert!(
        last.center_x > samples[0].center_x,
        "no siguió el movimiento"
    );
    // La confianza no colapsa en una secuencia sintética limpia.
    assert!(last.confidence > 0.5, "confidence={}", last.confidence);
    // El tamaño reportado crece con el objeto.
    assert!(last.size > samples[0].size, "no detectó el crecimiento");
}

#[test]
fn track_frames_recovers_after_fast_object_jump() {
    let (w, h) = (128u32, 96u32);
    let mut frames = Vec::new();
    for index in 0..8u32 {
        let mut frame = vec![0u8; (w * h * 3) as usize];
        let x = if index < 3 {
            36 + index * 2
        } else {
            84 + (index - 3) * 3
        };
        for row in 0..12u32 {
            for col in 0..12u32 {
                let base = (((34 + row) * w + x + col) * 3) as usize;
                frame[base..base + 3].copy_from_slice(&[240, 240, 240]);
            }
        }
        frames.push(frame);
    }
    let rect = ObjectTrackRect {
        x: 34.0 / w as f64,
        y: 32.0 / h as f64,
        w: 24.0 / w as f64,
        h: 24.0 / h as f64,
    };
    let samples = track_frames(&frames, w, h, &rect);
    let last = samples.last().expect("last sample");
    assert_eq!(samples.len(), frames.len());
    assert!(
        last.center_x > 0.70,
        "x={} confidence={}",
        last.center_x,
        last.confidence
    );
    assert!(last.confidence >= MIN_CONFIDENCE);
}

#[test]
fn best_rotation_prefers_zero_on_symmetric_content() {
    // Frame 64×64; el patch 24×24 contiene un triángulo asimétrico
    // (mitad inferior derecha) para que la rotación sea detectable.
    let (w, h) = (64i32, 64i32);
    let mut gray = vec![0.0f32; (w * h) as usize];
    for row in 20..44 {
        for col in 20..44 {
            if col >= row {
                gray[(row * w + col) as usize] = 200.0;
            }
        }
    }
    // El template es el patch 24×24 en (20,20).
    let patch = Patch {
        x: 20,
        y: 20,
        w: 24,
        h: 24,
    };
    let template_patch = patch_values(&gray, w, patch);
    let (template, norm) = centered_template(&template_patch);
    let (score, angle) = best_rotation_at(
        &gray, w, h, 32.0, 32.0, 24, 24, 0.0, &template, norm, 24, 24,
    );
    assert!(score > 0.9, "score={score}");
    assert!(angle.abs() < 1e-9, "angle={angle}");
}

#[test]
fn scaled_dims_keeps_aspect_within_bounds() {
    let (w, h) = scaled_dims(1920, 1080);
    assert_eq!(w, MAX_DIM);
    assert!((MIN_DIM..MAX_DIM).contains(&h));
    let (w2, h2) = scaled_dims(1080, 1920);
    assert_eq!(h2, MAX_DIM);
    assert!(w2 < MAX_DIM);
}
