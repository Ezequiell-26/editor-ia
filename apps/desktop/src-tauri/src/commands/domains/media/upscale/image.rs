/// Sesión ONNX del modelo Real-ESRGAN, abierta una vez por proceso de
/// upscale (imagen o video) en vez de una vez por llamada.
fn open_esrgan_session(model_path: &Path) -> Result<ort::session::Session, ProjectError> {
    let environment = ensure_environment()?;
    ort::session::Session::builder(environment)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo crear la sesión de ONNX Runtime: {error}").as_str(),
            )
        })?
        .with_intra_threads(4)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo configurar ONNX Runtime: {error}").as_str(),
            )
        })?
        .commit_from_file(model_path)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo cargar el modelo: {error}").as_str(),
            )
        })
}

/// La inferencia por teselas sobre una imagen completa.
fn run_realesrgan(model_path: &Path, image: &DynamicImage) -> Result<RgbaImage, ProjectError> {
    let mut session = open_esrgan_session(model_path)?;
    let rgb = image.to_rgb8();
    upscale_frame_tiled(&mut session, &rgb)
}

/// Agranda un frame RGB ×4 por teselas con solape (compartido por imagen y
/// video: cada frame del video pasa por acá).
fn upscale_frame_tiled(
    session: &mut ort::session::Session,
    rgb: &image::RgbImage,
) -> Result<RgbaImage, ProjectError> {
    let (width, height) = rgb.dimensions();
    let mut output = RgbaImage::new(width * SCALE, height * SCALE);
    let tiles_x = width.div_ceil(TILE as u32);
    let tiles_y = height.div_ceil(TILE as u32);
    let mut done_tiles: u64 = 0;

    for tile_y in 0..tiles_y {
        for tile_x in 0..tiles_x {
            let base_x = (tile_x * TILE as u32) as i64;
            let base_y = (tile_y * TILE as u32) as i64;
            // Ventana con solape: el contexto de los bordes evita costuras.
            let window_x = (base_x - TILE_PAD as i64).max(0);
            let window_y = (base_y - TILE_PAD as i64).max(0);
            let window_w = ((window_x + (TILE + TILE_PAD * 2) as i64) as u32)
                .min(width)
                .saturating_sub(window_x as u32);
            let window_h = ((window_y + (TILE + TILE_PAD * 2) as i64) as u32)
                .min(height)
                .saturating_sub(window_y as u32);

            let window = image::imageops::crop_imm(
                rgb,
                window_x as u32,
                window_y as u32,
                window_w.max(1),
                window_h.max(1),
            )
            .to_image();

            let upscaled = run_tile(session, &window)?;
            // La tesela ampliada es window×4; se recorta el corazón que le
            // corresponde a esta tesela (sin el solape) y se pega.
            let core_x = ((base_x - window_x).max(0) as u32) * SCALE;
            let core_y = ((base_y - window_y).max(0) as u32) * SCALE;
            let core_w = ((base_x as u32 + TILE as u32).min(width) - base_x as u32) * SCALE;
            let core_h = ((base_y as u32 + TILE as u32).min(height) - base_y as u32) * SCALE;
            let piece = image::imageops::crop_imm(
                &upscaled,
                core_x,
                core_y,
                core_w.min(upscaled.width().saturating_sub(core_x)),
                core_h.min(upscaled.height().saturating_sub(core_y)),
            )
            .to_image();
            image::imageops::overlay(
                &mut output,
                &piece,
                base_x * SCALE as i64,
                base_y * SCALE as i64,
            );
            done_tiles += 1;
            let _ = done_tiles;
        }
    }
    Ok(output)
}

/// Una tesela: RGB 0–1 → modelo → RGBA 0–255 a escala ×4.
fn run_tile(
    session: &mut ort::session::Session,
    window: &image::RgbImage,
) -> Result<RgbaImage, ProjectError> {
    let (win_w, win_h) = window.dimensions();
    let tile_w = win_w.next_power_of_two().min(TILE as u32 * 4) as usize;
    let tile_h = win_h.next_power_of_two().min(TILE as u32 * 4) as usize;
    // El modelo exige exactamente 128×128: la ventana se re-escala a ese tamaño
    // (el solape da el contexto) y la salida vuelve a win×4 con un re-escale.
    let resized = image::DynamicImage::ImageRgb8(window.clone())
        .resize_exact(TILE as u32, TILE as u32, FilterType::Triangle)
        .to_rgb8();

    let mut input = vec![0f32; 3 * TILE * TILE];
    for (index, pixel) in resized.pixels().enumerate() {
        input[index] = pixel[0] as f32 / 255.0;
        input[index + TILE * TILE] = pixel[1] as f32 / 255.0;
        input[index + TILE * TILE * 2] = pixel[2] as f32 / 255.0;
    }
    let tensor =
        ort::value::Tensor::from_array(([1usize, 3, TILE, TILE], input)).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo preparar la tesela para el modelo: {error}").as_str(),
            )
        })?;
    let outputs = session.run(ort::inputs![tensor]).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el modelo falló al procesar la tesela: {error}").as_str(),
        )
    })?;

    let mut result = RgbaImage::new(win_w * SCALE, win_h * SCALE);
    for (_name, output) in &outputs {
        let (shape, data) = output.try_extract_tensor::<f32>().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                format!("el modelo devolvió algo inesperado: {error}").as_str(),
            )
        })?;
        if shape.len() == 4 && shape[1] == 3 {
            let out_w = *shape.last().unwrap_or(&0) as u32;
            let out_h = shape.get(2).copied().unwrap_or(0) as u32;
            let scaled = DynamicImage::ImageRgb8({
                let mut rgb = image::RgbImage::new(out_w, out_h);
                let plane = TILE as u32 * SCALE;
                for y in 0..out_h {
                    for x in 0..out_w {
                        let source_x = (x as f32 / out_w as f32 * plane as f32) as usize;
                        let source_y = (y as f32 / out_h as f32 * plane as f32) as usize;
                        let index = source_y * plane as usize * 3 + source_x * 3;
                        let r = (data[index].clamp(0.0, 1.0) * 255.0).round() as u8;
                        let g = (data[index + 1].clamp(0.0, 1.0) * 255.0).round() as u8;
                        let b = (data[index + 2].clamp(0.0, 1.0) * 255.0).round() as u8;
                        rgb.put_pixel(x, y, image::Rgb([r, g, b]));
                    }
                }
                rgb
            })
            .resize_exact(win_w * SCALE, win_h * SCALE, FilterType::Triangle)
            .to_rgba8();
            result.copy_from(&scaled, 0, 0).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo armar el upscale")
            })?;
            break;
        }
    }
    let _ = (tile_w, tile_h);
    Ok(result)
}

// ---------------------------------------------------------------------------
// Upscale de video ×4 (Real-ESRGAN frame a frame)
// ---------------------------------------------------------------------------
