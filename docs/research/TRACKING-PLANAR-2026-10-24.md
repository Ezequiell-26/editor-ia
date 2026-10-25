# Tracking planar/de objetos y rotoscopía deformable — Diseño técnico (2026-10-24)

Documento de diseño para cerrar la carencia **P3 #10** del audit: «Tracking de
objetos/planar y rotoscopía deformable; el tracking actual es facial y el
polígono es rígido» (`docs/AUDIT.md:80-81`). Es SOLO investigación y diseño: no
toca código. Todo lo citado del repositorio se verificó leyendo los archivos
indicados en este pase.

## 1. Resumen ejecutivo

| Fase | Qué entrega | Motor | Coste estimado |
|---|---|---|---|
| **1 — MVP** | «Seguir objeto»: caja dibujada por el usuario → keyframes de la máscara (centro + escala) y de transform | Rust puro (KLT + NCC), sin dependencias C++ | 4–6 días |
| **2 — Planar** | «Seguir plano»: quad de 4 puntos → homografía por frame → máscara deformable de 4–8 vértices y corner pin de overlay | Rust puro (KLT + DLT/RANSAC) + filtro FFmpeg `perspective` con `eval=frame` | 8–10 días |
| **3 — Pro** | «Roto IA»: máscara propagada por video (modelo ONNX) → polígono deformable editable; densidad de keyframes sin límites de expresión | ONNX Runtime ya integrado (SAM 2 tiny / RVM) + rasterizado de máscara en Rust | 15–20 días |

Arquitectura común en las tres fases: **el tracker es un productor de datos y
los consumidores (máscara, transform, corner pin) cargan esos datos como
keyframes**. Es el mismo modelo que Shotcut («Motion Tracker» produce datos que
Corner Pin / Crop / Size-Position-Rotate cargan) y que ya usa Olyvia para el
rostro (`analyzeFaceTrack` → `maskFromFaceTrack` → keyframes x/y de la máscara).

## 2. Estado actual del código (verificado)

### 2.1 Qué existe y dónde

- **Vista VFX** (`apps/desktop/src/features/vfx/VfxView.tsx`): cadena lineal de
  6 nodos por clip (Entrada → Chroma → Roto → Color → Detalle → Salida,
  líneas 340-566). El nodo Roto (410-481) permite crear/reiniciar polígono
  (127-132), editar hasta 16 vértices arrastrándolos sobre un SVG con
  `viewBox="0 0 1 1"` (134-151 y 289-321; el tope de 16 está en 142-144),
  «Seguir rostro» (187-216, llama `analyzeFaceTrack`), «Clave x/y» para
  guardar la posición actual como keyframe (453-465) y scrubber de frame
  (323-337). El polígono se dibuja trasladado por x/y muestreados de los
  keyframes (60-71, con `sampleMaskKeyframes`).
- **Conversión rostro → máscara** (`apps/desktop/src/features/vfx/face-mask.ts:15-69`):
  `maskFromFaceTrack` crea un **octógono rígido** alrededor de la primera cara
  (32-38) y genera keyframes **solo de traslación x/y** (diferencia contra la
  primera muestra, 51-56). Decima muestras con stride hasta
  `MAX_TRACKED_KEYFRAMES = 48` (línea 4 y 40-47). Comentario explícito: «No
  deforma los vértices» (10-14).
- **Esquema de máscara** (`packages/project-schema/src/timeline.ts`):
  - `MAX_MASK_KEYFRAMES = 32` (línea 438).
  - `ClipMaskKeyframeSchema` (439-465) anima **solo propiedades rígidas**:
    `x`, `y`, `width`, `height`, `rotationDeg`, `feather`. No hay puntos por
    keyframe: la rotoscopía deformable no es expresable hoy.
  - `ClipMaskSchema` (476-526): `shape: 'polygon'` exige `points` (3–16
    puntos normalizados 0..1, líneas 499 y 511-517) y admite `keyframes`
    (máx 32, línea 500).
  - ⚠️ Dato latente: `face-mask.ts` produce hasta 48 claves pero el esquema
    permite 32 (438 vs `MAX_TRACKED_KEYFRAMES = 48` en face-mask.ts:4). La
    Fase 1 debe resolver este tope (subirlo y/o decimar más agresivo).
- **Render de la máscara** (`apps/desktop/src-tauri/src/render/ffmpeg.rs`):
  `mask_filter` (1165-1255) compila la máscara a una expresión FFmpeg `geq`
  sobre el canal alfa. Para polígono (1211-1254) hace el test par/impar de
  cruces de aristas con los puntos **constantes + traslación x/y animada**
  (la animación viene de `keyframe_expression`, línea 327, que ya produce
  `if(lt(t,…))` anidados con easing bezier y soporta los 6 campos rígidos).
  El reloj es el contador de frames `N` rebasado por el lead de transición,
  no `t` (1177-1184) porque corre después de `zoompan`.
- **Tracking facial** (`apps/desktop/src-tauri/src/commands/shorts.rs:604-660`,
  `commands/face.rs`): comando `analyze_face_track` valida rango (0,1–600 s),
  exige el modelo `seeta-face` descargado y con checksum correcto
  (shorts.rs:636-648), extrae hasta ~30 frames con FFmpeg CLI a 480 px JPG
  (`extract_face_samples`, 171 y ss.), detecta con rustface/SeetaFace
  (`face.rs:70-81`) y suaviza 0,25/0,5/0,25 (`face.rs:99-125`). Devuelve
  muestras al frontend; la UI crea los keyframes.
- **Estabilización de cámara** (ya existe, distinta del tracking de objetos):
  `ClipStabilizationSchema` (`timeline.ts:534-551`) referencia un archivo
  `.trf` de VidStab dentro del proyecto (`media/mod.rs:278`); análisis con
  `vidstabdetect` (`commands/analysis.rs:278`) y aplicación con
  `vidstabtransform` (`render/ffmpeg.rs:902`). Es compensación de shake
  global, no sigue objetos: no resuelve P3 #10 pero sí marca el patrón
  «datos densos en archivo + rango inFrame/outFrame».
- **Runtime ONNX** (`commands/background.rs`): `ort` 2.0.0-rc.15 con
  `load-dynamic` (`Cargo.toml:42`); el DLL va junto al ejecutable o en
  `ORT_DYLIB_PATH` (39-53 y 61-87); entorno global único con `OnceLock`
  (35 y 89-110); sesión reutilizada para todo el video con 4 hilos internos
  (177-202); preprocesado a 320×320 igual que rembg (27-32 y 214-220). El
  catálogo de modelos con licencia y hash está en `commands/models.rs:56-116`
  (hoy: u2netp 4,4 MB, real-esrgan-x4plus, seeta-face 1,2 MB) con
  `is_model_downloaded` / `verify_model_hash` (135-152).
- **Decodificación en Rust** (`commands/preview_frame.rs:225-265`):
  `video_rs::decode::Decoder` entrega frames como ndarray con timestamps sin
  pasar por FFmpeg CLI (`Cargo.toml:49`, `video-rs` con feature `ndarray`).
  Es la base natural para un tracker frame-a-frame en Rust.
- **Pruebas**: `VfxView.test.tsx` (69 líneas) y `face-mask.test.ts` (72
  líneas) marcan el estilo para tests de UI y de conversión track→máscara.

### 2.2 Gap estructural

Para tracking planar y roto deformable faltan tres piezas: (1) un **productor
de trayectorias** que no sea facial (punto/caja/quad), (2) un **formato de
datos** que pueda animar vértices individuales (hoy los keyframes solo mueven
el polígono rígido entero) y (3) un **consumidor de homografía** (corner pin)
en el grafo de render. El pipeline de análisis (frames → samples → keyframes →
máscara) y el de ONNX ya están maduros y se reutilizan tal cual.

## 3. Cómo lo resuelven otros editores (investigación web)

### 3.1 Kdenlive / MLT — Motion Tracker con OpenCV

- Kdenlive tiene el efecto **Motion Tracker** sobre OpenCV: se selecciona la
  región en el monitor, se elige algoritmo y se pulsa «Analyze»; los
  keyframes generados se copian a otros efectos (p. ej. Transform) para
  seguir el objeto.
  Fuente: <https://docs.kdenlive.org/en/effects_and_filters/video_effects/alpha_mask_keying/motion_tracker.html>
- Algoritmos expuestos: **KCF** (por defecto), **CSRT** (más preciso, ~25 fps),
  **MOSSE** (muy rápido, 450+ fps), **MIL**, **MedianFlow**, y dos trackers
  de deep learning que consume como ONNX: **DaSiam** (3 modelos) y **Nano**
  (~1,9 MB, 2 modelos) que se descargan a `opencvmodels`. Misma fuente.
- El filtro subyacente MLT `opencv.tracker` trabaja en **dos pasadas**: la
  primera analiza y guarda el resultado en la propiedad animada `results`
  (un rect animado, con un keyframe cada `steps` frames), la segunda lo
  aplica; recomendación de renderizar el XML con `all=1 real_time=-1`.
  Fuente: <https://www.mltframework.org/plugins/FilterOpencv-tracker/>
- Lección para Olyvia: separar **analizar** (batch, con progreso) de
  **aplicar** (consumidores de keyframes), y ofrecer tracker «ligero» y
  «preciso» como opción del usuario. El modelo Nano de ~1,9 MB vía ONNX es
  un atajo barato si el tracker propio no rinde (sección 7.3).

### 3.2 Shotcut — tracker productor, filtros consumidores

- Shotcut tiene un filtro **Motion Tracker** que habilita el tracking en
  otros filtros: **Corner Pin**, **Crop: Rectangle**, **Size Position &
  Rotate**, **GPS Text** y **Timer** («Load Keyframes from Motion Tracker»).
  Fuente: <https://forum.shotcut.org/t/motion-tracker-video-filter/40784>
- Corner Pin carga los keyframes del tracker para pegar contenido a un plano
  en movimiento (conknown workflow quirks: guardar/reabrir antes de cargar).
  Fuente: <https://forum.shotcut.org/t/corner-pin-filter-with-motion-trackers/51971>
- Lección para Olyvia: un único dato de tracking reutilizable por varios
  consumidores es el diseño correcto; en Olyvia el equivalente del Corner Pin
  es una capa overlay (clip superior) que toma la homografía del clip base.

### 3.3 Olive — sin tracking

Olive no implementa motion tracking; solo aparece como deseo en la discusión
de color («we will need to add motion tracking») y en el issue de
estabilización. No hay diseño que copiar.
Fuentes: <https://github.com/olive-editor/olive/issues/590>,
<https://github.com/olive-editor/olive/issues/190>

### 3.4 Blender — plane track con homografía

El «Create Plane Track» de Blender parte de que las superficies del mundo son
planas: se colocan 4 marcadores y el solver calcula una **homografía** 3×3 por
frame entre el quad rastreado y el plano canónico, suficiente para corner pin
y reemplazo de pantallas sin solve 3D.
Fuentes: <https://docs.blender.org/manual/en/2.80/movie_clip/tracking/clip/editing/solve.html>,
<https://blender.stackexchange.com/questions/33203/how-to-do-multiple-plane-tracks-from-one-video>
Lección: 4 puntos sobre un plano → homografía exacta; es el algoritmo de la
Fase 2 y no necesita OpenCV.

### 3.5 Mocha (referencia comercial)

El planar tracker de Mocha rastrea **superficies** (no puntos) y de ahí salen
corner pins robustos a oclusión, motion blur y cambios de luz; PowerMesh añade
malla deformable para superficies curvas (equivalente a nuestra Fase 3).
Fuentes: <https://borisfx.com/blog/learn-how-to-do-planar-tracking-with-mocha-pro>,
<https://borisfx.com/products/mocha-pro>

### 3.6 VidStab — ya integrado, no es tracking de objetos

VidStab (vid.stab de G. Georg, dos pasadas `vidstabdetect`/`vidstabtransform`
con archivo `.trf`) compensa movimiento de cámara global. Olyvia ya lo tiene
(sección 2.1). Se cita como referencia del patrón de archivo de datos denso:
<https://github.com/georgmartius/vid.stab>

### 3.7 OpenCV trackers y optical flow en Rust

- Comparativas prácticas: **CSRT** es el más preciso y el más lento; **KCF**
  equilibra; **MOSSE** es el más rápido y el menos preciso; **GOTURN** (deep)
  es rápido pero irregular y requiere modelos. El módulo `tracking` de OpenCV
  no acelera por CUDA en sus implementaciones CSRT/KCF.
  Fuentes: <https://www.sighthound.com/blog/csrt-kcf-opencv-tracker-real-time-video>,
  <https://www.pyimagesearch.com/2018/07/30/opencv-object-tracking/>
- Flujo clásico de tracking por puntos: `goodFeaturesToTrack` (Shi-Tomasi) →
  `calcOpticalFlowPyrLK` (Lucas-Kanade piramidal).
  Fuente: <https://docs.opencv.org/3.4.20/d4/dee/tutorial_optical_flow.html>
- En Rust: el crate `opencv` (bindings) expone `calc_optical_flow_pyr_lk`
  (<https://docs.rs/opencv/latest/opencv/video/fn.calc_optical_flow_pyr_lk.html>)
  pero exige OpenCV C++ en build e instalador — **descartado** para Olyvia
  (el repo hoy solo depende de C++ pequeños y con licencias claras: rustface
  BSD-2, ONNX Runtime MIT). Alternativas Rust puro: `optical-flow-lk`
  (<https://crates.io/crates/optical-flow-lk>, LK + Shi-Tomasi) y
  `lucas-shi-rust` (<https://github.com/den59k/lucas-shi-rust>, optimizado a
  tiempo real); para estimación robusta de modelos con RANSAC existe el
  ecosistema `rust-cv` con `sample-consensus`
  (<https://github.com/rust-cv/cv>). Conclusión: **implementar KLT propio en
  un módulo Rust** (es ~500 líneas conocidas) tomando esos crates como
  referencia de licencia y rendimiento, sin añadir OpenCV.

### 3.8 Modelos ONNX de tracking/segmentación de video

- **SAM 2** (Meta) hace segmentación promptable en video con propagación de
  memoria: para roto deformable es el modelo de referencia. Existen exports a
  ONNX (encoder y decodificador separados) p.ej. con `samexporter` (SAM,
  MobileSAM, EfficientSAM, SAM 2/2.1) y variantes livianas como
  `sam2-hiera-tiny-onnx`; hay ejecuciones en CPU con onnxruntime(-web)
  documentadas.
  Fuentes: <https://github.com/vietanhdev/samexporter>,
  <https://docs.ultralytics.com/models/sam-2>,
  <https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx>,
  <https://medium.com/@geronimo7/in-browser-image-segmentation-with-segment-anything-model-2-c72680170d92>
- **CoTracker3** (puntos con manejo de oclusión) no tiene ONNX oficial: los
  checkpoints son PyTorch y exportar el transformer con correlación 4D
  requiere trabajo propio.
  Fuente: <https://github.com/facebookresearch/co-tracker>
- Conclusión: la Fase 3 usa SAM 2 tiny (u homólogo) vía el runtime ONNX ya
  integrado; CoTracker queda como opción futura, no para el instalador.

### 3.9 FFmpeg: aplicar la homografía sin cambiar el grafo

El filtro `perspective` de FFmpeg admite `eval=frame`: las esquinas
`x0,y0…x3,y3` se re-evalúan por frame y con ese modo está disponible la
variable `t` (timestamp en segundos).
Fuentes: <https://ffmpeg.org/ffmpeg-filters.html> (sección perspective),
implementación histórica del modo:
<https://fuchsia.googlesource.com/third_party/ffmpeg/+/2e8a51735a04599617de58474dfe2b372299f8db%5E1..2e8a51735a04599617de58474dfe2b372299f8db>
Esto permite compilar el tracking planar a **expresiones por esquina** con el
mismo generador `keyframe_expression` que ya usa la máscara
(`render/ffmpeg.rs:327`), sin nuevo motor de render. Caveat: `perspective` no
soporta `N`, así que el reloj será `t` y hay que tratar el rebasing del lead
de transición igual que hace `mask_filter` (1177-1184).

## 4. Enfoque recomendado por fases

### Fase 1 — MVP: «Seguir objeto» (caja rígida, 4–6 días)

**Algoritmo** (Rust puro, módulo nuevo `commands/tracking.rs`):

1. Decodificar el rango del clip a gris y a resolución de análisis (~480 px,
   patrón `extract_face_samples` en `shorts.rs:171` o mejor decodificación en
   proceso con `video_rs::decode::Decoder`, patrón `preview_frame.rs:240-265`).
2. **Shi-Tomasi** dentro de la caja inicial: gradientes Sobel 3×3, tensor de
   estructura, eigenvalues mínimos, top-K esquinas (K≈40) con mínimo espacial.
3. **KLT piramidal** frame a frame: 3 niveles de pirámide, ventana 15×15,
   máx. 10 iteraciones; chequeo **forward-backward** (seguir el punto de
   vuelta y descartar si el error de reproyección > 0,5 px).
4. Pose del objeto por frame = mediana de los puntos visibles (centro) +
   dispersión (tamaño de caja). Si visibles < 25 % de K o FB error alto:
   **re-detección NCC** (correlación normalizada del template original dentro
   de una ventana de búsqueda creciente alrededor de la última pose); si
   también falla, marcar el frame con `confidence: 0` y congelar la pose.
5. Suavizado 0,25/0,5/0,25 (idéntico a `face.rs:99-125`) y decimación de
   keyframes por tolerancia (guardar solo si la pose se desvía > umbral,
   p. ej. 0,4 % del ancho del frame) — mejor que stride fijo porque respeta
   curvas y elimina deriva sin datos.
6. Emitir progreso por evento Tauri (`track-progress`, patrón
   `short-progress` en `shorts.rs:624`).

**Consumo**: el resultado es una lista `{frame, x, y, width, height,
confidence}`. El frontend crea keyframes con el esquema ACTUAL (sin cambios de
formato): (a) sobre la máscara poligonal (x/y y opcionalmente width/height,
como `maskFromFaceTrack`) o (b) sobre la transform del clip (posición/escala,
patrón del «Centrar rostro» del pase Visuals Luciano,
`docs/research/VISUALS-LUCIANO-2026-10-24.md`). Queda usable para: resaltar un
objeto con máscara que lo sigue, blur/pixelado que sigue un logo, y un sticker
pegado a un punto.

**UX**: en el nodo Roto, botón «Seguir objeto» habilita dibujar la caja en el
visor SVG (mismo mecanismo de pointer events que ya edita vértices,
`VfxView.tsx:134-176`); selector «Mover: centro / caja»; al analizar, barra de
progreso y «Detener»; el overlay dibuja la caja por frame (rect x/y/w/h
muestreados como ya se hace con x/y); keyframes visibles en el scrubber y
editables a mano (arrastrar la caja en un frame crea/actualiza la clave).

**Riesgos y mitigaciones**:

- Calidad del tracker propio vs CSRT: mitigado por NCC de respaldo, confianza
  por frame y edición manual; si en pruebas reales queda corto, la Fase 2.5
  (opcional) integra un tracker ONNX tipo Nano de ~1,9 MB (misma vía que
  Kdenlive, sección 3.1) con el runtime existente.
- Tope de 32 keyframes (`timeline.ts:438`) ya justo para el rostro
  (face-mask.ts apunta a 48): Fase 1 sube el tope del esquema (propuesta:
  120) con JSON Schema regenerado, y ajusta `MAX_TRACKED_KEYFRAMES`.
- Ventana de análisis: hoy el rango facial se limita a 600 s
  (`shorts.rs:604`); para clips largos el análisis corre a fps decimado
  (análisis cada 2–3 frames + interpolación lineal) para mantener el coste
  lineal y acotado.

**Dónde vive**: `commands/tracking.rs` (nuevo, análisis), `timeline.ts`
(tope de keyframes), `VfxView.tsx` (UI), `project-service` (wrapper invoke),
`project-actions.ts` (acción `applyObjectTrack` que escribe keyframes).

### Fase 2 — Planar: quad → homografía → máscara deformable + corner pin (8–10 días)

**2a. Máscara poligonal deformable (esquema + render)**

- Esquema: `ClipMaskKeyframeSchema` gana `points?: Array<{x,y}>` (opcional,
  0..1, misma longitud que `ClipMask.points`, alineado por índice). El
  `superRefine` actual exige animar al menos una propiedad
  (`timeline.ts:451-464`) — `points` cuenta. Los puntos fijos del mask siguen
  siendo la base; los keyframes los sobreescriben por vértice.
- Interpolación de preview: extender `sampleMaskKeyframes`
  (`keyframes.ts:164-174`) para muestrear cada vértice (reutiliza el sampler
  con easing ya existente).
- Render: en `mask_filter` (`ffmpeg.rs:1211-1254`), cada coordenada de
  vértice se compila con `keyframe_expression` y entra en el mismo test
  par/impar de `geq`. **Límite de seguridad**: capar a 8 vértices animados y
  ~16 claves por vértice en el compilador de expresiones (medir el coste del
  `geq` por píxel; si excede presupuesto, decimar más). Para densidad mayor,
  el camino es el de la Fase 3 (máscara pre-rasterizada en Rust).
- UX: con «Seguir plano» el usuario coloca 4 (o hasta 8) puntos sobre una
  superficie; el overlay dibuja el quad animado; arrastrar un vértice en
  cualquier frame crea la clave de ese vértice (override del track).

**2b. Tracking planar propiamente dicho**

- Colocación de quad (4 puntos, snapping opcional a 8) sobre la superficie en
  el frame de inicio; cada esquina (y features interiores si se pide
  robustez) se rastrea con el KLT de la Fase 1.
- **Homografía por frame**: DLT con normalización de Hartley usando las 4
  esquinas (+ features interiores si hay ≥6 correspondencias, con RANSAC de
  `sample-consensus`/propio, umbral 1,5 px) — mismo fundamento que el plane
  track de Blender (sección 3.4). Resolver el sistema 8×8 con eliminación
  gaussiana en Rust puro (sin `nalgebra`, que hoy no está en `Cargo.toml`).
- **Suavizado**: descomponer cada homografía en canales interpretables
  (traslación, escala por eje, cizalla, rotación vía descomposición QR/polar
  de la parte lineal) y filtrar cada canal 0,25/0,5/0,25; recomponer. Evita
  el jitter típico de suavizar coeficientes crudos de la matriz.
- **Confianza**: error de reproyección medio por frame → `confidence`;
  frames por debajo de umbral quedan congelados y marcados en la UI
  (vértice hueco) para corrección manual.

**2c. Corner pin de overlay**

- Nuevo modo en el esquema (propuesta): `clip.track?: ClipTrackSchema` con
  `sourceClipId` (el clip base que tiene el tracking), `mode:
  'mask' | 'cornerPin'`, `inFrame/outFrame` (mismo patrón de validación que
  `ClipStabilizationSchema`, `timeline.ts:534-551` — el render se niega si el
  clip base se recorta/retima, porque las filas dejarían de alinear).
- Render: el overlay (imagen/texto) recibe `perspective=x0..y3:eval=frame`
  cuyas esquinas son expresiones `keyframe_expression` sobre `t`, con las
  esquinas del quad mapeadas a los bordes del overlay; después entra al
  `overlay` del grafo como cualquier capa (sección 3.9).
- Datos densos: el análisis guarda `media/trackers/<clipId>.olytrack.json`
  (muestras por frame, patrón de archivos de vidstab en `media/mod.rs:278`);
  el proyecto solo persiste keyframes decimados (para preview/UX) + la
  referencia al archivo. Comando Rust `read_track_file` para que la preview
  lea el denso si hace falta.

**Riesgos**: deriva del KLT en oclusiones largas (mitigado por NCC + marcaje
de confianza + edición manual); longitud/coste de las expresiones `geq`
(capado y medido); primer uso del reloj `t` en `perspective` junto a `zoompan`
(crear test de grafo como los existentes de vidstab en `ffmpeg.rs:6282-6395`).

### Fase 3 — Pro: «Roto IA» con segmentación de video ONNX (15–20 días)

- **Modelo**: SAM 2 variante hiera-tiny exportada a ONNX (encoder/decoder
  separados; `samexporter`, sección 3.8), agregada al catálogo
  `models.rs:56-116` con licencia Apache-2.0 y hash; descarga desde Ajustes →
  Capacidades como los existentes. Tamaño objetivo ≤ 60 MB (a verificar en la
  fase; si excede presupuesto, evaluar MobileSAM/EfficientSAM del mismo
  exportador). CoTracker3 queda descartado para el instalador (sin ONNX
  oficial, sección 3.8).
- **Pipeline**: prompt por caja o punto (sessión de memoria del video, frame
  a frame con la sesión reutilizada como `open_session` en
  `background.rs:177-202` y 4 hilos) → máscara por frame → extracción de
  contorno (marching squares) + simplificación poligonal (Douglas-Peucker) a
  ≤ 16 vértices → keyframes de polígono deformable.
- **Render denso**: cuando el polígono necesita más de ~16 claves por vértice,
  el compilador de expresiones ya no escala: en su lugar, Rust rasteriza la
  máscara por frame (decodifica con `video_rs::decode`, dibuja el polígono
  con relleno + feather gaussiano, codifica una tira de PNG alfa o video con
  alfa) y el grafo la consume con `alphamerge` — el mecanismo
  `alphaextract/alphamerge` ya existe en el grafo (`ffmpeg.rs:802-805`). Es
  el mismo patrón de dos pasadas con archivo intermedio que vidstab.
- **UX**: botón «Roto IA» en el nodo Roto (requiere modelo descargado, mismo
  aviso que el rostro en `shorts.rs:636-648`); tras propagar, el polígono
  queda editable (Fase 2a) y se pueden re-propagar rangos; coste de análisis
  estimado mostrado antes de confirmar (como el resto de funciones IA).
- **Riesgos**: rendimiento CPU de SAM 2 (medir; fallback MobileSAM); tamaño
  del modelo en el catálogo; calidad del contorno simplificado (permitir
  densidad de vértices configurable 6–16); licencia de pesos a confirmar por
  archivo en el catálogo (SAM 2 código Apache-2.0; verificar los checkpoints
  concretos que se empaqueten).

## 5. Formato de datos (propuesta consolidada)

### 5.1 En el proyecto (JSON del clip)

```ts
// packages/project-schema/src/timeline.ts — extensiones propuestas
export const MAX_MASK_KEYFRAMES = 120; // hoy 32 (timeline.ts:438)

export const ClipMaskKeyframeSchema = z.object({
  frame: FrameSchema,
  x: z.number().gte(-1).lte(1).optional(),
  y: z.number().gte(-1).lte(1).optional(),
  width: z.number().gt(0).lte(2).optional(),
  height: z.number().gt(0).lte(2).optional(),
  rotationDeg: z.number().gte(-180).lte(180).optional(),
  feather: z.number().gte(0).lte(1).optional(),
  // NUEVO (Fase 2a): vértices animados, alineados por índice con mask.points.
  // Normalizados 0..1; si falta un índice en una clave, ese vértice se
  // interpola entre las claves que sí lo definen.
  points: z.array(MaskPointSchema).min(3).max(16).optional(),
}).strict().superRefine(/* points cuenta como propiedad animada */);

// NUEVO (Fase 2c): tracking referenciado, mismo patrón que ClipStabilizationSchema.
export const ClipTrackSchema = z.object({
  transformFile: z.string().min(1).max(500), // media/trackers/<clipId>.olytrack.json
  sourceClipId: z.string().min(1),
  mode: z.enum(['mask', 'cornerPin']),
  inFrame: FrameSchema,
  outFrame: FrameSchema,
  smoothing: z.number().int().min(0).max(60).optional(),
}).strict();
```

### 5.2 Archivo denso de análisis (por clip, fuera del JSON del proyecto)

`media/trackers/<clipId>.olytrack.json` (proyecto-relativo, patrón vidstab):

```jsonc
{
  "version": 1,
  "algo": "klt+ncc",           // 'klt' | 'klt+ncc' | 'plane-dlt' | 'onnx:sam2'
  "fps": 30.0,                  // fps efectivo del análisis
  "inFrame": 0, "outFrame": 149,
  "sourceWidth": 1920, "sourceHeight": 1080,
  "samples": [
    { "frame": 0, "confidence": 1.0,
      "points": [{"x": 0.402, "y": 0.310}, {"x": 0.581, "y": 0.298},
                 {"x": 0.590, "y": 0.552}, {"x": 0.409, "y": 0.570}] }
    // Fase 1 (caja): points = 4 esquinas de la caja (o x/y/w/h derivados)
    // Fase 2 (quad): 4-8 puntos; Fase 3 (roto IA): hasta 16
  ]
}
```

Coordenadas siempre normalizadas 0..1 sobre el frame de origen (igual que
`MaskPointSchema`, `timeline.ts:468-474`), para que sobrevivan cambios de
resolución/proxy. El render valida, como la estabilización, que el rango
`inFrame/outFrame` del archivo coincida con la ventana de origen del clip
patrón `ClipStabilizationSchema.superRefine`, `timeline.ts:542-550`.

### 5.3 Contrato Rust ⇄ TS

Misma forma que el facial: `analyze_object_track` / `analyze_plane_track`
devuelven muestras + keyframes decimados listos (el facial ya hace este
reparto: análisis en Rust, keyframes en TS, `shorts.rs:604` +
`face-mask.ts:15`), y escriben el archivo denso dentro del proyecto.

## 6. Mapa de piezas: TS/React vs Rust vs ONNX

| Pieza | Dónde | Fase |
|---|---|---|
| Selección de caja/quad, overlay SVG, edición de vértices, progreso | `VfxView.tsx` (React, SVG 0..1 ya normalizado) | 1–3 |
| Acciones de estado (aplicar track a máscara/transform) | `state/project-actions.ts` | 1 |
| Esquema de keyframes con `points` + `ClipTrack` + regenerar JSON Schema | `packages/project-schema/src/timeline.ts` | 2a/2c |
| Comandos de análisis (frames → trayectorias → archivo denso) | `src-tauri/src/commands/tracking.rs` (nuevo) | 1–2 |
| Shi-Tomasi, KLT piramidal, NCC, DLT/RANSAC, suavizado | idem, Rust puro + `video_rs::decode` (`preview_frame.rs:225-265`) | 1–2 |
| Compilación a filtros FFmpeg (geq con vértices animados; `perspective eval=frame` para corner pin) | `src-tauri/src/render/ffmpeg.rs` (`mask_filter`, nuevo `corner_pin_filter`, reutiliza `keyframe_expression:327`) | 2a/2c |
| Rasterizado de máscara densa + `alphamerge` | Rust (`video-rs` + rasterizado propio) → grafo existente (`ffmpeg.rs:802-805`) | 3 |
| Segmentación/propagación de video (roto IA) | ONNX Runtime ya integrado (`background.rs:89-202`), modelo en catálogo `models.rs:56-116` | 3 |
| Descarga/modelos/hash/licencias | `commands/models.rs` (sin cambios de infraestructura) | 3 |

Regla general: **React/TS = interacción y estado del proyecto; Rust = visión
por computador y filtros de render; ONNX = solo lo que no se logra
clásicamente en CPU (segmentación semántica de video)**. Nada del MVP ni del
planar necesita IA.

## 7. Riesgos globales

| Riesgo | Fase | Mitigación |
|---|---|---|
| Calidad del tracker propio vs OpenCV CSRT | 1–2 | NCC de respaldo, forward-backward check, confianza por frame, edición manual; opcional 2.5: tracker ONNX Nano (~1,9 MB) como hace Kdenlive |
| Coste de `geq` por píxel con expresiones largas | 2a | Capar vértices/claves compiladas; decimación por tolerancia; si no alcanza, máscara pre-rasterizada en Rust (Fase 3) |
| Tope de 32 keyframes y desalineación con face-mask (48) | 1 | Subir `MAX_MASK_KEYFRAMES` + JSON Schema + tests del esquema |
| Reloj `t` vs `N` tras `zoompan` en `perspective` | 2c | Test de grafo dedicado (patrón vidstab `ffmpeg.rs:6282-6395`) |
| Deriva/oclusiones largas | 2 | Marcar frames de baja confianza, re-propagar rangos, override manual por frame |
| Rendimiento de SAM 2 en CPU | 3 | Variante tiny, análisis a fps decimado, sesión única reutilizada; fallback MobileSAM |
| Licencias/peso de modelos nuevos | 3 | Catálogo con licencia+hash (ya existe); verificar checkpoints concretos antes de publicar |
| Expresión de validación: `points` por keyframe y compatibilidad de proyectos viejos | 2a | Campo opcional; proyectos viejos no lo traen y renderizan igual |

## 8. Coste estimado por fase (dev, días hombre)

| Fase | Trabajo | Días |
|---|---|---|
| 1 | `tracking.rs` (KLT+NCC), esquema (tope 120), UI «Seguir objeto», tests | 4–6 |
| 2 | DLT/RANSAC + suavizado de homografía, keyframes `points`, `geq` animado, `ClipTrack` + corner pin `perspective`, tests de grafo | 8–10 |
| 3 | Integración SAM 2 ONNX, contorno→polígono, rasterizado Rust + `alphamerge`, UX «Roto IA», medición de rendimiento | 15–20 |

El MVP es independiente: si solo se aprueba la Fase 1, Olyvia ya gana
«resaltar/pegar seguimiento a cualquier objeto» con el esquema actual.

## 9. UX en la vista VFX (resumen de interacción)

1. **Seguir objeto** (Fase 1): botón en el nodo 03 → dibujar caja en el visor
   → «Mover: centro/caja» → Analizar (progreso + cancelar) → keyframes en la
   máscara o transform; overlay dibuja la caja por frame; claves editables.
2. **Seguir plano** (Fase 2): colocar 4 puntos (snap opcional) → Analizar →
   quad animado; arrastrar un vértice en cualquier frame crea override;
   botón «Pegar capa» que aplica corner pin a un clip overlay seleccionado.
3. **Roto IA** (Fase 3): caja/punto → propagar → polígono editable con
   densidad configurable; re-propagar rangos; aviso de modelo descargado.
4. Transversal: los estados de confianza bajos se pintan con vértices huecos
   y la barra de progreso usa el evento `track-progress`; textos en español
   siguiendo el tono de la vista («Hacé clic», «Quité el fondo», etc.).

## 10. Verificación propuesta cuando se implemente

Siguiendo el estilo del audit: unit tests del esquema (keyframes con
`points`), tests de conversión track→keyframes (patrón `face-mask.test.ts`),
tests de grafo que verifiquen las expresiones `geq`/`perspective` generadas
(patrones `ffmpeg.rs:6282-6395` y 7442-7513), y un render live de verificación
(caja sintética en movimiento + máscara que la sigue, midiendo luma
dentro/fuera como el export VFX verificado en `docs/AUDIT.md:15-17`).

## 11. Fuentes (consultadas en este pase, 2026-10-24)

**Editores open source**
- Kdenlive — Motion Tracker: <https://docs.kdenlive.org/en/effects_and_filters/video_effects/alpha_mask_keying/motion_tracker.html>
- MLT — filtro opencv.tracker (dos pasadas): <https://www.mltframework.org/plugins/FilterOpencv-tracker/>
- Shotcut — Motion Tracker (documentación oficial en foro): <https://forum.shotcut.org/t/motion-tracker-video-filter/40784>
- Shotcut — Corner Pin + Motion Trackers: <https://forum.shotcut.org/t/corner-pin-filter-with-motion-trackers/51971>
- Shotcut — algoritmos del Motion Tracker: <https://forum.shotcut.org/t/about-the-algorithm-options-in-the-motion-tracker-filter/48312>
- Olive — issue #590 (sin motion tracking): <https://github.com/olive-editor/olive/issues/590>; issue #190 (estabilización): <https://github.com/olive-editor/olive/issues/190>
- Blender — Create Plane Track (homografía): <https://docs.blender.org/manual/en/2.80/movie_clip/tracking/clip/editing/solve.html>; múltiples plane tracks: <https://blender.stackexchange.com/questions/33203/how-to-do-multiple-plane-tracks-from-one-video>
- VidStab (ya integrado): <https://github.com/georgmartius/vid.stab>

**Referencia comercial**
- Mocha — planar tracking: <https://borisfx.com/blog/learn-how-to-do-planar-tracking-with-mocha-pro>; producto y PowerMesh: <https://borisfx.com/products/mocha-pro>

**Algoritmos y trackers**
- OpenCV — tutorial de optical flow (Shi-Tomasi + LK): <https://docs.opencv.org/3.4.20/d4/dee/tutorial_optical_flow.html>
- Comparativa CSRT/KCF/MOSSE/GOTURN: <https://www.sighthound.com/blog/csrt-kcf-opencv-tracker-real-time-video>; <https://www.pyimagesearch.com/2018/07/30/opencv-object-tracking/>
- KLT en Rust vía bindings: <https://docs.rs/opencv/latest/opencv/video/fn.calc_optical_flow_pyr_lk.html>
- Optical flow Rust puro: <https://crates.io/crates/optical-flow-lk>; <https://github.com/den59k/lucas-shi-rust>
- RANSAC/homografía Rust puro (rust-cv): <https://github.com/rust-cv/cv>

**FFmpeg**
- Filtros (`perspective`, `eval=frame`, variable `t`): <https://ffmpeg.org/ffmpeg-filters.html>
- Commit que documenta `t` con `eval=frame`: <https://fuchsia.googlesource.com/third_party/ffmpeg/+/2e8a51735a04599617de58474dfe2b372299f8db%5E1..2e8a51735a04599617de58474dfe2b372299f8db>

**Modelos ONNX**
- SAM 2 (Meta): <https://docs.ultralytics.com/models/sam-2>
- Exports ONNX (SAM/MobileSAM/EfficientSAM/SAM 2): <https://github.com/vietanhdev/samexporter>; variante tiny: <https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx>; SAM 2 en CPU (onnxruntime-web): <https://medium.com/@geronimo7/in-browser-image-segmentation-with-segment-anything-model-2-c72680170d92>
- CoTracker3 (sin ONNX oficial): <https://github.com/facebookresearch/co-tracker>; paper: <https://arxiv.org/html/2410.11831v1>
