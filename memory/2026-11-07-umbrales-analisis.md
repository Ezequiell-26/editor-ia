# Umbrales de análisis configurables (2026-11-07)

Pasada del loop (Devin CLI). Ítem: «umbrales de escena configurables» del
lote «editor automático sin LLM» (2026-10-27).

## Hallazgo

`analyze_media` (Rust, `commands/intelligence.rs`) ya aceptaba
`sceneThreshold` (clamp 0.05–0.9, default 0.35), `silenceDb`
(−60…−10, default −32) y `minSilenceSeconds` (0.15–3, default 0.35), y la
clave de caché los incluye. El contrato TS (`project-service.analyzeMedia`)
también los exponía. El hueco era sólo de UI:

- `AutoEditView` llamaba `analyzeMedia(id, undefined×3, false)` → siempre
  defaults, sin forma de ajustarlos.
- `DirectorView` pasaba `silenceDb`/`minSilence` configurables pero la
  escena fija en `0.35`, y cambiar umbrales no invalidaba el plan.

## Cambio

- `AutoEditView.tsx`: estado `sceneThreshold`/`silenceDb`/`minSilence` +
  tarjeta «Medición · Umbrales del análisis»; `analyze()` los envía;
  `measuredParams` registra con qué valores se midió; `analysisStale`
  bloquea aplicar/exportar/criterio-IA si difieren (aviso visible).
- `DirectorView.tsx`: input «Umbral de escena (0–1)» en el grid de tuning;
  los tres umbrales ahora limpian `plan`/`applied` al cambiar.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/autoedit/AutoEditView.test.tsx` → 11/11
  (2 tests nuevos: propagación de umbrales al servicio y bloqueo por
  medición obsoleta con re-análisis que lo levanta).

## Pendiente

Del mismo lote queda «preview antes de aplicar» (ver los cortes elegidos
sobre el material antes de escribir la timeline).
