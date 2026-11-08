/// Etiqueta de salida de una cadena de audio: `[a3]`, `[aout]`. Las cadenas
/// visuales usan `[v3]`, `[base0]`, `[adj0]`, etc., que no colisionan.
fn audio_output_label(chain: &str) -> Option<&str> {
    let trimmed = chain.trim();
    let label = trimmed
        .strip_suffix(']')?
        .rsplit_once('[')
        .map(|(_, label)| label)?;
    let audio = label == "aout"
        || label
            .strip_prefix('a')
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()));
    audio.then_some(label)
}

/// FFmpeg falla si un `-filter_complex` deja salidas sin conectar, así que el
/// compuesto descarta las cadenas de audio y conserva el grafo visual.
fn strip_audio_chains(graph: &str) -> String {
    graph
        .split(';')
        .filter(|chain| audio_output_label(chain).is_none())
        .collect::<Vec<_>>()
        .join(";")
}

/// Conserva las entradas y el grafo de composición del plan de render y
/// reemplaza sólo la cola de salida: un PNG en el tiempo pedido, sin audio.
fn frame_args_from_plan(plan_args: &[String], time: f64, output: &Path) -> Option<Vec<String>> {
    let position = plan_args.iter().position(|arg| arg == "-filter_complex")?;
    let graph = plan_args.get(position + 1)?;
    if graph.trim().is_empty() {
        return None;
    }
    let graph = strip_audio_chains(graph);
    if !graph.contains("[vout]") {
        return None;
    }
    // El seek de salida (`-ss`) reinicia contadores internos (`n`, `N`) y
    // evalúa mal los keyframes. `trim` al final del grafo conserva el tiempo
    // real del frame aunque obligue a procesar los anteriores.
    let graph = format!("{graph};[vout]trim=start={time:.6},setpts=PTS-STARTPTS[frame]");
    let mut args = plan_args[..position + 1].to_vec();
    args.push(graph);
    args.extend([
        "-map".to_owned(),
        "[frame]".to_owned(),
        "-frames:v".to_owned(),
        "1".to_owned(),
        "-an".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-f".to_owned(),
        "image2".to_owned(),
        "-update".to_owned(),
        "1".to_owned(),
        "-y".to_owned(),
    ]);
    args.push(output.to_string_lossy().into_owned());
    Some(args)
}
