# ADR-0005 — Comandos de studio como composition root temporal

- **Estado:** aceptada con fecha de caducidad
- **Fecha:** 2026-11-11 · **Revisión obligatoria:** 2026-12-11
- **Contexto:** `commands/domains/studio/production.rs` referencia
  `crate::infrastructure::{ai,studio}` directamente (6 usos): construye
  `StateProviderSettings`, `KeyringProviderSecrets`, `ReqwestProviderChat`
  y arranca `run_driver` para `production_plan_from_text`,
  `production_resume` y `production_start`.
- **Decisión:** se registra como excepción documentada en
  `scripts/architecture-rules.test.mjs` (`COMMANDS_EXCEPTIONS`) en lugar
  de refactorizar en caliente sobre un árbol con WIP masivo de otros
  agentes.
- **Alcance exacto:** sólo `production.rs`; ningún otro comando puede
  copiar el patrón.
- **Riesgo:** bajo — es composición legítima (equivalente a lo que hace
  `state.rs`/`lib.rs`), no lógica de negocio en el comando.
- **Plan de eliminación:** crear `infrastructure/studio/composition.rs`
  (o exponer los builders desde `AppState`) y dejar los comandos como
  adaptadores delgados que sólo parsean y delegan. Criterio de cierre:
  la excepción sale de `COMMANDS_EXCEPTIONS` y el test sigue verde.
- **Responsable:** equipo de arquitectura (próxima pasada de Fase 3).
