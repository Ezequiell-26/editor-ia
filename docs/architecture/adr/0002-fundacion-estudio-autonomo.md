# ADR-0002: Fundación del Autonomous Creative Studio

**Estado:** aceptada (contratos implementados; providers pendientes).
**Fecha:** 2026-02 (worktree `architecture/refactor-foundation`).

## Problema

La arquitectura consolidada describe un editor manual. El objetivo es un
Estudio Audiovisual Autónomo donde la IA busque recursos, analice medios,
genere contenido, monte timelines, renderice, evalúe calidad y entregue. Sin
fronteras definidas, la primera implementación de IA terminaría acoplada a
proveedores concretos.

## Decisión

Se definieron contratos sin implementar providers:

1. **`ProductionPlan`** en `packages/project-schema/src/studio.ts`
   (`STUDIO_PLAN_VERSION = 1`): brief, target, requirements con piso de
   derechos, escenas planned, specs de subtítulos/música, criterios de
   calidad, etapa del pipeline. Es artefacto de entrada del orquestador; **no**
   duplica `ProjectDocumentSchema`, que sigue siendo la única fuente de
   verdad del documento persistido. Espejo serde en `src/studio/plan.rs`.
2. **Puertos** en `src/ports/studio.rs`: `MediaCatalog` (índice incremental y
   recuperable), `ResourceAcquisition` (fuentes que declaran términos, límites
   y coste antes de buscar), `ContentGenerator` (capacidades por tipo:
   texto/imagen/vídeo/voz/música/sfx/animación).
3. **AI Editor**: se reutiliza `AgentOperation` (JSON Patch versionado con
   `expectedRevision`, coste declarado y aprobación) de `provenance.ts` — no
   se creó un segundo mecanismo de operaciones.
4. **Quality Gate**: `src/studio/quality.rs` (checks puros sobre el documento)
   + `src/application/quality_gate.rs` (agrega verificación de archivos en
   disco). Taxonomía alineada a `QualityCheckKindSchema` del plan. Es
   distinto del `qualityGate` por perfil de render (verificación post-render
   ya existente en `delivery.ts`).

## Alternativas

- **Meter el plan dentro del proyecto**: rechazado — el plan es entrada del
  orquestador y el documento es la verdad persistida; mezclarlos acoplaría
  borradores a entregas.
- **Un trait por tipo de generación**: rechazado — `ContentGenerator` con
  `capabilities()` permite proveedores multi-modal y selección por capacidad.
- **Quality Gate sólo post-render**: insuficiente — los fallos de producción
  (recursos faltantes, clips fuera de rango, subtítulos fuera de tiempo) se
  detectan antes de gastar un render.

## Consecuencias

- Ningún provider está implementado: los traits son la frontera que los
  adaptadores futuros (`infrastructure/`) deberán cumplir.
- `CommercialUseRequirement::satisfies` ordena derechos de peor a mejor para
  comparar el piso del plan contra lo declarado por una fuente.
- Los hallazgos del gate son tipados (`check` + `severity` + `path`) y
  serializables para IPC.

## Cómo se valida

- `studio.test.ts` (project-schema): 10/10 — defaults, ids únicos, referencias
  escena→requisito, idioma de subtítulos, dedupe de checks, claves estrictas.
- `cargo test --lib`: 14 tests nuevos en `studio::plan`, `studio::quality`,
  `ports::studio`, `application::quality_gate`.
- `cargo check`: 0 errores.

## Pendiente

- Implementaciones reales de catálogo, fuentes de adquisición y generadores.
- El orquestador (`Idea → Plan → … → Deliver`) que consume estos puertos.
- Comando IPC del Quality Gate (los casos de uso existen; falta exponerlos).
