/// Quita el fondo de un asset del proyecto (imagen o video) y devuelve el
/// asset nuevo ya copiado a `media/`. El original nunca se modifica.
#[tauri::command]
pub async fn remove_background_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    kind: String,
    in_frame: u64,
    out_frame: u64,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffprobe = ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe es necesario para registrar el recorte en el proyecto",
        )
    })?;
    let model_path = require_recorte_model(&state)?;
    let input = resolve_inside_root(&session.root, path.trim())?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el material a recortar ya no está en disco",
        ));
    }
    match kind.as_str() {
        "image" => remove_image_background(
            &session.root,
            &input,
            &ffprobe,
            &model_path,
            fps_num.max(1),
            fps_den.max(1),
        ),
        "video" => {
            let ffmpeg = ffmpeg.ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "FFmpeg es necesario para quitar el fondo de un video",
                )
            })?;
            remove_video_background(
                &session.root,
                &input,
                &ffmpeg,
                &ffprobe,
                &model_path,
                in_frame,
                out_frame,
                fps_num.max(1),
                fps_den.max(1),
                |percent| {
                    let _ = app.emit("background-progress", json!({ "percent": percent }));
                },
            )
        }
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el recorte automático sólo acepta imágenes o videos",
        )),
    }
}
