fn blend_px(buf: &mut [u8], w: usize, h: usize, x: i64, y: i64, color: [u8; 3]) {
    if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
        return;
    }
    let idx = ((y as usize) * w + (x as usize)) * 3;
    buf[idx] = color[0];
    buf[idx + 1] = color[1];
    buf[idx + 2] = color[2];
}

/// Línea gruesa por interpolación lineal con sello circular.
fn draw_bone(buf: &mut [u8], w: usize, h: usize, a: V2, b: V2, thick: f64, color: [u8; 3]) {
    let dist = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
    let steps = (dist.ceil() as usize).max(1);
    let r = (thick / 2.0).max(1.0) as i64;
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let x = a.x + (b.x - a.x) * t;
        let y = a.y + (b.y - a.y) * t;
        for dy in -r..=r {
            for dx in -r..=r {
                if dx * dx + dy * dy <= r * r + r {
                    blend_px(
                        buf,
                        w,
                        h,
                        x.round() as i64 + dx,
                        y.round() as i64 + dy,
                        color,
                    );
                }
            }
        }
    }
}

fn draw_head(buf: &mut [u8], w: usize, h: usize, head: V2, rig: &Rig, color: [u8; 3]) {
    let r = rig.head_r as i64;
    for dy in -r..=r {
        for dx in -r..=r {
            if dx * dx + dy * dy <= r * r {
                blend_px(
                    buf,
                    w,
                    h,
                    head.x.round() as i64 + dx,
                    head.y.round() as i64 + dy,
                    color,
                );
            }
        }
    }
    // Ojos: dos puntos oscuros para que se lea como personaje.
    let eye = [20, 20, 24];
    let er = (rig.head_r * 0.16).max(1.0) as i64;
    for sx in [-1.0_f64, 1.0] {
        let ex = head.x + sx * rig.head_r * 0.38;
        let ey = head.y - rig.head_r * 0.15;
        for dy in -er..=er {
            for dx in -er..=er {
                if dx * dx + dy * dy <= er * er {
                    blend_px(
                        buf,
                        w,
                        h,
                        ex.round() as i64 + dx,
                        ey.round() as i64 + dy,
                        eye,
                    );
                }
            }
        }
    }
}
