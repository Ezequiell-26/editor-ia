# 2026-11-08 — Receta FFmpeg para `light.flare`

Pasada del loop de mejora (Devin CLI). Uno de los 2 efectos «sólo preview»
que quedaban del catálogo (`docs/DRIFT-PARITY.md` §5); ahora queda sólo
`light.leak`.

## Qué se hizo

- `packages/effect-kit/src/catalog/video.ts`: el manifiesto `light.flare`
  ganó `ffmpeg.graph` — `split=2`, base en `format=gbrp`, overlay generado
  por `geq` píxel a píxel con los mismos `smoothstep` del shader GLSL
  (core `smoothstep(size,0,d)`, anillo
  `smoothstep(size*1.4,size,|d-size*0.9|)*0.5`, ghost especular en
  `1-position` `smoothstep(size*0.6,0,|mirror|)*0.6`), todo por
  `tint*intensity`, y `blend=all_mode=screen` que reproduce la mezcla
  `1-(1-c)(1-light)`.
- Truco de coordenadas (igual que `twirl`): `p=(DX,DY)/H` con
  `DX=X+0.5-position.x*W`, `DY=Y+0.5-position.y*H`, porque `aspect=W/H`.
- `catalog.test.ts`: test nuevo de la receta + el test de stack pasó de
  `light.flare` a `light.leak` (sigue siendo el único preview-only).
- `effect_recipes.rs` regenerado: 77 recetas.
- Test Rust `effect_stack_expands_flare_graph_with_filled_params` en
  `ffmpeg.rs` — **sin commitear** (el archivo mezcla ~1500 líneas de WIP
  del usuario, misma situación que pasadas anteriores).

## Verificación real

- FFmpeg n9.0.2 empaquetado: grafo completo corre sobre `testsrc2`
  320×180 sin error.
- YAVG de crops vs frame sin filtrar: core (x≈230,y≈50) **+48,4**;
  ghost (x≈90,y≈130) **+4,6**; esquina **+0,0**.
- Overlay solo: píxel (230,50) RGB medido **(152,130,96)** vs **(153,130,96)**
  calculado con la fórmula del shader (diff ≤1, redondeo); (10,10) = (0,0,0).
- vitest effect-kit **47 passed / 3 skipped**; vfx desktop 25/26 (1 fallo
  ajeno preexistente en `EffectTemplates.test.tsx`).

## Límites honestos

- `fidelity: 'approximate'`: smoothstep manual en gramática `geq`, posible
  espejo del eje Y, `format=gbrp` descarta alfa, coste alto por píxel.
- Queda `light.leak` preview-only: usa `ek_fbm` (4 octavas de value noise);
  `geq` no tiene ruido — haría falta aproximación con senos o un generador
  de ruido FFmpeg.
