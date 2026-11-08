pub(super) fn ensure_asset_unchanged(asset: &Value, path: &Path) -> Result<(), ProjectError> {
    let Some(expected) = asset["integrity"]["bytes"].as_u64() else {
        return Ok(());
    };
    let actual = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if actual != expected {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el material cambió de tamaño desde la importación; volvé a importarlo antes de exportar",
        ));
    }
    Ok(())
}

/// Una línea de comandos de Windows está limitada a 32.767 caracteres y las
/// automatizaciones largas (Bézier pre-muestreada, duplicada por canal) la
/// superan: `Command::spawn` entonces falla sin mensaje útil. Si el grafo no
/// entra, FFmpeg lo lee del archivo con `-/filter_complex`.
pub(super) fn push_filter_complex(
    args: &mut Vec<String>,
    graph: String,
    temp_dir: &Path,
) -> Result<(), ProjectError> {
    const INLINE_LIMIT: usize = 8_000;
    if graph.chars().count() <= INLINE_LIMIT {
        args.push("-filter_complex".into());
        args.push(graph);
        return Ok(());
    }
    let path = temp_dir.join("filter-graph.txt");
    std::fs::write(&path, graph).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo preparar el grafo de filtros para el render",
        )
    })?;
    args.push("-/filter_complex".into());
    args.push(path.to_string_lossy().into_owned());
    Ok(())
}
