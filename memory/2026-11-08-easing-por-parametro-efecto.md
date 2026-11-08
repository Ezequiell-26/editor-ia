# 2026-11-08 — Selector de preset `easing` para keyframes de efecto (Editor IA)

Pasada del protocolo del loop (Devin CLI). Cierra el «Pendiente honesto» de
la entrada anterior (`2026-11-08-bezier-por-parametro-efecto.md`): «no hay
selector de preset `easing` para keyframes de efecto (sólo lineal o curva
propia)». El campo `easing` ya existía en `EffectKeyframe`, lo honraban el
muestreo de preview (`sampleKeyframes`/`ease` en `params.ts`) y el export
(`effect_ease`/`SegmentEasing` en `render/ffmpeg.rs`, con `hold` incluido);
los keyframes de transform ya tenían su selector «Curva» en el Inspector.
Sólo faltaba la superficie para efectos.

## Qué se hizo

- `packages/effect-kit/src/stack.ts`: `setParamKeyframeEasing(stack,
  instanceId, paramId, frame, easing)` — escribe el preset en la clave que
  inicia el segmento (conserva `value`), **quita `bezier`** de esa clave
  (el bezier gana sobre easing en el muestreo; dejarlo haría que el preset
  elegido no rigiera — mismo criterio que `clearParamKeyframeCurves`) y es
  no-op sin pista o sin clave en el frame. Exportada por `index.ts`.
- `features/vfx/EffectStackPanel.tsx` (compartido por `EffectStudio` video
  y `AudioEffectStack` audio): dentro del popover «Curva» (∿), debajo del
  `KeyframeCurveEditor`, un `<select>` por tramo — «Tramo N» con el rango
  de frames en `title`/`aria-label` («Interpolación del tramo N de
  {parámetro}»). Opciones: Lineal / Acelerar / Desacelerar / Suave /
  Mantener (mismas etiquetas que el Inspector de transform). Si la clave
  del tramo tiene curva propia, el selector muestra la opción deshabilitada
  «Curva propia» en vez de un preset que no se aplicaría; elegir un preset
  la reemplaza. El último keyframe no abre tramo y no genera selector.
- `styles/effect-studio.css`: `.effect-param-easings` (fila con wrap) y
  `.effect-easing-field`.

## Verificación

- `tsc --noEmit` en `packages/effect-kit` y `apps/desktop` → **0 errores**
  (primer intento marcó `select.value` sobre `HTMLElement` en el test y
  params implícitos en `onSetEasing`; corregidos).
- vitest `packages/effect-kit` → **53 passed / 3 skipped** (`engine.test`
  24/24, +2: preset escribe easing conservando valor y reemplazando bezier
  —con assert de muestreo `ease-in` a -0.5 en el punto medio— y no-op sin
  pista/clave).
- vitest desktop → `AudioEffectStack` **8/8** (+1 flujo completo: ◆ crea
  pista → «Curva» → select «ease-in» escribe `easing` en la clave del
  frame 0 → ArrowRight crea bezier y el select pasa a «Curva propia» →
  elegir «ease-out» deja `easing:'ease-out'` y `bezier` undefined) ·
  `src/features/vfx` + `KeyframeCurveEditor` **48/48** en 8 archivos.
- No se tocó Rust: `effect_ease` ya cubría los 5 presets en export.

## Límites honestos

- El easing se edita por tramo dentro del popover de curva (misma puerta
  que el editor Bézier); no hay lista de keyframes por parámetro como la
  del Inspector de transform.
- Elegir un preset **borra** la curva propia de ese tramo (decisión
  deliberada: el preset debe regir; el usuario puede re-dibujarla con ∿).
