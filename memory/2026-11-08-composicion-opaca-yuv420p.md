# 2026-11-08 — Composición opaca en yuv420p (cola #18)

## Qué se hizo

El grafo de render FFmpeg componía **siempre en RGBA**: `[0:v]format=rgba`
para la base, `format=rgba` al inicio y al final de cada `visual_filter`, y
`format=rgba` en las capas de blend. Una timeline de cortes simples pagaba
dos conversiones de color por frame (yuv→rgb→yuv) sin necesidad.

Ahora `composition_needs_alpha` (`render/ffmpeg/plan/alpha.rs`) decide una
vez por render y el plano de composición entero usa `yuv420p` cuando ningún
clip lo necesita.

## Regla (conservadora)

Fuerza `rgba` si cualquier clip visible tiene:

- `blendMode` válido, `chromaKey` con `#RRGGBB`, `mask.shape` no vacío
  (texto o geometría — ambos escriben alfa con geq/alphamerge)
- `transform.opacity < 0,999`, `opacityFrozen`, keyframes con `opacity` o
  `rotationDeg`, keyframes de `scale` con mínimo <0,999 (el `pad black@0`
  de la curva dinámica necesita alfa; scale ≥1× va por zoompan sin alfa)
- `rotationDeg` ≠0, `transform.perspective` no identidad (esquinas
  transparentes), `animationIn/Out` tipo `fade`, `animationFrozen.alpha`,
  `fadeFrozen`, `transitionFrozen`
- `transitionIn` con lead >0 salvo `fade-black`/`fade-white`/`dip-color`/
  `slide-*` (esos no tocan alfa; dissolve/wipe/iris/slide-3d/luma-wipe sí)
- asset `media.alpha`, `kind=="image"` (PNG/WebP pueden traer alfa),
  `kind=="graphic"` NO fuerza (se quema por ASS después del compuesto)
- efectos: `glow` con intensidad, `relight` activo, `fadeInFrames/OutFrames`,
  LUT con intensidad parcial (el `blend` de mezcla usa `format=rgba`) — lo
  mismo para `project.look` y clips de ajuste

## Archivos

- `render/ffmpeg/plan/alpha.rs` (nuevo): `composition_needs_alpha`,
  `clip_needs_alpha`, `lut_needs_alpha`
- `render/ffmpeg/plan.rs`: `include!("plan/alpha.rs")`
- `render/ffmpeg/plan/range.rs`: `compose_format` una vez por plan; base,
  `visual_filter_with_format` y capa de blend lo usan
- `render/ffmpeg/visual/filter.rs`: `visual_filter` queda como wrapper rgba
  (preview y tests); `visual_filter_with_format` parametriza los tres
  `format=` de composición (inicio, post-zoompan y cierre)
- `render/ffmpeg.rs`: export de `visual_filter_with_format`
- `render/ffmpeg/tests.rs`: 4 tests de plan + 1 live A/B ignorado

## Verificación

- `cargo test --lib`: **697 passed, 0 failed** (52 ignored live)
- Tests nuevos: opaco→`format=yuv420p` sin ningún `format=rgba` en el grafo;
  14 features→rgba; transiciones/assets; fades a color + slide + keyframes
  de escala≥1/posición→yuv
- Live A/B (`EDITOR_IA_RUN_RENDER_TESTS=1`): misma timeline renderizada por
  la ruta yuv420p y por la ruta rgba forzada (reemplazo de strings en
  `plan.args`, sin hooks globales — un env var de prueba contaminó tests en
  paralelo y se descartó) → **PSNR 40,87 dB**, duración verificada por
  `execute_sync` en ambas

## Límites honestos

- La salida **no es bit-idéntica**: el pase por RGBA hace una conversión
  extra de color; las diferencias son de redondeo (±1-2 LSB) más el ruido
  del encode. El test exige >40 dB.
- `kind=="image"` fuerza rgba aunque la imagen no tenga alfa (no hay probe
  de alfa para stills en el asset): conservador, se puede afinar si el
  probe empieza a reportarlo.
- `scaleFrozen` con keyframes de escala<1 se clasifica como alpha aunque el
  camino zoompan no lo necesitaría: conservador.
- El beneficio medido es estructural (menos conversiones por frame); no se
  midió tiempo de render en este pase — el −32% del benchmark externo
  queda como referencia, no como medición propia.
