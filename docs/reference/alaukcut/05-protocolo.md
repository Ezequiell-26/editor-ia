# 05 — Protocolo HTTP + WebSocket (`servidor.pyc`)

HTTP server en `127.0.0.1` con token de sesión (query param). Bind local
only + `rede_segura.pyc` probablemente valida origen.

## Rutas GET (7)

| Ruta | Sirve |
|---|---|
| `/midia` | Streaming de archivos de media del proyecto (range requests) |
| `/upload` | (POST también) subida de archivos |
| `/nativo/previa` | Preview nativo por HTTP (frames) |
| `/nativo/tempos` | Tiempos/metadata nativos |
| `/nativo/ws` | **WebSocket** — canal principal del preview nativo |
| `/quadro_nativo` | Un cuadro renderizado |
| `/reserva_video` | Reserva/streaming de video |
| `/assets/` | Assets estáticos (stickers, fonts, etc.) |

## Rutas POST (11)

| Ruta | Recibe |
|---|---|
| `/agente` | Comandos del agente IA |
| `/bancada/quadro` | Frame de "bancada" (workbench/test) |
| `/export/quadro` | Cuadro para export |
| `/montagem/pedaco` | Pedazo de montaje (render por partes) |
| `/nativo/previa` | Request de preview nativo |
| `/nativo/previa_janela` | Preview en ventana nativa |
| `/nativo/previa_provar` | Probar preview |
| `/nativo/remendo` | "Remendo" = patch/reparación de texturas? |
| `/nativo/textura` | **Upload de textura** (píxeles crudos → cache por hash) |
| `/prerender/pedaco` | Pedazo de prerender |
| `/upload` | Upload de archivos |

## WebSocket `/nativo/ws`

Canal persistente para el preview nativo (`sessao_nativa.js`, 714 líneas):

- El front envía **descripciones de capas en JSON** + **buffers de píxeles
  crudos** (texturas de video/imagen decodificadas en browser).
- El motor C++ compone y devuelve cuadros (para preview acelerado por GPU
  sin pasar por WebGL).
- Gestiona **generaciones de textura** (versionado), **texturas
  efímeras**, **reuso**, **LUTs**, y **stats por clip**.

### Por qué existe esto

WebGL2 en `motor.js` es el preview "barato"; cuando el usuario activa el
motor nativo (o para features que WebGL no alcanza), el mismo compositor
C++ dibuja en una ventana/textura y el resultado vuelve por WS/HTTP.
Para Olyvia: el equivalente conceptual es render-worker + preview frames —
no hace falta copiar el protocolo, sí el patrón "describir escena →
recibir frames".

## Detalles de seguridad observados

- Token de sesión por query (`?token=…`) — el front lo obtiene al arrancar.
- Bind a localhost; `rede_segura.pyc` probablemente filtra Origin/Host.
- No se encontraron rutas de escritura de proyecto arbitrarias — la
  persistencia va por RPC `Api`, no por HTTP.
