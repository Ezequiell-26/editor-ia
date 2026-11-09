# 03 — Especificación del backend, motores y capacidades para SWE 2

**Responsable:** SWE 2.  
**Ámbito:** backend Rust/Tauri, casos de uso, proveedores, motores multimedia, jobs, persistencia, MCP, permisos, calidad, pruebas y empaquetado.  
**Fuera de alcance:** rediseñar vistas React, duplicar componentes visuales o sustituir la dirección de HY4.

## 1. Arquitectura objetivo

Mantener un **monolito modular local-first**, con procesos auxiliares donde exista una razón técnica. No convertir cada módulo en un microservicio.

Capas:

1. **Domain:** reglas puras del proyecto, timeline, timecode, escenas, assets, operaciones, estados y quality rules. No importa React, Tauri, FFmpeg CLI ni SDKs de proveedores.
2. **Application:** casos de uso y orquestación. Coordina puertos, validación, transacciones, permisos y eventos.
3. **Ports/contracts:** interfaces para providers, media catalog, asset acquisition, rendering, storage, scheduling, speech, vision, billing/cost estimation y MCP.
4. **Infrastructure/adapters:** FFmpeg, filesystem, keyring, HTTP, provider SDKs, local ASR/TTS/DSP y base local.
5. **Presentation adapters:** comandos Tauri y herramientas MCP finas; validan el request y delegan al mismo caso de uso.
6. **Workers:** render y producción de larga duración con protocolo versionado, checkpoints, cancelación y límites.

Respetar las reglas de dependencia de docs/architecture/DEPENDENCY-RULES.md y la estructura de docs/architecture/TARGET-STRUCTURE.md. No inventar crates o servicios duplicados.

## 2. Fuentes de verdad

- Project document: packages/project-schema es el schema canónico versionado. No crear otro schema paralelo para el estudio.
- Effects: packages/effect-kit es el catálogo/motor canónico.
- Timeline: reutilizar comandos tipados existentes (split, trim, move, ripple, keyframes, markers, etc.).
- Provider configuration: reutilizar el store/keyring y contratos ya existentes.
- Production plan: usar ProductionPlanSchema y su mirror Rust; completar migraciones/versionado si hacen falta.
- Job state: un registro persistente del backend; no usar React state como verdad de ejecución.
- Cost estimation: adapter por proveedor y modelo, con fecha de tarifa y estimación explícita.
- Rights metadata: por asset y por fuente concreta, no por proveedor global.

Si se detectan dos modelos para el mismo concepto, elegir uno y crear una migración compatible; no mantener bifurcación silenciosa.

## 3. Dominios funcionales

### 3.1 Project and media
- Abrir, crear, guardar, recuperar, versionar, importar y exportar proyectos.
- Ingesta segura, probing y hash.
- Assets locales, proxies, thumbnails, waveforms, metadata y referencias.
- Detección de missing media; relink asistido, sin sobreescribir originales.
- Manifest de source files y generated files.
- Asset identity estable, provenance y rights record.

### 3.2 Timeline/editing
- Aplicar operaciones a una única fuente canónica de proyecto.
- Comandos atómicos con revision expected y resultado.
- Undo/redo, undo group para operaciones IA, snapshot/checkpoint.
- Validación de frame/timebase, overlap, track constraints y source in/out.
- Preview y export deben interpretar el mismo estado lógico.
- EDL/OTIO/FCPXML sirven para intercambio, no reemplazan el proyecto nativo.

### 3.3 Media analysis
- Probe técnico.
- Scene/shot detection, keyframes thumbnails, silence, voice activity, transcript, speaker diarization, face/subject detection si hay modelo disponible.
- Cache por asset hash, modelo y versión; reanalizar sólo cuando cambie input o parameters.
- No ejecutar modelos locales grandes por defecto.
- El resultado debe contener confidence, time ranges, model/provider ID y limitaciones.

### 3.4 Creative planner / intent
- Entrada en lenguaje natural + project snapshot + user preferences + capability registry.
- Analizar intent, tipo de producción, audiencia, tono, duración, formato, contenido permitido, presupuesto y assets existentes.
- Hacer preguntas únicamente cuando falte información que pueda cambiar materialmente el resultado.
- Producir plan estructurado validado por schema, no párrafos que luego se interpreten libremente.
- Incluir escena, objetivo narrativo, voice segment, assets requeridos, prompt por asset, duración, composición, transición, audio, captions, source/provenance expectations y acceptance criteria.
- Mantener modelo determinista: el LLM propone; domain valida; user autoriza; application ejecuta.
- Permitir regenerar una escena sin rehacer todas las escenas; preservar IDs y decisiones aprobadas.
- Conservar un resumen de decisiones y cambios, no chain-of-thought.

### 3.5 Provider layer
- Interfaz común de chat/tool-calling, image generation/edit, video generation/edit, TTS, STT, music, SFX, vision, translation y embeddings.
- Capacidades explícitas por combinación proveedor/modelo: input modes, output modes, reference assets, async job, max duration, resolution, aspect ratio, seed, voice support, editing support, pricing unit, regions y rate limit.
- No asumir que un proveedor que tiene API de texto también admite generación de vídeo.
- Adaptadores aislados; normalizar errores, retries, status y cost.
- BYOK (Bring Your Own Key) por defecto; claves en el keyring del SO.
- Catálogo dinámico, no lista hardcodeada de modelos que caducan.

### 3.6 Asset acquisition
- Conectores por fuente con licencia, permiso, attribution, limits, download policy y API terms.
- Resolver recursos por rol narrativo: establishing shot, B-roll, background, music bed, SFX, image ref, character ref.
- Preferir archivos propios y fuentes con rights verificados.
- No utilizar una página web de consumo como API no autorizada ni eludir bloqueos.
- Registrar source URL, asset page, creator, license name/URL/version, retrieval date, checksum, terms snapshot if possible, required credit and restrictions.
- Cuando la licencia no sea clara, marcar needs_review y no usar automáticamente en commercial mode.

### 3.7 Audio
- Pipeline de voice, TTS, transcription, diarization, isolation, denoise, EQ, compressor, limiter, mixing, ducking, loudness.
- Audio clock manda sobre el playback clock.
- Conservar sample rate/channel layout y evitar resample innecesario.
- Target loudness por preset, configurable; el informe muestra LUFS-I, loudness range y true peak.
- Fade/crossfade y ducking se guardan en proyecto.
- Clonar voz sólo con consentimiento verificable y política específica.

### 3.8 Motion and graphics
- Keyframe operations, transform, easing, compositing, masks, text layers, Lottie, particles, stickman/rig and graphics templates.
- La animación debe ser editable mediante timeline/parameters.
- Motion Canvas puede ser una opción de generación vectorial aislada si se confirma runtime/licencia; no sustituir el editor.
- No integrar Remotion en el core sin aceptar su licencia comercial y condiciones.

### 3.9 Render/encode
- FFmpeg/FFprobe existentes permanecen motor inicial de export.
- Generar command plan sólo desde parámetros tipados/allowlist, no desde texto del LLM.
- Configurar paths allowlisted, timeout, process-tree cancellation, output caps, temp folders aislados y red desactivada salvo permiso explícito.
- Preview renders, proxies y final output usan perfiles diferentes.
- Render job escribe a archivo temporal, ffprobe valida, hash y rename atómico.
- Fallos conservan logs saneados y artefactos temporales diagnósticos dentro de política de limpieza.

### 3.10 Review and delivery
- Validar proyecto antes de exportar.
- Comprobar duración, resoluciones, fps, pixel format, color metadata, streams, frame count, timestamps, audio loudness/true peak, subtitles, file size, decode pass, black/freeze frames y missing media.
- Quality report debe separar hard errors y warnings.
- Entrega con video + project + captions + source manifest + rights report + verification report.
- Entregar sólo cuando todos los hard gates pasen; warnings se muestran y pueden requerir aprobación.

## 4. Casos de uso obligatorios

API application debería exponer funciones reutilizables:
- create_project_from_brief
- analyze_project_media
- create_production_plan
- validate_production_plan
- estimate_production_cost
- acquire_plan_resources
- generate_asset
- assemble_plan_into_project
- apply_project_operations
- render_project
- verify_render
- repair_quality_issue (bounded)
- package_delivery
- get_run_status / list_runs / cancel_run / resume_run
- inspect_provider_capabilities / test_provider
- search_media_catalog / inspect_asset_rights
- review_project_quality

Los nombres exactos se adaptan a contratos del repo; no duplicar funciones sólo para este documento.

## 5. Persistencia y recuperación

- Project file versionado es fuente de verdad del montaje.
- SQLite o storage local ya existente se utiliza para jobs, índices, metadata y settings no secretos, si coincide con arquitectura actual.
- Claves API en Windows Credential Manager o keyring seguro existente.
- Job record contiene id, schemaVersion, projectId, state, currentStage, stageAttempts, progress, cost estimate/actual, checkpoints, timestamps, cancellation, errors, warnings, artifact refs y provider refs.
- Cada etapa escribe checkpoint atómico y puede ser reanudada.
- Jobs idempotentes: retries no duplican clips, assets ni cargos cuando el provider ofrece idempotency keys.
- Cancelación propagada por token/child process y persistida.
- Restart recovery al iniciar app: descubrir jobs incompletos, reconciliar estado y pedir acción si el backend no puede reanudar con seguridad.
- Persistencia de jobs no significa background después del cierre: debe existir worker que sobreviva al cierre y política explícita de instalación/servicio para afirmarlo.

## 6. Background worker

Desacoplar ejecución de la ventana React. En primera fase, un worker de proceso hijo administrado por Rust puede continuar aunque se oculte/minimice la ventana. En caso de cierre normal de app, detener de forma limpia o delegar explícitamente al servicio instalado. Para ejecutar después de salir del proceso padre se necesita Windows service/task/scheduler o proceso residente debidamente instalado y documentado.

El worker:
- recibe jobs tipados por protocolo local autenticado;
- mantiene estado persistente;
- emite eventos y snapshots para reconnect;
- aplica concurrency limit y back-pressure;
- conserva checkpoint tras crash;
- ejecuta cancellation real;
- no hereda permisos amplios sin necesidad.

## 7. Interacción con Tauri e IPC

- Commands delgados: parse, validate, authorize, call application, map typed error.
- Request/response con schemas JSON versionados.
- Comandos para jobs largos retornan jobId; progreso por event stream/poll del backend.
- Validar tamaño de argumentos, paths, project IDs, origin y permisos en Rust aunque UI ya los valide.
- Tauri capabilities con scope mínimo por window/webview.
- No permitir que frontend llame a procesos o filesystem amplio salvo que el permiso sea necesario.
- Mantener compatibilidad con IPC antiguo durante migración; agregar tests de registro y contrato.
- No duplicar Tauri command + lógica MCP: ambos pasan por el mismo application service.

## 8. Pruebas de backend

- Unit tests puros de domain y schema.
- Contract tests para cada adapter/provider.
- Integration tests con temp dirs y fake servers; fakes sólo para test.
- Live tests opt-in por flags, coste y credenciales explicitadas.
- E2E completo: brief -> plan -> resources -> project/timeline -> render -> ffprobe -> delivery.
- E2E multimodal con providers reales cuando haya cuota y consentimiento.
- Crash/restart recovery, cancel mid-stage, timeout, retry, duplicate request, corrupt asset, missing file, invalid rights, zero disk, provider 429/5xx, partial output.
- Security tests de path traversal, zip slip, SSRF, shell injection, symlink escape, oversized files, prompt injection en metadata y log redaction.
- Verificar render visual y audio con fixtures de referencia, no sólo que el archivo exista.

## 9. Entregables de SWE 2

1. Corregir primero el aislamiento entre worktrees y TypeScript junctions.
2. Un inventario real de current state y capability gaps.
3. Contratos de studio/production provider, jobs y MCP.
4. Planner de intención validado.
5. Conectores de generación/adquisición multimodal.
6. Worker durable, restart recovery y cancelación.
7. Quality Gate y repair loop limitado.
8. Tools MCP semánticas y permisos.
9. Suite de integración y E2E.
10. Documentación de providers, licencias, operación, fallos y límites.
## 11. Desktop window lifecycle, configuración y release

La configuración Tauri inspeccionada declara la ventana main de 900x580, minWidth 760/minHeight 500, resizable=false y maximizable=false. SWE 2 debe:
- habilitar redimensionamiento y maximización cuando corresponda;
- establecer tamaño inicial y límites compatibles con el workspace profesional y la resolución objetivo 1360x768;
- persistir tamaño/posición/estado de ventana y paneles de forma segura;
- probar main/splash lifecycle, restauración y multi-instance behavior;
- mantener Tauri capabilities y permisos mínimos al agregar ventanas/paneles.
El resize nativo no es una decisión de CSS; coordinar con HY4 y probar en NSIS instalado.
## 12. Runtime de IA, tools y contexto

- El contrato de Provider debe distinguir chat streaming, structured output/schema, native function/tool calling, multimodal input y background execution. Cada modalidad tiene capability y error mapping propio.
- Preferir native function calling/structured output cuando el modelo lo admita. No serializar indiscriminadamente el catálogo completo de herramientas dentro del prompt como única vía de uso.
- Registrar una fuente canónica para las definiciones MCP/tools: names, descriptions, JSON schemas, annotations, permissions, risk and output schema. Generar o derivar TypeScript/Rust manifests desde el mismo contrato o validar equivalencia automáticamente.
- Descubrir herramientas por contexto: project/media/timeline/render/studio/provider. Dar al modelo sólo tools necesarias para la tarea y mantener una tool discovery/search cuando el inventario sea grande.
- Si el proveedor no soporta function calling, usar un protocolo JSON acotado y validado con parser estricto; rechazar salida parcial/inválida, no ejecutar texto libre.
- Manejar context budget: truncar por prioridad con un aviso interno, nunca descartar el catálogo silenciosamente. Conservar tool descriptions/input schemas esenciales.
- Streaming debe ser cancelable; usar timeouts configurables por proveedor/modelo y no un timeout único rígido para todos.
- Separar conversation memory, project context, run state y durable user settings. No confundir historial del chat con fuente de verdad del proyecto.
- Registrar un action summary con proposed operation, affected IDs, approval state, executed operations y outcome. No mostrar chain-of-thought.
- Para cada tool call: validate schema -> resolve project scope -> authorize -> estimate cost/side effects -> obtain approval -> execute -> verify postcondition -> audit event.
- La ejecución MCP no debe depender de un React component montado ni ejecutar side effects de proyecto directamente desde un tool catalog del frontend; la UI representa resultados y llama al application/backend service.