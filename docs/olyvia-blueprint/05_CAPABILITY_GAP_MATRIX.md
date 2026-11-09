# 05 — Matriz de capacidades y brechas de Olyvia

**Corte documental:** 2026-11-08. Esta matriz es un mapa de trabajo inicial, no una auditoría ejecutada automáticamente al leerla. Revalidar cada ruta y prueba en esta rama.

## 1. Leyenda
- **REAL:** implementación localizada y comprobada mediante prueba/flujo funcional.
- **PARCIAL:** existe parte del flujo, pero falta integrar etapas, recovery, UI, provider o verificación.
- **GAP:** no se encontró implementación completa en el pipeline objetivo.
- **BLOCKED:** no se puede validar debido a entorno, licencia, credencial o dependency issue.
- **NOT EVALUATED:** falta una revisión actual y reproducible.

La existencia de una interfaz, trait, comando, pantalla, documento o demo no prueba que una capacidad esté operativa de punta a punta.

## 2. Capacidades base del editor
La matriz existente docs/CAPABILITY-MATRIX.md contiene un inventario más amplio y referencias por archivo. SWE 2 debe mantener ese documento como evidencia técnica detallada y actualizarlo después de cada fase. No duplicar todas sus filas aquí.

| Área | Estado inicial | Evidencia / punto de partida | Trabajo por validar o cerrar |
|---|---|---|---|
| Proyecto editable versionado | REAL | packages/project-schema y tests del schema | Migraciones compatibles, recovery y portable delivery E2E. |
| Timeline multipista / timecode / undo | REAL | project-schema, project-actions y Timeline | Pruebas de regresión en las operaciones usadas por IA. |
| Render FFmpeg/FFprobe | REAL | commands/render, worker y pipeline actual | Verificación integral de audio/video, crash recovery y perfiles. |
| Proxies, interchange EDL/OTIO/FCPXML | REAL | comandos existentes en matriz | Validar round-trip y medios faltantes en proyecto grande. |
| Color / LUTs / scopes | REAL/PARCIAL | color engine, comandos y UI descritos en matriz | Consolidar UI duplicada, preset parity y validación visual. |
| Efectos / transiciones / keyframes | REAL/PARCIAL | effect-kit, VFX, motion y render | Cobertura de filtros y equivalencia preview/export por efecto. |
| Audio mixer / loudness / waveform | REAL/PARCIAL | mixer, audio scopes, loudness | E2E de mezcla final y quality report unificado. |
| Subtítulos / TTS / diarización / voice isolation | REAL/PARCIAL | subtitles, SAPI, piper integration paths, diarization modules | Auditar bundling, provider fallback, modelos y licencias. |
| Motion graphics / Lottie / stickman / nodes | REAL/PARCIAL | Lottie, stickman Rust y editor de nodos | Coverage de export, editor visual y formatos interoperables. |
| Descargas / conversión / compresión | REAL/PARCIAL | downloader, convert, compress | Rights record, límites y pruebas de formatos hostiles. |
| MCP base | REAL/PARCIAL | MCP client/server y tools actuales | Catalog/permissions/health; unificar APIs con application layer. |
| Google Flow | NOT PRESENT IN ARCH WORKTREE | Integración identificada en main | Auditar diferencias, términos/API estable, port selectivo; no copiar en bloque. |

## 3. Estudio autónomo: evidencia y brechas

| Capacidad | Estado inicial | Evidencia conocida | Falta |
|---|---|---|---|
| ProductionPlan versionado | REAL | packages/project-schema/src/studio.ts y espejo Rust | Revalidar migraciones/exports tras corregir workspace links. |
| Pipeline de etapas | REAL | application/production.rs, studio/run.rs, composite y executors | Recovery tras reinicio, scheduler real, idempotencia y límites. |
| Adquisición local | REAL | LocalProjectCatalog y LocalResourceAcquisition | Ranking, metadata y permisos conflictivos. |
| Internet Archive | REAL, limitado | adapter actual y E2E live | Rights review por archivo, otros conectores y políticas comerciales. |
| Voz local | REAL, limitado | Windows SAPI | TTS neuronal de licencia compatible y voice capability registry. |
| Música local | REAL, limitado | generador de música/ambiente vía FFmpeg | Composición/edición con control creativo y tests auditivos. |
| Títulos y patrones locales | REAL, limitado | ejecutores FFmpeg titlecard/pattern | Diseño gráfico editable y biblioteca de templates. |
| Ensamblado de escenas | REAL | assembly executor | Incluir generación/adquisición real para cada recurso requerido. |
| Render final y ffprobe | REAL | render executor | Gate completo de audio/video y render-repair-review acotado. |
| Planner natural-language | PARCIAL | buildProductionPlanFromProject, ProviderChat reutilizable | Intent analyzer, script planner, storyboard, constraints y revisión. |
| Generación remota de imagen | GAP EN EL PIPELINE | trait ContentGenerator; integración Flow ubicada en main | Adapter real conectado al orquestador y contract/live tests. |
| Generación remota de vídeo | GAP EN EL PIPELINE | capacidades modeladas en ports, sin integración verificada | Adapter y job lifecycle; confirmar cada modelo/endpoint. |
| TTS/STT/music/SFX externos | PARCIAL | interfaces y herramientas específicas existentes | Router por capabilities, costos, consentimiento y async jobs integrados. |
| Producción vía MCP | GAP | IPC Tauri disponible; tools de media/edición existentes | Exponer create plan/run/status/advance/cancel/resume/deliverables por MCP. |
| Background al ocultar ventana | PARCIAL | autoavance coordinado desde React | Worker independiente de la ventana; reconnect/event feed. |
| Continuar tras cerrar proceso | GAP / NO GARANTIZADO | job persistence no equivale a proceso vivo | Servicio/task Windows explícito o política stop-on-exit honesta. |
| Cancelación fiable | PARCIAL | controles Stop/Cancel; posible stale closure React | AbortController/useRef en UI y cancel token hasta child process. |
| Quality Gate | PARCIAL | valida timeline/assets/rights/ranges; ffprobe básico | Métricas completas, visual review y repair loop limitado. |
| Entrega/manifest | REAL/PARCIAL | deliverables/manifest en executor | Verificar bundle editable, hashes, rights report y reopen project. |

## 4. Evidencia de pruebas previa
En una revisión anterior del worktree se reportó:
- node scripts/verify-studio.mjs: 12 pruebas live y 7 E2E reales, resultado global verde.
- Una ejecución Rust del crate desktop terminó con exit code 0; el resumen extraído entonces no permite atribuir un número exacto de tests passed aquí.
- npm run verify falló en typecheck por TS2305: exports del schema studio ausentes al resolver el junction hacia main.

Esto es evidencia histórica cercana, no certificación del HEAD actual. Repetir los comandos y guardar output fechado antes de usar esta tabla como dashboard.

## 5. Bloqueador de workspace confirmado
En el worktree de arquitectura se observaron estos junctions:
- node_modules/@editor-ia/project-schema -> D:/Users/ofici/QODER-WORK/editor-ia/packages/project-schema
- node_modules/@editor-ia/desktop -> D:/Users/ofici/QODER-WORK/editor-ia/apps/desktop
- node_modules/@editor-ia/effect-kit -> D:/Users/ofici/QODER-WORK/editor-ia/packages/effect-kit

Los paquetes locales de architecture son distintos; el schema local sí incluye el módulo studio que el enlace a main no expone. Resultado: el typecheck consulta contratos de otro worktree. Reparar el aislamiento de workspace antes de modificar exports para silenciar TS2305.

## 6. UX/frontend: brechas auditadas históricamente
Auditoría docs/AUDITORIA-FRONTEND-2026-11-07.md:
- La UI tenía más de treinta áreas/features y necesitaba reagrupar arquitectura de información, no eliminar capacidad.
- Se encontraron componentes concentradores muy grandes (Inspector, Timeline, assets, preview, export).
- ColorStudio y ColorPropertiesPanel competían; la fuente de verdad del grade es color-engine/ClipEffects según auditoría.
- Se marcó el riesgo de estado decorativo no persistido en paneles.
- Se detectó dispersión de dialogs y tokens.
- La auditoría corrigió una conclusión inicial errónea sobre CSS muerto: muchas capas tenían uso real. No eliminar imports sólo por grep.
- El diseño debe probarse en 1360×768 y viewport mínimo; conservar laziness y split CSS.

HY4 debe volver a medir todo en el código actual y comparar las capturas guardadas, no ejecutar mecánicamente el prompt histórico.

## 7. Prioridad de faltantes

**P0 — Integridad y capacidad real**
1. Reparar junctions del workspace architecture.
2. Revisar cancelación y worker no ligado a React.
3. Planner textual -> ProductionPlan validado.
4. Quality Gate completo con MP4 real.
5. Estado de rights por asset.

**P1 — Diferencia principal del producto**
6. Integrar proveedor remoto real de imagen y vídeo si cuenta/modelo lo permite.
7. Conectar TTS/STT/music/SFX y vision mediante interfaces comunes.
8. MCP tools autónomas.
9. Recovery/restart de jobs.

**P2 — Experiencia y escala**
10. Frontend unificado, revisión de plan/storyboard, asset provenance y job center.
11. Multi-format/variant orchestration.
12. Motion/character continuity y plantillas creativas reutilizables.
13. Paquete de entrega portable y pruebas de usuario.

## 8. Definition of complete
Una capacidad no es REAL hasta cumplir: implementación completa y conectada; contrato válido; persistencia/no-destructivo cuando corresponde; permisos, cancelación, timeouts y errores; tests unitarios/contract/integration; E2E con artefacto real cuando se trate de media; pruebas en build Windows; documentación/licencias correctas; evidencia reproducible en esta rama.

No sumar capacidades parciales a un “100%” global. Reportar porcentaje por área sólo si hay inventario finito, pesos explicados y denominador fechado.
## 9. Contradicciones históricas que SWE 2 debe reconciliar

Las auditorías no se escribieron todas en la misma fecha ni en el mismo commit. Antes de crear una nueva implementación, verificar el código actual y documentar cuál evidencia prevalece.

| Tema | Auditoría anterior | Evidencia posterior/localizada | Acción obligatoria |
|---|---|---|---|
| Test de proveedor AI | APP-FEATURE-AUDIT-2026-11-03 indicó que faltaba test_provider | CAPABILITY-MATRIX reporta test de conexión OpenAI-compatible y botón | Buscar command + call site + test; no duplicar si ya funciona. |
| Catálogo MCP | APP-FEATURE-AUDIT describió 83 tools enviadas en prompt y posible descarte por 48 KB | CAPABILITY-MATRIX registra ~108 tools, presupuesto 48 KiB y mcp-validation | Medir tamaño actual, tool discovery, selección contextual y fallback; unificar fuente Rust/TS. |
| MCP propio | Auditoría señaló runtime de tool execution en frontend y status UI sin call site | El worktree arquitectura contiene MCP IPC/server reorganizado | Revalidar dónde ejecuta cada tool y mover side effects a application/backend; conservar UI como cliente. |
| Whisper | APP-FEATURE-AUDIT detectó falso positivo de capability por presencia de Python | CAPABILITY-MATRIX posterior describe detección de faster-whisper real | Verificar runtime, modelo, import check, idiomas, UI de descarga/setup y tests. |
| Piper | Documentación histórica puede indicar MIT y uso limitado | El repo OHF-Voice actual declara GPL-3.0; el bundle ya incluye componentes Piper/eSpeak | Auditar el binary/source exacto, fork, notices y licencia del voice/model; no reemplazar legalmente sin revisar. |
| AI Hub / Director | Auditoría dice que ciertas superficies eran deterministas, no LLM | Puede haber cambios posteriores en main | Comprobar llamadas reales, etiquetar cada método según su implementación y evitar promesa “IA” falsa. |
| Google Flow | Integración observada en main | No estaba presente en el worktree architecture en la revisión | Auditar diff y portar selectivamente, con términos/consent y tests; no copiar main entero. |
| Ventana redimensionable | Tauri config de arquitectura reporta resizable=false y 900x580 inicial | No consta corrección actual | SWE 2 modifica config nativa; HY4 valida la geometría instalada. |

No resolver contradicciones editando la auditoría histórica. Crear una nota fechada con branch/HEAD, archivos, pruebas y decisión.

## 10. Criterios de priorización ampliados

P0 incluye cualquier función que:
- pierda/corrompa el proyecto o timeline;
- diga success sin artefacto real;
- genere cargos sin consentimiento;
- permita path escape, shell injection o fuga de secretos;
- impida compilar/instalar o abrir un proyecto;
- dependa de un worker que la UI puede matar sin checkpoint;
- anuncie una capability inexistente.

P1 incluye la promesa de valor de Olyvia:
- brief natural -> plan -> storyboard;
- generar/adquirir recursos y editarlos;
- montaje completo editable;
- voice, music, SFX y captions sincronizados;
- review, render y entrega verificada;
- MCP agent control para las acciones seguras.

P2 incluye paridad avanzada, optimización, extras y mejoras de experiencia que no bloquean esos flujos. Un P2 puede subir a P0 si afecta seguridad, derechos, corrupción o estabilidad.