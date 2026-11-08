use super::*;

fn config() -> ClarityConfig {
    ClarityConfig {
        temporal: true,
        ..ClarityConfig::default()
    }
}

#[test]
fn empty_config_produces_no_filters() {
    assert!(clarity_filters(&config(), 1080).is_empty());
}

#[test]
fn cleaning_runs_before_sharpening_and_grain_runs_last() {
    let chain = clarity_filters(
        &ClarityConfig {
            denoise: 50,
            deblock: true,
            unsharp_amount: 1.2,
            curve: 40,
            grain: 1.5,
            ..config()
        },
        1080,
    );
    // Cada etapa es un segmento propio: se compara por prefijo y no por
    // `find`, porque «atadenoise» contiene «noise».
    let position = |prefix: &str| {
        chain
            .iter()
            .position(|filter| filter.starts_with(prefix))
            .unwrap_or_else(|| panic!("falta la etapa {prefix} en {chain:?}"))
    };
    let deblock = position("deblock=");
    let denoise = position("atadenoise=");
    let unsharp = position("unsharp=");
    let curves = position("curves=");
    let grain = position("noise=");
    assert!(deblock < denoise);
    assert!(denoise < unsharp);
    assert!(unsharp < curves);
    assert!(curves < grain);
    assert_eq!(
        chain.last().map(String::as_str),
        Some("noise=alls=3:allf=t+u")
    );
}

#[test]
fn unsharp_matches_the_reference_ffmpeg_syntax() {
    let chain = clarity_filters(
        &ClarityConfig {
            unsharp_amount: 1.5,
            unsharp_size: 5,
            ..config()
        },
        1080,
    );
    assert_eq!(
        chain,
        vec!["unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.50".to_owned()]
    );
}

#[test]
fn scaling_uses_lanczos_and_sixteen_bit_workspace() {
    let chain = clarity_filters(
        &ClarityConfig {
            target_height: 2160,
            high_precision: true,
            ..config()
        },
        1080,
    )
    .join(",");
    assert!(chain.contains("format=gbrp16le"));
    assert!(chain.contains("scale=-2:2160:flags=lanczos"));
    assert!(chain.contains("format=yuv420p"));
    // El formato de trabajo se abre antes de escalar y se cierra después.
    assert!(chain.find("gbrp16le").unwrap() < chain.find("scale=").unwrap());
    assert!(chain.find("scale=").unwrap() < chain.find("format=yuv420p").unwrap());
}

#[test]
fn scaling_is_skipped_when_the_target_matches_the_source() {
    let chain = clarity_filters(
        &ClarityConfig {
            target_height: 1080,
            ..config()
        },
        1080,
    );
    assert!(chain.is_empty());
}

#[test]
fn curve_strength_moves_the_quarter_points_without_clipping() {
    let soft = clarity_filters(
        &ClarityConfig {
            curve: 20,
            ..config()
        },
        1080,
    )
    .join(",");
    let hard = clarity_filters(
        &ClarityConfig {
            curve: 100,
            ..config()
        },
        1080,
    )
    .join(",");
    assert!(soft.contains("curves=master='0/0"));
    assert!(soft.contains("1/1'"));
    assert_ne!(soft, hard);
    // A más fuerza, más separación entre cuartos.
    let soft_shadow = soft
        .split("0.2500/")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|value| value.parse::<f32>().ok())
        .expect("punto de sombra");
    let hard_shadow = hard
        .split("0.2500/")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|value| value.parse::<f32>().ok())
        .expect("punto de sombra");
    assert!(hard_shadow < soft_shadow);
}

#[test]
fn grain_stays_subtle_and_scales_with_intensity() {
    let light = clarity_filters(
        &ClarityConfig {
            grain: 1.0,
            ..config()
        },
        1080,
    )
    .join(",");
    let strong = clarity_filters(
        &ClarityConfig {
            grain: 3.0,
            ..config()
        },
        1080,
    )
    .join(",");
    assert_eq!(light, "noise=alls=2:allf=t+u");
    assert_eq!(strong, "noise=alls=7:allf=t+u");
}

#[test]
fn deblock_strength_follows_the_cleaning_amount() {
    let gentle = clarity_filters(
        &ClarityConfig {
            deblock: true,
            denoise: 20,
            ..config()
        },
        1080,
    )
    .join(",");
    let harsh = clarity_filters(
        &ClarityConfig {
            deblock: true,
            denoise: 80,
            ..config()
        },
        1080,
    )
    .join(",");
    assert!(gentle.starts_with("deblock=filter=weak"));
    assert!(harsh.starts_with("deblock=filter=strong"));
}

#[test]
fn images_skip_the_temporal_denoiser() {
    let chain = clarity_filters(
        &ClarityConfig {
            denoise: 60,
            temporal: false,
            ..config()
        },
        1080,
    );
    assert!(!chain.join(",").contains("atadenoise"));
}

#[test]
fn unsharp_size_is_normalized_to_an_odd_kernel() {
    assert_eq!(normalize_unsharp_size(4), 5);
    assert_eq!(normalize_unsharp_size(9), 9);
    assert_eq!(normalize_unsharp_size(3), 3);
}

#[test]
fn invalid_mode_is_rejected() {
    assert!(ClarityMode::parse(Some("gif")).is_err());
    assert!(ClarityMode::parse(Some("video")).is_ok());
    assert!(ClarityMode::parse(Some("imagen")).is_ok());
}

#[test]
fn output_names_are_safe_and_unique() {
    let dir = std::env::temp_dir().join(format!("editoria-sharpen-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("carpeta temporal");
    let first = unique_output(&dir, "clip: raro/../uno", "mp4");
    assert!(first.to_string_lossy().ends_with("-definicion.mp4"));
    std::fs::write(&first, b"x").expect("archivo de prueba");
    let second = unique_output(&dir, "clip: raro/../uno", "mp4");
    assert_ne!(first, second);
    assert!(second.to_string_lossy().contains("-definicion-2.mp4"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn openh264_gets_a_bitrate_instead_of_a_crf() {
    let args = video_codec_args("libopenh264", 16, 1920, 1080, 30.0).join(" ");
    assert!(args.contains("-b:v"));
    assert!(!args.contains("-crf"));
    let x264 = video_codec_args("libx264", 16, 1920, 1080, 30.0).join(" ");
    assert!(x264.contains("-crf 16"));
}

/// Prueba real contra el FFmpeg empaquetado: la cadena que arma este módulo
/// tiene que parsear, elegir un encoder que exista y producir el alto
/// pedido. Detrás de `EDITOR_IA_RUN_RENDER_TESTS` como las demás pruebas que
/// necesitan binarios.
#[test]
fn live_chain_renders_the_requested_height() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el render real");
        return;
    }
    let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ffmpeg")
        .join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
    assert!(ffmpeg.is_file(), "falta el FFmpeg de recursos");

    let config = ClarityConfig {
        denoise: 45,
        deblock: true,
        target_height: 2160,
        high_precision: true,
        unsharp_amount: 1.5,
        unsharp_size: 5,
        curve: 40,
        grain: 1.5,
        temporal: true,
    };
    let filter = clarity_filters(&config, 1080).join(",");
    let encoder = resolve_encoder(&ffmpeg).expect("encoder H.264 disponible");
    let output = std::env::temp_dir().join(format!("editoria-definicion-{}.mp4", Uuid::new_v4()));

    let mut command = Command::new(&ffmpeg);
    command.args([
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1920x1080:r=25:d=0.4",
        "-vf",
        &filter,
    ]);
    command.args(video_codec_args(&encoder, 16, 3840, 2160, 25.0));
    command.args(["-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]);
    command.arg(&output);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let result = command.output().expect("FFmpeg arrancó");
    let log = String::from_utf8_lossy(&result.stderr).into_owned();
    assert!(
        result.status.success(),
        "el render falló con encoder {encoder}: {log}"
    );

    let info = probe_media(
        Some(&ffmpeg.with_file_name(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        })),
        &output,
    );
    assert_eq!(info.width, Some(3840), "ancho inesperado");
    assert_eq!(info.height, Some(2160), "alto inesperado");
    assert!(
        std::fs::metadata(&output)
            .map(|meta| meta.len())
            .unwrap_or(0)
            > 10_000,
        "el archivo salió vacío"
    );
    let _ = std::fs::remove_file(&output);
}
