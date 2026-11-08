# 2026-11-08 — Bézier por parámetro en plantillas de fábrica + fix de curva inerte

Pasada del protocolo del loop (Devin CLI). Ledger cerrado
(`loop:preflight` → idle); el ítem salió del «Pendiente honesto» de la
entrada «Plantillas de fábrica animadas con keyframes» de
`docs/IMPROVEMENT-QUEUE.md`.

## Qué se hizo

- `state/builtin-effect-templates.ts`: `BuiltinKeyframe` gana
  `bezier?: EffectKeyframe['bezier']` y `sanitizeBuiltinBezier` valida
  las cuatro coords finitas en 0..1 (rango de `CubicBezierSchema`); lo
  inválido se descarta y la clave conserva su `easing`.
- **Bug real encontrado**: en la receta `tension-que-crece` (audio,
  `audio.tremolo` → `depth` 0→0.7 en frames 0→24) el `easing:
  'ease-in-out'` estaba en la clave del frame 24, la última de la pista.
  La curva de un tramo la gobierna la clave que lo inicia
  (`previous.easing`/`previous.bezier` en `sampleKeyframes` de
  effect-kit, igual que `samplePoints` de project-schema y el export
  segmentado de `ffmpeg.rs`): el easing era **inerte** y la rampa salía
  lineal. Se movió la curva a la clave del frame 0 como bezier propio
  (`{cp1X:0.35, cp1Y:0.05, cp2X:0.5, cp2Y:1}`) y se eliminó el easing
  muerto.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/state/builtin-effect-templates.test.ts` → 9/9
  (+1 test de sanitización bezier: válido conservado, fuera de rango /
  NaN / no-objeto descartados; asserts de la curva en la plantilla).
- Regresión: `effect-templates.test.ts` + `EffectTemplates.test.tsx`
  → 14/14.
- Sin cambios en Rust ni en el contrato del documento
  (`EffectKeyframeSchema` ya admite `bezier`).

## Pendiente honesto

- Los keyframes de plantilla son locales al clip (frames 0…N desde el
  inicio del clip, no del timeline) y no hay presets de curva por
  nombre: el bezier se declara por coordenadas.
- Sólo `tension-que-crece` usa bezier; el resto de las recetas animadas
  usa easing, que estaba bien ubicado en todas las demás.
