// Transiciones cinemáticas por textura lavfi (`textura-*`): equivalente
// propio de las `transicoes_cine` de AlaukCut, que usan secuencias de
// imágenes propietarias. Acá el patrón se genera con fuentes sintéticas
// de FFmpeg (`gradients`, `cellauto`): cero assets, cero licencias y
// salida determinista (`seed`/`stochastic_seed` fijos por tipo).
//
// El input lavfi se limita a `lead + margen` y la envolvente alfa del
// overlay sólo existe durante el lead, así que después de la transición
// el clip queda intacto. El overlay se compone en el mismo punto del
// layer que el marco del monitor (post fit-scale): hereda scale,
// keyframes, flip, rotate, perspectiva y opacity.

use serde_json::Value;

/// Tipo de transición textura declarado en `transitionIn.type`.
/// Devuelve el subtipo (`luz`, `celular`, `fractal`, `vida`) o `None`
/// si no es textura.
pub(crate) fn texture_transition_kind(clip: &Value) -> Option<&str> {
    clip["transitionIn"]["type"]
        .as_str()
        .and_then(|kind| kind.strip_prefix("textura-"))
        .filter(|kind| matches!(*kind, "luz" | "celular" | "fractal" | "vida"))
}

/// Spec lavfi de la fuente para cada subtipo. `size` usa el lienzo del
/// perfil (la textura cubre el frame entero durante el lead).
fn texture_source_spec(kind: &str, profile: &Profile) -> Option<String> {
    let size = format!("{}x{}", profile.width, profile.height);
    match kind {
        // Destello de luz (`light leak`): radial cálido que rota lento —
        // el más cercano a las texturas de `transicoes_cine`.
        "luz" => Some(format!(
            "gradients=size={size}:rate={}:type=radial:nb_colors=3:\
             c0=0xfff3d6:c1=0xff8a3d:c2=0xb33a1e:speed=0.04:seed=17",
            profile.fps_arg()
        )),
        // Lluvia digital: autómata celular monocromo que se tiñe a azul
        // en la cadena (geq por canal) — textura «matrix» propia.
        "celular" => Some(format!(
            "cellauto=size={size}:rate={}:rule=30:ratio=0.42:seed=7:scroll=1",
            profile.fps_arg()
        )),
        // Túnel fractal: mandelbrot con zoom lento (start→end scale) —
        // el gesto «2001» cinematográfico. Media resolución + upscale.
        "fractal" => {
            let half_w = (profile.width / 2).max(2);
            let half_h = (profile.height / 2).max(2);
            Some(format!(
                "mandelbrot=size={}x{}:rate={}:maxiter=220:\
                 start_x=-0.74364388703:start_y=-0.13182590421:\
                 start_scale=3.2:end_scale=0.28:end_pts=1000000:\
                 outer=normalized_iteration_count:inner=mincol",
                half_w, half_h, profile.fps_arg()
            ))
        }
        // Vida orgánica: Game of Life con paleta cálida propia
        // (life_color oro / mold azul noche) — textura biológica.
        "vida" => Some(format!(
            "life=size={size}:rate={}:rule=B3/S23:ratio=0.32:seed=11:\
             life_color=0xffd166:death_color=0x05070f:mold_color=0x1b2a4a",
            profile.fps_arg()
        )),
        _ => None,
    }
}

/// Prepara el input lavfi de la textura y devuelve su índice de input
/// FFmpeg. `None` cuando el clip no tiene una transición `textura-*` o
/// el lead es cero (un still nunca muestra transición).
#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_texture_input(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
    args: &mut Vec<String>,
    inputs: &mut usize,
) -> Result<Option<usize>, ProjectError> {
    let kind = match texture_transition_kind(clip) {
        Some(kind) => kind,
        None => return Ok(None),
    };
    let lead = lead_seconds.max(0.0);
    if lead <= 0.0 {
        return Ok(None);
    }
    let spec = match texture_source_spec(kind, profile) {
        Some(spec) => spec,
        None => return Ok(None),
    };
    let index = *inputs;
    *inputs += 1;
    // `-t` limita la fuente al lead + margen; el `eof_action=pass` del
    // overlay deja pasar el clip cuando la textura se acaba.
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-t".into(),
        super::seconds(lead + 0.25),
        "-i".into(),
        spec,
    ]);
    Ok(Some(index))
}

/// Filtros de la textura antes del overlay: fps/pts alineados al stream
/// del clip y alfa con dos envolventes — (a) por luminancia: sólo las
/// zonas brillantes de la textura se ven (efecto «light leak»: el
/// gradiente oscuro no tapa el clip); (b) temporal: fade in los primeros
/// 20 % del lead y fade out los últimos 20 %, así la textura aparece y
/// se disuelve dentro de la transición sin cortarse.
pub(crate) fn texture_stream_prep(
    texture_input: usize,
    kind: &str,
    profile: &Profile,
    lead_seconds: f64,
    input_index: usize,
) -> String {
    let fps = profile.fps_arg();
    let label = format!("mtx{input_index}");
    let fade_in = (lead_seconds * 0.2).max(0.04);
    let fade_out_start = (lead_seconds * 0.8).max(fade_in);
    let fade_out = (lead_seconds - fade_out_start).max(0.04);
    // geq no tiene `lum()`: la luminancia BT.601 se compone por canal
    // (valores 0-255). clip((Y-26)/76) abre el alfa entre ~10 % y ~40 %
    // de luminancia — suave, no un corte duro. geq exige además al
    // menos una expresión de color además de la de alfa.
    let lum = "0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y)";
    let lum_alpha = format!("a='alpha(X,Y)*clip(({lum}-26)/76,0,1)'");
    // `fractal` llega a media resolución desde la fuente: se reescala al
    // lienzo antes del modelado de alfa.
    let upscale = if kind == "fractal" {
        format!(",scale=w={}:h={}:flags=fast_bilinear", profile.width, profile.height)
    } else {
        String::new()
    };
    let geq = match kind {
        // cellauto emite monocromo: se tiñe a azul noche por canal y el
        // fondo negro queda transparente por la envolvente de luminancia.
        "celular" => {
            format!("geq=r='r(X,Y)*0.10':g='g(X,Y)*0.35':b='b(X,Y)*0.85':{lum_alpha}")
        }
        // life ya viene coloreada por la fuente; mandelbrot/gradients se
        // dejan tal cual (sólo modelado de alfa + passthrough de color,
        // que geq exige).
        _ => format!("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':{lum_alpha}"),
    };
    format!(
        "[{texture_input}:v]fps={fps},format=rgba,setpts=PTS-STARTPTS{upscale},{geq},\
         fade=t=in:st=0:d={fade_in:.3}:alpha=1,\
         fade=t=out:st={fade_out_start:.3}:d={fade_out:.3}:alpha=1[{label}]"
    )
}

/// Segmento de overlay de la textura sobre el stream del clip, dentro
/// del split post fit-scale. `main_label` es el label del stream base;
/// la salida queda sin label para que la cola de filtros la continúe.
pub(crate) fn texture_overlay_segment(
    main_label: &str,
    texture_input: usize,
    kind: &str,
    profile: &Profile,
    lead_seconds: f64,
    input_index: usize,
) -> String {
    let prep = texture_stream_prep(texture_input, kind, profile, lead_seconds, input_index);
    format!(";{prep};[{main_label}][mtx{input_index}]overlay=0:0:eval=frame:eof_action=pass")
}
