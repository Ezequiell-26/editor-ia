# Ajustes, onda real, rendimiento y nitidez — 2026-11-04

## Lo que reportó el usuario

1. **Ajustes → Apariencia**: «revisá que esté todo en uno; cuando voy a otro,
   ej. Alcance, no cambia». En la captura el control de Densidad mostraba
   «CÃ³moda» y «Amplia» cortado.
2. **Timeline**: los clips de audio no muestran la forma de onda real (bloques
   planos); quiere picos como en un DAW.
3. **Rendimiento** general de la app.
4. **Nitidez de las letras**: «agregá antialiasing, como apps profesionales».

## Causas encontradas (medidas, no supuestas)

- **Secciones que no cambiaban**: `SettingsSection` ya ponía `hidden`, pero
  `premium/shell.css` declara `.settings-window .settings-section { display:
  grid }` con la misma especificidad que `.settings-section[hidden] { display:
  none }` de `settings.css` y carga después → ganaba el grid. Las 8 secciones
  quedaban apiladas (scrollHeight 9226 px) y el menú no cambiaba nada visible.
- **«CÃ³moda»**: doble codificación UTF-8→Latin-1 en `AppearanceCard.tsx`
  (4 ocurrencias, incluidos comentarios).
- **Densidad cortada**: `.segmented` era `inline-flex` con ancho intrínseco
  (285 px); en ventanas angostas se salía de la tarjeta.
- **Onda ausente**: `resolve_audio_asset` (Rust) exigía `status == "ready"`.
  Las narraciones/audios generados se guardan como `unverified`, así que
  `audio_peaks` devolvía `AssetNotReady` y el clip quedaba sin onda. Además
  `useWaveform` trataba `durationFrames` desconocido como ∞ y descartaba la vía
  nativa (FFmpeg) sin intentarla.
- **Rendimiento**: cada clip de audio dibujaba hasta 600 `<rect>` (12.000 nodos
  SVG con 20 clips) y la regla generaba una marca menor cada ~8 frames de TODO
  el proyecto (~1.200 spans en 12k frames), recreadas en cada actualización del
  cabezal.
- **Nitidez**: medido con capturas y conteo de píxeles de antialias, la escala
  al 95 % produce ~55 % de píxeles intermedios por píxel sólido frente a ~35 %
  al 100 % (y 0,56 vs 0,45 con DPR 1,25). El texto no era «borroso» por falta
  de antialiasing —ya usa subpixel— sino por el zoom fraccionario.

## Cambios

- `styles/premium/shell.css`: `.settings-window .settings-section[hidden] {
  display: none }` (especificidad 0,3,0) → sólo se ve la sección activa.
- `features/settings/AppearanceCard.tsx`: mojibake corregido; slider de escala
  en pasos de 10 % (0,9–1,2) con `title` explicando que 100 % es lo más nítido.
- `styles/premium/components.css`: `.segmented` a `flex` + `width: 100%` y
  botones `flex: 1 1 0` con elipsis → nunca desborda.
- `state/appearance.ts`: `snapScale` redondea a décimas (0,95 → 1) y
  `normalizeAppearance` lo aplica; `SCALE_STEPS` exportado.
- `src-tauri/src/commands/audio.rs`: la onda acepta `ready` y `unverified`
  (es una lectura, no una entrega); sigue rechazando `missing`/`failed`.
- `hooks/useWaveform.ts`: los topes de duración sólo aplican si la duración es
  conocida; sin `media` se intenta igual la vía nativa.
- `features/editor/Timeline.tsx`:
  - `waveformPath()` + `waveformColumns()`: la onda es **un** `<path>` simétrico
    muestreado cada ~1,5 px (techo 480 columnas) en vez de 600 `<rect>`.
  - La regla se memoiza y sólo dibuja las marcas de la ventana visible
    (+overscan).
- `styles/premium/workspace.css`: `path` con `fill: currentColor` y
  `shape-rendering: geometricPrecision` (antes `crispEdges`, que era para los
  rects).
- `styles/premium/base.css` y `styles/app.css`: `-webkit-font-smoothing: auto`
  (en Windows `antialiased` fuerza escala de grises), `font-synthesis: none`,
  `text-size-adjust: 100%`.

## Verificación

- `tsc --noEmit` OK. Suite del editor/Ajustes/App: 297 pruebas OK. Suite
  completa 1541/1543; los 2-3 fallos (`EmojiPicker.focus`, «abre AI Hub»,
  `HomeView`) pasan en aislamiento: flakiness por carga, no regresión.
- Nuevas pruebas: `waveformPath` (envolvente cerrada y simétrica, sin datos no
  inventa onda, columnas por píxel), `snapScale` (0,95→1), e2e de navegación de
  Ajustes (`settings.spec.ts`, verifica que sólo quede una sección visible y que
  diga «Cómoda»).
- Medido en Chromium: timeline de 12.000 frames → 19 marcas mayores + 74 menores
  (antes 200 + 1.000), 1 path de onda por clip (antes 600 rects), 333 nodos en
  todo el timeline.
- Capturas sintéticas de la onda: envolvente DAW correcta (voz, música,
  silencio con línea base).

## Pendiente

- El binario instalado se regeneró (frontend + Rust) y se copió a
  `%LOCALAPPDATA%\Olyvia`.
- Si el usuario tenía 95 % de escala guardado, al abrir pasa a 100 % (más
  nítido) por el snapping; es intencional.
