# 2026-11-08 — Receta FFmpeg para `impact.zoom_pulse`

Pasada del loop de mejora (Devin CLI). Ítem elegido de `docs/DRIFT-PARITY.md`
§5: efectos «sólo preview» sin receta de export.

## Qué se hizo

- `packages/effect-kit/src/catalog/video.ts`: `impact.zoom_pulse` gana
  `ffmpeg.graph` — `split` + `scale eval=frame` + `overlay eval=frame
  format=auto`. La curva del punch es la misma del shader:
  `1+amount*exp(-6*(t*rate-floor(t*rate)))` (fract → floor, sin comas para
  no romper el filtergraph).
- `apps/desktop/src-tauri/src/render/effect_recipes.rs`: regenerado con
  `npm run effects:codegen` (71 recetas).
- `apps/desktop/src-tauri/src/render/ffmpeg.rs`: test nuevo
  `effect_stack_expands_zoom_pulse_graph_with_filled_params`.
- `docs/DRIFT-PARITY.md`: conteos 40→41 exportan / 8→7 preview-only, lista
  de grafos 7→8, y «keyframes en export» marcado resuelto (estaba stale).

## Decisiones técnicas

- **Ancla del zoom**: el overlay se posiciona en `x=cx*(W-w)`, `y=cy*(H-h)`.
  Deducido del mapeo: `scale` ancla arriba-izquierda, así que para que el
  punto normalizado `center` quede fijo hace falta offset `c·(W−w)`.
  Verificado: con center 0.5 queda centrado; con 0.5/0.5 el test lo afirma.
- **`t` de `eval=frame`** es el timestamp local del clip (segundos), igual
  que `u_time` del shader — la fase del punch coincide.
- **Fidelidad `approximate`**: el remuestreo es lanczos de `scale`, no el
  bilineal del shader; declarado en `note`.
- Quedan 7 preview-only: `light.leak`, `light.flare`, `blur.zoom`,
  `stylize.halftone`, `glitch.wave`, `distort.ripple`, `distort.twirl`.

## Verificación (ejecutada)

- FFmpeg real empaquetado (`resources/ffmpeg/ffmpeg.exe`, n9.0): grafo OK;
  `showinfo` midió escala 416×312 en frame 0 (zoom 1,3 = pico) y 384×288 en
  frame 1 — coincide con `exp(-6·phase)`.
- `npx vitest run` en `packages/effect-kit` → **36/36** (3 live skipped).
- `npx tsc --noEmit` effect-kit → 4 errores **preexistentes** del WIP del
  usuario en `engine.test.ts` (readonly/keyframes Bézier; sin relación).
- `node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop --lib
  effect_stack` → **5/5** (compilación completa de la crate, ~6,5 min).

## Git

Commiteado: catálogo, `effect_recipes.rs`, `DRIFT-PARITY.md`, esta memoria y
la entrada de cola. **NO commiteado**: el test en `ffmpeg.rs` — el archivo
mezcla ~1200 líneas de trabajo concurrente del usuario; commitearlo
arrastraría ese WIP. Queda en el árbol de trabajo junto al resto.
