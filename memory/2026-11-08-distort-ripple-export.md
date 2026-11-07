# 2026-11-08 — Receta FFmpeg para distort.ripple (Editor IA)

Pasada del loop de mejora (Devin CLI). Cierra uno de los 4 efectos «sólo
preview» del catálogo (`docs/DRIFT-PARITY.md` §5).

## Qué se hizo

`distort.ripple` ya no depende sólo del preview GPU: el manifiesto declara
`ffmpeg.graph` con `format=gbrp,geq=` y `r/g/b(x,y)` remuestreando en la
coordenada radial que calcula el shader (`uv = v_texCoord +
normalize(p)·sin(d·freq−T·speed)·amp`). `effect_recipes.rs` se regeneró
(75 recetas).

- `packages/effect-kit/src/catalog/video.ts`: constantes `RIPPLE_*` +
  `ffmpeg` en `distort.ripple` (`fidelity: 'approximate'`).
- `packages/effect-kit/src/catalog.test.ts`: +1 test que exige graph geq,
  parámetros resueltos y fidelidad aproximada.
- `docs/DRIFT-PARITY.md` e `docs/IMPROVEMENT-QUEUE.md`: conteos y cola
  actualizados (45/48 exportan; quedan `light.leak`, `light.flare`,
  `distort.twirl`).

## Verificación (ejecutada)

- FFmpeg real empaquetado (n9.0.2): `compileInstance` con
  `amplitude=0.05 frequency=40 speed=0 center=[0.5,0.5]` sobre frame 64×64
  con punto blanco en (16,32) → sale en (17,32). Script en `.tmp-ripple/`
  (ignorado por `.gitignore`).
- `npm run effects:codegen` → `effect_recipes.rs` con `distort.ripple`.
- `npx vitest run packages/effect-kit` → **45 passed / 3 skipped**
  (`catalog.test.ts` 18/18).
- `npx vitest run apps/desktop/src/features/vfx` → **26/26**.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0**.
- `npx tsc --noEmit -p packages/effect-kit/tsconfig.json` → **4 errores
  preexistentes** del WIP del usuario en `engine.test.ts` (sin relación).
- `cargo test -p editor-ia-desktop --lib effect_stack` → **bloqueado** por
  `os error 32` (archivo en uso por otro proceso durante el build script);
  no llegó a compilar tests.

## Límites / pendiente

- `geq` remuestrea con bilineal y puede diferir medio píxel del mapeo a
  `v_texCoord`; el píxel exacto del centro no tiene dirección en el shader.
- Coste alto por píxel (`sqrt`/`sin` por canal); apto para clips cortos o
  proxies, no para render 4K masivo sin medir.
- No se agregó test Rust en `ffmpeg.rs` porque ese archivo mezcla trabajo
  concurrente del usuario sin commitear; la cobertura queda en effect-kit +
  verificación FFmpeg real.
- `IMPROVEMENT-QUEUE.md` ya tenía cambios del usuario sin commitear: queda
  actualizado en el árbol, pero no se commitea para no arrastrar ese WIP.
