# 2026-11-08 — Lista de keyframes por parámetro en efectos

Pasada del loop de mejora (Devin CLI). Ítem: «Pendiente honesto» de la
pasada del selector `easing` — no había lista de keyframes por parámetro
como la del Inspector de transform.

## Cambio

- `packages/effect-kit/src/stack.ts`: `removeParamKeyframe(stack,
  instanceId, paramId, frame)` nuevo. Misma invariante que
  `toggleParamKeyframe`: si quedan <2 claves la pista entera se elimina
  (schema exige mínimo 2). Exportado por `index.ts`.
- `apps/desktop/src/features/vfx/EffectStackPanel.tsx`: dentro del
  popover «Curva» (`.effect-param-curve`), antes del
  `KeyframeCurveEditor`, una `.keyframe-list` con una fila por clave:
  `frame N · valor` (+ marca de curva propia o preset no lineal) y botón
  × que llama `onRemoveKey` → `removeParamKeyframe`. Nuevo campo
  `onRemoveKey` en `ParamAnimation` y helper `EASING_LABELS`.
- CSS: `.effect-param-keys` en `effect-studio.css` (max-height 120 px,
  fuente xs). Reusa `.keyframe-list`/`.keyframe-row` de `chrome.css`.

## Verificación

- `npx vitest run` en `packages/effect-kit` → **56/56** (+3 tests de
  `removeParamKeyframe` en `engine.test.ts`).
- `npx vitest run src/features/vfx src/features/editor/
  AudioEffectStack.test.tsx src/features/editor/
  KeyframeCurveEditor.test.tsx` en `apps/desktop` → **49/49** (+1 test:
  lista visible, borrado de una clave y eliminación de la pista al
  quedar una sola).
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.

## Notas

- La lista está dentro del popover «Curva», no siempre visible (decisión
  de densidad: el stack tiene muchas filas; el popover es la superficie
  de edición de animación).
- Las filas muestran frame local del clip (el panel no recibe fps, así
  que no hay timecode) y no hay click-to-seek: `EffectStackPanel` es un
  componente puro sin acceso al playhead.
- Antes de esto, borrar una clave exigía mover el playhead exactamente
  sobre ella (◆) o eliminar toda la animación del parámetro (×).
