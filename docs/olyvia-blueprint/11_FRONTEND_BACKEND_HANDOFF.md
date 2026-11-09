# 11 — Contrato de integración frontend/backend HY4 ↔ SWE 2

## 1. Propósito
HY4 y SWE 2 trabajan como equipos separados. Este documento fija las responsabilidades y el contrato de información entre UI y application services. No sustituye los tipos reales del repositorio: antes de codificar, mapear cada contrato a la fachada DesktopService/Tauri existente y versionar cualquier cambio.

## 2. Ownership
| Dominio | Owner | UI consume |
|---|---|---|
| Proyecto, timeline, clips, tracks, effects | SWE 2 | Snapshot, selectors, typed commands y revision |
| Production plans/runs/jobs | SWE 2 | Plan, run status, progress events, checkpoints y deliverables |
| Providers, secrets, model capabilities, pricing | SWE 2 | Metadata saneada, capability list, health, cost estimate |
| MCP server lifecycle, tools y authorization | SWE 2 | Conexiones, tools, permissions, health y diagnostics |
| Shell, navigation, visual hierarchy, components | HY4 | Datos y estados de servicios |
| Timeline UI, inspector, dialogs, workspace layout | HY4 | Operaciones del backend y project state |
| Assistant composer/conversation presentation | HY4 | Chat/agent service contracts y action results |
| UX errors, loading, empty, offline, disabled states | HY4 | Structured error/event contract |
| Contract schema, error code, event compatibility | SWE 2 propone; ambos aprueban | Versioned schema |

## 3. Versioning y compatibilidad
- Request, response, events y persisted models tienen schemaVersion.
- Agregar campos opcionales es preferible a cambiar significado de existentes.
- Campos obligatorios nuevos exigen version/migration.
- No reutilizar un error code para un significado distinto.
- Contract fixtures se guardan y prueban en el repo.
- No duplicar interfaces TypeScript manuales cuando schema generation/shared types ya existe.
- Si no puede generarse el contrato, mantener test que compara TypeScript DTO con JSON schema/Rust serde.

## 4. Envelope de respuesta
Usar un shape coherente, adaptado al patrón actual del repo:

~~~json
{
  "schemaVersion": 1,
  "requestId": "uuid",
  "ok": true,
  "data": {},
  "error": null,
  "warnings": []
}
~~~

Error:
~~~json
{
  "schemaVersion": 1,
  "requestId": "uuid",
  "ok": false,
  "data": null,
  "error": {
    "code": "PROVIDER_NOT_CONFIGURED",
    "message": "No hay un proveedor disponible para esta modalidad.",
    "retryable": false,
    "action": "OPEN_PROVIDER_SETTINGS",
    "details": {}
  },
  "warnings": []
}
~~~

No retornar stack traces, filesystem secrets, tokens o payloads internos de proveedor en error.message.

## 5. Job contract
Cada operación larga devuelve jobId/runId inmediatamente y permite reconsultar estado aunque el frontend se recargue.

~~~json
{
  "schemaVersion": 1,
  "jobId": "uuid",
  "kind": "production.run",
  "state": "queued",
  "stage": "plan",
  "progress": {
    "completed": 0,
    "total": 8,
    "percent": 0,
    "message": "En cola"
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "canCancel": true,
  "canPause": true,
  "estimatedCost": null,
  "actualCost": null,
  "warnings": [],
  "error": null
}
~~~

Reglas:
- percent nullable si no se puede calcular.
- No inventar ETA. ETA sólo si backend tiene medida razonable.
- La UI no calcula estado de job a partir de timers.
- El backend es dueño del state; UI lo renderiza y manda commands.
- canCancel/canPause vienen del backend y reflejan estado real.
- Reconnect debe reconstruir estado desde snapshot.

## 6. Eventos de progreso
Evento sugerido (adaptar al event system actual):
~~~json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "jobId": "uuid",
  "sequence": 12,
  "type": "job.stage.completed",
  "timestamp": "ISO-8601",
  "payload": {
    "stage": "acquire",
    "state": "succeeded",
    "message": "Recursos verificados"
  }
}
~~~

Tipos mínimos:
- job.queued
- job.started
- job.progress
- job.stage.started
- job.stage.blocked
- job.stage.completed
- job.warning
- job.failed
- job.cancelling
- job.cancelled
- job.completed
- job.checkpoint.saved
- job.deliverables.ready

sequence es monotónico por job. Frontend descarta duplicados y pide snapshot si detecta huecos. Los eventos no contienen secretos ni binarios completos.

## 7. Capability registry
Backend publica capacidades con:
- capabilityId y domain
- status: ready, degraded, unavailable, blocked
- input/output modalities
- provider/model id si aplica
- supported formats/durations/resolutions
- requirements (network, credential, OS, hardware)
- permission scope
- pricing unit/status
- max concurrency/limits
- reason unavailable y action necesaria
- version/dateChecked

HY4 renderiza este registry. No mantiene un catálogo paralelo hardcodeado.

## 8. Project operation contract
Las operaciones de edición deben incluir:
- projectId;
- expectedRevision;
- operationId;
- idempotencyKey si aplica;
- typed operation payload;
- actor/source (user, assistant, production run);
- groupId para undo de una acción compuesta;
- previewOnly o validateOnly cuando corresponda.

Response contiene newRevision, normalized changes, affected IDs, warnings, undo handle si está disponible y validation result.

Conflicto de revision devuelve STALE_PROJECT_REVISION; no sobrescribir silenciosamente cambios manuales mientras corre la IA. El backend debe reconciliar, rechazar o pedir confirmación.

## 9. Assistant action result
Cada acción de IA visible a la UI debe transportar:
- assistantMessageId;
- intent summary;
- proposed plan/operations;
- affected entities;
- approval required and why;
- cost estimate;
- permission scope;
- execution/job id;
- applied changes + warnings/errors;
- undo/revert availability.

No enviar chain-of-thought. Un resumen de acción no sensible sirve para que el usuario entienda el resultado.

## 10. Provider settings DTO
La UI puede recibir:
- providerId, displayName, configured, testedAt, health;
- models con supportedCapabilities, limits, price source/date;
- credentialState: absent, stored, invalid, expired (nunca credential value);
- region, privacy/retention summary, warnings.

Guardar/rotar secreto ocurre por una acción protegida en backend. Nunca enviar secreto de vuelta al frontend.

## 11. MCP settings DTO
Mostrar servidor, transport, enabled, connected, protocolVersion, tool count, last successful handshake, permissions y error code saneado.
No confundir:
- configured ≠ connected;
- connected ≠ all tools allowed;
- tool discovered ≠ tool executed successfully.
Permissions deben derivarse de policy backend.

## 12. Errores comunes tipados
- VALIDATION_FAILED
- PROVIDER_NOT_CONFIGURED
- PROVIDER_UNAVAILABLE
- MODEL_CAPABILITY_UNSUPPORTED
- PROVIDER_RATE_LIMITED
- PROVIDER_QUOTA_EXCEEDED
- COST_APPROVAL_REQUIRED
- RIGHTS_REVIEW_REQUIRED
- PERMISSION_DENIED
- PROJECT_NOT_FOUND
- STALE_PROJECT_REVISION
- MEDIA_MISSING
- MEDIA_INVALID
- JOB_NOT_FOUND
- JOB_NOT_CANCELLABLE
- JOB_CANCELLED
- DISK_SPACE_INSUFFICIENT
- RENDER_VERIFICATION_FAILED
- QUALITY_GATE_FAILED
- MCP_SERVER_UNAVAILABLE
- INTERNAL_ERROR

HY4 traduce code -> localized UI. SWE 2 emite code + safe details y retryable; nunca traducir un error interno a success.

## 13. Contrato de pruebas
- Golden fixtures para DTOs.
- Schema validation en Rust y TypeScript.
- Tests de event ordering/reconnect/duplicate sequence.
- Tests de stale revision y concurrent modifications.
- Test de UI states para cada error principal.
- E2E run que inicia en HY4, ejecuta en SWE 2 y muestra el artefacto verificado.
- No utilizar un mock para aprobar integración de producción.

## 14. Acuerdo de cambio
Cualquier modificación de DTO/event name/state transition se anuncia primero en una nota de contrato, se actualiza fixture y se prueba compatibilidad antes de cambiar consumers. Si no hay acuerdo, se mantiene la última versión estable y la pantalla muestra capability unavailable para la función nueva.

## 15. Nota de contrato — 2026-11-08 (SWE 2): driver de corridas + tools MCP de estudio

**Cambio aditivo, sin romper contratos existentes.**

### IPC nuevo

- `production_start(run_id: string) -> Promise<boolean>` — arranca el driver backend que conduce la corrida etapa por etapa hasta `done`/`paused`/`failed`/`cancelled`, sin depender de la UI. Idempotente; si la corrida está `paused` o `failed` la reanuda primero. Límite: 2 drivers simultáneos.
- `production_resume` ahora además arranca el driver (las corridas reanudadas progresan solas mientras el proceso de la app viva).
- `production_cancel` ahora cancela también el proceso FFmpeg activo de la etapa `render` (antes sólo cambiaba el estado).
- `production_advance` sin cambios de firma: sigue avanzando una etapa; ahora está serializado por corrida con el driver (seguro llamarlo a mano con un driver activo).

### Tools MCP nuevas (ejecutadas 100% en backend, no requieren ventana)

| Tool | Args | Resultado |
|---|---|---|
| `production_list` | — | `{ runs, count }` |
| `production_status` | `runId` | `{ run }` o `run: null` |
| `production_create` | `plan` (ProductionPlan serializado), `runId?`, `maxCostCents?` | `{ run }` |
| `production_start` | `runId` | `{ runId, active }` |
| `production_advance` | `runId` | `{ run }` (una etapa) |
| `production_cancel` | `runId` | `{ run }` |
| `production_resume` | `runId` | `{ run }` |
| `production_pause` | `runId` | `{ run }` |
| `studio_capabilities` | — | `{ pipelineStages, mediaTools, generators, acquisitions }` |

`studio_capabilities` es el capability registry del estudio: instancia los providers reales y reporta lo que declaran (kind, coste, red, límites) más fuentes de adquisición y disponibilidad de ffmpeg/ffprobe. HY4 puede usarlo para renderizar capacidades sin hardcodear un catálogo paralelo.

### Evento Tauri `production-run`

Cuando el driver backend conduce una corrida, emite `production-run` en cada cambio real (firma: estado + etapa actual + updated_at + gasto; los sondeos de etapa async no emiten). Payload: `{ "runId": string, "run": ProductionRun }` — mismo shape que `production_status`. HY4 puede escuchar con `listen('production-run')` y actualizar la UI sin polling; el polling de `production_status` sigue siendo válido como fallback.

IPC adicional: `production_pause(run_id) -> ProductionRun` (cierra el ciclo create/start/pause/resume/cancel).

Errores MCP de estas tools: `isError: true` con cuerpo JSON `{"error":{"code","message"}}` donde `code` es el `ProjectErrorCode` en SCREAMING_SNAKE (`NOT_FOUND`, `INVALID_PROJECT`, `IO`, etc.).

`tools/list` siempre incluye estas 7 tools aunque el catálogo de la ventana no las declare. Las read-only (`production_list`, `production_status`) se marcan `readOnlyHint: true` y pueden ir en lotes paralelos.

### Semántica honesta del driver

- El driver vive dentro del proceso de la app: **ocultar la ventana no lo detiene; cerrar la app sí** (no hay servicio residente en Windows todavía — limitación documentada, no afirmamos continuidad tras salida del proceso).
- La cancelación es cooperativa por etapa + real para el render FFmpeg (se mata el proceso hijo). Una etapa síncrona larga (p.ej. descarga) termina su paso actual antes de frenar.
- HY4 puede seguir usando `advanceProductionRun` (polling UI): es seguro coexistir con el driver por la serialización por corrida. Recomendado migrar a `production_start` + `production_status`/eventos para no duplicar trabajo.
- **Reinicio de la app**: al arrancar, las corridas que quedaron `running` pasan a `paused` (reconciliación segura; nunca se auto-reanuda trabajo pesado). HY4 debe reflejar `paused` como "interrumpida — se puede reanudar".

## 16. Nota de contrato — 2026-11-08 (SWE 2): planner brief → ProductionPlan

**Cambio aditivo, sin romper contratos existentes.**

### IPC nuevo

- `production_plan_from_brief(request: PlanRequest) -> Promise<ProductionPlan>` — construye un `ProductionPlan` válido y serializable desde un brief estructurado. **No crea ni ejecuta la corrida**: el cliente revisa/edita el plan y luego llama `production_create` con él (o lo ajusta antes de enviar).

`PlanRequest` (camelCase, todas las cotas validadas en backend):

| Campo | Tipo | Notas |
|---|---|---|
| `objective` | string, **requerido**, 1–2000 | Texto del objetivo; también alimenta la tarjeta de título si `titleCard` |
| `audience`, `tone` | string ≤500 | Metadatos del plan |
| `keyPoints` | string[] ≤16 ítems, cada uno ≤2000 | Una escena por key point; si falta, una sola escena con el objetivo |
| `sceneCount` | int 1–8 | Tope de escenas (keyPoints puede generar menos) |
| `durationSeconds` | int 3–3600 | Duración objetivo repartida entre escenas |
| `platform` | enum `youtube`/`shorts`/`reels`/`tiktok` | Default `youtube` |
| `aspectRatio` | enum `16:9`/`9:16`/`1:1`/`4:5` | Default: `9:16` para plataformas verticales, `16:9` para el resto |
| `voice` | string ≤200 | Nombre de voz; si viene, cada escena narrada genera requisito `voice` + escena de audio (misma convención que el builder del frontend) |
| `music` | boolean | Requisito `music` con query `music:ambient` + `plan.music.enabled` |
| `titleCard` | boolean | Escena `portada` inicial con requisito `image`/`title:<objetivo>` |
| `brollQuery` | string ≤500 | Query B-roll; default derivada del objetivo |
| `maxCostCents` | int ≥0 | Tope de gasto del plan |

### Tool MCP nueva

- `production_plan_from_brief` — mismos args que `PlanRequest` (`objective` requerido). Devuelve el `ProductionPlan` serializado como `structuredContent`/`content`. Es **no destructiva** (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`): sólo construye el plan en memoria.

### Semántica

- El planner es **determinista**: mismo input → mismo plan (sin LLM, sin red). La "inteligencia" de interpretación NL completa queda para una fase posterior con providers de chat; este endpoint cubre el contrato estructurado que HY4/MCP necesitan hoy para no serializar planes a mano.
- El plan resultante pasa la validación del schema `ProductionPlan` de Rust (mismo modelo que `production_create`), así que `production_plan_from_brief` → `production_create` → `production_start` funciona sin pasos intermedios.
- Errores: `INVALID_PROJECT` si falta `objective` o algún campo excede su cota; `INVALID_PROJECT` también si la combinación no produce escenas válidas.

## 17. Nota de contrato — 2026-11-08 (SWE 2): generación remota de imágenes BYOK (`gen:`)

**Cambio aditivo.** Primer provider remoto de generación del estudio: reutiliza la configuración BYOK del proveedor de chat (`openai-compatible` + URL + modelo + clave en Credential Manager). No agrega settings nuevas ni pantallas: HY4 no necesita cambios.

### Convención de requisito

Un `ResourceRequirement` de kind `image` cuyo `query` empiece con **`gen:`** pide generación remota; el resto del query es el prompt (máx. 2000 chars). Ejemplo: `{"kind":"image","query":"gen:hoja de ruta sobre fondo oscuro","maxCount":1}`.

### Política de ejecución (honesta)

- **Endpoint no-local** (https público): puede facturar ⇒ exige `maxCostCents > 0` en el plan. Sin presupuesto declarado el requisito falla con razón "exige presupuesto declarado" — nunca gasta sin autorización explícita.
- **Endpoint loopback** (shim local, p.ej. pruebas): no exige presupuesto.
- **Sin proveedor configurado**: el requisito queda insatisfecho → la etapa `acquire` falla `requires_provider` con la razón ("generador remoto de imagen no configurado"). NO cae en silencio a stock.
- La API `/images/generations` no devuelve coste ⇒ `costCents` queda `null` y la capability declara `estimated_cost_cents: null`. El gasto real lo acota el presupuesto del plan, no una estimación.
- **Derechos**: el asset se registra con `license.id="provider-terms"`, `commercialUse="unknown"`, `provenance.origin="generated-remote"` — el quality gate lo marca para revisión en vez de declararlo usable.

### Superficie

- `RemoteImageGenerator` (`infrastructure/studio/remote_image.rs`): POST `{base}/images/generations` con `response_format:"b64_json"` y reintento sin él en 400/415/422; acepta `b64_json` y `url` (ésta exige https/no-loopback, sin credenciales embebidas, máx. 32 MB, magic bytes de imagen validados).
- `AppState::remote_image_generator()` construye el generador desde settings+keyring; `studio_capabilities` (MCP) lo reporta en `generators[]` y `remoteImage` (sin exponer la clave).
- Formatos de salida: png/jpg/gif/webp detectados por magic; `size` configurable vía `params.size` ∈ {256x256, 512x512, 1024x1024, 1024x1792, 1792x1024}.

### Lo que NO hace (pendiente)

- No hay planner que emita `gen:` automáticamente (el planner no conoce las capacidades del provider; un cliente puede combinar `production_plan_from_brief` + edición del plan, o construir el requisito a mano).
- Sólo imágenes. Vídeo/voz/música remotos quedan para fases siguientes.
- Coste por llamada no medido (la API no lo informa); documentado como limitación.

## 18. Nota de contrato — 2026-11-08 (SWE 2): planner de lenguaje natural (`production_plan_from_text`)

**Cambio aditivo.** Cierra el loop "intención → plan": texto libre → provider de chat BYOK → `PlanRequest` → `ProductionPlan`. No crea ni ejecuta la corrida.

### IPC nuevo

- `production_plan_from_text(request: { text: string, approvedCost?: boolean }) -> Promise<ProductionPlan>`
  - `text`: 10–2000 chars. `approvedCost`: autoriza gasto del provider remoto (misma regla que `generate_script`: endpoint no-local lo exige, loopback no).

### Tool MCP nueva

- `production_plan_from_text` — args `{ text (req, 10–2000), approvedCost? }`. Devuelve `{ plan }`. Anotada `openWorldHint: true` (llama al provider externo), NO read-only (puede gastar).

### Semántica honesta

- El modelo devuelve un `PlanRequest` JSON acotado; `plan_from_brief` valida y construye (mismo camino que §16). JSON inválido ⇒ UN reintento de reparación; dos fallos ⇒ `InvalidProviderResponse`.
- Provider `mock` ⇒ error explícito (no simula comprensión). Sin provider configurado ⇒ `ProviderUnavailable`. Remoto sin `approvedCost` ⇒ `CostNotApproved`.
- El plan resultante se puede editar antes de `production_create`; el modelo nunca toca el documento del proyecto.
- Límite: el "brief" que el modelo produce está acotado por el contrato `PlanRequest` (máx. 8 escenas, campos conocidos); texto hostil sólo puede producir un plan raro pero válido o un error — nunca ejecución directa.
## 19. Nota de contrato — 2026-11-09 (SWE 2): repair loop + campos nuevos en ProductionRun

**Cambio aditivo.** `ProductionRun` serializado gana dos campos opcionales:

- `repairAttempts: number` — ciclos review→repair→render consumidos (tope 2).
- `lastRepair?: string` — descripción de la última reparación aplicada.

Ambos con `#[serde(default)]`: runs viejos sin los campos siguen cargando.

### Semántica para HY4

- Si la etapa `review` falla por Quality Gate, el backend intenta UNA
  reparación mecánica acotada (hoy: clamp de rangos de clip fuera de la
  duración del asset), verifica que el documento reparado pasa el gate
  completo y, sólo entonces, re-ejecuta `render`+`review`. La UI verá la
  corrida volver a `running` con `repairAttempts` incrementado y
  `lastRepair` describiendo el fix.
- Si la reparación no deja el gate en verde, la corrida queda `failed`
  como antes — no hay reintentos a ciegas ni renders desperdiciados.
- El evento `production-run` sigue emitiéndose en cada cambio; HY4 puede
  mostrar `lastRepair` como nota de progreso.

## 20. Nota de contrato — 2026-11-09 (SWE 2): voz remota TTS (`remote:`)

**Cambio aditivo.** Requisito `voice` del plan: `req.voice` admite la
convención `remote` o `remote:<voz>` (p.ej. `remote:alloy`) para pedir
síntesis TTS remota BYOK (`POST /audio/speech` OpenAI-compatible, misma
configuración de provider + clave en Credential Manager que `gen:`).

- Sin provider configurado o sin `maxCostCents > 0` (endpoint remoto), el
  requisito queda insatisfecho con razón — no hay fallback silencioso a SAPI.
- `studio_capabilities` reporta `remoteVoice` (`null` si no está listo).
- El asset queda `generated-remote`/`provider-terms`/`unknown` (revisión
  de derechos en el quality gate).

## 21. Nota de contrato — 2026-11-09 (SWE 2): review verifica el MP4 renderizado

**Cambio aditivo.** El reporte de la etapa `review` ahora incluye hallazgos
sobre el ARCHIVO renderizado, además de los documentales:

- `resolution`: ffprobe mide el mp4; si difiere de `video.width/height` del
  proyecto ⇒ `error` (bloquea deliver).
- `loudness`: si el plan declara `quality.loudnessTargetLufs`, ffmpeg ebur128
  mide el loudness integrado. Desvío >3 LU ⇒ `error`; 1–3 LU ⇒ `warning`.
- Herramienta no disponible o archivo no medible ⇒ `warning` honesto,
  nunca una medición simulada.

Los hallazgos nuevos usan los mismos `check` (`resolution`, `loudness`),
`severity`, `path:"render.output"` y `message` — HY4 los renderiza igual
que los existentes. `passed`/`errors`/`warnings` del reporte ya los
conteman. Si un error de media aparece, el repair loop existente evalúa
si es mecánicamente reparable (hoy sólo clip-range; resolución/loudness
quedan `failed` con el hallazgo claro).

## 22. Nota de contrato — 2026-11-09 (SWE 2): reconciliación con HY4

Revisión del consumo real del frontend (`apps/desktop/src/**`, solo lectura):

**Cubierto hoy:**
- `production_create` / `production_status` / `production_list` /
  `production_resume` / `production_cancel` / `production_remove` /
  `production_advance` — registrados en `shared.ts` y usados por
  `AutonomousRunsPanel` + `state/production-runs.ts`.

**Gaps detectados (para HY4, backend ya listo):**
- `production_start` / `production_pause`: implementados y registrados;
  el frontend aún no los invoca (sigue con `advance` + sondeo de
  `production_status`). `production_start` arranca el driver backend que
  avanza solo — recomendado para corridas largas.
- Evento `production-run` (`{ runId, run }`): emitido por el driver en
  cada cambio real; el frontend no lo escucha todavía (sigue polleando).
  Permite eliminar el sondeo de `production_status` para etapas largas.
- `production_plan_from_brief` / `production_plan_from_text`: disponibles
  por IPC; la UI arma el plan con su propio builder (`production-plan.ts`).
  Son equivalentes; HY4 puede migrar o mantener el builder local.
- `repairAttempts` / `lastRepair` en `ProductionRun`: campos aditivos del
  serde; el tipo TS puede ignorarlos sin romperse. Si HY4 quiere mostrarlos
  ("el sistema reparó X"), ya están en el payload.
- `studio_capabilities.remoteVoice`: nuevo campo aditivo; `remoteImage`
  ya existía.

## 23. Tool MCP `quality_gate_review` — 2026-11-09 (SWE 2)

Nueva tool de estudio ejecutada 100% en backend (readOnlyHint):
devuelve el `QualityReportSummary` del proyecto abierto — misma lógica
que el comando IPC `quality_gate_review` (`application::quality_gate::
review_open_project`), evaluando el último estado guardado en disco.
Catálogo MCP: 37 tools.
