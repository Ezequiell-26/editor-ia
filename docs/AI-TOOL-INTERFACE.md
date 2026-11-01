# Interfaz de herramientas del agente (OpenAI-compatible)

Fecha: 2026-10-31. Primera rebanada del bloque A del
[audit universal](UNIVERSAL-AI-ENGINE-AUDIT.md): un modelo compatible con
function calling puede inspeccionar y operar el proyecto abierto desde el
asistente de Olyvia.

## Cómo se activa

El registro tiene **39 herramientas** (7 operativas + catálogo, router, parallax, rig, 3D, cámara, efectos, transiciones, subtítulos, escenas, plan de capítulos, transacciones, trayectorias, proyecto/material, tracking, render, segmentos y cola de escenas). El chat flotante tiene la casilla **“Herramientas del agente (puede editar el
proyecto)”**. Apagada por defecto: el asistente conserva el modo de una llamada
con 9 acciones fijas. Encendida, cada mensaje usa el bucle de herramientas.

Las mismas 39 herramientas se pueden ejecutar **desde fuera** con
`apps/project-mcp --live` contra la app abierta (ver
[LIVE-MCP.md](LIVE-MCP.md)); requieren activar **MCP → Puente en vivo**.

## Protocolos

El agente soporta dos protocolos, elegidos en Ajustes → IA con **Protocolo del
agente** (`agentKind`):

- **OpenAI-compatible** (por defecto): `/chat/completions`, `tools` y
  `tool_calls`.
- **Anthropic Messages**: `/v1/messages`, `x-api-key`,
  `anthropic-version: 2023-06-01`, `tools[].input_schema` y bloques
  `tool_use`/`tool_result`. La URL base se normaliza: si termina en `/v1` se
  agrega `/messages`, si no `/v1/messages`; `max_tokens` fijo en 2048.
  El asistente usa herramientas siempre con este protocolo (la casilla queda
  fijada) y los guiones/otros flujos siguen usando OpenAI-compatible.

## Protocolo

1. La UI envía al comando `assistant_agent` los mensajes, el contexto del
   proyecto y los esquemas JSON (máximo 24 herramientas, 20 kB de parámetros).
2. Rust valida nombres, tamaños y roles, agrega el mensaje de sistema y hace la
   llamada OpenAI-compatible con `tools` y `tool_choice: "auto"`.
3. La UI ejecuta cada `tool_call` con validación de argumentos y permisos, y
   devuelve el resultado como mensaje `role: "tool"` con `tool_call_id`.
4. El bucle repite hasta 4 rondas (máximo 6 llamadas por ronda). Si el modelo
   insiste, se corta con aviso y se muestran los pasos ejecutados.

Los argumentos se validan contra el subconjunto de JSON Schema usado (objeto,
tipos, enum, mínimo/máximo, longitud, campos desconocidos). Un error de
validación no rompe el bucle: vuelve al modelo como resultado fallido.

## Herramientas

| Herramienta | Permiso | Qué hace |
|---|---|---|
| `project_inspect` | lectura | Resumen: nombre, resolución, fps, duración, pistas, clips, materiales, escenas, playhead y selección. |
| `project_open` | edición | Abre un `.editoria.json` por ruta y entra al editor; en vivo exige que la ruta esté dentro del workspace. |
| `asset_import` | edición | Importa una imagen, video o audio del disco a Medios; en vivo exige workspace. |
| `navigate` | UI | Abre una de las 24 vistas existentes. |
| `transport` | UI | Play, pausa, guardar, deshacer, rehacer. |
| `motion_add` | edición | Agrega un gráfico (`title-card`, `lower-third`, `end-card`, `stat-callout`) en el playhead y lo selecciona. |
| `edit_transaction` | edición | Aplica varias ediciones puras en una sola transacción atómica (rollback y un solo undo). |
| `motion_path` | edición | Anima un clip visual por una trayectoria de puntos `[x0,y0,…]` con keyframes de transform, easing, Bezier opcional y escala inicial/final; reemplaza los keyframes previos. |
| `clip_add` | edición | Monta un material ya importado en una pista/frame y lo selecciona. |
| `clip_split` | edición | Divide el clip seleccionado (o `clipId`) en el playhead (o `frame`). |
| `export_open` | exportación | Abre el diálogo de exportación; no renderiza sin confirmación. |
| `engine_catalog` | lectura | Lista los 10 motores con estado real y tipos de clip que soportan. |
| `scene_resolve` | lectura | Elige motor para una escena/clip; bloquea motores no implementados con razón. |
| `parallax_add` | edición | Crea una composición 2.5D de dos capas con uno de los 9 presets de parallax. |
| `rig_add` | edición | Hornea un personaje 2D (reposo, caminar, correr, saltar, saludar o `reach` con IK) a MP4 y lo importa a Medios; `target:[x,y]` fija el objetivo IK. |
| `three_add` | edición | Hornea una escena 3D (4 presets) a MP4; con `modelPath` carga un glTF/GLB y reproduce el clip pedido; con `text` agrega un rótulo y con `textDepth` lo extruye. |
| `camera_move` | edición | Ken Burns: zoom in/out o paneo sobre un clip visual. |
| `effect_apply` | edición | Brillo, contraste, saturación, temperatura, grano, curva, gris o sepia; conserva los efectos previos. |
| `transition_apply` | edición | Transición de entrada (12 tipos) con frames configurables. |
| `subtitle_add` | edición | Agrega un cue de subtítulo con tiempos; crea la pista si falta. |
| `scene_create` | edición | Crea una escena con intención, narración, clips y motor del router opcional. |
| `clip_edit` | edición | Mueve un clip de frame/pista (ripple opcional), lo recorta, cambia velocidad, etiqueta o enabled en una mutación. |
| `perf_stats` | lectura | FPS reales de la preview en WebView2, frames caídos, fps objetivo y memoria JS mientras reproduce. |
| `project_look` | edición | Aplica o quita un look global al compuesto (contraste, saturación, temperatura, viñeta, grano, LUT, gris/sepia) en una mutación. |
| `clip_audio` | edición | Ajusta audio por clip o por escena: ganancia, paneo, EQ, fades, pasa-altos/bajos, compresor, denoise, voz o mute. |
| `audio_mix` | edición | Ajusta ganancia, paneo, EQ de 3 bandas, mute/solo por pista (id o tipo) y master (ganancia/limiter) en una mutación. |
| `narrate_scenes` | edición | Sintetiza voz SAPI por escena con `confirmRights:true`, agrega el audio a Medios, lo vincula y lo coloca en la pista de narración al inicio de sus clips. |
| `scene_update` | edición | Edita una escena existente (título, narración, intención, estado, notas, motor o clips) con validación y un undo. |
| `chapter_plan` | edición | Parte un guion con encabezados en capítulos y escenas (presupuesto de palabras), reparte clips existentes y crea todas las escenas en una mutación. |
| `render_scene` | exportación | Renderiza una escena a un segmento estable; si ya existe, lo reutiliza. En escenas largas sin subtítulos/transiciones/gráficos usa checkpoints de ~10 s y concatena. |
| `video_concat` | exportación | Une segmentos MP4 idénticos sin recodificar. |
| `track_point` | edición | Sigue un punto (0..1) sobre un clip de video y aplica la trayectoria como máscara poligonal con keyframes. |
| `track_object` | edición | Sigue una caja (centro y tamaño 0..1) y aplica una máscara rectangular con keyframes. |
| `render_start` | exportación | Inicia un MP4 con un perfil y ruta determinista junto al proyecto (sin diálogo); devuelve `jobId` y perfil. |
| `render_status` | lectura | Estado del render activo, último progreso y resultado (ruta/bytes). |
| `render_cancel` | exportación | Cancela el render activo o un `jobId`. |
| `render_queue_add` | exportación | Encola escenas compatibles para renderizarlas de a una; estado persistente entre cierres y `concat` para unir el lote al terminar. |
| `render_queue_status` | lectura | Lista la cola (pausa, trabajo en curso, estados, rutas y errores). |
| `render_queue_control` | exportación | Pausa, reanuda, cancela un trabajo en cola o limpia los terminados. |

Toda edición pasa por `store.mutate`, que clona el documento, valida contra el
schema y registra undo. No hay un segundo escritor del proyecto. El render lo
ejecuta el backend de la app; las herramientas sólo lo inician/consultan/cancelan.

## Límites actuales

- El adaptador Anthropic es sólo para el agente de herramientas; guiones,
  localización y el resto de flujos siguen el contrato OpenAI-compatible.
- `track_point`, `track_object`, `render_start`, `render_status`,
  `render_cancel`, `render_queue_*`, `rig_add`, `project_open` y `asset_import` requieren la app
  abierta/FFmpeg/WebCodecs; no están en el MCP de archivos. En vivo,
  `project_open`/`asset_import` exigen rutas dentro del workspace.
- En el puente en vivo, las herramientas con permiso `export` requieren además
  la casilla **Permitir exportación por MCP**; sin ella no se publican y los
  pedidos directos se rechazan. Los permisos de lectura/UI/edición van con el
  interruptor principal. En sesiones headless, `--mcp-export` habilita ese
  permiso sin localStorage.
- `three_add` con `modelPath` exige la app abierta (horneado WebGL/WebCodecs) y,
  en vivo, una ruta dentro del workspace; acepta glTF con buffers base64 y GLB.
- `render_queue_*` sólo opera con la app abierta: la cola vive en la UI y se
  persiste en el perfil local. Cancela trabajos que siguen en cola, no el render
  en curso. Es independiente de la cola de perfiles de exportación del diálogo.
- `motion_path` escribe keyframes de transform (offset/escala) y sólo aplica a
  clips de video o imagen; los clips gráficos se animan con su plantilla y el
  schema rechaza el transform animado. En el MCP de archivos está disponible
  para proyectos que ya tengan un clip visual.
- El quality gate del perfil puede rechazar un MP4 válido muy comprimido (por
  ejemplo una imagen estática de 5 s bajo el mínimo de 500 KB); el agente recibe
  `RENDER_FAILED` con el motivo, no un éxito falso.
- En el puente en vivo, `rig_add`, `three_add` y `render_start` esperan hasta
  **120 s** (horneado/render); el resto, 30 s, salvo `render_scene`, que también
  usa 120 s.
- La reanudación es **por escena y por checkpoint**: el segmento final se
  reutiliza si existe con la misma revisión del proyecto; si la escena supera
  ~15 s y no lleva subtítulos, transiciones ni clips gráficos, se renderiza en
  chunks de ~10 s (`<segmento>-cNN.mp4`) y sólo se regeneran los que faltan
  antes de concatenar. Verificado con `scripts/verify-scene-checkpoint.mjs`.
- El render iniciado por el agente usa el perfil por defecto y no abre el diálogo
  de exportación; el permiso de exportación debe estar habilitado.
  El **servidor MCP del proyecto** existe por stdio (ver
  [MCP-PROJECT-SERVER.md](MCP-PROJECT-SERVER.md)) con 12 herramientas.
- El bucle vive en la UI; el comando Rust no ejecuta herramientas.
- Ediciones y exportación se habilitan juntas con la casilla; falta granularidad
  por herramienta y confirmación por operación destructiva.
- `clip_split` no divide clips compuestos (misma regla que la UI).
- Los resultados se recortan a 4.000 caracteres antes de volver al modelo.
- No hay todavía un registro persistente de operaciones del agente más allá del
  undo del proyecto.

## Verificación

- Rust: **5 tests** del módulo `commands/assistant_agent.rs`, incluido un
  **round-trip HTTP real** contra un servidor local de prueba que verifica que el
  pedido incluye `tools` y que la respuesta con `tool_calls` se parsea.
- TS: **7 tests** de registro/validación/ejecución y **5 tests** del bucle
  (permisos, argumentos inválidos, errores de ejecución y límite de rondas).
- UI: **1 test** que enciende la casilla y verifica que la herramienta
  `navigate` se ejecuta y que el resultado aparece en el chat.
- Suites completas del pase: frontend **1.699/1.699 en 223 archivos**, Rust
  **513 passed / 69 ignored**, typecheck y build verdes.
