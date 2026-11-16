from pathlib import Path
p = Path(r"apps/desktop/src-tauri/src/commands/domains/media/object_track.rs")
s = p.read_text(encoding="utf-8")

old = """            if best.0 >= MIN_CONFIDENCE {
                center_x = best.1;
                center_y = best.2;"""
new = """            // Si el objetivo sale de la ventana local, intenta recuperarlo
            // en todo el frame. Esta pasada sólo corre con baja confianza.
            if best.0 < MIN_CONFIDENCE {
                let mut global = (f64::NEG_INFINITY, center_x, center_y);
                let half_w = search_w as f64 / 2.0;
                let half_h = search_h as f64 / 2.0;
                let mut gy = half_h;
                while gy <= h_i as f64 - half_h {
                    let mut gx = half_w;
                    while gx <= w_i as f64 - half_w {
                        let candidate = Patch {
                            x: (gx - half_w).round() as i32,
                            y: (gy - half_h).round() as i32,
                            w: search_w,
                            h: search_h,
                        };
                        let window = patch_values(&gray, w_i, candidate);
                        let score = ncc_centered(&template, template_norm, &window);
                        if score > global.0 {
                            global = (score, gx, gy);
                        }
                        gx += 8.0;
                    }
                    gy += 8.0;
                }
                if global.0 > best.0 {
                    best = global;
                }
            }
            if best.0 >= MIN_CONFIDENCE {
                center_x = best.1;
                center_y = best.2;"""
assert old in s
s = s.replace(old, new, 1)

old_command = """    let (src_w, src_h) = probe_dimensions(&ffprobe, &input)?;
    let (w, h) = scaled_dims(src_w, src_h);
    let samples = track_stream(
        Some(&app),
        &ffmpeg,
        &input,
        request.start_seconds,
        duration,
        rect,
        w,
        h,
    )?;
    let confident = samples.iter().filter(|s| s.confidence >= MIN_CONFIDENCE).count() as u32;
    Ok(ObjectTrackResult {
        frames: samples.len() as u32,
        confident,
        samples,
        duration_seconds: duration,
        scaled_width: w,
        scaled_height: h,
    })"""
new_command = """    let start_seconds = request.start_seconds;
    tauri::async_runtime::spawn_blocking(move || {
        let (src_w, src_h) = probe_dimensions(&ffprobe, &input)?;
        let (w, h) = scaled_dims(src_w, src_h);
        let samples = track_stream(
            Some(&app),
            &ffmpeg,
            &input,
            start_seconds,
            duration,
            rect,
            w,
            h,
        )?;
        let confident = samples.iter().filter(|s| s.confidence >= MIN_CONFIDENCE).count() as u32;
        Ok(ObjectTrackResult {
            frames: samples.len() as u32,
            confident,
            samples,
            duration_seconds: duration,
            scaled_width: w,
            scaled_height: h,
        })
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el seguimiento del objeto se interrumpió antes de terminar",
        )
    })?"""
assert old_command in s
s = s.replace(old_command, new_command, 1)

anchor = """    #[test]
    fn best_rotation_prefers_zero_on_symmetric_content() {"""
test = """    #[test]
    fn track_frames_recovers_after_fast_object_jump() {
        let (w, h) = (128u32, 96u32);
        let mut frames = Vec::new();
        for index in 0..8u32 {
            let mut frame = vec![0u8; (w * h * 3) as usize];
            let x = if index < 3 { 36 + index * 2 } else { 84 + (index - 3) * 3 };
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
        assert!(last.center_x > 0.70, "x={} confidence={}", last.center_x, last.confidence);
        assert!(last.confidence >= MIN_CONFIDENCE);
    }

"""
assert anchor in s
s = s.replace(anchor, test + anchor, 1)
p.write_text(s, encoding="utf-8")
print("patched")
