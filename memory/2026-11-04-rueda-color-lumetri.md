# Rueda de color Lumetri para toda la app — 2026-11-04

## Pedido

«Quiero que para cambiar de color tenga este modelo, el mismo exacto; crealo y
usalo para todo en la app.» Referencia: captura del panel Color Match de
Premiere Pro (tres ruedas Shadows/Midtones/Highlights).

## Qué se construyó

- `apps/desktop/src/components/ColorWheel.tsx` — rueda estilo Lumetri:
  - anillo de tono con `conic-gradient` y máscara radial (agujero al 61 % del
    radio, igual que el original);
  - marcador circular blanco que se mueve en dos ejes: ángulo = tono
    (0 = rojo arriba, decrece en sentido horario: 90 = verde a la izquierda,
    180 = cian abajo, 270 = magenta a la derecha), radio = saturación;
  - barra vertical de luminosidad a la izquierda con pulgar gris (como el
    slider de Lumetri);
  - teclado: ←/→ tono, ↑/↓ saturación, Home/End saturación 0/100; la barra
    con ↑/↓, Home/End; `Shift` para pasos grandes;
  - ARIA: dos `role="slider"` («Tono y saturación…» y «Luminosidad…») con
    `aria-valuetext` en hex.
- `apps/desktop/src/components/ColorSwatch.tsx` — muestra de color que abre la
  rueda en un popover (portal a `body`, `z-index` 9500 por encima de Ajustes
  que usa 3000), con hex editable, chip de muestra y botón «Listo». Se
  reposiciona al scrollear (antes se cerraba sola) y se cierra con Escape o
  clic afuera devolviendo el foco.
- `state/theme-palette.ts`: `hexToHsl()` + tipo `HslColor` (inversa exacta de
  `hslToHex`).
- `styles/premium/components.css`: bloque «Rueda de color (modelo Lumetri)» con
  todos los estilos, más `.appearance-wheel-row`.

## Dónde se usa (reemplaza los 10 `input[type=color]` nativos)

| Archivo | Antes | Ahora |
|---|---|---|
| `features/settings/AppearanceCard.tsx` | slider de tono | rueda visible (124 px) |
| `features/settings/ColorStudioCard.tsx` | input nativo por token | muestra + popover (34 tokens) |
| `features/editor/Inspector.tsx` | 5 inputs (chroma, fondo, subtítulos) | muestra + popover |
| `features/vfx/VfxView.tsx` | color clave | muestra + popover |
| `features/vfx/EffectStackPanel.tsx` | parámetros de color | muestra + popover |
| `features/motion/MotionForm.tsx` | campos color de plantilla | muestra + popover |
| `features/thumbnails/ThumbnailView.tsx` | acento | muestra + popover |

Ya no queda ningún `input[type=color]` en `src/` (`grep` = 0).

## Verificación

- `tsc --noEmit` OK. Suite completa del desktop: **1568 pruebas, 200 archivos,
  0 fallos**.
- Nuevas pruebas `components/ColorWheel.test.tsx` (8): conversión HSL↔hex,
  inversa exacta, dos deslizadores con ARIA, flechas de tono/saturación,
  luminosidad, apertura/cierre del popover con Escape y hex manual.
- Actualizadas 3 pruebas de `ColorStudioCard.test.tsx` (el control pasó de
  `input.color-input` a `button.color-input`; el valor exacto se sigue
  escribiendo en `input.color-hex`).
- Verificado en Chromium contra la referencia: clic arriba → rojo (h 0), derecha
  → magenta (h 268), abajo → cian (h 180), izquierda → verde (h 84); barra
  abajo → casi negro, arriba → casi blanco. Capturas del popover y del panel de
  Apariencia comparadas con la imagen original.

## Pendiente

- Frontend y binario release recompilados; la app estaba abierta (PID 22560),
  así que la copia a `%LOCALAPPDATA%\Olyvia` queda pendiente de cerrarla o de
  ejecutar `Actualizar Olyvia.cmd`.
