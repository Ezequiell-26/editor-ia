---
date: 2026-11-13
status: target-architecture
authority: product-and-system-architecture
owner: product-owner
---

# Olyvia — Arquitectura maestra de producto y sistema

> Documento rector que conecta la visión de producto con la arquitectura de software. Describe el destino deseado, no certifica que cada capacidad ya esté implementada. El estado real siempre se verifica contra el código, las pruebas y la matriz de aceptación.

## 0. Propósito y autoridad

Olyvia será un estudio audiovisual de escritorio, local-first y asistido por IA, capaz de crear vídeos desde una idea y de editar material existente con herramientas de nivel profesional. La experiencia debe permitir que una persona pase de la idea al vídeo terminado sin abandonar el mismo entorno de edición.

Este documento define cómo se relacionan el producto, la interfaz, el modelo de proyecto, los motores multimedia, los agentes, los proveedores, los procesos en segundo plano, la seguridad y la entrega.

### Jerarquía documental

1. Este documento: mapa maestro y reglas transversales de arquitectura.
2. `docs/decisions/2026-11-13-permanent-editor-surface.md`: decisión obligatoria y detallada del editor permanente.
3. Los documentos especializados de `docs/olyvia-blueprint/`: especificaciones completas por dominio.
4. `docs/architecture/`: estructura de código, límites de dependencias, ADRs y migraciones.
5. `docs/olyvia-blueprint/16_FEATURE_ACCEPTANCE_MATRIX.md`: aceptación funcional verificable.
6. Código, pruebas y evidencia del HEAD actual: determinan qué está realmente construido.

Si hay contradicción, una especificación histórica no puede anular una decisión explícita más reciente del usuario. No se reescriben auditorías pasadas: se añade evidencia actual fechada.

### Estado de implementación

- **Objetivo:** arquitectura descrita en este documento.
- **Implementación:** no se presume por estar especificada.
- **Fase autorizada actual:** terminar el frontend y cerrar su diseño.
- **Fase no autorizada todavía:** refactor funcional global para unificar herramientas. Comenzará sólo cuando el usuario declare aprobado el frontend.

## 1. Visión del producto

### 1.1 Qué debe ser Olyvia

Una aplicación de escritorio profesional para:
- Crear vídeos completos desde instrucciones, guiones, imágenes, clips, audios o referencias.
- Editar proyectos existentes con precisión manual y asistencia de IA.
- Producir contenido educativo, narrativo, social, comercial, documental, animado, memes y motion graphics.
- Combinar edición tradicional, generación multimodal, automatización y revisión humana.
- Exportar archivos audiovisuales y proyectos editables verificables.

Olyvia no será un chat con botones de FFmpeg, ni un conjunto de miniaplicaciones independientes, ni una colección de editores diferentes. La IA coordina capacidades reales; el proyecto y el motor de edición siguen siendo la fuente de verdad.

### 1.2 Principios de producto

1. Un proyecto canónico, una timeline canónica y un único entorno de edición.
2. El usuario conserva el control y puede inspeccionar, aceptar, rechazar o deshacer cambios.
3. Las operaciones de IA son estructuradas, trazables y reversibles cuando técnicamente sea posible.
4. La app funciona local-first; servicios remotos se usan sólo con consentimiento y configuración.
5. No se requiere un modelo local enorme para generar vídeo o imágenes: se usan proveedores remotos configurables cuando corresponda y motores locales deterministas para edición/procesamiento.
6. No se anuncian capacidades que no estén conectadas a un motor/proveedor real.
7. Se priorizan estabilidad, calidad, rendimiento y compatibilidad sobre cantidad de botones.
8. Las capacidades se integran progresivamente; no se eliminan porque su integración visual sea difícil.

### 1.3 Usuarios y niveles de control

- **Creador principiante:** describe lo que quiere y recibe un plan comprensible con preview y aprobaciones.
- **Creador frecuente:** reutiliza proyectos, presets, plantillas y variantes.
- **Editor profesional:** controla montaje, color, audio, motion, máscaras, tracking y export.
- **Profesional asistido por IA:** delega tareas delimitadas, inspecciona los cambios y mantiene control sobre el proyecto.

No son aplicaciones ni documentos de proyecto separados. Son niveles de asistencia sobre el mismo proyecto y editor.

## 2. Regla central: un solo editor permanente

### 2.1 Invariante de interfaz

El editor principal es el shell permanente de la aplicación una vez iniciada la sesión de trabajo. Activar una herramienta, una capacidad IA o una función de producción no debe navegar a otra pantalla ni reemplazar el editor.

Deben permanecer disponibles:
- Monitor/preview del proyecto.
- Timeline y pistas.
- Proyecto y secuencia activos.
- Contexto de selección y playhead.
- Estado de guardado, historial y tareas activas.
- Acceso al asistente y a la biblioteca de recursos.

La geometría y distribución visual definitiva son responsabilidad de la fase actual de frontend. La arquitectura no impone un rediseño visual ni autoriza crear paneles alternativos que cambien el layout aprobado.

### 2.2 Cómo se presentan las herramientas

Las herramientas se activan mediante acciones contextualizadas dentro del editor. Sus controles se muestran en las zonas que el diseño final establezca: biblioteca, toolbar, inspector, panel contextual o controles sobre el monitor.

El área de controles puede cambiar de contenido, pero no debe desmontar ni reemplazar el shell del editor, el preview o la timeline. Las operaciones frecuentes no deben depender de ventanas separadas. Un diálogo puntual sólo es admisible si conserva el contexto y no se convierte en otro workspace.

### 2.3 Ejemplo transversal

Tracking, máscara, dibujo, subtítulos, color, efectos, transiciones, audio, voz, generación de imágenes/vídeo, descarga, compresión, motion, multicámara y export deben seguir el mismo patrón:

1. Invocar la herramienta desde el editor.
2. Leer el proyecto, selección, clip y timecode actuales.
3. Mostrar controles en el espacio contextual previsto.
4. Previsualizar el resultado en el monitor del mismo editor.
5. Aplicar una operación tipada al proyecto actual.
6. Reflejar el resultado en preview/timeline.
7. Registrar el cambio en historial y permitir undo/redo según el tipo de operación.
8. Continuar editando sin abandonar el entorno.

Las funciones globales como ajustes, proveedores, MCP, licencias y preferencias se abren como superficies contextuales del mismo shell, no como otro editor ni como una aplicación separada.

### 2.4 Prohibiciones arquitectónicas

- No crear un editor independiente para cada herramienta.
- No duplicar preview, timeline, proyecto o selección.
- No navegar a un workspace alternativo para completar una operación de edición.
- No mantener una segunda copia mutable del proyecto dentro de una herramienta.
- No ocultar el preview o la timeline como requisito para usar una función.
- No reemplazar motores existentes por mocks para aparentar integración.
- No iniciar la unificación masiva antes de aprobar el frontend.

## 3. Modelo mental de la aplicación

Olyvia se organiza alrededor de un único proyecto audiovisual. El usuario trabaja en el mismo editor y cambia el contexto de la tarea, no de aplicación.

### 3.1 Capas de experiencia

- **Shell permanente:** ventana, barra superior, navegación contextual, estado global y composición del editor.
- **Editor central:** monitor, timeline, selección, herramientas, inspector y biblioteca.
- **Asistente IA contextual:** entiende el proyecto, selección, timecode, medios y objetivo actual.
- **Capacidades de producción:** brief, guion, storyboard, investigación, generación, adquisición y planificación, representadas como recursos/operaciones del proyecto.
- **Sistema de trabajos:** render, generación remota, análisis, descargas y conversiones que pueden continuar mientras el usuario sigue editando.
- **Entrega:** exportaciones, variantes, proyecto portable, manifiesto y reporte de calidad.

### 3.2 Navegación vs. activación de herramientas

La navegación de alto nivel no debe convertirse en un mecanismo para abandonar el editor cada vez que se pulsa una herramienta. Las acciones de producto se resuelven como:
- Activar una herramienta contextual.
- Seleccionar un recurso o categoría en la biblioteca.
- Abrir un inspector o configuración contextual.
- Iniciar un job persistente.
- Mostrar un resultado como asset, clip, capa, pista o panel de estado del proyecto.

La decisión de qué controles se muestran y dónde corresponde al diseño final del frontend. Los identificadores de herramientas y operaciones deben ser estables e independientes de la presentación.

## 4. Arquitectura lógica de alto nivel

### 4.1 Stack y estilo arquitectónico

- Aplicación de escritorio: Tauri 2.
- Frontend: React, TypeScript y Vite.
- Backend nativo: Rust.
- Procesamiento audiovisual: FFmpeg/FFprobe y motores especializados.
- Contratos compartidos: `project-schema`, `effect-kit` y contratos tipados adicionales sólo cuando exista más de un consumidor real.
- Proveedores IA: adaptadores locales/remotos con descubrimiento de capacidades, límites, costos y permisos.
- Integraciones: MCP, plugins y conectores explícitos.

**Estilo:** monolito modular local-first con arquitectura por dominios, puertos y adaptadores. Los workers/procesos auxiliares se separan sólo cuando hay una razón concreta de aislamiento, ciclo de vida, consumo de recursos o estabilidad. No convertir cada módulo en microservicio ni cada carpeta en un crate.

### 4.2 Diagrama conceptual

```text
USUARIO
  |
  v
OLYVIA DESKTOP — SHELL PERMANENTE
  |-- Monitor / Preview
  |-- Timeline multipista
  |-- Biblioteca / Tool Shelf
  |-- Inspector contextual
  |-- Asistente IA contextual
  |-- Estado de jobs / export / historial
  |
  v
FRONTEND APPLICATION SERVICES
  |-- Project & Timeline API
  |-- Tool Activation / Capability Registry
  |-- Editing Operations API
  |-- Preview API
  |-- AI Assistant / Plan Review API
  |-- Jobs / Progress / Approval API
  |
  v
TAURI IPC + EVENT CONTRACTS
  |
  v
RUST APPLICATION LAYER
  |-- Projects & Media
  |-- Timeline & Editing
  |-- Effects / Color / Motion / Subtitles
  |-- Audio / Recording
  |-- AI Planning / Production
  |-- Render / Export / Quality
  |-- Integrations / MCP / Downloads
  |-- Jobs / Recovery / Audit
  |
  v
DOMAIN + PORTS
  |
  +--> INFRASTRUCTURE ADAPTERS
        |-- FFmpeg / FFprobe
        |-- Filesystem / Project storage
        |-- Render and analysis workers
        |-- AI providers / Model APIs
        |-- Browser / Acquisition adapters
        |-- MCP clients and server
        |-- OS / GPU / Hardware encoders
  |
  v
PROJECT DATA + ASSETS + JOB STORE + OUTPUTS
```

Este diagrama representa límites lógicos, no exige que cada caja sea un proceso independiente.

## 5. Arquitectura del frontend

### 5.1 Shell y composición

El frontend debe tener una composición raíz estable que mantenga montados el editor, monitor y timeline. La selección de herramienta cambia el contexto activo y los controles contextuales, no la raíz de navegación ni la instancia del editor.

Responsabilidades:
- **App / composition root:** bootstrap, sesión, dependencias y shell permanente.
- **Editor shell:** distribución visual aprobada y persistencia de paneles.
- **Tool registry:** catálogo de herramientas con IDs estables, categoría, capacidades, requisitos, acciones y componente contextual.
- **Tool activation controller:** activa/desactiva herramienta, mantiene contexto y evita rutas disruptivas.
- **Project session:** proyecto actual, secuencia, selección, playhead y dirty state.
- **Feature UI:** componentes especializados de cada dominio.
- **Application services:** operaciones y contratos consumidos por features.
- **Platform adapters:** Tauri invoke/events, filesystem y APIs de sistema.
- **State:** estado compartido y segmentado por dominio; no sustituye el modelo persistido.

### 5.2 Registro de herramientas

Cada herramienta debe declararse mediante un descriptor estable. Campos conceptuales:
- `toolId`: identificador global inmutable.
- `domain`: edición, media, audio, color, motion, IA, export, integración, etc.
- `activationMode`: contextual, overlay, monitor-interaction o background-job.
- `requiredSelection`: proyecto, secuencia, clip, asset, rango o ninguno.
- `capabilitiesRequired`: motores/proveedores requeridos.
- `permissionScopes`: lectura, edición, descarga, red, render, publicación, etc.
- `controlSurface`: slot del diseño donde se presenta.
- `previewBehavior`: overlay, frame preview, audio audition, render proxy o no aplica.
- `operationIds`: operaciones tipadas que puede solicitar.
- `availabilityState`: disponible, parcial, bloqueada, sin proveedor o experimental.

El registro no debe guardar otra implementación del proyecto ni definir una segunda navegación. Los IDs no cambian cuando se reorganiza visualmente la biblioteca.

### 5.3 Estado frontend: separar sesión de documento

- **Project document:** datos persistentes del proyecto y timeline.
- **Editor session:** selección, playhead, zoom, panel activo, herramienta activa, modo de interacción y estado de preview.
- **Jobs state:** jobs persistentes del backend y sus actualizaciones.
- **UI preferences:** tamaño de paneles, layout, tema y shortcuts.
- **Assistant context:** referencias al proyecto/selección/timecode, no copia completa mutable del documento.

El estado de sesión puede cambiar al usar herramientas; el documento sólo cambia al aplicar operaciones de proyecto validadas.

### 5.4 Reglas de UI

- Una acción de herramienta no debe cambiar el editor activo.
- Los paneles contextuales no deben provocar desmontaje del monitor o timeline.
- La interacción directa sobre preview (máscara, tracking, crop, puntos, dibujo) debe usar overlays interactivos con coordenadas transformadas al espacio del vídeo.
- Los controles deben reflejar el estado real del motor; no permitir valores imposibles.
- Estados loading, unavailable, permission denied, offline, failed y success deben ser explícitos.
- Los errores no deben resetear selección, playhead ni contexto.
- El diseño debe validarse en 1280×720, 1360×768 y resoluciones mayores.
- Mantener lazy loading de módulos pesados sin desmontar los componentes persistentes.

## 6. Modelo de proyecto y datos canónicos

### 6.1 Fuente única de verdad

El proyecto persistido validado por `project-schema` es la fuente canónica para secuencias, pistas, clips, assets, efectos, keyframes, captions, composiciones, metadata y referencias de recursos.

No crear:
- Un proyecto paralelo por herramienta.
- Una timeline alternativa por generador.
- Un segundo catálogo de efectos que contradiga `effect-kit`.
- Copias divergentes de assets o paths sin registro.
- Estados de edición ocultos dentro de componentes que no se puedan guardar/recuperar.

### 6.2 Entidades conceptuales

- **Project:** identidad, versión de schema, settings, secuencias, assets y metadatos.
- **Sequence:** resolución, FPS/timebase, duración, tracks y configuración de color/audio.
- **Track:** tipo, orden, visibilidad, mute/solo/lock y contenido.
- **Clip:** source asset, in/out, timeline position, transforms, effects, keyframes y relaciones.
- **Asset:** ID, ruta/URI, hash, probe metadata, thumbnail/proxy, procedencia y derechos.
- **Effect/Transition:** ID, parámetros tipados, versión y compatibilidad del renderer.
- **Caption/Title/Graphic:** contenido, estilo, timing, idioma y capas.
- **Composition:** estructura reusable o anidada cuando el schema la soporte.
- **Operation record:** comando aplicado, actor, parámetros saneados, targets y undo metadata.
- **Production plan:** brief, escenas, dependencias, recursos y aprobaciones asociadas al proyecto.
- **Delivery manifest:** outputs, perfiles, hashes, licencias y resultado de validación.

### 6.3 Tiempo y precisión

- El tiempo de timeline se representa con una base entera y una política explícita de timebase/FPS; evitar acumulación de errores por floats.
- Las conversiones de frames, segundos, audio samples y timecode deben centralizarse.
- Soportar FPS fraccionales y drop-frame cuando el formato lo requiera.
- Cada clip conserva source in/out y timeline range inequívocos.
- Preview, playback, audio y render comparten las mismas reglas temporales.

### 6.4 Assets y almacenamiento

- Importar no debe modificar el archivo original por defecto.
- Crear IDs y hashes; detectar duplicados sin borrar automáticamente.
- Mantener originales, proxies, thumbnails, waveforms, previews y derivados separados.
- Preferir rutas relativas/portables dentro del bundle cuando sea viable.
- Relink de medios faltantes con confirmación y validación de hash/metadata.
- Guardar procedencia, licencias, proveedor, modelo y costo cuando corresponda.
- Las rutas externas deben validarse y no convertirse en permisos implícitos de filesystem.

## 7. Contrato de herramientas y operaciones

### 7.1 Herramienta no equivale a ruta

La activación de una herramienta es una transición de estado del editor, no una navegación a otra vista. Una herramienta puede:
- Leer contexto.
- Mostrar controles.
- Solicitar análisis.
- Crear una preview temporal.
- Proponer cambios.
- Aplicar una operación tipada.
- Lanzar un job persistente.

### 7.2 Pipeline de edición

Toda modificación debe seguir este flujo lógico:

1. **Intent:** identificar la acción solicitada por usuario o agente.
2. **Resolve context:** resolver projectId, sequenceId, selection, clipId y time range.
3. **Capability check:** comprobar motor, versión, proveedor y formatos.
4. **Permission check:** comprobar scopes y consentimiento.
5. **Validate:** validar parámetros, límites, recursos y compatibilidad.
6. **Preview/plan:** producir una vista previa o diff cuando sea posible.
7. **Approval:** solicitar confirmación para operaciones costosas, externas o destructivas.
8. **Execute:** aplicar operación o crear job.
9. **Commit:** persistir cambios con transacción/checkpoint.
10. **History:** registrar actor, operationId, targets y undo strategy.
11. **Notify:** actualizar preview/timeline y emitir eventos tipados.

Si falla antes del commit, el proyecto no debe quedar parcialmente mutado. Si una operación externa no es reversible, se registra como tal y se ofrece compensación cuando exista.

### 7.3 Operaciones tipadas

Ejemplos conceptuales: `project.asset.import`, `timeline.clip.split`, `timeline.clip.trim`, `timeline.effect.add`, `timeline.mask.update`, `timeline.tracking.apply`, `timeline.caption.create`, `audio.denoise.run`, `production.plan.create`, `production.scene.generate`, `render.export.start`.

Los nombres definitivos deben alinearse con contratos y comandos existentes; no introducir un segundo catálogo incompatible. Cada operación define schema/version, permisos, idempotency, efectos laterales, undo policy, timeout y errores tipados.

### 7.4 Preview y renderer

- Preview y export deben consumir una semántica común de timeline, transforms, efectos, máscaras y color.
- Si el preview usa proxy/approximation, la UI lo indica y conserva parámetros idénticos.
- Los overlays de selección no deben alterar el render final.
- Los cambios de parámetros se pueden previsualizar sin escribir cada movimiento del slider en el documento persistido.
- Al confirmar, se aplica una transacción al proyecto.
- Golden tests y comparaciones de frames verifican paridad entre preview y export dentro de tolerancias declaradas.

## 8. Arquitectura del backend Rust

### 8.1 Capas

- **commands:** adaptadores IPC Tauri; deserializan DTO, validan entrada y llaman casos de uso.
- **domain:** reglas puras e invariantes del proyecto, timeline, medios, render, audio, efectos y jobs.
- **application:** casos de uso y orquestación; no conoce React ni detalles de FFmpeg CLI.
- **ports:** interfaces requeridas por aplicación/dominio.
- **infrastructure:** FFmpeg, filesystem, procesos, providers, credenciales, browser, MCP y bases de datos.
- **runtime:** jobs, colas, progreso, cancelación, eventos y recuperación.
- **composition root:** registra dependencias, comandos, plugins y estado compartido.

### 8.2 Dominios funcionales

1. Projects & schema: crear, abrir, guardar, versionar, migrar, backup y recovery.
2. Media: import, probe, metadata, thumbnails, proxies, waveform, relink y asset rights.
3. Timeline: tracks, clips, edit operations, selection targets y timebase.
4. Preview: frame requests, cache, proxy selection, overlays y playback.
5. Effects & color: catálogo, parámetros, stacks, LUTs, masks, scopes y render graph.
6. Motion & compositing: keyframes, transforms, titles, shapes, tracking y composiciones.
7. Audio: mixer, filters, recording, transcription, voice, music, SFX y loudness.
8. Subtitles: ASR, alignment, editing, translation, styling y export.
9. AI planning: intent, brief, script, storyboard, scene plans y validation.
10. Production: scheduler, checkpoints, approvals, runs, retry, cancel y resume.
11. Render & delivery: profiles, queue, FFmpeg execution, quality gate, manifests y packaging.
12. Integrations: provider adapters, browser, download sources, MCP, plugins y connectors.
13. System: settings, keyring, telemetry opt-in, diagnostics, update y hardware capabilities.

### 8.3 Límites de proceso

El frontend no ejecuta FFmpeg ni gestiona directamente procesos críticos. Rust/worker administra procesos, límites, cancelación, timeouts y logs. Un componente React desmontado no debe cancelar una tarea durable. Los procesos auxiliares sólo se extraen cuando el aislamiento o ciclo de vida lo justifique y el contrato esté probado.

### 8.4 Compatibilidad

Mantener fachadas e IPC existentes durante migraciones. No cambiar a la vez el nombre de un comando, su payload, el frontend consumidor y el schema persistido sin una migración versionada y tests de compatibilidad.

## 9. IA y dirección automática

### 9.1 Rol de la IA

La IA actúa como director, asistente y operador de herramientas. No es una fuente paralela de verdad ni ejecuta código arbitrario. Lee el contexto permitido del proyecto, propone un plan y solicita operaciones de dominio tipadas.

Puede:
- Interpretar lenguaje natural y objetivos audiovisuales.
- Analizar medios y producir metadatos temporales.
- Crear guiones, escenas, storyboards, prompts y planes.
- Recomendar cortes, ritmo, encuadres, subtítulos, efectos y audio.
- Generar o adquirir recursos mediante proveedores autorizados.
- Proponer y aplicar lotes de edición sobre el proyecto.
- Revisar calidad, explicar cambios y preparar entregables.

### 9.2 Ciclo del agente

`Observe → Understand → Plan → Validate → Preview → Approve → Execute → Verify → Report`

1. Observe: obtiene sólo datos autorizados del proyecto/selección.
2. Understand: identifica intención, restricciones, idioma y formato.
3. Plan: produce operaciones tipadas y dependencias.
4. Validate: verifica schemas, capabilities, permisos, costos y recursos.
5. Preview: presenta diff, storyboard, sample o cambios propuestos.
6. Approve: solicita confirmación en los puntos definidos por policy.
7. Execute: envía operaciones al backend/job manager.
8. Verify: comprueba archivos y estado real, no sólo respuestas del modelo.
9. Report: resume cambios, errores, costos, artefactos y acciones reversibles.

### 9.3 Aprendizaje operativo sin entrenar el modelo

Olyvia puede almacenar conocimiento de producto y proyecto: mapping de herramientas, parámetros, ejemplos aprobados, presets, preferencias, límites de motores, plantillas y resultados verificados. Esto enseña a la aplicación cómo invocar correctamente sus herramientas; no implica entrenar automáticamente el modelo ni modificar pesos.

El catálogo de operaciones y los contratos son la autoridad. La IA consulta descripciones y schemas versionados. Las preferencias del usuario no deben convertirse en permisos nuevos.

### 9.4 Autonomía y control

- Nivel asistido: sugerir y esperar confirmación.
- Nivel por etapas: ejecutar acciones aprobadas y detenerse en checkpoints.
- Nivel delegado: ejecutar un plan delimitado dentro de presupuesto, permisos y límites configurados.
- Ningún nivel concede shell libre, filesystem irrestricto, publicación automática o gasto ilimitado.
- El usuario puede pausar/cancelar, inspeccionar operaciones y volver a un checkpoint.

## 10. Producción, generación y proveedores

### 10.1 Pipeline de creación

`Brief → Intent → Script → Storyboard → Asset Plan → Acquire/Generate → Assemble → Review → Export → Verify → Deliver`

Cada etapa produce entidades versionadas vinculadas al mismo proyecto. Una escena puede regenerarse sin modificar escenas aprobadas no relacionadas. La generación crea assets; la composición crea clips y capas editables en la timeline.

### 10.2 Proveedores

Los proveedores de texto, visión, imagen, vídeo, TTS, STT, música y SFX se implementan como adaptadores. Cada adaptador declara:
- Capacidades y modalidades reales.
- Modelos/versiones y formatos soportados.
- Región, límites, cuotas y disponibilidad.
- Costos conocidos o indicación explícita de costo desconocido.
- Requisitos de credencial y scopes.
- Política de retención/uso de datos conocida.
- Timeouts, retry policy y cancelación.
- Licencia/condiciones de uso relevantes.

No asumir que un modelo de texto genera vídeo, ni que un proveedor puede editar un clip existente. No cambiar de proveedor, modelo, calidad o costo silenciosamente. El fallback debe respetar consentimiento y política.

### 10.3 Uso local y remoto

- Edición, timeline, composición y procesamiento determinista se realizan localmente cuando el motor está disponible.
- Generación avanzada puede delegarse a APIs remotas configuradas por el usuario.
- No exigir una GPU dedicada ni descargar modelos enormes para que el editor base funcione.
- Los modelos locales opcionales deben mostrar tamaño, RAM/VRAM, licencia, hash y uso de disco.
- Antes de enviar archivos a servicios externos, mostrar destino, finalidad y permiso aplicable.

## 11. Sistema de jobs y operación en segundo plano

### 11.1 Jobs persistentes

Render, generación remota, transcripción, análisis, descargas, conversión y producción se ejecutan como jobs administrados por backend/runtime, no por el ciclo de vida de React.

Estados mínimos: queued, validating, awaiting_approval, running, paused, cancelling, cancelled, failed, completed, interrupted, recovery_required.

Cada job debe guardar:
- jobId y idempotencyKey.
- projectId y entidad objetivo.
- operación/schema version.
- proveedor/motor y capability snapshot.
- parámetros saneados y referencia al input.
- progreso, etapa, timestamps y reason code.
- costo estimado/real cuando aplique.
- checkpoints y outputs.
- política de retry/cancel y resultado de verificación.

### 11.2 Reglas

- Cerrar o desmontar un panel no cancela el job.
- Ocultar/minimizar la ventana no equivale a cancelar.
- La cancelación debe alcanzar procesos hijos y solicitudes remotas cuando el proveedor lo permita.
- Reiniciar la app debe recuperar jobs según checkpoint y política.
- Idempotencia evita duplicar assets, clips, cargos o entregables.
- Un job fallido no debe dejar el proyecto parcialmente corrupto.
- La app debe declarar honestamente si un job requiere que el proceso de Olyvia permanezca abierto; no prometer 24/7 sin servicio instalado.
- El usuario ve progreso, logs saneados, costos, bloqueos y controles desde el mismo editor.

## 12. MCP, plugins y automatización externa

### 12.1 MCP

MCP expone capacidades de Olyvia de forma estructurada. Debe permitir descubrir herramientas, leer el estado del proyecto, proponer planes, ejecutar operaciones permitidas, consultar jobs, cancelar/reanudar y recuperar entregables.

El servidor MCP utiliza los mismos casos de uso que la UI. No crea una segunda lógica de edición. Las herramientas MCP no deben eludir el permission service ni el historial.

### 12.2 Contrato de tools

Cada tool declara:
- Nombre estable y versión.
- Descripción y schema de entrada/salida.
- Capabilities y permisos requeridos.
- Clasificación de riesgo y side effects.
- Idempotencia, timeout y cancelación.
- Resultado tipado y errores recuperables.
- Límites de tamaño y paginación.

Separar scopes de lectura de proyecto, edición, filesystem, red/descargas, generación con costo, render y publicación. Las acciones de alto impacto requieren aprobación explícita.

### 12.3 Integraciones

Plugins y conectores son adaptadores externos, no propietarios del proyecto. No deben insertar interfaces de edición paralelas ni guardar documentos alternativos. La UI presenta su estado y controles dentro del editor. Las credenciales se guardan en keyring/almacén seguro y nunca se exponen a prompts o logs.

## 13. Seguridad, privacidad y derechos

### 13.1 Modelo de amenazas mínimo

Proteger:
- Archivos del usuario, proyectos y medios privados.
- Credenciales, tokens y sesiones de proveedores.
- Descargas, archivos importados y metadatos no confiables.
- Browser automation y contenido de páginas.
- Comandos MCP y agentes externos.
- Jobs, procesos hijos y outputs.
- Actualizaciones, instaladores y dependencias de terceros.

### 13.2 Controles obligatorios

- Validar rutas, symlinks, traversal, extensiones y contenido real del archivo.
- Limitar tamaño, duración, resolución, streams, recursos y tiempo de proceso.
- No ejecutar comandos arbitrarios generados por IA.
- Construir argumentos de procesos sin concatenación shell insegura.
- Allowlist de comandos IPC y scopes por operación.
- Aislar directorios temporales y outputs.
- Redactar secretos, tokens, cookies y datos personales en logs.
- Verificar hashes de modelos/binarios descargados y procedencia.
- Escanear dependencias y generar SBOM/notices.
- Registrar permisos, aprobaciones y side effects.
- Mantener originales y backups antes de operaciones destructivas.
- Respetar derechos de autor, licencias y términos de fuentes externas.
- No publicar ni compartir sin permiso separado.
- Ofrecer consentimiento claro para subir medios a proveedores remotos.

### 13.3 Derechos y procedencia

Cada asset externo o generado registra fuente, URL/proveedor, autor si se conoce, licencia/terms, fecha, modelo/versión, prompt y restricciones relevantes. Si la licencia es desconocida, se etiqueta como no verificada y no se presenta como apta para uso comercial.

## 14. Rendimiento, estabilidad y accesibilidad

### 14.1 Principios de rendimiento

- Arranque rápido: shell ligero, módulos pesados lazy y tareas no esenciales diferidas.
- Preview: cache por frame/clip/efectos, proxies adaptativos y resolución configurable.
- Timeline: virtualización, operaciones incrementales y selección estable.
- Audio: buffers y reloj de reproducción controlados.
- Render: procesos limitados, cancelación real y telemetría de recursos.
- UI: no recalcular todo el proyecto por cada movimiento de control.
- Memoria: liberar frames, thumbnails y caches con política LRU/límites.
- Disco: estimar espacio antes de proxy, render, descarga y generación.
- Hardware: detectar CPU/GPU/encoder; fallback seguro a software.
- Degradación: si una capacidad no soporta el equipo, informar el límite y ofrecer alternativa.

### 14.2 Estabilidad

- Autosave y recuperación con journal/checkpoints.
- Migraciones de schema versionadas y con backup.
- Timeouts, retries acotados y circuit breakers para servicios externos.
- Crash reporting opcional y saneado.
- No bloquear UI mientras se realiza IO, render o análisis.
- Evitar que una tarea de background modifique una selección diferente a la que el usuario revisa sin mostrarlo.

### 14.3 Accesibilidad

- Navegación completa por teclado.
- Focus visible y orden lógico.
- Contraste y etiquetas accesibles.
- Atajos configurables sin conflictos.
- Tooltips y nombres completos en rail compacto.
- Estados no comunicados sólo por color.
- Controles de precisión accesibles además de gestos sobre preview.

## 15. Contratos transversales y eventos

Los eventos deben ser tipados, versionados y correlacionables. Ejemplos conceptuales:
- project.opened / project.saved / project.recovered.
- editor.selection.changed / editor.playhead.changed.
- tool.activated / tool.deactivated.
- operation.proposed / operation.approved / operation.applied / operation.failed.
- preview.frame.ready / preview.invalidated.
- job.queued / job.progress / job.awaiting_approval / job.completed / job.failed / job.cancelled.
- media.imported / media.probed / media.missing.
- render.started / render.completed / render.verified.
- provider.capabilities.changed / provider.unavailable.

Todos los eventos incluyen eventId, schemaVersion, timestamp, correlationId y referencias a entidades; no transportan secretos ni blobs innecesarios. La UI puede reconstruir estado consultando APIs de lectura: no depende de haber recibido cada evento en tiempo real.

## 16. Observabilidad y diagnóstico

- Logs estructurados por job, operación, proyecto y subsistema.
- Correlation IDs entre UI, IPC, Rust, worker y provider.
- Métricas de latencia, RAM, CPU, GPU, disco, cancelación y recuperación.
- Redacción de rutas sensibles, tokens y contenido privado.
- Export de diagnóstico bajo consentimiento.
- Separar error de usuario, falta de permiso, falta de capability, provider quota, timeout, fallo de motor y corrupción.
- Cada reporte identifica HEAD/build, entorno, comando, test y evidencia.
- Nunca marcar una función como real sólo porque se muestra el panel.

## 17. Fases de construcción y gates

### Fase 0 — Definición y baseline

- Confirmar contratos y decisiones del producto.
- Registrar estado real del repositorio, rama, cambios y agentes activos.
- Reconciliar blueprint, arquitectura y matriz de capacidades.
- No sobrescribir trabajo concurrente.

**Salida:** baseline reproducible y lista de decisiones/gaps.

### Fase 1 — Frontend definitivo (FASE ACTUAL)

- Terminar el diseño visual del editor que el usuario quiere.
- Definir la distribución final, navegación contextual, biblioteca, inspector, monitor y timeline.
- Mantener las funciones existentes y evitar rediseños involuntarios.
- Asegurar que la futura activación de herramientas pueda cambiar el contexto sin reemplazar el editor.
- Validar resoluciones pequeñas, accesibilidad, estados y rendimiento visual.

**Salida:** frontend aprobado explícitamente por el usuario. Hasta entonces no se inicia la unificación funcional masiva.

### Fase 2 — Contratos y registro de herramientas

- Inventariar herramientas reales existentes.
- Asignar toolId y operationId estables.
- Mapear motor, permisos, selección requerida, preview, salida y undo.
- Resolver duplicidades de contrato; conservar project-schema y effect-kit como propietarios únicos.
- Crear pruebas de contrato.

**Salida:** matriz herramienta→operación→motor→estado→prueba completa.

### Fase 3 — Editor permanente y estado compartido

- Mantener shell, preview y timeline montados.
- Centralizar contexto de proyecto, selección y playhead.
- Introducir activación contextual sin rutas disruptivas.
- Conectar inspector, overlays y biblioteca al mismo estado.
- Verificar persistencia de layout y sesión.

**Salida:** activar/cancelar herramientas no desmonta editor, monitor ni timeline.

### Fase 4 — Integración funcional por dominios

Orden sugerido por dependencias:
1. Proyecto, assets y timeline.
2. Preview y transformaciones.
3. Texto, captions y gráficos.
4. Audio y mixer.
5. Efectos, color, máscaras y transiciones.
6. Motion, tracking y compositing.
7. IA, generación y producción autónoma.
8. Descargas, conversiones, grabación e integraciones.
9. Render, export y entrega.

Cada dominio se integra verticalmente con tests y sin eliminar capacidades existentes.

### Fase 5 — Jobs, IA y MCP de extremo a extremo

- Jobs durables, cancelación, recovery e idempotencia.
- Planner y operación IA estructurada.
- Aprobaciones, costo y auditoría.
- MCP usa los mismos casos de uso y permisos que UI.
- Pruebas con providers reales autorizados.

### Fase 6 — Calidad, seguridad, rendimiento y release

- Test suite integral y E2E de usuario.
- Auditoría de permisos, secretos, paths, procesos y dependencias.
- Render y export verificados con ffprobe/decode.
- Benchmarks de startup, RAM, timeline, preview y render.
- Instalación limpia y recuperación.
- Notas, licencias, SBOM y manifiestos.

### Regla de secuenciación

No adelantar fases por presión de velocidad. No mezclar rediseño visual con refactor masivo de motores. No cerrar un gate por compilación aislada. Cada salida requiere pruebas y evidencia.

## 18. Criterios globales de aceptación

Olyvia cumple la arquitectura objetivo cuando:
1. Existe un único proyecto editable como fuente de verdad.
2. El editor principal es permanente y todas las herramientas se usan dentro de él.
3. Monitor y timeline permanecen disponibles durante cualquier flujo de herramienta.
4. Las operaciones se reflejan en el mismo proyecto y se pueden guardar/reabrir.
5. Undo/redo funciona para operaciones compatibles y se documentan las no reversibles.
6. La IA usa operaciones tipadas y no ejecuta shell libre.
7. Jobs continúan independientemente del montaje de componentes y se recuperan según policy.
8. Providers y motores reportan capabilities reales, costos y límites.
9. Preview y export mantienen paridad dentro de tolerancias.
10. MCP respeta los mismos permisos, casos de uso y registros de auditoría.
11. Seguridad, licencias, privacidad y rendimiento tienen evidencia.
12. Cada capacidad del catálogo tiene estado real, responsable y prueba.
13. No existen flujos que obliguen al usuario a abandonar el editor para continuar editando el vídeo.

La matriz de aceptación especializada sigue siendo `16_FEATURE_ACCEPTANCE_MATRIX.md`; no duplicar sus filas aquí.

## 19. Matriz de responsabilidad

| Área | Propietario principal | Límite |
|---|---|---|
| Dirección visual y UX | Usuario + HY4 | HY4 implementa; no redefine el producto unilateralmente. |
| Frontend/editor shell | HY4 | No implementa motores ni lógica de dominio. |
| Contratos de operación | SWE 2 + revisión compartida | Versionados, testeados y documentados. |
| Proyecto/timeline | Dominio Rust + project-schema | Fuente única de verdad. |
| Render/media | SWE 2 | FFmpeg/engines detrás de puertos. |
| IA/providers | SWE 2 | Adaptadores y políticas; no secretos en UI/prompts. |
| MCP/integraciones | SWE 2 | Mismos casos de uso y permisos. |
| Integración vertical | HY4 + SWE 2 | Pruebas E2E y criterios compartidos. |
| Seguridad/release | SWE 2 + revisión | Evidencia, no declaraciones. |

## 20. Documentos especializados relacionados

Este documento no reemplaza los siguientes documentos; los conecta:
- `01_PRODUCT_VISION.md`: objetivos, usuarios y flujos de producto.
- `02_FRONTEND_HY4_SPEC.md`: diseño, UX, layout y estados visuales.
- `03_BACKEND_SWE2_SPEC.md`: backend, dominios, motores y runtime.
- `04_AUTONOMOUS_STUDIO_MCP_CONTRACT.md`: planner, producción autónoma y MCP.
- `05_CAPABILITY_GAP_MATRIX.md` y `12_COMPLETE_FEATURE_CATALOG.md`: inventario y alcance funcional.
- `06_PROVIDER_AND_MEDIA_CONNECTORS.md`: providers y adquisición.
- `07_ENGINE_STACK_AND_OPEN_SOURCE_RESEARCH.md`: motores, repositorios y licencias.
- `08_SECURITY_PRIVACY_PERFORMANCE.md`: controles y rendimiento.
- `09_IMPLEMENTATION_ROADMAP_AND_ACCEPTANCE.md`: plan de implementación y escenarios E2E.
- `11_FRONTEND_BACKEND_HANDOFF.md`: contratos HY4/SWE 2.
- `13_FINAL_PROJECT_DELIVERY_CONTRACT.md`: release y entrega.
- `14_AGENT_EXECUTION_PROTOCOL.md`: ejecución de agentes y continuidad.
- `16_FEATURE_ACCEPTANCE_MATRIX.md`: criterios por capability.
- `../decisions/2026-11-13-permanent-editor-surface.md`: decisión obligatoria del editor permanente.
- `../architecture/TARGET-STRUCTURE.md`: estructura lógica del código.
- `../architecture/DEPENDENCY-RULES.md`: dependencias permitidas.
- `../architecture/MIGRATION-ROADMAP.md` y `PDF-100-TRACKER.md`: migración y estado de trabajo.

## 21. Reglas de mantenimiento documental

- Este archivo es el mapa maestro, no el duplicado de cada especificación.
- Los detalles de un dominio se actualizan en su documento propietario y aquí sólo se modifica el resumen o el enlace.
- No crear un documento nuevo si el tema ya tiene propietario; actualizar el existente o añadir un ADR si cambia una decisión técnica.
- Los documentos históricos se conservan; su estado debe etiquetarse con fecha.
- Los estados de implementación requieren evidencia y HEAD/build.
- Antes de cambiar arquitectura, revisar decisiones, dependencias, estado Git y trabajo de agentes.
- No borrar, resetear, limpiar, hacer commit o push sin autorización explícita.
- Una decisión de arquitectura no autoriza por sí sola cambios de código.

---
**Resumen rector:** Olyvia es un único estudio de edición audiovisual. Todas las capacidades se activan dentro del mismo editor, comparten proyecto, preview, timeline, historial y jobs. Primero se termina y aprueba el frontend; después se integra cada herramienta por contratos y pruebas, sin sacrificar funciones ni cambiar la interfaz aprobada.
