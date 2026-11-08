fn normalize_unsharp_size(size: u32) -> u32 {
    match size {
        3 | 7 | 9 => size,
        _ => 5,
    }
}

fn unique_output(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let safe_stem: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let stem = safe_stem.trim().trim_matches('-');
    let stem = if stem.is_empty() { "archivo" } else { stem };
    let mut candidate = dir.join(format!("{stem}-definicion.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-definicion-{index}.{extension}"));
        index += 1;
    }
    candidate
}
