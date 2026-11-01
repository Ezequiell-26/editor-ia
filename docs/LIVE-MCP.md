# Puente MCP en vivo (Fase 2)

Fecha: 2026-10-31. Primera versión del control de la **app abierta** por MCP.
Hasta ahora el servidor MCP de proyecto trabajaba sobre un archivo; este puente
ejecuta las mismas **39 herramientas** del agente dentro de la UI, sobre el
proyecto que la persona tiene abierto, sin escribir el archivo por fuera.

## Permisos

- El interruptor maestro **Permitir control en vivo** publica las herramientas
  de lectura, UI y edición (**32**).
- **Permitir exportación por MCP** es un permiso separado y apagado por
  defecto. Sin él, `export_open`, `render_start`, `render_cancel`,
  `render_scene` y `video_concat`, `render_queue_add`, `render_queue_control` no se publican en `/v1/mcp/tools`: el puente
  responde **“herramienta desconocida o no registrada”**. La UI conserva además
  un chequeo propio (`la exportación está desactivada para MCP en vivo`) como
  segunda capa si un pedido llegara a reenviarse.
- `--mcp-export` (o `EDITOR_IA_MCP_EXPORT=1`) habilita la exportación en una
  sesión headless de confianza sin tocar el localStorage; `mcp_live_status` lo
  expone como `export`. Sigue requiriendo el interruptor principal. Verificado:
  con `--mcp-live --mcp-export` el puente publica **39** herramientas y
  `render_start` funciona; sin el flag publica **32**.
- El token del puente sigue siendo obligatorio para cualquier pedido.
- Si la app arranca con `--mcp-workspace`/`EDITOR_IA_MCP_WORKSPACE`, ese root
  queda **fijado**: un proyecto restaurado al abrir no lo reemplaza y la UI no
  puede cambiarlo durante la sesión.

## Transacciones de edición

`edit_transaction` aplica hasta 20 operaciones de edición puras en un solo
`store.mutate`: si una falla, no se guarda nada; al commit, un único undo
revierte todo el lote. Sólo admite herramientas de edición sin servicios
(clip, motion, efectos, transiciones, subtítulos, escenas, parallax, cámara y
pin de motor). Verificado con `scripts/verify-transaction.mjs`: 2 operaciones
(clip + subtítulo) → 1 clip/1 cue; undo → 0/0; lote con `clip_split` inválido →
sin cambios.

## Checkpoints de escena

`render_scene` y la cola de escenas llaman a `renderSceneSegmentChunked` cuando
la escena supera ~15 s y no tiene subtítulos, transiciones ni clips gráficos: el
rango se parte en tramos de ~10 s (`<segmento>-c01.mp4`, `-c02`, …), se saltean
los que ya existen con bytes y al final se concatenan con FFmpeg. Si un render
se corta, el siguiente sólo regenera los chunks faltantes. La prueba
`scripts/verify-scene-checkpoint.mjs` verifica con la app abierta: 45 s → 5
chunks, borra `c02` y el final, vuelve a encolar y comprueba que `c02` y el MP4
se regeneran mientras `c01`/`c05` conservan su mtime; el final mide 45,02 s
(H.264 + AAC). Límite: cuando hay subtítulos, transiciones o gráficos se
renderiza de una sola pasada para no romper el empalme.

## Planificador capítulo→escena

`chapter_plan` convierte un guion en capítulos y escenas con presupuesto de
palabras, reparte clips existentes en round-robin y aplica todo en una sola
mutación. Verificado con la app abierta (`scripts/verify-chapter-plan.mjs`):
2 capítulos → **3 escenas** con clips a/b/a, intenciones hook/explainer/outro,
persistencia de narración/notas/clips tras guardar, clip inexistente rechazado
y primer render de escena **6,000 s / 3.710.542 B / H.264+AAC**. Límite: los
clips se pasan al planificar y todavía no hay audio por capítulo.

## Narración por escena

`narrate_scenes` sintetiza voz **SAPI** para 1–20 escenas con `confirmRights:true`,
agrega cada WAV a Medios (`generated-locally`), lo vincula a la escena y crea el
clip de voz en la pista de narración al inicio de los clips de esa escena. Si una
escena no tiene texto o clips se omite con motivo. Verificado con la app abierta
(`scripts/verify-chapter-narration.mjs`): 2 escenas → **2 WAV**, clips de voz en
frames **0 (96 frames)** y **180 (75 frames)**, render de la primera escena
**6,000 s / 3.749.571 B / H.264+AAC**; sin `confirmRights` la llamada falla.
Límite: una voz por lote y sin mezcla por capítulo.

## Mezcla de audio

`audio_mix` cambia ganancia, paneo, EQ de 3 bandas, mute/solo de una pista (por
`trackId` o `trackKind`) y el master (ganancia/limiter) en una mutación. El render
rellena la mezcla con silencio (`apad`) y la recorta a la duración exacta, así
una voz más corta que la timeline no rompe el export. Verificado
(`scripts/verify-audio-mix.mjs`): base centrada **L/R -26,51 dB**; con pan -0,8,
gain -3, EQ graves +2 y master -1 → **L -30,23 / R -44,22 (+13,99 dB)**,
**-26 LUFS**, MP4 **12,000 s / 7.496.670 B / H.264+AAC**. Límite: el ducking
sigue configurándose en el proyecto/UI, no por esta herramienta.

## Rendimiento de la preview

`perf_stats` mide la preview real en WebView2 con `requestAnimationFrame`:
FPS, frames caídos contra el fps del proyecto y memoria JS. Sin reproducción
devuelve `active:false` con métricas en cero. La preview muestra el chip cuando
el HUD está visible. Medición 2026-10-31 sobre el proyecto de narración:
**33 fps reales / 0 caídos / 11,7 MB JS** (objetivo 30). Límite: el muestreo es
del compositor, no del decodificador de video.

## Idempotencia

`POST /v1/mcp/tool` acepta `idempotencyKey` (8–128 caracteres alfanuméricos,
`-` o `_`). El puente guarda el resultado 10 minutos (máximo 100 claves) y un
reintento con la misma clave devuelve la misma respuesta con `cached: true`,
sin volver a ejecutar la herramienta. Los fallos de infraestructura (“no
respondió”, control desactivado, herramienta desconocida) **no** se cachean para
permitir reintentos; una clave distinta ejecuta normalmente. La auditoría y el
SSE agregan `cached` a cada pedido. Verificado con
`scripts/verify-live-idempotency.mjs`: dos `clip_add` con la misma clave dejaron
**1 clip** y la segunda respuesta fue `cached:true`; una clave distinta dejó 2;
una clave inválida respondió 400.

## Eventos SSE y auditoría

- `GET /v1/mcp/events` (mismo token) abre un **stream SSE** con
  `Content-Type: text/event-stream`, keep-alive cada 15 s y eventos numerados
  `tool_started` / `tool_finished` (tool, ok, duración, resumen) más
  `render_progress` / `render_finished` reenviados desde la app.
- **Reconexión**: cada evento lleva `id: N`; al reconectar con
  `Last-Event-ID`, el servidor reenvía los eventos posteriores del historial
  corto (200). Verificado: un `engine_catalog` ocurrido sin stream se reprodujo
  al reconectar.
- Cada pedido se persiste en `%APPDATA%/com.editoria.desktop/mcp-live-audit.jsonl`
  (una línea JSON, sin argumentos ni secretos; se acumula entre sesiones). El
  archivo se recorta a las últimas 400 líneas cuando supera 1 MB.
- `GET /v1/mcp/audit?limit=50` devuelve `{ok,entries}` con las últimas entradas
  (1–200). Verificación completa (`scripts/verify-live-events.mjs --render`):
  4 eventos del primer stream, replay de `engine_catalog` (id 6), **20 eventos
  de progreso** de render y `render_finished` (**5.604.103 B, 15,233 s,
  10.908 ms**); auditoría con los pedidos y sus duraciones.

## Arquitectura

```
cliente MCP (Claude/GPT/DeepSeek)
        │ stdio JSON-RPC
        ▼
apps/project-mcp --live  ──HTTP local autenticado──▶  app Tauri (puente 47615)
        │                                               │ evento mcp-live-request
        │                                               ▼
        └── tools/list + tools/call ◀── resultado ── UI (host del asistente)
                                                        │ store.mutate / servicio
                                                        ▼
                                                   proyecto + FFmpeg/WebCodecs
```

- **UI**: `features/mcp/useLiveMcpBridge` registra los esquemas y escucha los
  pedidos. Ejecuta con `createAssistantToolHost` (el mismo host del chat), valida
  argumentos, serializa las llamadas y responde con `mcp_live_result`.
- **Rust**: `commands/live_mcp.rs` guarda esquemas, encola pedidos y espera la
  respuesta (30 s). Desactivado por defecto.
- **HTTP**: rutas nuevas del puente existente, siempre con
  `x-editoria-token`:
  - `GET /v1/mcp/tools` → `{ ok, app, tools: [{ name, description, inputSchema }] }`
  - `POST /v1/mcp/tool` `{ tool, arguments }` → resultado del agente
    `{ ok, summary, data? }`.
  - Sin control en vivo → **403**; sin herramientas registradas → **409**.
- **Cliente**: `apps/project-mcp --live http://127.0.0.1:47615 --token <token>`
  (o `EDITOR_IA_BRIDGE_TOKEN`) cambia el servidor stdio de archivo a vivo. El
  modo archivo sigue igual sin `--live`.

## Activación

1. Abrir Olyvia.
2. Ir a **MCP → Puente en vivo** y marcar **Permitir control en vivo** (apagado
   por defecto; se guarda en `localStorage`).
3. Copiar el token del puente (vista de descargas / extensión) y arrancar el
   servidor MCP en vivo.

Para pruebas/CI existe la bandera de desarrollo `--mcp-live` (o
`EDITOR_IA_MCP_LIVE=1`): habilita el puente al arrancar y la UI registra los
esquemas incluso en la pantalla de inicio. En uso normal no hace falta y no
cambia el valor por defecto.

El **workspace** limita `project_open` y `asset_import`. Se define con
`--mcp-workspace <carpeta>` (o `EDITOR_IA_MCP_WORKSPACE`); al abrir un proyecto,
la UI lo actualiza a la carpeta del proyecto. Rust canonicaliza y rechaza rutas
fuera del workspace antes de emitir el pedido a la UI.

Flujo autónomo mínimo (los dos servidores son herramientas del agente):

1. MCP de archivo: `project_create` en una carpeta del workspace.
2. MCP en vivo: `project_open` con esa ruta.
3. `asset_import` de los archivos generados, `clip_add`/`motion_add`, edición.
4. `transport` con `save` y `render_start`/`render_status`.

Configuración típica para un cliente MCP:

```json
{
  "mcpServers": {
    "olyvia-live": {
      "command": "node",
      "args": [
        "D:/…/editor-ia/apps/project-mcp/dist/server.mjs",
        "--live",
        "http://127.0.0.1:47615",
        "--token",
        "<token>"
      ]
    }
  }
}
```

## Seguridad y límites

- Sólo `127.0.0.1`, token de 64 hex y puente existente; sin CORS abierto a
  terceros más allá del contrato actual.
- Control **apagado por defecto**; al apagarlo se liberan los pedidos pendientes
  con error.
- Los pedidos se ejecutan de a uno (un solo escritor) y pasan por
  `store.mutate`: schema, undo e idempotencia de las acciones existentes.
- Timeout de 30 s por herramienta; resultados truncados por el agente.
- El cliente carga la lista una vez por proceso: si cambiás el registro de
  herramientas, reiniciá el servidor MCP.
- No hay permisos por herramienta en el puente: el token habilita el mismo set
  que el chat con herramientas (incluye exportación). No lo compartas fuera de
  la máquina.
- `render_status` en vivo no recibe el último evento de render del chat (el host
  en vivo no tiene esos refs); consulta el job activo y responde sin progreso.
- Requiere la app abierta y la UI respondiendo; no hay SSE ni reconexión.
- En la pantalla de inicio el host existe (listar y herramientas de lectura como
  `engine_catalog` funcionan); `navigate` no hace nada hasta entrar al Shell.
- La bandera `--mcp-live` es sólo local: no se puede activar por red.

## Verificación

- **5 tests Rust** de `live_mcp`: apagado por defecto, registro/validación,
  pedido completado desde la UI, timeout/herramienta desconocida y liberación al
  desactivar.
- **1 test Rust** del parser HTTP (`tool`, `arguments`, errores).
- **4 tests** del cliente `LiveBridge` con una app HTTP falsa (token, listado,
  ejecución y respuesta sin estado).
- **`npm run mcp:verify:live`**: arranca una app falsa y el servidor stdio en
  modo vivo; protocolo **2025-06-18**, lista 2 herramientas, ejecuta
  `project_inspect` y `rig_add`, y una herramienta desconocida devuelve
  `isError`.
- **`npm run mcp:verify`** sigue verde para el modo archivo.
- **2 tests de UI/estado** del interruptor y su persistencia.
- **2 tests** de `executeLiveRequest` (throw síncrono → resultado, herramienta
  desconocida y argumentos inválidos).
- **2 tests de herramientas** de `project_open`/`asset_import` con host falso.
- **1 test Rust** de workspace: permite rutas dentro, rechaza fuera, limpia y
  exige configuración.
- **Round-trip real contra la app** (build debug `--mcp-live`, 2026-10-31):
  `/v1/health` OK; **16 herramientas** en ese primer round-trip (hoy **39** con
  proyecto/material, escenas, trayectorias, tracking y render);
  `project_inspect` respondió en la app `{ok:false, summary:"no hay un proyecto
  abierto"}`; `engine_catalog` respondió con **10 motores** (`ken-burns`,
  `parallax`, `motion-graphics`, `lottie`, `rig`, `three`, `face-tracking`,
  `object-tracking`, `effects`, `transition`). El script reproducible es
  `scripts/verify-live-app.mjs`.
- **Edición en vivo** (`scripts/verify-live-edit.mjs`): crea el proyecto con el
  MCP de archivo, lo abre con `project_open`, importa un asset, monta el clip,
  guarda y verifica assets/clips en el JSON; además comprueba que la UI entra al
  editor (`view: editor`). Medición 2026-10-31: **0/0 → 1/1** en memoria y disco.
- **Render en vivo**: con un video de prueba de 6 s, `render_start` → perfil
  YouTube 1080p, `render_status` `completed` a los **2.341 ms**, salida
  **1920×1080, 30 fps, 6 s, 3.714.030 B**, h264+aac verificada con ffprobe.
  Un proyecto de una imagen estática de 5 s es rechazado por el quality gate de
  **500 KB** del perfil (el codificador sí termina; el mínimo es de entrega).
- **Prueba integral de 17 ítems** (`scripts/verify-integral.mjs`, corrida
  2026-10-31 con `--mcp-export`): creada y editada **sólo con MCP**; 8 clips,
  7 assets, 4 escenas, 15,233 s, render **5.663.541 B** en **10.313 ms**,
  1920×1080/30 fps h264+aac, audio -20,1 dB, frames distintos en 1/5/9/12 s y
  revisión visual (título/subtítulo, stickman, cubo 3D y modelo glTF animado).
  Incluye `motion_path` (3 keyframes/90 frames) y un GLB con clip “Giro” de 2 s.
  El MP4 se **decodificó completo** (video y audio, sin errores; **457/457
  frames**, 15,233 s a 30 fps), no sólo se muestreó. El ítem “Motion Canvas” se
  cubrió con el motor de motion graphics propio, no con Motion Canvas.
- **Trayectoria de movimiento** (`scripts/verify-motion-path.mjs`): proyecto
  nuevo creado por el MCP de archivo, imagen importada, `clip_add`,
  `motion_path` con **5 puntos / 120 frames** (ease-in-out, escala 1→1,15),
  grano y contraste, guardado y render. Resultado: **3.098.204 B, 5 s,
  1920×1080 h264+aac**; frames en 0,5/2/3,5 s con hashes distintos y revisión
  visual: el panel se corre a la derecha (centro de la trayectoria) y vuelve.
  El dibujo del punto medio se aprecia en el frame de 2 s (banda izquierda más
  ancha). `motion_path` sólo aplica a clips de video/imagen (el schema rechaza
  transform animado en gráficos); en el MCP de archivos está disponible para
  proyectos que ya tengan esos clips.
- **Modelo 3D importado** (`scripts/verify-three-model.mjs`): proyecto creado
  por el MCP de archivo, `three_add` con `modelPath` de un GLB de 928 B y de un
  `.gltf` con buffer base64, `clip_add`, guardado y render. Horneado VP9 de 3 s
  → asset **1.359.831 B**; render **1.791.037 B, 3 s, 1920×1080 h264+aac**,
  frames distintos y revisión visual del cubo sobre la grilla. El `.gltf`
  embebido (1 s) importó **404.967 B** tras habilitar `data:` en `connect-src`.
  La ruta del modelo se valida contra el workspace antes de emitir el pedido.
- **Cola de escenas persistente con auto-concat** (`scripts/verify-scene-queue.mjs
  --concat`): se pausa,
  se encolan 4 escenas, se cierra la app y al volver la cola aparece con **4
  queued**; al reanudar renderiza de a una y espera cada job (segmentos
  **933.181 / 1.067.401 / 1.644.828 / 1.834.953 B**), une los 4 con
  automáticamente (o con `video_concat` si no se pidió concat); el lote dejó
  **5.476.425 B, 13,021 s** h264+aac y decodificó video+audio sin errores. Las herramientas son `render_queue_add`, `render_queue_status` y
  `render_queue_control` (30 en total; 23 sin el permiso de exportación).
- `rig_add`, `three_add` y `render_start` esperan hasta **120 s** en el puente;
  el resto 30 s.
- **Render por escenas con reanudación** (`scripts/verify-scene-resume.mjs`):
  tres escenas (0–120/120–210/210–300), segmentos 4+3+3 s
  (987.448/1.085.562/1.610.894 B), concat **3.681.306 B / 10,021 s**
  h264+aac 1080p; el segmento existente se reutilizó, se borró el segundo y
  sólo se regeneró, y el concat volvió a dar el mismo tamaño.
- La primera versión de `render_start` abría el diálogo nativo de guardado y
  bloqueaba la UI; ahora usa `startRenderTo` con nombre determinista junto al
  proyecto y `render_status` informa el `finished` real (incluye fallos).
