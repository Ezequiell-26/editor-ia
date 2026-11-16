# 2026-11-13 — Oleada 11: splits ronda 4, speed preview, auditoría comandos, install smoke

## Resultados

1. **project-actions ronda 4** (`d06bbb5a`): trim-actions.ts.
   3599→3253. Documentado por qué transitions/compounds/splits no son
   extraíbles limpio (helpers compartidos/no contigüidad).

2. **Inspector ronda 4** (`a5ad4c6d`): TransformSection.tsx (la más
   grande: ~550 líneas JSX). 7741→7132. Estados verificados seguros de
   mover (keyframe-selection = store externo).

3. **SpeedCurvePreview** (`83a68a7b`): SVG que replica
   SpeedCurve::with_tangents (Hermite+FC-monotone). 17/17 tests.

4. **Auditoría comandos** (`0d156030`): 0 huérfanos / ~234. 5
   backend-only con valor UI → oleada 12: production_plan_from_text
   (describí tu video→plan), production_plan_from_brief, production_pause
   (GAP UX real: UI muestra paused pero no se puede pausar),
   production_start (driver autónomo), screen_record_snapshot.

5. **Install smoke** (`66d8e52c`): 4 gaps corregidos — sfx resources en
   CI, --no-sign en PS1, check-bundle-resources.mjs (verificación
   estática de resources), -Provision. Smoke real pendiente:
   docs/verification/2026-11-13-install-smoke-pending.md.

## Estado god-files

- project-actions.ts: 3253 (clips/transitions/compounds restante ~1400,
  face/AI overlays+masks ~575)
- Inspector.tsx: 7132 (máscara, velocidad, estabilización, escenas atan
  muchos estados del padre — próxima extracción requiere mover estado)

## Pendiente

- Oleada 12 candidata: conectar production_plan_from_text/brief +
  production_pause/start a AutonomousRunsPanel (flujo autónomo real).
- Install smoke real (requiere build del instalador).
- Commit (~750 archivos WIP).
