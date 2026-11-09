# 2026-11-08 — Planner brief→ProductionPlan + recursion limit MCP

## Qué se hizo

- `application/studio_planner.rs` (nuevo): `plan_from_brief(PlanRequest) -> ProductionPlan`.
  Planner **determinista** (sin LLM): brief estructurado → plan del modelo canónico
  `studio::plan::ProductionPlan`. Una escena por keyPoint (tope 8), requisito B-roll
  compartido, voz SAPI por escena narrada, `music:ambient`, tarjeta `title:`,
  plataforma/aspect/duración. Validación: objective 1–2000 chars, aspectRatio ∈
  {16:9, 9:16, 1:1, 4:5}, duración clamp 3–3600.
- IPC `production_plan_from_brief(request: Value) -> ProductionPlan` en
  `commands/domains/studio/production.rs` + registro en `commands/registry.rs`.
- MCP tool `production_plan_from_brief` en `infrastructure/mcp_studio.rs` + catálogo
  fallback en `mcp/server.rs` (33 tools) + `is_studio_tool`.
- `#![recursion_limit = "256"]` en `lib.rs`: el `json!` del catálogo MCP superó el
  límite de recursión por defecto del macro (~33 tools). Si el catálogo crece mucho
  más, conviene partirlo en builders separados en vez de subir más el límite.
- Handoff §16 documenta `PlanRequest` campo a campo.

## Contrato PlanRequest (camelCase)

`objective` (req, ≤2000), `audience`, `tone`, `keyPoints[]` (≤2000 c/u),
`sceneCount` 1–8, `durationSeconds` 3–3600, `platform`
(youtube|shorts|reels|tiktok), `aspectRatio` (16:9|9:16|1:1|4:5), `voice`,
`music`, `titleCard`, `brollQuery`, `maxCostCents`.

Flujo MCP/IA: `production_plan_from_brief` → revisar plan → `production_create`
→ `production_start`. Nada crea la corrida implícitamente.

## Verificación

- `cargo test --lib studio_planner` → 8/8 (rechazos: objetivo vacío, >2000,
  aspectRatio inválido; defaults verticales; voz+música+portada; fallback 1 escena).
- `cargo test --lib mcp::` → 22/22 · `studio::` 62/62 · `production` 10/10.
- `cargo fmt --check` limpio.

## Pendiente honesto

- El planner toma brief **estructurado**, no NL libre. Interpretar "haceme un video
  de X" en texto → PlanRequest requiere provider de chat (Fase 3 BYOK).
- Planner es puro cómputo: no valida que los providers satisfagan los requisitos
  (eso lo hace `acquire` en runtime, honestamente).

## Addendum — planner NL (`production_plan_from_text`)

- `plan_from_text(chat, config, key, text)` en el mismo módulo: texto libre
  10–2000 chars → ProviderChat → `PlanRequest` JSON → `plan_from_brief`.
  UN reintento de reparación vía `json_repair_messages`; `mock` ⇒ error
  honesto (no simula comprensión).
- `generation_provider` (application/providers) ahora `pub(crate)` — misma
  política de coste: remoto exige `approvedCost`, loopback no, mock corta.
- IPC `production_plan_from_text` + tool MCP homónima (async en el invoker,
  openWorldHint, NO read-only). Catálogo fallback: 36 tools.
- Tests: FakeChat encolado — JSON válido (1 llamada), JSON roto→repair→OK
  (2 llamadas), doble basura→InvalidProviderResponse, mock/corto→0 llamadas.
