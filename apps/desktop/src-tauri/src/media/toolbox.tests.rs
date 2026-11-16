use super::*;

#[test]
fn watermark_positions_are_known() {
    assert_eq!(watermark_position("top-left"), Some(("24", "24")));
    assert_eq!(
        watermark_position("bottom-right"),
        Some(("w-text_w-24", "h-text_h-24"))
    );
    assert_eq!(
        watermark_position("center"),
        Some(("(w-text_w)/2", "(h-text_h)/2"))
    );
    assert_eq!(watermark_position("middle-ish"), None);
}

#[test]
fn drawtext_text_is_escaped() {
    // drawtext exige escapar ':' '\' ''' y '%' dentro del texto.
    assert_eq!(escape_drawtext("hola"), "hola");
    assert_eq!(escape_drawtext("a:b"), "a\\:b");
    assert_eq!(escape_drawtext("100%"), "100\\%");
    assert_eq!(escape_drawtext("it's"), "it\\'s");
    assert_eq!(escape_drawtext("c:\\temp"), "c\\:\\\\temp");
}

#[test]
fn watermark_filter_rejects_unknown_positions() {
    let font = Path::new("C:/Windows/Fonts/arial.ttf");
    assert!(watermark_filter(font, "hola", "middle-ish").is_err());
    let filter = watermark_filter(font, "100%", "top-left").expect("filter");
    assert!(filter.contains("drawtext=fontfile="));
    assert!(filter.contains("text='100\\%'"));
    assert!(filter.contains("x=24:y=24"));
}

#[test]
fn merge_args_concat_all_inputs() {
    let inputs = vec![
        PathBuf::from("a.mp4"),
        PathBuf::from("b.mp4"),
        PathBuf::from("c.mp4"),
    ];
    // El codec lo resuelve la capa de comandos (el bundle LGPL no trae
    // libx264): acá llega ya armado, p.ej. libopenh264 con bitrate.
    let codec = vec![
        "-c:v".to_string(),
        "libopenh264".to_string(),
        "-b:v".to_string(),
        "8000000".to_string(),
    ];
    let args = merge_video_args(&inputs, &codec);
    let joined = args.join(" ");
    assert!(joined.contains("concat=n=3:v=1:a=1"));
    assert!(joined.contains("[0:v:0][0:a:0][1:v:0][1:a:0][2:v:0][2:a:0]"));
    assert!(joined.contains("-map [outv]"));
    assert!(joined.contains("libopenh264"));
    assert!(!joined.contains("libx264"));
    assert!(!joined.contains("-y"), "la salida la agrega el comando");
}

#[test]
fn trim_args_place_output_after_y() {
    let codec = vec![
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "slow".to_string(),
        "-crf".to_string(),
        "20".to_string(),
    ];
    let args = trim_video_args(
        Path::new("in.mp4"),
        1.5,
        9.25,
        &codec,
        Path::new("out/recorte.mp4"),
    );
    let position = |needle: &str| args.iter().position(|arg| arg == needle).unwrap();
    assert_eq!(args[position("-ss") + 1], "1.500");
    assert_eq!(args[position("-to") + 1], "9.250");
    assert_eq!(args.last().map(String::as_str), Some("out/recorte.mp4"));
    assert!(args.iter().any(|arg| arg == "-y"));
}

#[test]
fn metadata_args_only_include_non_empty_fields() {
    let args = metadata_args(
        Path::new("in.mp4"),
        "Título",
        "",
        "Comentario",
        Path::new("out.mp4"),
    );
    let joined = args.join(" ");
    assert!(joined.contains("title=Título"));
    assert!(joined.contains("comment=Comentario"));
    assert!(!joined.contains("artist="));
    assert!(joined.contains("-c copy"));
}

#[test]
fn subtitle_choice_prefers_spanish() {
    let streams = vec![
        serde_json::json!({ "tags": { "language": "eng" } }),
        serde_json::json!({ "tags": { "language": "spa" } }),
        serde_json::json!({ "tags": {} }),
    ];
    assert_eq!(choose_subtitle_stream(&streams), 1);
    let english_only = vec![serde_json::json!({ "tags": { "language": "eng" } })];
    assert_eq!(choose_subtitle_stream(&english_only), 0);
}

#[test]
fn unique_path_never_overwrites() {
    let dir = std::env::temp_dir().join(format!("editoria-tools-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let first = unique_path(&dir, "salida", "mp4");
    assert_eq!(first.file_name().unwrap(), "salida.mp4");
    std::fs::write(&first, b"x").unwrap();
    let second = unique_path(&dir, "salida", "mp4");
    assert_eq!(second.file_name().unwrap(), "salida-2.mp4");
    let _ = std::fs::remove_dir_all(&dir);
}
