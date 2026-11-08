#[derive(Debug, Clone, Copy)]
struct Cut {
    start: f64,
    duration: f64,
    broll_index: usize,
}

fn plan_cuts(duration: f64, interval: f64, clip: f64, max: usize, broll_count: usize) -> Vec<Cut> {
    if broll_count == 0 || duration <= 2.0 {
        return Vec::new();
    }
    let interval = interval.clamp(2.0, 60.0);
    let clip = clip.clamp(1.0, 3.0);
    let mut cuts = Vec::new();
    let mut at = interval;
    while cuts.len() < max.min(20) && at + clip + 0.4 < duration {
        cuts.push(Cut {
            start: at,
            duration: clip,
            broll_index: cuts.len() % broll_count,
        });
        at += interval;
    }
    cuts
}

fn broll_filter(info: VideoInfo, cuts: &[Cut]) -> String {
    let width = even(info.width);
    let height = even(info.height);
    let fps = info.fps.clamp(1.0, 120.0);
    let mut graph = Vec::new();
    let mut video_inputs = Vec::new();
    let mut audio_inputs = Vec::new();
    let mut prev = 0.0;
    for (index, cut) in cuts.iter().enumerate() {
        let start = cut.start;
        let after = cut.start + cut.duration;
        graph.push(format!(
            "[0:v]trim=start={prev:.3}:end={start:.3},setpts=PTS-STARTPTS[v{index}]"
        ));
        video_inputs.push(format!("[v{index}]"));
        graph.push(format!(
            "[{}:v]trim=0:{:.3},setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},fps={fps:.3},setsar=1[b{index}]",
            index + 1,
            cut.duration
        ));
        video_inputs.push(format!("[b{index}]"));
        if info.has_audio {
            graph.push(format!(
                "[0:a]atrim=start={prev:.3}:end={start:.3},asetpts=PTS-STARTPTS[a{index}]"
            ));
            audio_inputs.push(format!("[a{index}]"));
            graph.push(format!(
                "[0:a]atrim=start={start:.3}:end={after:.3},asetpts=PTS-STARTPTS[ac{index}]"
            ));
            audio_inputs.push(format!("[ac{index}]"));
        }
        prev = after;
    }
    let last = cuts.len();
    if prev < info.duration - 0.05 {
        graph.push(format!(
            "[0:v]trim=start={prev:.3},setpts=PTS-STARTPTS[v{last}]"
        ));
        video_inputs.push(format!("[v{last}]"));
        if info.has_audio {
            graph.push(format!(
                "[0:a]atrim=start={prev:.3},asetpts=PTS-STARTPTS[a{last}]"
            ));
            audio_inputs.push(format!("[a{last}]"));
        }
    }
    graph.push(format!(
        "{}concat=n={}:v=1:a=0[v]",
        video_inputs.join(""),
        video_inputs.len()
    ));
    if info.has_audio && !audio_inputs.is_empty() {
        graph.push(format!(
            "{}concat=n={}:v=0:a=1[a]",
            audio_inputs.join(""),
            audio_inputs.len()
        ));
    }
    graph.join(";")
}

fn broll_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    broll_dir: &Path,
    output: &Path,
    interval: f64,
    clip: f64,
    max: usize,
) -> Result<CreatorOutput, CreatorError> {
    let info = probe_video(ffprobe, input)?;
    let mut clips = std::fs::read_dir(broll_dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        matches!(
                            extension.to_ascii_lowercase().as_str(),
                            "mp4" | "mov" | "mkv" | "webm" | "avi"
                        )
                    })
        })
        .collect::<Vec<_>>();
    clips.sort();
    if clips.is_empty() {
        return Err(CreatorError::Invalid(
            "La carpeta de B-roll no tiene videos compatibles.".into(),
        ));
    }
    let cuts = plan_cuts(info.duration, interval, clip, max, clips.len());
    if cuts.is_empty() {
        return Err(CreatorError::Invalid(
            "No hay margen para insertar B-roll con ese intervalo.".into(),
        ));
    }
    let workspace = TempWorkspace::new("broll")?;
    let graph = broll_filter(info, &cuts);
    std::fs::write(workspace.path.join("filter-graph.txt"), graph)?;
    let mut args = vec!["-i".into(), input.to_string_lossy().into_owned()];
    for cut in &cuts {
        args.push("-stream_loop".into());
        args.push("-1".into());
        args.push("-i".into());
        args.push(clips[cut.broll_index].to_string_lossy().into_owned());
    }
    args.extend([
        "-/filter_complex".into(),
        "filter-graph.txt".into(),
        "-map".into(),
        "[v]".into(),
    ]);
    if info.has_audio {
        args.extend([
            "-map".into(),
            "[a]".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    } else {
        args.push("-an".into());
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-t".into(),
        format!("{:.3}", info.duration),
        output.to_string_lossy().into_owned(),
    ]);
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(
        output.to_path_buf(),
        "broll",
        even(info.width),
        even(info.height),
        info.duration,
    )
}

#[tauri::command]
pub async fn creator_interleave_broll(
    state: State<'_, AppState>,
    input_path: String,
    broll_dir: String,
    output_path: String,
    interval_seconds: Option<f64>,
    clip_seconds: Option<f64>,
    max_insertions: Option<u32>,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let broll_dir = PathBuf::from(broll_dir.trim());
    if !broll_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "La carpeta de B-roll no existe.",
        ));
    }
    let output = output_mp4(&output_path)?;
    let interval = interval_seconds.unwrap_or(5.0);
    let clip = clip_seconds.unwrap_or(1.75);
    let max = max_insertions.unwrap_or(12) as usize;
    tauri::async_runtime::spawn_blocking(move || {
        broll_blocking(
            &ffmpeg, &ffprobe, &input, &broll_dir, &output, interval, clip, max,
        )
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El B-roll se interrumpió."))?
    .map_err(Into::into)
}
