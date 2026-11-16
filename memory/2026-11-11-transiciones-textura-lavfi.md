# 2026-11-11 — Transiciones por textura lavfi (`textura-luz`/`textura-celular`)

## Qué se hizo

Equivalente propio y legal de `transicoes_cine.js` de AlaukCut (31
transiciones por texturas JPG propietarias): 2 transiciones nuevas cuyo
"asset" es una fuente lavfi sintética de FFmpeg — `gradients` (destello
cálido radial) y `cellauto` (autómata celular → lluvia digital azul).

## Arquitectura (por si se agregan más texturas)

- `visual/texture_input.rs` (include! en visual.rs): kind desde
  `transitionIn.type` `textura-*`; `prepare_texture_input` añade
  `-f lavfi -t lead+0.25 -i <spec>` como input extra (mismo mecanismo
  que `prepare_frame_input` del monitorFrame); `texture_stream_prep` +
  `texture_overlay_segment` generan el sub-grafo de overlay.
- `visual_filter_with_format` ganó `texture_input: Option<usize>`; los
  overlays extra (marco → textura) se encadenan en el split post
  fit-scale dentro de `chain_with_frame` (ramas lineal y `fit=blur`).
- `plan/range.rs` prepara el input tras `prepare_frame_input`;
  `preview_frame/render.rs` pasa `None` (sin lead en frame suelto).
- El match de `transitionIn` en filter.rs empuja `fade alpha` extra
  para `textura-*` → el entrante disuelve debajo del lavado.

## Gotchas de FFmpeg aprendidos (verificados con smoke real)

- `geq` exige al menos UNA expresión de color (r/g/b/lum) además de la
  de alfa — `geq=a='...'` solo falla con "luminance or RGB expression
  is mandatory".
- `lum(x,y)` NO existe en geq → luminancia BT.601 manual:
  `0.2126*r+0.7152*g+0.0722*b` (escala 0-255).
- `gradients` acepta `type=radial|linear|circular|spiral|square`,
  `nb_colors` 2-8, `c0..c7`, `speed`, `seed`; `x0/y0/x1/y1` son int
  (no expresiones — `-1` = centro por defecto).
- `cellauto` no tiene opción `duration` (el `-t` va en el input);
  opciones reales: `rule` (0-255), `ratio`, `seed`, `scroll`,
  `start_full`, `stitch`, `size`, `rate`.
- `overlay=...:eof_action=pass` deja pasar el stream principal cuando
  la textura lavfi termina (`-t lead+0.25` la limita).

## Verificación

cargo test extra_transitions ok · visuals+preview_frame 26/26 ·
TransitionPreview 40/40 · visuals+thumbnails 49/49 · schema 393/393 ·
tsc 0 errores · smoke ffmpeg: ambas cadenas renderizan y el frame
mid-lead difiere del render sin textura.

## Límites

2 texturas fijas (no 31); overlay sólo en el entrante (no full-screen
sobre el saliente); preview frame congelado NO soporta `textura-*`
(fallback no-congelable); alfa por luminancia oculta zonas oscuras.

## Ampliación (mismo día): + `textura-fractal` + `textura-vida`

Cuarta variante del mecanismo: `mandelbrot` (zoom fractal cinematográfico,
`start_scale`→`end_scale` sobre `end_pts`; generado a MEDIA resolución y
re-escalado en la cadena con `scale=flags=fast_bilinear` — el coste es
por píxel) y `life` (Game of Life con `life_color`/`death_color`/
`mold_color` nativos, sin tinte geq). Gotcha extra: el assert del test
debe actualizarse cuando cambia la expresión geq (`lum()` → BT.601).
Smoke: ambas fuentes parsean y renderizan frames.
