# 2026-11-09 — monitorFrame quemado en MP4 (render-worker Rust)

## Qué se hizo

El marco del monitor (`clip.monitorFrame`, 19 presets × 6 estilos) pasó de
preview-only a **quemarse en el MP4 exportado**, replicando el modelo de
`molduras.js` de AlaukCut con código propio.

## Arquitectura implementada

- `visual/monitor_frame.rs` (include! en `visual.rs`):
  - `PRESETS`: tabla de los 19 presets (prop, radios [tl,tr,br,bl],
    thickness, colores, estilo 1-6, hexágono, margen).
  - `frame_box`/`shape_from_box`: réplica de `frameBox`/`frameShape` de
    `monitor-frames.ts` (caja de aspecto `prop` centrada en el content-box,
    margen descontado; lado = min(w,h)).
  - `inside(shape,x,y,inflate)`: SDF implícito — rect redondeado con radios
    por esquina (test de zona de esquina + arco) y hexágono por semiplanos
    consistentes; `inflate` reproduce el offset de trazo SVG.
  - `stroke_cover`: banda = inside(+w/2) − inside(−w/2).
  - `paint_styles`: los 6 estilos (simple, doble+inner, órbita, neón glow,
    flotante sombra+vidrio, polaroid banda rellena) con source-over y
    gradiente diagonal opcional.
  - Rasterizado a PNG RGBA con supersampling 3× (AA por box-downscale) vía
    crate `image` (ya era dependencia).
- `prepare_frame_input`: calcula el tamaño del layer post fit-scale
  (cover ⇒ profile.width×height; contain ⇒ `even_fit` de la media),
  escribe `monitor-frame-{input}.png` en temp_dir y registra
  `-loop 1 -framerate {fps} -i` como input FFmpeg extra.
- `visual/filter.rs`: `visual_filter_with_format` gana parámetro
  `frame_input: Option<usize>`; `chain_with_frame` parte la cadena en
  `frame_split` (post fit, pre scaleX) y emite:
  `head[mfl];[fmi:v]format=rgba,fps=…,setpts=PTS-STARTPTS[mff];[mfl][mff]overlay=0:0,tail`
  → el PNG se compone 1:1 dentro del layer y hereda scaleX, keyframes de
  escala, flips, rotate, perspectiva, opacity, máscaras y transiciones
  congeladas — igual que el overlay SVG del preview.
- `plan/range.rs`: llama `prepare_frame_input` tras asignar el input del
  clip y pasa el índice.

## Verificación

- 5 tests nuevos del rasterizador · suite lib completa 834/834.
- `render_live_pipeline_produces_a_verified_mp4` (env
  `EDITOR_IA_RUN_RENDER_TESTS=1`): MP4 real OK.
- Smoke ffmpeg manual del subgraft con PNG transparente: correcto.

## Diferencias honestas preview↔export

- En export los efectos de clip (brightness/LUT/glow) SÍ tocan el marco
  (en preview el overlay no recibe `effectsStyle`).
- Chroma key puede afectar al marco si coincide el color (raro).
- `visual_filter` simple (preview_frame/thumbnails) pasa `None`: esos
  frames rasterizados no muestran el marco; el preview DOM sí (SVG).

## Lección de entorno

`D:\DevCache\Rust\cargo\registry\src` perdió permisos de escritura y el
Cargo.lock referencia crates no extraídos (rand 0.9.5, zerocopy 0.8.63,
utf-8 0.7.6). Workaround usado: `CARGO_HOME=%TEMP%\cargo-home-oc` +
`node scripts/rust-env.mjs -- cargo …`. Pendiente: `cargo fetch` único
con el CARGO_HOME habitual o revisar ACLs del cache.
