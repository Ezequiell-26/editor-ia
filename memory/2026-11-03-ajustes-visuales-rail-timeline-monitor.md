# Ajustes visuales del editor: rail, regla del timeline y monitor — 2026-11-03

## Qué reportó el usuario (captura del editor con un proyecto 9:16)

1. En el rail de Medios, la pestaña «Medios» se salía de su caja.
2. La regla del timeline se superponía con la cabecera de la primera pista
   («TIMELINE» cortado por «CAP C1»).
3. En el monitor, algo tapaba el video.
4. Al hacer clic en el timeline el cabezal no quedaba sincronizado: la línea
   aparecía corrida a la izquierda.

## Causas (medidas en el DOM real, no a ojo)

- **Rail**: `app.css` (legacy, `.rail-tabs button`) deja `flex-direction:
  column` + `min-height: 44px`; la capa premium fijaba alto 24 px pero nunca
  reponía la dirección, así que icono (15) + gap (6) + etiqueta (17,6) = 38,6 px
  dentro de una caja de 24: el icono se recortaba arriba y la etiqueta caía
  fuera de la pestaña. Además el flex con `overflow-x: auto` mostraba la barra
  de scroll de WebView2 (no respeta `scrollbar-width`), que recortaba la fila.
- **Regla**: `.track-head` tiene `z-index: 10` y `.ruler-row` 9 en la base; al
  scrollear, la cabecera de pista se dibujaba encima de la esquina sticky.
  `app.css` ya lo había parchado al final (z-index 14/15) pero el binario que
  corría el usuario era anterior a ese parche.
- **Monitor**: el HUD y las herramientas eran dos capas `absolute`
  independientes (`max-width: min(45%, 240px)` en el HUD), así que el chip
  «Vista previa aproximada» quedaba debajo del selector de formato. El padding
  de la etapa no reservaba los 44 px de la barra (el shorthand premium pisaba
  el `padding-top: 44px` de app.css) y el video arrancaba debajo de los chips.
  El timecode se dibujaba dentro del lienzo (`preview-timecode-chip`).
- **Cabezal**: los clics sobre un clip sólo seleccionaban (`selectClip`), nunca
  movían el cabezal; y un clic en la esquina sticky de la regla caía en
  `beginScrub` y mandaba el cabezal a 0.

## Cambios

- `styles/premium/workspace.css`
  - `.rail-tabs` pasa a `display: grid` con `grid-auto-flow: column` y columnas
    `minmax(0, 1fr)`: 8 iconos repartidos, sin scroll ni recortes en ningún
    ancho. Etiqueta oculta siempre (el nombre de la vista lo muestra el
    `rail-head`); `aria-label` en cada pestaña.
  - `.rail-tabs button`: `flex-direction: row`, `width: 100%`, `padding: 0`.
  - `.ruler-corner-title` con `overflow: hidden` + `ellipsis`.
  - Nueva `.preview-topbar` (fila flex absoluta) que contiene `.preview-hud`
    (`position: static`, `min-width: 0`, `overflow: hidden`) y `.preview-tools`
    (`flex: 0 0 auto`). El chip largo se oculta a ≤1440 px, donde no entra.
  - `.preview-stage` reserva `padding-top: 44px` para que la barra no tape el
    video.
  - Se elimina la regla de `.preview-timecode-chip` (ya no se renderiza).
- `features/editor/Preview.tsx`: HUD + herramientas envueltos en
  `.preview-topbar`; se quita el chip de timecode del lienzo (el dato sigue en
  la barra de transporte).
- `features/editor/Timeline.tsx`: `seekFromClipPointer` — clic sobre un clip
  lleva el cabezal al frame clickeado (mide contra el rect del propio clip, así
  no depende del scroll ni del ancho de la cabecera). `beginScrub` ignora los
  clics en `.ruler-corner`.
- `features/editor/EditorAssets.tsx`: `aria-label` en las pestañas del rail.

## Verificación

- `tsc --noEmit` (desktop): OK.
- `vitest` editor + App: 232 pruebas OK. Suite completa: 1487/1488 (los dos
  fallos vistos —`EmojiPicker.focus` y «abre AI Hub»— pasan en aislamiento:
  flakiness por carga paralela, no regresión).
- Nuevas pruebas en `Timeline.test.tsx`: «el clic sobre un clip lleva el cabezal
  al frame clickeado» y «el clic en la esquina de la regla no mueve el cabezal».
- Medición con Playwright en 1000/1240/1360/1600/1920 px: `scrollWidth ===
  clientWidth` en el rail y `scrollHeight === clientHeight` en cada pestaña;
  HUD y herramientas nunca se solapan (holgura ≥ 8 px); el lienzo arranca 11 px
  debajo de la barra; clics en regla y clips con desvío ≤ 1,2 px (cuantización
  de frame a 2,4 px/frame).
- `npm run build`: OK (el CSS compilado incluye `.preview-topbar` y el rail en
  grid).

## Pendiente / siguiente paso

- **Instalado**: se recompiló frontend + Rust (`cargo build --release -p
  editor-ia-desktop --features tauri/custom-protocol --offline`, 5m06s) y se
  copió el exe a `%LOCALAPPDATA%\Olyvia` (SHA256 idéntico al de
  `target\release`, assets nuevos embebidos: `main-BjUsEAty.js`,
  `main-d_70T8dv.css`, `editor-CbewhQ9t.css` presentes en el binario). Las DLL
  de FFmpeg del destino coinciden por hash con `resources/ffmpeg-dll`.
- Al scrollear la timeline queda a la vista una franja de la pista anterior
  bajo la regla (comportamiento normal de NLE, ya sin superposición de texto).
  Si molesta, la opción sería `scroll-snap-type: y proximity` en
  `.timeline-scroll`.
- Los paquetes de las extensiones de navegador (`dist/flow-queue-*.zip`,
  `editor-ia-downloader-*.zip`) son artefactos aparte y no se regeneraron.
