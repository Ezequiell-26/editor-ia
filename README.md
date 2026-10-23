# Editor IA

Editor de video local-first para Windows, con timeline multipista, asistencia de
IA opcional y exportación MP4 verificada. El proyecto, los medios y las claves se
quedan en tu equipo; la nube no es obligatoria.

## Qué existe hoy (verificado)

- **Aplicación de escritorio Tauri 2 + React + TypeScript estricto** con ventana
  propia sin bordes nativos, comandos IPC allowlisted y diálogos de Windows. La UI
  tiene veintitrés vistas: Inicio, Proyectos, Guion, Medios, Producción, Editor,
  Descargar, Director, Fábrica, Cumplimiento, Convertir, Comparar, Comprimir,
  Denoise, Miniaturas, Localización, AI Hub, Efectos, Fondo, Upscale, MCP,
  Aprender y Ajustes.
- **Comparador antes y después**: cargás la imagen original y la procesada y
  arrastrás una línea para ver el cambio en tiempo real —compresión, color,
  recorte, lo que sea—. Línea operable con mouse, táctil y teclado (flechas,
  Shift para saltar de a 10 %), modo **Diferencia** donde los píxeles iguales se
  ven negros, intercambio de lados y zoom hasta 8×. Vive en **Comparar** y el
  mismo componente va a reutilizarse para frames de video y para el antes y
  después de la compresión.
- **Comprimir como pro**: cualquier video del disco —FFmpeg decide si lo lee,
  no la extensión— con preajustes (YouTube 1080p, WhatsApp por tamaño objetivo,
  Archivo ligero) y el **número verificable** en el centro: *"41,9 MB → 4,2 MB ·
  90 % menos · libx264"*, con botón directo al comparador. Usa aceleración de
  hardware si la placa la ofrece, con **progreso porcentual real** que informa
  FFmpeg (`-progress pipe:1`) y **calidad objetiva VMAF** medible contra el
  original cuando el build trae libvmaf. El mismo motor alimenta al convertidor
  universal y al flujo por asset del proyecto.
- **Inspector de medios**: sondeo completo con ffprobe (formato, duración,
  resolución, códecs, peso) de cualquier archivo, sin proyecto abierto.
- **Quitar fondo con IA local**: modelo u2netp (4,4 MB) corriendo con ONNX
  Runtime en tu equipo —la imagen no sale de la app—, descargado con checksum
  verificado y licencia visible. El resultado es un PNG con transparencia,
  conectado al comparador antes/después. La tarjeta **Capacidades** en Ajustes
  muestra qué puede hacer tu equipo, medido, con el motivo exacto de lo que
  falta.
- **Upscale ×4 con IA local**: Real-ESRGAN (BSD-3-Clause, export de Qualcomm AI
  Hub) agranda una imagen ×4 por teselas con solape, con límite de 2048 por
  lado por memoria y puente directo al comparador.
- **Denoise Studio**: reducción de ruido de imagen y video con **preview WebGL2
  en tiempo real** sobre el frame actual (filtro bilateral 3×3, fuerza, original
  vs. procesado) y **render FFmpeg** con presets `hqdn3d`, `atadenoise` y
  `nlmeans`, progreso real, audio AAC, PNG/MP4 atómico y nombres únicos. El
  preview es una aproximación espacial; el render aplica la calidad completa.
- **Thumbnail Studio**: componé miniaturas en **16:9 (1280×720)**, **9:16
  (1080×1920)** y **1:1 (1080×1080)** con cuatro plantillas, título, subtítulo,
  badge, color de acento y oscurecido en vivo sobre un **canvas real de
  export**, con guías de zona segura. El PNG se valida y re-encodea en Rust, se
  publica con nombre único y rename atómico, sin subir la foto a ningún lado.
- **Localización de subtítulos**: importá SRT/VTT/ASS/SSA y traducí a los ocho
  idiomas con más hablantes (español, inglés, chino, hindi, árabe, portugués,
  bengalí y ruso) con el proveedor configurado —local por loopback u OpenAI
  compatible—. Divide el archivo en lotes, respeta un glosario, exige
  autorización de cuota en proveedores remotos, conserva los tiempos y exporta
  SRT o VTT por idioma con validación y rename atómico. El proveedor simulado no
  inventa traducciones: las marca y bloquea la exportación. **Doblaje local con
  SAPI** en la misma vista: elegís un video del proyecto, un idioma traducido y
  una voz instalada; la app sintetiza cada cue, ajusta la duración, mezcla y
  reemplaza el audio (o conserva música/SFX con `bed_volume`) manteniendo el
  video. **Clonación local** conecta XTTS/GPT-SoVITS. **Lip-sync local** incluye
  un adaptador real para Wav2Lip en `scripts/lipsync-engine/` que escucha en
  `127.0.0.1:8765`; los pesos y el motor quedan fuera de la app (Wav2Lip es sólo
  para uso personal/investigación, no comercial).
- **Efectos y transiciones**: vista **Efectos** para seleccionar varios clips
  visuales y aplicar de una vez un preset (Suave, Onírico, Noir, VHS,
  Documental, Alta/Baja clave, Neón), ajustes rápidos de color/textura o una
  transición de entrada. Muestra el catálogo medido de FFmpeg, el conteo de
  efectos por clip y una **auditoría** de rangos, LUT, transiciones y filtros
  faltantes. Respeta el historial del editor y conserva fades/LUT al aplicar
  presets.
- **AI Hub con skills compactas**: nueve recetas locales (gancho, short, retención,
  reescritura segura, títulos/miniatura, contexto de traducción, metadatos,
  B-roll y voz) que arman un prompt autocontenido con contrato de salida y
  presupuesto de caracteres/tokens. No hay chat ni llamada automática: el prompt
  se copia o el brief se envía a Guion, sin arrastrar la conversación completa.
  El contador es una estimación de 4 caracteres por token, no una tarifa.
- **Auto Shorts en Director**: tras analizar el video, propone hasta cinco
  ventanas de 15–60 s con score explicable (gancho textual, duración, densidad de
  voz, escenas y cierre en silencio) y un plan copiable con tiempos y motivos.
  **Exportar 9:16** genera un MP4 1080×1920 con audio AAC, progreso real y
  verificación de dimensiones. **Smart reframe** descarga un modelo SeetaFace
  local (1,2 MB, BSD-2-Clause), detecta el rostro frontal más grande y mueve el
  recorte con una trayectoria suavizada; si no encuentra rostro, cae al centro.
  No identifica personas ni sigue perfiles con fiabilidad.
- **Ruta de producción de punta a punta**: el rail está ordenado como se
  trabaja —Proyecto → Guion → Medios → Voz → Edición → Exportar— y separado de
  las herramientas. Una **franja de ruta** sobre el área de trabajo muestra el
  paso actual, cuáles ya están hechos y un botón **Siguiente** que lleva ahí; en
  **Inicio** la misma ruta se explica paso por paso. El avance se calcula del
  proyecto (escenas, medios, audios, clips) y de los renders completados.
- **Inicio profesional**: la app abre en un panel de estudio con estado de
  instalación (yt-dlp, FFmpeg, FFprobe, SAPI), acciones para instalar o cambiar
  herramientas, preparación guiada de la extensión de Chrome/Edge, proyectos
  recientes y descarga rápida sin necesidad de proyecto.
- **Shell minimalista a pantalla completa**: sin logo ni nombre de la app en la
  esquina superior izquierda; menú profesional **Archivo, Editar, Ver,
  Reproducción, Herramientas y Ayuda** con acciones reales y atajos; rail de
  iconos con tooltips al pasar el mouse o enfocar con teclado; barra de proyecto
  compacta, controles de ventana propios y barra de estado opcional. El contenido
  usa todo el ancho disponible y el editor ocupa el alto completo.
- **Extremadamente fácil de empezar**: modal de bienvenida con **Pando**, un
  panda SVG original con regla y consejos rotativos; vista **Aprender** con ruta
  rápida de cinco pasos, guía completa, búsqueda y progreso local que registra
  las vistas usadas y completa secciones solo, sin mostrar ni enviar ese
  registro; botón de tutorial en la barra y un tutorial Markdown en
  [`docs/TUTORIAL.md`](docs/TUTORIAL.md).
- **Acciones con iconos**: las barras de herramientas de las vistas usan iconos
  con texto accesible y tooltip; los formularios y las reglas conservan
  etiquetas escritas donde hacen falta para operar.
- **Cumplimiento por red**: ocho paquetes (YouTube, Shorts, TikTok, Reels,
  Facebook, X, Twitch y LinkedIn) auditan derechos, duración, orientación,
  altura, peso, subtítulos, música y divulgación de IA, y muestran requisitos de
  monetización, riesgos de strike y fuentes oficiales. Se actualiza una vez por
  día desde un JSON del repositorio, con caché local y fallback incluido. Es un
  preflight, no una garantía de monetización ni de ausencia de sanciones.
- **Perfil local abajo a la izquierda**: foto recortada a 256 px, nombre y rol,
  con menú para editar, abrir el tutorial, ajustes o proyectos. Todo queda en
  `localStorage`; no se envía a ningún servidor.
- **Cualquier formato y fps**: creación con 16:9, 9:16, 1:1, 4:5, 4:3, 21:9 o
  ancho/alto personalizados (16–32 768 px, dimensiones pares) y fps exactos
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
  La llamada abre una **sesión** que se conserva entre ejecuciones —así un
  servidor que maneja un navegador mantiene la página abierta—, se cierra por
  inactividad (10 min), al guardar o borrar el servidor, o con **Cerrar sesión**.
  Es una implementación acotada del transporte stdio, no un marketplace remoto.
- **Google Flow vía MCP**: puente local con el servidor
  [vynnlee/google-flow-mcp](https://github.com/vynnlee/google-flow-mcp) sobre un
  perfil de Chrome dedicado y CDP 9333. La vista MCP detecta
  `flow_generate_image`/`flow_generate_video` y muestra un generador con prompt,
  modelo, aspecto, duración y **confirmación explícita de créditos**. Los
  artefactos se guardan en `media/`, se importan a Medios con confirmación de
  derechos y se pueden montar en la timeline. Además, **Generación continua**
  encadena una lista de prompts (con repeticiones, espera, tope, corte por fallos
  y ciclo) y sigue corriendo aunque cambies de vista. Requiere iniciar sesión
  manualmente una vez en esa ventana de Chrome; no se leen cookies ni credenciales.
  [Guía de integración](docs/integrations/GOOGLE-FLOW-MCP.md).
- **UI de estudio profesional (CapCut/DaVinci)**: tema control-room oscuro con
  acento menta, tipografía de display/texto y cifras monoespaciadas; el editor
  ordena **medios a la izquierda, Inspector al centro con pestañas
  Video/Audio/Velocidad/Color/Estilo/Todo, preview a la derecha y timeline
  abajo**. La timeline tiene reglas mayores/menores, cabeceras de pista con
  mute/ocultar/bloquear, olas de audio reales decodificadas del material y
  **cacheadas por SHA-256** en `localStorage` (máximo 48 entradas, poda
  automática) para no volver a decodificar el mismo audio al reabrir o
  compartir una variante,
  playhead con grip y guías de composición seguras en la preview. Se navega con
  la **herramienta mano** (H), el **botón central** del mouse, **Shift+rueda**
  para desplazamiento horizontal y **Ctrl+rueda** para zoom bajo el cursor. El
  rail de medios tiene búsqueda, filtro por tipo, duración y marca de “en
  timeline”; la barra de timeline se compacta a iconos en ventanas angostas. La
  biblioteca también tiene búsqueda y filtro, y el estado de guardado se muestra
  compacto con punto de fase.
- **Ajustes como ventana aparte**: al entrar a Configuración se abre una ventana
  flotante de 940×660 (arrastrable desde su barra, se cierra con Esc o con la X)
  sobre la vista actual, que no se pierde. Adentro está el panel en dos columnas
  con Apariencia, Editor, IA, Voz y audio, Atajos, Herramientas, Datos locales y
  Alcance. No es una segunda ventana nativa: se dibuja dentro del WebView, así
  que no suma un proceso ni RAM. **Editor** controla autoguardado, historial,
  zoom inicial, imán, paso de las flechas, capas de la timeline, bucle y guías;
  **Datos locales** incluye el respaldo de la configuración en un JSON y su
  restauración.
- **Color medido y capítulos listos**: LUT `.cube` por clip, por capa de ajuste
  y look global, con **intensidad 0–100 %** mezclada en FFmpeg sin tocar máscaras
  ni opacidad. La preview suma **scopes** de onda de luminancia, vectorscopio de
  croma e histograma RGB del clip visual activo. Los marcadores validan el
  mínimo de capítulos de YouTube (tres cortes y 10 s entre inicios).
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
- **Importar y exportar SRT/VTT/ASS**: pegá un archivo de subtítulos, **elegí un
  archivo `.srt`/`.vtt`/`.ass`/`.ssa` con el diálogo nativo** (extensión, tamaño
  ≤4 MB y UTF-8 validados) o exportá la pista principal como SRT desde el
  Inspector; los tiempos se convierten al fps del proyecto y los títulos se
  conservan. Los ASS/SSA exportados por CapCut, Premiere o Resolve se importan
  con su texto y sus tiempos; el estilo se descarta porque el proyecto define el
  suyo. El archivo elegido se carga en el panel para revisarlo antes de
  reemplazar.
- **Búsqueda global en el proyecto**: `Ctrl+K` indexa medios, clips, marcadores,
  subtítulos, escenas y pistas con MiniSearch (MIT): ignora tildes, tolera
  errores de tipeo, agrupa “En el proyecto” antes de “Acciones” y al elegir un
  resultado abre la vista correcta, selecciona la entidad y mueve el playhead
  cuando corresponde. El índice se arma al abrir la paleta, no en cada edición.
- **Paquete de entrega `.zip`**: Archivo → Empaquetar proyecto genera un ZIP con
  `proyecto.editoria.json`, `subtitulos.srt` (si hay), `derechos.csv` (licencia,
  uso comercial y procedencia por medio), `manifiesto.json` con conteos, hashes
  y perfiles, y `LEEME.txt`. No copia medios: el proyecto los referencia por
  ruta relativa y cada asset conserva su SHA-256. La escritura es atómica y
  valida nombre, firma ZIP y ruta de destino.
- **Smart Bins**: la biblioteca tiene reglas guardadas estilo DaVinci (Video,
  Imágenes, Audio, Favoritos, Listos, Con errores) con su conteo, más
  “Guardar filtro como regla” para convertir la búsqueda actual en un bin propio
  que persiste en `localStorage`. Un smart bin activo reemplaza los filtros
  manuales; la búsqueda de texto sigue aplicando encima.
- **Cola de entregas**: el diálogo de exportación permite encolar el perfil
  actual o todas las variantes del lote. La cola se drena de a un render con
  progreso, se persiste en `localStorage` y **reanuda lo pendiente** si la app se
  cerró; cada entrada se puede reintentar o quitar. Si un render quedó a medias,
  al cargar vuelve a `pendiente` en lugar de darse por bueno.
- **Color con cuatro ruedas**: además de lift (sombras), gamma (medios) y gain
  (luces), Primaries tiene **Offset**, que se mapea a los medios de
  `colorbalance` en FFmpeg. Los scopes suman **Parade RGB** (tres waveforms por
  canal) al waveform, vectorscopio e histograma.
- **Plantillas de título DaVinci**: se suman **Lower Third**, **Text+** (neón con
  extrusión) y **Scroll** (créditos) a las siete existentes; todas son estilos de
  subtítulo, así que se editan y renderizan por el mismo camino ASS.
- **Subtítulos animados palabra por palabra**: la transcripción guarda los
  tiempos de cada palabra; la preview resalta la palabra activa y el render
  genera eventos ASS con el resaltado (karaoke) además del texto completo.
- **Revelado por palabra (lyrics)**: en el Inspector del subtítulo, **Revelar
  por palabra** muestra sólo las palabras que ya empezaron, con la última
  resaltada; el MP4 emite eventos ASS incrementales. Requiere palabras con
  tiempos (por ejemplo, una transcripción); sin ellos se muestra la línea
  completa. Se guarda como `wordReveal` en el cue.
- **Ducking automático de música**: se eligen pistas de voz y de música en el
  Inspector; el render usa `sidechaincompress` con reducción configurable.
- **Umbral de silencio configurable** en el Director (dB y duración mínima) en
  lugar de un valor fijo.
- **Convertidor y compresor por lotes**: los assets listos del proyecto se
  pueden convertir a **21 formatos** (PNG, JPEG, WebP, BMP, TIFF; MP4 H.264,
  MP4 H.265/HEVC, MKV, WebM, MOV, AVI, FLV, MPEG-TS y GIF; MP3, WAV, M4A/AAC,
  AAC, OGG, Opus y FLAC) **en lote**, con calidad, ancho máximo, elección de
  encoder (automático con GPU, hardware forzado o software) y mejoras
  allowlisted (reducción de ruido, enfoque y normalización de audio a −16
  LUFS). El lote corre en una sola llamada nativa con progreso por archivo,
  nunca pisa un archivo existente y reporta por ítem. La compresión acepta
  **calidad (CRF)** o **tamaño objetivo en MB**, que se convierte en un
  presupuesto de bitrate usando la duración medida; cada resultado muestra el
  ahorro respecto del original. Salida atómica verificada por FFprobe.
- **Proyectos portables** `.editoria.json` con esquema v1 versionado (Zod + JSON
  Schema + validación espejo en Rust), creación, apertura, guardado atómico,
  autoguardado y lista de recientes. **Guardar como** copia los medios
  referenciados a la nueva carpeta y rechaza sobrescribirlos. Un guardado fallido
  nunca se muestra como exitoso.
- **Importación de medios no destructiva**: el archivo se copia a `media/`, se
  mide con FFprobe, se hashea con SHA-256 y queda con licencia y procedencia
  declaradas por la persona. La biblioteca muestra miniaturas generadas con
  FFmpeg y permite montar clips o narrración.
- **Organización de medios**: favoritos, **bins** y hasta **8 etiquetas** por
  material, editables desde la tarjeta de Medios y desde el Inspector del asset.
  La búsqueda cubre nombre, ruta, bin y etiquetas; los filtros combinan tipo,
  bin y **Solo favoritos**. El rail del editor muestra la estrella, el bin y las
  etiquetas, y respeta el filtro de favoritos. Se guarda dentro del
  `.editoria.json` con campos opcionales, así que los proyectos anteriores
  siguen siendo válidos.
- **Timeline multipista en frames**: pistas de video, imagen, audio, narración,
  subtítulos y gráficos; arrastrar, recortar, dividir, copiar/pegar con Ctrl+C/Ctrl+V, borrar con ripple y mover entre pistas
  compatibles, zoom, playhead y eliminación. **Cerrar huecos** compacta los clips
  de una pista conservando el inicio del primero; **Subir/Bajar capa** cambia el
  orden de apilado. Los clips visuales y de audio
  muestran **fades arrastrables** en la timeline. La transformación por clip incluye
  posición, escala, rotación, opacidad, **volteo horizontal/vertical** y presets
  de rotación 90/180/270°. Los solapamientos y las ventanas de
  origen se validan antes de aceptar cada edición. **Velocidad uniforme
  0,1x–4x** con presets, conservación exacta de la ventana de origen y ripple de
  los clips siguientes en la misma pista.
- **Marcadores y capítulos**: **M** agrega o quita un marcador en el playhead y
  la regla muestra pines por color; hacer clic en un pin salta a ese frame. Cada
  marcador puede volverse un **rango de 2 s** con fin editable y barra en la
  regla. **Cortar clips en marcadores** divide los clips de las pistas
  desbloqueadas en cada inicio de marcador, sin mover ni recortar nada más. El Inspector del proyecto permite renombrarlos, cambiar frame o color y
  borrarlos, y exporta **Copiar capítulos** / **Descargar .txt** en formato
  YouTube (con `0:00 Inicio` si hace falta). El manifiesto de publicación usa
  los marcadores cuando existen; se guardan como raíz `markers` y los proyectos
  anteriores cargan con lista vacía.
- **Color de clip**: ocho etiquetas (rojo, naranja, ámbar, verde, turquesa,
  azul, violeta y gris) desde el Inspector; la timeline muestra un punto del
  color junto al nombre y **Sin color** lo limpia. El selector **Color** de la
  timeline atenúa los clips que no coinciden. La etiqueta se guarda en
  `colorTag`, no cambia el render y sirve para ordenar B-roll, tomas y música.
- **Snapping magnético**: al mover o recortar clips y al mover subtítulos, el
  imán alinea el extremo más cercano con bordes de clips de **todas las
  pistas**, el playhead, el origen y los marcadores. Muestra una guía vertical
  con el destino y usa un umbral según el zoom (~10 px, 1–12 frames). El botón
  **Imán** lo apaga o prende; mantener **Alt** mientras arrastrás lo desactiva
  temporalmente.
- **Recorte fino (slip/slide/roll)**: pestaña **Recorte** en el Inspector de
  video/audio con un desplazamiento en frames. **Slip** mueve la ventana de
  origen sin mover el clip; **Slide** mueve el clip y reparte la diferencia entre
  sus dos vecinos contiguos; **Roll entrada/salida** mueve el corte con el
  vecino. Conservan la identidad duración × velocidad = ventana de origen, exigen
  velocidad 1× y rechazan keyframes (slide/roll) y estabilización.
- **Color y efectos por clip** (video/imagen): brillo, contraste, saturación,
  temperatura, **sombras**, **altas luces**, **fade tonal**, **ruedas de color
  RGB para sombras/medios/luces**, **HSL selectivo por rangos**, **rotación de
  tono**, **curvas de color con presets** (contraste suave/medio/fuerte,
  vintage, cross-process, oscurecer, aclarar), viñeta, nitidez, desenfoque,
  blanco y negro, sepia y fades visuales de entrada/salida.
  **Looks rápidos** (Cálido, Frío, Cine, Vintage, B/N) aplican un punto de
  partida conservando los fades. Se editan en el Inspector y se renderizan con
  filtros FFmpeg; la preview es aproximada.
- **Look del proyecto**: grade global (presets, brillo, contraste, saturación,
  temperatura, **sombras**, **altas luces**, **fade tonal**, tono, curvas,
  viñeta, nitidez, desenfoque, B/N, sepia y **LUT `.cube`**) sobre el compuesto
  final, antes de subtítulos y títulos. No modifica los clips y se guarda en el
  `.editoria.json` como raíz `look`.
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
  **curva suave** de 6–24 tramos contiguos, ambas conservando duración y ventana
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
- **Freeze frame**: exporta el frame exacto del playhead a PNG y lo importa a
  Medios. **En la pista** divide el video, inserta 2 s fijos sobre la misma pista
  y corre clips, subtítulos y marcadores posteriores; **como capa** lo monta
  encima sin tocar el resto. El clip congelado acepta color, máscara, blend,
  movimiento y animación como una imagen.
- **Descargar de la web**: vista propia con yt-dlp instalable desde la app
  (ejecutable oficial verificado por SHA-256). Analiza el enlace, muestra las
  calidades reales hasta 8K, descarga video, audio o carruseles de hasta 12
  fotos/videos e importa los archivos al proyecto. Acepta enlaces completos,
  dominios sin `https://` y texto compartido con un link adentro. Toda descarga
  queda en `Descargas/Videos descargados/<Plataforma>/<Nombre del video>`
  (YouTube, TikTok,
  Instagram, etc.); con un proyecto abierto además se importa a Medios.
  Permite elegir **Mejor disponible**, **Mínima disponible** o una altura
  concreta. Antes de descargar podés elegir la **carpeta base y el disco** con el
  selector nativo; la elección se recuerda en el equipo y siempre se agrega
  `<Red>/<Nombre del video>` dentro de esa carpeta. Opcionalmente recomprime con
  FFmpeg
  (H.265/H.264 CRF 20/24/27) y conserva el resultado sólo si queda más chico.
  Acepta un `cookies.txt` opcional para sesiones ya iniciadas; no evade DRM,
  captchas ni paywalls. Requiere confirmar derechos antes de descargar.
- **Extensión de navegador** (Chrome/Edge, MV3) en
  `extensions/editor-ia-downloader`: detecta fotos y videos de la pestaña,
  permite elegir resolución y formato y descarga a
  `Descargas/Videos descargados/<Plataforma>` a través de un puente local en
  `127.0.0.1` protegido por token. La app debe estar abierta; no usa la nube.
- **Look global y capas de color**: además del color por clip, el proyecto tiene
  un grade global con presets y LUT `.cube`; se aplica sobre el compuesto antes
  de subtítulos y no modifica los clips.
- **Capas de ajuste por tramo**: una pista `Ajustes` propia acepta capas sin
  medio que aplican brillo/contraste/saturación/temperatura, ruedas, HSL,
  curvas, viñeta, nitidez, desenfoque, B/N, sepia y LUT `.cube` al compuesto
  final sólo entre su inicio y su fin (render con
  `enable='between(t,…)'`). Se crean en el playhead con un clic, duran 3 s por
  defecto y se mueven, recortan y dividen como cualquier clip. No afectan
  subtítulos ni títulos; la preview aproxima el grade del tramo y el look global
  del proyecto se aplica después.
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
  presets Creador/Caja/Minimal/Grande/3D, animaciones fade/pop/subir y
  **movimiento de dos keyframes** (aparecer, zoom, entrar desde izquierda/
  derecha o salir con zoom) con posición, escala, rotación y opacidad
  interpoladas en ASS.
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
  ganancia, **mute por clip**, **separar audio a su propia pista**, **presets de
  audio en lote (Voz clara/Música)**, fades y presets “Voz clara”/“Música”.
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
primitivas de edición de esta pasada, no todos sus módulos. La lista de límites
que sigue es histórica (2026-10-19) y algunas filas ya se implementaron; la
fuente vigente es el addendum de la matriz.

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
- **Descarga de contenido público por URL** ya existe en la vista Descargar
  (yt-dlp, hasta 8K, con compresión local). Siguen faltando el stock con
  licencias, la descarga autenticada con cookies, la investigación con fuentes,
  la publicación en redes, la clonación de voz y la sincronización en la nube.
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
  todavía dentro del Director ni del generador de guiones. Una sesión que falla
  al hablar se descarta y la siguiente llamada arranca de cero: no hay
  reintentos automáticos ni reconexión a mitad de una herramienta.

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

## Evidencia de la última verificación (2026-10-22)

### Denoise Studio (2026-10-22)

- **Preview en tiempo real:** canvas WebGL2 con shader bilateral 3×3, fuerza
  1–100, original/procesado, controles de reproducción y posición. Corre local,
  sobre el frame actual y sin enviar medios.
- **Render:** FFmpeg 9.0.1 con `hqdn3d` (rápido), `atadenoise` (temporal) o
  `nlmeans` (máxima calidad); progreso real por `-progress pipe:1`, salida
  temporal, verificación de tamaño y rename atómico. Audio AAC 192 kbps, video
  H.264 CRF 18; imágenes a PNG. Nombres `<stem>-denoise[-n]` sin sobrescribir.
- **Verificación:** shader compilado y textura dibujada en Chromium (píxel rojo
  correcto); FFmpeg real con `hqdn3d` y `nlmeans` sobre un clip sintético;
  **824 tests en 89 archivos**, Rust **180 passed, 0 failed, 4 ignored**;
  typecheck, build y `cargo fmt --check` verdes. Bundle: entrada **529,55 kB
  JS**, `DenoiseView` **14,88 kB**, CSS **207,66 kB**.
- **UI nativa:** Home a 1376×788 con el rail compacto de 28 px; la vista Denoise
  se recorrió en Chromium. El diálogo nativo de archivo no se automatizó.
- **Límite:** el preview WebGL no es el render; no hay denoise neural 4K en
  tiempo real en esta máquina (iGPU, sin CUDA). `nlmeans` puede tardar minutos.

### Thumbnail Studio (2026-10-22)

- **Composición:** canvas 2D con recorte cover sin deformar, tres formatos,
  cuatro plantillas, texto envuelto con elipsis, badge, acento y overlay. La
  vista previa es el mismo canvas que se exporta, con zona segura de 6 %/7 %.
- **Guardado verificado en Rust:** decodifica el data URL, valida la imagen con
  la crate `image`, comprueba dimensiones (máximo 16 384 por lado), la
  re-encodea a PNG, escribe un temporal oculto, verifica que sea legible y lo
  publica con rename atómico. Sanitiza el nombre, limita corridas de guiones y
  evita sobrescribir con sufijo `-2`, `-3`.
- **Pruebas:** **830 tests en 90 archivos** en la raíz, **474 tests en 68
  archivos** en la app, Rust **184 passed, 0 failed, 4 ignored** (4 tests nuevos
  de miniaturas, incluido guardado real en carpeta temporal). Typecheck, build
  y `cargo fmt --check` verdes. Bundle: entrada **530,12 kB JS**,
  `ThumbnailView` **11,32 kB**, CSS **208,71 kB**.
- **UI:** la vista se recorrió en Chromium a 1376×788 y 1366×736 con el rail
  completo visible; el canvas midió 1080×1920 en vertical y dibujó
  texto y badge. El binario debug se recompiló y relanzó. El diálogo nativo de
  archivo y el guardado desde la UI no se automatizaron.
- **Límite:** no hay recorte manual del fondo, detección de rostro, variantes
  A/B automáticas ni edición por capas; las plantillas son las cuatro incluidas.

### Localization Studio (2026-10-22)

- **Traducción:** importa los subtítulos con el selector nativo, los parsea a
  cues con tiempos y los divide en lotes de hasta 80 cues/6 000 caracteres por
  idioma. Usa el proveedor OpenAI-compatible configurado (Ollama/LM Studio en
  loopback, o remoto con HTTPS) y exige autorización explícita de cuota en
  proveedores remotos. El glosario se incorpora al prompt.
- **Contrato protegido:** Rust acota a 100 cues/12 000 caracteres por llamada,
  valida los ocho códigos de idioma y exige que el modelo devuelva exactamente
  la misma cantidad de textos en orden; si falta, sobra o llega vacío un cue, no
  aplica nada. El proveedor simulado devuelve el original marcado `simulated` y
  la UI bloquea la exportación.
- **Salida:** SRT o VTT por idioma, con los tiempos originales; el comando Rust
  valida formato y cabecera, limita a 4 MB, escribe temporal oculto y publica
  `<nombre>.<idioma>.<formato>` con rename atómico y sufijos sin sobrescribir.
- **Pruebas:** **839 tests en 91 archivos** en la raíz, **483 tests en 69
  archivos** en la app (helper de lotes, serializadores SRT/VTT y flujo de la
  vista), Rust **193 passed, 0 failed, 4 ignored** (9 tests nuevos de validación,
  parser, simulación y guardado). Typecheck, build y `cargo fmt --check` verdes.
  Bundle: entrada **531,61 kB JS**, `LocalizationView` **12,73 kB**, CSS
  **212,70 kB**.
- **UI:** verificada en Chromium a 1376×788 y 1366×736; los ocho idiomas, el
  formato, el glosario y el estado del proveedor se muestran sin desborde
  horizontal, con las 22 entradas del rail visibles. También se corrigió el
  estilo de `primary:disabled`, que en el tema plano seguía pareciendo activo.
- **Límite:** no se llamó a un proveedor real desde esta máquina; la traducción
  se cubrió con tests de contrato y el proveedor simulado. No hay doblaje de voz,
  detección automática del idioma de origen ni edición de cues en la vista; el
  archivo se puede retocar fuera de la app.

### AI Hub (2026-10-22)

- **Biblioteca de skills:** nueve recetas locales con categoría, resumen, vista
  de destino y contrato de salida. La vista compone `SKILL + CONTEXTO + SALIDA`
  y muestra caracteres y tokens estimados; el brief se limita a 4 000 caracteres.
- **Entrega:** el prompt se copia al portapapeles (con aviso si el navegador lo
  bloquea) o el brief se guarda en `localStorage` y **Guion** lo consume una sola
  vez al abrirse, sin pisar texto previo. En Localización/Miniaturas/Producción
  abre la vista y deja el prompt listo para copiar; no inventa una integración
  que esas vistas no tienen.
- **Pruebas:** **843 tests en 92 archivos** en la raíz, **487 tests en 70
  archivos** en la app, Rust **193 passed, 0 failed, 4 ignored**; typecheck,
  build y `cargo fmt --check` verdes. Bundle: entrada **531,97 kB JS**,
  `AiHubView` **11,29 kB**, CSS **216,78 kB**.
- **UI:** verificada en Chromium a 1376×788 y 1366×736; sin overflow horizontal,
  las 23 entradas del rail visibles. El rail usa 26 px y gap 0 sólo en ventanas
  bajas para sostener el crecimiento de vistas.
- **Límite:** no es un chat ni un agente con herramientas; no ejecuta el prompt
  por sí solo y no conoce el contenido del proyecto. La estimación de tokens es
  aproximada y no incluye precios.

### Auto Shorts (2026-10-22)

- **Detección heurística:** `buildShortCandidates` toma la duración medida, los
  silencios, las escenas y la transcripción; arranca en cambios de escena o
  pausas, elige un cierre en silencio si existe y puntúa gancho textual,
  duración, densidad de voz y cambios de escena. Descarta ventanas fuera de
  15–60 s y evita candidatos con más de 50 % de solapamiento.
- **Salida:** hasta cinco tarjetas en Director con rango, duración, score 0–100,
  motivos y extracto; **Copiar plan** genera el texto con tiempos y **Exportar
  9:16** abre el selector de carpeta y produce un MP4 vertical. No modifica la
  timeline.
- **Exportación:** FFmpeg 9.0.1, H.264 CRF 18, AAC 192 kbps, `+faststart`,
  progreso real por `-progress pipe:1`, temporal oculto y rename atómico.
  FFprobe verifica 1080×1920 y devuelve duración/peso. El audio se conserva; si el
  original no tiene audio, el MP4 se publica sin pista.
- **Smart reframe:** con el modelo **SeetaFace** local (1.209.904 bytes,
  SHA-256 `c4619d06…`, BSD-2-Clause) se muestrean 6–30 frames por short, se
  detecta el rostro frontal más grande y se genera una expresión FFmpeg
  `if(lt(t,…),…)` con interpolación suavizada. El video se escala a dimensiones
  pares que cubren 1080×1920 y el `crop` sigue al rostro. Si no hay detecciones,
  usa el centro. El modelo se descarga desde Director o Ajustes → Capacidades,
  con checksum; no requiere ONNX Runtime.
- **Pruebas:** **850 tests en 94 archivos** en la raíz, **494 tests en 72
  archivos** en la app, Rust **199 passed, 0 failed, 6 ignored**; typecheck,
  build y `cargo fmt --check` verdes. Detección real: 4 frames con rostro en un
  clip de 4 s con una cara en movimiento; expresión aplicada por FFmpeg a
  1080×1920 en **4,000 s y 289.108 bytes**. Un retrato frontal se detecta; un
  perfil puro no. Bundle: entrada **559,19 kB JS**, `DirectorView` **32,91 kB**,
  CSS **233,46 kB** (incluye cambios concurrentes de WorkBuddy).
- **Límite:** es una heurística local, no un modelo de viralidad. Detecta caras
  frontales y elige la más grande de cada frame: no identifica personas, no hace
  seguimiento entre caras ni garantiza perfiles. No elige el mejor frame. El
  comando smart completo no se lanzó desde un clic nativo; se verificaron por
  separado el detector sobre video, la expresión en FFmpeg y la compilación del
  comando.

### Backend de doblaje, rostros y pruebas (2026-10-22)

- **`synthesize_dub`**: dobla un video del proyecto con voces SAPI instaladas.
  Valida hasta 60 cues/20 000 caracteres, rechaza solapamientos, elige una voz
  por cultura (`es-MX`, `en-US`, etc.), sintetiza cada cue a WAV, mide su
  duración y la ajusta con `atempo` hasta 1,35× y `atrim` con fade si hace
  falta. Mezcla con `anullsrc` + `adelay` + `amix` + `alimiter`, conserva el
  video sin re-encodear, reemplaza el audio original, escribe temporal oculto y
  publica con rename atómico. Emite `dub-progress` 0–100. Si no hay voz para el
  idioma, devuelve la lista de voces instaladas en vez de fingir el doblaje.
  `bed_volume` 0–1 conserva el audio original como cama (música/SFX) debajo del
  doblaje; si el video no tiene audio, avisa y dobla sin cama.
- **`analyze_face_track`**: API de solo lectura que devuelve muestras, track
  suavizado, dimensiones escaladas y expresiones `x`/`y` listas para `crop`,
  sin exportar. Es la base para una preview facial en el frontend.
- **Integridad del modelo:** `verify_model_hash` comprueba el SHA-256 del peso
  SeetaFace antes de detectar; un archivo corrupto se rechaza con instrucción
  de reinstalarlo.
- **`clone_voice` (clonación local):** puente HTTP para motores locales
  **XTTS API Server** (`POST /tts_to_audio/`) o **GPT-SoVITS** (`POST /tts`).
  Sólo acepta URLs loopback (`localhost`/`127.0.0.1`/`::1`), valida una muestra
  de 3–30 s y 20 MB, acota el texto a 2 000 caracteres y 16 idiomas, envía la
  ruta absoluta de la referencia y exige que el motor devuelva un WAV real
  (cabecera RIFF/WAVE). El WAV se mide con FFprobe y se guarda como
  `media/voz-clonada-<uuid>.wav`; `clone-progress` informa 5/35/100 %. La clave
  opcional del motor va en memoria y no se persiste. **No se incluye un modelo
  de clonación**: hay que tener uno de esos motores corriendo; la app no disfraza
  una voz SAPI como clon.
- **`list_visual_catalog` (gestión de efectos y transiciones):** devuelve 16
  efectos con parámetros/límites, 8 presets creativos, 4 transiciones con frames
  por defecto/máximos y la disponibilidad **medida** de filtros FFmpeg (`eq`,
  `curves`, `gblur`, `lut3d`, `colorkey`, `geq`, etc.). La UI puede ocultar lo
  que este build no soporta.
- **`audit_visuals`:** audita un proyecto sin modificarlo. Marca transiciones
  desconocidas o más largas que el clip, avisa cuando el renderer recortará el
  solape a 2 s o cuando no hay clip anterior, valida rangos de efectos y
  comprueba que las LUT existan dentro del proyecto y que `lut3d`/`gblur` estén
  disponibles. Devuelve hallazgos con severidad y `clipId`.
- **Pruebas de Rust:** el binario de tests enlaza Tauri/rfd e importa
  `TaskDialogIndirect` de comctl32; sin manifiesto Windows carga v5 y el proceso
  muere con `STATUS_ENTRYPOINT_NOT_FOUND`. `scripts/rust-test.mjs` agrega
  `tests.manifest` (Common-Controls v6) al link de los tests `--lib` sin tocar
  el build de la app. Resultado: **215 passed, 0 failed, 7 ignored**;
  `cargo check -p editor-ia-desktop` y `cargo fmt --check` verdes.
- **Doblaje real:** test ignorado ejecutado con `DUB_VOICE="Microsoft Zira Desktop"`:
  video sintético de 5 s, dos cues en inglés, salida 320×180 con audio mezclado
  y duración verificada. No se guardó el archivo de prueba en el proyecto.
- **Límite:** el doblaje SAPI sólo tiene voces `es-MX` y `en-US` en esta
  máquina; los otros idiomas fallan con un mensaje honesto hasta instalar voces.
  La clonación depende de un motor local externo y no se probó contra un motor
  real: el contrato HTTP se verificó con un servidor mock loopback. La UI de
  clonación y lip-sync ya están conectadas; no hay modelo incluido ni
  multi-voz por cue ni ducking automático. El renderer mantiene su tope de 2 s
  de solape
  aunque el esquema admita 120 frames.

### Efectos y transiciones — interfaz (2026-10-22)

- **Vista Efectos**: selección múltiple de clips visuales, 8 presets, ajustes
  rápidos (brillo, contraste, saturación, temperatura, viñeta, desenfoque,
  nitidez, B/N y sepia), transición de entrada con tipo/frames y auditoría.
  Aplica todo con el historial del editor; los presets conservan fades y LUT.
- **Catálogo medido**: usa `list_visual_catalog` para mostrar qué filtros FFmpeg
  existen y qué efectos están disponibles; si el backend no responde, cae a un
  catálogo local para no romper la pantalla.
- **Auditoría**: muestra hallazgos de `audit_visuals` con severidad, clip y
  mensaje. No repara nada: informa antes del render.
- **Verificación**: **860 tests en 96 archivos** en la raíz, **504 tests en 74
  archivos** en la app, Rust **215 passed, 0 failed, 7 ignored**; typecheck,
  build y `cargo fmt --check` verdes. QA visual con dos clips a 1376×788:
  preset Noir aplicado a ambos (4 efectos cada uno) y disolvencia de entrada
  actualizada en ambos. Bundle: entrada **326,04 kB JS**, `VisualsView`
  **15,04 kB**, `LocalizationView` **27,69 kB**, CSS **284,20 kB** (incluye el
  rediseño concurrente de WorkBuddy).
- **Límite**: es gestión por lote; los parámetros avanzados siguen en el
  Inspector del clip. No agrega wipes ni keyframes de efecto propios.

### Doblaje en Localización — interfaz (2026-10-22)

- **Tarjeta Doblaje local**: elige video del proyecto, idioma ya traducido, voz
  SAPI instalada y volumen del audio original (0–60 %); muestra cuántos cues y
  hasta qué segundo dobla. Ejecuta `synthesize_dub`, informa progreso y entrega
  el MP4 con voz, duración, peso y avisos.
- **Voces honestas**: filtra por cultura del idioma; si no hay voz, lista las
  instaladas y deshabilita el botón. En esta máquina hay `es-MX` y `en-US`.
- **QA visual** a 1376×788 con proyecto y video de prueba, subtítulo demo
  traducido y voz Zira: la tarjeta mostró **1080×1920**, **11,83 MB**, **2,4 s**
  y 1 subtítulo; el backend real se probó antes con SAPI y cama 0.15.
- **Clonación local**: tarjeta propia con motor XTTS/GPT-SoVITS, URL loopback,
  audio de referencia del proyecto, idioma, clave opcional, prompt para
  GPT-SoVITS y texto editable (o “Usar texto traducido”). Ejecuta `clone_voice`,
  informa progreso y entrega el WAV verificado con hash de referencia.
- **QA de clonación** con audio demo y servicio simulado: mostró **2,2 s**,
  **1,14 MB**, motor XTTS y ruta del WAV; no se probó contra un motor real.
- **Pruebas:** **860 tests/96 archivos** raíz, Rust **215 passed, 0 failed, 7
  ignored**; typecheck, build y fmt verdes. `LocalizationView` **27,69 kB**.
- **Importación al proyecto (2026-10-23)**: el resultado ofrece **Importar al
  proyecto**; llama a `import_media_paths` con `windows-sapi-dub`, agrega el MP4
  como asset listo y **Ver en Medios** navega a la biblioteca. El test real de
  SAPI pasó con `Microsoft Zira Desktop` (5 s, 2 cues, cama 0.15) y el flujo de
  interfaz quedó cubierto con el servicio simulado.
- **Límite**: la QA usó el servicio simulado; SAPI real se validó por backend y
  clonación real depende del motor externo. Sin lip-sync, multi-voz por cue ni
  edición del WAV.

### Sincronización labial — motor real Wav2Lip (2026-10-23)

- **Adaptador incluido**: `scripts/lipsync-engine/server.py` implementa el
  contrato que ya usa `lip_sync` (`POST /lipsync` con `video_path`, `audio_path`
  y `output_format`) y devuelve el MP4 en el cuerpo. Escucha sólo en loopback
  (`127.0.0.1:8765`) y expone `GET /health`. Se arranca con
  `npm run lipsync:engine` o `scripts/lipsync-engine/start.cmd`.
- **Preparación**: el adaptador extrae el audio a WAV 16 kHz mono, reescala el
  video a un máximo de 1280 px, lo normaliza a 25 fps y ejecuta Wav2Lip con un
  lock para un trabajo por vez. Límite de 45 s de audio (marca la duración de
  salida); el video se recorta a esa duración aunque el archivo sea más largo.
  El proceso de la app espera hasta 30 minutos y rechaza respuestas de más de
  200 MB.
- **Motor instalado en esta máquina**: Wav2Lip en
  `D:\Users\ofici\IA_CENTRAL\04_APLICACIONES_IA\LipSyncEngine\Wav2Lip`, venv
  Python 3.11.16 con torch 2.14.1+cpu, torchvision 0.29.1+cpu, numpy 1.26.4,
  opencv 4.11, librosa 0.11 y face-alignment 1.5. Checkpoint
  `wav2lip_gan.pth` de **145 829 145 bytes**, SHA-256
  `180cfd49d31d47f195d5bfc62830ffe2c40724b7bbbce6faadc73ac6ab1a3b8e`.
  El adaptador verifica el SHA-256 del checkpoint antes de cargarlo y no
  arranca si no coincide; tampoco descarga ni redistribuye pesos.
- **Compatibilidad corregida**: `librosa.filters.mel` ahora recibe `sr=` y
  `n_fft=` por nombre; `torch.load` usa `weights_only=True` y el cargador
  detecta checkpoints TorchScript. Sin esos parches el motor fallaba antes de
  inferir.
- **Medición real**: video de prueba 512×640 a 25 fps (4,65 s), audio SAPI de
  4,65 s; salida **512×640, H.264/AAC, 25 fps, 130 556 bytes**, con el rostro
  regenerado. El adaptador tardó **65,9–95,5 s** con la máquina libre y **202,3 s**
  durante la compilación de Rust. El test ignorado
  `local_engine_returns_mp4` del puente Rust recibió **130 556 bytes** y pasó
  contra el motor real, no contra un mock.
- **Licencia**: Wav2Lip se distribuye para uso personal, investigación y fines
  **no comerciales** (entrenado con LRS2). No se puede empaquetar en un producto
  pago sin licencia aparte. MuseTalk (MIT) y LatentSync (Apache-2.0) quedaron
  clonados como alternativas, pero no se instalaron ni verificaron; el adaptador
  no los finge.
- **QA visual**: sigue existiendo el fake service para tests de interfaz
  (**1080×1920, 17,17 MB, 5,0 s**); el endpoint por defecto de la tarjeta ahora
  apunta al adaptador real en `127.0.0.1:8765`.
- **Pruebas:** **862 tests en 96 archivos** (raíz), Rust **217 passed, 0 failed,
  8 ignored**; `cargo fmt --check`, typecheck y build verdes. Bundles:
  `LocalizationView` **28,01 kB**, main **325,03 kB**, CSS **276,74 kB**.
- **Límites**: sólo CPU en esta máquina; 45 s y 1280 px por trabajo; un solo
  lip-sync a la vez; hace falta un rostro visible en todos los frames; la
  duración de salida la manda el audio; no elige rostro, no extrae el audio del
  doblaje automáticamente y no edita el resultado. No hay métrica de calidad
  visual ni comparación contra MuseTalk.

### FilmCraft scopes + preview real (2026-10-23)

- **Intercambio EDL**: Producción exporta un **CMX 3600** con eventos, timecodes, reel y nombres de archivo para abrir la timeline en Resolve/Premiere. Advierte por solapes, velocidad, reverse y transiciones que el EDL no representa.
- **FilmCraft color/LUT**: el Inspector exporta el look activo como LUT `.cube` 33³ con `filmcraft-color`; se valida al escribir y se publica con rename atómico.
- **FilmCraft scopes**: se agregó la crate `filmcraft-scopes` fijada al mismo commit; el comando `analyze_scopes_frame` calcula waveform de luma, vectorscopio YUV e histograma RGB desde un PNG. La UI que dibuja estos grids queda como siguiente paso.
- **Botón Frame real** en la preview: renderiza el clip visual superior en el
  frame actual con el mismo `visual_filter` del export (color, máscaras,
  relight, lente, LUT y transformación) y lo muestra como PNG sobre el canvas.
- **Medición real**: test live con un video `testsrc2` 320×180, máscara elipse y
  relight; FFmpeg produjo un PNG **320×180** con los efectos aplicados.
- **Límite**: es el clip activo, no el compuesto de todas las pistas: no incluye
  subtítulos, títulos gráficos, otras capas, transiciones ni el look global. La
  preview CSS sigue siendo la referencia interactiva; el frame real es la
  comprobación contra FFmpeg.
- **Pruebas**: Rust **224 passed, 0 failed, 11 ignored**; frontend **865/97**.

### 32K, voz DSP, máscaras y transiciones nuevas (2026-10-23)

- **Lienzo hasta 32K**: `PixelsSchema`, los campos de Proyectos/Inspector y el
  helpers de formato aceptan **32 768 px** por lado. El render H.264 sigue
  limitado a 16 384 px y ahora falla temprano con un mensaje que pide H.265;
  `libx265` aceptó un fotograma de prueba de **32 768×64** en esta máquina. No
  se midió un frame completo de 32 768²: la memoria y el tiempo lo hacen
  impráctico. 120 fps ya estaba dentro del formato; el rendimiento depende del
  encoder y del hardware.
- **Voz clara con DSP de FilmCraft**: la vista Denoise suma una tarjeta para
  audio con cuatro cadenas (`diálogo`, `voz`, `podcast`, `suave`) que usan
  `filmcraft-audio-dsp` fijado al commit
  `abf44fda9015f4b7a96dc338f6042499bf8e9d9f` (MIT OR Apache-2.0): denoise
  espectral, de-hum, de-esser, de-reverb, EQ paramétrico, compresor, realce de
  voz y limitador de pico real. Decodifica a f32le 48 kHz estéreo, procesa en
  bloques, compensa latencia y publica WAV PCM 24 bits con rename atómico.
  **No es IA ni separa voces superpuestas**; procesa hasta 180 s. Un test
  ignorado generó un WAV real con tono y ruido, lo decodificó, aplicó la cadena y
  publicó **345 702 bytes / 1,20 s**; la UI nativa no se recorrió.
- **Máscaras**: además de rectángulo y elipse, el esquema, el render `geq` y la
  preview aceptan **diamante, triángulo y rectángulo redondeado**, con feather,
  rotación, inversión y keyframes. Las fórmulas se validaron con FFmpeg real
  sobre imágenes sintéticas.
- **Transiciones**: se agregaron **fundido a blanco** y **deslizar desde
  arriba/abajo** (además de disolvencia, negro y laterales). El catálogo de
  Efectos y el Inspector muestran siete tipos; el render usa `fade=color=white`
  y expresiones de overlay en Y. Sigue sin haber crossfade solapado.
- **Corrección de lente**: el Inspector expone **Lente K1/K2** por clip y el
  renderer aplica `lenscorrection` con interpolación bilineal y centro
  configurable (0,5 por defecto). La preview no simula la distorsión y los
  píxeles sin datos quedan negros.
- **Mejor frame para miniaturas**: Miniaturas muestrea 12 puntos del video,
  puntúa nitidez, contraste y exposición en Rust y publica los **tres mejores
  PNG** en la caché. Medición real con `testsrc2`: mejor frame **64,2 puntos a
  2,6 s, 480×270**. El usuario elige uno y el canvas lo usa como fondo.
- **Relight por rostro (local)**: el Inspector permite centrar una máscara
  radial con **Detectar rostro** sobre el rango fuente del clip, ajustar fuerza,
  calidez, radio y centro. El MP4 aplica un `geq` por píxel con caída suave;
  medido sobre un gris 128: centro **174/183/191**, esquina **128/128/128**.
  No es un modelo generativo, no separa al sujeto del fondo y es lento en 4K.
- **Auto Shorts en lote**: Exportar todos elige una carpeta una vez, exporta los
  candidatos en orden, continúa si uno falla y muestra un resultado por short.
  Además, **Ver track de rostro** llama a `analyze_face_track` y dibuja la
  posición/tiempo de las muestras antes de confiar en smart reframe.
- **Pruebas:** **865 tests en 97 archivos** (raíz), Rust **224 passed, 0 failed,
  11 ignored** (el test live de voz se ejecutó aparte y pasó), **Playwright 11/11**
  con entrada por la pantalla Montaje; typecheck, build y fmt verdes. Bundles: `DenoiseView`
  **18,71 kB**, `DirectorView` **38,20 kB**, `LocalizationView` **28,01 kB**,
  main **325,66 kB**, CSS **278,56 kB**.
- **Límites**: no hay 32K² medido, multi-GPU, colaboración en red, Dolby Atmos/
  MPEG-H, aislamiento de voz por IA ni separación de diálogos superpuestos. La
  cadena DSP se probó con un WAV real de punta a punta, pero la tarjeta no se
  recorrió en la UI nativa en este pase.

- `npm run typecheck`: limpio. `npx vitest run`: **814 tests** en 86 archivos.
  Incluye pruebas de formato/fps, compresión, encuadre, curvas, apariencia,
  preferencias del editor y su respaldo en JSON, tutorial, perfil, panel Flow,
  **cola de generación continua de Flow**, **ruta de producción**, sesiones MCP y
  ejemplo de esquema,
  artefactos MCP, waveforms, Director, fábrica, búsqueda global, paquete de
  entrega, cola de render, Smart Bins, scopes con Parade, rueda Offset y la
  vista de conversión por lotes.
- `node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop --offline`:
  **168 passed, 0 failed, 4 ignored**. Incluye tests de perfiles
  personalizados, preset/códec, encuadre cover, curvas/tono, de-esser/puerta de
  ruido, flips, derechos de artefactos, efectos, freeze en pista y Ken Burns en
  el grafo FFmpeg, parsers de silencios/loudness, allowlist de conversión,
  subtítulos ASS por palabra, selector `.ass`/`.ssa`, validación del paquete
  `.zip`, la rueda Offset en `colorbalance`, **sesiones MCP con estado entre
  llamadas**, la cola de `stderr` cuando un servidor muere y un **servidor MCP
  fixture real** por stdio. Los tests live de render se ejecutan con
  `EDITOR_IA_RUN_RENDER_TESTS=1`; el de Playwright MCP con
  `EDITOR_IA_MCP_PLAYWRIGHT_CLI=<ruta a cli.js>`.
- **Playwright e2e**: `npx playwright test` en `apps/desktop` — **11/11** contra
  el Chrome del sistema; incluye la franja de ruta de producción.
- **Compilación nativa y ruta al escritorio**: `npm run tauri:build` y, después,
  reemplazo de `Editor IA.exe` e instalador en el Escritorio (convención
  registrada).
- **Ronda DaVinci (2026-10-22)**: rueda Offset, scope Parade, cola de entregas
  persistente, Smart Bins y tres plantillas de título. Detalle y lo que falta en
  [`docs/reference/DAVINCI-PARITY-2026-10-22.md`](docs/reference/DAVINCI-PARITY-2026-10-22.md).
- **Ronda MIT (2026-10-21)**: MiniSearch (búsqueda global), fflate (paquete de
  entrega) y subsrt (subtítulos ASS/SSA) integrados con licencia verificada.
  Detalle, descartes y evidencia en
  [`docs/integrations/MIT-STACK-2026-10-21.md`](docs/integrations/MIT-STACK-2026-10-21.md).
- **Render live de freeze (2026-10-20)**: video 1 s + 1 s congelado, PNG
  extraído con FFmpeg y montado con `-loop 1`; FFprobe verificó **12.703 bytes,
  320×180, 2,000 s**.
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

### Ruta de producción de punta a punta (2026-10-22)

- **Brecha**: la app tenía catorce vistas correctas, pero sueltas: el rail
  mezclaba herramientas con el trabajo diario y nada indicaba por dónde empezar
  ni en qué paso estaba uno. Había que conocer la app para usarla.
- **Modelo único**: `app/pipeline.ts` define las seis etapas —Proyecto, Guion,
  Medios, Voz, Edición, Exportar— con la vista de cada una, qué se hace ahí y
  cómo se reconoce que está hecha. `computePipeline` devuelve el estado de cada
  una y la primera incompleta como paso actual: **aunque haya trabajo más
  adelante**, si falta el guion la ruta sigue señalando el guion en vez de dar
  todo por terminado.
- **Avance desde el documento**: escenas, medios (imagen/video), audios y clips
  salen del `.editoria.json`. Lo único que se persiste aparte es “ya se exportó”,
  que no forma parte del proyecto: queda en `editoria.pipeline.v1` por id de
  proyecto y se marca cuando el motor de render termina con estado `completed`.
- **Franja de ruta**: línea única entre el aviso y el área de trabajo, con las
  seis etapas como píldoras, el porcentaje y un botón **Siguiente: <paso>**. Se
  oculta en las vistas donde no aporta (Inicio, Ajustes, Aprender, MCP y las
  herramientas puras) porque Inicio muestra la ruta completa.
- **Guía en Inicio**: tarjeta “De la idea al MP4 en seis pasos” con una línea de
  qué se hace en cada etapa, el detalle de cuánto hay hecho y un botón por paso.
  El CTA del héroe pasó de “Continuar edición” a **Seguir con <paso siguiente>**.
- **Rail reordenado y agrupado**: `NavView` ahora lleva `group`
  (`inicio | ruta | herramientas | ayuda`) y el separador lo dibuja el rail, de
  modo que agregar una vista no exige tocar dos lugares. El menú **Ver** sigue
  listando todo.
- **Medición**: `npm run typecheck` limpio; `npm run test:serial` **799 tests en
  84 archivos**; Playwright e2e **11/11**; `npm run build` verde (entrada
  **524,82 kB JS**, CSS **196,66 kB**). **12 tests nuevos**: 8 del modelo
  (orden, avance, etapa actual con trabajo salteado, plurales, persistencia de
  exportados, almacenamiento corrupto) y 4 de la franja.
- **Compilación nativa**: `npm run tauri:build` genera
  `target/release/editor-ia-desktop.exe` (**30,5 MB**) y el instalador NSIS
  `target/release/bundle/nsis/Editor IA_0.1.0_x64-setup.exe` (**84,5 MB**).
  Después de compilar, ambos se copian al Escritorio reemplazando los anteriores
  (`Editor IA.exe` para ejecutar, `Editor IA_0.1.0_x64-setup.exe` para
  distribuir). Verificado: el `.exe` arranca, abre la ventana “Editor IA”
  (59,6 MB en memoria) y muestra la guía con los seis pasos y el rail
  reordenado; el portable del Escritorio también abre (66,4 MB).
- **App instalada**: el instalador NSIS en modo `currentUser` deja la app en
  `%LOCALAPPDATA%\Editor IA\` con su desinstalador y el acceso del Menú Inicio.
  El instalador **no crea el acceso del Escritorio** (ni en modo silencioso ni
  por defecto), así que se copia el `.lnk` del Menú Inicio al Escritorio como
  `Editor IA.lnk`. Verificado: al abrirlo muestra el diálogo de bienvenida
  “Crear video no tiene que ser complicado” con los tres caminos (crear,
  tutorial, abrir) y corre en 31,8 MB.
- **Verificación visual**: Chromium real a 1360×860. Inicio muestra la guía con
  el paso 1 marcado, el rail queda en el orden nuevo, la franja aparece en
  Proyectos con “Siguiente: Proyecto” y se oculta en Ajustes. Sin errores de
  consola. Capturas:
  [`editor-ia-shots/app-ruta-nativa-2026-10-22.png`](editor-ia-shots/app-ruta-nativa-2026-10-22.png)
  y
  [`editor-ia-shots/app-ruta-inicio-2026-10-22.png`](editor-ia-shots/app-ruta-inicio-2026-10-22.png).
- **Límites**: las etapas no exigen orden —se puede importar medios sin guion— y
  la ruta sólo *señala* el paso, nunca bloquea. “Ya se exportó” se marca por
  render completado en este equipo; abrir el proyecto en otra máquina lo muestra
  como pendiente. La verificación fue en navegador (modo sin backend nativo).

### Generación continua con Google Flow (2026-10-22)

- **Brecha**: el panel de Flow generaba un prompt por vez. El propio documento
  lo anotaba como pendiente (“no hay generación masiva de N escenas todavía”):
  para producir una serie de imágenes había que repetir el clic a mano.
- **Cola**: lista de prompts (una por línea, `#` comenta, se deduplican sin
  distinguir mayúsculas), repeticiones por prompt (1–4), espera entre imágenes
  (0–10 min), tope duro de imágenes (1–200), corte por fallos seguidos (1–10) y
  **ciclo continuo** que vuelve a empezar hasta llegar al tope.
- **Ejecución secuencial**: una llamada `flow_generate_image` con `auto_confirm`
  por imagen, `flow_connect` best-effort al arrancar y, si se pide,
  `flow_status` antes de cada vuelta: si el saldo leído es cero, la corrida se
  detiene en lugar de encadenar errores. Cada artefacto se importa a Medios con
  `import_media_paths` (derechos confirmados por la autorización del lote).
- **Sobrevive a la navegación**: el ejecutor vive en `FlowQueueProvider`, por
  encima de las vistas. Cambiar de pantalla no corta la corrida.
- **Detener** no aborta la llamada en curso —el `tools/call` es bloqueante—:
  impide la siguiente. La interfaz lo dice en el pie.
- **Persistencia y seguridad**: el plan se guarda en
  `editoria.flow-queue.v1` y el borrador de prompts en
  `editoria.flow-prompts.v1`. Al volver, el plan aparece **detenido** y
  reanudarlo exige la autorización de créditos otra vez; nunca se reanuda solo.
- **Medición**: `npm run typecheck` limpio; `npm run test:serial` **787 tests en
  82 archivos**; `npm run build` verde (entrada **519,91 kB JS**, `McpView`
  **28,14 kB**, CSS **192,74 kB**). **15 tests nuevos**: 12 de la cola (parseo,
  topes, ciclo, créditos, persistencia) y 3 de la tarjeta.
- **Verificación visual**: la tarjeta se montó en Chromium real a 1100×1000 con
  un servicio simulado; una corrida de 3 prompts produjo **3 imágenes, 3
  completados, 0 fallos**, estado “Completado” y sin errores de consola.
  Capturas:
  [`editor-ia-shots/app-flow-queue-idle-2026-10-22.png`](editor-ia-shots/app-flow-queue-idle-2026-10-22.png)
  y
  [`editor-ia-shots/app-flow-queue-run-2026-10-22.png`](editor-ia-shots/app-flow-queue-run-2026-10-22.png).
- **Límites**: **no se ejecutó contra Flow real**: el Chrome dedicado de esta
  máquina no tiene sesión de Google y no se pidieron credenciales. La corrida se
  validó contra el contrato del servidor MCP con un servicio simulado. Flow no
  es una API oficial: cambios de DOM, verificación o límites de la cuenta pueden
  cortar la corrida, y el costo por imagen lo decide Flow. El saldo se lee de un
  texto de telemetría: si el formato cambia, la app deja de cortar por saldo y
  sigue con el resto de los topes.

### MCP con navegador: sesiones persistentes y diagnóstico (2026-10-22)

- **Brecha**: el gestor arrancaba el servidor MCP en cada llamada y lo mataba al
  terminar. Un servidor que maneja un navegador (`@playwright/mcp`) conserva la
  página en su proceso, así que la segunda llamada veía `about:blank`: navegar,
  leer y hacer clic en pasos separados era imposible. Además, en Windows el
  comando se envuelve en `cmd /C npx …` y matar sólo el `cmd` dejaba el `node`
  —y su navegador— como huérfano.
- **Sesiones**: `tools/call` abre una sesión por servidor que sobrevive entre
  ejecuciones. Se cierra por inactividad (10 min), al llegar a 3 sesiones
  simultáneas (se libera la más ociosa), al guardar o borrar el servidor, o con
  el botón **Cerrar sesión**. La vista muestra pid, cantidad de llamadas e
  inactividad. Los comandos nuevos son `close_mcp_session` y
  `mcp_session_status`; `tools/list` sigue siendo efímero para no dejar nada
  corriendo al probar.
- **Cierre real del árbol**: `taskkill /PID <pid> /T /F` en Windows, en lugar de
  matar sólo el proceso padre. También se ejecuta en `Drop`, así que una sesión
  vencida no deja nada vivo.
- **Diagnóstico honesto**: `stderr` del servidor ya no se descarta; se guarda una
  cola corta y se adjunta al error. Un servidor que muere ahora dice “terminó
  sin responder — <última línea>” en vez de “no respondió a tiempo”.
- **Ejemplo de argumentos ejecutable**: `exampleFromSchema` completa sólo los
  campos obligatorios y usa el primer valor del `enum` o el `default`. Antes
  generaba `button: ""` (enum `left|right|middle`) y `target` ausente, y la
  llamada se rechazaba por validación.
- **Evidencia real con Playwright MCP** (`@playwright/mcp@0.0.83`, Chrome del
  sistema, headless): `tools/list` devolvió **25 herramientas**; un test de
  contador probó que el proceso se reutiliza (**1 → 2** entre llamadas); y el
  flujo real `browser_navigate` → `browser_click` → `browser_snapshot` terminó en
  `https://www.iana.org/help/example-domains` con título “Example Domains”. El
  test en vivo queda detrás de `EDITOR_IA_MCP_PLAYWRIGHT_CLI=<ruta a cli.js>`.
- **Causa de entorno corregida**: `%LOCALAPPDATA%\ms-playwright` era un enlace
  simbólico a `D:\DevCache\Playwright`, con ACL de sólo lectura para el usuario
  (`Usuarios: ReadAndExecute`). Playwright escribe ahí su registro de servidores
  de navegador y fallaba con `EPERM` al abrir Chrome, con cualquier MCP. Se
  reemplazó el enlace por una carpeta real escribible con junctions a los
  navegadores ya instalados; el enlace anterior quedó en
  `ms-playwright.symlink-bak`. No se copiaron 707 MB ni se pidió administrador.
- **Medición**: `npm run typecheck` limpio; `npm run test:serial` **772 tests en
  80 archivos**; Rust **168 passed, 0 failed, 4 ignored**; Playwright e2e
  **10/10**; `npm run build` verde (entrada **510,10 kB JS**). Tests nuevos:
  sesión con estado entre llamadas, `stderr` en el error, flujo real con
  Playwright MCP, ejemplo de esquema, sesión en la UI.
- **Límites**: la prueba con Playwright MCP se ejecutó por la capa Rust y por el
  protocolo stdio, no conduciendo la ventana nativa; la UI se cubrió con jsdom.
  El cierre por inactividad puede cortar una herramienta que tarde más de 10
  minutos en volver a usarse. No se implementó reconexión tras un fallo.

### Preferencias del editor y respaldo local (2026-10-22)

- **Brecha**: Ajustes cubría apariencia, atajos, IA, voz, herramientas y datos,
  pero las decisiones que más se tocan en el trabajo diario estaban fijas en el
  código: cuánto tarda el autoguardado, cuánto historial se conserva, con qué
  zoom abre la timeline, cuánta tolerancia tiene el imán y qué capas de
  información se dibujan sobre los clips.
- **Modelo nuevo**: `state/editor-preferences.ts` con once campos acotados
  (`autosaveDelayMs` 500–8000, `historyLimit` 20–200, `defaultZoom` 0,4–6,
  `snapPixels` 4–24, `jumpStepFrames` 1–60 y seis booleanos), normalización
  defensiva, persistencia en `localStorage` y el evento
  `editoria:editor-prefs-changed` para que el editor relea sin recargar. Los
  valores por defecto reproducen el comportamiento anterior, salvo “seguir al
  playhead”, que ahora viene activo.
- **Conectado, no sólo dibujado**: el store usa el retardo de autoguardado y el
  límite de deshacer; la timeline arranca con el zoom y el imán elegidos, aplica
  la tolerancia en píxeles y acompaña al playhead durante la reproducción; los
  clips pueden ocultar miniatura y forma de onda (con la capa apagada no se piden
  archivos al disco); las flechas mueven el paso configurado —con Shift, diez
  veces más—; la preview arranca con las guías de acción y título si así se
  eligió; la reproducción puede quedar en bucle en lugar de detenerse al final.
- **Respaldo**: `state/preferences-backup.ts` reúne apariencia, atajos y
  preferencias en un JSON con marca y versión. La restauración valida antes de
  escribir: archivo vacío, JSON roto, paquete ajeno o versión futura se rechazan
  con un mensaje y **no se aplica nada a medias**; los atajos sin modificador se
  descartan uno por uno en lugar de dejar el teclado inutilizable. Se descarga y
  se restaura desde **Ajustes → Datos locales → Respaldo**; “Restablecer todo”
  pide una segunda confirmación y no toca proyectos, medios ni claves.
- **Atajo nuevo**: `Ctrl+Shift+Delete` elimina el clip seleccionado y cierra el
  hueco (ripple). Es reasignable como cualquier otro desde Ajustes → Atajos.
- **Medición**: `npm run typecheck` limpio; `npm run test:serial` **770 tests en
  80 archivos**, 0 fallos; `npm run build` verde (entrada **509,80 kB JS**,
  `SettingsHome` **33,53 kB**, `EditorWorkspace` **199,94 kB**). **18 tests
  nuevos**: normalización y persistencia de preferencias (6), respaldo,
  restauración y rechazos (7), tarjeta de preferencias (3) y tarjeta de respaldo
  (2).
- **Verificación visual**: la app se abrió en Chromium real sobre el servidor de
  Vite a **1440×900**. Ajustes muestra **ocho** secciones; la tarjeta Editor
  tiene 5 sliders y 6 casillas; alternar “Reproducción en bucle” escribe
  `editoria.editor-prefs.v1` en el almacenamiento y no aparece ningún error de
  consola. Capturas:
  [`editor-ia-shots/app-settings-editor-2026-10-22.png`](editor-ia-shots/app-settings-editor-2026-10-22.png)
  y
  [`editor-ia-shots/app-settings-backup-2026-10-22.png`](editor-ia-shots/app-settings-backup-2026-10-22.png).
- **Límites**: la verificación visual fue en el navegador (modo sin backend
  Tauri); no se rehizo el instalador ni se probó la descarga del respaldo en la
  ventana nativa. El respaldo escribe en la carpeta de descargas del sistema, no
  en una ruta elegida por el usuario.

### Freeze dentro del clip original (2026-10-20)

- **Brecha**: el freeze existente sólo montaba una capa de imagen de 2 s encima
  del video; el clip original seguía corriendo debajo y no había forma de
  detener el tiempo en la pista, como hace CapCut al congelar un frame.
- **Evidencia REA**: CapCut 9.4.0.4015 `videoeditor.dll` (SHA-256
  `32e8da19…`) contiene `freeze_info.cpp`, `FreezeInfo`,
  `is_freeze_segment(video)` y `video['freeze']` con `source_material_id`: el
  congelado es un segmento del video, no una capa aparte. REA abrió el binario;
  `search_strings` no completó y la evidencia textual se extrajo con `strings`
  acotado. Filmora no está instalado.
- **Implementación**: nuevo `kind:"freeze"` en el esquema (asset de imagen,
  exclusivo de pistas de video) y acción `freezeFrameInPlace`: divide el video en
  el playhead, inserta 2 s sobre la misma pista y corre clips, subtítulos y
  marcadores posteriores. El clip congela color, transformación estática y blend
  del original; acepta máscara, movimiento, transición y animación. El Inspector
  ofrece **Congelar en la pista** y **Como capa**; preview y timeline lo dibujan
  con la miniatura del PNG. Rust lo trata como imagen (`-loop 1`) y respeta el
  solape de la transición de entrada.
- **Evidencia**: render live con FFmpeg 9.0.1 del proyecto video 1 s + freeze
  1 s = **12.703 bytes, 320×180, 2,000 s**; el grafo contiene `-loop 1` y el
  `enable='between(t,0.800000,2.000000)'` del dissolve. Tests de esquema (acepta
  en pista de video, rechaza pista de imagen, fuente con ventana y velocidad) y
  de acción (split, ripple de clips/subtítulos/marcadores, playhead fuera,
  pista bloqueada y asset sin confirmar) y un test de UI que recorre selección →
  botón → clip congelado en la timeline.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**
  verdes; `cargo fmt --all -- --check` limpio.
- **Límites**: un clip de otra pista que cruza el playhead no se parte; el
  ripple sólo mueve los que empiezan en el playhead o después. La UI se cubrió
  con jsdom, no en la ventana nativa; no se rehizo el instalador.

### Marcadores desde escenas (2026-10-21)

- **Brecha**: la matriz registraba “sin capítulos automáticos desde escenas”; los
  marcadores se ponían a mano aunque el proyecto ya tuviera escenas con clips.
- **Evidencia**: no se observó una función específica en CapCut; se compone
  sobre las escenas y marcadores existentes y no se presenta como reverse
  engineering. Filmora sin binario.
- **Implementado**: `markersFromScenes` crea un marcador por escena en el inicio
  del clip más temprano, con el título de la escena; salta escenas sin clips y
  frames que ya tienen marcador. Botón **Marcadores desde escenas** en el
  Inspector de proyecto, con aviso de agregados/salteados. Sin esquema ni render.
- **Evidencia medida**: test de acción (2 agregados, 1 escena vacía salteada; al
  repetir 0 agregados y 3 salteadas) y de UI (escena Intro → aviso 1 marcador).
  Playwright a **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: usa el inicio del primer clip, no la duración narrada; no crea
  marcadores desde beats; los frames duplicados se saltean. UI cubierta con
  jsdom; sin instalador.

### Buscar clips en la timeline (2026-10-21)

- **Brecha**: con muchas tomas, encontrar un clip por nombre obligaba a recorrer
  la timeline a mano; el filtro de color no buscaba texto.
- **Evidencia**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256 `32e8da19…`)
  expone `findSegment`/`findSegments` de `CombinationUtils` para localizar
  segmentos por texto; la UI compone esa búsqueda sobre clips, pista y material.
- **Implementado**: `matchesClipSearch` (sin distinguir mayúsculas, en clip,
  pista o material); campo **Buscar clip** que atenúa los no coincidentes y, con
  Enter, salta al siguiente coincidente desde el playhead, lo selecciona y avisa.
  Se combina con el filtro de color. Sin cambios de esquema ni render.
- **Evidencia medida**: tests del helper (vacío, mayúsculas, varios campos) y de
  UI (dos clips Intro/Cierre → uno atenuado → Enter avisa “Clip Cierre”).
  Playwright a **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: busca por texto, no por contenido visual; el salto recorre solo
  coincidencias ordenadas por inicio. UI cubierta con jsdom; sin instalador.

### Efectos creativos (2026-10-21)

- **Brecha**: la matriz seguía marcando “sin biblioteca de efectos”; los looks
  rápidos sólo cubrían color básico y no recetas de desenfoque, nitidez,
  viñeta o clave alta/baja.
- **Evidencia**: CapCut 9.4 trae `Resources/DefaultAdjustBundle` con carpetas
  `brightness`, `contrast`, `fade`, `highlight`, `shadow`, etc.; los presets son
  recetas locales que combinan los filtros existentes, no nombres de efectos
  inventados.
- **Implementado**: `EFFECT_PRESETS` con Suave, Onírico, Noir, VHS, Documental,
  Alta clave, Baja clave y Neón; `applyEffectPreset` reemplaza el grade y
  conserva fades y LUT. Sección **Efectos creativos** en el Inspector del clip,
  con aviso al aplicar. Sin cambios de esquema ni render.
- **Evidencia medida**: tests de integridad (ids únicos, cada receta valida
  contra `ClipEffectsSchema`) y de merge (Noir reemplaza brillo y conserva
  fade/LUT); UI aplica Noir y muestra el aviso. Playwright a **1376×788**: sin
  desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: son recetas fijas de los filtros existentes, no plugins ni
  efectos descargables; no hay previsualización en miniatura. UI cubierta con
  jsdom; sin instalador.

### Presets de audio en lote (2026-10-21)

- **Brecha**: aplicar “Voz clara” o “Música” a muchos clips de audio exigía
  abrir cada Inspector y repetir EQ, filtros, compresor y denoise.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `ChangeVoiceApplyToAllReqStruct`,
  `changeVoiceApplyToAll` y `AUDIO_CHANGE_VOICE_APPLY_TO_ALL_ACTION`.
- **Implementado**: `AUDIO_PRESETS` con recetas Voz clara y Música;
  `applyAudioPresetToAll` las aplica a los clips de audio de pistas
  desbloqueadas, conserva ganancia, fades y keyframes, y salta pistas
  bloqueadas. Botones **Voz clara a todos** / **Música a todos** con aviso en
  Audio del proyecto. No toca el audio embebido de los videos.
- **Evidencia medida**: test de acción (1 aplicado, 1 bloqueado, ganancia -5
  conservada, bloqueado sin compresor) y de UI (Voz clara → aviso 1 clip).
  Playwright a **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: sobrescribe EQ/compresor/denoise existentes y no procesa audio
  embebido en videos; no hay editor de presets personalizados. UI cubierta con
  jsdom; sin instalador.

### Disolver cortes contiguos (2026-10-21)

- **Brecha**: poner una disolvencia en un montaje de muchos clips exigía abrir
  el Inspector de cada clip y repetir tipo y frames.
- **Evidencia**: CapCut 9.4 usa el patrón “aplicar a todos” en
  `beautyFaceApplyToAll` y `changeVoiceApplyToAll`; esta acción compone ese
  patrón sobre las transiciones existentes, no se presenta como una función
  observada específica de transiciones.
- **Implementado**: `applyTransitionToCuts` recorre las pistas desbloqueadas,
  detecta cortes contiguos entre clips visuales y asigna una disolvencia de 12
  frames (acotada a la duración del clip). No mueve clips ni toca huecos,
  audio o el primer clip. Botón **Disolver cortes contiguos** en Inspector →
  Proyecto → Transiciones de corte.
- **Evidencia medida**: tests de acción (dos cortes contiguos, hueco y primero
  intactos, pista bloqueada sin cambios) y de UI (un corte → aviso “1 corte(s)
  con disolvencia”). Playwright a **1376×788**: sin desbordes y **0 errores de
  consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: sólo disolvencia de 12 frames y cortes exactamente contiguos; no
  elige fundido a negro ni deslizamiento en lote. UI cubierta con jsdom; sin
  instalador.

### Subir y bajar capas (2026-10-21)

- **Brecha**: las pistas tenían `order`, pero no había forma de cambiar el
  apilado sin borrar y volver a crear; el render y la preview ya respetaban el
  orden.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `MoveTrackRespStruct`, `moveTrack`, `moveTracks` y
  `MainTrackOrderRepairTask`.
- **Implementado**: `moveTrack` intercambia el `order` con la pista vecina y no
  toca clips ni subtítulos; **Subir capa** / **Bajar capa** en Inspector → Pista,
  deshabilitados en los extremos. Sin cambios de esquema ni render.
- **Evidencia medida**: test de acción (intercambio, extremos que devuelven el
  mismo documento, pista inexistente) y de UI (V1 pasa encima de V2). Playwright
  a **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: sólo mueve una posición por clic; no hay arrastre de pistas ni
  reordenamiento múltiple. UI cubierta con jsdom; sin instalador.

### Copiar y pegar atributos (2026-10-21)

- **Brecha**: para replicar color, máscara, movimiento, transición, animación o
  audio de un clip había que repetir cada control a mano.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `AttriCopyPasteUtils`, `AttributeName`,
  `PasteAttributeTimeConflict` y `updateSegmentCopyFromOtherDraft`.
- **Implementado**: **Copiar atributos** / **Pegar atributos** en el menú
  contextual del clip. Copia efectos, movimiento, chroma, máscara, blend,
  transición, animaciones, color y ajustes de audio (sin mute ni keyframes de
  ganancia); al pegar adapta fades al clip destino, descarta keyframes de máscara
  fuera de rango y acota animaciones. Si el destino es audio, sólo aplica audio
  y color. Con un filtro de color activo, **Pegar atributos al filtro** aplica
  todo el paquete a los clips de ese color y salta pistas bloqueadas. Sin
  cambios de esquema ni render.
- **Evidencia medida**: tests de copia (excluye mute/keyframes), pegado en clip
  corto (fade quitado, keyframe 80 descartado, animación 30), audio (ignora
  efectos/movimiento) y lote (2 clips aplicados, 1 bloqueado salteado); UI copia
  y pega entre dos clips y aplica al filtro. Playwright a **1376×788**: sin
  desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: no copia transformación ni keyframes de transformación/ganancia;
  el lote incluye al clip de origen si comparte el color. UI cubierta con jsdom;
  sin instalador.

### Cortar clips en marcadores (2026-10-21)

- **Brecha**: los marcadores organizaban y exportaban capítulos, pero no había
  forma de convertir esos puntos en cortes editables sin partir clip por clip.
- **Evidencia**: no se observó una cadena `split`+`marker` en
  `videoeditor.dll`; la función se construye sobre las acciones existentes de
  marcador y split, no se presenta como una función de CapCut.
- **Implementado**: `splitClipsAtMarkers` recorre los clips originales, corta en
  cada inicio de marcador dentro de su ventana y salta pistas bloqueadas;
  devuelve cortes, clips tocados y pistas salteadas. Botón **Cortar clips en
  marcadores** en el Inspector de proyecto, con aviso y selección intacta. No
  cambia duraciones ni ripples.
- **Evidencia medida**: tests de acción (2 marcadores → 3 clips de 90/90/120,
  marcador fuera ignorado, pista bloqueada salteada) y de UI (un marcador en el
  medio → 2 clips en la timeline). Playwright a **1376×788**: sin desbordes y
  **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: usa el inicio del marcador, no el fin de un rango; clips con
  velocidad no entera pueden quedar sin corte si el frame no cae en la grilla.
  Sin cambios de Rust ni instalador.

### Fades arrastrables en la timeline (2026-10-21)

- **Brecha**: los fades sólo se podían escribir como frames en el Inspector; no
  había forma directa de ajustarlos viendo el clip.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `fade_in_duration`, `fade_out_duration`,
  `AudioFadeInReqStruct`, `AudioFadeOutReqStruct`,
  `VideoAudioFadeInReqStruct` y `VideoAudioFadeOutReqStruct`.
- **Implementado**: dos manijas circulares en las esquinas superiores del clip
  seleccionado. Arrastrar ajusta los frames con `fadeFramesForDrag` (redondeo y
  límite 0–duración); en video/imagen/freeze escribe los fades visuales y en
  audio los fades de audio. Con teclado, flecha arriba/abajo cambia 1 frame y
  Shift+flecha 10; `aria-valuenow` refleja el valor.
- **Evidencia medida**: tests del helper (redondeo, límites y dirección de cada
  lado) y de UI (flecha arriba lleva el fade de 0 a 1). Playwright a
  **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: las manijas sólo aparecen con el clip seleccionado; no hay curva
  de fade editable ni arrastre E2E en Playwright. Sin cambios de Rust ni
  instalador.

### Rangos de marcador (2026-10-21)

- **Brecha**: la matriz registraba marcadores como puntos, “sin rangos de
  marcador”; no se podía marcar una sección de interés en la regla.
- **Evidencia**: la brecha estaba documentada en la matriz. Una búsqueda acotada
  de strings `marker_*range` en `videoeditor.dll` de CapCut 9.4 no devolvió
  resultados, así que la función se implementa como cierre de esa brecha y no se
  presenta como una función observada de CapCut. Filmora sin binario.
- **Implementado**: `endFrame` opcional y validado en `MarkerSchema` (mayor que
  `frame`); `addMarker`/`updateMarker` aceptan y limpian el fin; el Inspector
  ofrece **Rango 2 s**, **Fin** y **Quitar rango**; la regla dibuja una barra
  del color del marcador. JSON Schema regenerado; los capítulos siguen usando
  el frame de inicio.
- **Evidencia medida**: tests de esquema (acepta 90, rechaza 30/10) y de acción
  (crear, limpiar, ampliar y rechazar un frame que cruza el fin). Playwright a
  **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: el rango es visual y organizativo; no recorta, no exporta como
  capítulo extendido ni mueve clips. UI cubierta con tests de estado; sin
  instalador.

### Cerrar huecos en una pista (2026-10-21)

- **Brecha**: se podía borrar con ripple un clip, pero no compactar una pista
  con varios huecos; había que mover cada clip a mano.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `CloseGapInfo`, `get_all_close_gap_info` y
  `multiMoveCloseGapSegments`.
- **Implementado**: acción `closeGaps` que ordena los clips de una pista y los
  pega al anterior conservando el inicio del primero; devuelve cuántos movió y
  cuántos frames recuperó. Botón **Cerrar huecos** en Inspector → Pista, con
  aviso y rechazo de pistas bloqueadas. No cambia el esquema ni el render.
- **Evidencia medida**: tests de acción (compacta 30→60, conserva el inicio en
  30, no toca otra pista, no mueve si no hay huecos y rechaza bloqueo). Además
  corregí la descripción obsoleta y el 404 de favicon del frontend.
  Playwright a **1376×788**: sin desbordes y **0 errores de consola**.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: cierra huecos internos de una pista, no compacta todas las pistas
  a la vez ni mueve subtítulos/marcadores. UI cubierta con jsdom; sin instalador.

### Separar audio del video (2026-10-21)

- **Brecha**: el audio de un video sólo se podía silenciar; no había forma de
  moverlo a un clip propio para editarlo, moverlo o reemplazarlo sin tocar la
  imagen.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `DetachAudioNode`, `VideoSeparateAudioParam`,
  `isSoundSeparateAudio`, `RunExtractAudio` y `extract_audio`.
- **Implementado**: acción `detachAudio`: copia la ventana, velocidad, reverse,
  ajustes de audio y color a un clip `audio`; reutiliza la primera pista
  audio/narración libre o crea **Audio separado**; silencia el video para no
  duplicar sonido. Botón **Separar audio** en Audio del clip, con selección del
  clip nuevo y aviso.
- **Evidencia medida**: tests de acción (pista nueva, reutilización de pista
  libre, rechazo de clip no-video y pista bloqueada) y de UI (selección → botón
  → clip de audio en la timeline). Playwright a **1376×788**: sin desbordes y
  0 errores de consola.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: no se sondea si el video tiene audio; un video mudo genera un
  clip de audio silencioso. Sin render live específico ni instalador; UI
  cubierta con jsdom.

### Color de clip (2026-10-21)

- **Brecha**: la matriz listaba “sin colores de clip”; ordenar cientos de tomas
  dependía sólo del nombre y del tipo de pista.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `segment_color_tag`, `set_segment_color_tag`,
  `get_segment_color_tag`, `material_color_tag` y `updateSegmentColorTag`: la
  etiqueta de color pertenece al segmento.
- **Implementado**: `colorTag` opcional y aditivo en el esquema (8 valores);
  chips con muestra en el Inspector, acción para asignar/limpiar, punto de color
  en la timeline y selector **Color** que atenúa los clips que no coinciden. Un
  filtro `all` deja todo normal. JSON Schema regenerado. No toca el render.
- **Evidencia medida**: tests de esquema (acepta `teal`, rechaza `neon`), de
  acción (asigna y limpia), del helper de filtro y de UI (selección → **Color
  Violeta** → punto → **Sin color**; filtro verde atenúa el clip rojo y el filtro
  rojo lo restaura). Playwright a **1376×788**: sin desbordes
  (`scroll 1376×788`) y 0 errores de consola.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: la etiqueta no se ordena; el filtro atenúa pero no oculta clips.
  La UI se cubrió con jsdom; no se rehízo el instalador.

### Mute por clip (2026-10-21)

- **Brecha**: sólo se podía silenciar una pista completa; para apagar el audio
  de un B-roll había que bajar la ganancia a -60 dB, que no es un mute real.
- **Evidencia REA**: `videoeditor.dll` de CapCut 9.4.0.4015 (SHA-256
  `32e8da19…`) contiene `video_mute`, `muted`, `muteAllTracks`,
  `NodeWrapperSegmentVideoVolume`, `NodeWrapperSegmentAudioVolume` y
  `AdjustVolumeKeyframe`: el audio se controla por segmento, además del mute de
  pista.
- **Implementado**: `audio.muted` opcional y aditivo en el esquema; casilla
  **Silenciar este clip** en **Audio del clip**; la preview pone volumen 0 en el
  video o audio del clip; Rust omite el clip del mix (usa `anullsrc` si no queda
  ningún audio) sin afectar la pista ni los demás clips. JSON Schema regenerado.
- **Evidencia medida**: test Rust por contraste: con `muted:true` el plan usa
  `anullsrc` y no aparece `volume=-3.00dB`; sin mute conserva
  `volume=-3.00dB`. Playwright a **1376×788**: `scrollWidth == clientWidth ==
  1376`, `scrollHeight == clientHeight == 788`, sin desbordes y sólo un 404 de
  `favicon.ico` en consola. La casilla no se pudo recorrer sin el backend Tauri;
  el comportamiento se cubre con los tests de esquema y render.
- **Medición**: typecheck limpio; **668 tests Vitest en 67 archivos**; Rust
  **144 passed, 0 failed, 4 ignored**; Flow Queue **31** y Web TTS **10**;
  `cargo fmt --all -- --check` limpio.
- **Límites**: no hay render live específico del mute; el grafo se verificó por
  contraste unitario. No hay “separar audio” ni mute por rango; no se rehizo el
  instalador.

### Destino de descargas, rail compacto y loop de 30 min (2026-10-21)

- **Elegir dónde guardar**: la tarjeta de Descarga muestra **Guardar en**, el
  disco y la ruta completa. **Elegir carpeta…** abre el selector nativo de
  Windows y **Usar predeterminada** vuelve a `Descargas/Videos descargados`. La
  elección se recuerda en `localStorage`
  (`editor-ia.download-dir.v1`). Rust valida que sea una carpeta absoluta
  existente y sigue escribiendo en `<elegida>/<Red>/<Nombre del video>`; no
  aplana la biblioteca ni cambia la carpeta por video.
- **Rail más chico**: 40 px de ancho, botones de 34 px (30 en densidad compacta,
  38 en amplia), iconos de 17 px, avatar de perfil de 24 px y separadores más
  cortos. El modo con etiquetas conserva el ancho configurable.
- **Loop de mejora continua**: la automatización local
  **Editor IA · mejora continua cada 30 min** trabaja sobre este repo: elige una
  sola brecha medible, implementa, verifica con typecheck, Vitest, Rust y
  Playwright, y documenta. No commitea, no pushea y no genera instaladores. Se
  pausa si falla tres veces seguidas.
- **Medición**: **668 tests Vitest en 67 archivos**; Rust **144 passed, 0 failed,
  4 ignored**; typecheck, build y verify verdes; entrada **472,47 kB JS**, CSS
  **153,10 kB**. El rail y Descargar se verificaron en la ventana nativa
  (1376×788) y en Chromium; el diálogo nativo de carpeta se cubrió con la
  validación Rust y el flujo simulado, no con un clic automatizado del selector
  del sistema.

### Inicio profesional (2026-10-20)

- La app abre en **Inicio** (nueva vista y primera entrada del rail), con un
  panel de estudio en dos columnas: preparación, extensión, recientes y descarga
  rápida.
- **Preparación**: yt-dlp, FFmpeg, FFprobe y SAPI con estado real y acciones para
  instalar el motor, elegir binarios o ir a Ajustes. Indicador `n/4 herramientas
  listas`.
- **Extensión de Chrome/Edge**: `extension_status` y `prepare_extension` copian
  la extensión a `config/extension/editor-ia-downloader`, la abren en el
  explorador y muestran la ruta y los pasos de “Cargar descomprimida”. Los
  recursos de Tauri incluyen la extensión; en desarrollo también se encuentra en
  el repo. El navegador exige la confirmación final, no hay instalación
  silenciosa.
- **Recientes y descarga**: abre proyectos recientes sin pasar por Proyectos y
  permite pegar una URL para ir a Descargar, incluso sin proyecto abierto.
- **Medición**: **668 tests en 67 archivos**; Rust **144 passed, 0 failed, 4
  ignored**; typecheck, build y verify verdes. Entrada **472,47 kB JS**,
  `EditorWorkspace` **175,13 kB**, CSS **153,10 kB**. La app debug se recompiló y
  se abrió con esta vista.
- **Límites**: no se rehizo el instalador NSIS; el paso de instalar la extensión
  en el navegador sigue siendo manual por diseño. La vista se verificó a
  **1376×788** en la ventana nativa.

### Descarga inteligente y biblioteca por plataforma (2026-10-20)

- **Causa reproducida**: la vista Descargar permitía analizar una URL desde
  Proyectos sin un proyecto abierto, pero el botón de descarga estaba
  deshabilitado porque el flujo sólo sabía importar a Medios. Además, el campo
  `type="url"` bloqueaba envíos con dominios sin `https://` o texto compartido.
- **Arreglo**: `normalizeDownloadUrl` acepta URLs completas, dominios sin
  esquema y texto con un enlace; los campos pasan a texto con validación propia.
  **No hace falta un proyecto**: la UI muestra “No necesitás un proyecto para
  descargar” y el botón **Descargar a la biblioteca**. Rust mueve el resultado a
  **`Descargas/Videos descargados/<Plataforma>/<Nombre del video>`** con
  nombres únicos y devuelve la ruta; la UI muestra **Mostrar en carpeta**. Con
  proyecto, además se importa a Medios desde esa biblioteca.
- **Calidad elegible**: selector **Mejor disponible**, **Mínima disponible** o
  una altura real. `video_format_selector` usa `bestvideo+bestaudio` o
  `worstvideo+worstaudio`; el tope de altura sólo aplica a las opciones
  concretas. No inventa 8K si la fuente no lo tiene.
- **Biblioteca por plataforma y video**: cada descarga va a
  `<Plataforma>/<Nombre del video>/archivo` (YouTube, TikTok, Instagram,
  Facebook, X, Vimeo, Twitch, Pinterest, Reddit, Threads, Snapchat u Otros). La
  extensión de Chrome/Edge usa la misma estructura.
- **OSError 22 corregido**: el nombre temporal usaba hasta 120 caracteres del
  título; sumado al caché y a los sufijos de yt-dlp superaba el límite de ruta
  de Windows. Ahora usa `%(title).60s`, nombres Windows-safe y la carpeta por
  video se deriva de ese nombre corto. Se reprodujo el error con un nombre de
  300 caracteres y se verificó el arreglo en vivo.
- **Evidencia**: yt-dlp **2026.08.19** analizó y descargó un video público de
  YouTube (Big Buck Bunny, CC BY) de 144p: MP4 de **15 MB**, FFmpeg merge/remux
  correcto; el test vivo de la app bajó 360p y comprimió. `--simulate` confirmó
  que Mejor elige 2160p y Mínima 144p en ese video. También se probaron
  `youtu.be`, `m.youtube.com` y una URL con `&list=`.
- **Medición**: **617 tests en 67 archivos**; Rust **140 passed, 0 failed, 3
  ignored**; typecheck y build verdes. Entrada **469,34 kB JS**, CSS
  **146,63 kB**. Prueba end-to-end por el puente: descarga Mínima de un video
  público en `Videos descargados/YouTube/<nombre corto>/`, 6.004.268 bytes.
  Tests nuevos: 4 de normalización, 2 de flujo sin proyecto, plataforma, carpeta
  por video, límite de nombre y selectores Mejor/Mínima/altura.
- **Límites**: no se descargan DRM, transmisiones en vivo, contenido privado ni
  videos que exijan login sin un `cookies.txt` válido; la disponibilidad la
  decide el sitio. Descargá sólo contenido propio o con permiso.

### Timeline navegable y Ajustes reestructurados (2026-10-20)

- **Mover la timeline con el mouse**: nueva herramienta **Mover** (icono de mano,
  tecla **H**) que panea en horizontal y vertical arrastrando; el **botón
  central** panea siempre sin activar el modo. **Shift+rueda** desplaza en
  horizontal y **Ctrl+rueda** hace zoom manteniendo el frame bajo el cursor. La
  barra muestra “Arrastrá para mover” mientras el modo está activo. El paneo no
  mueve el playhead ni cambia la selección.
- **Ajustes en dos paneles**: barra lateral fija con seis secciones (Apariencia,
  Inteligencia artificial, Voz y audio, Herramientas, Datos locales y Alcance),
  encabezados con explicación, tarjetas agrupadas y estado activo sincronizado al
  scrollear. En pantallas angostas la barra pasa a grilla superior. La navegación
  interna ahora desplaza sólo el contenido: se corrigió el `scrollIntoView` que
  arrastraba el shell y ocultaba la barra superior. `overflow: clip` en el shell
  evita que el foco vuelva a desplazarlo.
- **Verificación visual**: Ajustes se recorrió en un navegador real a
  **1360×577** (Apariencia, IA, Voz, Herramientas y Datos), y la timeline se
  revisó en un harness temporal con un clip de 3000 frames (luego retirado).
- **Medición**: typecheck limpio; **596 tests en 59 archivos**; `npm run build`:
  entrada **467,01 kB JS**, `EditorWorkspace` **169,64 kB**, `SettingsHome`
  **23,97 kB**, CSS **146,63 kB**. Los 3 tests nuevos cubren mano, botón central
  y ruedas; el test de Ajustes cubre la navegación y el estado activo.
- **Límites**: el paneo táctil no se probó en la app nativa; la evidencia es el
  navegador, los tests de UI y el typecheck. Ajustes mantiene los formularios
  existentes; no se agregó búsqueda de ajustes.

### Precisión de color y capítulos (2026-10-20)

- **Intensidad de LUT**: nuevo campo `lutIntensity` (0–1) en el esquema y el JSON
  Schema. En FFmpeg, 100 % sigue siendo un único `lut3d`; los valores parciales
  dividen el stream y mezclan el original con la rama graduada
  (`blend=all_mode=normal:all_opacity=1-intensity`), conservando máscara y
  opacidad. Funciona por clip, en capas de ajuste (con `enable` en la ventana
  temporal) y en el look global. La UI expone **Intensidad LUT (%)** donde se
  carga el `.cube`. La preview sigue sin simular el LUT.
- **Scopes**: botón **Scopes** en la preview con onda de luminancia,
  vectorscopio de croma e histograma RGB. Muestrea el clip visual activo con el
  grade CSS de la preview a ~5,5 Hz y dibuja en canvas. Tiene tabs accesibles,
  cierre con botón y estados “Señal en vivo”/“Sin señal”. Los medios de la
  preview usan `crossOrigin="anonymous"` y el protocolo de assets de Tauri
  responde con el origen de la ventana, para que el canvas pueda leer píxeles
  sin quedar contaminado. No incluye LUT, títulos, máscaras, recortes ni el
  compuesto final; es una herramienta de orientación, no una medición del MP4.
- **Capítulos**: `validateChapters` comprueba el mínimo documentado por YouTube
  (tres capítulos, primero en 0:00, 10 s entre inicios). El Inspector los valida
  al instante y muestra los problemas; no se confunde con una garantía de
  moderación.
- **Evidencia REA**: se reabrió `CapCut.exe` 9.4.0.4015 (SHA-256
  `eeb04ca7…`) y se buscaron strings de scopes/intensidad. La búsqueda no
  devolvió literales definidos; vale la limitación de Ghidra para binarios
  empaquetados y no se usa como prueba de ausencia. La referencia de producto
  sigue siendo el inventario CapCut ya documentado y la documentación pública.
- **Medición**: `npm run verify` verde (typecheck + Vitest + 31 Flow Queue + 10
  Web TTS); **593 tests en 59 archivos**. Rust: **130 passed, 0 failed, 3
  ignored**; `cargo fmt --all -- --check` limpio. `npm run build`: entrada
  **466,58 kB JS** (gzip 135,29), `EditorWorkspace` **167,35 kB**, CSS **142,76
  kB** (gzip 25,22). Humo real de FFmpeg con LUT identidad: grafo de mezcla y
  grafo con `enable` devolvieron **BLEND OK** y **GATED OK**.
- **Límites**: el LUT no tiene protección de piel ni presets por marca; los
  scopes no reflejan el compuesto final. Siguen faltando smart relight, smart
  reframe, motion tracking, matting IA, multicam y timelines anidadas. La vista
  Scopes no se recorrió a mano en la app release; la evidencia es el test de UI,
  el cálculo puro probado y el typecheck.

### Iconos, tutorial inteligente y cumplimiento (2026-10-20)

- **Acciones con iconos**: las barras de herramientas usan iconos de 13–16 px y
  ocultan el texto a la vista, conservando texto accesible, `aria-label` y
  tooltip nativo. Se sumaron iconos de alerta, copiar, pegar y ripple. Los
  formularios, menús y reglas siguen escritos para no romper la claridad.
- **Memoria silenciosa**: la tarjeta “Memoria del Director” y su reset se
  quitaron de la UI; el perfil se sigue guardando y calibrando solo en la capa
  local `editor-memory`. No se muestra ni se envía.
- **Tutorial inteligente**: `learning-progress` persiste visitas y secciones en
  `localStorage` v2, migra el formato v1, marca automáticamente la sección de
  cada vista visitada y emite `editor-ia:learning-updated`. **Aprender** escucha
  el cambio, muestra el progreso y personaliza el siguiente paso. La app no
  expone el registro.
- **Panda Pando**: SVG original con regla, bufanda menta y animaciones de
  balanceo, paso, mirada y golpecito; aparece en la bienvenida con consejos
  rotativos y en Aprender señalando la última vista y la siguiente sección.
  Respeta `prefers-reduced-motion`.
- **Cumplimiento**: `platform-rules` define ocho paquetes con fuentes oficiales;
  `auditProjectForPlatform` bloquea derechos sin confirmar y avisa por
  orientación, altura, duración, peso, subtítulos, música, IA y duplicados. La
  vista nueva audita el proyecto abierto, permite forzar la actualización y
  cachea el documento remoto. El comando Rust `fetch_platform_rules` baja el
  JSON fijo del repositorio (máx. 512 KB, esquema validado) con timeout de 15 s.
  `PublicationReadiness` enlaza a esta vista. **Las reglas nuevas sólo llegan a
  otros equipos después de publicar `data/platform-rules.json` en `main`**;
  mientras tanto rige el paquete incluido.
- **Medición**: `npm run verify` verde (typecheck estricto + Vitest + 31 Flow
  Queue + 10 Web TTS); **573 tests Vitest en 56 archivos**; Rust **125 passed, 0
  failed, 3 ignored**. `npm run build`: entrada **466,25 kB JS** (gzip 135,24),
  `EditorWorkspace` **157,60 kB**, `ComplianceView` **16,46 kB**; CSS **140,61
  kB** (gzip 24,77). Cuatro tests nuevos de progreso, cuatro de reglas, cuatro de
  timeline y el flujo de Cumplimiento en la app.
- **Límites**: son ocho redes, no “todas”; las reglas son una ayuda de preflight
  editable, no una copia certificada ni una garantía de monetización o de
  ausencia de strikes. No se recorrió la vista Cumplimiento a mano en la app
  release; la evidencia es el test de UI, typecheck y la suite.

### Movimiento de títulos en dos keyframes (2026-10-20)

- `npm test`: **617 tests en 67 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `cargo test --workspace`: **141 passed, 0 failed, 3 ignored**;
  `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **469,34 kB JS**, `EditorWorkspace` **174,40 kB**;
  CSS **146,63 kB**.
- Render live con un título `slide-left` de dos claves: **65.379 bytes,
  320×180, 2,500 s**, FFprobe OK; YAVG 65,45 → 90,09.
- Tests nuevos: 1 de esquema, 1 de acción, 4 del sampler/presets y 1 de ASS.

### Revelado por palabra (2026-10-20)

- `npm test`: **611 tests en 61 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `cargo test --workspace`: **140 passed, 0 failed, 3 ignored**;
  `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **467,97 kB JS**, `EditorWorkspace` **172,14 kB**;
  CSS **146,63 kB**.
- Render live con un cue de cuatro palabras y `wordReveal: true`:
  **60.505 bytes, 320×180, 2,500 s**, FFprobe OK; YAVG 65,45 → 90,29.
- Tests nuevos: 1 de esquema, 1 de acción, 1 del helper de palabras visibles y 1
  Rust de eventos ASS incrementales; el render live existente se extendió.

### Caché persistente de waveforms (2026-10-20)

- `npm test`: **608 tests en 61 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `cargo test --workspace`: **137 passed, 0 failed, 3 ignored**;
  `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **467,86 kB JS**, `EditorWorkspace` **171,45 kB**;
  CSS **146,63 kB**.
- Medición de la caché: una entrada de **180 buckets pesa 721 bytes**; 48
  entradas ocupan **~33,8 KB**. El test de hit demuestra que `useWaveform` no
  llama a `fetch` ni decodifica cuando el hash ya está cacheado.
- Tests nuevos: 5 (roundtrip, clave por hash vs. URL, entradas corruptas, poda
  al tope y error de cuota; más el hit del hook). No se tocó FFmpeg: no hubo
  render live.

### Selector nativo de subtítulos (2026-10-20)

- `npm test`: **603 tests en 60 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `cargo test --workspace`: **135 passed, 0 failed, 3 ignored**;
  `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **467,86 kB JS**, `EditorWorkspace` **170,07 kB**;
  CSS **146,63 kB**.
- Tests nuevos: 4 Rust del lector (SRT UTF-8, VTT, extensión/vacío y bytes no
  UTF-8) y 1 de UI que carga el archivo en el panel con el servicio simulado.
- Se descartó `anlmdn`: el filtro existe pero el FFmpeg 9.0.1 instalado termina
  con exit 127 en una prueba directa; se revirtió. El render live se re-ejecutó
  después: **55.676 bytes, 320×180, 2,500 s**, FFprobe OK.

### Tono fino: sombras, altas luces y fade (2026-10-20)

- `npm test`: **596 tests en 59 archivos**, verde (incluye tests de pasadas
  concurrentes de Scopes/Cumplimiento); `npm run typecheck` limpio; **31 tests**
  de Flow Queue y **10** de Web TTS.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **130 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **466,87 kB JS**, `EditorWorkspace` **169,38 kB**;
  CSS **146,58 kB**.
- Render live con la capa de tono en el clip complejo del test: **55.676 bytes,
  320×180, 2,500 s**, FFprobe OK; YAVG 70,00 → 90,31.
- Tests nuevos: 2 de esquema y 1 unitario de la curva de tono; los tests de
  grafo del clip, del look y el render live existentes se extendieron con
  `shadows`/`highlights`/`fade`.

### Snapping magnético (2026-10-20)

- `npm test`: **582 tests en 57 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **125 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **466,42 kB JS**, `EditorWorkspace` **159,51 kB**;
  CSS **141,11 kB**.
- Tests nuevos: 8 del helper (targets de todas las pistas, exclusión del clip
  arrastrado, snap por inicio/fin, sin objetivo cercano, umbral por zoom) y 1 de
  UI que apaga y prende el imán.
- No se tocó FFmpeg: no hubo render live.

### Recorte fino: slip, slide y roll (2026-10-20)

- `npm test`: **564 tests en 54 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **125 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: build code-split; entrada **459,51 kB JS**,
  `EditorWorkspace` **157,27 kB**; CSS **135,77 kB**.
- Tests nuevos: 10 de acciones (slip dentro/fuera de ventana, velocidad 1×;
  slide a ambos lados, huecos y keyframes; roll de entrada/salida y límites).
  La pestaña **Recorte** se verificó con typecheck, no con un test de UI propio.
- No se tocó FFmpeg: no hubo render live.

### Marcadores y capítulos (2026-10-20)

- `npm test`: **550 tests en 52 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **125 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: build code-split (cambio de una pasada concurrente); entrada
  **455,54 kB JS**, `EditorWorkspace` **155,53 kB**, `AssetsPanel` **16,20 kB**,
  chunk `markers` **2,22 kB**; CSS **125,80 kB**.
- Tests nuevos: 7 de esquema (marcador válido, una línea, color, frame, default
  retrocompatible, frame duplicado y tope de 200), 7 de acciones/capítulos, 1
  del manifiesto de publicación y 1 de UI que agrega y quita un marcador con M.
- No se tocó FFmpeg: no hubo render live en esta pasada.

### Organización de medios (2026-10-20)

- `npm test`: **533 tests en 50 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **122 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio. No se tocó el grafo
  FFmpeg, así que no hubo render live.
- `npm run build`: **806,72 kB JS / 123,20 kB CSS**.

### Descargador social, extensión y rendimiento (2026-10-20)

- **Proyectos** ya no muestra el encabezado “Local-first” ni el párrafo
  explicativo: abre con las herramientas y una barra para pegar una URL. El rail
  izquierdo quedó en **48 px** (antes 58) y el modo con etiquetas en 172 px.
- **Todas las vistas de herramientas** (Director, Producción, Fábrica, Guion,
  Medios, Descargar, Convertir, MCP y Ajustes) reemplazaron el título, el eyebrow
  y el párrafo por una barra compacta con estado, conteo y acciones. El editor
  conserva el nombre del proyecto y sus acciones. La jerarquía, el foco visible y
  la densidad siguen patrones de **shadcn/ui** y **Radix UI** (MIT); no se copió
  código ni se agregaron dependencias.
- **Puente local** en `127.0.0.1` (puertos 47615–47625) con token persistente;
  endpoints de health, probe, download, jobs y direct-image. La extensión MV3 está
  en `extensions/editor-ia-downloader` y empaquetada en
  `dist/editor-ia-downloader-1.0.0.zip` (**13.250 bytes**, SHA-256
  `047E91A2E2CC3F007D249DB7917D433D965609DE853CC35039E7D21EA8AFD479`).
- **Verificación real**: Chrome for Testing 153 cargó la extensión descomprimida,
  se conectó con el token, analizó un video 4K y descargó por la UI un MP4 de
  **14,9 MB**; también descargó una imagen directa de **1,1 MB** y mostró el
  resultado. Por el puente se verificaron además un MP4 de 360p (**25,5 MB**,
  FFprobe: 640×360, AV1, 634,6 s), un MP3 (**19,0 MB**) y una imagen directa
  (**1,06 MB**). Los archivos de prueba se borraron después.
- **Diseño plano**: `flat.css` elimina gradientes, glows, blur, sombras y
  animaciones ornamentales del chrome; normaliza las etiquetas a caja baja,
  aplana tarjetas, timeline y clips, convierte las métricas en filas y deja el
  foco visible con un `outline` de acento. Los colores semánticos y el contenido
  de imagen/texto del proyecto se conservan.
- **Timeline arrastrable**: el carril de la regla no tenía ancho y quedaba
  prácticamente muerto; ahora usa un ancho explícito y toda la regla inicia el
  scrub. El cabezal tiene un handle arrastrable con rol `slider`, flechas,
  Inicio/Fin y `aria-valuenow`; se evita la selección nativa con
  `preventDefault`/`touch-action`. Cuatro tests cubren ancho, arrastre continuo,
  handle y teclado.
- **Rendimiento**: las vistas pesadas pasaron a carga diferida. El JS inicial
  bajó de **806,72 kB a 459,51 kB** y el chunk del editor (157,27 kB) se carga
  sólo al entrar. El CSS mide 135,77 kB; sin advertencia de chunk >500 kB.
- **Tests**: `npm test` **564 tests en 54 archivos**, typecheck limpio; Rust
  **125 passed, 0 failed, 3 ignored**; `cargo fmt --check` limpio. Se agregaron
  4 tests de timeline, 3 del puente y el flujo de URL rápida en la UI.
- Captura de la extensión:
  [`editor-ia-shots/extension-preview-2026-10-20.png`](editor-ia-shots/extension-preview-2026-10-20.png).
- Tests nuevos: 4 de esquema (favoritos/tags/bin, duplicados, tope y longitud),
  3 de acciones (guardar/limpiar, alternar favorito, rechazos), 4 del helper de
  búsqueda/filtros y 1 de UI que filtra por favoritos/etiqueta y alterna la
  estrella.

### Capas de ajuste por tramo (2026-10-20)

- `npm test`: **521 tests en 49 archivos**, verde; `npm run typecheck` limpio;
  **31 tests** de Flow Queue y **10** de Web TTS.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **122 passed, 0
  failed, 3 ignored**; el render live incluye una capa de ajuste con contraste,
  curva contrast-soft y LUT identidad y verificó **55.638 bytes, 320×180,
  2,500 s** con FFprobe (YAVG 70,00 → 90,27 entre 0,6 s y 2,1 s). La descarga
  social live con yt-dlp (Big Buck Bunny, 360p, H.264 CRF 27) terminó con
  archivos verificados.
- `npm run build`: **801,33 kB JS / 121,93 kB CSS**. El árbol incluye la vista
  **Descargar** de una pasada concurrente, ya commiteada en `781d9c1`.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` está
  limpio, incluida la vista Descargar y la capa de ajuste.
- Tests nuevos: 3 de esquema, 3 de acción y 2 de render; el test live existente
  se extendió con la capa de ajuste.

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
| `npm run rules:export` | regenera `data/platform-rules.json` desde `platform-rules.ts`. |
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
vulnerabilidades. Las dependencias directas y sus licencias están en
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Documentación

- [Especificación de producto](docs/product/PRODUCT-SPEC.md)
- [Formato de proyecto v1](docs/architecture/PROJECT-FORMAT.md)
- [Análisis de la referencia y comparación](docs/reference/VIDEO-ANALYSIS-2026-10-19.md)
- [Auditoría de paridad con CapCut/Filmora/DaVinci (REA)](docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md)
- [Paridad con DaVinci Resolve: qué se agregó y qué falta](docs/reference/DAVINCI-PARITY-2026-10-22.md)
- [Ventana negra en Windows: GPU de WebView2 y bundle](docs/reference/WEBVIEW2-GPU-CRASH-2026-10-21.md)
- [Rendimiento: qué se midió y qué se mejoró](docs/reference/PERFORMANCE-2026-10-22.md)
- [Prueba real de Google Flow](docs/reference/FLOW-REAL-DOM-2026-10-19.md)
- [E2E de montaje automático y export](docs/reference/APP-AUTOEDIT-E2E-2026-10-19.md)
- [Tutorial completo de uso](docs/TUTORIAL.md)
- [Google Flow MCP: fotos y videos desde la app](docs/integrations/GOOGLE-FLOW-MCP.md)
- [Gestor de servidores MCP](docs/reference/MCP-MANAGER-2026-10-19.md)
- [Integración Flow Queue ↔ Editor IA](docs/integrations/FLOW-QUEUE.md)
- [Web TTS Bridge: automatización de webs de voz](docs/integrations/WEB-TTS-BRIDGE.md)
- [Stack MIT: repos evaluados e integrados](docs/integrations/MIT-STACK-2026-10-21.md)
- [Avisos de terceros](THIRD-PARTY-NOTICES.md)
- [Loop de construcción y ledger](docs/automation/BUILD-LOOP.md)
- [Seguridad](SECURITY.md)

## Licencia

[MIT](LICENSE), sólo sobre el código fuente propio de Editor IA.

## Monitor 1:1 nativo con video-rs (2026-10-23)

- **Decodificación en proceso**: el modo **1:1** del monitor pide el frame a la
  resolución real del medio. `video-rs` 0.12 (con `ndarray`) decodifica el frame
  en Rust, lo entrega en RGB24 y el mismo `visual_filter` del render aplica
  efectos, máscara, relight, lente y LUT antes de escribir el PNG. Si el clip
  tiene matriz de rotación o píxeles no cuadrados, se usa FFmpeg (que aplica
  autorrotación y SAR) a las dimensiones nativas; si el contenedor no se puede
  sondear, vuelve al tamaño del lienzo. El badge del monitor informa si el
  frame salió de `video-rs` o de FFmpeg.
- **Medición real**: un MP4 `testsrc2` de **640×360** dentro de un proyecto
  **320×180** produjo un PNG de **640×360** con `decoder=video-rs`; el mismo
  archivo con `-display_rotation 90` salió **360×640** con `decoder=ffmpeg`
  (autorrotación). El preview de lienzo sigue saliendo 320×180 con
  `decoder=ffmpeg`. Tests live
  `live_native_frame_uses_video_rs_at_source_size` y
  `live_native_frame_honours_display_rotation`.
- **Requisitos de compilación**: FFmpeg **9.0 shared LGPL** de desarrollo
  (`include/`, `lib/avcodec.lib`, `bin/avcodec-63.dll`) y `libclang.dll` para
  bindgen. `scripts/rust-env.mjs` detecta el build en
  `D:\DevCache\ffmpeg-n9.0-lgpl\...` (o `EDITOR_IA_FFMPEG_DEV`), exporta
  `FFMPEG_DIR`, `PKG_CONFIG_PATH`, `LIBCLANG_PATH` y el stack de 64 MB que
  necesita bindgen. `npm run setup:ffmpeg` copia las siete DLLs a
  `resources/ffmpeg-dll/` y a `target/{debug,release}`.
- **Distribución**: el instalador NSIS mapea las siete DLLs a la raíz de
  instalación, junto al `.exe`; `FFMPEG-LICENSE.txt` queda al lado. Son ~150 MB
  sin comprimir, así que el instalador crece respecto del build anterior. El
  `ffmpeg.exe` estático que renderiza sigue siendo un proceso separado.
- **Instalador verificado (2026-10-23)**: `Editor IA_0.1.0_x64-setup.exe`,
  **180,66 MiB** (189.436.896 bytes), SHA-256
  `AB716BBC67781F354EA0B20269C9C700E32BCAE417FA0E213961BCE4A044FFD5`,
  firma Authenticode válida. Instalado en
  `C:\Users\ofici\AppData\Local\Editor IA`; la app arrancó y el proceso cargó
  las **siete DLLs desde esa carpeta** (verificado con la tabla de módulos). El
  ejecutable y `avcodec-63.dll` verifican con `signtool /pa`.
- **Pruebas**: Rust **232 passed, 0 failed, 13 ignored**; frontend **869/869**
  en 98 archivos; typecheck limpio. El test de lib necesita el manifiesto de
  comctl32 v6: `rust-env` marca `EDITOR_IA_TEST_BUILD=1` y `build.rs` enlaza
  `resource.lib` sólo en esa corrida; el target de test del bin está desactivado
  (`test = false`) para no duplicar el recurso.
- **Límites**: no hay decodificación por hardware ni decodificación de video en
  tiempo real; el frame nativo se pide bajo demanda. La rotación/SAR usan el
  camino FFmpeg, y el seek de `video-rs` empieza en el keyframe anterior y avanza
  hasta el timestamp pedido. El modo 1:1 no compone otras pistas ni subtítulos.
