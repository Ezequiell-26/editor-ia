# Kdenlive como referencia viva

El usuario pidió usar [kde/kdenlive](https://github.com/kde/kdenlive) como
referencia constante para portar funciones a Olyvia, poco a poco y con
evidencia. Este documento es el mapa de módulos y la cola de ports.

**Licencia**: Kdenlive es GPL. Se estudia su código para entender algoritmos e
ideas; NO se copia código. Las implementaciones en Olyvia son independientes
en Rust/TS (o usan crates ya integrados como `filmcraft-*`).

Clone local de referencia: `D:\DevCache\kdenlive-ref` (shallow).

## Mapa de módulos

| Kdenlive (`src/`) | Qué hace | Estado en Olyvia | Port pendiente |
|---|---|---|---|
| `scopes/audioscopes` | Oscilograma, espectro, espectrograma por clip | **Hecho**: `audio_scope_analyze[_asset]` en Rust (FFT de filmcraft-audio-dsp) + `AudioScopesPanel` en Mixer + **`PreviewAudioScopes`**: oscilograma/espectro en vivo del bus master Web Audio en el monitor | — |
| `scopes/colorscopes` | Waveform, vectorscope, histograma, parade | Hecho: scopes en vivo del monitor (`ScopesPanel`: onda/vectores/histograma/**parade RGB**) + análisis FilmCraft sobre frame real | — |
| `audiomixer` | Faders, sliders, medidores, ducking | Hecho: MixerView + LiveMeters + loudness BS.1770 | — |
| `timeline2/model` | Clips, tracks, groups, snapping, compositions | Hecho: timeline schema + snapping + grupos | Snapping por intervalo/cara (edge) más rico |
| `effects/effectstack` | Pila de efectos con keyframes por parámetro | **Hecho**: keyframes por parámetro con ◆ en EffectStudio (preview GPU ya los muestreaba) + export segmentado `split/trim/concat` en video **y audio** (`atrim` por samples + `concat`, parámetros muestreados por tramo medio, tope 32) + **Bézier por parámetro** (schema `bezier`, `cubicBezierProgress` en preview y export) | — (UI ◆ en ambos stacks; Bézier por datos/MCP) |
| `renderpresets` | Perfiles de render con nombres/params | Hecho: perfiles + presets de compresión + cola durable | — |
| `titler` | Editor de títulos | Parcial→mejorado: 11 plantillas + **formas** (`shape:'rect'\|'ellipse'\|'triangle'\|'diamond'\|'star'` en capas rect → polígono `\p1` en ASS y `clip-path` en preview) | Forma custom (puntos libres), editor visual de titler |
| `transitions` | Transiciones con geometría | Hecho: catálogo + **dip-color** (color elegible) + **wipe-\*** direccional (máscara `geq` progresiva, preview congelado) | slide 3D, luma wipe con mate |
| `bin` | Media pool, proxies, thumbnails | Hecho: assets + proxies + thumbnails | — |
| `monitor` | Preview con scopes y transport | Hecho: preview + scopes de color **en vivo** (muestreo canvas cada ~180 ms) + scopes de audio del bus master | — |
| `utils/gentime`, `timecode` | Timecode/drop-frame, conversión frames↔tc | **Hecho**: DF en export EDL (`edl.rs`) y sync multicam (`multicam-timecode.ts`) | — (display DF ya en `formatTimecode`) |
| `timeline2` in/out points | Rango de trabajo I/O de la secuencia (I/O/Alt+X) | **Hecho**: `store.ioRange` + atajos reasignables + overlay en regla + snap targets + init de rango en export + **persistencia en `.olyp`** como `x-ioRange` (namespace `x-` del schema, sin bump de versión) | — |
| `capture` | Grabación | Hecho: grabador OBS-like | — |

## Cola de ports (orden sugerido)

1. ~~**Scopes de audio**~~ — **hecho completo**: núcleo Rust + scope del
   clip bajo el playhead (`playhead-audio-scope.ts` + selector de ventana
   en `AudioScopesPanel`) + **scopes del audio ya mezclado en el monitor**
   (`PreviewAudioScopes`, oscilograma/espectro del AnalyserNode del bus
   master, 2026-11-08).
2. ~~**Keyframes de efecto en export**~~ — **hecho**: render segmentado
   (split+trim+concat por tramo de keyframes) en `apply_effect_stack_animated`;
   la evidencia FFmpeg (`eq`/`hue`/`gblur` evalúan al init, `sendcmd` no
   comanda `eq`) quedó en el comentario del módulo. Pendiente:
   ~~`audioStack`~~ y ~~curvas Bézier por parámetro~~ — **ambos hechos**:
   `bezier` (CubicBezierSchema, misma convención que transform) resuelto con
   `cubicBezierProgress` en preview y export, y el audioStack segmentado con
   `atrim start_sample/end_sample` + `concat` (verificado con FFmpeg real:
   RMS −38 dB vs −24 dB por tramo). ~~UI para keyframes/curva en el
   audioStack~~ — **hecha (2026-11-08)**: `AudioEffectStack` reenvía
   `keyframeFrame` a `EffectStackPanel` y `Inspector` pasa el `localFrame`
   del clip; el ◆ y el auto-key del slider funcionan igual que en video.
3. ~~**Snapping por bordes de clip**~~ — **verificado**: `state/snapping.ts`
   ya emite targets para inicio **y** fin de cada clip (`clip` kind),
   excluyendo el clip arrastrado; `timeline-snap.ts` suma escenas, beats e
   I/O. Tests en `snapping.test.ts`/`timeline-pro.test.ts`.
4. **Transiciones adicionales** con geometría real — `dip-color` **hecho**
   (2026-11): enum+`color` opcional en `ClipTransitionSchema` (obligatorio
   para dip-color vía superRefine), `fade=t=in:color=0x…` en el clip
   entrante, modo `color` con curvas afines por canal en el clip saliente
   congelado (`ffmpeg.rs`), `transitionFrozen.mode="color"` en preview,
   `freezable_transition`, picker de color en Inspector, preset en
   EditorAssets y `applyTransitionToCuts({color})`.
   **Wipe direccional (2026-11)**: `wipe-left|right|up|down` en el enum;
   `wipe_transition_filter` emite `geq` con máscara de alfa progresiva
   (`p = min(1, N/lead_frames)`, `alpha(X,Y)` preservada) — el clip
   entrante se revela por el borde que barre y el saliente queda intacto
   debajo. Verificado con FFmpeg real (alpha_avg 0→99→227 en el barrido).
   Preview: `transitionFrozen {mode:"wipe",kind,progress}` →
   `wipe_frozen_filter` con `p` constante. UI: 4 opciones en Inspector,
   pestaña «Barrido» + 4 presets en EditorAssets. Pendiente: slide 3D
   y luma wipe con clip mate.
5. **Titler**: formas y plantillas — **avanzado**: `MotionRectLayer.shape`
   (`rect`|`ellipse`|`triangle`|`diamond`|`star`|`pentagon`|`hexagon`|
   `arrow`) con plantilla `badge` (selector Forma); `polygon_drawing` en
   `render/motion.rs` genera el polígono ASS y `MotionPreview` usa
   `border-radius`/`clip-path`/`regularPolygonClipPath`/`arrowClipPath`
   con los mismos vértices. Pendiente: formas custom y editor visual.
6. ~~**Scopes de color en vivo**~~ — **verificado ya implementado**:
   `ScopesPanel` en `Preview.tsx` samplea el medio real del monitor por
   canvas cada ~180 ms (`computeScopes`: onda/vectores/hist/parade) durante
   playback y scrubbing, y sube a FilmCraft sobre `realFrame.path`.

## Reglas del port

- Un subsistema por pasada; tests Rust/TS antes de declarar hecho.
- Documentar en `IMPROVEMENT-QUEUE.md` / `CAPABILITY-MATRIX.md` cada avance.
- No afirmar paridad con Kdenlive: Olyvia tiene su propia arquitectura
  (Tauri+React+FFmpeg) y sólo toma las funciones.
