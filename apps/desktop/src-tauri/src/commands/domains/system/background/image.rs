#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundRemoval {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// Quita el fondo de una imagen y guarda un PNG con canal alfa.
#[tauri::command]
pub fn remove_background(
    state: State<'_, AppState>,
    input_path: String,
    output_path: Option<String>,
) -> Result<BackgroundRemoval, ProjectError> {
    let model_path = require_recorte_model(&state)?;
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la imagen a procesar no está en disco",
        ));
    }

    let image = image::open(&input).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no se pudo leer la imagen: ¿es un formato soportado?",
        )
    })?;

    let mask = run_u2netp(&model_path, &image)?;
    let output = composite_with_alpha(&image, &mask);

    let destination = match output_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "imagen".to_owned());
            input
                .with_file_name(format!("{stem}-sin-fondo.png"))
                .with_extension("png")
        }
    };
    image::save_buffer_with_format(
        &destination,
        output.as_raw(),
        output.width(),
        output.height(),
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el recorte"))?;

    Ok(BackgroundRemoval {
        path: destination.to_string_lossy().into_owned(),
        width: output.width(),
        height: output.height(),
    })
}

/// Abre una sesión de u2netp reutilizable. El video la conserva durante todos
/// los frames: cargar el modelo por frame costaría más que la inferencia.
fn open_session(model_path: &Path) -> Result<ort::session::Session, ProjectError> {
    let environment = ensure_environment()?;
    ort::session::Session::builder(environment)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo crear la sesión de ONNX Runtime: {error}").as_str(),
            )
        })?
        // Sin `with_optimization_level`: el nivel por defecto de ONNX Runtime
        // ya es el máximo, y esta llamada fue rechazada por el DLL cargado.
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

/// Ejecuta u2netp y devuelve la máscara al tamaño de la imagen.
fn run_u2netp(model_path: &Path, image: &DynamicImage) -> Result<image::GrayImage, ProjectError> {
    let mut session = open_session(model_path)?;
    run_u2netp_session(&mut session, image)
}

fn run_u2netp_session(
    session: &mut ort::session::Session,
    image: &DynamicImage,
) -> Result<image::GrayImage, ProjectError> {
    // Preprocesado: RGB → 320×320 → normalización por canal (igual que rembg).
    let resized = image
        .resize_exact(U2NET_INPUT as u32, U2NET_INPUT as u32, FilterType::Triangle)
        .to_rgb8();
    let mut input = vec![0f32; U2NET_INPUT * U2NET_INPUT * 3];
    for (index, pixel) in resized.pixels().enumerate() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;
        input[index] = (r - U2NET_MEAN[0]) / U2NET_STD[0];
        input[index + U2NET_INPUT * U2NET_INPUT] = (g - U2NET_MEAN[1]) / U2NET_STD[1];
        input[index + U2NET_INPUT * U2NET_INPUT * 2] = (b - U2NET_MEAN[2]) / U2NET_STD[2];
    }

    let tensor = ort::value::Tensor::from_array(([1usize, 3, U2NET_INPUT, U2NET_INPUT], input))
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo preparar la imagen para el modelo: {error}").as_str(),
            )
        })?;
    let outputs = session.run(ort::inputs![tensor]).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el modelo falló al procesar la imagen: {error}").as_str(),
        )
    })?;

    // u2netp devuelve varias salidas; la principal es la única con forma
    // [1, 1, 320, 320]. Se elige por forma, no por nombre: los nombres internos
    // cambian entre conversiones del modelo.
    let mut values: Option<Vec<f32>> = None;
    for (_name, output) in &outputs {
        let (shape, data) = output.try_extract_tensor::<f32>().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                format!("el modelo devolvió algo inesperado: {error}").as_str(),
            )
        })?;
        if shape.to_vec() == OUTPUT_SHAPE {
            values = Some(data.to_vec());
            break;
        }
    }
    let Some(values) = values else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el modelo no devolvió la máscara esperada",
        ));
    };

    // La máscara cruda se normaliza a 0–1 y se re-escala al tamaño original.
    let (width, height) = image.dimensions();
    let mask_min = values.iter().cloned().fold(f32::INFINITY, f32::min);
    let mask_max = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let span = (mask_max - mask_min).max(f32::EPSILON);

    let mut normalized = image::GrayImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let source_x = (x as f32 / width as f32 * U2NET_INPUT as f32) as usize;
            let source_y = (y as f32 / height as f32 * U2NET_INPUT as f32) as usize;
            let value = values[source_y * U2NET_INPUT + source_x];
            let scaled = ((value - mask_min) / span).clamp(0.0, 1.0);
            normalized.put_pixel(x, y, image::Luma([(scaled * 255.0).round() as u8]));
        }
    }
    Ok(normalized)
}

/// Aplica la máscara como canal alfa sobre la imagen original.
fn composite_with_alpha(image: &DynamicImage, mask: &image::GrayImage) -> RgbaImage {
    let mut output = image.to_rgba8();
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        if let Some(alpha) = mask.get_pixel(x, y).0.first() {
            let alpha = (*alpha as u16 * pixel.0[3] as u16 / 255) as u8;
            pixel.0[3] = alpha;
        }
    }
    output
}

/// Devuelve la ruta del modelo u2netp si está descargado.
fn require_recorte_model(state: &AppState) -> Result<PathBuf, ProjectError> {
    let spec = model_by_id("u2netp").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de recorte no existe")
    })?;
    if !is_model_downloaded(state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de recorte (Ajustes → Capacidades)",
        ));
    }
    Ok(model_dir(state, spec).join(spec.files[0].file_name))
}

fn derived_label(stem: &str) -> String {
    format!("{stem} sin fondo").chars().take(200).collect()
}

/// Copia el resultado a `media/` y devuelve el asset completo. Los derechos
/// quedan sin declarar a propósito: la interfaz hereda la licencia del clip
/// original en vez de inventar una.
fn import_derived_asset(
    root: &Path,
    temp: &Path,
    ffprobe: &Path,
    fps_num: u32,
    fps_den: u32,
    stem: &str,
) -> Result<Value, ProjectError> {
    let mut asset = import_file(root, temp, ffprobe, fps_num.max(1), fps_den.max(1))?;
    if let Some(object) = asset.as_object_mut() {
        object.insert("label".into(), json!(derived_label(stem)));
        if let Some(provenance) = object
            .get_mut("rights")
            .and_then(Value::as_object_mut)
            .and_then(|rights| rights.get_mut("provenance"))
            .and_then(Value::as_object_mut)
        {
            provenance.insert("origin".into(), json!("generated-locally"));
        }
        if object["kind"].as_str() == Some("video") {
            if let Some(media) = object.get_mut("media").and_then(Value::as_object_mut) {
                // El renderer lee esta marca para forzar el decoder de libvpx,
                // el único que expone el alfa lateral de VP9.
                media.insert("alpha".into(), json!(true));
            }
        }
    }
    Ok(asset)
}

fn source_stem(input: &Path) -> String {
    input
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "material".to_owned())
}

fn remove_image_background(
    root: &Path,
    input: &Path,
    ffprobe: &Path,
    model_path: &Path,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    let image = image::open(input).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no se pudo leer la imagen: ¿es un formato soportado?",
        )
    })?;
    let mask = run_u2netp(model_path, &image)?;
    let output = composite_with_alpha(&image, &mask);
    let temp = std::env::temp_dir().join(format!("olyvia-recorte-{}.png", uuid::Uuid::new_v4()));
    image::save_buffer_with_format(
        &temp,
        output.as_raw(),
        output.width(),
        output.height(),
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el recorte"))?;
    let stem = source_stem(input);
    let result = import_derived_asset(root, &temp, ffprobe, fps_num, fps_den, &stem);
    let _ = std::fs::remove_file(&temp);
    result
}

/// Ajusta el frame de salida a un máximo de 1080p y dimensiones pares.
fn fit_output_frame(width: u32, height: u32) -> Result<(u32, u32), ProjectError> {
    if width < 2 || height < 2 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el video no declara dimensiones legibles",
        ));
    }
    let scale = (1920.0 / width as f64).min(1080.0 / height as f64).min(1.0);
    let fit_width = ((width as f64 * scale).round() as u32).max(2) & !1;
    let fit_height = ((height as f64 * scale).round() as u32).max(2) & !1;
    Ok((fit_width, fit_height))
}
