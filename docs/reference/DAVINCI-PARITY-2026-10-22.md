# Paridad con DaVinci Resolve · ronda 2026-10-22

Inventario honesto de lo que DaVinci Resolve ofrece por página, contrastado con
lo que Editor IA tiene hoy en código. "Agregado" significa que esta ronda sumó
la función con pruebas; "Parcial" que existe una versión limitada y verificable;
"Falta" que no está y no se simula.

Las capturas de referencia usadas para el inventario son las ocho pantallas de
Resolve aportadas por el usuario (Media, Cut, Edit, Fusion, Color, Fairlight,
Deliver y ajustes de proyecto) más el análisis REA del 2026-10-20.

## Media

| Función de DaVinci | Estado | Dónde |
| --- | --- | --- |
| Importar por arrastre y diálogo nativo | Existe | `features/assets/AssetsPanel.tsx`, `commands/media.rs` |
| Bins manuales | Existe | `asset.bin` + selector en la biblioteca |
| **Smart Bins (reglas guardadas)** | **Agregado** | `state/smart-bins.ts`, chips en `AssetsPanel` |
| Favoritos y etiquetas | Existe | `asset.favorite`, `asset.tags` |
| Metadatos e integridad (SHA-256) | Existe | `packages/project-schema/src/assets.ts` |
| Miniaturas y waveforms | Existe, con cola de 4 | `hooks/useThumbnail.ts`, `hooks/useWaveform.ts` |
| Media Pool con carpetas anidadas | Parcial: un nivel de bin | — |
| Proxy media / optimizados | Falta | — |
| Multicam | Falta | — |

## Cut / Edit

| Función de DaVinci | Estado | Dónde |
| --- | --- | --- |
| Timeline multipista con clips, transiciones y freeze | Existe | `features/editor/Timeline.tsx`, `state/project-actions.ts` |
| Ripple/roll/slip/slide | Parcial: trim y mover con snap | `project-actions.ts` |
| Keyframes de transformación y ganancia | Existe | `timeline.ts`, `Inspector.tsx` |
| Curvas de velocidad | Existe | `ClipSpeed`, inspector |
| Títulos y textos | Existe | `state/title-templates.ts` |
| **Plantillas Lower Third, Text+ y Scroll** | **Agregado** | `title-templates.ts` (10 plantillas) |
| Subtítulos SRT/VTT/ASS con estilo | Existe | `state/subtitles.ts`, `commands/subtitles.rs` |
| Inspector contextual por tipo de clip | Existe | `Inspector.tsx` |
| Edición multicám | Falta | — |
| Fusión de nodos (Fusion) | Falta | — |

## Color

| Función de DaVinci | Estado | Dónde |
| --- | --- | --- |
| Primaries: lift, gamma, gain | Existe | `ClipEffectsSchema`, `render/ffmpeg.rs` |
| **Rueda Offset (cuarta rueda)** | **Agregado** | `timeline.ts`, `Inspector.tsx`, `colorbalance` `rm/gm/bm` |
| Curvas master/RGB | Existe | `ClipCurvesSchema`, `CurveEditor.tsx` |
| Ruedas HSL, temperatura, saturación | Existe | `Inspector.tsx` |
| LUT con intensidad | Existe | `project.look`, `render/ffmpeg.rs` |
| Scopes: waveform, vectorscopio, histograma | Existe | `features/editor/scopes.ts`, `ScopesPanel.tsx` |
| **Scope Parade RGB** | **Agregado** | `scopes.ts`, `ScopesPanel.tsx` |
| Nodos de color / Power Windows | Falta | — |
| Color management HDR / ACES | Falta | — |
| Seguimiento de objetos | Falta | — |

## Fairlight (audio)

| Función de DaVinci | Estado | Dónde |
| --- | --- | --- |
| Mezcla por clip y por pista, gain automatizable | Existe | `audio.gainDb`, keyframes |
| Loudness objetivo (-14 LUFS) y true peak | Existe | `updateAudioMix`, `loudnorm` |
| De-esser, puerta de ruido, EQ | Existe | `render/audio.rs` |
| Waveforms en timeline | Existe | `useWaveform.ts` |
| Mezclador de consola por buses | Falta | — |
| Restauración por IA (voz) | Falta | Candidato MIT: DeepFilterNet |

## Deliver

| Función de DaVinci | Estado | Dónde |
| --- | --- | --- |
| Perfiles de render con códec, CRF, fit y quality gate | Existe | `project.renderProfiles`, `ExportDialog.tsx` |
| Lote de variantes en una carpeta | Existe | `startBatch` |
| **Cola de entregas persistente** | **Agregado** | `state/render-queue.ts`, sección en `ExportDialog` |
| Progreso y cancelación | Existe | eventos `render-progress` / `render-finished` |
| Render en segundo plano con la app abierta | Parcial: la cola drena con el diálogo abierto | — |
| Presets de plataforma (YouTube, Shorts, TikTok) | Existe vía perfiles y cumplimiento | `features/compliance` |

## Fuera del alcance de esta ronda (y por qué)

- **Fusion (nodos)**: es un compositor completo; reimplementarlo no cabe en una
  ronda y ningún repo MIT ofrece paridad real.
- **Multicam y proxy**: dependen de un pipeline de media que hoy no existe;
  hacerlo a medias rompería la promesa de "todo lo que se muestra funciona".
- **HDR/ACES**: el render actual es SDR BT.709; agregar gestión de color sin
  calibración sería una etiqueta vacía.

## Licencias de lo incorporado

| Repo / paquete | Licencia | Uso |
| --- | --- | --- |
| `minisearch` 7.2.0 | MIT | Búsqueda global (`Ctrl+K`) |
| `fflate` 0.8.3 | MIT | Paquete de entrega `.zip` |
| `subsrt` 1.1.1 | MIT | Importación ASS/SSA |

Todo el código de esta ronda (rueda Offset, Parade, cola de render, Smart Bins,
plantillas) es propio, sin dependencias nuevas.

## Verificación de esta ronda

- `npm run typecheck`: limpio.
- Vitest: ver el número exacto en la sección de evidencia del README.
- Rust: `offset_wheel_maps_to_colorbalance_mids` + suite completa.
- La app instalada se verificó por CDP: los chips de Smart Bins, la cola de
  entregas y la rueda Offset aparecen en la UI empaquetada.
