//! Análisis local de medios: detección de escenas y movimiento de cámara.
//!
//! Funciones puras compartidas por los comandos (`detect_scenes`,
//! `analyze_stabilization`) y por `intelligence`: parseo de la salida
//! `showinfo` de FFmpeg, construcción del filtro `select` y normalización
//! del umbral. No tocan procesos ni filesystem.

/// Tope de cortes devueltos por la detección de escenas.
pub const MAX_SCENE_CUTS: usize = 500;

/// Timestamps (segundos) de los frames marcados por `showinfo` en stderr.
pub fn parse_scene_times(stderr: &str) -> Vec<f64> {
    let mut times = Vec::new();
    for (index, _) in stderr.match_indices("pts_time:") {
        let rest = &stderr[index + "pts_time:".len()..];
        let token = rest
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(',');
        if let Ok(seconds) = token.parse::<f64>() {
            if seconds.is_finite() && seconds > 0.01 {
                times.push(seconds);
            }
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    times.dedup_by(|a, b| (*a - *b).abs() < 0.001);
    times.truncate(MAX_SCENE_CUTS);
    times
}

/// Filtro FFmpeg `select`+`showinfo` para el umbral pedido.
pub fn scene_filter(threshold: f64) -> String {
    format!("select='gt(scene,{threshold:.3})',showinfo")
}

/// Umbral válido para `scene`: fuera de rango o no finito cae al default.
pub fn requested_threshold(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.05, 0.9)
    } else {
        0.35
    }
}

/// `VMAF score: 93.24` en el stderr del filtro libvmaf.
pub fn parse_vmaf_score(stderr: &str) -> Option<f64> {
    let marker = "VMAF score:";
    let start = stderr.find(marker)? + marker.len();
    let rest = &stderr[start..];
    let number: String = rest
        .chars()
        .skip_while(|c| c.is_whitespace())
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    number.parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_showinfo_pts_and_deduplicates() {
        let stderr = r#"
[Parsed_showinfo_1 @ 0x1] n:   2 pts:     512 pts_time:0.512       pos: 123
[Parsed_showinfo_1 @ 0x1] n:   4 pts:    1024 pts_time:1.024       pos: 456
[Parsed_showinfo_1 @ 0x1] n:   4 pts:    1024 pts_time:1.024       pos: 456
"#;
        assert_eq!(parse_scene_times(stderr), vec![0.512, 1.024]);
    }

    #[test]
    fn ignores_zero_invalid_and_builds_a_scene_filter() {
        assert!(parse_scene_times("pts_time:0 pts_time:no").is_empty());
        assert_eq!(scene_filter(0.35), "select='gt(scene,0.350)',showinfo");
        assert_eq!(requested_threshold(2.0), 0.9);
        assert_eq!(requested_threshold(f64::NAN), 0.35);
    }
}
