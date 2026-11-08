# 2026-11-08 — Curva Bézier por parámetro de efecto: UI (Editor IA)

Pasada del protocolo del loop (Devin CLI). Cierra el pendiente declarado al
implementar `bezier` en `EffectKeyframeSchema`: «no hay UI para editar la
curva por parámetro todavía — las claves con `bezier` se crean por
datos/MCP/proyecto». Preview (`sampleKeyframes`/`cubicBezierProgress`) y
export (`SegmentEasing.bezier` en `render/ffmpeg.rs`) ya honraban la curva;
la superficie era lo que faltaba.

## Qué se hizo

- `packages/effect-kit/src/stack.ts`: `setParamKeyframeBezier(stack,
  instanceId, paramId, frame, bezier|null)` — escribe la curva en la clave
  que inicia el segmento (conserva `value`/`easing`; `null` la quita) y
  `clearParamKeyframeCurves` — quita `bezier` de todas las claves del
  parámetro. Ambas devuelven el mismo stack sin pista o sin clave en el
  frame. Exportadas por `index.ts`.
- `features/editor/KeyframeCurveEditor.tsx`: tipo de entrada generalizado a
  `CurveEditorKeyframe` estructural (`frame`/`easing`/`bezier`) — sirve para
  `ClipTransformKeyframe` y `EffectKeyframe` sin que effect-kit dependa de
  project-schema. `property` ahora admite string libre (los efectos pasan la
  etiqueta visible del parámetro) y `helpId` evita `id` duplicados de
  `aria-describedby` con varios editores montados.
- `features/vfx/EffectStackPanel.tsx` (compartido por EffectStudio y
  AudioEffectStack): parámetros numéricos con pista ≥2 claves ganan el botón
  «Curva» (∿) que despliega el `KeyframeCurveEditor`; «Quitar curvas» aparece
  si alguna clave tiene `bezier` propio. La edición escribe por
  `setParamKeyframeBezier` con el `onChange` del stack — mismo camino que ◆.
- `styles/effect-studio.css`: `.effect-param-curve` (grid + gap).

## Verificación

- `tsc --noEmit -p packages/effect-kit` y `-p apps/desktop` → **0 errores**.
  Al correrlo aparecieron errores **preexistentes** en `engine.test.ts`
  (arrays mutables vs `EffectStack` readonly desde que el tipo se hizo
  readonly, y un `.sort((a,b)=>a.frame-b.frame)` sobre `number[]`):
  corregidos en esta pasada; el package tsconfig no se venía corriendo en
  las verificaciones previas (sólo vitest, que no typechecka).
- vitest `packages/effect-kit` → **51/51** (+3 tests de los helpers).
- vitest `AudioEffectStack` → **7/7** (+1 flujo: ◆ crea pista → «Curva» →
  ArrowRight escribe `bezier.cp1X≈0.01` en la clave del frame 0 → «Quitar
  curvas» deja la pista sin bezier).
- vitest `src/features/vfx` + `KeyframeCurveEditor` → **47/47**.

## Límites honestos

- No hay selector de preset `easing` para keyframes de efecto (sólo lineal
  o curva propia); el editor de transform tampoco lo tiene.
- El canvas en jsdom no tiene `getContext('2d')`: el editor muestra el aviso
  «Vista de curvas no disponible…» y la edición por teclado/`onEditBezier`
  sigue funcionando (el test lo ejercita).
- `hasCurve`/`Quitar curvas` sólo se ofrece con pista activa (≥2 claves),
  misma condición que el botón «Curva».
