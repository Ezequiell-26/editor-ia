fn runtime_dll() -> Result<PathBuf, ProjectError> {
    if let Ok(value) = std::env::var("ORT_DYLIB_PATH") {
        if Path::new(&value).is_file() {
            return Ok(PathBuf::from(value));
        }
    }
    let mut candidates: Vec<PathBuf> = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            let dir = exe.parent()?.to_path_buf();
            let mut candidates = vec![dir.join("onnxruntime.dll")];
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("onnxruntime.dll"));
            }
            Some(candidates)
        })
        .unwrap_or_default();
    candidates.retain(|path| path.is_file());
    candidates.into_iter().next().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "falta onnxruntime.dll junto a la aplicación",
        )
    })
}

fn ensure_environment() -> Result<&'static ort::environment::Environment, ProjectError> {
    if let Some(environment) = ENVIRONMENT.get() {
        return Ok(environment);
    }
    let dll = runtime_dll()?;
    let environment = ort::init_from(&dll)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo cargar onnxruntime.dll: {error}").as_str(),
            )
        })?
        .with_name("editoria-ort-upscale")
        .build()
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo iniciar ONNX Runtime: {error}").as_str(),
            )
        })?;
    Ok(ENVIRONMENT.get_or_init(|| environment))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleResult {
    pub path: String,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub tiles: u64,
}

/// Agranda una imagen ×4 con Real-ESRGAN local.
#[tauri::command]
pub fn upscale_image(
    state: State<'_, AppState>,
    input_path: String,
    output_path: Option<String>,
) -> Result<UpscaleResult, ProjectError> {
    let spec = model_by_id("real-esrgan-x4plus").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de upscale no existe")
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de upscale (Ajustes → Capacidades)",
        ));
    }
    let model_path = model_dir(&state, spec).join(spec.files[0].file_name);
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la imagen a agrandar no está en disco",
        ));
    }

    let image = image::open(&input).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no se pudo leer la imagen: ¿es un formato soportado?",
        )
    })?;
    let (width, height) = image.dimensions();
    if width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "por memoria, el upscale local acepta hasta {MAX_INPUT_SIDE}×{MAX_INPUT_SIDE}; esta imagen mide {width}×{height}"
            )
            .as_str(),
        ));
    }

    let output = run_realesrgan(&model_path, &image)?;

    let destination = match output_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "imagen".to_owned());
            input
                .with_file_name(format!("{stem}-x4.png"))
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
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el upscale"))?;

    let tiles = (width as u64).div_ceil(TILE as u64)
        * (height as u64).div_ceil(TILE as u64);
    Ok(UpscaleResult {
        path: destination.to_string_lossy().into_owned(),
        input_width: width,
        input_height: height,
        output_width: output.width(),
        output_height: output.height(),
        tiles,
    })
}
