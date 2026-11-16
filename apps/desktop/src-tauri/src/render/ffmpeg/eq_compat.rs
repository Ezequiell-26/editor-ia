//! Compatibilidad del filtro `eq` de FFmpeg ≤ 8 con FFmpeg 9, donde fue eliminado.
//!
//! Las recetas de color y el grado del clip emiten `eq=brightness=…:contrast=…:
//! saturation=…:gamma…`. FFmpeg 9 no tiene `eq`, así que cada segmento se
//! traduce a `lutyuv` reproduciendo la LUT por plano de `vf_eq.c`:
//!
//! - Y (luma):    contraste/brillo/gamma globales.
//! - U y V:       `contrast = saturation`, brillo 0 y gamma por canal
//!   (`sqrt(gamma_b/gamma_g)` para U, `sqrt(gamma_r/gamma_g)` para V; la
//!   luminancia usa `gamma * gamma_g`).
//!
//! `lutyuv` evalúa la expresión por píxel en espacio 0-255 con `val`, y
//! soporta `pow`/`clip`, así que la fórmula es exacta (no una aproximación
//! por muestreo). Si un segmento `eq=` trae parámetros no numéricos
//! (expresiones con `n`/`t`, `eval`, `enable`, comillas) se copia tal cual:
//! es el mismo comportamiento que antes del cambio, sin regresión.

/// Reescribe todos los filtros `eq=…` de una cadena/filter_complex a `lutyuv`.
pub(crate) fn rewrite_eq_filters(chain: &str) -> String {
    let mut out = String::with_capacity(chain.len() + 32);
    let mut rest = chain;
    while let Some(pos) = find_eq_start(rest) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos..];
        // Fin del segmento: primera ',' ';' o '[' fuera de comillas (los
        // `enable='between(t,0.5,1.5)'` llevan comas adentro).
        let end = segment_end(after);
        let segment = &after[..end];
        match translate_eq_segment(segment) {
            Some(replacement) => out.push_str(&replacement),
            None => out.push_str(segment),
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Posición de un `eq=` que abre un filtro: inicio de cadena o tras `,` `;` `]`.
fn find_eq_start(haystack: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(found) = haystack[search_from..].find("eq=") {
        let idx = search_from + found;
        let boundary = idx == 0
            || matches!(
                haystack.as_bytes()[idx - 1],
                b',' | b';' | b']'
            );
        if boundary {
            return Some(idx);
        }
        search_from = idx + 3;
    }
    None
}

/// Fin de un segmento de filtro: primer `,` `;` `[` fuera de comillas simples.
fn segment_end(segment: &str) -> usize {
    let mut in_quote = false;
    for (idx, ch) in segment.char_indices() {
        match ch {
            '\'' => in_quote = !in_quote,
            ',' | ';' | '[' if !in_quote => return idx,
            _ => {}
        }
    }
    segment.len()
}

/// Traduce un segmento `eq=…` completo. `None` si no es traducible.
fn translate_eq_segment(segment: &str) -> Option<String> {
    let body = segment.strip_prefix("eq=")?;
    // `enable='between(t,a,b)'` es una opción de timeline válida en `lutyuv`:
    // se separa antes de parsear los parámetros y se rearma al final.
    let (args, enable) = match body.find(":enable=") {
        Some(idx) => (&body[..idx], &body[idx..]),
        None => (body, ""),
    };
    if args.contains('\'') || args.contains('"') {
        return None;
    }
    let mut brightness = 0.0_f64;
    let mut contrast = 1.0_f64;
    let mut saturation = 1.0_f64;
    let mut gamma = 1.0_f64;
    let mut gamma_r = 1.0_f64;
    let mut gamma_g = 1.0_f64;
    let mut gamma_b = 1.0_f64;
    let mut gamma_weight = 1.0_f64;
    for pair in args.split(':') {
        let (key, value) = pair.split_once('=')?;
        let number: f64 = value.parse().ok()?;
        match key {
            "brightness" => brightness = number,
            "contrast" => contrast = number,
            "saturation" => saturation = number,
            "gamma" => gamma = number,
            "gamma_r" => gamma_r = number,
            "gamma_g" => gamma_g = number,
            "gamma_b" => gamma_b = number,
            "gamma_weight" => gamma_weight = number,
            _ => return None,
        }
    }
    // gamma_weight distinto de 1 introduce mezcla lineal+potencia; las
    // cadenas generadas nunca lo usan, pero se respeta la fórmula igual.
    let _ = gamma_weight;

    let luma_gamma = (gamma * gamma_g).clamp(0.1, 10.0);
    let u_gamma = (gamma_b / gamma_g).sqrt().clamp(0.1, 10.0);
    let v_gamma = (gamma_r / gamma_g).sqrt().clamp(0.1, 10.0);

    let y = eq_plane_expr(contrast, brightness, luma_gamma, gamma_weight);
    let u = eq_plane_expr(saturation, 0.0, u_gamma, gamma_weight);
    let v = eq_plane_expr(saturation, 0.0, v_gamma, gamma_weight);
    Some(format!("lutyuv=y='{y}':u='{u}':v='{v}'{enable}"))
}

/// Expresión `lutyuv` equivalente a la LUT de un plano de `vf_eq.c`.
/// `val` llega en 0-255; el neutro de contraste es 127.5 como en la LUT
/// (`i/255` con punto medio 0.5).
fn eq_plane_expr(contrast: f64, brightness: f64, gamma: f64, gamma_weight: f64) -> String {
    // v = contrast*(val-127.5)+127.5+brightness*255  (en unidades 0-255)
    let linear = format!("({contrast:.6}*(val-127.5)+127.5+{:.6})", brightness * 255.0);
    // eq: v<=0 → 0; si no, v = v*(1-w) + pow(v,1/g)*w  (v normalizado);
    // v>=1 → 1. gamma_weight=1 → lw=0 → sólo la potencia.
    let positive = format!("clip({linear},0,255)");
    if (gamma - 1.0).abs() < 1e-9 && (gamma_weight - 1.0).abs() < 1e-9 {
        return positive;
    }
    let lw = 1.0 - gamma_weight;
    // mezcla: v_norm*(lw) + pow(v_norm,1/g)*gw  → en 0-255. El `*255` va
    // DENTRO del primer argumento de `clip`: `clip(EXPR)*255,0,255` lo
    // parsea ffmpeg como clip de un arg + cola inválida (EINVAL en runtime).
    format!(
        "clip((({positive})/255*{lw:.6}+pow(({positive})/255,{:.6})*{gamma_weight:.6})*255,0,255)",
        1.0 / gamma
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traduce_eq_basico_a_lutyuv() {
        let out = rewrite_eq_filters("eq=brightness=0.1000:contrast=1.1000:saturation=0.9000");
        assert!(out.starts_with("lutyuv=y='"), "{out}");
        assert!(out.contains(":u='"), "{out}");
        assert!(out.contains(":v='"), "{out}");
        assert!(!out.contains("eq="), "{out}");
    }

    #[test]
    fn respeta_gamma_por_canal() {
        let out = rewrite_eq_filters(
            "scale=640:360,eq=brightness=0:contrast=1:saturation=1:gamma_r=1.2:gamma_g=0.9:gamma_b=1.1",
        );
        assert!(out.contains("lutyuv="), "{out}");
        assert!(out.contains("pow("), "{out}");
        // Regresión: `clip(EXPR)*255,0,255` lo rechaza el eval de ffmpeg
        // (EINVAL en runtime). El `*255` debe quedar dentro del clip:
        // forma correcta `clip(((pos)/255*lw+pow(...)*gw)*255,0,255)`.
        assert!(out.contains("clip(((clip("), "{out}");
        assert!(!out.contains("clip((clip("), "{out}");
        // La escala previa queda intacta.
        assert!(out.starts_with("scale=640:360,"), "{out}");
    }

    #[test]
    fn no_toca_cadenas_sin_eq_ni_eq_no_numericos() {
        let plain = "hue=s=0.5,eq=brightness='0.1*n'";
        assert_eq!(rewrite_eq_filters(plain), plain);
        let none = "scale=640:360,hue=h=90";
        assert_eq!(rewrite_eq_filters(none), none);
    }

    #[test]
    fn multiple_eq_en_filter_complex() {
        let graph = "[0:v]eq=brightness=0.5[seg0];[1:v]eq=contrast=1.4[seg1];[seg0][seg1]concat=n=2:v=1[v]";
        let out = rewrite_eq_filters(graph);
        assert_eq!(out.matches("lutyuv=").count(), 2, "{out}");
        assert!(!out.contains("eq="), "{out}");
        assert!(out.contains("[seg0]"), "{out}");
    }

    #[test]
    fn preserva_enable_con_comas_dentro_de_comillas() {
        let graph = "eq=brightness=0.1:contrast=1:saturation=1.1:enable='between(t,0.800000,2.000000)'";
        let out = rewrite_eq_filters(graph);
        assert!(out.starts_with("lutyuv="), "{out}");
        assert!(
            out.contains(":enable='between(t,0.800000,2.000000)'"),
            "{out}"
        );
        assert!(!out.contains("eq="), "{out}");
    }

    #[test]
    fn no_confunde_prefijos_parecidos() {
        // `noteq=` o `freqeq=` no deben traducirse.
        let chain = "noteq=foo=1";
        assert_eq!(rewrite_eq_filters(chain), chain);
    }
}
