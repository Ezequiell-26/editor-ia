# Seguimiento de punto y objeto (Fase 9)

Fecha: 2026-10-31. Tracker no facial del motor: sigue un punto o una caja
elegidos por el usuario sobre un video y los convierte en keyframes de máscara.
Es código propio (NCC), sin OpenCV ni modelos externos; no sube nada.

## Algoritmo

1. FFmpeg extrae frames **grises a 480 px** a ~6 fps (12–240 frames, máximo
   30 s) del tramo del clip.
2. El primer frame define una plantilla de `(2·10+1)²` píxeles alrededor del
   punto inicial (centro del polígono de la máscara).
3. Cada frame busca la plantilla en una ventana local de ±24 px con
   **correlación cruzada normalizada** (NCC).
4. Si la mejor confianza es < 0,35 se conserva la última posición y se informa
   la confianza baja; no se inventa movimiento.
5. La UI convierte los puntos en una máscara poligonal rígida con keyframes
   x/y (máx. 48), filtrando muestras de baja confianza.

## API

- Comando Tauri `track_point_in_video` (`commands/point_track.rs`):
  `{ path, startSeconds, endSeconds, x, y }` → `{ durationSeconds, fps,
  scaledWidth, scaledHeight, points: [{ time, x, y, confidence }] }`.
  `time` es relativo al inicio del tramo.
- Servicio TS `trackPoint` y tipos `PointTrackRequest/Result`.
- UI: VFX → panel de máscara → **Seguir punto** (usa el centro del polígono).
  Requiere un clip de video y un polígono; reemplaza la máscara con la
  trayectoria.

## Verificación

- **3 tests unitarios del tracker** (`render/point_track.rs`): cuadrado en
  movimiento ±2 px, desaparición del sujeto (conserva posición y baja
  confianza) e input vacío/plano.
- **3 tests de la sesión** (`commands/point_track.rs`): rango, cantidad de
  muestras y lectura de frames desde disco con cuadrado en movimiento.
- **1 test live FFmpeg** (`live_ffmpeg_tracks_a_moving_square_in_a_video`,
  requiere `EDITOR_IA_RUN_RENDER_TESTS=1`): genera un MP4 con un cuadrado que se
  mueve, extrae frames y comprueba que la trayectoria avanza y mantiene
  confianza. **Pasa** con el FFmpeg del bundle; se cambiaron los frames de
  extracción a PNG para no perder confianza por el JPEG.
- **3 tests** de `maskFromPointTrack`: polígono/keyframes, filtrado por
  confianza, radio y tope de 48 claves.
- **1 test de UI** (`VfxView`): crea el polígono, pulsa **Seguir punto** y
  comprueba el aviso y las claves resultantes con el servicio de prueba.
- UI: el botón se agrega junto a “Seguir rostro”; la máscara resultante se
  valida con el schema al guardar (`store.update` + `updateClip`).

## Objetos (caja)

- `track_region` muestrea la caja completa con ~144 valores (paso según el
  tamaño), reutiliza NCC, búsqueda ±24 px y umbral 0,35; devuelve el centro de
  la caja. Sin invariancia a escala/rotación.
- Comando `track_object_in_video`:
  `{ path, startSeconds, endSeconds, x, y, width, height }` (todo normalizado)
  → `{ durationSeconds, fps, scaledWidth, scaledHeight, regionWidth,
  regionHeight, points }`.
- Servicio TS `trackObject`; UI **Seguir objeto** usa la caja del polígono y
  aplica una máscara rectangular (`maskFromObjectTrack`) con claves x/y.
- Herramienta `track_object` del asistente: recibe `clipId` opcional,
  `x/y/width/height`; resuelve el clip, ejecuta el tracker y guarda la máscara.
  **No** está en el MCP de archivos (necesita FFmpeg y la app).

## Acceso del agente

La herramienta `track_point` del asistente (permiso de edición) recibe `clipId`
opcional, `x` e `y`; resuelve el material, llama al comando, aplica la máscara
con `updateClip` y selecciona el clip. `track_object` hace lo mismo con la caja.
Ninguna está expuesta en el servidor MCP de archivos porque necesita FFmpeg y la
app abierta.

## Verificación

- **6 tests unitarios del tracker** (`render/point_track.rs`): punto (cuadrado
  ±2 px, desaparición, input vacío/plano) y región (patrón ±2 px, desaparición,
  tamaño/entrada vacía).
- **5 tests de la sesión** (`commands/point_track.rs`): rango, muestras, frames
  de punto desde disco, límites de píxeles de la región y frames de objeto.
- **2 tests live FFmpeg** (con `EDITOR_IA_RUN_RENDER_TESTS=1`): cuadrado en
  movimiento y objeto texturado en movimiento. Ambos **pasan** con el FFmpeg del
  bundle; los frames se extraen en PNG para no perder confianza.
- **5 tests** de máscaras: 3 del punto (polígono/keyframes, confianza, tope) y
  2 del objeto (rectángulo/claves, tamaño acotado y vacío).
- **2 tests de UI**: **Seguir punto** y **Seguir objeto** crean las claves.
- **1 test de herramienta** de `track_object` (caja 20×10 %, 4 puntos, 2 claves).

## Límites

- NCC con plantilla fija: no maneja bien escala, rotación o cambios fuertes de
  apariencia; para eso hacen falta modelos de pose/segmentación.
- Muestreo a 6 fps y 480 px: suficiente para máscaras y movimiento, no para
  tracking subpíxel de alta precisión.
- La ventana de búsqueda ±24 px limita la velocidad del sujeto entre frames.
- Sólo video; las imágenes no tienen frames para seguir.
- El punto inicial es el centro del polígono y la caja es su bounding box; no
  hay todavía un selector dedicado en el visor.
- El objeto se asume de tamaño constante; la máscara no escala con la
  perspectiva. La caja se limita a 240 px por lado (máx. ~media pantalla).
- Un objeto plano/uniforme no tiene textura para NCC: el tracker lo reporta con
  confianza baja en vez de inventar una trayectoria.
