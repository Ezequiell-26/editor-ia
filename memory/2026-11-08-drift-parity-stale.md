# 2026-11-08 — DRIFT-PARITY: auditoría de afirmaciones stale

Pasada del protocolo del loop (Devin CLI). `loop:preflight` → `idle` (todas
las tareas del ledger cerradas). La cola `[next]`/`[pending]` quedó revisada:
los ítems vivos son grandes (transiciones OBS en vivo, física 2D del
stickman, titler de capas libres, diarización con modelo local) o bloqueados
(firma OV/EV externa, Ola CapCut P1 gateada a pedido del usuario).

## Qué se hizo

Auditoría de `docs/DRIFT-PARITY.md` — documento de referencia que usan las
pasadas siguientes— y corrección de dos afirmaciones falsas:

1. Matriz §2 «20 plantillas de efecto» decía «falta la UI»: la UI existe
   (`EffectTemplates.tsx` + `effect-templates.ts` + catálogo de fábrica
   `builtin-effect-templates.ts`).
2. §5 «Efectos de audio» decía «la preview no los simula»: falso desde
   `a7cff32`. `clip-audio-fx.ts` (`PREVIEW_AUDIO_FX.size === 30`, keyframes
   muestreados por frame) + `usePreviewAudio.ts` (`ClipFxChain`,
   `buildClipFxChain`, `envelopeFollower` con `setInterval` de 40 ms fijo).
   El copy del panel ya lo declara («La preview reproduce los 30 efectos
   del catálogo (con keyframes); el pitcheo usa un shifter granular
   aproximado»).

## Verificación

- `npx vitest run src/features/mixer/clip-audio-fx.test.ts` → **6/6**.
- Lectura directa de `usePreviewAudio.ts` (líneas ~216-275, ~426-579,
  ~1006-1085) y `AudioEffectStack.tsx:63-64`.
- Sin cambios de código → no corrió tsc ni suite.

## Ojo para futuras pasadas

- `memory/2026-11-08-audio-stack-keyframes-ui.md` dice «la preview de audio
  no aplica la cadena»: quedó viejo respecto de `a7cff32` (el copy de la UI
  ya se actualizó; la memoria no).
- `clip-audio-fx.test.ts:98` usa `audio.dynaudnorm` como id inexistente de
  caso negativo — NO es un efecto del catálogo; el dynaudnorm real es
  `audio.leveler` y sí tiene equivalente en preview.
