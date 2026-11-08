#[derive(Debug, Default)]
struct AnalysisMeasurements {
    scenes: Vec<f64>,
    silences: Vec<AnalysisRange>,
    blacks: Vec<AnalysisRange>,
    freezes: Vec<AnalysisRange>,
    loudness: Option<LoudnessSummary>,
    luma: Option<f64>,
    saturation: Option<f64>,
    warnings: Vec<String>,
}

/// Corre las mediciones en paralelo y con una sola pasada de audio.
/// `include_samples` desactiva luma/saturación para Automático, que no las usa.
fn measure_media(
    ffmpeg: &Path,
    path: &Path,
    kind: &str,
    duration_seconds: f64,
    threshold: f64,
    silence_db: f64,
    min_silence: f64,
    include_samples: bool,
) -> AnalysisMeasurements {
    let mut result = AnalysisMeasurements::default();
    let audio_filter = format!(
        "silencedetect=noise={silence_db:.1}dB:d={min_silence:.2},ebur128=peak=true,astats=metadata=0:reset=0"
    );
    let scene_filter_value = scene_filter(threshold);
    let detectors = "blackdetect=d=0.15:pix_th=0.10,freezedetect=n=-60dB:d=0.5";
    let (scene_pass, detector_pass, audio_pass, luma_pass) = std::thread::scope(|scope| {
        let scene = if kind == "video" {
            Some(scope.spawn(|| {
                run_pass(
                    ffmpeg,
                    path,
                    &["-an", "-vf", &scene_filter_value, "-f", "null", "-"],
                )
            }))
        } else {
            None
        };
        let detectors_pass =
            if kind == "video" {
                Some(scope.spawn(|| {
                    run_pass(ffmpeg, path, &["-an", "-vf", detectors, "-f", "null", "-"])
                }))
            } else {
                None
            };
        let audio = scope.spawn(|| {
            run_pass(
                ffmpeg,
                path,
                &["-vn", "-af", &audio_filter, "-f", "null", "-"],
            )
        });
        let luma = if kind == "video" && include_samples && duration_seconds > 0.5 {
            Some(scope.spawn(|| analyze_luma(ffmpeg, path, duration_seconds)))
        } else {
            None
        };
        (
            scene.map(|handle| handle.join()),
            detectors_pass.map(|handle| handle.join()),
            audio.join(),
            luma.map(|handle| handle.join()),
        )
    });

    if kind == "video" {
        let scene_output = scene_pass
            .and_then(|joined| joined.ok())
            .and_then(|result| result.ok());
        match scene_output {
            Some(output) if output.success => {
                result.scenes = parse_scene_times(&output.stderr);
            }
            _ => result
                .warnings
                .push("No se pudieron medir los cortes de escena.".to_string()),
        }
        let detector_output = detector_pass
            .and_then(|joined| joined.ok())
            .and_then(|result| result.ok());
        match detector_output {
            Some(output) if output.success => {
                result.blacks = parse_black_ranges(&output.stderr, duration_seconds);
                result.freezes = parse_freeze_ranges(&output.stderr, duration_seconds);
            }
            _ => result
                .warnings
                .push("No se pudieron medir negros o frames congelados.".to_string()),
        }
        if let Some(joined) = luma_pass {
            if let Ok((luma, saturation)) = joined {
                result.luma = luma;
                result.saturation = saturation;
            }
        }
    }

    let audio_output = audio_pass.ok().and_then(|joined| joined.ok());
    match audio_output {
        Some(output) if output.success => {
            result.silences = parse_silences(&output.stderr, duration_seconds);
            result.loudness = parse_loudness(&output.stderr);
            if let Some(summary) = result.loudness.as_mut() {
                summary.noise_floor_db = parse_noise_floor(&output.stderr);
            }
            if result.loudness.is_none() && kind == "audio" {
                result
                    .warnings
                    .push("No se pudo medir el loudness.".to_string());
            }
        }
        _ => {
            if kind == "audio" {
                result
                    .warnings
                    .push("No se pudieron medir los silencios ni el loudness.".to_string());
            }
        }
    }
    result
}
