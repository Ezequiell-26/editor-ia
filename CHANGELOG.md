# Change Log — Editor IA / Olyvia

Formato basado en [Keep a Changelog](https://keepachangelog.com/), con versiones comerciales desde 2026-10-28.

## [Unreleased]

### Added — Presets de proveedor: NVIDIA NIM (DeepSeek V4.1 Flash) (2026-11-01)
- Ajustes → IA gana botones de proveedor listo. «NVIDIA NIM · DeepSeek V4.1 Flash» rellena `https://integrate.api.nvidia.com/v1` y `deepseek-ai/deepseek-v4.1-flash`; el usuario solo pega su clave `nvapi-…` (se guarda en el almacén de Windows).
- También queda «FreeLLMAPI local» (`http://127.0.0.1:31415/v1`, modelo `auto`).
- Verificado sin clave: `GET /v1/models` del endpoint de NVIDIA responde **200 en 0,72 s**; `POST /v1/chat/completions` devuelve «authorization missing», lo que confirma ruta y método. La llamada autenticada queda pendiente de la clave del usuario.
- Tests del preset 3/3, typecheck limpio.

### Changed — Consumo de tokens del asistente (2026-11-01)
- **Router de herramientas por intención** (`selectToolsForMessage`): el agente ya no envía las 45 definiciones en cada ronda; manda solo el grupo que la frase necesita (3 base + intents de archivos, edición, audio, render, guion, motion, efectos o proyecto), con tope de 14. Medido: el esquema pasa de **8.393 tok estimados a 834–2.567 según la frase (−69 % a −90 %)**.
- Historial del chat reducido de 12 a 6 mensajes y cada uno acotado a 700 caracteres antes de enviarse.
- Resultados de herramientas acotados a 1.200 caracteres de resumen y 900 de datos (antes 4.000 por resultado); el bucle baja de 6 rondas/8 llamadas a 4/4.
- `max_tokens` explícito en los tres cuerpos: 500 para el chat simple y 1.024 para el agente (OpenAI-compatible y Anthropic), en lugar del default del proveedor.
- La UI muestra la estimación de la próxima llamada: «N herramientas · ~X tok» bajo el compositor, calculada con las mismas reglas que el envío.
- Tests: router **8/8**, asistente **53/53**, typecheck limpio.

### Added — Video automático desde una carpeta con imágenes y voz (2026-11-01)
- Herramienta `auto_video_from_folder` para el asistente: recibe una carpeta, encuentra imágenes y el audio de voz, los importa a Medios y monta el video en la timeline del proyecto abierto.
- Planificador determinista `features/autoedit/folder-film.ts`: reparte las imágenes usando los **silencios reales** del audio (medidos por FFmpeg) y cae a reparto uniforme si no hay pausas; cubre exactamente la duración de la narración con un mínimo adaptable.
- Montaje `apply-folder-film.ts`: imágenes en una pista `image` con Ken Burns alternado (zoom/pan) y disolvencias; la voz va a una pista `narration` desde el frame 0. No toca clips existentes.
- Selección de voz: si la carpeta tiene varios audios, prefiere nombres con “voz/narra/voice/locución”; si no, el más largo.
- Corrección crítica de guardado: el validador Rust de proyectos no incluía `sequences` ni `compounds` en sus claves raíz, así que el primer guardado de un proyecto actual fallaba con «clave raíz desconocida». Se alineó `KNOWN_ROOT_KEYS` (22) con el esquema TypeScript.
- Tests nuevos: **8** del planificador y **1** de integración del montaje; asistente + autoedit **62/62**.
- Prueba real: 3 imágenes reales de Descargas + una narración SAPI de ~22 s en `.tmp/folder-film-test`; el asistente montó 3 clips con Ken Burns y la voz en la pista de narración.

### Added — El asistente puede explorar los archivos del equipo (2026-11-01)
- Cuatro herramientas nuevas para el agente: `files_roots` (carpeta personal, Escritorio, Descargas, Documentos, Videos, Imágenes, Música y unidades), `files_list` (contenido de una carpeta), `files_search` (por nombre o extensión, con profundidad y límites) y `files_read_text` (texto pequeño de lista blanca). Se suma `media_find`, que encuentra video/audio/imagen en una sola pasada (los más recientes primero).
- Backend nativo `commands/filesystem.rs` con `fs_roots`, `fs_list`, `fs_search` y `fs_read_text`: solo metadatos en los listados, búsquedas con límites (120 resultados, profundidad 6) y exclusión de `node_modules`, `.git`, `Windows`, `AppData`, `$Recycle.Bin` y `System Volume Information`; las carpetas ocultas no se listan salvo `includeHidden`.
- `files_search` sin raíz recorre Descargas, Escritorio, Videos y Documentos; `query` acepta `*.mp4`/`.srt` para filtrar por extensión. Las raíces se detectan también cuando Windows movió esas carpetas a otra unidad (por ejemplo `D:\Users\<usuario>\Downloads`), no solo bajo `%USERPROFILE%`.
- La lectura de contenido está acotada a `.txt .md .srt .vtt .csv .json .log .cube .xml .yaml .ini` y 256 KB: no se vuelcan binarios ni credenciales al modelo.
- El flujo queda completo: buscar → importar con `asset_import` → editar con `clip_edit`/`edit_transaction`.
- Corrección de un límite preexistente: el backend del agente aceptaba solo 24 herramientas y el catálogo ya tenía 39 (error «demasiadas herramientas» al activarlas). Ahora acepta 64 con tope de 96 KB de esquemas; el bucle sube a 6 rondas y 8 llamadas.
- UI: el checkbox ahora dice «buscar archivos, importar y editar el proyecto»; el saludo sugiere «buscá videos en Descargas»; si se pide archivos con las herramientas apagadas, la app avisa qué activar.
- Verificación: `tsc` limpio, asistente **45/45**, payload medido en **43 herramientas / 30 KB**, `cargo check` OK y build validado. Prueba real: el agente ejecutó `files_*` y devolvió carpetas reales del equipo.

### Changed — UI del editor y de Inicio para 1360×768 (2026-11-01)
- Studio: los modos de edición y el control del layout pasan de dos filas de 32 px a una franja única (`.editor-top-strip`); el visor gana 32 px de alto.
- Studio: columnas compactas reales (270/290/268 px) en los tres niveles que las pisaban (`editor-preferences`, `studio.css`, `resolve-theme.css`) con migración de preferencias v1→v2 que respeta un layout personalizado (tests nuevos).
- Timeline: el área más allá del final del proyecto conserva el tono de pista y su grilla en vez de negro puro (`.timeline-surface`).
- Topbar responsive: ≤1150 px oculta proyecto/estado y rótulos del buscador; ≤980 px reduce acciones; se elimina la superposición de menús en ventanas angostas.
- Inicio: la ruta de producción pasa a grid 3×2 (los seis pasos sin scroll) y el contador de herramientas se alinea a la columna de acciones con hero más compacto.
- Verificación: `tsc` limpio, editor **195/195**, preferencias+layout **14/14**, suite **1351/1352** (el fallo restante fue timeout bajo carga; aislado **71/71**); build debug **9m 08s** validado en la app con capturas.
- Detalle en `UI_IMPROVEMENTS_2026-10-31.md` (olas 1 y 2).

### Added — Worker de render backend real (2026-10-31)
- Nuevo binario `olyvia-render-worker.exe` que usa el motor FFmpeg de la app sin abrir UI/WebView: carga el proyecto, elige perfil por resolución/códec, expande compuestos, arma el plan, renderiza y verifica el archivo.
- `apps/render-worker` deja de ser contrato vacío: `RENDERING_IMPLEMENTED = true`, el CLI spawnea el binario, valida traversal dentro de `--project-root`, y sólo responde `completed` tras `verifyRenderedOutput`.
- Verificación real sin la app abierta: proyecto de capítulos → `completed`, **6.200.464 B, 1920×1080, 10,0 s, H.264+AAC**, `durationMs 3.673`; el binario directo produjo el mismo tamaño.
- Cierre: suite **234 archivos / 1.783 tests** (worker 23), typecheck raíz verde.

### Added — Entidad Sequence para capítulos (2026-10-31)
- El documento gana `sequences` (id, orden, título) y `Scene.sequenceId`; los proyectos viejos migran con `sequences: []` y el JSON Schema regenerado lo exige.
- `chapter_plan` crea una secuencia por capítulo y asigna cada escena creada; `project_inspect` lista secuencias con su conteo de escenas y `sequenceId` por escena.
- Verificación: tests de schema/artefacto y de herramienta (2 capítulos → 2 secuencias, 2 escenas asociadas).
- Cierre: suite **234 archivos / 1.781 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Edición de clips por agentes: mover, recortar y velocidad (2026-10-31)
- `clip_edit` mueve un clip de frame o pista (ripple opcional), recorta la duración, cambia velocidad, etiqueta o enabled en una sola mutación, y devuelve la posición/duración final calculada dentro de la mutación (no del estado previo).
- Verificación real por MCP: clip 2 movido **180 → 400**, recortado a **120 frames** y devuelto a **180**; cada paso persistió en el JSON.
- Límite: mover a una posición que solape otro clip en la misma pista se rechaza; el recorte consume la ventana de origen (no se puede alargar luego sin relink).
- Cierre: suite **234 archivos / 1.781 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Medición real de la preview en WebView2 (2026-10-31)
- La preview mide FPS reales con `requestAnimationFrame` mientras reproduce, calcula frames caídos contra el fps del proyecto y expone el chip en el HUD.
- `perf_stats` devuelve por MCP `fps`, `targetFps`, `frames`, `dropped` y memoria JS; sin reproducción reporta inactivo en vez de inventar valores. 3 tests del cálculo y cobertura del tool.
- Verificación real en WebView2 reproduciendo el proyecto de narración: **33 fps reales, 0 caídos, 11,7 MB JS** (objetivo 30); tras pausar, `active:false` y métricas en cero.
- Cierre: suite **234 archivos / 1.781 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Mezcla de audio por clip y por escena (2026-10-31)
- `clip_audio` ajusta ganancia, paneo, EQ de 3 bandas, fades, pasa-altos/bajos, compresor, denoise, efecto de voz o mute por clip o por todas las escenas indicadas; permite mezclar distinto cada capítulo aunque compartan pista.
- Verificación real (`scripts/verify-clip-audio.mjs`): base centrada en las dos ventanas de voz (**L/R -23,88** y **-23,73**); tras aplicar gain -4, pan 0,6 y fade-in 10 solo al primer clip → primera ventana **L -35,86 / R -27,90 (+7,96 dB)** y segunda intacta **L/R -23,73**; valores persistidos.
- Límite: fades mínimos de 1 frame (el esquema no acepta 0); los efectos de voz disponibles son los seis del esquema.
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Edición de escenas existentes para agentes (2026-10-31)
- `scene_update` edita una escena sin recrearla: título, narración, intención, estado, notas, motor (`auto` lo quita) y clips (con validación de existencia y máximo 50), todo en una mutación con un undo.
- Cobertura unitaria: edición de título/motor/clips vacíos, restauración del clip y rechazo de escena inexistente.
- Verificación real por MCP en vivo sobre el proyecto de narración; valores persistidos en el JSON.
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Look global del compuesto para agentes (2026-10-31)
- `project_look` aplica o quita un look a todo el proyecto (brillo, contraste, saturación, temperatura, sombras, altas luces, fade, viñeta, grano, nitidez, denoise, blur, hue, LUT, gris/sepia) en una sola mutación.
- Verificación real (`scripts/verify-project-look.mjs`): mismo proyecto sin look → **Y 125,7 / SAT 112,66**; con contraste 1,5, saturación 0,2, temperatura 0,4, viñeta 0,6 y grano 0,15 → **Y 55,0 / SAT 9,67**, hashes de frame distintos y look persistido; repetido dos veces con los mismos valores.
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Mezcla de audio por pista y master + relleno de audio corto (2026-10-31)
- `audio_mix` ajusta ganancia, paneo, EQ de 3 bandas, mute/solo por pista (id o tipo) y master (ganancia/limiter) en una sola mutación.
- El render ahora rellena con silencio (`apad`) y recorta (`atrim`) la mezcla a la duración exacta cuando la voz/música termina antes que la timeline; antes el export fallaba con “la pista de audio termina antes que la timeline”.
- Verificación real (`scripts/verify-audio-mix.mjs`): base centrada L/R **-26,51 dB**, mezcla con pan -0,8 y master -1 → **L -30,23 / R -44,22 (+13,99 dB)** y **-26 LUFS**, render **12,000 s / 7.496.670 B / H.264+AAC**; valores persistidos en el proyecto.
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Narración por escena para producción larga (2026-10-31)
- `narrate_scenes` sintetiza voz **SAPI** para 1–20 escenas con `confirmRights:true`, agrega cada WAV a Medios con origen `generated-locally`, lo vincula a la escena y crea el clip de voz en la pista de narración al inicio de los clips de la escena. Sin confirmación o sin texto/clips se rechaza u omite con motivo.
- Verificación real (`scripts/verify-chapter-narration.mjs`): 2 escenas → **2 WAV vinculados**, clips de voz en frames **0 (96 frames)** y **180 (75 frames)**; render de la primera escena **6,000 s / 3.749.571 B / H.264+AAC**; sin `confirmRights` la llamada falla.
- Límite: una voz por lote y sin mezcla específica por capítulo (música/ambiente fuera de escena siguen manuales).
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Texto 3D extruido en escenas Three.js (2026-10-31)
- `three_add {text, textDepth}` genera `TextGeometry` con bisel y la fuente MgOpen Helvetiker incluida, escala el ancho a 3,5 unidades y usa material metálico; sin `textDepth` el rótulo sigue siendo el sprite plano. `textDepth` sin `text` se rechaza.
- Fuente y licencia MgOpen/MAGENTA incluidas en `features/three/fonts` y documentadas en avisos, `LICENSES.md` y el recurso del instalador.
- Verificación real (`scripts/verify-three-text.mjs --depth 0.22`): “Olyvia 3D” → VP9 **941.516 B**, 2 s, 1280×720; el frame 0,5 s muestra caras laterales y bisel.
- Límite: una sola fuente incluida, sin animación por glifo.
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Constructor de escenas en Guion (2026-10-31)
- Cada tarjeta de escena muestra **Motor** (Auto + 10 motores) y **Clips visuales** con checkboxes de los clips de la timeline; el estado local entra en “cambios sin guardar” y `Guardar escena` persiste todo con un undo.
- `updateScene` acepta `clipIds`: deduplica, exige clips existentes y limita a 50; tests de acción (asociar/rechazar/ límite) y de UI (desmarcar clip, fijar motor y verificar el proyecto tras guardar).
- Verificación visual real (debug con Computer Use): la tarjeta muestra `CLIPS VISUALES (1)`, al desmarcar aparece el aviso y el botón se habilita; guardar deja `clipIds: []` en el JSON del proyecto tras `transport save`.
- Límite: los clips se listan por nombre de material; dos clips del mismo material comparten etiqueta.
- Cierre: suite **233 archivos / 1.778 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Planificador capítulo→escena para producción larga (2026-10-31)
- `chapter_plan` parte un guion con encabezados “#”/“Capítulo N” en capítulos y escenas con presupuesto de palabras (20–160), reparte los clips existentes en round-robin y crea todas las escenas en **una sola mutación** con un undo. Rechaza clips inexistentes y planes de más de 60 escenas.
- `chapter-plan.ts` con 3 tests unitarios: capítulos, corte por presupuesto, capítulo por defecto y entradas vacías.
- Verificación real (`scripts/verify-chapter-plan.mjs`): 2 capítulos → **3 escenas** con clips a/b/a, intenciones hook/explainer/outro, persistencia tras guardar y render de la primera escena **6,000 s / 3.710.542 B / H.264+AAC**; clip inválido rechazado.
- Límite: no crea audio por capítulo ni asigna clips desde la UI; los clips se pasan al planificar.
- Cierre: suite **233 archivos / 1.776 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Checkpoint intra-escena en renders largos (2026-10-31)
- Las escenas de más de ~15 s sin subtítulos, transiciones ni clips gráficos se renderizan en chunks de ~10 s (`<segmento>-cNN.mp4`); al re-renderizar sólo se generan los faltantes y se concatenan, sin recodificar.
- `scene-chunks.ts` planifica rangos contiguos y nombres estables; `fileNameOf` acepta rutas POSIX y Windows; 4 tests unitarios.
- Verificación real (`scripts/verify-scene-checkpoint.mjs`, debug con `--mcp-live --mcp-export`): 45 s → **5 chunks**, se borran `c02` y el final, se reencola y sólo se regenera `c02`; `c01`/`c05` conservan mtime; final **45,021 s / 27.908.638 B / H.264+AAC**.
- Límite: con subtítulos, transiciones o gráficos se renderiza de una pasada.
- Cierre: suite **232 archivos / 1.773 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Transacciones de edición atómicas (2026-10-31)
- `edit_transaction` aplica hasta 20 ediciones puras (clip, motion, efectos, transición, subtítulo, escena, parallax, cámara o pin de motor) sobre una copia y hace un único `store.mutate`: si una falla no se guarda nada y un solo undo revierte el lote. Las herramientas con servicios/render/UI quedan fuera.
- El esquema de herramientas admite arrays de objetos anidados; validación recursiva.
- Verificación real (`scripts/verify-transaction.mjs`): clip + subtítulo → **1 clip / 1 cue**; undo → **0/0**; lote con `clip_split` inexistente → **sin cambios** (rollback).
- Cierre: suite **231 archivos / 1.769 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Changed — Controles IK en el panel de personaje (2026-10-31)
- El panel **Personaje 2D** expone **Objetivo X/Y** para el clip `reach` (0..1, deslizadores), dibuja una mira sobre el canvas y pasa el mismo objetivo a la previsualización y al horneado. Los controles sólo aparecen con `reach`.
- Test de UI que cambia a `reach`, verifica los valores por defecto (0,82/0,28), ajusta X y comprueba que los controles desaparecen al volver a otro clip.
- Cierre: suite **231 archivos / 1.768 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Idempotencia en el puente en vivo (2026-10-31)
- `POST /v1/mcp/tool` acepta `idempotencyKey` (8–128 alfanuméricos/`-`/`_`); el puente cachea el resultado 10 min (máx. 100) y devuelve `cached:true` sin reejecutar. Los fallos de infraestructura no se cachean. Auditoría/SSE incluyen `cached`.
- Verificación real (`scripts/verify-live-idempotency.mjs`): mismo `clip_add` con la misma clave → **1 clip** y segunda respuesta cacheada; clave distinta → 2 clips; clave inválida → 400.
- Tests Rust de caché/expiración de errores y parseo de la clave. Cierre: suite **231 archivos / 1.768 tests**, Rust **538 passed / 71 ignored**, typecheck y build verdes.

### Added — Rótulo 3D en escenas Three.js (2026-10-31)
- `three_add {text}` dibuja el texto en un canvas del sistema, lo texturiza como `Sprite` siempre de cara a la cámara y lo superpone a la escena (hasta 120 caracteres); el sprite se libera al terminar.
- Verificación real (`scripts/verify-three-text.mjs`): “Hola Olyvia” en `orbit-cube` → VP9 **910.936 B**, 2 s 1280×720; frames con el rótulo centrado y el cubo girando.
- Límite declarado: es texto billboard, no geometría extruida; sin fuentes personalizadas.
- Cierre: suite **231 archivos / 1.768 tests**, Rust **537 passed / 71 ignored**, typecheck y build verdes.

### Added — Replay SSE y progreso de render (2026-10-31)
- Los eventos SSE llevan `id` y se guardan en un historial de 200; `Last-Event-ID` reenvía los perdidos al reconectar. La app reenvía `render_progress` (throttle 250 ms) y `render_finished` al bus.
- Verificación real (`scripts/verify-live-events.mjs --render`): primer stream con 4 eventos, replay de un `engine_catalog` ocurrido sin conexión, **20 eventos de progreso** y render final **5.604.103 B / 15,233 s / 10.908 ms**; auditoría con los 6 pedidos.
- Tests Rust ampliados para historial/replay; cierre: suite **231 archivos / 1.768 tests**, Rust **537 passed / 71 ignored**, typecheck y build verdes.

### Added — SSE y auditoría persistente del puente en vivo (2026-10-31)
- `GET /v1/mcp/events` transmite `tool_started`/`tool_finished` (tool, ok, duración, resumen) con keep-alive; `GET /v1/mcp/audit?limit=N` lee las últimas entradas. Ambos exigen el token y el control en vivo activo.
- Cada pedido se escribe en `mcp-live-audit.jsonl` (sin argumentos/secretos), con recorte a 400 líneas al superar 1 MB. Tests Rust de bus SSE, saneamiento de desconectados y round-trip/cap de auditoría.
- Verificación real (`scripts/verify-live-events.mjs`): 2 llamadas → 4 eventos SSE, auditoría con 2 entradas y duraciones **29/87 ms**; JSONL verificado en disco. Límite: sin replay/Last-Event-ID ni progreso de render por SSE.
- Cierre: suite **231 archivos / 1.768 tests**, Rust **537 passed / 71 ignored**, typecheck y build verdes.

### Added — IK de dos huesos en el rig 2D (2026-10-31)
- Nuevo clip `reach` con `solveTwoBone` (intersección de círculos, codo exterior, mano limitada al alcance) e `ikAmount = sin(π·t)`; `rig_add` acepta `target:[x,y]` normalizado y el panel usa el objetivo por defecto. El resto es reposo y el brazo derecho sigue el objetivo.
- Verificación real (`scripts/verify-rig-ik.mjs`): objetivo (0,66; 0,30) → VP9 **245.658 B**, 2 s 1280×720; frames con el brazo flexionado al objetivo y de vuelta. Un objetivo fuera de alcance (0,88; 0,22) se limita sin error.
- Tests: solver (alcance/límite/codo), pose `reach`, herramienta con target válido e inválido. Cierre: suite **231 archivos / 1.768 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Added — Selector de clip de animación glTF (2026-10-31)
- `three_add` acepta `animation` (nombre o índice) para elegir cualquier clip del modelo; sin el parámetro usa el primero. Devuelve `animations` con todos los nombres y falla enumerándolos si el pedido no existe (`animationIndex`, función pura con test).
- Verificación real (`scripts/verify-three-animation.mjs --model ... --clip Pulso`): GLB con Giro/Pulso, clip **Pulso** elegido y horneado VP9 **1.296.076 B** (3 s, 1280×720); frames 0,3/1,5/2,7 s con el cubo pulsando y una animación inexistente rechazada.
- Cierre: suite **231 archivos / 1.766 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Added — Auto-concat de la cola de escenas (2026-10-31)
- `render_queue_add` acepta `concat: true`: los trabajos del lote comparten `batchId` y, cuando todos terminan, la cola concatena los segmentos automáticamente y guarda el final en `finals` (persistido). La tarjeta de Producción trae **Unir al terminar** (activo por defecto), muestra el final y `clear-finished` limpia también los finales.
- Verificación real en dos fases con `--concat` (`scripts/verify-scene-queue.mjs`): 4 escenas restauradas tras reiniciar, 4 segmentos completados y **final automático 5.476.425 B / 13,021 s** h264+aac, decodificado completo sin errores.
- Cierre: suite **231 archivos / 1.765 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Changed — Router cableado en el montaje y en la UI (2026-10-31)
- El montaje automático consulta `Scene.engine`: `ken-burns` fuerza el movimiento del medio aunque `photoMotion` sea `none`; los demás motores quedan como decisión persistida y agregan un aviso (“el montaje automático no lo ejecuta”). El plan expone `engine` y `engineApplied`.
- `updateScene` acepta `engine` (o `null` para limpiar) y Producción muestra un selector por escena con Auto + los 10 motores; el agente puede fijarlo con `scene_resolve pin`.
- Tests: 2 de auto-edit y 1 de UI además de los de schema/router. Cierre: suite **231 archivos / 1.764 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Added — Motor del router persistente por escena (2026-10-31)
- `Scene.engine` opcional (enum de los 10 motores) en el schema; `scene_create` acepta `engine` y `scene_resolve` acepta `pin: true` para resolver y persistir la decisión con `store.mutate`. `project_inspect` expone `sceneList[].engine` y Producción muestra “motor …”.
- `scene_resolve` pasa a permiso `edit` porque puede escribir. Se corrigió su enum de motores (faltaba `rig`) y la nota del motor 3D en el router (ya acepta glTF/animación).
- Verificación real (`scripts/verify-scene-engine.mjs`): escena “Apertura paralaje” resuelta a `ken-burns`, `pinned: true`, guardada y leída del JSON y de `project_inspect` con el mismo motor. Tests nuevos de schema y alineación router↔schema.
- Cierre: suite **231 archivos / 1.761 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Added — Cola de escenas de render persistente (2026-10-31)
- Nueva cola de escenas en la UI (`state/scene-render-queue.ts` + `RenderQueueProvider`), separada de la cola de perfiles de exportación existente (que quedó intacta). Persiste en el perfil local, restaura los trabajos interrumpidos y procesa una escena por vez esperando a que FFmpeg cierre el archivo antes de seguir; reutiliza los segmentos ya listos.
- Herramientas nuevas (30 en total): `render_queue_add`, `render_queue_status` y `render_queue_control` (pausar/reanudar/cancelar/limpiar). La tarjeta **Cola de render** en Producción permite encolar todas las escenas, pausar y cancelar.
- Verificación real de dos fases (`scripts/verify-scene-queue.mjs`): pausa + 4 escenas encoladas → cierre de la app → restauración con **4 queued** → reanudación → 4 segmentos (**933.181 / 1.067.401 / 1.644.828 / 1.834.953 B**, attempts 1) → concat **5.476.425 B / 13,021 s** h264+aac → decodificación completa sin errores. Un intento previo expuso que la cola marcaba completado antes de que el job terminara; se corrigió esperando `activeRender` y el archivo.
- Cierre: suite **231 archivos / 1.758 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Added — Exportación headless y prueba integral de 17 ítems (2026-10-31)
- `--mcp-export` / `EDITOR_IA_MCP_EXPORT=1` habilita el permiso de exportación en sesiones headless de confianza sin localStorage; `mcp_live_status` expone `export` y el hook lo combina con la casilla. Verificado en la app: con `--mcp-live --mcp-export` el puente publica **27** herramientas; sin el flag, **22** y `render_start` no se registra.
- `scripts/verify-integral.mjs` se amplió a **17 ítems** (se ejecuta con `--mcp-export`): agrega `motion_path` sobre el clip 3D y un GLB importado con clip “Giro” de 2 s. Resultado real: **8 clips, 7 assets, 4 escenas**, 15,233 s; render **5.663.541 B** en **10.313 ms**, 1920×1080/30 fps h264+aac, audio -20,1 dB, 4 frames distintos (1/5/9/12 s) y revisión visual (stickman, cubo 3D y modelo animado). El script ahora borra su propio proyecto y recrea el lote para que la corrida sea repetible.
- El MP4 integral se **decodificó completo** (video y audio) con `ffmpeg -f null`: sin errores, **457/457 frames** decodificados para 15,233 s a 30 fps; cierra el ítem de reproducción completa a nivel codec.
- Cierre: suite **230 archivos / 1.749 tests**, Rust **535 passed / 71 ignored**, typecheck y build verdes.

### Added — Animaciones glTF en escenas 3D (2026-10-31)
- Al importar un glTF/GLB con animaciones, la escena reproduce su **primer clip** con `AnimationMixer` durante el horneado (`setTime` por frame, tope 99,9 % para no caer en el borde del loop). La rotación automática del preset se desactiva para que mande el clip; cámara y luces siguen. Sirve para animaciones de nodo, esqueleto y morph.
- `three_add` devuelve `animation: {name, durationSeconds}` en `data`; `Scene3DVideoResult` y `RigClipCreation` lo exponen.
- Verificación real (`scripts/verify-three-animation.mjs`): GLB “Giro” de 2 s → VP9 **1.330.925 B**, 3 s 1280×720; frames 0,3/1,5/2,7 s con el cubo girando (revisión visual) y hashes distintos. El script inspecciona el MP4 importado a Medios, sin depender del permiso de exportación.
- Límites: sólo el primer clip, sin selector ni retargeting; el loop se corta en el 99,9 % del clip.
- Cierre: suite **230 archivos / 1.749 tests**, Rust **534 passed / 71 ignored**, typecheck y build verdes.

### Added — Permisos de exportación y workspace fijo del puente MCP (2026-10-31)
- El puente MCP en vivo separa **edición** de **exportación**: el interruptor principal publica 22 herramientas y la casilla **Permitir exportación por MCP** agrega `export_open`, `render_start`, `render_cancel`, `render_scene` y `video_concat` (27). Apagada por defecto.
- Verificación en la app real: `GET /v1/mcp/tools` devolvió **22** herramientas sin el permiso; `render_start` respondió **“herramienta desconocida o no registrada”**. La UI conserva un chequeo de segunda capa y un test de persistencia de ambas casillas.
- `--mcp-workspace`/`EDITOR_IA_MCP_WORKSPACE` ahora **fija** el workspace de la sesión (`workspace_locked`): un proyecto restaurado al abrir ya no lo reemplaza, y la UI no puede cambiarlo. Test Rust nuevo; el lote `live_mcp` queda en 7 tests.
- Cierre: suite **230 archivos / 1.749 tests**, Rust **534 passed / 71 ignored**, typecheck y build verdes.

### Added — Importación glTF/GLB en escenas 3D (2026-10-31)
- `three_add` acepta `modelPath`: carga un `.gltf` o `.glb` local con `GLTFLoader` (MIT, import dinámico), calcula su caja, lo escala a 2 unidades por dimensión mayor, lo centra y lo apoya en el piso con la cámara/luces del preset. `modelPlacement` es una función pura con test.
- CSP: `connect-src` ahora admite `data:` para que `GLTFLoader` lea buffers base64 embebidos; sin eso un `.gltf` con data URI fallaba con “Failed to load buffer”.
- El puente en vivo valida `three_add.modelPath` contra el workspace (Rust), con test; el MCP de archivos mantiene la herramienta pero el horneado sigue siendo de la app.
- Verificación real (`scripts/verify-three-model.mjs`): GLB de 928 B → horneado VP9 de 3 s (**1.359.831 B**) → render **1.791.037 B, 3 s, 1920×1080/30 fps h264+aac**, frames distintos y revisión visual; `.gltf` con buffer base64 (1 s) importado como **404.967 B**. Suite **230 archivos / 1.748 tests**, Rust **533 passed / 71 ignored**, typecheck y build verdes.
- Trap registrada: la app restaura el último proyecto al abrir y el puente toma ese root como workspace, reemplazando `--mcp-workspace`; el test usa un perfil WebView2 aislado (`WEBVIEW2_USER_DATA_FOLDER`).

### Added — Trayectorias de movimiento y render verificado (2026-10-31)
- Nueva herramienta `motion_path`: anima un clip de video/imagen por puntos `[x0,y0,…]` (2–24 puntos), con frames, easing (`linear`/`ease-in`/`ease-out`/`ease-in-out`), Bezier opcional y escala inicial/final; escribe keyframes de transform vía `updateClip` y reemplaza los anteriores. El registro del agente pasa a **27 herramientas**.
- `motion_path` también se reutiliza en el **MCP de archivos** (13 herramientas) para proyectos con clips visuales; el intento sobre un clip gráfico se rechaza con el motivo del schema (`only video and image clips can animate their transform`).
- Verificación real (`scripts/verify-motion-path.mjs`): proyecto nuevo creado por MCP de archivo, imagen importada, `clip_add`, `motion_path` de **5 puntos / 120 frames** (ease-in-out, escala 1→1,15), grano 0,45 + contraste 1,1, guardado y render. Resultado: **3.098.204 B, 5 s, 1920×1080/30 fps h264+aac**; frames en 0,5/2/3,5 s con hashes distintos y revisión visual del desplazamiento (el panel se corre a la derecha y vuelve).
- Prueba de protocolo nueva: trayectoria sobre el clip de video del fixture, keyframes persistidos. Documentación actualizada (`AI-TOOL-INTERFACE.md`, `LIVE-MCP.md`, `MCP-PROJECT-SERVER.md`, audit).
- Cierre: suite **230 archivos / 1.747 tests**, Rust **533 passed / 71 ignored**, typecheck y build verdes.

### Added — Render por escenas, concat y reanudación (2026-10-31)
- Nuevas herramientas `render_scene` (renderiza una escena a un segmento estable y lo reutiliza si existe) y `video_concat` (une segmentos MP4 sin recodificar); el registro pasa a **26 herramientas**.
- Rust `commands/concat.rs`: demuxer concat con `-c copy`, validación de segmentos/salida, `file_info` para reanudar, y workspace obligatorio para `video_concat` en vivo.
- Los segmentos se nombran por proyecto+escena+**revisión** (`segmentOutputFileName`), así una edición invalida el segmento viejo; `project_inspect` expone `sceneList` con rangos.
- Verificación real (`scripts/verify-scene-resume.mjs` sobre el proyecto integral): escenas 0–120/120–210/210–300; segmentos **4+3+3 s** (987.448 / 1.085.562 / 1.610.894 B); final **3.681.306 B, 10,021 s**, h264+aac 1920×1080, audio **-21,1 dB**; `render_scene` reutilizó el segmento existente, se borró el segundo y **sólo** se regeneró, y el concat final volvió a dar el mismo tamaño/duración.
- Límites: reanudación **por escena**, no dentro de una escena; los rangos salen de los clips de la escena (el audio fuera de escena no se incluye); caché de segmento ligada a la revisión del proyecto.
- Cierre: suite **230 archivos / 1.745 tests**, Rust **533 passed / 71 ignored**, typecheck y build verdes.

### Added — Prueba integral real por 24 herramientas (2026-10-31)
- Nuevas herramientas: `three_add`, `camera_move`, `effect_apply`, `transition_apply`, `subtitle_add` y `scene_create`; el registro del agente pasa a **24**.
- `startRender` del agente ahora construye **motion plans** para clips gráficos (`buildProjectMotionPlans`) y los pasa al render; antes el export fallaba con “clips gráficos sin plan de motion”.
- El puente en vivo usa **120 s** para `rig_add`, `three_add` y `render_start` (30 s para el resto) y `render_status` incluye el último evento.
- Prueba integral ejecutada **sólo con MCP**: proyecto creado por el MCP de archivo y edición en vivo con imagen + cámara + parallax, rig caminando, escena 3D, efecto, transición, título animado, voz SAPI, música, 2 subtítulos y 3 escenas; guardado y render.
- Resultado medido: **7 clips, 6 assets, 3 escenas**, 15,23 s; render **1920×1080/30 fps/h264+aac**, **3.771.311 B**, **9.930 ms**; audio **-20,1 dB** medio; frames en 1/5/9 s con hashes distintos; frames revisados visualmente (título+subtítulo, stickman, cubo 3D). Script `scripts/verify-integral.mjs`.
- Sustitución declarada: la escena programática usa el motor de **motion graphics propio**, no Motion Canvas (no se incorporó un segundo editor). Límite abierto del test original.
- Cierre: suite **230 archivos / 1.743 tests**, Rust **531 passed / 71 ignored**, typecheck y build verdes.

### Added — Proyecto, material y render autónomo desde el agente (2026-10-31)
- Nuevas herramientas `project_open` (abre un `.editoria.json` y entra al editor) y `asset_import` (importa imagen/video/audio a Medios); el registro pasa a **18 herramientas**.
- Workspace obligatorio para rutas en el puente en vivo: `--mcp-workspace`/`EDITOR_IA_MCP_WORKSPACE` o la carpeta del proyecto abierto; Rust canonicaliza y rechaza rutas fuera antes de emitir el pedido.
- `project_create` del MCP de archivo ahora aplica `ensureDelivery`: el proyecto nace con perfiles 16:9/9:16/1:1 y variantes, por lo que un proyecto creado por agente ya se puede renderizar.
- `render_start` del agente usa una ruta determinista junto al proyecto (`renderOutputFileName` + `startRenderTo`) en vez del diálogo nativo de guardado, que bloqueaba la UI y dejaba el pedido en timeout.
- Verificación: **13 tests de registro**, **1 Rust de workspace**, **5 de nombre de salida**, y edición + render reales: `project_open` → `asset_import` (video de prueba) → `clip_add` → `transport save` → `render_start` dejó **1 asset / 1 clip** en disco y un MP4 **1920×1080, 30 fps, 6 s, 3.714.030 B** (h264+aac) verificado con ffprobe; `render_status` reporta `completed` con ruta y bytes (scripts `verify-live-edit.mjs` / `verify-live-app.mjs`). El proyecto se abre en el editor (view `editor`), no queda en la pantalla de inicio.
- Límites: un proyecto de imagen estática de 5 s no supera el mínimo de 500 KB del perfil YouTube y el render se rechaza (comportamiento correcto del quality gate, no del codificador); sin creación de proyecto nativa por el agente (se crea con el MCP de archivo), una ruta por importación y sin selector de carpeta en vivo.
- Cierre: suite **230 archivos / 1.742 tests**, Rust **531 passed / 71 ignored**, typecheck y build verdes.

### Added — Puente MCP en vivo (2026-10-31)
- La app abierta expone `GET /v1/mcp/tools` y `POST /v1/mcp/tool` en el puente local autenticado (`x-editoria-token`), con **16 herramientas** registradas por la UI y ejecutadas con el mismo host del asistente.
- `apps/project-mcp` suma `--live http://127.0.0.1:47615 --token <token>`: el servidor stdio lista y ejecuta las herramientas de la app abierta; el modo archivo sigue igual sin `--live`.
- Control **apagado por defecto** con interruptor en MCP → Puente en vivo (`localStorage`); apagarlo libera pedidos pendientes. Timeout 30 s, pedidos serializados, validación de schema y undo del proyecto.
- Host compartido (`assistant-host.ts`) para chat y puente; configuración por `provider.agentKind` intacta.
- Verificación: **5 tests Rust** de la cola, **1** del parser HTTP, **4** del cliente en vivo con app falsa, **2** de `executeLiveRequest`, **2** de UI/estado y `npm run mcp:verify:live` (protocolo 2025-06-18, 2 herramientas, `project_inspect`, `rig_add`, desconocida `isError`); el modo archivo `mcp:verify` sigue verde. **Round-trip real** con la build debug `--mcp-live`: la UI registró **16 herramientas**, `project_inspect` respondió `{ok:false, summary:"no hay un proyecto abierto"}` y `engine_catalog` devolvió **10 motores**. Suite **229 archivos / 1.736 tests**, Rust **530 passed / 71 ignored**, typecheck y build verdes.
- Límites: sin SSE/reconexión, sin permisos por herramienta, la lista se carga una vez por proceso, `render_status` en vivo no recibe el último evento y el token habilita también exportación.

### Added — Seguimiento de objetos por caja (2026-10-31)
- `render/point_track.rs` agrega `track_region`: plantilla texturada de la caja (~144 muestras), NCC, búsqueda ±24 px y umbral 0,35; conserva la última posición si el objeto desaparece.
- Comando `track_object_in_video` y servicio `trackObject` con caja normalizada (`x/y/width/height`) → centro por frame + `regionWidth/regionHeight`.
- VFX: botón **Seguir objeto** que usa la caja del polígono y aplica una máscara rectangular con keyframes (`maskFromObjectTrack`); el asistente suma `track_object` (**16 herramientas**).
- Verificación: **6 unitarios del tracker** (punto y región), **5 de la sesión**, **2 live FFmpeg** (cuadrado y objeto texturado, ambos pasan con el bundle), **5 tests de máscaras**, **2 de UI**, **1 de herramienta**; typecheck/build verdes y suite serial **226 archivos / 1.728 tests**, Rust **524 passed / 71 ignored**.
- Límites: tamaño fijo (sin escala/rotación), sin detección semántica ni pose, 6 fps/480 px y ventana ±24 px; no está en el MCP de archivos.

### Added — Rig 2D de personaje stickman (2026-10-31)
- `features/rig/rig.ts`: esqueleto de 14 articulaciones, 5 ciclos procedurales (`idle`, `walk`, `run`, `jump`, `wave`), 3 paletas y dibujo determinista de 9 huesos + cabeza; progreso y ángulos acotados.
- `features/video/encode-canvas.ts` extrae el horneado VP9/WebCodecs que compartían 3D y rig; `three/bake.ts` lo reutiliza. El rig se hornea a MP4 y entra a Medios (`olyvia-rig`), sin un segundo renderizador.
- Panel **Personaje 2D** en Motion (preview, animación, paleta, duración, calidad, generar y enviar a Medios) y herramienta `rig_add` del agente (**15 herramientas**); después `clip_add` lo monta.
- Router: nuevo motor `rig` y estados reales de `three`/`object-tracking` como parciales (**10 motores**, sin `planned`).
- Verificación: **13 unitarios** de rig, **5** del codificador, **1 de UI**, **E2E real en Chrome** (3.372/3.070 px visibles, diferencia 2.054.813, MP4 VP9 de **18.267 bytes** decodificado por `<video>` a 320×180 con **1.492 px**) y pruebas de router/asistente; typecheck, build y suite serial **226 archivos / 1.724 tests** verdes.
- Límites: sólo stickman procedural (sin rigs importados, IK, skinning ni retargeting), fondo sólido sin alfa, sin bucle automático y sin MCP (necesita WebCodecs en la app).

### Added — Escenas 3D on-demand horneadas a MP4 (2026-10-31)
- Integra Three.js 0.180 (MIT) con carga dinámica y 4 presets (cubo orbital, toroide dolly, esfera de estudio, icosaedro sobre grilla) con piso, grilla, tres luces y cámara determinista.
- `renderScene3DToVideo` hornea frames VP9 con WebCodecs + mp4-muxer (720p/1080p, 24 fps, 1–10 s) y el panel **Escena 3D** de Motion permite previsualizar, generar y enviar a Medios (`stageDesignMedia` + `importMediaPaths`).
- Verificación: **3 unitarios** de presets/cámara; **E2E real en Chrome** con dos frames (15.229/21.905 px visibles, diferencia 3.757.634) y MP4 VP9 de **50.643 bytes**; **1 test de UI** del panel; build con chunk `three.module` de 704,88 kB (gzip 181,18 kB).
- Límites: 3D **baked** (se regenera para cambiar), sin glTF/alpha/texto 3D y requiere WebCodecs VP9 + WebGL2.

### Added — El agente inicia y sigue renders (2026-10-31)
- Nuevas herramientas `render_start` (perfil opcional + subtítulos), `render_status` (job activo, progreso y resultado con ruta/bytes) y `render_cancel`; el asistente se suscribe a `render-progress`/`render-finished` y expone el último evento.
- Permisos: iniciar/cancelar requieren el permiso de exportación del agente; consultar es lectura. El MCP de archivos no las expone (necesitan la app).
- Verificación: **1 test** de las tres herramientas con el host (job id, estado vacío, cancelación del activo) y **1 test** del payload de 14 herramientas; typecheck y build verdes.
- Límite: el render del agente usa el perfil por defecto y no abre el diálogo de exportación; la ruta se elige como en cualquier `startRender`.

### Added — Seguimiento de punto propio (2026-10-31)
- `render/point_track.rs`: tracker por correlación cruzada normalizada (NCC) sobre frames grises, plantilla fija y umbral de confianza; conserva la última posición si el sujeto desaparece.
- Comando `track_point_in_video` con extracción de frames PNG a 480 px (~6 fps, 12–240 frames, máx. 30 s) y servicio `trackPoint`.
- VFX: botón **Seguir punto** que usa el centro del polígono y convierte la trayectoria en una máscara poligonal con keyframes (máx. 48, filtra confianza < 0,35).
- Verificación: **6 unitarios Rust**, **1 live FFmpeg** que sigue un cuadrado en movimiento (pasa con el bundle), **3 tests** de la máscara y typecheck/build verdes.
- Límite: sin invariancia a escala/rotación, sólo video, ventana ±24 px y punto inicial = centro del polígono (sin selector dedicado).

### Added — Adaptador Anthropic para el agente (2026-10-31)
- `assistant_agent` elige el protocolo con `provider.agentKind`: OpenAI-compatible (por defecto) o Anthropic Messages (`/v1/messages`, `x-api-key`, `anthropic-version`, `tools[].input_schema`, bloques `tool_use`/`tool_result`).
- La traducción de mensajes, herramientas y llamadas vive en Rust y está probada con un **round-trip HTTP real** contra un servidor local que verifica headers, endpoint y payload.
- Ajustes → IA agrega **Protocolo del agente**; con Anthropic el asistente fuerza el modo herramientas (la casilla queda fijada). Guiones y demás flujos siguen usando OpenAI-compatible.
- Verificación: **3 tests Rust nuevos** (traducción, parseo y HTTP), **1 test de UI** del modo Anthropic; Rust **513 passed / 69 ignored**, typecheck y build verdes.
- Límite: el adaptador es sólo para el agente; `max_tokens` fijo en 2048 y la URL base se normaliza a `/v1/messages`.

### Added — Presets 2.5D/parallax con render verificado (2026-10-30)
- Nuevo `state/parallax.ts`: 9 presets (Ken Burns, parallax suave, push/pull, background drift, foreground separation, depth zoom, camera pan/tilt) que crean fondo y recorte en pistas nuevas con movimientos relativos y duración común.
- Expuesto como `parallax_add` en el asistente y en MCP; el router marca `parallax` como **partial** y el movimiento de preview se movió a `motion-preview.ts` con fórmulas lineales en la intensidad.
- Verificación: **7 tests** de presets/errores/clamps, **3** del movimiento de preview y un **render real FFmpeg** con dos PNG generados: el fondo se movió **12 px** y el recorte **102 px** entre 0,05 s y 0,85 s del MP4.
- Panel **Parallax y profundidad** en la vista Motion (fondo, recorte, preset, dirección, intensidad y duración) con estado vacío cuando no hay materiales; **1 test de UI** lo cubre.
- Límite: el recorte lo aporta el usuario; no hay segmentación ni mapa de profundidad.

### Added — Smart Engine Router con bloqueo honesto (2026-10-30)
- Nuevo `features/engine/router.ts`: registro de 9 motores con estado real y `resolveScene`/`resolveClip` que eligen Ken Burns para fotos, efectos para video y motion graphics para gráficos.
- Los motores no implementados (`parallax`, `three`, `object-tracking`) devuelven `blocked` con la razón; `face-tracking` y `lottie` se reportan como `partial`. Nunca se elige un motor `planned` como si estuviera listo.
- Expuesto como herramientas `engine_catalog` y `scene_resolve` en el asistente y en el servidor MCP del proyecto.
- Verificación: **8 tests unitarios** del router + 1 de herramientas; `npm run mcp:verify` lista **11 herramientas** y resuelve el gráfico como `motion-graphics`; frontend **1.681/1.681 en 220 archivos**, typecheck y build verdes.
- Límite: el router todavía no se consulta desde Director/auto-edit ni persiste la resolución por escena.

### Added — Servidor MCP del proyecto (2026-10-30)
- Nuevo `apps/project-mcp`: servidor MCP por stdio (JSON-RPC 2.0) que reutiliza las herramientas y acciones reales del editor. 9 herramientas: `project_create`, `project_inspect`, `timeline_list`, `asset_list`, `timeline_seek`, `motion_add`, `clip_add`, `clip_split`, `project_save`.
- Escritura atómica con validación completa del schema, límite de 32 MB, rutas confinadas al workspace y detección de cambios externos (mtime/tamaño) antes de pisar un proyecto.
- Bundle con esbuild (`npm run mcp:build`), sin dependencias nuevas en runtime; verificación stdio real con `npm run mcp:verify`.
- Verificación: protocolo **2025-06-18**, 9 herramientas, proyecto temporal con 2 clips y 2.267 bytes; **12 tests unitarios**; frontend **1.672/1.672 en 219 archivos**, typecheck y build verdes.
- Límite: servidor de archivos (la app abierta puede guardar después), sin transporte HTTP ni tools de render/export.

### Added — Tool calling del agente sobre el proyecto (2026-10-30)
- `assistant_agent` (Rust) envía `tools` JSON Schema a proveedores OpenAI-compatible y devuelve `tool_calls` validados; la UI ejecuta las herramientas y devuelve los resultados al modelo en un bucle de hasta 4 rondas.
- Registro de 7 herramientas reales: `project_inspect`, `navigate`, `transport`, `motion_add`, `clip_add`, `clip_split` y `export_open`, con permisos, validación de argumentos y ediciones a través de `store.mutate` (undo + validación del schema).
- Casilla opt-in «Herramientas del agente (puede editar el proyecto)» en el asistente; apagada conserva el modo anterior de una llamada.
- Verificación: **5 tests Rust** (incluye round-trip HTTP real con un servidor local que comprueba tools en el pedido y parsea tool_calls), **7 unitarios** de registro/validación, **5** del bucle y **1 de UI**; frontend **1.660/1.660 en 217 archivos**, Rust **510 passed / 68 ignored**, typecheck y build verdes.
- Límite: sin servidor MCP del proyecto ni adaptador Anthropic; permisos de edición/exportación se habilitan juntos.

### Fixed — El HSL selectivo usa la máscara de huesaturation (2026-10-30)
- `hsl-matrix.ts` reproduce el camino selectivo de `huesaturation` (marca por canal máximo/mínimo y peso por píxel con `strength=100`); `LutRenderer` recibe la máscara y mezcla la matriz sólo en los píxeles del rango.
- Medido contra el FFmpeg del bundle: `hue=90,saturation=0.2,intensity=0.1,colors=r` sobre rojo da **[92,255,0]** y con `colors=g` el rojo queda **sin cambios**.
- La preview ya no aproxima la selección parcial con CSS cuando la capa usa WebGL2 (el perfil Eficiente y la falta de WebGL2 conservan `hue-rotate`); el texto del Inspector lo refleja.
- Verificación: **1 unitario nuevo** (máscara/peso/referencia FFmpeg) y **3 E2E nuevos** (rango rojo, rango ajeno y look); suite LUT **48/48**, **1.647 frontend en 215 archivos**, typecheck y build verdes.
- Límite: el colorMatch y el look se siguen aplicando por capa.

### Revertido — Tercer frame temporal descartado por costo no confirmado (2026-10-30)
- Probé un tercer frame anterior en el denoise (ring de 4 canvas, textura extra, peso `0,2`). El harness mostraba una desviación algo menor, pero en la primera corrida del benchmark el denoise midió **43,1 FPS** frente a **56,8** del espacial (GPU 3D 72 % vs 63,6 %) y el caso completo **46,1** con GPU **98 %**.
- La corrida final con dos frames dio **44,4 vs 48,6** en el par temporal/espacial y **60** en LUT+denoise; la varianza entre corridas es alta y no confirma causalidad, así que se revirtió para no sumar una textura y una muestra por píxel sin beneficio medido en FPS.
- Se restauraron el harness y el E2E. La ventana de `atadenoise` sigue documentada como límite: el export usa `s=9` por defecto.
- Verificación del revert: suite LUT **45/45**, **1.646 frontend en 215 archivos**, typecheck y build verdes; benchmark final **21:42Z** en `EFFECTS-PERFORMANCE.md`.

### Fixed — El HSL usa la matriz exacta de `huesaturation` (2026-10-30)
- `hsl-matrix.ts` reproduce la ruta completa de `huesaturation` de FFmpeg (hue/saturation/intensity con lightness preservada) y la validé contra el binario del bundle: rojo → [255,93,0], lima → [0,255,93] y azul → [93,0,255] dentro de 1/255.
- `LutRenderer.setHslMatrix` aplica esa matriz 3×3 después de la temperatura y antes de la ganancia por canal; `EffectOverlay` y `Preview` la activan para el clip y el look fuera del perfil eficiente, y omiten la aproximación CSS sólo cuando todos los rangos están activos.
- Nota histórica: la selección parcial seguía aproximándose en CSS; quedó resuelta por la máscara selectiva del mismo día (ver entrada superior).
- Verificación: **2 tests unitarios** de la matriz y **2 E2E nuevos** sobre rojo en clip y look; suite LUT **45/45**, **1.646 frontend en 215 archivos**, typecheck y build verdes.
- Límite (superado el mismo día por la máscara selectiva): HSL parcial en CSS; el colorMatch y el look se siguen aplicando por capa.

### Fixed — El colorMatch usa la ganancia por canal del export (2026-10-30)
- `LutRenderer.setChannelGain` aplica `colorchannelmixer=rr:gg:bb` con la fuerza del colorMatch, después de la temperatura y antes de las curvas; `Preview` calcula las ganancias con el mismo clamp (0,25–4) y activa el pase fuera del perfil eficiente. Aplica al clip y al look.
- Antes la preview aproximaba el match con brillo/sepia/hue-rotate CSS.
- Verificación: **2 E2E nuevos** sobre gris 128 con ganancias r=1,5/g=0,5/b=1,25 (192/64/160 exacto) en clip y look; suite LUT **43/43**, **1.644 frontend en 213 archivos**, typecheck y build verdes.
- Límite: HSL sigue en CSS; el colorMatch del look se aplica por capa.

### Fixed — Sombras, luces y fade usan la curva maestra del export (2026-10-30)
- `tone-curve.ts` reproduce los cinco puntos de `tone_curve_filter` y los compone **antes** de las curvas del clip en una sola tabla RGBA; `EffectOverlay` la usa como curva del clip y, en la pasada del look, como curva maestra del look. `Preview` omite las aproximaciones CSS de brillo/contraste y activa el pase fuera del perfil eficiente.
- Corregí un detalle: la tabla del look se pasaba como 256 entradas y el renderer exige RGBA de 1024; ahora se replica a RGBA antes de `setCurve`.
- Verificación: **2 tests unitarios** de puntos/composición y **2 E2E nuevos** sobre gris #404040 con sombras 0,8 en clip y look (88 ±2); suite LUT **41/41**, **1.644 frontend en 213 archivos**, typecheck y build verdes.
- Límite: HSL y colorMatch del look siguen en CSS; el resto del grade es shader.

### Fixed — El brillo del look usa colorbalance aditivo (2026-10-30)
- El look con sólo brillo ahora entra en el pase de ruedas con `brightnessOnly`, que suma el brillo a `lift/offset/gain` como el export; antes era un `brightness()` CSS multiplicativo. `Preview` lo detecta como ruedas activas y omite el CSS.
- Verificación: **1 E2E nuevo** con look de brillo 0,5 sobre gris 128 (**217** en los tres canales, ±2); suite LUT **39/39**, **1.642 frontend en 213 archivos**, typecheck y build verdes.
- Límite: sombras, luces, fade, HSL y colorMatch del look siguen en CSS.

### Fixed — El grade del look usa las etapas exactas del shader (2026-10-30)
- `EffectOverlay` recibe `lookContrast`, `lookSaturation`, `lookHueDeg`, `lookTemperature`, `lookGrayscale` y `lookSepia`; tras las ruedas y el resto del grade CSS, una pasada del shader aplica esas etapas con la fórmula del export antes del LUT del look. `Preview` las omite del CSS y activa el overlay por sí solas.
- Corregí un fallo de activación: las etapas del look no estaban en `needsGl`, así que un look con sólo saturación usaba el fallback 2D y se perdía (rojo 255 en vez de 166/38/38).
- Verificación: **1 E2E nuevo** con look de saturación 0,5 sobre rojo (166/38/38 exacto); suite LUT **38/38**, **1.642 frontend en 213 archivos**, typecheck y build verdes.
- Límite: brillo/sombras/luces/fade/HSL/colorMatch del look siguen en CSS; el look sigue aplicándose por capa, no al compuesto multipista.

### Improved — Denoise temporal con dos frames anteriores (2026-10-30)
- `LutRenderer` acepta un segundo frame anterior (`previous2`, unidad de textura 8) y `EffectOverlay` mantiene una historia de **tres frames** (anillo de 3 canvases) para pasar el frame N−1 y N−2. El shader aplica una segunda mezcla con umbral propio y peso `0,4`.
- La segunda muestra baja la desviación del ruido de **8,35 a 7,84** (reducción **9,3 % → 14,9 %**) en el harness real.
- Verificación: test del shader ampliado (dos frames anteriores), suite LUT **37/37**, **1.642 frontend en 213 archivos**, typecheck y build verdes.
- Límite: sigue usando 3 frames, no la ventana de 6 de `atadenoise`.

### Fixed — El grade exacto se activa sin depender de otro efecto (2026-10-30)
- Contraste, saturación, giro de tono, escala de grises y sepia ya no esperan a que haya un LUT/curva/ruedas: fuera del perfil eficiente activan el pase WebGL por sí solos, con la fórmula y el orden del export. El perfil Eficiente y los videos sin WebGL2 conservan la aproximación CSS; las imágenes sin WebGL también.
- Antes, un clip con sólo saturación usaba `saturate()` CSS (rec709) y cambiaba de aspecto al agregarle un LUT.
- Verificación: **2 E2E nuevos** de saturación y giro solos (sin ruedas) contra la referencia JS (≤2/255); suite LUT **37/37**, **1.642 frontend en 213 archivos**, typecheck y build verdes.
- Costo: esos clips ahora montan el canvas de efectos; el perfil Eficiente evita el pase.

### Fixed — Escala de grises y sepia después de curvas en el shader (2026-10-30)
- `LutRenderer.setGrayscale` usa luma BT.601 (`hue=s=0`) y `setSepia` la matriz de `colorchannelmixer` del export; ambos se aplican al final de `gradeColor`, después de curvas y antes de denoise/viñeta/LUT.
- `Preview` los mueve al shader cuando la capa ya usa el overlay y omite `grayscale()`/`sepia()` CSS; sin overlay siguen CSS (grayscale Rec.709, una aproximación).
- Verificación: **2 E2E nuevos** con ruedas + grayscale y ruedas + sepia sobre rojo contra la referencia JS (≤2/255); suite LUT **35/35**, **1.642 frontend en 213 archivos**, typecheck y build verdes.

### Fixed — El giro de tono usa la rotación BT.601 del export (2026-10-30)
- `LutRenderer.setHue` rota Cb/Cr BT.601 alrededor de la luma después de la saturación y antes de temperatura/curvas, como `hue=h` del export. La matriz CSS es distinta: rojo+120° da **0/177/0** en FFmpeg y **0/255/0** con CSS.
- `Preview` mueve el giro al shader cuando la capa ya usa el overlay y omite `hue-rotate()` CSS; sin overlay sigue CSS. Los keyframes de giro usan la matriz del export.
- Verificación: **1 E2E nuevo** con ruedas + giro 120° sobre rojo contra la referencia JS (≤3/255); matriz medida contra FFmpeg sobre rojo/lima/azul. Suite LUT **33/33**, **1.642 frontend en 213 archivos**, typecheck y build verdes.

### Fixed — La saturación usa la luma BT.601 del export (2026-10-30)
- `LutRenderer.setSaturation` aplica `hue=s` con luma BT.601 después del contraste y antes de la temperatura/curvas. La preview usaba `saturate()` CSS (Rec.709); en rojo puro a saturación 0 la diferencia era **54 vs 76/255**.
- `Preview` mueve la saturación al shader cuando la capa ya usa el overlay (WebGL2) y omite `saturate()` CSS; sin overlay sigue CSS para no agregar un pase. Fixture propio `red.svg` para el E2E.
- Verificación: **1 E2E nuevo** con ruedas + saturación 0,5 sobre rojo contra la referencia JS (≤2/255); matriz medida contra FFmpeg (`hue=s=0.5` sobre lima: 76/201/74). Suite LUT **32/32**, **1.642 frontend en 213 archivos**, typecheck y build verdes.

### Fixed — El contraste respeta el orden ruedas → gamma → contraste (2026-10-30)
- `LutRenderer.setContrast` aplica la fórmula de `colorlevels` del export después de ruedas/gamma y antes de temperatura/curvas. La fórmula es la misma que CSS, pero el CSS se aplicaba antes del shader; ahora, cuando la capa ya usa el overlay, el contraste se mueve al pase correcto sin agregar un pase a los clips que sólo tienen contraste.
- `Preview` omite el `contrast()` CSS sólo en ese caso y `effectsToCss` acepta `{ contrast: false }`.
- Verificación: **1 E2E nuevo** con ruedas + contraste 0,5 sobre gris contra la referencia JS (≤2/255); suite LUT **31/31**, **1.641 frontend en 213 archivos**, typecheck y build verdes.

### Fixed — La temperatura del clip usa el colorbalance del export (2026-10-30)
- El shader aplica `colorbalance` de sombras (`rs=t·0,25`, `bs=−t·0,25`) después de ruedas/gamma y antes de curvas, también en los vecinos y el frame anterior del denoise. Antes la preview usaba `sepia` (sólo positivos) y no mostraba temperaturas negativas.
- `EffectOverlay` recibe `temperature`; `Preview` la envía fuera del perfil eficiente o cuando el overlay ya está activo (WebGL2) y omite el `sepia` CSS. Los keyframes de temperatura ahora se ven con la fórmula del export. El look global mantiene la aproximación CSS.
- Verificación: **1 E2E nuevo** con gris 128 y temperatura 0,6 contra la referencia `colorBalancePixel` (≤2/255); **1 test unitario** de la omisión CSS; suite LUT **30/30**, **1.641 frontend en 213 archivos**, typecheck y build verdes.

### Fixed — La viñeta usa la fórmula real de FFmpeg (2026-10-30)
- El shader reemplaza el degradado `smoothstep` por la fórmula de `vf_vignette`: centro en `w/2,h/2`, `dnorm = hypot(x−x0,y−y0)/hypot(w/2,h/2)`, factor `cos(angle·dnorm)^4` y ángulo `PI/(5−4s)` acotado a PI/2, con el mismo redondeo de píxel.
- Verificación: el E2E compara contra el FFmpeg empaquetado con `format=rgb24,vignette=PI/3` en centro, medio, lateral y vértice: **≤2/255** en los cuatro. La cadena del export en YUV puede diferir en color, como el resto de filtros.
- Suite LUT **29/29**, **1.640 frontend en 213 archivos**, typecheck y build verdes.

### Fixed — El denoise gradúa antes de comparar y mezclar (2026-10-30)
- `gradeColor` (colorbalance → gamma → curvas) se aplica al centro, a los 24 vecinos del sigma 5×5 y al frame anterior del temporal, porque el export filtra la imagen ya graduada. Antes el denoise comparaba píxeles crudos y el resultado no seguía el orden del MP4.
- Verificación: **1 E2E nuevo** con una curva de escalón que compara el shader contra la mezcla calculada en JS sobre píxeles graduados (diff máx **≤2**, media **<0,5**) y mide cuánto se alejaría el orden viejo (**>30/255**). Suite LUT **29/29**, **1.640 frontend en 213 archivos**, typecheck y build verdes.
- Bench de preview (18:41Z, sin par): **52,8–60 FPS**, CPU 0,9–4,3 %, GPU 3D del caso completo **61,6 %** con 60 FPS. El denoise graduado sube la GPU; no hay caída de FPS atribuible con esta corrida.
- Límite: el temporal sigue usando un frame anterior, no los 6 frames de `atadenoise`.

### Added — Duplicar presets de efectos (2026-10-30)
- Cada preset propio tiene un botón **Duplicar**: crea una copia con id nuevo, nombre con sufijo ` (copia)` y los mismos parámetros, la deja primero y respeta el tope de 20. Cierra el pendiente de duplicación explícita del panel.
- Verificación: **1 test unitario** de `duplicateUserPreset` (id nuevo, sufijo, efectos, id inexistente) y **1 test de UI** que duplica desde el panel real, comprueba la persistencia y que borrar el original no borra la copia; **1.640 frontend en 213 archivos**, suite LUT 28/28, typecheck y build verdes.

### Fixed — Orden del motion blur: efectos antes de acumular, LUT después (2026-10-30)
- El motion blur acumulaba los frames con el grade CSS y recién después aplicaba curvas/ruedas/denoise/viñeta/LUT; el export aplica `colorbalance`, curvas, chroma, denoise y viñeta **antes** de `tmix`, y el LUT **después**. Ahora la preview renderiza cada frame por el shader del clip (sin LUT), acumula ese resultado y aplica el LUT del clip y el look al frame acumulado.
- El fallback sin WebGL2 conserva la acumulación CSS y el look 2D de siempre.
- Verificación: **1 E2E nuevo** con dos seeks controlados (rojo→verde) y una curva no lineal: el centro da **(186, 46, 0)**, exactamente la referencia por-frame; el orden inverso habría dado valores muy distintos. Fixture `motion-colors.mp4` generado con FFmpeg (VP9, 160×90, 2 s), e2e-only.
- Suite LUT **28/28**, **1.639 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.
- Límite: el promedio es exponencial con los pesos de `tmix` (no la ventana exacta), el denoise sigue usando un frame previo y el look se aplica por capa.

### Fixed — Ruedas del look antes del grade, como el export (2026-10-30)
- El look aplicaba grade 2D → ruedas → LUT; `grade_filters` del export aplica `colorbalance` (ruedas) → gamma/contraste → LUT. Ahora el pipeline WebGL y el fallback 2D hacen **ruedas → grade → LUT**; el pase de ruedas se hace sobre un buffer 2D y el grade se aplica después.
- El E2E `lookall` se actualizó a la referencia del export: blanco → ruedas/gamma → grade 0.8 → LUT invertido (antes se calculaba con el orden inverso).
- Verificación: E2E del orden `ruedas, grade y LUT` con diff ≤3, **27/27** en la suite LUT, **1.639 frontend en 213 archivos**, typecheck y build verdes.
- Límite: el grade del look sigue siendo la aproximación CSS (brightness multiplicativo) y se aplica por capa, no al compuesto multipista; las ruedas del look no son keyframeables.

### Fixed — Orden ruedas → curvas en la preview, como el export (2026-10-30)
- El shader aplicaba curvas → ruedas/gamma; el export aplica `colorbalance` (ruedas + brillo) → gamma → curvas. Ahora el shader y el fallback 2D usan el orden del export.
- Consecuencia medible: gris 128 + brillo 0,5 + curva roja invertida da **(38, 217, 217)** en la preview y no (216, 217, 217); el CSS multiplicativo habría dado (63, 192, 192). Se actualizó el E2E de integración de `Preview` para fijar el orden correcto.
- También se corrigió el grade del look **sin LUT ni ruedas**: quedaba en el buffer 2D y se perdía cuando el overlay estaba activo por un efecto del clip (el canvas WebGL no admite un contexto 2D). Ahora se devuelve al canvas con un pase sin etapas.
- Verificación: **1 E2E nuevo** de `Preview` con ruedas + gamma + curva (≤2 contra la referencia JS) y **1 E2E nuevo** del grade del look sin LUT (cian → **0,204,204**); suite LUT **27/27**, **1.639 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.
- Límite: el denoise de la preview sigue antes de las curvas (el export lo aplica después) y la aproximación temporal usa un frame previo; el orden con motion blur sigue pendiente; el look con ruedas sigue aplicando grade 2D antes de las ruedas.

### Fixed — El brillo del clip va al shader cuando el overlay ya está activo (2026-10-30)
- `colorWheelsUniforms` acepta `{ brightnessOnly: true }`: con el overlay activo pero sin ruedas, el brillo se suma a `lift`/`offset`/`gain` (`[b,b,b]`) y se aplica en el pase WebGL/2D con la misma fórmula aditiva que `colorbalance` en el export. `Preview` omite el `brightness()` CSS en ese caso (`brightnessInShader` = brillo activo y LUT, motion blur, denoise, viñeta, curvas, chroma key o ruedas del clip/look).
- Antes, brillo + curvas (o LUT, chroma, etc.) daba el resultado multiplicativo CSS (63,192,192 en la prueba) y no el del MP4 (216,217,217).
- Además, el brillo **solo** también usa el pase exacto fuera del perfil eficiente: en imágenes siempre (fallback 2D) y en video cuando hay WebGL2 (`canUseWebGL2()`); el perfil eficiente conserva la aproximación CSS y un video sin WebGL2 también.
- Verificación: **2 E2E nuevos** (`case=brightness`: gris + curva roja invertida + brillo con el orden del export; `case=brightnessonly`: gris + brillo solo → referencia `colorbalance` con los tres rangos en +0,5, no 192); suite LUT **25/25**, **1.639 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.
- Límite: el perfil eficiente mantiene el brillo CSS multiplicativo; el look global mantiene su aproximación CSS cuando no hay ruedas.

### Tests — Texto animado verificado en render real (2026-10-30)
- `render_live_motion_graphics_produces_visible_pixels` ahora extrae dos frames del MP4 y mide el fade del título: entre 0,05 s y 0,5 s la zona central pasa de **0 a 1.019 píxeles blancos** (rect rojo estable, 83.623 B, 2 s). Cierra el escenario "texto con animación" con evidencia de render, sin cambios de producción.

### Added — Miniaturas animadas en el panel de efectos (2026-10-30)
- **21 miniaturas WebM** generadas desde el `Preview` real con `npm run effects:thumbs` (`scripts/generate-effect-thumbs.mjs`): un clip de prueba con ruido y movimiento, el efecto representativo y capturas del cuadro, codificadas a VP9 (~83 KB en total, propias/CC0). Se reproducen al hover o foco de la tarjeta y caen al swatch CSS si faltan o fallan.
- El generador usa `e2e/thumb-harness.tsx` con un proyecto y el componente real; el fixture fuente vive en `e2e/lut-harness/preview-source.mp4` y no se empaqueta.
- Verificación: **1 test de UI** (aparición/desaparición del video), **1 E2E** que comprueba `readyState ≥ 2` y `videoWidth > 0` en el panel real, suite LUT **23/23**, **1.639 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.

### Added — Ruedas del look global en la preview (2026-10-30)
- `EffectOverlay` recibe `lookColorWheels` y el pipeline del look pasa a **grade 2D → colorbalance del look → LUT del look**, desactivando curvas/ruedas/chroma del clip en cada pasada. `Preview` omite la aproximación CSS de ruedas/brillo del look cuando el shader las aplica y monta la capa aunque el clip no tenga efectos propios; el fallback 2D de imágenes también las aplica.
- Verificación: E2E del orden completo (`brightness(0.8)` + ruedas + LUT invertido) con blanco exacto **(0, 42, 15)**, E2E del componente y del `Preview` real con `project.look`. Suite LUT **22/22**, **1.638 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.
- Límite: se aplican por capa (no al compuesto multipista), no son keyframeables y el brillo del look **sin** ruedas sigue siendo CSS.

### Fixed — El LUT del look duplicaba curvas/ruedas/chroma del clip (2026-10-30)
- La segunda pasada del look reutilizaba el renderer con las curvas, ruedas y chroma del clip todavía activas, así que las aplicaba otra vez antes del LUT del look. Ahora `renderWithLookOrder` las desactiva durante esa pasada y las restaura al terminar.
- Verificación: **1 E2E nuevo** con curva roja invertida + `brightness(0.8)` + LUT invertido; el blanco queda **(255, 51, 51)** y no (0, 204, 204). Suite LUT **19/19**, **1.638 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.

### Added — E2E de integración de la Preview (2026-10-30)
- Nuevo `e2e/preview-harness.tsx` monta el `Preview` real con `ProjectProvider`, un proyecto de 320×180 y una imagen SVG blanca; así se cubre `Preview.tsx` → `EffectOverlay` y no sólo el componente aislado.
- Dos casos: **ruedas + brillo** (el píxel central coincide con la referencia JS en ≤2 y detecta el doble grade) y **curvas del clip** (blanco → cian). Fixture propio `public/e2e/fixtures/white.svg`, sin assets de terceros.
- Suite LUT **18/18**, **1.638 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.

### Fixed — Brillo + ruedas de color en la preview (2026-10-30)
- Con ruedas activas, la capa de efectos ahora omite el brillo CSS y lo suma a las nueve perillas del `colorbalance` en el shader y en el fallback 2D, como el export. Antes el brillo se aplicaba multiplicativo antes del shader y el resultado difería del MP4.
- `effectsToCss` acepta `{ brightness: false }`; el brillo **sin** ruedas sigue usando el filtro CSS de siempre. El look global mantiene su aproximación.
- Verificación: **1 test unitario nuevo** (nueve perillas + brillo y no activación por brillo solo), E2E de ruedas con **brillo 0,15** contra la referencia JS (≤2), **1.638 frontend en 213 archivos**, suite LUT **16/16**, typecheck y build verdes.

### Added — Keyframes de temperatura (2026-10-30)
- **temperature** entra en los keyframes de efecto (rango −1..1): el panel permite agregar, mover y curvar claves como en brillo; la preview la muestrea por CSS y el export la anima con una instancia `colorbalance@tempN` + `sendcmd` (`rs`/`bs`), manteniendo la ruta estática sin costo extra.
- El frame real/nativo congela `temperature` junto al resto de las propiedades animadas y elimina los keyframes de la ventana.
- Verificación: esquema/UI/sampler, test de cadena y **render real** `render_live_temperature_keyframes_warm_the_image` (gris #333333: el rojo sube y el azul baja más de 4/255 entre 0,2 s y 1,2 s). Suites: **1.637 frontend en 213 archivos**, **505 Rust + 68 ignorados**, typecheck y build verdes.

### Fixed — Doble grade de las ruedas de color en la preview (2026-10-30)
- La capa de efectos aplicaba la aproximación CSS de lift/offset/gain/gamma **y** la fórmula exacta del shader, duplicando el grade. Ahora `effectsToCss` acepta `{ colorWheels: false }` y `Preview.tsx` omite esa aproximación en el `gradeFilter` de video/imagen cuando el shader (o el fallback 2D) aplica las ruedas exactas.
- El fallback 2D de imágenes incorpora `applyColorWheelsToPixels` (colorbalance + gamma) en el orden del export, así que sin WebGL2 la imagen conserva la preview exacta; el video sin WebGL2 no tiene preview. Las miniaturas del panel y el look global mantienen la aproximación CSS.
- Verificación: **2 tests unitarios nuevos** (omisión de la aproximación y píxeles RGBA), **1.635 frontend en 213 archivos**, suite LUT **16/16**, typecheck y build verdes.

### Added — Ruedas de color en la preview (2026-10-30)
- **colorWheels** deja de ser `export-only`: el shader reproduce `colorbalance` (lift/offset/gain con ligereza max+min, pesos 4/0,333 y escala 0,7) y la gamma por canal con una tabla de spline natural de 256 entradas, en el mismo orden que el export (curvas → colorbalance → gamma → viñeta → LUT).
- `EffectOverlay` recibe `colorWheels` y sube la tabla gamma a una textura propia; `Preview.tsx` activa la capa también cuando sólo hay ruedas. El registro pasa a `webgl`/`manual`.
- Verificación: paridad contra el FFmpeg empaquetado en un gráfico de 6 colores × 3 canales con las cuatro ruedas activas: diferencia máxima **1/255**, media **0,17/255**. **5 tests unitarios**, **2 E2E** (shader contra la referencia JS y componente real), suite LUT **16/16**, **1.633 frontend en 213 archivos**, typecheck y build verdes.
- Límites declarados: requiere WebGL2; el brillo CSS se aplica antes del shader y el export lo suma a las nueve perillas, así que con brillo + ruedas puede diferir; las perillas no son keyframeables por sí mismas.

### Added — Chroma key en la preview (2026-10-30)
- **chromaKey** deja de ser `export-only`: `EffectOverlay` recibe la clave y el shader calcula el alfa con el UV BT.601 de la clave (rango completo) contra el UV del píxel (YUV limitado), ventana 3×3 y borde replicado, igual que `chromakey` de FFmpeg. El alfa se combina con el de la fuente y se premultiplica al componer.
- El registro lo declara `webgl`/`manual`; `Preview.tsx` activa la capa de efectos también cuando sólo hay chroma. Sin WebGL2 el video queda visible sin key (sin simulación).
- Verificación: **4 tests unitarios** de UV/alfa y **2 E2E** (shader contra la referencia JS y `EffectOverlay` con fondo verde + cuadrado rojo). Paridad contra el FFmpeg empaquetado en una rampa verde→rojo de 256 pasos: diferencia máxima **1/255**, media **0,52/255**. Suite LUT **14/14**, **1.628 frontend en 212 archivos**, typecheck y build verdes.
- Límites declarados: el derrame (`spill`/`despill`) no se aproxima; si el clip tiene grade CSS la clave se calcula sobre el frame graduado; sin WebGL2 no hay preview.

### Added — Curvas del clip en la preview (2026-10-30)
- **curves** deja de ser sólo export: `curvesToLut` construye una tabla de **256 entradas por canal** con spline cúbico natural y aplica la curva **maestra después de la de cada canal**, como FFmpeg. El shader de `LutRenderer` la muestrea antes del LUT del clip; el fallback 2D de imágenes la aplica píxel a píxel. El registro la declara `webgl`/`manual`.
- `Preview.tsx` activa la capa de efectos también cuando sólo hay curvas y pasa `clip.curves`; sin WebGL2 el video queda sin preview (sin simulación) y la imagen conserva el fallback.
- Verificación: paridad contra el FFmpeg empaquetado en RGB con `curves=r='0/0 0.5/0.25 1/1'`: diferencia máxima **1/255**, media **0,36/255**. **7 tests unitarios** de la tabla y **2 E2E** (shader con rampa de 4 grises y `EffectOverlay` sin LUT), suite LUT **12/12**, **1.624 frontend en 211 archivos**, typecheck y build verdes.
- Límite declarado: sin keyframes de curvas y, si el export negocia YUV, los canales pueden diferir como en el resto de filtros de color.

### Added — Medición de CPU/RAM/GPU en preview y render (2026-10-30)
- `npm run bench:preview` ahora corre una **pasada aparte de uso** por caso: árbol de Chrome de Playwright, CPU normalizada a la máquina, working set y GPU 3D del proceso GPU. Agrega los casos **denoise-spatial** para comparar el pase temporal en la misma corrida. Resultado: 1,8–4,3 % de CPU, 602–627 MB y 4,3–23,5 % de GPU 3D; el temporal sube CPU/GPU sin bajar FPS.
- `npm run bench:ffmpeg` agrega casos **h264_amf** (misma cadena de filtros) y muestrea GPU 3D y el motor de video del encoder en un job aparte para no perder CPU/RAM del proceso. Resultado 1080p/5 s: base 1,171 s / 1,672 s CPU / 148,7 MB; efectos 4,160 s / 25,031 s CPU / 186,4 MB; AMF efectos 4,550 s / 24,391 s CPU / 206,0 MB, GPU 3D 2,8 % (pico 5,5 %) y motor de video 30,9 % medio (pico 61,8 %, 2 muestras); la cadena de filtros en CPU es el cuello.
- Evidencia: `docs/EFFECTS-PERFORMANCE.md`, `docs/EFFECTS-PREVIEW-BENCH.json`, `docs/EFFECTS-COMPLETION-AUDIT.md`.

### Added — Denoise temporal en la preview (2026-10-30)
- El denoise de la preview deja de ser sólo espacial: `LutRenderer` recibe el frame anterior y mezcla sólo píxeles cercanos (**umbral 0,03–0,12** según intensidad, peso **0,8**), que aproxima el componente temporal de `atadenoise`. Se apaga con motion blur e imágenes, y se reinicia al pausar, saltar o cortar la reproducción.
- `EffectOverlay` mantiene dos canvas de staging con tope de 1920 px; la nueva prop `temporalDenoise` (por defecto activa) permite volver al costo espacial, y el perfil **Eficiente** la apaga mientras Equilibrado/Máximo la mantienen. El export no cambia: sigue usando `atadenoise` antes de acumular el blur.
- Verificación: **2 E2E nuevos** en `e2e/lut-preview.spec.ts` (shader con dos frames de ruido y el componente real con dos videos), suite LUT **10/10**, **1.617 frontend en 210 archivos**, typecheck y build verdes. En el benchmark pareado (misma corrida) el temporal no bajó FPS (60 vs 57,5 sin temporal; 60 vs 56 con LUT) pero subió CPU/GPU (0,52 vs 0,36 núcleos; 23,5 vs 19,6 % de GPU). La corrida previa de 47,1 FPS no se reprodujo y queda como outlier documentado.
- Límite declarado: no es paridad exacta con `atadenoise` (ventana y orden distintos); el detalle está en `docs/EFFECTS-COMPLETION-AUDIT.md`.

### Added — Benchmark real de preview con efectos (2026-10-30)
- Nuevo `npm run bench:preview` (`scripts/bench-preview-effects.mjs`): genera un clip 1080p60 de 8 s con el FFmpeg empaquetado, descarta un warm-up y mide frames presentados con `requestVideoFrameCallback` en el componente real (`EffectOverlay`).
- Casos: sin efectos, LUT 3D, denoise, LUT+denoise, viñeta, motion blur y la combinación. Primera corrida (pre-temporal) en iGPU AMD: **58,3–60 FPS**, p95 **16,8–33,3 ms**. La corrida posterior con denoise temporal marcó **47,1–60 FPS** y p95 hasta **33,4 ms**; no se reprodujo en la corrida pareada final (51,1–60 FPS), que además agregó casos **denoise-spatial** y midió **CPU/RAM/GPU** del árbol de Chrome en una pasada aparte (1,8–4,3 % de CPU, 602–627 MB, 4,3–23,5 % de GPU 3D). El historial completo está en `docs/EFFECTS-PERFORMANCE.md`. No incluye WebView2/Tauri ni un desglose por proceso del render.
- Evidencia: `docs/EFFECTS-PERFORMANCE.md` y `docs/EFFECTS-PREVIEW-BENCH.json`.

### Added — Grano keyframeable (2026-10-30)
- `grain` entra en los keyframes de efecto (propiedad plana); el panel usa la intensidad del catálogo y la preview SVG la muestrea por frame.
- Export: la ruta estática `noise` queda intacta; con claves se mezcla una rama ruidosa (`noise=alls=28`) con la original mediante `blend@grainvN` y `sendcmd`, antes del LUT. El frame real congela el valor y elimina los keyframes.
- Verificación: test unitario de la cadena, frame real y **render real** `render_live_grain_keyframes_increase_noise` (la desviación en una zona gris crece). Suites: **1.616 frontend en 210 archivos**, **503 Rust + 68 ignorados**, typecheck y build verdes.

### Added — Intensidad de glow keyframable (2026-10-30)
- `glowIntensity` se suma a los keyframes de efecto; el panel mapea el parámetro **Intensidad** de Glow y la preview lo inyecta dentro de `effects.glow` conservando radio y umbral (con defaults del catálogo si no había glow).
- Export: cuando hay claves, el halo se mezcla con `blend@glowvN` y `sendcmd` sobre `all_opacity`; sin claves mantiene el grafo estático y el corte temprano si no hay glow. El frame real congela `glowIntensity` en `effects.glow.intensity`.
- Verificación: esquema/UI/sampler, test unitario de la cadena, frame real y **render real** `render_live_glow_intensity_keyframes_grow_the_halo` (el halo crece sobre un cuadrado blanco). Suites: **1.614 frontend en 210 archivos**, **502 Rust + 67 ignorados**, typecheck y build verdes.


### Added — LUT `.cube` 1D (2026-10-30)
- El parser acepta `LUT_1D_SIZE`/`LUT_1D_INPUT_RANGE` (hasta 4096 puntos) y distingue la rampa por canal del cubo 3D.
- Preview: el shader usa una textura `N×1×1` y consulta cada canal en su posición; el fallback 2D interpola la misma rampa. Export: `lut_filter` lee el encabezado y elige `lut1d` en vez de `lut3d`, también para intensidad keyframeada y look/adjustment.
- Verificación: parser (15 tests), E2E del componente real en **WebGL y fallback 2D** (blanco→negro, rojo→cian), render real `render_live_1d_lut_inverts_channels`, suite LUT **8/8**, **1.612 frontend en 210 archivos**, **501 Rust + 66 ignorados**, typecheck y build verdes.

### Added — Intensidad de LUT keyframable (2026-10-30)
- `lutIntensity` entra en los **keyframes de efecto**: el panel ofrece agregar, mover y curvar claves como en brillo o blur. La preview ya muestrea `effectsAtFrame` y alimenta el shader WebGL con la intensidad animada.
- El export anima la mezcla con una instancia `blend@lutvN` y `sendcmd` sobre `all_opacity` (solo cuando hay claves), manteniendo la ruta estática sin costo extra. La rampa respeta easing, Bézier y el lead de la transición.
- Verificación: test de esquema (rango 0–1), sampler, UI de keyframes, cadena de plan y **render real** `render_live_lut_intensity_keyframes_blend_over_time`: arranca rojo y termina cian en 1,11 s. El **frame real/nativo** ahora congela el valor muestreado de todos los efectos animados (incluido el LUT) en el frame pedido, en lugar de arrastrar keyframes a una ventana de un solo frame. Suites: **1.609 frontend en 210 archivos**, **500 Rust + 65 ignorados**, typecheck y build verdes.

### Fixed — Orden del look global en la preview (2026-10-30)
- La preview aplica el look en el mismo orden que el export: **LUT del clip → grade del look → LUT del look**. Antes el grade global se aplicaba al final, sobre el escenario completo, y el color difería del MP4 cuando había LUT de look.
- `EffectOverlay` recibe `lookGradeFilter` y hace una segunda pasada (copia 2D con el grade + LUT del look) solo cuando existe grade global; el fallback 2D de imágenes y el motion blur sin WebGL usan el mismo orden.
- El grade del look deja de aplicarse a gráficos, captions y al frame real ya renderizado (el export tampoco lo aplica a gráficos; el frame real ya venía graduado y se estaba graduando dos veces).
- Verificación: nuevo E2E con dos LUT invertidos y `brightness(0.5)` en medio; el blanco vuelve ≥250 en lugar de gris 128. También se cubre el fallback 2D sin WebGL2 con el mismo orden. `e2e/lut-preview.spec.ts` **6/6**, **1.607 tests frontend en 210 archivos**, typecheck y build verdes.

### Added — Transición Iris circular (2026-10-30)
- Duodécima transición: **iris** revela el clip entrante con un círculo centrado que crece hasta cubrir las esquinas. Comparte la curva de easing de las demás transiciones.
- Preview: `clip-path: circle()` con la base porcentual de CSS (70,7 % = mitad de la diagonal); export: máscara `geq` con `hypot` y `enable` limitado al solape; frame nativo: transición congelada como `wipe=iris` con el mismo radio.
- Verificación: muestras reales con el FFmpeg LGPL empaquetado (**centro verde / esquina azul a mitad del iris**, borde superior revelado a 0,9 s), muestras equivalentes en Chrome para la máscara CSS, **1 test Rust live** (`render_live_iris…`, 1,39 s) y tests de esquema/preview/catálogo. Suites: **1.607 frontend en 210 archivos**, **499 Rust + 64 ignorados**, typecheck y build verdes.

### Added — Biblioteca de overlays propios empaquetados (2026-10-30)
- Cinco overlays **CC0 generados por Olyvia** (fugas cálida/fría, polvo, bokeh y una **mascota con alfa** que saluda) con `scripts/generate-overlays.mjs`: gradientes, partículas y dibujo procedural, sin assets de terceros. Se empaquetan MP4/WebM + posters en `resources/overlays` con catálogo y atribución.
- Comandos `list_builtin_overlays` / `import_builtin_overlay`: copian el video al proyecto, lo miden con ffprobe y lo registran como material **generado localmente** con licencia CC0 y estado listo. La mascota conserva el canal alfa (`media.alpha`) y se monta con mezcla Normal.
- Sección **Overlays propios** en Motion con miniaturas reales; al agregar, monta el clip en una pista **Overlays** con mezcla **Screen**.
- Verificación: **3 tests Rust** (catálogo, id inválido y copia real con ffprobe/asset CC0), **1 test de UI** de montaje/blend, y compuesto real con FFmpeg/libass screen inspeccionado visualmente. Suites: **1.606 frontend en 210 archivos**, **499 Rust + 63 ignorados**, typecheck y build verdes.

### Added — Preview de viñeta radial (2026-10-30)
- **vignette** deja de ser el último efecto visual `export-only`: el shader de `EffectOverlay` aplica un oscurecimiento radial continuo (borde ~90 % con intensidad 1) antes del LUT, con estado `webgl`/`available`. Sin WebGL2 no se simula.
- Evidencia: E2E en Chrome con una esquina blanca **255 → 130** y el centro **128 → 128**. Ya no quedan efectos visuales `export-only`; los manuales (curvas, ruedas, chroma, máscara) se configuran en el Inspector.
- Suites: **1.605 frontend en 209 archivos**, **496 Rust + 63 ignorados**, typecheck y build verdes.

### Added — Preview de denoise espacial (2026-10-30)
- **denoise** deja de ser `export-only`: un filtro **sigma 5×5** en el shader de `EffectOverlay` promedia sólo vecinos parecidos, baja el ruido en zonas planas y conserva bordes. Aproxima `removegrain`; el componente temporal de `atadenoise` no se replica.
- El registro lo declara `webgl`/`available`; se acota a 1920 px y sin WebGL2 el video original queda visible (sin simulación). Se combina con LUT y motion blur en el mismo canvas.
- Evidencia: E2E en Chrome con una imagen ruidosa: desviación estándar en la zona plana **20,14 → 10,64 (47,2 %)** con el borde intacto; **1 test de App** de montaje. Suites: **1.605 frontend en 209 archivos**, **496 Rust + 63 ignorados**, typecheck y build verdes.

### Added — Preview de motion blur temporal (2026-10-30)
- **motionBlur** deja de ser `export-only`: una capa canvas acumula frames con el **peso exacto del frame más nuevo de `tmix`** y la misma caída geométrica, después aplica el LUT si existe. El grade del clip se acumula antes del blur, igual que el export.
- `LutOverlay` pasa a **`EffectOverlay`** (LUT + motion blur en un solo canvas); el registro declara el motor `canvas` y el estado `available`. Sin WebGL2, el motion blur sigue disponible en 2D si no hay LUT.
- Evidencia: **3 tests unitarios** de pesos/topes, **1 test de App** de montaje y **1 E2E en Chrome** con un cuadro en movimiento: frame nítido **100 px / ancho 9** vs estela **200 px / ancho 21**, más captura visual. Límites documentados: la estela se siembra de cero al pausar/saltar y el alfa se acumula en videos transparentes.

### Added — Partículas procedurales en motion graphics (2026-10-30)
- Nueva capa `circle` con deriva lineal normalizada y plantilla **Explosión de partículas** (cantidad, color, dispersión y semilla reproducibles, texto opcional). No usa assets de stock: los círculos los genera el propio motor.
- La preview CSS usa el mismo trayecto que el `\move` del ASS (el porcentaje se corrige por el tamaño del nodo) y el render dibuja cada círculo con un polígono de 28 segmentos, alfa y fundido.
- Verificación: **5 tests TS** (determinismo, límites, deriva, render de nodos, rechazo de props), **2 tests Rust** de ASS/validación y **1 render real** con FFmpeg/libass (320×180, 2 s, 49.775 bytes, **3.140 píxeles verdes**). Inspección visual de la preview en Chromium a 12/50/92 %.

### Added — Preview LUT `.cube` 3D con WebGL2 (2026-10-30)
- **lut** deja de ser sólo export: parser `.cube` 3D propio (dominio, tamaño 2–128, rechazo de 1D/incompletos), interpolación trilineal y shader WebGL2 con intensidad. El grade del clip se aplica antes del LUT y glow/grano/nitidez después, igual que el orden del export.
- Capa canvas para clips de video e imagen con `lutFile`; el video conserva audio y enrutado Web Audio, y el look global aporta su LUT por capa. Sin WebGL2 las imágenes usan un fallback 2D y los videos quedan sin LUT en vivo (sin simulación).
- Backend `read_project_text` (32 MB, `resolve_inside_root`) y `readProjectText` en el servicio, con caché por servicio/raíz/ruta y reintento tras un parseo fallido.
- **Scopes**: muestrean el canvas LUT cuando está activo (y el video cuando no), así el vectorscopio/histograma incluyen el LUT. El renderer conserva el buffer (`preserveDrawingBuffer`) para lecturas fuera del frame.
- Verificación: **14 tests unitarios** (parser, trilineal, intensidad, textura, caché), **1 test de App** para el montaje de la capa y la suite **E2E en Chrome** (`e2e/lut-preview.spec.ts`): shader contra la interpolación JS con diff **0–1/255** (incluido el grade previo), montaje real de `EffectOverlay` con imagen + `.cube` invertido (muestras de píxeles) y alfa VP9 conservado/compuesto. Inspección visual de invert 100 %/50 %, curva 3³ y overlay real. Suites: **1.605 frontend en 209 archivos**, **496 Rust + 63 ignorados**, typecheck y build verdes.
- Límites documentados: el LUT del look global no alcanza gráficos/captions, `.cube` 1D no soportado e intensidad no keyframable.
- Los videos VP9 con alfa conservan el canal en WebGL (fixture real: RGBA 255,0,0,127) y el shader premultiplica el color para componer sin halos; verificado con una capa al 50 % sobre verde.

### Fixed — Paridad de fundidos a color y gráfico activo en el frame nativo (2026-10-30)
- **fade-black/fade-white**: la ventana de un frame no puede congelar el `fade` RGB con exactitud; durante el lead ahora cae al **compuesto completo** (paridad 0/255) y vuelve a la ventana después del corte. Los demás tipos siguen con ventana y congelado.
- **Clip gráfico sin plan de motion**: la ventana lo omite y compone las demás capas (diff 0/255); con plan disponible se usa el compuesto completo para conservar la animación.
- **Loudness live**: el tono `sine` de FFmpeg 9 no tiene opción de amplitud; el test ajusta `volume=-2dB` y vuelve a medir −23 LUFS.
- **Verificación con el FFmpeg LGPL**: `PATH=resources/ffmpeg:$PATH EDITOR_IA_RUN_RENDER_TESTS=1 cargo test -- --ignored` → **58/62**, con 4 fallos externos (SAPI, modelos de rostro en dos pruebas y motor de lip-sync).

### Added — Restaurar defaults y medición real de CPU/RAM (2026-10-30)
- El panel de efectos incorpora **Restaurar valores**, que vuelve a los defaults declarados por el registro; el test deja de ser nominal y verifica el valor restaurado antes de aplicar.
- **`npm run bench:ffmpeg`** mide pared, CPU del proceso y pico de memoria del FFmpeg empaquetado con y sin efectos. Medición 1080p/5 s: base 1,245 s / 1,828 s CPU / 149,1 MB; con 7 efectos 4,339 s / 24,0 s CPU (553 %) / 186,3 MB. Documentado en `docs/EFFECTS-MOTION-AUDIT.md`.
- Pruebas: EffectBrowser **8/8**; sin cambios de render.

### Added — Grano de película procedural end-to-end (2026-10-30)
- Nuevo efecto **grain** (categoría Film): parámetro 0–1, preview SVG con `feTurbulence` + `overlay` y export FFmpeg `noise=alls=…:allf=t+u`. Sin assets externos ni licencias de terceros.
- Esquema regenerado (`project-document.v1.schema.json`) y catálogo Rust ampliado a **21 efectos**; el panel lo descubre automáticamente.
- Verificado: preview en Chromium con textura visible; export real medido (YMIN 81→70 y YMAX 161→170). Rust **494 + 62 ignored**, **1.580 frontend en 205 archivos**, typecheck OK.

### Added — Preview de glow con SVG verificado (2026-10-30)
- **glow** deja de ser `export-only`: un filtro SVG por clip (desenfoque + umbral suave + mezcla ponderada) muestra radio, umbral e intensidad en la preview; el export FFmpeg queda intacto.
- Perfil Eficiente acota el radio a 8 px y Equilibrado a 20 px; el export conserva el valor completo.
- Verificado con Chromium headless: halo visible y texto tratado; además el preview de nitidez ya estaba verificado con realce de bordes.
- Pruebas: glow **4/4**, nitidez **5/5**, perfiles **6/6**, registro **7/7**; **1.577 frontend en 204 archivos**, typecheck OK.

### Added — Preview real de nitidez con SVG (2026-10-30)
- El efecto **sharpen** deja de ser `export-only`: una definición SVG `feConvolveMatrix` por clip aplica un núcleo 3x3 en la preview, con perfil Eficiente acotado a 0.35 y el export FFmpeg (`unsharp`) intacto.
- El preview se marca como aproximación (núcleo 3x3 RGB vs. unsharp 5x5 luma); sin segundo renderer y sin tocar el estado del proyecto.
- Pruebas: kernel, id y referencia de filtro **5/5**, perfiles **5/5**, registro **7/7**; typecheck OK.

### Added — Soltar transiciones y efectos sobre el ruler (2026-10-30)
- El ruler acepta el arrastre de una transición o un preset de efectos y lo aplica al clip editable más cercano al frame soltado, con aviso y validación de esquema. Tests de timeline: 15/15.

### Fixed — Build LGPL real y filtros GPL retirados (2026-10-30)
- **FFmpeg empaquetado**: build BtbN `win64-lgpl-shared-9.0` (sin `--enable-gpl/nonfree`, sin libx264/libx265/libxvid, con libopenh264/libkvazaar). `npm run audit:ffmpeg` verifica buildconf, encoders y licencia; `scripts/ci-bundle-resources.sh` descarga esa misma build LGPL y copia DLLs + LICENSE.
- **Filtros GPL retirados**: `eq` (brillo/contraste/saturación ahora `colorbalance`/`colorlevels`/`hue` + `sendcmd`), `hqdn3d` (ahora `removegrain` + `atadenoise`), `delogo` (ahora recuadro de redacción `drawbox`, la UI dice “Cubrir logo”) y `vidstab` (la estabilización avisa que no está en el build LGPL). `perspective` tampoco existe en el build y el export falla con el error de FFmpeg.
- **Encoders de software**: libopenh264 (H.264) y libkvazaar (H.265, sólo múltiplos de 8) con control por bitrate; sin `-preset`/`-crf`. GPU sigue teniendo prioridad.
- **HDR**: conservar HDR en H.265 devuelve un error claro (libkvazaar es 8 bits); AV1 10 bits vía libaom sigue disponible.
- **Pipeline de descargas**: perfil CPU, look manual, compresión y creador migrados a los encoders LGPL; el look cae a H.264 cuando el zoom deja dimensiones no múltiplos de 8.
- **Pruebas reales con el binario LGPL**: wipes 720p24/1080p60/4K24, keyframes de brillo/blur/hue, glow+motionBlur, audio+subtítulos+transición, pipeline base, look cinematográfico y delogo redactado. **494 Rust + 62 ignored**, 0 fallos en la suite normal.
- **Pruebas**: `npm run verify` incluye `audit:ffmpeg`; `ffmpeg:sync` copia la build LGPL local. El test E2E de estabilización se omite con mensaje explícito cuando el binario no trae vidstab.

### Added — Giro de tono animable y preview corregida (2026-10-30)
- **hueRotateDeg** se suma a los keyframes de efecto, con preview CSS real (`hue-rotate`), frame nativo y export `hue@efx` + `sendcmd`; E2E de un rojo que vira a verde.
- Se corrigió la preview de `hueRotate`, que el registro anunciaba como CSS pero no aplicaba.
- **Inventario de capacidades** en `docs/EFFECTS-INVENTORY.md` con estados, pruebas y bloqueos.
- **Pruebas**: **1.564/1.564 frontend en 202 archivos**, **489 Rust + 62 ignored**, typecheck y build OK.

### Added — Persistencia y copia de keyframes (2026-10-30)
- **Serialización/reapertura**: efectos anidados, keyframes de color/blur con Bézier y transiciones con easing se conservan exactamente al guardar y reabrir.
- **Copiar atributos**: los keyframes de efecto viajan entre clips y se filtran por la duración del destino.
- **Pruebas**: **1.561/1.561 frontend en 201 archivos**, **488 Rust + 61 ignored**, typecheck y build OK.

### Added — Curvas de transición y registro de transiciones (2026-10-30)
- **Easing de transiciones**: lineal, ease-in, ease-out, ease-in-out y hold para disolvencias, deslizamientos y barridos, con la misma curva en preview, frame nativo y FFmpeg (alfa por `sendcmd` en disolvencias).
- **Registro de transiciones**: mismo contrato que los efectos (versión, preview, export, licencia, tipos de clip y estado), usado por el selector del panel.
- **Aplicar a la pista**: crea una capa de ajuste sobre el rango seleccionado con el efecto configurado, usando el motor existente de preview/export.
- **Pruebas**: **1.559/1.559 frontend en 200 archivos**, **488 Rust + 61 ignored**, typecheck y build OK.

### Added — Presets de efectos propios y E2E con audio/subtítulos (2026-10-30)
- **Mis presets**: guardar el look del clip con nombre, aplicarlo a la selección y eliminarlo, con persistencia validada y undo.
- **Keyframes ampliados**: desenfoque animable (`gblur@efx` + `sendcmd`) y curvas Bézier editables por keyframe.
- **E2E completo**: dos escenas con transición, audio y subtítulos quemados; ffprobe confirma video+audio y la comparación de píxeles confirma el subtítulo.
- **Quitar efecto puntual**: lista de efectos activos con etiqueta y borrado individual.
- **Pruebas**: **1.555/1.555 frontend en 200 archivos**, **487 Rust + 61 ignored**, typecheck y build OK.

### Added — Inventario de licencias de medios (2026-10-30)
- **Copiar inventario** en Medios: Markdown con tipo, origen, fecha, proveedor, licencia, uso comercial y atribución de cada asset; los campos ausentes quedan como `—`.
- **Pruebas**: **1.546/1.546 frontend en 199 archivos**, **486 Rust + 59 ignored**, typecheck y build OK.

### Added — Perfiles de preview (2026-10-30)
- **Eficiente / Equilibrado / Máximo**: preferencia persistida que acota el desenfoque de la preview (4 / 20 / sin tope) y de las miniaturas; el export conserva siempre el valor completo.
- **Selector** en el panel de efectos con estado `aria-pressed`.
- **Pruebas**: **1.543/1.543 frontend en 198 archivos**, **486 Rust + 59 ignored**, typecheck y build OK.

### Added — Keyframes de efectos (2026-10-30)
- **Brillo, contraste y saturación animables** con keyframes en el clip (`effectKeyframes`), easing lineal/ease/hold y Bézier opcional, validados contra el rango y la duración.
- **Paridad**: la preview muestrea el look en el playhead, el frame nativo reubica los keyframes al recortar y el export emite `sendcmd` sobre `eq@efx` con la rampa muestreada.
- **UI**: alta en el playhead, edición de frame/valor/easing y borrado con undo; los keyframes se copian con los atributos del clip.
- **Desenfoque animable**: `blur` se suma a los keyframes con `gblur@efx` + `sendcmd`; E2E real sobre tablero de ajedrez con caída de detalle verificada.
- **Verificación**: **1.546/1.546 frontend en 199 archivos**, **487 Rust + 60 ignored**, typecheck y build OK; E2E real de brillo y blur animados.

### Added — Registro de efectos y panel profesional (2026-10-30)
- **Registro tipado**: el catálogo real de Rust se enriquece con versión, motor de preview (`css`/`none`), motor de export (`ffmpeg`), requisitos, licencia MIT, tipos de clip y estado (`available`, `export-only`, `requires-file`, `manual`).
- **Aplicación validada**: defaults, lectura de objetos anidados (glow/motionBlur), clamp de rangos, redondeo de enteros y validación con `ClipEffectsSchema`; si falla, conserva el estado previo.
- **Panel**: buscador, categorías, favoritos y recientes en `localStorage`, editor de parámetros, restaurar y aplicar a todos los clips seleccionados, con undo real.
- **Catálogo**: glow, motionBlur, denoise y fade ahora exponen parámetros; el catálogo local de respaldo también declara rangos.
- **Portapapeles y arrastre**: copiar/pegar/quitar efectos con undo, arrastrar presets a la timeline y seleccionar pistas completas para aplicar en lote.
- **Miniaturas reales**: cada efecto se previsualiza con su filtro CSS sobre una muestra, usando el mismo `effectsToCss` de la preview.
- **Pruebas**: **1.530/1.530 frontend en 196 archivos**, **484 Rust + 58 ignored**, typecheck y build OK. E2E de barrido en 720p24, 1080p60 y 4K24.

### Added — Transiciones profesionales con paridad preview/export (2026-10-30)
- **Preview en vivo**: el clip entrante aparece durante el lead y aplica disolvencia, fundidos, deslizamientos y barridos; antes el corte se veía seco y no coincidía con el MP4.
- **Cuatro barridos nuevos** (`wipe-left/right/up/down`) en esquema, JSON Schema, catálogo Rust, catálogo local, presets y selector del Inspector.
- **Export**: máscara de alfa con `geq` y `enable` limitado al solape; `crop` no acepta `w/h` por frame. Frame nativo congelado con `wipe` + `progress`.
- **Paridad**: `fade-black` del frame nativo deja de multiplicar el alfa (el export lo mantiene opaco); el material del clip entrante se lee antes de su inicio, como el recorte del export.
- **Pruebas**: **1.499/1.499 frontend en 191 archivos**, **483 Rust + 57 ignored**, typecheck OK. E2E real de dos videos con barrido (`EDITOR_IA_RUN_RENDER_TESTS=1`): ffprobe 2,0 s y muestreo de píxeles en 0,4/0,75/0,9 s correcto.
- **Rendimiento medido** (1080p, 30 fps, 3 s, mismo equipo): 1.144 ms base vs 2.838 ms con un barrido de 1 s.
- Auditoría y matriz de licencias en `docs/EFFECTS-MOTION-AUDIT.md`; GSAP excluido sin aprobación legal y GL Transitions no incorporado (licencia por shader sin resolver).

### Added — Extracción de diseño desde URL (2026-10-29)
- **Design Extract URL**: comando Rust `design_extract_url` que descarga HTML/CSS acotados (2 MB HTML, 512 KB por hoja, 3 hojas), extrae colores hexadecimales y `font-family` y devuelve título.
- **SSRF**: sólo http/https, bloqueo de localhost, `.local`, IPs privadas/loopback/link-local, credenciales y redirecciones a redes privadas; timeout 20 s.
- **UI**: modo **URL** en el extractor de paleta, con título, swatches y tipografías detectadas; aplica la paleta a Miniaturas/Motion y copia tokens.
- **Verificación real**: `https://example.com` → título correcto y 2 colores; unit tests de parser, título/hojas y bloqueo de hosts. Suites: **1488/1488 frontend en 190 archivos**, **483 Rust + 56 ignored**, build y audit OK.

### Added — Auditoría de cobertura Open Design (2026-10-29)
- **`npm run audit:open-design`**: 2.391 comprobaciones de conteos, archivos, licencias, previews, fuentes OFL y ausencia de scripts/URLs remotas/extensiones ejecutables. Resultado: 0 fallos, 2.743 archivos, 30,5 MB.
- Se eliminaron los `scripts/` de las skills comunitarias: quedan como referencia documental, no como código.
- El comando forma parte de `npm run verify`; tabla completa en `docs/OPEN-DESIGN-COVERAGE.md`.

### Added — Brief guiado (Discovery Question Form) (2026-10-29)
- **Construir brief**: cuatro preguntas (qué es, para quién, qué debe lograr, tono/restricciones) componen el brief en el campo real, sin IA ni red. Se habilita con las tres primeras y el texto queda editable.
- **Pruebas**: **1487/1487 frontend en 190 archivos**, **480 Rust + 55 ignored**, build y audit OK.

### Added — Aplicar paleta de una dirección (2026-10-29)
- Cada tarjeta de dirección ofrece **Aplicar paleta**: persiste acento, fondo y texto en la selección de Miniaturas/Motion; no cambia el sistema activo del generador.
- Test de UI verifica `localStorage` con `direction-cobalto-editorial` y `#d8000f`.

### Added — Handoff de diseño (2026-10-29)
- **Copiar handoff**: Markdown con sistema, formato, brief, dirección elegida, modelo, tamaño del HTML, tokens CSS reales, tipografías, paleta y reglas de craft.
- Se copia al portapapeles; no crea archivos ni inventa métricas. Error si los tokens no se pueden leer.
- **Pruebas**: **1486/1486 frontend en 190 archivos**, **480 Rust + 55 ignored**, build y audit OK.

### Added — Edición del diseño por instrucción (2026-10-29)
- **Patch Edit**: campo **Ajustar con una instrucción** en el resultado; reenvía el HTML anterior + la instrucción como receta a `design_generate` y reemplaza la preview con la versión editada, conservando brief, sistema, craft y formato.
- Límite de 60 000 caracteres del HTML anterior, errores del proveedor visibles y limpieza del campo al aplicar; sin ejecución de scripts.
- **Pruebas**: **1485/1485 frontend en 190 archivos**, **480 Rust + 55 ignored**, build y audit OK; el flujo está cubierto por test de UI.

### Added — Extracción local de paleta desde imagen (2026-10-29)
- **Design Extract local**: botón **Extraer paleta** en Diseño. La imagen se procesa en canvas 128×128, se agrupan colores por cubos RGB, se fusionan cercanos y se eligen hasta 5 dominantes con acento y contraste calculados. Sin red, modelos ni scripts.
- **Acciones**: aplicar la paleta a miniaturas/Motion usando la misma selección persistida y copiar tokens CSS. No detecta tipografías.
- **Medición real**: captura de Olyvia → 5 colores, acento `#edb5b6`, sin errores de consola; `localStorage` guardó `paleta-extraida`. [Captura](docs/screenshots/olyvia-palette-extract-2026-10-29.png).
- **Pruebas**: 3 tests del cuantizador y 1 de apertura/cierre del modal. Suites: **1484/1484 frontend en 190 archivos**, **480 Rust + 55 ignored**, build y audit OK.

### Added — Direcciones visuales con Direction Picker (2026-10-29)
- **3 direcciones distintas**: comando Rust `design_directions` que convierte el brief en tres propuestas con nombre, concepto, paleta hexadecimal, tipografías, layout y justificación. El parser tolera prosa previa, valida colores y rechaza respuestas sin JSON utilizable.
- **UI en el generador**: botón **Proponer 3 direcciones**, tarjetas con swatches y elección de una como receta; el diseño se genera con esa dirección.
- **Medición real**: FreeLLMAPI `auto` devolvió 3 direcciones (Minimalist White · Bold Gradient · Dark Neon) con 6 000 tokens; con 1 800/3 000 el modelo razonaba antes del JSON y la app mostraba el error real. El límite quedó en 6 000.
- **Pruebas**: **1480/1480 frontend en 189 archivos**, **480 Rust + 55 ignored**, build y audit OK; el test live de direcciones queda ignorado por defecto.

### Added — Revisión de diseño Critique Theater (2026-10-29)
- **Criticar diseño** en el generador: comando Rust `design_critique` que envía el HTML y el brief al proveedor real y devuelve una revisión en prosa de cinco dimensiones (craft, problema, marca, accesibilidad, copy), con hallazgos por severidad y arreglo sugerido.
- Límites de 60 000 caracteres de HTML y 1 600 tokens; confirmación de cuota para proveedores no locales; errores del proveedor visibles.
- Medición real: FreeLLMAPI `auto` devolvió **3 553 caracteres** en **14,1 s**; test live ignorado por defecto. La UI se cubre con servicio falso.
- **Corregir con la crítica**: el botón reenvía el HTML anterior más la crítica como receta al generador y muestra la versión corregida; el bucle está cubierto por test de UI.
- **Pruebas**: **1479/1479 frontend en 189 archivos**, **478 Rust + 54 ignored**, build y audit OK. Se estabilizaron los helpers de navegación de Motion/Lottie con reintentos ante el cierre del menú avanzado.

### Added — Ejemplos oficiales de Open Design (2026-10-29)
- **55 recetas de decks y páginas**: `fs-*`, `hps-*`, `huashu-*`, `ve-*`, `velar-*`, `article-magazine`, `blog-post`, `critique` y otros se suman como plantillas de diseño (154 en total). El generador las abre con el formato correcto, incluido deck.
- **45 referencias de ejemplos con runtime**: `motion-*`, `webgl-*`, la homepage y los endpoints de plugins quedan como skills de solo lectura, sin botón de generador; se copian únicamente `SKILL.md` y `LICENSE`, no scripts, videos ni assets.
- **Auditoría**: 201 ejemplos comparados contra las plantillas/skills incluidas; 100 se suman con licencia declarada y 101 ya estaban cubiertos. La biblioteca queda en **154 plantillas y 131 skills**.
- **Pruebas**: Playwright verificó `huashu-slides` como receta de deck y `webgl-aurora-veil` como referencia sin generador. Suites: **1478/1478 frontend en 189 archivos**, **477 Rust + 53 ignored**; build y audit OK.

### Added — Scenarios y atoms oficiales de Open Design (2026-10-29)
- **27 flujos oficiales**: 14 scenarios y 13 atoms (MIT) copiados completos como referencia de solo lectura en la biblioteca de Diseño (86 skills en total). Incluyen Critique Theater, Design Extract, Direction Picker, Handoff, Token Map, migraciones y exportaciones.
- No se ofrecen como receta del generador y no ejecutan código; conservan `SKILL.md`, referencias y contratos. La búsqueda y el detalle muestran su categoría (`Open Design · scenario/atom`) y licencia MIT.
- **Verificación**: Playwright abrió Critique Theater, confirmó categoría, licencia y ausencia del botón de generador, sin errores de consola. [Captura](docs/screenshots/olyvia-open-design-workflows-2026-10-29.png). Suites: **1478/1478 frontend en 189 archivos**, **477 Rust + 53 ignored**.

### Added — Skills comunitarias MIT y fix del generador (2026-10-29)
- **Hallmark y Humanize PPT**: las dos skills comunitarias de Open Design con licencia MIT se copian completas (SKILL.md, referencias, contratos y LICENSE). La biblioteca pasa a **59 skills**; Hallmark se ofrece como receta de diseño y Humanize PPT como receta de deck.
- **Fix real**: buscar una skill o plantilla dejaba la lista filtrada de sistemas vacía y el botón **Usar en generador** no abría nada. El generador ahora usa un sistema del catálogo completo, independiente del filtro; se agregó una prueba de regresión.
- **Verificación real**: Playwright abrió Hallmark, cargó su receta en el generador y mostró Humanize PPT, sin errores de consola. Captura: [skills comunitarias](docs/screenshots/olyvia-community-skills-2026-10-29.png).
- **Licencias**: MIT de Hallmark contributors y LearnPrompt, con LICENSE incluido; 6 plugins comunitarios sin licencia y 2 de andamiaje quedaron fuera (120 skills excluidas).
- **Pruebas**: **1478/1478 frontend en 189 archivos**, **477 Rust + 53 ignored**, build y audit OK; la suite completa se corrió dos veces verde.

### Added — HyperFrames y plantillas IA de Open Design (2026-10-29)
- **45 plantillas de imagen y 40 de video**: los plugins oficiales de Open Design suman prompts nuevos a la biblioteca (189 en total, 144 CC-BY-4.0, 44 Apache-2.0 y 1 MIT). Se buscan y filtran igual que las demás; las de imagen abren **Imagen IA** con el prompt cargado y las de video se envían como **brief a Guion**.
- **13 composiciones HyperFrames**: HTML/CSS con animaciones `@keyframes` y fuentes locales (Apache-2.0, derivadas de frontend-slides MIT), con preview en vivo sin scripts. Otras **9 composiciones con scripts/GSAP** se incluyen como **preview MP4 oficial** (Apache-2.0/MIT, sin audio) para ver, guardar, enviar a Medios y montar, sin ejecutar su runtime; la variante Remotion quedó fuera.
- **Render real sin Chrome**: captura por **SVG foreignObject** con estilos computados horneados y animaciones congeladas, codificada a MP4 VP9 con WebCodecs. Se eligió SVG porque el clon de html2canvas perdía las fuentes y el estado de la animación. Medición: Bold Poster **1920×1080, 3 s, 15 fps, 682.851 B en 3,0 s**; `ffprobe` confirma VP9/15 fps/3,000 s y los frames de 0,1/0,8/2,8 s son distintos. Los 13 templates se capturaron a 5 s (59–400 ms/frame) sin errores.
- **UI**: pestaña **HyperFrames** con lista de 13 previews, detalle con preview viva escalada, duración (3–15 s), fps (15/30), guardar MP4, enviar a Medios y montar en la timeline. La barra de búsqueda de la biblioteca ya no se duplica en esta pestaña.
- **Licencias/avisos**: fuentes Google Fonts OFL-1.1; HyperFrames Apache-2.0; avisos actualizados en `THIRD-PARTY-NOTICES.md`, el bundle y el `NOTICE.md` generado.
- **Pruebas**: 9 tests nuevos de HyperFrames (4 de render/carga y 5 de UI), 1 test de handoff a Guion y 1 de la pestaña; 45 tests de Diseño. Suites: **1478/1478 frontend en 189 archivos**, **477 Rust + 53 ignored**. Verificación real con Playwright en 1440×980, sin overflow ni errores de consola.

### Added — Imagen IA real (2026-10-29)
- **Texto a imagen**: comando Rust `design_generate_image` con dos fuentes: la API libre de Pollinations y el endpoint `/v1/images/generations` del proveedor de Ajustes → IA. Acepta `b64_json`, URL firmada y data URI; valida firma PNG/JPEG/WebP, mide dimensiones desde la cabecera y rechaza archivos de más de 24 MB.
- **UI**: pestaña **Imagen IA** en la biblioteca de Diseño, con prompt, presets, tamaño, modelo, semilla, proveedor, vista previa, guardado nativo, envío a Medios y montaje en la timeline. Cualquier plantilla de prompt puede enviarse con **Generar imagen**.
- **Medición real**: Pollinations devolvió un JPEG **512×512 de 45.163 bytes** en **6,9 s** (test Rust live con `EDITOR_IA_RUN_RENDER_TESTS=1`). El gateway local no tenía proveedores de imagen válidos en esta corrida: Vercel respondió 403 por falta de tarjeta y Cloudflare 401 por clave inválida; la app muestra esos errores sin simular resultados.
- **Pruebas**: 4 tests Rust de cabeceras/encoding/endpoint/errores + 1 test live, 7 tests de UI del generador de imágenes, 1 test de la biblioteca y servicio falso actualizado. Suites: **1468/1468 frontend en 187 archivos**, **477 Rust + 53 ignored**.
- **Aviso**: Pollinations es un servicio externo opcional; no se distribuye su código y el prompt sólo se envía cuando el usuario elige esa fuente.

### Added — Generador de diseños Open Design (2026-10-29)
- **Brief → HTML autocontenido**: comando Rust `design_generate` con el proveedor real de Ajustes → IA (FreeLLMAPI/BYOK), timeout de 180 s y hasta 8 192 tokens. Cinco formatos: página responsive, dashboard 1440×900, deck 1280×720, tarjeta 1080×1080 y miniatura 1280×720.
- **Puerta de seguridad**: extracción del documento aunque venga con fences o texto alrededor, tope de 160 000 caracteres y rechazo de `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `@import`, recursos `http(s)`, `javascript:` y atributos `on*`. La preview corre en `iframe sandbox=""`.
- **UI**: modal accesible con sistema activo, formato, brief acotado a 4 000 caracteres, reglas de craft sugeridas, preview, copia del HTML y guardado con diálogo nativo (`save_design_html`, sin requerir un proyecto abierto). Foco atrapado, Escape y restauración del foco anterior.
- **Motion**: la paleta del sistema aplicada a Miniaturas también aparece en el formulario de motion graphics y, con un clic, escribe fondo, acento y color de texto en los campos reales de la plantilla. La salida sigue siendo el render ASS/FFmpeg de siempre.
- **Ronda real**: FreeLLMAPI `auto` respondió en **26,7 s** con **4 022 caracteres** de HTML seguro para una tarjeta de taller; render 1080×1080 sin scripts ni recursos externos. Evidencia: [formulario](docs/screenshots/olyvia-design-generator-2026-10-29.png) y [diseño generado](docs/screenshots/olyvia-design-generated-2026-10-29.png).
- **Pruebas**: 9 tests Rust del comando (extracción, sanitización, nombre de archivo, formato, firmas PNG/MP4/PDF) + tests de UI del generador, Motion, plantillas y skills. Suites finales: **1468/1468 frontend en 187 archivos**, **477 Rust + 53 ignored**, build y `audit:licenses` OK. Sin proveedor configurado, la app muestra el error real; no hay salida simulada.

### Added — Decks a PDF (2026-10-29)
- **Deck multi-diapositiva**: el formato Deck ahora pide 3–6 secciones `<section data-slide>` de 1280×720. La UI exporta un PDF real con una página por sección usando html2canvas + jsPDF 2.5.2 (MIT), sin Chrome.
- **Medición real**: HTML de 4 diapositivas → PDF de **4 páginas, 107.152 bytes**, cabecera `%PDF-1.3` y 4 objetos `/Type /Page`, sin errores de consola. Se corrigió el fondo heredado del `body`: las secciones transparentes ya no dejan texto claro sobre blanco. Evidencia: [PDF](/D:/Users/ofici/QODER-WORK/editor-ia/docs/screenshots/olyvia-design-deck-2026-10-29.pdf).
- **Guardado**: `save_design_pdf` valida `%PDF-` y el tope de 100 MB, con diálogo nativo y nombre saneado. Botones «Exportar PDF» y «Guardar PDF» sólo para decks.
- **Pruebas**: 1 test de UI del flujo PDF y 1 test Rust de firma PDF. El video respeta ahora duración (3/5/8 s) y fps (15/30) elegidos en el formulario; el test del MP4 verifica 5 s/30 fps.
- **Video de decks**: el MP4 recorre todas las secciones `data-slide` como escenas, con zoom y **deslizamiento lateral** entre ellas (sin texto fantasma). Medición real: **4 escenas, 1280×720, 2 s / 10 fps, 156.680 bytes**, sin errores. El PNG sigue capturando la primera diapositiva; PDF y MP4 contienen todas. [MP4](/D:/Users/ofici/QODER-WORK/editor-ia/docs/screenshots/olyvia-design-deck-video-2026-10-29.mp4) y [frame](/D:/Users/ofici/QODER-WORK/editor-ia/docs/screenshots/olyvia-design-deck-frame-2026-10-29.png).

### Added — Diseño a Medios (2026-10-29)
- **PNG/MP4 al proyecto**: `stage_design_media` escribe el archivo validado en `<proyecto>/media` y `importMediaPaths` lo registra como material real con derechos confirmados; el asset se agrega con `addAsset`. Funciona sin diálogo de guardado y sin copiar dos veces.
- **UI**: «Enviar PNG a Medios» y «Enviar MP4 a Medios» en el generador, habilitados sólo con un proyecto abierto; el aviso confirma el label importado.
- **Montar en la timeline**: tras importar, «Montar en la timeline» usa `addClipFromAsset` en el playhead, crea la pista compatible si falta, cierra el generador y abre el editor. El diseño queda listo para editar/exportar, no sólo en Medios.
- **Pruebas**: flujo de envío + montaje cubierto en el test del generador (stage + import + addAsset + navegación al editor); **prueba Rust real** con proyecto temporal, `stage_media_file` y `import_file` + FFprobe: el PNG 1×1 se importa como `image` y la ruta queda relativa (`media/…png`). Firmas PNG/MP4 testeadas.

### Added — Video MP4 desde los diseños (2026-10-29)
- **HTML → MP4**: WebCodecs del WebView2 codifica **VP9** y `mp4-muxer 5.2.1` (MIT) muxea un MP4 real. Sin Chrome, sin GSAP y sin scripts: el generador pide CSS puro y las animaciones CSS se pausan y avanzan frame a frame.
- **Salida real**: 1080×1080, **3 s, 15 fps, 756.178 bytes**, generado en **4,4 s**; `ffprobe` confirma VP9, 15/1 y duración 3,000 s. Un zoom de entrada leve compone movimiento incluso en diseños estáticos; no recorta los bordes.
- **UI**: «Crear video 3 s» y «Guardar MP4» en el generador, con preview `<video>` y métricas visibles. `save_design_video` valida la firma `ftyp` y el límite de 200 MB.
- **Pruebas**: 1 test de UI del flujo MP4 + 1 test Rust de firma MP4. Evidencia: [MP4](/D:/Users/ofici/QODER-WORK/editor-ia/docs/screenshots/olyvia-design-video-2026-10-29.mp4) y [frame](/D:/Users/ofici/QODER-WORK/editor-ia/docs/screenshots/olyvia-design-video-frame-2026-10-29.png).
- **Límite declarado**: H.264 no está soportado por WebCodecs en este equipo; se usa VP9 dentro de MP4. Las animaciones con JavaScript/GSAP (HyperFrames completo) siguen fuera de alcance.

### Added — PNG real de los diseños (2026-10-29)
- **HTML → PNG sin Chrome externo**: el diseño seguro se monta en un `iframe sandbox="allow-same-origin"` (CSS de Olyvia aislado, `vh`/media queries contra el lienzo real) y se rasteriza con **html2canvas 1.4.1 (MIT)** dentro del WebView2. Se descartó Chrome headless: en esta máquina delega en la instancia abierta y no captura.
- **Salida real**: PNG 1080×1080 de 95.135 bytes desde el HTML generado por FreeLLMAPI, con fondo, badge y CTA correctos; `save_design_png` valida la firma IHDR y guarda con diálogo nativo.
- **UI**: «Renderizar PNG» y «Guardar PNG» en el generador, con preview real, errores claros y aviso de que no se ejecutan scripts. El generador ahora pide **flexbox** para que html2canvas no tenga que reproducir CSS grid.
- **Pruebas**: 1 test de UI del flujo PNG (mock del rasterizador + guardado) y 1 test Rust de dimensiones/firma PNG.
- Evidencia: [PNG real](/D:/Users/ofici/QODER-WORK/editor-ia/docs/screenshots/olyvia-design-generated-png-2026-10-29.png).

### Added — Skills de Open Design (2026-10-29)
- **57 skills** con licencia verificable (31 MIT, 2 Apache-2.0 y 24 Open Design/Apache-2.0); 112 quedaron fuera por copyleft o upstream sin licencia. Se conserva `LICENSE`, `SKILL.md`, ejemplo y enlace de origen.
- **37 skills de diseño** (prototipo, deck, imagen, diseño, sistema de diseño, plantilla) se ofrecen como receta del generador; las 20 de modo `utility` quedan como referencia y no se envían al generador.
- **3 previews offline seguras** de 57; el resto muestra el aviso sin iframe roto. La detección ahora revisa **todos los HTML del paquete**, no sólo `example.html`: 23 de 99 plantillas y 3 de 57 skills son previewables.
- **UI**: pestaña Skills con buscador, filtros por modo, lectura/copia del `SKILL.md`, licencia y fuente. Capturas: [skills](docs/screenshots/olyvia-design-skills-2026-10-29.png) y [skill como receta](docs/screenshots/olyvia-design-skill-generator-2026-10-29.png).
- **Pruebas**: +1 test de la pestaña y del uso como receta (24 tests de Diseño).

### Added — Plantillas de diseño como recetas (2026-10-29)
- **99 plantillas** de `design-templates/` importadas con licencia verificable (63 Open Design/Apache-2.0 + 36 MIT). Se excluyeron 16 por licencia copyleft o por depender de un upstream sin licencia declarada. Cada receta conserva su `LICENSE` y enlace de origen.
- **Recetas en el generador**: «Usar en generador» carga el `SKILL.md`, abre el brief con el formato correcto (deck → Deck, imagen → Tarjeta) y lo envía como contexto al comando `design_generate`. La UI muestra la receta activa.
- **Previews honestas**: sólo 23 de 99 ejemplos no cargan scripts ni recursos remotos y se previsualizan en sandbox; el resto muestra la receta y el código con un aviso explícito, sin iframes rotos.
- **Catálogo**: buscador, filtros por tipo (prototipo, deck, imagen, video, audio, plantilla) y detalle con licencia, plataforma, escenario y etiquetas. Capturas: [plantillas](docs/screenshots/olyvia-design-templates-2026-10-29.png) y [receta en el generador](docs/screenshots/olyvia-design-template-generator-2026-10-29.png).
- **Importador**: `scripts/sync-open-design.mjs` ahora copia `templates/`, valida licencias, detecta previews seguras y suma los contadores al `catalog.json` y al aviso generado (16,4 MB, 2 035 archivos).
- **Pruebas**: +3 tests (filtro/orden de plantillas, pestaña con preview y receta, envío de la receta al proveedor).

### Added — Biblioteca Open Design (2026-10-29)
- **Creador → Diseño**: nueva superficie con **152 sistemas de diseño**, **11 reglas de craft** y **104 plantillas de prompt** importadas de [Open Design](https://github.com/nexu-io/open-design) (Apache-2.0). Buscador, categorías traducidas, paleta real, `DESIGN.md` renderizado, previews y componentes en `iframe` con sandbox.
- **Puente con Miniaturas**: «Usar en miniaturas» aplica el acento sólido del sistema, lo persiste en `editoria.design-system.v1`, lo anuncia por `olyvia:design-applied` y muestra la paleta activa junto al canvas; el PNG exportado usa el mismo color.
- **Importador reproducible** `scripts/sync-open-design.mjs` + `npm run sync:open-design`: checkout disperso, copia sólo el contrato (`manifest.json`, `DESIGN.md`, `tokens.css`, componentes y previews), resuelve paletas, excluye 2 prompts sin licencia reutilizable y genera `catalog.json`, `NOTICE.md` y `LICENSE` (17 MB, 1 787 archivos).
- **Atribución**: avisos de Apache-2.0, CC-BY-4.0 (72 prompts), Apache (31), MIT (1), `refero_skill` (MIT) y marcas de terceros en `THIRD-PARTY-NOTICES.md` y en el aviso del bundle.
- **Navegación**: `design` resuelve al hub Creador; deep link `?view=design`; pestaña propia, sin duplicar superficie en el rail.
- **Límite declarado**: no se copiaron el runtime, plugins ni skills de Open Design; HyperFrames y los design templates quedan para la fase siguiente. Detalle y reproducción en [docs/OPEN-DESIGN.md](docs/OPEN-DESIGN.md).
- **Verificación**: 27 tests de Diseño (17 de biblioteca + 7 del generador + 3 de plantillas + 1 de skills); Playwright real contra Vite (152 sistemas, preview `colors.html`, aplicación a miniaturas `#60a5fa`, craft y prompts sin errores de consola) en 1440 y 860 px. Capturas: [biblioteca](docs/screenshots/olyvia-design-library-2026-10-29.png), [miniaturas](docs/screenshots/olyvia-design-thumbnails-2026-10-29.png), [craft](docs/screenshots/olyvia-design-craft-2026-10-29.png), [angosto](docs/screenshots/olyvia-design-narrow-2026-10-29.png).

### Changed — UX Studio (2026-10-29)
- Studio con paneles redimensionables y accesibles (biblioteca, inspector, timeline), colapso/restauración, modos de visor y timeline ampliados, y restauración del diseño; tamaños persistidos en las preferencias del editor.
- Conmutador global Inicio/Ingesta/Crear/Studio en la barra superior cuando el rail está oculto por el modo inmersivo.
- Ingesta con tira de pasos del flujo y errores junto al origen, no al final de la columna lateral.
- Visor con estados de medio no disponible específicos por asset, causa, ruta de reconexión y reintento accesible.
- Inspector contextual: guía cuando no hay selección, Procedencia plegada y badge de selección traducido. Evidencia: [Inspector](docs/screenshots/olyvia-studio-inspector-context-2026-10-29.png).
- Ingesta: `IngestSteps` como componente propio con pasos clicables hacia origen, opciones, cola y resultado; contraste de tokens y foco visible compartido; retiro de `app/workspaces.ts` sin consumidores.
- Accesibilidad: pestañas de Medios con roving tabindex/flechas/Home/End, selección del clip superior con Enter/Espacio en el lienzo y panel del asistente acotado a la ventana en ≤900 px.
- Inicio verificado a 900×600 en app real: [captura](docs/screenshots/olyvia-narrow-start-2026-10-29.png). Studio angosto queda pendiente por aislamiento de ventanas WebView2.
- QA visual en app real: [Studio](docs/screenshots/olyvia-studio-layout-2026-10-29.png) y [timeline ampliada](docs/screenshots/olyvia-studio-timeline-focus-2026-10-29.png).

### Removed — Proveedor simulado (2026-10-29)
- Se eliminó el proveedor `mock` de toda la app: opción “Simulado” en Ajustes, botón “Usar proveedor simulado”, planes/respuestas/traducciones/motion/efectos simulados y sus ramas en Rust.
- Guion, Asistente, Localización, Motion, Efecto IA, Fábrica y traducción de descargas ahora requieren un endpoint OpenAI-compatible real y muestran un error claro si falta.
- Se retiraron los componentes demo no montados (`PremiumAuthDemo`, `PremiumCardDemo`, `PremiumInputDemo`, `PremiumComponentShowcase`, `ButtonDemo`).
- Verificación: 1426/1426 frontend, 464 Rust + 49 ignored, build y licencias OK.

### Added — SpeedCurve + Frame real compuesto (2026-10-29)
- **`speedCurve` con consumidores reales**: tabla canónica TS/Rust (`state/time-remap.ts`, `render/time_remap.rs`) con fixture compartido; preview e Inspector muestrean la curva y el export emite un `setpts` por frame de origen más `fps=…:round=near` (o `minterpolate` con `opticalFlow`). Medición con 100 frames sintéticos: 100 frames de salida, 89 exactos y 11 a ±1 frame. La expresión se agrupa para respetar el límite de ~99 `if` de FFmpeg (test vivo de 120 frames). El audio del clip usa `atempo` medio; la curva exacta se aplica sólo al video. Guardas para reverse, estabilización, Ken Burns, keyframes de transform/máscara y transición de entrada; las curvas viejas se normalizan a la ventana y siguen abriendo.
- **Frame real con gráficos**: el compuesto incluye clips gráficos con su plan de motion (camino completo para conservar el tiempo del ASS). El frontend envía `motionPlans`, la imagen se invalida con cualquier cambio de proyecto y el fallback “sin títulos” desaparece. Prueba real 320×180 con título: 0,77 s.
- Repos MIT evaluados para LUT interactivo (`glsl-lut`, `three.js`, `cube-lut.js`): ninguno justifica una dependencia nueva para este lote; el compuesto usa el FFmpeg ya bundleado.

### Fixed — Cierre de auditoría (2026-10-29)
- **IA multiproveedor muerta retirada**: se eliminaron `useAiClient`, `AiSettingsPanel`, `types/ai`, `src/tasks/ai_commands.rs`, `src/task.rs`, el módulo Rust `ai/` y `state.ai_client`, que invocaban comandos inexistentes y nunca se montaban. La ruta viva (Ajustes → IA con proveedor OpenAI-compatible/simulado y Keyring, AI Hub y operador local) no cambia. Respaldo en `D:\DevCache\olyvia-removed-2026-10-29\dead-ai\`.
- **Voice isolation no integrada retirada**: `voice-isolation.rs` no estaba declarado y su filtro devolvía un `silence` de relleno; se eliminó con el wrapper Demucs no instalado. La mejora real de diálogo sigue siendo la cadena FilmCraft DSP. Respaldo en `D:\DevCache\olyvia-removed-2026-10-29\dead-voice-isolation\`.
- **Culling de Timeline**: sólo se montan los clips y subtítulos dentro de la ventana visible más 1,5 s de overscan; el hint de “Pista vacía” consulta el proyecto completo. Nuevo `visible-range.ts` con tests de rango y de scroll real.
- **Automatización de fader en la preview**: el grafo Web Audio muestrea `gainKeyframes` con `sampleTrackGain` (easing/Bézier/clamp idénticos al export) además del paneo; sin claves vuelve al knob estático.
- Documentación ajustada: la cola marca lo cerrado y separa los pendientes reales (`speedCurve`, LUT en preview, HDR/10-bit del editor, `render-worker`, separación de fuentes).

### Added — Motion MIT (2026-10-29)
- **Biblioteca de Medios virtualizada** (`@tanstack/react-virtual`, MIT): filas responsivas con medición dinámica, `scrollMargin`, `directDomUpdates`, `useFlushSync:false` y `overscan:3`; con 300 assets se montan ≤30 tarjetas y se encolan ≤30 miniaturas, no todas. Medición Tauri/WebView2: **600/750/900 px → 1/2/2 columnas y 59–61 FPS** en idle, scroll normal y extremo; 600 px es viewport emulado (mínimo nativo 760 lógicos). En 1266 px: 12 tarjetas/4 filas al abrir; heap JS ~57 MB.
- **Metadatos de audio** (`lofty`, MIT/Apache-2.0): título, artista, álbum y BPM se leen al importar sin fallar el import; campos opcionales del esquema y visualización en el Inspector. Sin carátulas persistidas.
- **Selector de color** (`react-colorful`, MIT) en MotionForm: popover accesible, hex validado, presets de marca, cierre por Escape/click fuera y sin cambios de semántica de props.
- **Fuentes instaladas** (`fontdb`, MIT): comando `list_system_fonts` con caché y datalist en el estilo de subtítulos; el texto libre sigue permitido para alias.
- Biblioteca Motion con **52 iconos Lottie MIT** de `react-useanimations` (incluye 11 logos de marcas): 12 empaquetados offline y 40 descargables bajo demanda desde `raw.githubusercontent.com`.
- Soporte de packs **`.lottie`** (ZIP): `manifest.json`, `animations/*.json` e imágenes embebidas como data URLs. Límites de 8 MB comprimido, 200 entradas y 32 MB descomprimido; rutas con `..` o imágenes remotas se rechazan. Temas, state machines y audio se cargan o avisan según corresponda.
- **Themes dotLottie**: archivos `t/*.json` con reglas por Slot ID (`sid`); aplica Color, Scalar, Position, Vector y Text, con keyframes, filtro por animación y `initialTheme`. Gradient/Image y expresiones se avisan y se omiten.
- **State machines dotLottie**: archivos `s/*.json`; states Playback/Global, transiciones/guards Boolean/Numeric/String/Event, acciones de inputs/theme/frame y segmentos por estado. La preview permite cambiar inputs y el export usa el estado/segmento activo. Puntero/OnComplete no se simulan; Tweened se aplica inmediato y modo/velocidad distintos de Forward/1× se avisan.
- Catálogo reproducible con `scripts/generate-motion-catalog.mjs` (SHA-256 y tamaño por asset) y atribución MIT incluida; los iconos con expresiones incompatibles con la CSP se omiten con aviso (`twitter` en la fuente actual).
- Comandos Rust `motion_download`, `motion_read_cached`, `motion_list_cached`, `motion_cache_stats`, `motion_cache_dir` y `motion_remove_cached`: allowlist de host/repo, HTTPS, límite de 512 KB, hash obligatorio y escritura atómica en `AppData`.
- `rasterizeLottieToAsset` compartido entre el importador Lottie y la biblioteca; preview y export usan el mismo motor.
- `planLottieExport` acepta `scale` (1–32×) para agrandar iconos de 32 px a 512 px sin pérdida.

### Fixed — Auditoría completa (2026-10-29)
- Atajos globales bloqueados cuando hay un diálogo modal abierto: Delete/Ctrl+D/S ya no editan el clip de fondo con Configuración o la paleta abiertas.
- Ajustes abre la sección pedida: Licencia desde ProLock y Proveedor desde AI Hub; antes siempre caía en Apariencia.
- AI Hub “exportar” navega al editor antes de pedir el diálogo; antes aceptaba la acción sin mostrarla.
- SFX “+ Agregar” ahora es “Buscar en Medios” con aviso honesto, en vez de simular una biblioteca inexistente.
- Paleta de comandos con nombre accesible.
- Tamaños menores a 1 KB se muestran en bytes (`246 B`), no `0 KB`.
- Errores al “Mostrar en carpeta” ya no se silencian (Denoise, Director, Localización).
- “Timeline 01” es una etiqueta estática, no un tab muerto.

### Fixed — Motion MIT (2026-10-29)
- Build de desarrollo reparado: `lib.rs` registraba `tasks::ai_commands` inexistentes; el binario Tauri vuelve a arrancar. El cliente AI multiproveedor queda pendiente de backend.
- Módulo `ai/` reparado para volver a compilar: providers con URL/auth en el trait, `Arc` en el router, imports de tipos corregidos y parsing de OpenRouter/Custom sin `chrono`.
- Cliente AI TypeScript corregido (`Message`, `JSX`, `exactOptionalPropertyTypes`).
- README con requisitos, estado real y licencia; tests del rail alineados a las 11 superficies vigentes.

### Verificado — 2026-10-29 (SpeedCurve)
- `npm run typecheck` verde; suite raíz **1431/1431 en 180 archivos**; Rust **464 passed + 49 ignored**; build de Vite y auditoría de licencias OK.
- FFmpeg real: remap de 100 frames con `setpts` + `fps` → 100 frames, 88 exactos y 12 desvíos de ±1 frame; compuesto con gráfico 320×180 en 0,77 s.
- Sin commit, push, build Tauri ni instalación sobre la app en uso.

### Verificado — 2026-10-29
- `npm run typecheck` verde; suite raíz **1408/1408 en 177 archivos**; Flow Queue **31/31**; Web TTS **10/10**.
- Rust **460 passed + 47 ignored**; `rustfmt --check` verde en los archivos del ciclo. El check global mantiene deuda de formato previa en 11 archivos ajenos que se restauraron para no contaminar el diff.
- Medición real en Tauri con 300 imágenes 64×64: 600/750/900 px → 1/2/2 columnas, 4–18 tarjetas montadas, 59,3–61,3 FPS idle y 60,1–60,6 FPS en scroll normal/extremo; 600 px emulado (mínimo nativo 760). Evidencia: [600 px](docs/screenshots/olyvia-assets-300-600.png), [900 px](docs/screenshots/olyvia-assets-300-900.png) y [1266 px](docs/screenshots/olyvia-assets-300-virtualized.png).
- `npm run build` OK; `npm run audit:licenses` → `BUNDLE LICENCIAS: OK`.
- Sin commit, push, build Tauri ni instalación sobre la app en uso.

### Added
- Nueva página de licencias en Ajustes → Licencia: estado Free/Pro, día(s) restantes del trial, activación por archivo firmado Ed25519 y desactivación local.
- Trial de 14 días cifrado AES-256-GCM ligado a la máquina; `start_trial` bloquea una sola vez y revoca si vence.
- Modal de activación con opciones: prueba, cargar archivo o desactivar.
- Bloqueo Pro en descarga (límites y códecs), exportación (resolución/códec), Director/Fábrica de Variantes.
- Error boundary visible para herramientas rotas; “Reintentar” o “Ir a Inicio”. Recuperación de sesión interrumpida activa recovery flow.
- Compresión x265 **faster** (antes `medium`): ~28% más rápida en media sintética 1080p/5 s; tamaño final casi igual por CRF.
- Laboratorio de Medios usa `faster` en software; hardware (AMF/NVENC/QSV) ya estaba activo.
- Splash mínimo **450 ms** (antes 900 ms); precarga reducida a 4 vistas (Inicio, Editor, Medios, Descargar).
- Working set de release ~37–39 MB tras abrir, vs 43 MB anterior.

### Fixed
- CRLF normalizados en commits Rust/TS; `.gitignore` ahora ignora `apps/desktop/src-tauri/resources/piper/`.
- Documentación de fases agregada y verificada: golden path, licencias, rendimiento y auditoría legal.
- Assets pesados ignorados (Piper/EONN Runtime) para mantener repo liviano.

### Changed
- UI de licencia muestra Pro/Prueba/Free, email, ID, vencimiento y día(s) restantes; aviso cuando se agota el límite de descargas o exporta perfiles Pro.

## [0.1.0] — 2026-10-28

### Added — Fase 4
- Instalador NSIS firmado con certificado autofirmado: 222.329.952 B, SHA-256 `9D3EDD32…FAE3A1`.
- Ejecutable de release: 37.078.528 B, SHA-256 `3DEB7E45…ACBC`.
- Auditoría de bundle scripts: `scripts/audit-bundle-licenses.mjs` excluye Wav2Lip/checkpoints no comerciales.
- Avisos de terceros en `THIRD-PARTY-NOTICES.txt` embebidos.

### Added — Fase 3
- Estado LicenseState en Rust: firma Ed25519, payload cifrado por máquina, trial 14 días y validación contra clave pública embebida.
- Comandos: `license_status`, `start_trial`, `activate_license`, `deactivate_license`.
- Gating descargas/render/Director/Fábrica: Free limitado; Pro desbloquea 512 descargas, 4K/8K, HEVC, AV1, HDR, SponsorBlock automático.
- Compatibilidad: proyectos creados en Pro se abren/editan en Free; solo la exportación de perfiles Pro pide licencia.

### Added — Fase 2
- Golden path verificado: auto-edit, short 9:16 con subtítulos quemados y fábrica de variantes.
- Hardening: error boundary, recuperación de sesión interrumpida, límites de cola 25 slots y descargas 2 simultáneas Free.
- Compresión x265 faster con medición real: 3,41 s frente a 4,75 s de medium (1080p/5 s).
- Splash 450 ms, precarga reducida; working set optimizado.

### Added — Fase 1
- Navegación de 9 superficies + hubs por tabs (Descargar/Creador/Laboratorio) con routing canónico.
- Editor con modos internos (Timeline/Texto/Multicámara/Mezcla/VFX/Motion/Efectos) y timeline persistente.
- IA fuera del rail; asistente global y ajustes de licencia en Settings.
- Deep links normalizados; paleta actualiza vista al seleccionar tab.

### Fixed
- Limpieza de dist: Vite vacía `dist` por build, sin sourcemaps; frontend pasa de 331 MB/3.642 archivos a 16 MB/65.
- Ignorados actualizados: Piper/ffmpeg/tools/onnxRuntime/Playwright artifacts.
- Tests escritos para nuevas rutas/licencias/trial/error boundaries; suite raíz 1361/166 y escritorio 961/140.

### Changed
- UI: card de licencia con badges Pro/Prueba/Free, botones Activar/Ocultar y aviso de límites.
- Docs generados: [PHASE-2](docs/PHASE-2-GOLDEN-PATH.md), [PHASE-3](docs/PHASE-3-LICENSING.md), [PHASE-4](docs/PHASE-4-COMMERCIAL.md), [LICENSES.md](docs/LICENSES.md), [IMPROVEMENT-QUEUE.md](docs/IMPROVEMENT-QUEUE.md).
- Commit: "feat: Olyvia comercial con licencias, estabilidad y rendimiento" — 230 archivos, ~41k líneas añadidas.

### Security & Compliance
- Audición de licencias: FFmpeg LGPL, yt-dlp Unlicense, ONNX Runtime MIT, Piper MIT, voz CC0. Sin Wav2Lip en bundle.
- Claves privadas fuera del repo (`D:\Users\ofici\QODER-WORK\editor-ia-license-keys`).

## Notas futuras
- Endpoint de licencias: Lemon Squeezy/Gumroad y trial 14 días verificados.
- Auto-updater: manifiesto firmado y pruebas de downgrade.
- Compresión GPU: SVT-AV1, AMF/NVENC en post-proceso.
- Carga diferida: EmojiPicker/fuentes hasta su uso.
