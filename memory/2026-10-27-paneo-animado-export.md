# Paneo animado de pista en el export — 2026-10-27

## Qué se hizo

Se cerró la segunda rebanada del ítem 5 de `docs/IMPROVEMENT-QUEUE.md`: medir
el paneo animado de pista (`Track.panKeyframes`) en un MP4 real y compararlo
con la ley de la preview (`sampleTrackPan` + `panGains`).

La medición destapó dos defectos reales del render, corregidos en la misma
vuelta:

- **Línea de comandos demasiado larga**: con paneo animado el plan llegaba a
  **35.271 caracteres** y `Command::spawn` fallaba en Windows (límite 32.767)
  con "no se pudo iniciar ffmpeg". El grafo largo ahora se escribe en
  `filter-graph.txt` dentro del temp del render y FFmpeg lo lee con
  `-/filter_complex <archivo>`; los grafos ≤8.000 caracteres siguen inline.
- **Panic de perspectiva**: `perspective_filter` indexaba
  `perspective["interpolation"]` sobre un `Map` y paniqueaba si el campo
  opcional faltaba (`no entry found for key`). Pasó a `.get(...)`.

## Evidencia medida

- Test nuevo
  `render_live_5s_animated_track_pan_astats_matches_preview`
  (`apps/desktop/src-tauri/src/render/ffmpeg.rs`), 1/1 en 1,12 s. Proyecto de
  5 s a 24 fps, tono estéreo parejo, `panKeyframes`: meseta −0,8 (`hold`),
  tramo Bézier `.42,0,.58,1`, meseta +0,36 (`hold`). Ventanas de 0,4 s
  medidas con `astats`:
  - 0,3–0,7 s: **R−L −13,99 dB** vs **−13,98 dB** de la preview (Δ 0,01 dB).
  - 4,2–4,6 s: **R−L +3,88 dB** vs **+3,88 dB** (Δ 0,00 dB).
  - Movimiento comprobado: 17,87 dB entre las dos ventanas (un paneo estático
    daría la misma diferencia en ambas).
- Golden Bézier de la preview para el tramo central:
  `cubicBezierProgress(48/59, .42, 0, .58, 1) = 0,929319`, medido con node
  sobre `packages/project-schema/src/keyframes.ts`.
- El test verifica que el plan usa `-/filter_complex` y que la línea total
  queda bajo 8.000 caracteres. El unitario
  `long_filter_graphs_use_a_file_and_short_ones_stay_inline` cubre lo mismo
  sin FFmpeg y confirma que un proyecto corto sigue inline (1/1 en 0,34 s).
- Verificación: suite Rust lib **412/412** (47 ignored) en 1,58 s —incluye
  los tests que agregó la sesión concurrente en `projects.rs` y
  `downloader.rs`—; `cargo check -p editor-ia-desktop --lib --tests` verde en
  51,63 s; tests live `render_live_5s_*` **2/2** en 1,41 s; tests de paneo de
  preview **17/17** en 2,31 s; `npm run typecheck` verde; `npm run build`
  verde en 5,75 s. Sin commit, push ni rebuild del instalador.

## Límites honestos

- El grafo leído de archivo requiere FFmpeg 9+; la app empaqueta 9.0.2 y el
  `-filter_complex_script` histórico ya no existe en 9.0.1/9.0.2.
- No se probó con GPU ni con proyectos de muchos clips; el umbral de 8.000
  caracteres deja margen amplio pero no es una cota formal.
- La suite completa del frontend no se corrió: una sesión concurrente estaba
  editando Descargas (`queue.ts`, `DownloadView.test.tsx`, mtime 23:54:38).
  El typecheck sí quedó verde a las 23:54.

## Trampa registrada

El priming de AAC (~21 ms) corre la ventana de medición sobre un barrido
continuo y desviaba **0,85 dB** la primera ventana. Con mesetas `hold` la
medición es inmune a ese corrimiento y el tramo Bézier se ejerce igual. Para
cualquier comparación futura preview vs MP4 con rampas pronunciadas: medir en
plateaus o compensar el priming, no ensanchar la tolerancia.
