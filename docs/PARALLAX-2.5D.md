# 2.5D y parallax (Fase 4)

Fecha: 2026-10-30. Presets de profundidad construidos sobre el motor de
movimiento existente: **dos capas** (fondo y recorte) con movimientos de
distinta intensidad. No hay segmentación automática: el recorte lo aporta el
usuario como PNG/WebM con alfa.

## Presets (`PARALLAX_PRESETS`)

| Preset | Capas | Fondo | Primer plano |
|---|---:|---|---|
| `ken-burns` | 1 | zoom-in lento | — |
| `background-drift` | 1 | paneo suave | — |
| `parallax-soft` | 2 | paneo ×0,35 | paneo ×1,0 |
| `cinematic-push-in` | 2 | zoom-in ×0,5 | zoom-in ×1,0 |
| `cinematic-pull-out` | 2 | zoom-out ×0,5 | zoom-out ×1,0 |
| `foreground-separation` | 2 | paneo ×0,25 | paneo ×0,9 |
| `depth-zoom` | 2 | zoom-in ×0,25 | zoom-in ×1,0 |
| `camera-pan` | 2 | paneo ×0,6 | paneo ×1,0 |
| `camera-tilt` | 2 | paneo vertical ×0,6 | paneo vertical ×1,0 |

La intensidad se acota a 0,02–0,5 (mínimo del schema) por capa. La dirección
(`left/right/up/down`) decide el paneo; los presets de zoom la ignoran.

## API y agentes

- `addParallaxScene(project, options)` en `state/parallax.ts`: crea pistas
  nuevas (fondo abajo, recorte arriba), monta ambos clips con la misma duración
  y aplica los `ClipMotion` correspondientes. Devuelve ids de clips y pistas.
- Herramienta `parallax_add` en el asistente y en el servidor MCP del proyecto
  (misma validación y ejecución). Argumentos: `backgroundAssetId`,
  `foregroundAssetId?`, `preset`, `direction?`, `intensity?`, `atFrame?`,
  `durationFrames?`.
- El router marca `parallax` como **partial** y `engine_catalog` lo informa.

## Verificación

- **7 tests unitarios**: los 9 presets, movimiento relativo, tracks ordenadas,
  zoom relativo, una sola capa, errores de recorte/material/tipo y clamps de
  intensidad.
- **3 tests** del movimiento de preview (`motionPreview`): paneo lineal en
  intensidad/progreso, zoom in/out y los cuatro paneos.
- **1 test de UI**: el panel aparece en Motion y muestra la indicación de
  importar materiales cuando no hay assets.
- **Render real FFmpeg** (`render_live_parallax_moves_layers_at_different_speeds`,
  `EDITOR_IA_RUN_RENDER_TESTS=1`): dos PNG generados, fondo con barra blanca y
  recorte rojo con alfa, paneos 0,05 vs 0,4. En el MP4 el fondo se movió
  **12 px** y el recorte **102 px** entre 0,05 s y 0,85 s; la prueba exige que
  el recorte se mueva al menos 8 px más que el fondo.

## Interfaz

La vista **Motion** incluye el panel **Parallax y profundidad** después de la
biblioteca de overlays: selects de fondo y recorte, preset, dirección,
intensidad, duración y el botón **Crear composición**. Sin materiales muestra
la indicación de importar en Medios; con dos capas exige el recorte. La
composición se selecciona y abre el editor.

## Límites

- Sin mapa de profundidad ni segmentación automática: no se inventa un recorte.
- Sin cámara virtual 3D ni perspectiva real; el parallax es 2D con capas.
- El panel está en Motion; no hay un editor de profundidad por capas ni
  preview específico de parallax (se usa el preview normal del timeline).
- La exportación usa los mismos `zoompan`/motion que cualquier foto; no hay un
  renderer nuevo.
