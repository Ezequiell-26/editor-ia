# ADR-0004: Production Orchestrator — ciclo de vida de corridas

**Estado:** aceptada (pipeline completo cableado y verificado E2E con
FFmpeg real: plan/acquire/analyze/scenes/edit/render/review/deliver;
`acquire` resuelve contra la biblioteca local y lo no cubierto falla
`requires_provider`).
**Fecha:** 2026-02 (worktree `architecture/refactor-foundation`).

## Problema

ADR-0002 dejó los contratos (`ProductionPlan`, puertos de catálogo/adquisición/
generación) pero nada que ejecute un plan: no había dónde vivir el estado de
una producción en curso (etapa actual, checkpoints, gasto, reintentos) ni
quién decidiera el avance entre etapas.

## Decisión

1. **`studio/run.rs` (dominio puro)**: `ProductionRun` serializable con
   `RunStatus` (`planned|running|paused|cancelled|done|failed`), un
   `StageRecord` por etapa del pipeline (`plan→acquire→analyze→scenes→edit→
   render→review→deliver`), `spent_cents`/`max_cost_cents`,
   `max_stage_attempts` (3 por defecto) y `resumes`. Reglas puras:
   `begin_stage`/`finish_stage`/`skip_stage`/`cancel`/`pause`/`resume`.
   Un outcome no completado no fatal devuelve la etapa a `pending`
   (reintentable); agotados los intentos o con `fatal`, la corrida queda
   `failed` con `last_error`.
2. **Ports** (`ports/studio.rs`): `ProductionStore` (persistencia de
   corridas) y `StageExecutor` + `StageContext` (ejecuta UNA etapa y devuelve
   `StageOutcome` honesto: `completed`, `cost_cents`, `output`, `error`,
   `fatal`). El orquestador nunca inventa resultados: si el ejecutor falla,
   la etapa reintenta o la corrida falla.
3. **`application/production.rs`**: casos de uso `create_run`, `advance`
   (una etapa por llamada, idempotente), `cancel_run`, `resume_run`,
   `run_status`, `list_runs`, `remove_run` (sólo terminales). El presupuesto
   se verifica antes de ejecutar y el coste real se acumula al cerrar la
   etapa; gasto que excede el tope pausa la corrida, no la falla.
4. **`infrastructure/studio/production_store.rs`**: `LocalProductionStore`
   en `<config_dir>/productions/<run-id>.json`, escritura atómica
   (tmp+rename), id sanitizado contra path traversal, listado ordenado por
   `updated_at`.
5. **IPC**: `production_create|status|list|resume|cancel|remove|advance` +
   `catalog_search|catalog_get` en `commands/domains/studio/`. `advance`
   requiere sesión de proyecto y usa `ProjectStageExecutor`
   (`infrastructure/studio/project_executor.rs`), que ejecuta hoy `plan`
   (re-validación), `acquire` (sin requisitos ⇒ coste 0; con requisitos
   resuelve cada uno vía `LocalCatalogAcquisition` — assets del proyecto,
   derechos ≥ piso, archivo en disco; lo no satisfecho ⇒ `fatal` +
   `requires_provider`, nunca simula) y `analyze` (indexa
   assets vía `LocalProjectCatalog`). `AssemblyStageExecutor` cubre
   `scenes`/`edit` (artefacto `.olyvia/production/<plan>.scenes.json` +
   clips reales en pistas "Producción", idempotente). `RenderReviewDeliver
   Executor` cubre `render` (pipeline FFmpeg real, sondeo async), `review`
   (Quality Gate) y `deliver` (MP4 + manifest en `deliverables/`).
   `CompositeStageExecutor` enruta y `production_advance` lo inyecta con
   `RenderDeps` del `AppState`. Etapas async usan `StageOutcome.in_progress`
   + `StageRecord.output`/`StageContext.previous_output`/`stage_outputs`.

## Consecuencias

- Las corridas sobreviven reinicios (JSON por corrida en config_dir).
- Presupuesto, reintentos y cancelación son reglas de dominio testeadas,
  no convenciones del llamador.
- Composición futura: un `CompositeStageExecutor` en `infrastructure` que
  enrute cada etapa a su adaptador real (catálogo → analizador → editor →
  render → quality gate) y se inyecte vía `AppState` cuando exista.
- Frontend/MCP consumen el ciclo de vida; la UI de producciones es fase
  posterior.
