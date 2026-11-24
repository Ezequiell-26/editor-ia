# Source monitor: marcas I/O + insert (pasada 295)

- `MediaSpyOverlay` ahora es un source monitor usable: con el pin
  activo (video) muestra I/O para marcar rango sobre el tiempo actual
  y «Insertar» que monta `inFrame`/`outFrame` vía `addClipFromAsset`
  en el playhead. Sin marcas válidas no inserta; asset inexistente →
  notice, no clip fantasma.
- Marcas = estado local del componente, reseteadas por `assetId`;
  nunca en ProjectDocument.
- fps real desde `asset.media.frameRate`; `outFrame >= inFrame+1`.
- Tests: `MediaSpyOverlay.test.tsx` 5/5 · tsc exit 0.
- Pendiente: rebuild del exe para que sea live (TS-only).

## Pasada 296 (misma nota)

- Atajos `i`/`o` scoped al pin (ignora inputs), botón ✕ limpia marcas,
  `<select>` de pista video destino (Auto = default de addClipFromAsset).
- 9/9 tests · tsc exit 0. Pendiente rebuild.

## Pasada 297

- Botón Loop: repite sólo el rango in/out en el <video> nativo
  (onTimeUpdate → seek a in al pasar out). Reset por assetId.
- 10/10 tests · tsc exit 0. Pendiente rebuild.

## Pasada 298

- `.media-spy-ruler` + ticks in/out/playhead sobre el content-box del
  video (object-fit contain → letterbox calculado, ResizeObserver con
  guard para jsdom). 11/11 tests · tsc exit 0.

## Pasada 299

- Pin de imagen → botón Insertar (still completo, sin marcas).
  Ojo: image assets requieren `media:{width,height}` strict — un
  asset imagen con media de video es rechazado por parseProject.
- 12/12 tests · tsc exit 0.

## Pasada 300

- Ticks in/out arrastrables (pointer events → segundos vía
  contentBox), clamp anti-cruce. jsdom no puede probar el drag
  (sin videoWidth) — verificación real pendiente en app.
- 12/12 tests · tsc exit 0.

## Audio en el source monitor (pasada 301)

- `media-spy` acepta `kind:'audio'`; `EditorAssets` detecta audio listo
  con `media.durationFrames` → duración a fps del proyecto.
- Overlay: `<audio controls>` pineado, SIN autoplay (el navegador
  rechaza play con sonido); `muted` por kind+pin. Regla de marcas a
  ancho completo (sin letterbox). Insert usa `fpsOf(project)` para
  in/out frames y selector de pistas audio+narration.
- jsdom: `play()` devuelve undefined → `Promise.resolve(...).catch`.
- 13/13 tests, typecheck exit 0. Pendiente rebuild.
- Rebuild 14m30s → PID 15848, app_status MCP OK. Live.

## Waveform en el source monitor (pasada 302)

- `useWaveform` (FFmpeg `audio_peaks`, cache persistente) sólo con pin
  activo; tira SVG de 480 buckets al pie del monitor para video y
  audio. Alineada con ticks por durationSeconds. projectFps para audio.
- 19/19 tests, typecheck exit 0. Pendiente rebuild.
- Rebuild 7m42s → PID 16424, app_status MCP OK. Live.

## Insert encadenado (pasada 303)

- Insert ya no suelta el pin: limpia marcas y sigue con el mismo medio
  (findGap encadena clips contiguos). Escape/clic suelta. 14/14 tests.
- Rebuild 6m24s → PID 17132, app_status MCP OK. Live.

## Frame-step + conflicto de teclas (pasada 304)

- I/O del spy pisaba timeline.setInPoint/setOutPoint (window bubble) →
  listener movido a capture + stopPropagation en teclas reclamadas.
- Ctrl/Alt+I ya no marca. ,/. = ±1 frame source (Shift ±1s); el
  playhead no se mueve con el pin activo. 16/16 tests.
Rebuild 7m07s → PID 4668, app_status MCP OK. Live.
