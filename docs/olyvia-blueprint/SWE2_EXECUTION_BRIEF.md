# SWE 2 — Encargo de implementación backend de Olyvia

Sos responsable de llevar a producción las capacidades reales de Olyvia en el worktree de arquitectura. Debes implementar y probar, no limitarte a presentar un plan.

## Lectura obligatoria
1. docs/olyvia-blueprint/README.md
2. docs/olyvia-blueprint/01_PRODUCT_VISION.md
3. docs/olyvia-blueprint/03_BACKEND_SWE2_SPEC.md
4. docs/olyvia-blueprint/04_AUTONOMOUS_STUDIO_MCP_CONTRACT.md
5. docs/olyvia-blueprint/05_CAPABILITY_GAP_MATRIX.md
6. docs/olyvia-blueprint/06_PROVIDER_AND_MEDIA_CONNECTORS.md
7. docs/olyvia-blueprint/07_ENGINE_STACK_AND_OPEN_SOURCE_RESEARCH.md
8. docs/olyvia-blueprint/08_SECURITY_PRIVACY_PERFORMANCE.md
9. docs/olyvia-blueprint/09_IMPLEMENTATION_ROADMAP_AND_ACCEPTANCE.md
10. docs/architecture/README.md, CURRENT-STATE.md, TARGET-STRUCTURE.md, DEPENDENCY-RULES.md y MIGRATION-ROADMAP.md.
11. docs/CAPABILITY-MATRIX.md, docs/IMPROVEMENT-QUEUE.md, docs/product/PRODUCT-SPEC.md, docs/LICENSES.md y docs/integrations/MIT-STACK-2026-10-21.md.

## Objetivo
Construir el backend funcional que permita que Olyvia genere, edite, verifique y entregue proyectos audiovisuales con IA, manteniendo el editor manual, el proyecto editable y la neutralidad de proveedores.

## Primer bloqueo técnico de esta rama
Al verificar el worktree, estos junctions de node_modules apuntaban a MAIN:
- @editor-ia/project-schema -> editor-ia/packages/project-schema
- @editor-ia/desktop -> editor-ia/apps/desktop
- @editor-ia/effect-kit -> editor-ia/packages/effect-kit

En esta rama, el schema local sí contiene ProductionPlan/StudioStage y exports asociados, mientras la ruta enlazada a main no tenía la misma superficie. Por eso npm run verify falló con TS2305 por exports ausentes y errores secundarios. **No edites el repo main para solucionar esto.** Comprueba la topología, consulta package manager/workspace, y repara de forma aislada los enlaces para que cada workspace resuelva a su propio código. No elimines node_modules globales ni reinstales todo de forma indiscriminada. Después ejecuta typecheck de nuevo y registra resultado real.

## Reglas duras
- Trabajar sólo en D:\Users\ofici\QODER-WORK\editor-ia-architecture y en architecture/refactor-foundation.
- main está gestionado por otro agente y contiene cambios concurrentes; no modificarlo, detenerlo ni copiarlo masivamente.
- Antes de tocar cada área: git status, branch, diff, owners/cambios concurrentes y pruebas focalizadas.
- No hacer reset, clean, force, borrados masivos, commit, push, merge ni cherry-pick.
- No matar procesos Devin, Vite, MCP ni procesos del usuario.
- No reemplazar dependencias antes de revisar licencia/transitivas; backup de config cuando se toque.
- No imprimir ni copiar API keys, tokens, cookies o secretos en logs/documentos/prompts.
- No usar shell libre del modelo; generar argumentos de ejecutables desde parámetros tipados y allowlists.
- No incluir generación remota, descargas o publicación sin permiso explícito y cost estimate.
- No marcar una tarea como completa por compilar o por un mock.

## Orden de trabajo

### Fase 0 — Baseline, worktree y contratos
- Capturar branch/status/diff/head, versión toolchain, node, rust, Tauri, FFmpeg/ffprobe y procesos relevantes.
- Corregir aislamiento del workspace/junctions.
- Pasar typecheck y build sin tocar trabajo concurrente.
- Inspeccionar schemas, services, registry y tests para saber qué ya existe.
- Crear un current-state report con links a evidencia, no duplicar matrices previas.
- Comparar arquitectura local con main en read-only; no fusionar.

### Fase 1 — Cerrar dominio/autonomous plan
- Reutilizar ProductionPlanSchema v1 y su espejo Rust.
- Terminar el planner natural-language: intent, script, scenes, storyboard, constraints, budget, providers y assets.
- ProviderChat existente y keyring son reutilizables; no crear otro almacén de claves ni otro provider catalog.
- Schema validation obligatoria; la salida del modelo no modifica directamente el proyecto.

### Fase 2 — Motor de producción persistente
- Convertir los ejecutores actuales en pipeline recoverable, con checkpoint por etapa.
- Extraer scheduler/job ownership del React state.
- Worker continúa al ocultar/minimizar ventana y se recupera tras restart.
- Documentar con claridad el comportamiento al cerrar el proceso; no prometer continuidad 24/7 sin servicio OS.
- Arreglar stopRequested stale closure y garantizar cancelación hasta el proceso hijo de FFmpeg/descarga/provider.

### Fase 3 — Proveedores y generación multimodal real
- Conectar adapters reales para imagen, vídeo, audio, música, SFX, ASR, TTS, vision y translation según contratos.
- No inventar APIs; leer documentación oficial y comprobar cuenta/modelo/region/terms actuales.
- Descubrir capabilities por modelo, no por nombre del proveedor.
- Implementar async job polling/webhooks/cancel si el proveedor lo permite.
- Cost estimate + approval antes de generación facturable.
- No afirmar generación de vídeo si el adapter sólo crea imágenes/títulos.

### Fase 4 — Adquisición y licencias
- Integrar fuentes oficiales permitidas y APIs autorizadas.
- Derechos y procedencia por cada asset.
- No hacer scraping de páginas de usuario ni descargar contenido sin derechos.
- Fallar closed si licencia comercial no está clara para commercial mode.
- Evitar reutilizar binary/model weights sin auditoría.

### Fase 5 — Edición y ensamblado
- Todo se convierte en un project schema existente.
- Usar timeline operations, effects y renderer actuales.
- Añadir edición por escenas, B-roll, títulos, captions, audio, keyframes y transitions.
- Mantener no destructivo, undo/checkpoints y render project real.
- No sustituir FFmpeg actual ni recrear un editor paralelo.

### Fase 6 — Quality Gate y reparación
- Integridad del project, assets, source in/out, frame math y rights.
- Verificación real de render por ffprobe/decode + métricas de audio/video disponibles.
- Revisar loudness/true peak, captions, silencios, frames negros y output metadata.
- Reparar sólo hallazgos accionables con max attempts y max cost; volver a renderizar y revisar.
- Nunca auto-corregir material que altere el significado sin aprobación.

### Fase 7 — MCP semántico
- Tool registry con schemas de input/output, risk/permissions, idempotency y audit.
- Crear plan/run, inspeccionar status, cancelar/reanudar, buscar assets, revisar quality y consultar deliverables.
- Reusar los comandos application. No implementar otro camino que modifique directamente archivos.
- Probar conexión desde un cliente MCP real.

### Fase 8 — Preparar integración con HY4
- Publicar contratos estables y ejemplos request/response.
- Identificar eventos, estados, error codes y capability catalog.
- No cambiar UI visual, componentes, CSS ni layouts: es trabajo de HY4.
- Si un endpoint cambia, mantener compatibilidad o registrar migración y coordinar contrato.

### Fase 9 — Release y operación
- Packaging real en Windows.
- Verificar binarios, version, signatures/checksums, license notices y paths.
- Smoke test en cuenta/PC limpia.
- Informe de performance sobre PC de referencia.
- Actualizar README/ docs/CHANGELOG sólo con resultados reales.

## Definición de terminado
Un caso de uso sólo se marca como hecho cuando existe:
1. lógica funcional en capa correcta;
2. IPC/MCP integrado cuando aplica;
3. persistencia y recuperación;
4. manejo de permisos, errores, cancelación y costos;
5. tests unitarios/contract/integration pertinentes;
6. E2E real con artefactos y FFprobe cuando aplica;
7. documentación de limitaciones;
8. evidencia reproducible en esta rama.

## Informe de salida
Por cada fase: archivos, operaciones, contratos, pruebas y conteos reales, benchmark, licencias revisadas, riesgos, issues abiertos y siguiente ítem. Distingue implementado, parcialmente operativo, mock, bloqueado y no evaluado. No uses porcentajes globales sin denominador y evidencias.
## 10. Catálogo integral y entrega final obligatoria

Leer también, antes de implementar:
- docs/olyvia-blueprint/12_COMPLETE_FEATURE_CATALOG.md
- docs/olyvia-blueprint/13_FINAL_PROJECT_DELIVERY_CONTRACT.md
- docs/olyvia-blueprint/14_AGENT_EXECUTION_PROTOCOL.md
- docs/olyvia-blueprint/15_CURRENT_TECHNICAL_UPDATES_2026-11-08.md
6. docs/olyvia-blueprint/16_FEATURE_ACCEPTANCE_MATRIX.md
- docs/olyvia-blueprint/11_FRONTEND_BACKEND_HANDOFF.md

No respondas sólo con un plan ni pares cuando compile. Implementa las capacidades de tu ownership, conecta los flujos reales, ejecuta la aceptación y construye el instalador NSIS desde esta rama. La entrega debe quedar en deliverables/final/ con el contenido del documento 13. Si existe un bloqueo externo del usuario (credencial/API/billing), deja adapter/UI/contract tests terminados, marca el bloqueo con precisión y solicita sólo el requisito faltante; nunca simules una llamada real.