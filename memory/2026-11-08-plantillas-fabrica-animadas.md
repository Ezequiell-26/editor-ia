# 2026-11-08 — Plantillas de fábrica animadas con keyframes

Pasada del loop de mejora (Devin CLI). Cierra el pendiente «las recetas son
stacks estáticos (sin keyframes); un preset animado queda como mejora».

## Qué se hizo

- `apps/desktop/src/state/builtin-effect-templates.ts`: `BuiltinEffectSpec`
  gana `keyframes` por `paramId`; `sanitizeBuiltinKeyframes` (exportada para
  tests) normaliza contra el manifiesto — specs float/int, frames ≥0
  redondeados, `coerceParam` al dominio, easing validado, dedupe por frame,
  mínimo 2 claves por pista. Tres recetas nuevas: «Golpe que se apaga»
  (impact.shake amount 14→8→0 @0/10/28), «Punch de entrada»
  (impact.zoom_pulse amount 0→0.22→0.08 @0/8/20) y «Tensión que crece»
  (audio.tremolo depth 0→0.7 @0/24).
- `features/vfx/EffectTemplates.tsx`: filas de plantilla muestran
  «· animada» si algún efecto tiene pistas.

## Por qué es real

`stackFromTemplate` ya copiaba `instance.keyframes` (las plantillas del
usuario podían ser animadas); el hueco era sólo de fábrica. Las keyframes
caen en `effects.stack` del clip → preview GPU/Web Audio y render
segmentado de FFmpeg las aplican igual que las editadas a mano.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `builtin-effect-templates.test.ts` 8/8 (+4),
  `EffectTemplates.test.tsx` 7/7 (+1), regresión `features/vfx` +
  `effect-templates` 36/36.

## Límites

Keyframes locales al clip (frame 0 = inicio del clip); sin Bézier propio en
recetas (sólo easing); sin binding a la duración del clip (clip más corto
que la última clave muestra el valor clampeado).
