# 04 — Contrato de Estudio Autónomo, operaciones y MCP

## 1. Regla principal

El sistema autónomo no es un loop de chat. Es un **orquestador de producción tipado**. El modelo interpreta y propone un plan; la aplicación valida los datos, evalúa permisos y costos, y ejecuta operaciones concretas sobre el proyecto. El proyecto editable es el resultado persistente.

El LLM no tiene permiso para ejecutar comandos arbitrarios, escribir archivos sin validación o inventar que un trabajo se completó.

## 2. Pipeline de producción

Etapas lógicas recomendadas (mapear al enum actual, sin duplicar etapas):
1. **Intake:** brief, referencias, input assets, objetivos y preferencias.
2. **Plan:** guion, storyboard, escenas, assets requeridos, presupuestos y acceptance criteria.
3. **Acquire:** localizar/adquirir/generar recursos permitidos y verificar metadata/rights.
4. **Analyze:** transcribir, detectar escenas/silencios/hablantes/encuadres y preparar mapas temporales.
5. **Design/Edit:** montar escenas, pistas, audio, captions, motion, efectos y transiciones.
6. **Review:** revisar coherencia creativa y checks técnicos; proponer reparaciones acotadas.
7. **Render:** exportar mediante motor y preset verificados.
8. **Verify/Deliver:** probe real, calidad, empaquetado, manifest y entrega.

Si el código actual utiliza nombres o cantidad de etapas distintos, conservar compatibilidad y documentar el mapping. La secuencia lógica no obliga a crear un segundo workflow paralelo.

## 3. Estados de ejecución

Estados de run:
- draft
- awaiting_approval
- queued
- running
- paused
- blocked
- failed
- cancelling
- cancelled
- completed
- completed_with_warnings

Estados por etapa:
- pending
- running
- succeeded
- skipped
- blocked
- failed
- cancelled

Transiciones prohibidas:
- cancelled -> running sin una acción explícita de resume que cree nueva attempt/version;
- failed -> completed sin resolver y validar el error;
- running -> completed sólo por progreso reportado por UI;
- awaiting_approval -> running sin permiso/decisión registrada;
- run completed si el artefacto no existe o no pasó el verifier.

Cada transición registra actor, fecha, run revision, causa y datos no sensibles.

## 4. Plan tipado

Reutilizar ProductionPlanSchema existente. El contrato lógico debe incluir:
- schemaVersion, planId, projectId, brief y target platform.
- idioma, audiencia, formato, aspect ratio, duración objetivo y fps.
- story arc, script segments y voice segments.
- scenes con ID estable, duración, objetivo, narración, visual direction y continuity refs.
- resource requirements por escena (imagen/vídeo/audio/SFX/font/graphic).
- assets locales vinculados y external assets con rights record.
- shot/clip in/out, camera motion, transition, overlays y caption cues.
- audio plan: narration, music bed, sound design, ducking y loudness target.
- budgets maxCost, provider allowlist y approval policy.
- quality criteria y delivery formats.

Todos los campos con límites, enum validado y versiones. Guardar prompts y outputs externos donde sea útil, pero no persistir secretos.

## 5. Operaciones tipadas del agente

Diseñar operaciones pequeñas y composables:
- Project: create/open/save/duplicate/restore.
- Media: probe/analyze/thumbnail/waveform/proxy/search/acquire/import/relink.
- Timeline: add_track/add_clip/update_clip/split/trim/move/ripple/transition/marker/keyframe.
- Visual: set_transform/apply_effect/set_color_grade/create_title/create_graphic/mask/track.
- Audio: set_gain/fade/eq/compress/duck/denoise/isolate/voiceover/music/sfx/subtitle.
- Motion: create_animation/lottie/stickman/particles/scene camera.
- Render: create_render_job/cancel/status/verify.
- Production: create_plan/revise/approve/advance/pause/cancel/resume/status/deliver.
- Provider: capabilities/test/estimate/generate.
- Quality: review_project/review_render/propose_repair/apply_repair.

No todas las operaciones deben exponerse al LLM por separado. Usar operaciones de alto nivel cuando sean más seguras y fáciles de validar; por ejemplo apply_edit_recipe, assemble_scene, create_short_variants.

Cada operación exige:
- JSON schema de input y output.
- preconditions y postconditions.
- permisos y risk level.
- idempotency key cuando aplique.
- cost estimate y side effect metadata.
- timeout/cancel policy.
- structured result y error code.
- audit event sin PII innecesaria.

## 6. Superficie MCP objetivo

MCP expone la superficie estable del producto, no cada función interna de Rust. Los nombres exactos deben armonizar con tools existentes, sin duplicados.

### Discovery / contexto
- olyvia_capabilities — lista capacidades verificadas y bloqueos.
- olyvia_project_get — resumen de proyecto/selección/playhead y revision.
- olyvia_media_search — búsqueda de biblioteca/catálogos con provenance.
- olyvia_media_inspect — detalles técnicos y derechos de un asset.

### Planificación y producción
- olyvia_production_create_plan — plan desde brief y contexto de proyecto.
- olyvia_production_validate_plan — validación y presupuesto estimado.
- olyvia_production_approve_plan — registra aprobación y alcance.
- olyvia_production_create_run — encola run autorizado.
- olyvia_production_run_status — estado y checkpoint.
- olyvia_production_run_list — historial del usuario.
- olyvia_production_pause / cancel / resume — lifecycle control.
- olyvia_production_advance — avanza una etapa cuando el workflow no es completamente automático.
- olyvia_production_deliverables — artifacts finales verificados.
- olyvia_quality_review — quality report de proyecto/render.

### Edición
- olyvia_project_apply_operations — lote de operaciones tipadas y validadas.
- olyvia_timeline_inspect — tracks, clips, selection y time range.
- olyvia_render_create / status / cancel — jobs de render.

### Proveedores
- olyvia_provider_capabilities — capabilities actuales por proveedor/modelo.
- olyvia_provider_test — conectividad sin revelar secreto.
- olyvia_provider_estimate_cost — estimación antes de ejecutar.

Reutilizar las tools ya implementadas (por ejemplo media_search, Flow, stickman, subtitles, markers, audio, OBS) y armonizar nombres. No duplicar tools semánticamente idénticas.

## 7. Seguridad y autorización MCP

- Todas las herramientas son input no confiable.
- Un tool call de lectura puede tener riesgo bajo; adquisición, generación facturable, edición y borrado tienen distintos niveles.
- Separar read-only, edit-project, network-download, cloud-generation, export, publish y destructive permissions.
- Herramientas de alto costo o cambio irreversible requieren aprobación explícita según la política del proyecto.
- Validar scope del proyecto y root path.
- Rechazar paths absolutos ajenos al project root, traversal, symlink escapes y URLs internas/metadata endpoints.
- No pasar shell command directo al agente.
- Las annotations de MCP ayudan a comunicar intención/riesgo, pero la app debe imponer permisos por su cuenta.
- Resultado incluye structuredContent/outputSchema cuando el SDK lo soporte; incluir texto humano sólo como resumen.
- Transport remote HTTP protegido por autenticación apropiada y TLS; stdio usa el proceso local y la confianza de su launch environment. No copiar token a logs.

## 8. MCP y worker en segundo plano

La UI no debe ser dueña del loop. El tool create_run crea job persistente; el worker avanza y el frontend consulta/recibe eventos. Minimizar u ocultar la ventana no altera el job. Al cerrar aplicación debe aplicarse la policy configurada:
- stop-on-exit: finalizar y checkpoint;
- keep-alive process: sólo si worker residente continúa;
- system service/scheduled runner: requiere instalación, autorización y visibilidad al usuario.

Nunca declarar “24/7” o “en segundo plano después del cierre” sin comprobar el servicio real.

## 9. Bug a revisar en el frontend de producción

La revisión previa detectó un posible closure obsoleto de stopRequested en AutonomousRunsPanel.tsx: callback shouldStop puede capturar el valor inicial del estado React. Corregir en el dueño del código: useRef o AbortController y tests que pulsen stop mientras polling/advance están en curso. No usar useState como señal de cancelación leída por una closure antigua.

Verificar state/production-runs.ts: autoavance por polling cada 1.5 s y máximo 60 pasos no puede ser el scheduler de producción definitivo. Debe quedar sólo como cliente del backend.

## 10. Acceptance tests

1. Crear un plan desde texto y schema validation.
2. Rechazar plan inválido o sobre presupuesto.
3. Crear run con aprobación requerida.
4. Continuar tras ocultar ventana.
5. Reanudar tras reinicio con checkpoint sin duplicar efectos.
6. Cancelar durante espera, descarga, generación, edición y render.
7. Fallo del provider 429/5xx -> retry acotado, status visible.
8. Ejecutar dos requests con el mismo idempotency key -> un solo job.
9. Tool MCP devuelve status y deliverables reales.
10. Scope/permission deny bloquea operación antes del side effect.
11. Rerender/repair respeta max attempts/max cost.
12. Deliverables sólo se declaran completados tras verificación y existencia en disco.
## 11. Compatibilidad MCP 2026-07-28 y tareas largas

Leer docs/olyvia-blueprint/15_CURRENT_TECHNICAL_UPDATES_2026-11-08.md antes de implementar el servidor.

- No asumir que los transportes HTTP modernos usan initialize/initialized o Mcp-Session-Id. La revisión MCP 2026-07-28 hace stateless el núcleo HTTP y define metadata/headers nuevos.
- Consultar el SDK y protocolo soportados por los clientes reales; conservar compatibilidad legacy cuando sea necesaria, sin mezclar ambos transportes.
- Para jobs largos, anunciar/consumir la extensión io.modelcontextprotocol/tasks si ambos lados la soportan. El cliente opta por tasks en _meta; el servidor puede retornar un task handle y el cliente consulta tasks/get, envía tasks/update o tasks/cancel.
- No implementar tasks/list ni exponer enumeración de runs por cliente en el protocolo moderno.
- La cancelación MCP es cooperativa. Debe propagarse al JobManager interno, terminar procesos descendientes, guardar checkpoint y verificar estado terminal.
- El runId/jobId persistente es la fuente de verdad; un task handle MCP no reemplaza la base de jobs.
- Usar input_required/MRTP para aprobación/inputs cuando el SDK lo soporte; no congelar un HTTP stream esperando que la UI conteste.
- Tool list tiene que ser determinista y filtrada por autorización; usar cache TTL sólo si la respuesta indica ttlMs/cacheScope.
- La UI de Olyvia tiene que mostrar tool invocada, alcance de permisos y posibilidad de denegar side effects.
- Para Streamable HTTP protegido, implementar la autorización de la revisión actual. STDIO sigue el mecanismo de credenciales del proceso y no copia el OAuth HTTP flow.
## 12. Fuente canónica de tools y catálogo grande

La auditoría 2026-11-03 encontró catálogos distintos entre Rust y TypeScript y envío de numerosas herramientas al modelo mediante un bloque JSON dentro del prompt. La matriz posterior reporta un catálogo mayor y un presupuesto de 48 KiB medido. SWE 2 debe confirmar qué sigue vigente.

- Mantener una única definición source-of-truth de tool id, description, input/output JSON schema, annotations, permissions, risks y domain.
- Derivar manifests por transporte/consumidor o testear igualdad semántica en CI.
- No exponer todas las herramientas del editor en cada request. Filtrar por capabilities, intención, selección y permisos del proyecto.
- La búsqueda de herramientas debe permitir descubrir tools por categoría sin inyectar todos los schemas al contexto.
- Si el prompt o proveedor tiene token limit, el sistema degrada con aviso/diagnóstico; nunca descarta herramientas sin indicarlo.
- Tool not discovered, tool denied, provider cannot call tools y tool execution failed son estados distintos.