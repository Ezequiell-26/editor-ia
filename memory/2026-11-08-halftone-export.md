# Receta FFmpeg para `stylize.halftone` (pasada loop, 2026-11-08)

Cuarto efecto «sólo preview» del catálogo en tener receta de export, mismo
patrón `geq` que `glitch.wave`/`blur.zoom`/`impact.zoom_pulse`.

## Qué se hizo

- `packages/effect-kit/src/catalog/video.ts`: `halftoneGraph()` construye el
  `graph` con `format=gbrp,geq=` que repite por píxel la cuenta del shader —
  celda `fract(px rotado)−0.5`, `px=(X+0.5)/max({scale},1)`,
  `luma=clip(((0.2126·r+0.7152·g+0.0722·b)/255−0.5)·{contrast}+0.5,0,1)`,
  `radius=(1−luma)·0.62`, `t=clip((radius−len)/0.08,0,1)`, salida
  `t·t·(3−2t)·255`.
- `fidelity: 'approximate'` con nota honesta (muestreo por centro de píxel,
  `geq` costoso).
- `npm run effects:codegen` → 74 recetas en `effect_recipes.rs`.
- Test Rust `effect_stack_expands_halftone_graph_with_filled_params` en
  `ffmpeg.rs` (queda sin commitear: el archivo mezcla WIP del usuario).

## Verificación real

- FFmpeg n9.0.1 sobre `color=gray` 160×120: lunares blancos periódicos cada
  ~11,3 px en y=60 con trama 8 y ángulo 45° (= 8·√2, el período de la trama
  rotada), cobertura ~23 %.
- vitest effect-kit 44/44 · vfx desktop 26/26 · tsc desktop 0 ·
  `cargo test --lib effect_stack` 8/8.

## Lecciones

- `geq` admite `r/g/b(X,Y)` dentro de la expresión de cada plano: la luma
  se lee de los tres planos de entrada en cualquiera de las tres salidas.
- `smoothstep(edge0, edge1, x)` del shader con `edge0 > edge1` (caso del
  halftone) se reproduce como `clip((e0−x)/(e0−e1)... )` — acá
  `t=clip((radius−len)/0.08,0,1)` y el cúbico `t²(3−2t)`.
- Guarda `max({scale},1)` en divisores: `fill_recipe_template` en Rust
  rellena params ausentes con 0 y un `/0` rompería el geq en renders con
  params parciales.
- Ojo: `applyTemplate`/`fill_recipe_template` sustituyen cualquier
  `{token}` — la expresión no puede tener otras llaves.

## Pendiente

Quedan 4 preview-only: `light.leak`, `light.flare` (usan fbm, muy costoso
en `geq`), `distort.ripple`, `distort.twirl` (remuestreo por píxel con
`sqrt`/`atan2`, candidatos `geq` difíciles).
