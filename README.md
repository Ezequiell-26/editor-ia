# Editor IA

Editor de video local-first para Windows, con timeline multipista, asistencia de
IA opcional y exportación MP4 verificada. El proyecto, los medios y las claves se
quedan en tu equipo; la nube no es obligatoria.

## Qué existe hoy (verificado)

- **Aplicación de escritorio Tauri 2 + React + TypeScript estricto** con ventana
  propia sin bordes nativos, comandos IPC allowlisted y diálogos de Windows. La UI
  tiene once vistas: Proyectos, Director, Producción, Fábrica, Editor, Guion,
  Medios, Convertir, Aprender, MCP y Ajustes.
- **Shell minimalista a pantalla completa**: sin logo ni nombre de la app en la
  esquina superior izquierda; menú profesional **Archivo, Editar, Ver,
  Reproducción, Herramientas y Ayuda** con acciones reales y atajos; rail de
  iconos con tooltips al pasar el mouse o enfocar con teclado; barra de proyecto
  compacta, controles de ventana propios y barra de estado opcional. El contenido
  usa todo el ancho disponible y el editor ocupa el alto completo.
- **Extremadamente fácil de empezar**: modal de bienvenida con tres caminos
  (crear, tutorial o abrir), vista **Aprender** con ruta rápida de cinco pasos,
  guía completa, búsqueda y progreso local, botón de tutorial en la barra y un
  tutorial Markdown en [`docs/TUTORIAL.md`](docs/TUTORIAL.md).
- **Perfil local abajo a la izquierda**: foto recortada a 256 px, nombre y rol,
  con menú para editar, abrir el tutorial, ajustes o proyectos. Todo queda en
  `localStorage`; no se envía a ningún servidor.
- **Cualquier formato y fps**: creación con 16:9, 9:16, 1:1, 4:5, 4:3, 21:9 o
  ancho/alto personalizados (16–16 384 px, dimensiones pares) y fps exactos
  (23,976/24/25/29,97/30/50/59,94/60/120 o numerador/denominador libre). Cambiar
  fps desde el Inspector reajusta clips, assets, subtítulos, escenas y perfiles
  conservando los segundos; los clips con velocidad distinta de 1× se deben
  volver a 1× para conservar la identidad exacta. Cada proyecto recibe un perfil
  de exportación **“Formato del proyecto”** que sigue su canvas.
- **Apariencia personalizable y persistente**: cinco temas (menta, ámbar,
  violeta, océano, grafito), colores exactos de acento/secundario/fondo/
  superficie/texto, familias tipográficas para interfaz, títulos y
  monoespaciada, escala global 85–120 %, densidad, ancho y etiquetas del rail,
  radio de esquinas, alto de filas de timeline, barra de estado y reducción de
  animaciones. Se guarda sólo en `localStorage`, nunca en el proyecto.
- **Gestor de servidores MCP local**: agrega servidores stdio por comando y
  argumentos, guarda los **nombres** de las variables de entorno y sus valores
  en el Administrador de credenciales de Windows, prueba el handshake MCP,
  lista herramientas (`tools/list`) y ejecuta una herramienta con argumentos JSON
  (`tools/call`). Nada se inicia al guardar: sólo al pulsar Probar o Ejecutar.
  Es una implementación acotada del transporte stdio, no un marketplace remoto.
- **Google Flow vía MCP**: puente local con el servidor
  [vynnlee/google-flow-mcp](https://github.com/vynnlee/google-flow-mcp) sobre un
  perfil de Chrome dedicado y CDP 9333. La vista MCP detecta
  `flow_generate_image`/`flow_generate_video` y muestra un generador con prompt,
  modelo, aspecto, duración y **confirmación explícita de créditos**. Los
  artefactos se guardan en `media/`, se importan a Medios con confirmación de
  derechos y se pueden montar en la timeline. Requiere iniciar sesión manualmente
  una vez en esa ventana de Chrome; no se leen cookies ni credenciales.
  [Guía de integración](docs/integrations/GOOGLE-FLOW-MCP.md).
- **UI de estudio profesional (CapCut/DaVinci)**: tema control-room oscuro con
  acento menta, tipografía de display/texto y cifras monoespaciadas; el editor
  ordena **medios a la izquierda, Inspector al centro con pestañas
  Video/Audio/Velocidad/Color/Estilo/Todo, preview a la derecha y timeline
  abajo**. La timeline tiene reglas mayores/menores, cabeceras de pista con
  mute/ocultar/bloquear, olas de audio reales decodificadas del material,
  playhead con grip y guías de composición seguras en la preview. El rail de
  medios tiene búsqueda, filtro por tipo, duración y marca de “en timeline”; la
  barra de timeline se compacta a iconos en ventanas angostas. La biblioteca
  también tiene búsqueda y filtro, y el estado de guardado se muestra compacto
  con punto de fase.
- **Director automático local**: mide escenas, silencios, negros, frames
  congelados, loudness, piso de ruido y luminancia/saturación con FFmpeg;
  transcribe con Faster-Whisper y arma un plan explicable con cortes, limpieza
  de muletillas no léxicas, eliminación de tomas repetidas por similitud de
  texto, cadena de voz (HPF/compresor/denoise medido), normalización de loudness,
  subtítulos y corrección conservadora de exposición. Cada corte queda como un
  clip normal y se puede deshacer. Incluye una **memoria local** por plataforma
  que se calibra con los cambios que el usuario conserva y una puerta de
  calidad antes de exportar.
- **Fábrica de contenido masivo**: un brief genera **N variantes** (1–10) con
  guion propio, voz SAPI local forzada para no consumir créditos, imágenes o
  videos compartidos, Ken Burns, disolvencias y subtítulos. Cada variante se
  escribe como `.editoria.json` portable en una carpeta común con `media/`
  compartida; opcionalmente renderiza un MP4 por variante de forma secuencial. No
  sobrescribe variantes existentes y añade un sufijo único por corrida.
- **Autopiloto IA de punta a punta**: dentro de Fábrica, un trabajo encadena
  guion → voz local → **una imagen o un video por escena con Flow (opcional)** →
  importación con derechos → montaje con video/imagen por id de escena →
  subtítulos y disolvencias → `.editoria.json` portable → MP4 verificado. La
  cola queda en `localStorage`, sobrevive al reinicio, permite cancelar entre
  etapas y **reanudar solo el render** sin volver a generar medios. La generación
  con Flow exige autorización de créditos por trabajo y se detiene antes de
  llamar al MCP si falta. Los videos generados más cortos que la narración se
  estiran hasta 2× o se reemplazan por una imagen para no cortar la voz.
- **Importar y exportar SRT/VTT**: pegá un archivo de subtítulos o exportá la
  pista principal como SRT desde el Inspector; los tiempos se convierten al fps
  del proyecto y los títulos se conservan.
- **Subtítulos animados palabra por palabra**: la transcripción guarda los
  tiempos de cada palabra; la preview resalta la palabra activa y el render
  genera eventos ASS con el resaltado (karaoke) además del texto completo.
- **Ducking automático de música**: se eligen pistas de voz y de música en el
  Inspector; el render usa `sidechaincompress` con reducción configurable.
- **Umbral de silencio configurable** en el Director (dB y duración mínima) en
  lugar de un valor fijo.
- **Convertidor de medios**: los assets listos del proyecto se pueden convertir
  a PNG, JPEG, WebP, MP4 (H.264/AAC), WebM (VP9/Opus), MOV, GIF, MP3 o WAV, con
  calidad y ancho máximo, salida atómica verificada por FFprobe y sin
  sobrescritura. La carpeta de destino se puede escribir o elegir con el
  diálogo; el valor por defecto es la carpeta del proyecto.
- **Proyectos portables** `.editoria.json` con esquema v1 versionado (Zod + JSON
  Schema + validación espejo en Rust), creación, apertura, guardado atómico,
  autoguardado y lista de recientes. **Guardar como** copia los medios
  referenciados a la nueva carpeta y rechaza sobrescribirlos. Un guardado fallido
  nunca se muestra como exitoso.
- **Importación de medios no destructiva**: el archivo se copia a `media/`, se
  mide con FFprobe, se hashea con SHA-256 y queda con licencia y procedencia
  declaradas por la persona. La biblioteca muestra miniaturas generadas con
  FFmpeg y permite montar clips o narrración.
- **Timeline multipista en frames**: pistas de video, imagen, audio, narración,
  subtítulos y gráficos; arrastrar, recortar, dividir, copiar/pegar con Ctrl+C/Ctrl+V, borrar con ripple y mover entre pistas
  compatibles, zoom, playhead y eliminación. La transformación por clip incluye
  posición, escala, rotación, opacidad, **volteo horizontal/vertical** y presets
  de rotación 90/180/270°. Los solapamientos y las ventanas de
  origen se validan antes de aceptar cada edición. **Velocidad uniforme
  0,1x–4x** con presets, conservación exacta de la ventana de origen y ripple de
  los clips siguientes en la misma pista.
- **Color y efectos por clip** (video/imagen): brillo, contraste, saturación,
  temperatura, **ruedas de color RGB para sombras/medios/luces**, **HSL selectivo
  por rangos**, **rotación de tono**, **curvas de color con presets** (contraste
  suave/medio/fuerte, vintage, cross-process, oscurecer, aclarar), viñeta,
  nitidez, desenfoque, blanco y negro, sepia y fades visuales de entrada/salida.
  **Looks rápidos** (Cálido, Frío, Cine, Vintage, B/N) aplican un punto de
  partida conservando los fades. Se editan en el Inspector y se renderizan con
  filtros FFmpeg; la preview es aproximada.
- **Look del proyecto**: grade global (presets, brillo, contraste, saturación,
  temperatura, tono, curvas, viñeta, nitidez, desenfoque, B/N, sepia y **LUT
  `.cube`**) sobre el compuesto final, antes de subtítulos y títulos. No modifica
  los clips y se guarda en el `.editoria.json` como raíz `look`.
- **Menú contextual en la timeline**: clic derecho sobre un clip para dividir en
  el playhead, duplicar, copiar y pegar, ir al inicio, eliminar o eliminar
  cerrando el hueco. Navegable con flechas, Home, End y Escape.
- **Keyframes de transformación, opacidad y volumen**: claves de escala,
  desplazamiento, rotación, opacidad y ganancia por clip, con curvas de easing
  (lineal, acelerar, desacelerar, suave, mantener), UI en el Inspector,
  interpolación en la preview y render FFmpeg evaluado por frame: expresiones para
  escala/rotación/desplazamiento/volumen y `sendcmd` para la opacidad (muestreada
  por frame, hasta 300 pasos por clip).
- **Velocidad y audio creativo**: **rampa de velocidad** de tres tramos y
  **curva suave** de 6–16 tramos contiguos, ambas conservando duración y ventana
  de origen; **reverse** de video/audio; y **efectos de voz** locales (grave,
  aguda, robot, eco, cueva, radio/teléfono).
- **Cortes al ritmo (beat sync)**: el Inspector de un clip de audio detecta los
  golpes en la máquina (energía/flujo, sin red ni modelo) y muestra BPM, cantidad
  de pulsos y confianza. “Cortar video al ritmo” divide la pista de video superior
  en esos frames, con paso de 1/2/4/8 pulsos y guarda de velocidad 1×. Si el pulso
  es irregular, lo dice en vez de inventar cortes.
- **Transiciones de entrada**: disolvencia, fundido a negro y deslizamiento
  horizontal, superpuestas al clip anterior sin cambiar la duración de la
  timeline.
- **Animaciones de entrada y salida**: por clip, con fundido o deslizamiento
  (izquierda/derecha/arriba/abajo), duración en frames y presets Suave, Dinámica
  y Deslizar. Se reproducen dentro del clip, no mueven a los vecinos y conviven
  con Ken Burns, la transición y los keyframes.
- **Proxies de edición**: un video se puede convertir a un proxy H.264/AAC de
  hasta 854 px, guardado en `media/proxies`; la preview lo usa y el MP4 final se
  renderiza desde el original.
- **Freeze frame**: exporta el frame exacto del playhead a PNG, lo importa y lo
  monta como capa de imagen de 2 s; se puede recortar o mover como cualquier clip.
- **Estabilización local (vidstab)**: el Inspector de un video analiza el
  movimiento de su ventana de origen con `vidstabdetect` (FFmpeg local, sin red)
  y guarda un `.trf` en `media/stabilizers`; el render aplica
  `vidstabtransform` antes que cualquier otro filtro visual, con suavizado
  1–60 y recorte negro. El análisis y el render usan la misma ventana; si el
  clip se recorta, se le cambia la velocidad, se invierte o tiene transición de
  entrada, el render se niega en vez de desalinear la transformación. La preview
  no simula la estabilización.
- **Títulos animados y estilos de texto**: texto en una pista `Títulos` propia,
  con negrita, itálica, contorno o caja con fondo, sombra, profundidad 3D,
  presets Creador/Caja/Minimal/Grande/3D y animaciones fade/pop/subir.
- **Biblioteca de títulos**: pestaña **Títulos** en el rail izquierdo con siete
  plantillas (Impacto, 3D, Caja, Minimal, Noticias, Cita y Ticker), texto editable y
  alta en el playhead con un estilo propio reutilizable. La preview muestra a la
  vez los títulos y los subtítulos activos.
- **Igualar color**: toma una imagen o video de referencia, muestrea el frame
  actual y el primero de la referencia, normaliza el brillo y aplica ganancias
  por canal con fuerza ajustable. La preview es aproximada.
- **9 modos de mezcla** por clip (multiplicar, trama, superponer, luz suave,
  oscurecer, aclarar, sobreexponer/subexponer color, luz fuerte) con preview
  `mix-blend-mode` y render `blend` contra las capas inferiores.
- **Máscaras**: rectángulo o elipse con centro, tamaño, rotación, feather e
  inversión y keyframes de posición/tamaño/rotación/feather; preview aproximada
  (SVG para rotación) y render por píxel con `geq`.
- **LUT 3D `.cube`**: importación validada a `media/luts`, aplicada en el render
  con `lut3d`. La preview no simula el LUT.
- **Metadatos de publicación sugeridos**: título, descripción, hashtags,
  capítulos por escena y encaje por plataforma (YouTube, Shorts, Reels, TikTok)
  dentro del manifiesto local. No sube ni programa nada.
- **Movimiento de cámara (Ken Burns)** por clip de video/imagen: zoom in, zoom
  out y paneos horizontales/verticales, con intensidad 2–50 %. El render usa
  `zoompan` y conserva la relación de aspecto; la preview lo aproxima.
- **Montaje automático con video, movimiento y disolvencias**: Producción y
  “Auto-montar lote…” aceptan imágenes y videos listos, asignan un medio por
  escena (por orden o similitud de prompt), recortan el video a la narración,
  estiran tomas cortas hasta 2× y agregan Ken Burns y disolvencias de 0–30
  frames. Los videos generados por Flow también entran al montaje.
- **Vista previa sincronizada** con video, imágenes, audio, transformaciones,
  opacidad, efectos y subtítulos; el render final se hace con FFmpeg y la vista
  previa se declara aproximada.
- **Subtítulos** con estilos, edición de tiempos y texto, generación desde el
  guion con tiempos estimados y quemado en el MP4 mediante libass.
- **Guion asistido por IA** con proveedores compatibles con la API de chat de
  OpenAI (OpenAI, Ollama, LM Studio, vLLM u otro endpoint equivalente) o un
  **proveedor simulado** que no hace red. El plan se valida antes de aplicarse,
  se puede editar escena por escena y queda registrado como operación en
  `provenance`. Las llamadas a proveedores pagos requieren confirmación de costo.
- **Vista Producción**: un flujo guiado de guion → recursos → voz → montaje →
  revisión. Genera narración local por escena (SAPI), asigna imágenes en orden o
  por coincidencia de prompt, aplica movimiento Ken Burns alternado y fades de
  transición configurables, monta audio e imágenes en la timeline y crea
  subtítulos con la duración exacta de cada audio. El resultado se revisa y se
  abre el diálogo de exportación en el editor.
- **Prompts de storyboard para Flow**: cada escena produce un prompt de imagen
  con estilo editable y exportación `.txt` de una línea por prompt, lista para la
  extensión. La nota visual de la escena se usa como sujeto; la narración se puede
  incluir como contexto. La tarjeta guarda la **URL del proyecto de Flow** y la
  abre con tu propia sesión de Google; no maneja tu cuenta.
- **Extensión Flow Queue (Chrome MV3)** en `extensions/flow-queue` para Google
  Flow: modelo, formato, hasta 4 referencias, importación `.txt` sin duplicados,
  ritmo de cola, pausa/detener, descarga numerada `001_slug.png` y manifiesto
  JSON. Se instala como extensión descomprimida y no tiene servidor propio. Fue
  validada contra el DOM real de Flow y una generación real; la carga de
  referencias usa el selector nativo de Flow y tiene un modo manual explícito.
- **Auto-montar lote**: importa varias imágenes y una narración, las ordena por
  nombre y arma un storyboard determinista. Sin audio usa los segundos por
  imagen configurados (5 s por defecto); sin guion usa esa misma duración. No
  finge alineación palabra-imagen. Aplica Ken Burns y transiciones si se piden.
- **Transcripción local con Faster-Whisper**: desde el clip de audio/video, un
  botón transcribe en CPU con el modelo `small` y agrega los segmentos como
  subtítulos en la posición exacta del clip. No usa red ni sube el material.
- **Detección de escenas y corte automático**: FFmpeg analiza cambios de escena
  en un video local, muestra los cortes y permite dividir el clip en varias
  partes sin subir el material a ningún servicio.
- **Suite de audio por clip**: high-pass/low-pass, EQ de tres bandas, compresor,
  **de-esser**, **puerta de ruido** (`agate`), reducción de ruido `afftdn`,
  ganancia, fades y presets “Voz clara”/“Música”.
  El proyecto agrega ganancia master, limitador y **normalización loudness** con
  presets -14 LUFS (YouTube/Shorts/TikTok) y -23 LUFS (broadcast), aplicada con
  `loudnorm` en una pasada.
- **Chroma key**: remoción de fondo por color (`#rrggbb`, similitud y mezcla) en
  video/imagen, con alfa para la capa inferior y presets verde/azul. Es chroma
  clásico, no segmentación por IA.
- **Web TTS Bridge (Chrome MV3)** en `extensions/web-tts-bridge`: extensión
  companion para webs de voz. Con permiso por sitio, escribe el texto, busca un
  botón de generar/sintetizar, espera el audio y lo descarga en
  `Descargas/web-tts/`. Se detiene ante login, captcha o pago; no los evade.
  Heurística probada con fixtures DOM, **no todavía contra una web china real**.
- **Narración local gratuita** con Windows SAPI: enumera voces instaladas,
  sintetiza a WAV y lo agrega al proyecto, sin enviar el texto a un servicio.
- **Proveedores de audio**: Windows SAPI local, **ElevenLabs por API oficial**
  (clave en el almacén de Windows, confirmación de consumo de créditos, voces y
  modelos desde la API) y **web externa manual** (abre una URL HTTPS para generar
  y descargar audio, que después se importa en Medios). La app no inicia sesión
  ni automatiza sitios de terceros.
- **Auditoría de publicación**: puntaje de preparación, materiales listos,
  licencias, duplicados por hash, subtítulos, perfiles y variantes. Genera un
  **manifiesto JSON local** con hashes, derechos, procedencia, escenas y entrega,
  útil para créditos y monetización.
- **Entrega multipropósito**: perfiles 16:9, 9:16 y 1:1 con variantes YouTube,
  Shorts y feed.
- **Exportación en lote**: elegí una carpeta una sola vez y renderizá en secuencia
  todos los perfiles seleccionados, con nombres deterministas. El lote se detiene
  si un archivo ya existe o si un render falla; cada salida sigue pasando por
  temporal, FFprobe y publicación verificada.
- **Render MP4 H.264/H.265+AAC real** desde Rust: composita video/imagen, mezcla
  audio, aplica fades, ganancia, velocidad y efectos de color, quema subtítulos,
  reporta progreso y permite cancelar. Un render solo se marca `completado`
  después de que FFprobe verifica archivo, tamaño mínimo, duración y resolución.
- **Tamaño y velocidad controlables**: presets de compresión **Rápido**
  (`ultrafast`, CRF 23), **Equilibrado** (`veryfast`, CRF 22), **Compacto**
  (`faster`, CRF 27, audio 96 kbps) y **Máxima calidad** (`medium`, CRF 18), más
  selector H.264/H.265. Los perfiles nuevos usan CRF en lugar de 8 Mbps fijos.
  El diálogo aplica el preset a todos los perfiles y muestra encoder/audio
  resultantes. **Encuadre** `Contener` o `Recortar para llenar` por perfil: el
  segundo escala y recorta centrado para evitar barras al pasar de 16:9 a
  9:16/1:1 (no es smart reframe por IA).
- **Almacén de credenciales de Windows** (`keyring`/Credential Manager): la clave
  del proveedor no vive en el proyecto, en `localStorage` ni en los logs.
- **Suite de pruebas**: esquema de proyecto, acciones de timeline, UI con jsdom,
  apariencia, gestor MCP con servidor fixture real, contrato del render-worker,
  crate Rust y render real de humo con FFmpeg.
- **CI de verificación y empaquetado Windows** en `.github/workflows/`:
  instalador NSIS generado desde el commit exacto y subido solo si existe.

## Qué no existe todavía

La auditoría de paridad con CapCut, Filmora y DaVinci Resolve está en
[`docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md`](docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md):
enumera qué se observó en los artefactos instalados (REA), qué se implementó y
qué falta. El inventario medido de CapCut 9.4.0.4015 (184 tipos de keyframe y 52
flags) está en
[`docs/reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md`](docs/reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md).
**No se afirma paridad total**: son suites de años y esta versión cubre las
primitivas de edición de esta pasada, no todos sus módulos.

- **Keyframes incompletos y velocidad**: existen claves de
  escala/posición/rotación/opacidad/ganancia con easing y render, una rampa de
  velocidad de tres tramos, reverse y tres transiciones. Faltan curvas de
  velocidad por frame (la curva suave es de tramos discretos), wipes adicionales
  y motion
  tracking. La velocidad uniforme por clip sigue disponible.
- **Color avanzado y máscaras**: hay curvas por preset, rotación de tono y LUTs
  `.cube`; no hay editor de curvas punto por punto, ruedas, qualifiers/HSL
  selectivo, blend modes ni track matte. El chroma key clásico sí está.
- **Audio suite**: hay EQ de 3 bandas, filtros, compresor, `afftdn` y loudness;
  no hay voice isolation por modelo; el ducking por sidechain sí está implementado.
- **Bins, proxies, relink, multicam, motion tracking y smart reframe**: no
  existen. La detección de escenas y cortes del Director sí existe. La
  estabilización local con vidstab ya está (sólo a 1×, sin reverse ni transición
  de entrada), pero no hay motion tracking ni smart reframe.
- **Remoción de fondo por IA, voice isolation por modelo y matting**: hay chroma
  key por color, `afftdn` y compresor; no hay segmentación de personas/objetos ni
  separación de voz con un modelo neuronal.
- **Remotion**: sigue fuera de alcance hasta validar su licencia para uso
  comercial automatizado; no se integra a ciegas.
- **Motor de clips gráficos**: el formato los admite, pero el renderer nativo
  rechaza un clip gráfico visible en vez de omitirlo en silencio.
- **Descarga de stock, investigación con fuentes, publicación en redes, clonación
  de voz y sincronización en la nube**. Nada de eso se simula.
- **Multiplataforma**: el objetivo verificado es Windows x64.
- **Render en paralelo**: hay un render por vez para no saturar la máquina.
- **CLIP y comprensión visual semántica**: no existe. El Director decide cortes
  con silencios medidos, transcripción local, escenas, negros/freezes, loudness y
  señales de imagen; no “entiende” personas, objetos ni intención. Faster-Whisper
  sí se ejecuta localmente para transcribir. No hay alineación forzada
  palabra-imagen en la vista Producción.
- **Generación de imágenes dentro de Editor IA**: el autopiloto puede generar
  una foto o un video por escena del guion, importarlos y montarlos en una sola
  corrida con autorización de créditos. La generación real no se verificó en esta
  máquina porque el Chrome dedicado no tenía sesión de Google ni créditos; el
  flujo se probó con dobles del servicio. El panel manual y la extensión Flow
  Queue siguen disponibles.
- **Carga automática de referencias en Flow**: Flow abre un selector de archivos
  nativo que el content script no puede controlar sin permisos de depuración. La
  extensión permite declarar que las referencias ya se cargaron a mano.
- **Auto-mejora como red neuronal**: la memoria del Director es una calibración
  estadística local y acotada de pocos parámetros; no entrena un modelo ni usa
  datos de otras personas. Se puede restablecer desde la vista Director.
- **Convertidor universal**: sólo acepta los formatos allowlisted de la UI
  (PNG/JPEG/WebP/MP4/WebM/MOV/GIF/MP3/WAV), sólo assets listos del proyecto y no
  recibe flags arbitrarios de FFmpeg.
- **Export silencioso o publicación**: el render se confirma con un diálogo y un
  destino elegido por la persona; no se publica en redes.
- **Automatización de sitios de terceros**: existe **Web TTS Bridge** como
  extensión companion con permiso por sitio y parada ante login/captcha/pago.
  La app en sí no controla el navegador ni evita restricciones. Las webs de audio
  gratuitas se usan sólo si sus términos lo permiten.
- **Importación automática desde Descargas**: el audio de Web TTS se descarga a
  `Descargas/web-tts/` y se importa a mano desde Medios; todavía no hay un watcher
  que lo ingeste solo.
- **Generación masiva de N proyectos/variantes**: la fábrica ya genera 1–10
  variantes desde un brief y la exportación en lote las renderiza; falta un
  programador/calendario que las publique solo.
- **Publicación directa en YouTube/TikTok**: el producto termina en MP4
  verificado y un manifiesto local.
- **MCP remoto, OAuth y recursos/prompts**: el gestor implementa sólo servidores
  **stdio locales** y los métodos `initialize`, `tools/list` y `tools/call`.
  No implementa transporte HTTP/SSE, OAuth, `resources/*`, `prompts/*`,
  sampling ni servidores del marketplace. Las herramientas MCP no se usan
  todavía dentro del Director ni del generador de guiones.

## Flujo de punta a punta

1. **Guion**: generá las escenas o escribilas a mano.
2. **Prompts**: en la tarjeta “Prompts para Flow”, elegí estilo y descargá el
   `.txt`.
3. **Flow Queue**: cargá la extensión en Chrome, importá el `.txt`, agregá hasta
   4 referencias y iniciá la cola. Las imágenes se descargan numeradas con un
   `manifest.json`.
4. **Storyboard**: en Medios, “Auto-montar lote…”, seleccioná las imágenes y la
   narración; se montan en orden por nombre. Si preferís el flujo completo, en
   **Producción** generá la voz por escena y usá “Generar video automático”.
5. **Ajuste fino y export**: recortá, agregá subtítulos, verificá la preview y
   exportá el MP4. Desde Producción, “Abrir editor para exportar” abre el diálogo
   de exportación.

## Evidencia de la última verificación (2026-10-19)

- `npm run verify`: **445 tests** Vitest en 43 archivos, typecheck estricto
  limpio, **31 tests** de Flow Queue y **10 tests** de Web TTS Bridge. Incluye
  pruebas de formato/fps, compresión, encuadre, curvas, apariencia, tutorial,
  perfil, panel Flow, artefactos MCP, waveforms, Director y fábrica.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **88 passed + 1
  ignored**; `cargo fmt --all -- --check` limpio. Incluye tests de perfiles
  personalizados, preset/códec, encuadre cover, curvas/tono, de-esser/puerta de
  ruido, flips, derechos de artefactos, efectos y Ken Burns en el grafo FFmpeg,
  parsers de silencios/loudness, allowlist de conversión, subtítulos ASS por
  palabra y un **servidor MCP fixture real** por stdio. El test live de render se ejecuta con
  `EDITOR_IA_RUN_RENDER_TESTS=1`.
- **Render live compacto (2026-10-19)**: el pipeline real renderizó 2 s a
  320×180 con movimiento, chroma, de-esser, puerta de ruido, compresor,
  `afftdn`, loudness y subtítulos. El MP4 verificado pesó **84.694 bytes** y usó
  `-preset faster -crf 27 -b:a 96k`; los asserts de args pasaron.
- **Benchmark de presets sobre el demo de 10 s/1080p** (re-encode con FFmpeg
  9.0.1, no un render E2E de la app): Rápido **0,99 s / 11.443.674 bytes**;
  Equilibrado **1,68 s / 4.062.310 bytes**; Compacto **2,15 s / 2.257.899
  bytes**. El original del demo pesa 4.671.301 bytes. Los tiempos y tamaños
  dependen del contenido; el modo Compacto prioriza tamaño y el Rápido prioriza
  terminar antes.
- **Render live con movimiento**: `EDITOR_IA_RUN_RENDER_TESTS=1` renderizó 2 s de
  video con `motion: zoom-in` y fades de entrada/salida; FFmpeg 9.0.1 completó y
  FFprobe verificó 320×180 y duración 2 s. También se validaron por separado las
  expresiones `zoompan` de zoom-in, zoom-out y paneo sobre una imagen real.
- **Render live con audio y chroma**: el mismo test incluye high/low-pass, EQ,
  compresor, `afftdn`, `loudnorm` -14 LUFS y `chromakey`; FFmpeg completó y
  FFprobe verificó 320×180 y 2 s. La disponibilidad de `afftdn`/`loudnorm` en el
  FFmpeg 9.0.1 instalado quedó comprobada por el render real.
- **Detección de escenas**: tests Rust del parser `pts_time` y del filtro
  `select='gt(scene,…)',showinfo`; un video sintético de tres colores produjo un
  corte detectado (`pts_time:4`) con FFmpeg 9.0.1. Falta la prueba E2E de la UI
  sobre un video con cortes reales.
- **Transcripción local real**: el WAV de 2,789 s se transcribió con
  Faster-Whisper `small` en CPU; detectó español (prob. 1.0) y devolvió un
  segmento con palabras y tiempos. El texto tuvo errores menores (“Dender Real de
  Editoria”), así que la UI avisa revisar nombres y puntuación. No se subió audio.
- **Audio y publicación**: se descargó el contrato OpenAPI oficial de ElevenLabs
  (`https://api.elevenlabs.io/openapi.json`, 2.313.394 bytes) y se implementaron
  los endpoints fijos, la clave separada en Windows, la confirmación de créditos
  y la web externa manual. **No hay clave real en esta máquina**, así que la
  síntesis de ElevenLabs no se ejecutó; sí se probaron validación, parseo de voces
  y errores. El auditor y el manifiesto de publicación están cubiertos por tests;
  los perfiles de entrega incluyen **16:9, 9:16 y 1:1**.
- **Manifiesto real desde la app**: “Guardar manifiesto de publicación” sobre
  “Demo completa” escribió `publicacion.json` de **10.135 bytes** con 10 assets,
  6 generados por IA, 8 subtítulos, puntaje **80/100** y 2 grupos de duplicados.
  El archivo quedó en `editor-ia-demo-assets\publicacion.json`. Capturas:
  `editor-ia-shots\app-settings-audio-2026-10-19.png` y
  `app-publication-2026-10-19.png`.
- **Exportación en lote real**: desde el diálogo de exportación se eligió una
  carpeta y se renderizaron los dos perfiles en secuencia. Resultado:
  `demo-completa-youtube-1080p.mp4` (**928.611 bytes**, 1920×1080, 34,03 s) y
  `demo-completa-shorts-1080x1920.mp4` (**937.279 bytes**, 1080×1920, 34,03 s),
  ambos H.264/AAC 48 kHz estéreo, verificados con FFprobe. Captura:
  `editor-ia-shots\app-batch-export-2026-10-19.png`.
- **Extensión Flow Queue smoke test en Chromium real**: carga de la extensión,
  conexión a una página `flow.google.com` servida por el test, selección de
  modelo, ejecución de un prompt y devolución de una imagen PNG 512×512 como data
  URL. No usa una cuenta real de Google.
- **Cola completa con descarga**: un prompt, PNG de 14.822 bytes y manifiesto con
  el estado `downloaded` y la ruta `flow-queue/<runId>/001_....png`. Playwright
  renombra las descargas a UUID en el test; la ruta pedida queda en el manifiesto.
- **Flow real**: inspección del DOM de la pestaña del usuario, escritura de un
  prompt en el editor ProseMirror, configuración de modelo/formato y **una
  generación real** (Nano Banana 2.1, 16:9, 1376×768). La URL firmada se descargó
  con HTTP 200, `image/jpeg`, 463.522 bytes. No se instaló la extensión como panel
  lateral en ese Chrome ni se ejecutó una cola completa; ver
  `docs/reference/FLOW-REAL-DOM-2026-10-19.md`.
- **Vista Producción**: tests de asignación, voz por escena, subtítulos, timeline,
  export request y UI. El build de producción Vite incluye la vista.
- **E2E en la app real**: proyecto “Demo completa” (6 escenas, 2 imágenes), voz
  Microsoft Sabina, montaje automático con **6 audios y 8 subtítulos**, timeline
  de **34,03 s**, export `demo-autoedit.mp4` de **868.615 bytes**, H.264
  1920×1080 30 fps + AAC 48 kHz estéreo, verificado con FFprobe. Frames en 5 s y
  17 s muestran los subtítulos quemados. Ver
  `docs/reference/APP-AUTOEDIT-E2E-2026-10-19.md`.
- `npm run build`: build de producción Vite correcto.
- Render real de humo (`EDITOR_IA_RUN_RENDER_TESTS=1`): 320×180 con video, audio y
  subtítulos quemados; salida verificada por FFprobe.
- Prueba manual en la app real (build de debug): proyecto abierto y autoguardado,
  importación múltiple de medios, timeline de 3 pistas, playback, guion simulado
  de 5 escenas aplicado con `provenance`, y export **1920×1080, 30 fps, 5.00 s,
  2.21 MB** (H.264/AAC) verificado por FFprobe; un frame extraído muestra el
  overlay y el subtítulo quemado.
- TTS local con Microsoft Sabina: WAV de 2.79 s, 22050 Hz, mono.
- **Guardar como** en otra carpeta: 4 medios copiados, proyecto reabierto
  y preview cargada desde la nueva raíz.
- Segundo export de 10 s con el flujo temporal → verificación → publicación:
  **4.45 MB**, H.264/AAC 1920×1080; el MP4 anterior quedó intacto.
- **Montaje automático con movimiento en la app real**: sobre “Demo completa”
  (6 escenas, 2 imágenes) se ejecutó “Generar video automático” en el release.
  El proyecto guardado quedó con **6 clips de imagen** y presets alternados
  `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `zoom-in`, `zoom-out`, todos
  con intensidad 0,12 y fades de **8 frames** de entrada/salida; el Inspector
  mostró “Zoom out”, 12 % y fades 8/8. Capturas en
  `D:\Users\ofici\QODER-WORK\editor-ia-shots\app-motion-2026-10-19.png` y
  `app-production-motion-2026-10-19.png`.
- **Fábrica E2E (2026-10-19)**: desde “Demo completa” se generó **1 variante**
  con brief, 2 escenas, 2 imágenes compartidas y voz SAPI forzada. Resultado:
  `editor-ia-demo-assets/variantes/cmo-automatizar-la-edicin-de-un-video-v1.editoria.json`
  (18.893 bytes), **4 clips, 3 subtítulos, 11,6 s**, con `media/` compartida
  (2 imágenes + 2 WAV). La variante se validó con el esquema. El primer intento
  de render fue rechazado por el piso de tamaño del perfil (500 KB) porque la
  variante es corta y estática; se ajustó el piso de las variantes a 50 KB. El
  test Rust `render_external_project_when_requested` renderizó esa variante
  real en **5,5 s** y verificó el MP4. El render desde la UI queda como flujo
  secuencial opcional.
- **Director automático E2E (2026-10-19)**: un video sintético de **16,3 s**
  con dos tomas repetidas y pausas se analizó y transcribió en la app release.
  El plan detectó **4 silencios**, **1 toma repetida**, generó **4 tomas / 7,9 s**
  y **3 subtítulos**, aplicó HPF+compresor y loudness -14 LUFS. El render quedó
  en **3.714.113 bytes**, 1920×1080, 7,900 s, H.264/AAC; frames en 1,2 s y 4,8 s
  muestran los subtítulos quemados. Después se borró una toma y, al volver al
  Director, la memoria pasó a **2 muestras** y calibró el perfil: duración media
  de plano **2,8 → 3,2 s** y agresividad de corte **55 → 58 %**. Captura:
  `editor-ia-shotspp-director-learned-2026-10-19.png`.
- **Convertidor E2E (2026-10-19)**: desde la vista Convertir se convirtió
  “Demo video” a **WebM VP9/Opus**, 1280×720, 5,008 s, **3.089.320 bytes**,
  verificado con FFprobe; la UI mostró el resultado y la ruta. Captura:
  `editor-ia-shotspp-convert-webm-2026-10-19.png`. Además, el test Rust live
  convirtió el mismo fixture a PNG, JPEG, WebP, MP4, WebM, MOV, GIF, MP3 y WAV.
- **Shell minimalista y MCP verificados en la app real (2026-10-19)**: la ventana
  release sin bordes nativos abrió con la UI embebida; minimizar/restaurar/
  maximizar/cerrar usan controles propios. El gestor MCP se probó con un
  servidor fixture Node real: handshake `2025-06-18`, servidor
  `fixture-editoria 1.0.0`, 2 herramientas, y `echo` devolvió “hola MCP nativo”
  con `isError:false` en 287 ms. Capturas:
  `editor-ia-shots\app-shell-minimal-editor-2026-10-19.png`,
  `app-mcp-native-2026-10-19.png`, `app-shell-settings-2026-10-19.png` y
  `app-shell-amber-2026-10-19.png`.
- **Rediseño de UI verificado en la app real (2026-10-19)**: preview con HUD de
  resolución/fps, aviso de preview aproximada y **guías de composición**
  activables; rail con búsqueda, filtro por tipo, duración por medio y punto
  “en timeline”; **waveforms reales** decodificados del WAV/MP4 vía protocolo
  `asset` (probados con las 6 narraciones de “Demo completa”); timeline con
  reglas menores, cabeceras con iconos de mute/ocultar/bloquear y etiquetas
  humanas (“Narración · 45ec”); biblioteca con búsqueda y filtro; modal de
  exportación con jerarquía única. A **1100×700** la barra de timeline pasa a
  iconos, el rail mantiene una sola fila y el transporte oculta el contador de
  frames sin desbordar. Capturas:
  `editor-ia-shots\app-ui-editor-final-2026-10-19.png` y
  `app-ui-editor-compact-1100-2026-10-19.png`.
- Instalador NSIS local actual (decimoséptima pasada): `Editor IA_0.1.0_x64-setup.exe`, **4.268.571 bytes (4,07 MiB)**, sha256 `496f59d52d04fb4b1b07dd9030d347d37234f06f91dcc54d958878c30ff74900`. Exe release: **15.957.504 bytes**, sha256 `f0b69af147cea2294c2fb87246f52d39ae937c44c35a67b52f26d1de39b07b0e`; build Vite **663.780 bytes JS / 107.560 bytes CSS**. El instalador anterior (4.237.585 bytes, `6eea12c7…`) queda como histórico. **La fuente está adelantada al instalador**: curvas/tono y encuadre cover están en el código con tests, pero no se reempaquetó el instalador porque el usuario pidió no rebuildear sin pedirlo.
- **UI y tutorial (2026-10-19)**: se verificaron en navegador la vista Aprender, el filtro/progreso, el formato/fps personalizado y el perfil con foto redimensionada (JPEG 256 px, 1.551 caracteres) y nombre/rol persistentes. En la app nativa se observó la ruta de aprendizaje y el llavero `editor-ia.welcome.v1` quedó en `seen`. La automatización de Computer Use se detuvo con Escape antes de una captura final del release; no se afirma una revisión visual nativa completa de la última compilación.
- **Re-auditoría REA y batch de color/encuadre (2026-10-20)**: `inspect_pe_resources`
  confirmó el inventario de `CapCut.exe` y `BMDDavUI.dll`; el artefacto de CapCut
  incluye `Resources/Curves`, `DefaultAdjustBundle`, `Chroma/Chroma2`,
  `lvop_intelligent_crop` y modelos de audio. Se implementaron curvas por preset,
  rotación de tono y encuadre de exportación cover (recorte centrado, **no** smart
  reframe). Detalle en
  [`docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md`](docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md).
- **Google Flow MCP (2026-10-20)**: se instaló el conector local
  `vynnlee/google-flow-mcp` commit `425130fc…` en
  `D:\Users\ofici\QODER-WORK\google-flow-mcp`, con Chrome dedicado en CDP 9333.
  `initialize` + `tools/list` devuelven `flow_generate_image`,
  `flow_generate_video`, `flow_status`, `flow_manage_project`,
  `flow_download_latest`, `flow_connect` y `flow_disconnect`. La app lo registró
  como servidor “Google Flow”, agregó un panel de generación, importación y
  montaje de artefactos, y subió el timeout de `tools/call` a 15 minutos. El
  Chrome dedicado quedó abierto en `/about` porque no tiene sesión de Google: la
  generación real requiere que la persona inicie sesión y autorice créditos; no
  se ejecutó ninguna generación ni se consumieron créditos.
- El estado de la primera ejecución de GitHub Actions se comprueba en el remoto;
  ningún workflow se declara verde por haber sido escrito.

## Requisitos medidos

- **Node.js `>= 22`** (`.nvmrc` fija 24; CI usa 22).
- **Rust stable** fijado por `rust-toolchain.toml`.
- **Windows con MSVC** que tenga `link.exe` **y** `lib/x64/msvcrt.lib`. Además,
  el build de Tauri necesita `rc.exe` del **Windows SDK** (no viene dentro de
  todos los toolchains MSVC). `scripts/rust-env.mjs` descubre ambos y exporta
  `LIB`, `INCLUDE` y `PATH`; corré `cargo` siempre con ese prefijo:

  ```bash
  node scripts/rust-env.mjs -- cargo check --workspace
  ```

- **FFmpeg y FFprobe** en `PATH` o elegidos desde Ajustes → Herramientas. Sin
  FFprobe no se importa material medido ni se verifica un render.
- **Windows PowerShell 5.1** con `System.Speech` para la narración local.
- **Python con `faster-whisper`** para la transcripción local. El comando busca
  `EDITORIA_WHISPER_PYTHON`, el venv conocido
  `D:\Users\ofici\MCPs\Video-Editing\Transcription-Whisper\.venv\Scripts\python.exe`
  y luego `python`/`python3`. Sin ese entorno, el botón devuelve un error claro.
- **Node.js/npx** sólo si vas a usar servidores MCP basados en Node (por ejemplo
  `npx -y @modelcontextprotocol/server-everything`). El gestor también puede
  lanzar un ejecutable propio.
- WebView2, que Windows 10/11 ya incluye.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run verify` | typecheck estricto + suite Vitest completa. Puerta de cierre. |
| `npm run typecheck` | `tsc --noEmit` sobre los tres workspaces TypeScript. |
| `npm test` | suite Vitest: esquema, acciones, UI, worker y scripts. |
| `npm run build` | build de producción del frontend en `apps/desktop/dist`. |
| `npm run test:extension` | tests Node de la extensión Flow Queue (prompts, cola, adaptador, manifiesto). |
| `npm run test:web-tts` | tests Node de Web TTS Bridge (adapter, login/captcha, audio, manifiesto). |
| `npm run package:extension` | empaqueta la extensión en `dist/flow-queue-0.1.0.zip`. |
| `npm run dev` | Vite en `:5173` (sin IPC nativo; para revisar la UI). |
| `npm run tauri:dev` | ventana Tauri real en modo desarrollo. |
| `npm run tauri:build` | binario y bundle NSIS de producción. |
| `npm run tauri:build:debug` | binario debug sin bundle, para probar la app. |
| `npm run schema:generate` | regenera el JSON Schema v1 desde Zod. |
| `npm run fixtures:write` | regenera los fixtures de prueba. |
| `powershell -File scripts/verify.ps1` | las mismas puertas que CI, incluido el build del binario. |
| `powershell -File scripts/package-windows.ps1` | verifica y construye el instalador NSIS local. |

El render real de humo (necesita FFmpeg/FFprobe):

```bash
EDITOR_IA_RUN_RENDER_TESTS=1 node scripts/rust-env.mjs -- \
  cargo test -p editor-ia-desktop render_live -- --ignored --nocapture
```

## Arquitectura

```text
apps/desktop/              React + Vite + Tauri 2
  src/                     UI, estado del proyecto, timeline, preview, IA
  src/features/mcp/        gestor de servidores MCP y ejecutor de herramientas
  src/state/appearance.ts  temas, tipografía, escala y persistencia visual
  src/features/production/ vista Producción y montaje automático
  src/state/auto-edit.ts   asignación, voz por escena, subtítulos y timeline
  src-tauri/               Rust: proyecto, medios, render, proveedores, TTS
apps/render-worker/        contrato JSON del worker y descubrimiento de capacidades
extensions/flow-queue/     extensión Chrome MV3 para Google Flow
packages/project-schema/   formato canónico v1 (Zod, fixtures, JSON Schema)
docs/product/              especificación de producto
docs/architecture/         formato del proyecto
docs/automation/           loop de construcción y su ledger
scripts/                   verificación, empaquetado y entorno Rust/Windows
```

Decisiones centrales:

- **Rust es el único dueño del disco y de los procesos.** La UI invoca comandos
  tipados; nunca arma un comando de shell con texto de usuario o del modelo.
- **El proyecto es la fuente de verdad.** Los medios se referencian por ruta
  relativa al proyecto y se validan contra traversal, rutas absolutas y claves
  con forma de credencial.
- **La IA propone, el validador dispone.** El plan del modelo se parsea, se acota
  y se aplica como operación estructurada con revisión humana.
- **Nada se reporta como terminado sin verificación.** Un render `completed` exige
  un archivo real que pase el quality gate del perfil.

## Seguridad, licencias y datos

- Las claves del proveedor se guardan con el **Administrador de credenciales de
  Windows** y se leen sólo en el proceso Rust al hacer una llamada.
- El formato de proyecto rechaza campos con forma de credencial y no las acepta
  ni siquiera bajo el namespace `x-`.
- Cada asset declara `rights.license.commercialUse` y `rights.provenance`. Un
  material con licencia `unknown` no puede estar `ready` y el render se detiene
  si un clip lo usa.
- El TTS usa un script fijo de PowerShell; el texto viaja por `stdin`, nunca como
  parte de la línea de comandos.
- Los logs de render se sanean antes de mostrarse y no incluyen la carpeta del
  usuario.
- La licencia MIT cubre solo el código propio: no otorga derechos sobre medios de
  stock, fuentes, voces ni dependencias de terceros. Remotion no es una
  dependencia de esta versión.

Ver [SECURITY.md](SECURITY.md) para el detalle de la superficie y el reporte de
vulnerabilidades.

## Documentación

- [Especificación de producto](docs/product/PRODUCT-SPEC.md)
- [Formato de proyecto v1](docs/architecture/PROJECT-FORMAT.md)
- [Análisis de la referencia y comparación](docs/reference/VIDEO-ANALYSIS-2026-10-19.md)
- [Auditoría de paridad con CapCut/Filmora/DaVinci (REA)](docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md)
- [Prueba real de Google Flow](docs/reference/FLOW-REAL-DOM-2026-10-19.md)
- [E2E de montaje automático y export](docs/reference/APP-AUTOEDIT-E2E-2026-10-19.md)
- [Tutorial completo de uso](docs/TUTORIAL.md)
- [Google Flow MCP: fotos y videos desde la app](docs/integrations/GOOGLE-FLOW-MCP.md)
- [Gestor de servidores MCP](docs/reference/MCP-MANAGER-2026-10-19.md)
- [Integración Flow Queue ↔ Editor IA](docs/integrations/FLOW-QUEUE.md)
- [Web TTS Bridge: automatización de webs de voz](docs/integrations/WEB-TTS-BRIDGE.md)
- [Loop de construcción y ledger](docs/automation/BUILD-LOOP.md)
- [Seguridad](SECURITY.md)

## Licencia

[MIT](LICENSE), sólo sobre el código fuente propio de Editor IA.
