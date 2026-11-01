# 2026-11-01 — Montaje inteligente, recorte con ripple y presets de descarga

Vuelta pedida por el usuario: "mejorar la inteligencia de la app para crear y
editar videos, sincronizar voz, subtítulos, transiciones, editor, descargas
customizables, renderizado y rendimiento".

## Qué se hizo

1. `apps/desktop/src/state/smart-transitions.ts` (nuevo, 15 tests)
   Plan de transiciones por corte. Reglas: planos < 0,75 s → disolvencia;
   cambio de material → fundido a negro con easing lineal; foto→foto →
   disolvencia (barrido alternado con ritmo `punchy`); video→video con voz a
   ambos lados → disolvencia; video sin voz → desplazamiento alternado.
   Topes: 2 s / 120 frames / plano más corto. Determinista.

2. `apps/desktop/src/state/caption-timing.ts` (nuevo, 13 tests)
   Reparto de subtítulos por peso de habla (caracteres visibles + pausa de
   puntuación), reparto por agua con mín/máx, redondeo que suma exacto y avisos
   por CPS > 17 y por bloques que exceden el máximo.

3. `state/auto-edit.ts`: `transitionStyle: 'smart' | 'dissolve'` (default
   smart), `transitionRhythm`, `captionTiming: 'speech' | 'proportional'`
   (default speech), `maxCaptionCps`. Las transiciones se aplican en una segunda
   pasada con las duraciones reales; `plan.transitionSummary` resume el plan.
   `transitionFrames: 0` sigue significando corte seco.

4. `features/production/ProductionView.tsx`: selector de ritmo, etiqueta nueva
   de duración base y resumen del plan en la revisión.

5. `rippleTrimClip` en `state/project-actions.ts` + atajo `Ctrl+Shift+→`
   (`edit.rippleTrimOut`) en `App.tsx` y `state/shortcuts.ts`. Delega el
   recorte en `trimClip` sobre una copia sin los clips posteriores (no duplica
   la aritmética de velocidad) y luego corre los posteriores el mismo delta.

6. `features/download/presets.ts` (nuevo, 13 tests) + tarjeta "Mis presets" en
   `DownloadView.tsx` (2 tests de UI). Persisten en
   `editor-ia.download.presets.v1`, máximo 24, sin duplicados por nombre,
   saneado de tipos al leer.

## Verificación

- `npm run typecheck` verde.
- `npm test` → **1896/1896 en 245 archivos** (serial) (con TMPDIR al repo, ver abajo).
- Ojo: dos corridas intermedias devolvieron 1698/1720/1828 tests por un
  `EPERM` del shim de FS sobre el directorio temporal de Vitest. La corrida
  limpia y repetida da 1857. Si vuelve a pasar, repetir antes de declarar rojo.

## Ciclo 2 (mismo día)

- `features/autoedit/apply-auto-edit.ts`: el otro motor de montaje (variantes
  desde `MediaAnalysis`) usa el plan inteligente con ritmo por estilo
  (pulso→punchy, historia→calm, impacto→steady). Corrige además un bug real:
  ponía 5 u 8 frames fijos y el esquema rechaza
  `transitionIn.frames > durationFrames` si el corte es más corto.
  3 tests nuevos en `apply-auto-edit.test.ts`.
- Emoji diferido (ítem 17 `[done]`): `EmojiPicker` 719,71 kB → **6,17 kB**
  (113,13 → 2,43 gzip); `emoji-data` 214,93 kB y `emoji-es` 499,49 kB pasan a
  chunks que sólo se bajan al abrir el selector. Build medido.
- **Truco de entorno**: si Vitest tira `EPERM` sobre el temporal y pierde
  archivos, correr con `TMPDIR="$PWD/.tmp-vitest" TEMP=… TMP=… npm test`.
  `.tmp-vitest` ya está excluido en `vitest.config.ts`.

## Ciclo 2 (mismo día)

- `features/autoedit/apply-auto-edit.ts`: el otro motor de montaje (variantes
  desde `MediaAnalysis`) usa el plan inteligente con ritmo por estilo
  (pulso→punchy, historia→calm, impacto→steady). Corrige además un bug real:
  ponía 5 u 8 frames fijos y el esquema rechaza
  `transitionIn.frames > durationFrames` si el corte es más corto.
  3 tests nuevos en `apply-auto-edit.test.ts`.
- Emoji diferido (ítem 17 `[done]`): `EmojiPicker` 719,71 kB → **6,17 kB**
  (113,13 → 2,43 gzip); `emoji-data` 214,93 kB y `emoji-es` 499,49 kB pasan a
  chunks que sólo se bajan al abrir el selector. Build medido.
- **Truco de entorno**: si Vitest tira `EPERM` sobre el temporal y pierde
  archivos, correr con `TMPDIR="$PWD/.tmp-vitest" TEMP=… TMP=… npm test`.
  `.tmp-vitest` ya está excluido en `vitest.config.ts`.

## Ciclo 3 (mismo día)

- **Renderizado inteligente**: `state/render-plan.ts` (20 tests) + tarjeta
  «Plan sugerido» en `ExportDialog`. Decide códec/compresión/CRF/GPU por
  destino (social, web, archive, draft), duración, resolución y hardware;
  estima peso y tiempo con un modelo de bits por píxel; explica y avisa.
  «Aplicar plan» reutiliza `applyCompression` + el toggle de GPU existentes.
- **Fotos**: `automaticPhotoMotion` ahora acepta medidas (`imageWidth/Height`,
  `frameWidth/Height`) y panea en el eje donde sobra imagen en lugar de hacer
  zoom; sin medidas mantiene el ciclo histórico. 10 tests nuevos.
  `auto-edit.test.ts` actualizado (fotos cuadradas en 16:9 → pan-down/pan-up).
- Suite: **1892/1892 en 244 archivos**.

## Ciclo 3 (mismo día)

- **Renderizado inteligente**: `state/render-plan.ts` (20 tests) + tarjeta
  «Plan sugerido» en `ExportDialog`. Decide códec/compresión/CRF/GPU por
  destino (social, web, archive, draft), duración, resolución y hardware;
  estima peso y tiempo con un modelo de bits por píxel; explica y avisa.
  «Aplicar plan» reutiliza `applyCompression` + el toggle de GPU existentes.
- **Fotos**: `automaticPhotoMotion` ahora acepta medidas (`imageWidth/Height`,
  `frameWidth/Height`) y panea en el eje donde sobra imagen en lugar de hacer
  zoom; sin medidas mantiene el ciclo histórico. 10 tests nuevos.
  `auto-edit.test.ts` actualizado (fotos cuadradas en 16:9 → pan-down/pan-up).
- Suite: **1892/1892 en 244 archivos**.

## Ciclo 4 (mismo día) — rendimiento

- **Preview 2D**: `features/editor/scratch-canvas.ts` (4 tests) reutiliza los
  lienzos de trabajo; antes eran dos `createElement('canvas')` de 1280×720 por
  frame. El contexto 2D se pide con `willReadFrequently` (esa ruta hace
  `getImageData` cada frame).
- **Medición**: `npm run bench:preview` (Chrome real, 1080p60). Antes: none 58,
  lut 60, denoise 60, denoise-spatial 54,8, lut+denoise 43,9,
  lut+denoise-spatial 60, vignette 52,3, motionblur 41,3, all 47,1.
  Después: none 60, lut 60, denoise 43,2, denoise-spatial 60, lut+denoise 60,
  lut+denoise-spatial 48,1, vignette 60, motionblur 48,3, all 43,3.
  El ruido entre corridas es ±10 fps: la tendencia es buena, no es garantía.
- **Suite estable**: en paralelo los workers chocan escribiendo el mismo archivo
  de caché SSR y el shim devuelve `EPERM` (conteos 1666/1801/1834/1866).
  `npm run test:serial` con TMPDIR al repo → **1896/1896 en 245 archivos**.
- **Bloqueado**: el ítem 18 (composición opaca yuv420p, −32 % de render) no se
  puede compilar: `editor-ia-desktop.exe` está corriendo y `cargo` falla con
  `os error 32`. No se cierra el proceso del usuario sin permiso.

## Ciclo 5 (mismo día) — render opaco

- `render/ffmpeg.rs`: `project_needs_alpha()` decide el formato del grafo. Si
  nada necesita alfa, base y capas salen en `yuv420p` en vez de RGBA
  (`visual_filter_checked` recibe `opaque`). `preview_frame` sigue en alfa.
- Medición real (worker headless, 10 s 1080p30, 4 cortes opacos, 3 corridas
  alternadas): **3717 → 3411 ms** de mediana (−8,2 %). PSNR Y 55,12 dB,
  SSIM 0,99993.
- El test live de parallax detectó el caso que faltaba: assets con
  `media.alpha: true`. Agregado al predicado.
- Verificación Rust: lib **546 passed** (1 flaky de mock HTTP), live de render
  **23/23** con `EDITOR_IA_RUN_RENDER_TESTS=1`.
- El −32 % del benchmark externo no se reproduce: el escalado sigue pasando por
  RGBA en el `pad`. Queda pendiente atacar ese punto.

## Próximo paso sugerido

- Exponer `transitionRhythm` también en la Fábrica de Variantes y en el
  orquestador (hoy usan el default `steady`).
- Evaluar `transitionStyle: 'smart'` en `features/autoedit` (el otro motor de
  montaje, basado en `MediaAnalysis`) para que las dos rutas coincidan.
- Cola pendiente del proyecto: ítem 18 (composición opaca yuv420p, −32 % de
  render medido por un benchmark externo, falta PSNR/SSIM) e ítem 19 (playhead
  fuera del contexto en Preview).
