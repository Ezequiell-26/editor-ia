# 2026-11-08 — Specs del plan materializadas en edit: subtítulos, música, transiciones

Continuación de `architecture/refactor-foundation`. Fase: que la etapa `edit`
convierta `subtitles`/`music`/`transition` del `ProductionPlan` en elementos
reales del documento, verificado por el E2E con FFmpeg.

## Qué se hizo

- **Schema** (`packages/project-schema/src/studio.ts`): `ProductionPlan` gana
  `transition` opcional `{type, frames}` — subconjunto seguro de
  `ClipTransitionSchema` (sin `luma-wipe`/`dip-color`). Espejo serde
  `PlanTransition`/`PlanTransitionType` (kebab-case) en `studio/plan.rs`.
- **`edit` stage** (`assembly_executor.rs`):
  - `transition`: `transitionIn` en todo clip visual después del primero en
    cada pista de producción; frames clampeados a `min(spec, duración, 120)`.
  - `subtitles.enabled`: pista "Producción Subtítulos" (kind `caption`),
    estilo propio si el documento no tiene, y un cue por escena con
    `narrationText` (o título), `language` del plan, rango = clip. Los cues
    quedan registrados en el artefacto (`cue_ids`) para idempotencia.
  - `music.enabled`: busca asset `audio` en el catálogo por query, lo monta
    en "Producción Música" `[0, total)`, `gainDb -12`, fades 30; sin
    candidato ⇒ `music.resolved=false` en el output (warning, no fatal).
  - Idempotencia extendida: retira clips Y cues de la corrida anterior.
- **E2E** (`render_executor.rs::e2e_tests`): el plan ahora tiene 2 escenas,
  `subtitles.enabled` (es) y `transition` dissolve 24 — el MP4 entregado se
  renderizó con subtítulos quemados (`include_captions`) y la transición.

## Decisiones

- La música sólo se resuelve desde la biblioteca local: es honesto (assets
  reales con derechos) y deja el hook para providers externos.
- Los cues exigen `styleId` existente según la validación v1 del servicio —
  se crea un estilo "Producción" por defecto sólo si no hay estilos.
- `transition` es un campo nuevo opcional: planes viejos parsean igual.

## Evidencia

- `cargo test --lib`: **749 passed / 0 failed / 53 ignored** (+2 tests:
  materialización de specs, warning de música sin candidato).
- E2E real: `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test --lib production_e2e
  -- --ignored` → 1/1, `deliverables/e2e-plan.mp4` ~1,05 MB verificado,
  manifest `quality.passed=true`, cues + `transitionIn` en el documento.
- `packages/project-schema`: `tsc --noEmit` limpio, `studio.test.ts` 10/10.
- architecture-rules: 12/12. `cargo fmt` aplicado.

## Pendiente

- Providers externos (`ResourceAcquisition`/`ContentGenerator` de red).
- Subtítulos generados por IA (hoy `narrationText`/título).
- Contratos TS + UI de producciones.
