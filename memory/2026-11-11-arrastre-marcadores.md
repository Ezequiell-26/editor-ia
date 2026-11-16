# 2026-11-11 (noche 7) — Arrastre de marcadores en la regla

## Grounding AlaukCut
`frontend/js/marcadores.js` dibuja `.marcador-regua` sobre la regla y los hace
arrastrables: `mousedown` guarda `x0/t0`, `mousemove` convierte el delta a
tiempo, evita colisiones con otro marcador (`Math.abs(o.t - t) < .5 / fps`) y
`desenhar()` re-renderiza. Olyvia sólo clickeaba el flag para saltar.

## Implementado
- `Timeline.tsx`, `onPointerDown` del `.timeline-marker`:
  - `stopPropagation` (no dispara el scrub de la regla), pausa, playhead al
    marcador, selección limpia.
  - **Umbral de 3 px**: por debajo, sigue siendo el clic de siempre.
  - `updateMarker(current, marker.id, { frame })` con `history:false` en cada
    `pointermove`; clamp `[0, store.durationFrames]`; si `updateMarker` lanza
    (frame ocupado o rango inválido), se ignora el paso.
  - Al soltar: **un solo `store.update` con historial** (para que el arrastre
    completo sea un único undo), playhead al frame final y notice
    «Marcador «X» movido a timecode».
  - `setPointerCapture` / `releasePointerCapture` con optional chaining (jsdom
    no los implementa).
- CSS en `editor-clarity.css`: `cursor: grab` / `grabbing` y
  `touch-action: none` para el gesto táctil.

## Verificación
`Timeline.test.tsx` 32/32 (+1: arrastre de 48 px cambia `style.left`) ·
`npm run typecheck` exit 0 · probe en vivo 1360×768 y 1280×720 con mouse real:
`left 144px → 192px`, `0:00:02:00 → 0:00:02:20`, notice correcto, 0 errores de
consola, `scrollWidth == clientWidth`.

## Gotchas
- En jsdom `querySelector` devuelve `Element`, no `HTMLElement`: hay que
  estrechar con `instanceof HTMLElement` antes de leer `.style` (typecheck).
- React reutiliza el nodo del marcador tras cada `store.update`; los listeners
  nativos agregados en `pointerdown` siguen vivos.
- El playhead se mueve al frame final: queda sobre el marcador y comparte la
  línea vertical en la regla. Es intencional.
- No se agregó drag a los marcadores de RANGO (`endFrame`): mover el inicio
  puede violar `endFrame > frame`. Queda como próximo paso.

## Ampliación (noche 8) — handle de fin de rango

- Nuevo botón `.timeline-marker-range-handle` posicionado en `endFrame`, con el
  mismo patrón de arrastre: umbral 3 px, `updateMarker({ endFrame })` con
  `history:false` durante el gesto, un solo paso de historial al soltar, clamp
  `[frame+1, durationFrames]`, notice con el timecode final.
- El arrastre del **inicio** de un rango ahora clampa a `endFrame - 1`, así no
  puede cruzar el fin (antes `updateMarker` lanzaba y el paso se ignoraba).
- CSS: zona de agarre de 8 px, barrita de 2 px con `--marker-color`,
  `cursor: ew-resize`, `touch-action: none`.
- Verificación: `Timeline.test.tsx` 33/33 (+1) · typecheck 0 · probe en vivo
  1360/1280: handle 432px → 480px, rango 288px → 336px,
  `0:00:06:00 → 0:00:06:20`, notice correcto, 0 errores, sin overflow.
