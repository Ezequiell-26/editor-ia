# Perspectiva real en la preview — 2026-10-27

## Qué se hizo

La preview de Olyvia ahora deforma el clip con la misma homografía de 4 puntos
que aplica el filtro `perspective` de FFmpeg en el MP4. Antes, el Inspector
avisaba que "la preview CSS no deforma la imagen" y el visor mostraba el clip
sin corregir; Frame real y export sí lo hacían.

- `apps/desktop/src/features/editor/perspective.ts` (nuevo): resuelve la
  homografía TL, TR, BR, BL → cuadro completo y emite `matrix3d`, conjugada
  para `transform-origin: center` y al final de la lista de transforms (se
  aplica antes de translate/scale/rotate, igual orden que el render).
- `Preview.tsx`: video, imagen y gráfico reciben el viewport (tamaño del visor
  + dimensiones del medio) y lo pasan a `transformStyle`.
- La caja del contenido replica `object-fit: contain`. Las esquinas se
  interpretan en píxeles del perfil sobre el frame ya escalado, que es lo que
  hace el render (`scale=decrease` → `perspective`).
- `Inspector.tsx`: el texto ahora dice que se aplica en preview, Frame real y
  MP4; el MP4 sigue siendo la referencia.

## Evidencia medida

- **Chromium vs FFmpeg** (`apps/desktop/e2e/perspective.spec.ts`, 1/1 en
  57,2 s): frame sintético 320×180, mismo cuadrilátero, dos marcas.
  - magenta: CSS (219,683 / 57,626) vs FFmpeg (219,409 / 57,584) →
    Δ 0,275 / 0,042 px.
  - cyan: CSS (104,380 / 140,924) vs FFmpeg (104,272 / 140,946) →
    Δ 0,109 / 0,022 px.
  - Ambas marcas se movieron >5 px de su posición original: la deformación se
    renderizó de verdad.
- **Unitarios**: 6/6 en `perspective.test.ts` (esquinas por defecto, cuadro
  completo, letterbox 4:3 y vertical, escena sin tamaño, cuadrilátero
  degenerado, medio sin dimensiones).
- **DOM**: `App.test.tsx` verifica `matrix3d` en `.preview-media`; jsdom no
  mide layout, así que el test fija el rect de `.preview-stage` (960×540).
- **Verificación**: `npm run typecheck` verde; suite **1293/1293 en 155
  archivos** en 63,07 s; `npm run build` verde en 6,64 s
  (`EditorWorkspace` 999,78 kB). Sin tocar Rust, sin commit/push ni rebuild
  del instalador.
- En modo pixel-perfect la homografía usa los píxeles reales del frame como
  viewport, no el tamaño ajustado a la etapa.

## Límites honestos

- La máscara y el blend se siguen aplicando en espacio del elemento; el MP4
  aplica la perspectiva antes de la máscara. Con máscara + perspectiva la
  preview es una aproximación.
- La caja de transformación interactiva no se deforma.
- El muestreo de CSS no es idéntico al de FFmpeg; en el caso medido la
  diferencia es ≤ 0,3 px.

## Trampa registrada

El orden de esquinas de FFmpeg no se asumió: se midió con un frame sintético
de marcas de color. Rust pasa TL, TR, BL, BR con `sense=source` y el sondeo
confirmó que cada esquina de origen cae en su esquina de destino. Repetir ese
sondeo antes de tocar el filtro.
