/// Construye el filtro de mezcla. `segments` ya tiene los WAV medidos. Si una
/// voz no entra en su ventana se acelera hasta 1.35× y, si aún no entra, se
/// recorta con un fade corto; el motivo se devuelve en `warnings`.
fn build_dub_filter(
    segments: &[DubSegment],
    end_seconds: f64,
    bed_volume: Option<f64>,
) -> (String, Vec<String>) {
    let mut parts = vec![format!(
        "anullsrc=channel_layout=stereo:sample_rate=48000:duration={end_seconds:.3}[base]"
    )];
    let mut warnings = Vec::new();
    let bed = bed_volume
        .filter(|volume| volume.is_finite() && *volume > 0.0)
        .map(|volume| volume.clamp(0.0, 1.0));
    if let Some(volume) = bed {
        parts.push(format!(
            "[0:a]aformat=channel_layouts=stereo:sample_rates=48000,volume={volume:.3}[bed]"
        ));
    }
    for (index, segment) in segments.iter().enumerate() {
        let window = (segment.end - segment.start).max(0.2);
        let mut chain = String::from("aformat=channel_layouts=stereo:sample_rates=48000");
        let mut duration = segment.duration;
        if duration > window * 1.02 {
            let tempo = (duration / window).clamp(1.01, 1.35);
            chain.push_str(&format!(",atempo={tempo:.3}"));
            duration /= tempo;
            if duration > window + 0.02 {
                let fade_start = (window - 0.06).max(0.0);
                chain.push_str(&format!(
                    ",atrim=duration={window:.3},afade=t=out:st={fade_start:.3}:d=0.06"
                ));
                warnings.push(format!(
                    "La voz {} se acortó para entrar en su ventana de {window:.1} s.",
                    index + 1
                ));
            }
        }
        let delay_ms = (segment.start * 1000.0).round().max(0.0) as i64;
        chain.push_str(&format!(
            ",asetpts=PTS-STARTPTS,adelay={delay_ms}|{delay_ms}"
        ));
        parts.push(format!("[{}:a]{chain}[a{index}]", index + 1));
    }
    let labels: String = (0..segments.len())
        .map(|index| format!("[a{index}]"))
        .collect();
    let bed_label = if bed.is_some() { "[bed]" } else { "" };
    parts.push(format!(
        "[base]{bed_label}{labels}amix=inputs={}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]",
        segments.len() + 1 + usize::from(bed.is_some())
    ));
    (parts.join(";"), warnings)
}
