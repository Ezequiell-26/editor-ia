# Tutorial completo de Editor IA

Esta guía lleva un proyecto desde la idea hasta un MP4 verificado. También está
disponible dentro de la app en **Aprender**, con accesos directos a cada vista.

## 1. Antes de empezar

Editor IA es local-first: proyectos, medios, subtítulos y claves se quedan en tu
equipo. Necesitás:

- Windows 10/11 con WebView2.
- FFmpeg y FFprobe (en `PATH` o elegidos en **Ajustes → Herramientas**).
- PowerShell 5.1 para la voz SAPI local.
- Python con `faster-whisper` sólo si vas a transcribir.
- Node/npx sólo si vas a usar servidores MCP basados en Node.

El instalador no incluye FFmpeg ni modelos de transcripción. La app avisa cuando
falta una herramienta.

Al abrir Editor IA vas a ver **Inicio**: muestra el estado de yt-dlp, FFmpeg,
FFprobe y SAPI; permite instalar o cambiar las herramientas, preparar la
extensión de Chrome/Edge, retomar proyectos recientes y pegar una URL para
descargar incluso sin un proyecto abierto.

## 2. Crear un proyecto con cualquier formato y fps

1. Abrí **Proyectos**.
2. Escribí un nombre.
3. Elegí **Formato**:
   - 16:9 (1920×1080), 9:16 (1080×1920), 1:1 (1080×1080), 4:5, 4:3, 21:9.
   - **Personalizado…** para cualquier ancho/alto entre 16 y 32 768 px. El render H.264 se limita a 16 384 px; para 32K usá H.265.
4. Elegí **Tasa de frames**:
   - 23,976 · 24 · 25 · 29,97 · 30 · 50 · 59,94 · 60 · 120.
   - **Personalizada…** con numerador y denominador exactos (por ejemplo
     24000/1001).
5. Pulsá **Crear y elegir ubicación…** y elegí la carpeta del `.editoria.json`.

La app redondea el ancho y alto a números pares porque H.264 con `yuv420p` lo
requiere. En el **Inspector** del editor podés cambiar el formato o los fps más
tarde:

- Cambiar el tamaño no toca el timing; el renderer ajusta cada clip al nuevo
  canvas y actualiza el perfil “Formato del proyecto”.
- Cambiar los fps reajusta clips, assets, subtítulos y escenas conservando los
  segundos. Si hay clips con velocidad distinta de 1×, volvelos a 1× primero: así
  se mantiene la identidad exacta entre ventana de origen y duración.

## 3. Importar medios

1. Abrí **Medios**.
2. Importá imágenes, videos o audios. Cada archivo se copia a `media/`, se mide
   con FFprobe, se hashea con SHA-256 y recibe licencia/procedencia.
3. Confirmá los derechos. Un material con licencia desconocida no puede estar
   listo ni exportarse.
4. Organizá la biblioteca: la **estrella** marca favoritos, **Bin** agrupa
   materiales (por ejemplo “Entrevistas”) y **Etiquetas** acepta hasta 8 términos
   separados por coma. La búsqueda cubre nombre, ruta, bin y etiquetas; los
   filtros combinan tipo, bin y **Solo favoritos**. Todo se guarda en el
   `.editoria.json`. Los medios montados muestran un punto “en timeline”.

Podés montar un medio desde la biblioteca o desde el rail del editor.

## 4. Escribir o generar el guion

En **Guion**:

- Escribí las escenas a mano o generá un plan con el proveedor configurado.
- El proveedor simulado no hace red; el proveedor OpenAI-compatible puede ser
  OpenAI, Ollama, LM Studio, vLLM u otro endpoint equivalente.
- Cada escena guarda título, intención, narración, nota visual y duración
  estimada. Podés editar todo.
- **Prompts para Flow** crea un prompt por escena, con estilo editable. Descargá
  el `.txt` y usalo en la extensión Flow Queue.
- El campo de proyecto de Flow abre la URL con tu propia sesión de Google. La
  app no maneja tu cuenta.

## 5. Voz

**Windows SAPI** es gratis y local. Elegí una voz instalada y sintetizá.

Alternativas:

- **ElevenLabs** por API oficial: la clave va al Administrador de credenciales de
  Windows y la app pide confirmar créditos antes de llamar.
- **Web externa manual**: Editor IA abre una URL HTTPS; vos generás y descargás el
  audio, y después lo importás en Medios. No inicia sesión, no paga y no evade
  captchas.

La **Fábrica** fuerza SAPI local para que un lote no dependa de créditos externos.

## 6. Montaje automático

En **Producción**:

1. Revisá el guion.
2. Asigná o importá las imágenes.
3. Generá la voz de las escenas que falten.
4. Pulsá **Generar video automático**.

La app asigna imágenes **o videos generados** por orden o similitud de prompt,
usa la duración exacta de cada voz, crea subtítulos, alterna Ken Burns y agrega
disolvencias si se piden. Un video más corto que la narración se estira hasta 2×;
si no alcanza, se usa una imagen de respaldo para no cortar la voz. El resultado
queda como clips normales en la timeline y se puede editar.

Si no hay voz, elegí cuántos segundos dura cada imagen. El montaje automático no
finge alinear palabras con imágenes.

### Importar una timeline de otra app

En **Producción → Publicación**, dentro de **Timeline de otra app**:

1. Confirmá que tenés derechos para importar los medios referenciados.
2. Pulsá **Elegir EDL/OTIO/FCPXML…** y elegí el archivo.

La app crea pistas nuevas, conserva cortes, offsets y ventanas de origen, copia
los medios al proyecto y reutiliza los que ya estaban importados. Podés abrir el
editor desde el mismo bloque. Las transiciones, efectos y clips conectados que
el formato no conserva se muestran como avisos; no se inventan. Los tiempos se
convierten al fps del proyecto y los medios que no se encuentran se omiten con
un aviso. Importá timelines de fuentes confiables: los archivos referenciados se
copian a la carpeta `media` del proyecto.

## 7. Director automático para material existente

En **Director**:

1. Elegí un video listo del proyecto.
2. Ajustá sensibilidad de escenas, umbral de silencio y duración mínima.
3. Analizá, transcribí y generá el plan.

El plan explica cada corte: silencios, tomas repetidas por texto, muletillas no
léxicas, negros, freezes y cortes de escena. Además arma limpieza de voz
(HPF/compresor/denoise), loudness, subtítulos con tiempos por palabra y una
corrección conservadora de exposición. Cada corte se aplica como clip editable y
se puede deshacer.

La **memoria local** calibra pocos parámetros con los cambios que conservás. No
entrena una red neuronal ni usa datos de otras personas. Se puede restablecer.

Después del análisis, **Auto Shorts** propone hasta cinco ventanas de 15–60 s
con un puntaje explicable: duración, gancho textual (pregunta, número o tensión),
densidad de voz, cambios de escena y cierre en silencio. **Copiar plan** deja los
rangos con tiempos y motivos para revisarlos. **Exportar 9:16** pide una carpeta y
genera un MP4 1080×1920 con audio conservado y verificación de dimensiones; el
progreso es real. Si descargás el modelo de rostros (1,2 MB) en la misma tarjeta,
**Smart reframe** sigue el rostro frontal más grande y mueve el encuadre; sin
detección cae al centro. No identifica personas, no sigue perfiles con
fiabilidad y no garantiza retención: son candidatos heurísticos.

## 8. Edición manual

En **Editor**, el layout sigue el flujo de un editor profesional: **medios a la
izquierda, Inspector al centro, preview a la derecha y timeline abajo**. El
Inspector del clip se organiza en pestañas **Video, Audio, Velocidad, Color,
Estilo y Todo** (solo aparecen las que aplican al tipo de clip). La pestaña
**Todo** muestra el inspector completo de una vez.

- **Timeline**: varias pistas, arrastrar, recortar, dividir, mover entre pistas,
  zoom, playhead y ripple. Con **clic derecho en un clip** abrís acciones rápidas:
  dividir, duplicar, copiar/pegar, **copiar/pegar atributos**, ir al inicio,
  eliminar o eliminar cerrando el hueco; el menú se maneja con flechas, Home,
  End y Escape. El campo **Buscar clip** atenúa los que no coinciden por nombre
  de clip, pista o material y, con Enter, salta al siguiente resultado. Con un
  filtro de color activo y atributos copiados, la toolbar
  ofrece **Pegar atributos al filtro** para aplicar el paquete a todos los clips
  de ese color (salta pistas bloqueadas). Las olas de audio se
  cachean por hash en `localStorage`, así que al reabrir el proyecto aparecen sin
  volver a decodificar el mismo material.
- **Navegar la timeline con el mouse**: activá **Mover** (icono de mano o tecla
  **H**) y arrastrá para desplazar la vista en horizontal y vertical. El botón
  central del mouse hace lo mismo sin activar el modo. **Shift+rueda** desplaza
  en horizontal y **Ctrl+rueda** acerca o aleja manteniendo el punto bajo el
  cursor. La rueda sola conserva el scroll vertical.
- **Marcadores y capítulos**: **M** agrega o quita un marcador en el playhead; los
  pines de la regla muestran el color y saltan a su frame al hacer clic. **Marcadores
  desde escenas** crea uno por escena en el inicio de su primer clip. Cada
  marcador puede volverse un **rango** con **Rango 2 s**, un **Fin** editable y
  una barra en la regla. **Cortar clips en marcadores** divide los clips de las
  pistas desbloqueadas en cada inicio de marcador, sin mover el resto. En el
  Inspector del proyecto podés renombrarlos, cambiar frame/color, borrarlos y
  **Copiar capítulos** o **Descargar .txt** en formato YouTube. La lista avisa
  si no cumple el mínimo de YouTube: al menos tres capítulos, el primero en
  0:00 y 10 s entre inicios. El manifiesto de publicación usa los marcadores
  cuando existen.
- **Snapping magnético**: al mover o recortar un clip, o al mover un subtítulo,
  el imán alinea el borde más cercano con clips de cualquier pista, el playhead,
  el inicio y los marcadores. La guía vertical muestra el destino. El botón
  **Imán** de la barra lo prende/apaga; mantené **Alt** mientras arrastrás para
  desactivarlo en ese movimiento.
- **Recorte fino**: seleccioná un clip de video o audio y abrí la pestaña
  **Recorte**. Elegí un desplazamiento en frames y pulsá **Slip** (mueve el
  contenido dentro del clip sin mover la timeline), **Slide** (mueve el clip y
  ajusta los vecinos) o **Roll entrada/salida** (mueve el corte con el vecino).
  Requieren velocidad 1×; Slide y Roll necesitan clips contiguos y rechazan
  keyframes.
- **Velocidad**: 0,1×–4× uniforme por clip.
- **Color y efectos**: brillo, contraste, saturación, temperatura, **sombras**,
  **altas luces**, **fade tonal**, rotación de tono, curvas por preset,
  **ruedas RGB de sombras/medios/luces**, **HSL selectivo por rangos de color**,
  viñeta, nitidez, desenfoque, blanco y negro, sepia y fades. Los **Looks
  rápidos** (Cálido, Frío, Cine, Vintage, B/N) aplican un punto de partida.
  **Efectos creativos** suma ocho recetas de un clic (Suave, Onírico, Noir, VHS,
  Documental, Alta/Baja clave, Neón) que conservan fades y LUT.
  Sombras/altas luces/fade se renderizan con una curva maestra y también están
  disponibles en el look global del proyecto.
- **Look del proyecto**: elegí un preset o ajustá el grade global en Proyecto →
  Look del proyecto. Se aplica al compuesto final antes de subtítulos y títulos,
  no toca los clips y se guarda con el proyecto; «Quitar look» lo limpia.
- **Capas de ajuste por tramo**: en la barra de la timeline pulsá **Capa de
  ajuste** (icono de capas). Se crea o reutiliza una pista **Ajustes** con una
  capa de 3 s en el playhead; seleccionala y editá su color, curvas, HSL o LUT
  en la pestaña **Ajuste**. El grade se aplica al compuesto final sólo dentro de
  ese tramo y no afecta subtítulos ni títulos. Movela, recortala o dividila como
  cualquier clip; varias capas de la misma pista se aplican en secuencia. El MP4
  usa `enable='between(t,…)'`; la preview aproxima curvas y LUT.
- **Movimiento**: zoom in/out y paneos Ken Burns con intensidad.
- **Audio por clip**: high/low-pass, EQ de tres bandas, compresor, de-esser,
  puerta de ruido, `afftdn`, ganancia, fades, presets Voz clara/Música y
  **Silenciar este clip** para apagar sólo ese audio sin tocar la pista.
  **Separar audio** mueve el sonido del video a un clip de audio propio (en una
  pista libre o nueva) y deja el video en silencio.
- **Color de clip**: en **Clip → Color del clip** elegí una de ocho etiquetas;
  la timeline muestra un punto junto al nombre y **Sin color** la quita. El
  selector **Color** de la timeline atenúa los clips con otra etiqueta; **Todos**
  vuelve a la vista normal. Sirve para ordenar tomas y no altera el render.
- **Audio del proyecto**: ganancia master, limitador, loudness -14/-23 LUFS,
  ducking de música por sidechain y **Voz clara a todos** / **Música a todos**
  para aplicar el preset a los clips de audio de pistas desbloqueadas sin tocar
  ganancia ni fades.
- **Chroma key**: color, similitud y mezcla, con presets verde/azul.
- **Transformación**: posición, escala, rotación, opacidad, volteo H/V y presets
  de 90/180/270°.
- **Keyframes de transformación**: fijá una clave en el playhead, mové el
  playhead, cambiá escala/posición/rotación/opacidad y fijá otra. Cada clave
  acepta una curva: lineal, acelerar, desacelerar, suave o mantener. La preview
  interpola y el MP4 anima las cuatro propiedades: escala, desplazamiento y
  rotación con expresiones FFmpeg por frame, y opacidad con comandos `sendcmd`
  muestreados por frame. “Fijar en playhead” captura el estado actual (incluida
  la escala estática) sin reiniciarlo.
- **Automatización de volumen**: claves de ganancia por frame (hasta 96 por
  clip), con las mismas curvas, evaluadas con `volume` en el render. Sirve para
  ducking manual o subidas/bajadas dentro de una toma.
- **Ritmo (beat sync)**: en un clip de audio, “Analizar ritmo” detecta los golpes
  en la máquina y muestra BPM, cantidad de pulsos y confianza. Con “Cortar video
  al ritmo” la pista de video superior se divide en esos frames; elegí 1, 2, 4 u 8
  pulsos por corte. El audio debe estar a 1×. Si el pulso es irregular, la app lo
  avisa en vez de inventar cortes.
- **Rampa de velocidad**: elegí **Desde** y **Hasta** y pulsá **Aplicar rampa**.
  Divide el clip en tres tramos contiguos que conservan la duración total y la
  ventana de origen. Es una aproximación de tres pasos; requiere quitar keyframes
  y Ken Burns del clip.
- **Curva de velocidad**: con las mismas velocidades **Desde/Hasta**, elegí 6, 8,
  12, 16, 20 o 24 tramos y pulsá **Curva suave**. El clip se reparte en tramos contiguos
  con perfil suave, conservando duración y ventana; los tramos intermedios
  absorben la diferencia y la app muestra las velocidades aplicadas.
- **Copiar, pegar y ripple**: con un clip seleccionado usá **Copiar** y **Pegar**
  (o Ctrl+C / Ctrl+V); el pegado cae en el primer hueco libre de la pista.
  **Ripple** o Shift+Supr borra el clip y cierra el hueco en esa pista.
- **Cerrar huecos**: seleccioná una pista y en **Inspector → Pista** pulsá
  **Cerrar huecos**. Compacta sus clips contra el anterior, conserva el inicio
  del primero y avisa cuántos movió y cuántos segundos recuperó.
- **Subir y bajar capas**: en **Inspector → Pista**, **Subir capa** y
  **Bajar capa** intercambian el orden con la pista vecina y cambian qué capa
  queda encima en la preview y el MP4.
- **Fades arrastrables**: seleccioná un clip visual o de audio y usá los dos
  círculos de las esquinas superiores. Arrastrá para ajustar el fade de entrada
  o salida; con el teclado, flecha arriba/abajo cambia 1 frame y Shift+flecha
  10. En video/imagen/freeze es el fade visual; en audio, el fade de audio.
- **Reverse**: activá **Reproducir al revés** para invertir video y audio en el
  render (`reverse`/`areverse`). La preview reproduce hacia adelante.
- **Disolvencia de entrada**: en un clip de video o imagen, elegí
  **Transición de entrada** → disolvencia, fundido a negro o deslizamiento
  horizontal, y los frames. Se superpone al clip anterior sin cambiar la duración
  de la timeline; el primer clip no la muestra.
- **Disolver cortes contiguos**: en **Inspector → Proyecto → Transiciones de
  corte**, un clic aplica una disolvencia de 12 frames a cada corte entre clips
  visuales pegados de las pistas desbloqueadas. No mueve clips ni cambia
  duraciones; los huecos y el primer clip quedan intactos.
- **Animación de entrada y salida**: en un clip visual, abrí **Animación**.
  Elegí una animación de entrada y otra de salida (fundido, deslizar a la
  izquierda/derecha/arriba/abajo), su duración en frames y un preset. Se
  reproducen dentro del clip: no cambian la duración ni mueven a los vecinos, y
  se suman a la transición, a Ken Burns y a los keyframes. El render las quema en
  el MP4 y la preview las muestra al mover el playhead. Zoom y giro aún no están
  disponibles como animación de clip.
- **Títulos**: escribí el texto en **Subtítulos → Agregar título**. Se crea una
  pista `Títulos` con estilo propio de 92 px centrado, separada de los subtítulos.
  Cada cue acepta animación de aparición (fade, pop o subir) y un **movimiento
  de dos keyframes** (aparecer, zoom, entrar desde izquierda/derecha o salir con
  zoom) que interpola posición, escala, rotación y opacidad en el MP4.
- **SRT/VTT**: en **Subtítulos**, usá **Exportar SRT** para copiar o descargar
  la pista principal, **Elegir archivo…** para abrir un `.srt`/`.vtt` local, o
  **Importar SRT/VTT** para pegar un archivo. La importación reemplaza solo la
  pista principal, conserva los títulos y convierte los tiempos al fps del
  proyecto.
- **Plantillas de título**: en el rail izquierdo, pestaña **Títulos**, escribí
  el texto y elegí una de las siete plantillas (Impacto, 3D, Caja, Minimal, Noticias,
  Cita, Ticker). Se agrega en el playhead en una pista `Títulos` con su propio
  estilo; después podés editarla, moverla o reutilizar el estilo.
- **Proxies**: seleccioná un video en Medios y pulsá **Crear proxy** en el
  Inspector. Se genera un MP4 liviano en `media/proxies`; la preview lo usa y el
  render final sigue tomando el original. Podés quitarlo sin borrar el archivo.
- **Estilos de texto**: en **Subtítulos**, el estilo activo acepta tamaño, color,
  contorno o caja con fondo, negrita, itálica, sombra, **Profundidad 3D** y
  presets **Creador / Caja / Minimal / Grande / 3D**. Los títulos usan una pista propia.
- **Igualar color**: en **Color → Igualar color**, elegí otra imagen o video del
  proyecto, ajustá la fuerza y pulsá **Igualar color**. Muestrea el frame del
  playhead y el primer frame de la referencia y aplica ganancias por canal.
- **Mezcla**: en **Transformación → Mezcla**, elegí multiplicar, trama,
  superponer, luz suave, oscurecer, aclarar, sobreexponer/subexponer color o luz
  fuerte. Rinde mejor con clips que llenan el cuadro; la preview usa
  `mix-blend-mode` y el MP4 `blend`.
- **Freeze frame**: en **Velocidad → Congelar frame**, el playhead se exporta a
  PNG y se importa a Medios. **Congelar en la pista** divide el video, inserta
  2 s fijos sobre la misma pista y corre clips, subtítulos y marcadores
  posteriores; después podés recortar el congelado como cualquier clip.
  **Como capa** monta el PNG encima sin mover nada. El clip congelado acepta
  color, máscara, blend, movimiento y animación de imagen.
- **Estabilización**: en **Video → Estabilización**, elegí el suavizado (1–60) y
  pulsá **Analizar y aplicar**. El análisis corre en tu máquina sobre la ventana
  de origen del clip y guarda un `.trf` en `media/stabilizers`; el MP4 aplica
  `vidstabtransform` antes del color y de las transformaciones. Si después
  recortás la ventana, cambiás la velocidad, ponés reverse o agregás una
  transición de entrada, la app avisa y el render se niega: reanalizá o quitá la
  estabilización. La preview no la simula.
- **Máscara**: en **Video → Máscara**, elegí rectángulo o elipse, centro, tamaño,
  rotación, feather e inversión. Capturá una máscara en un frame, mové el
  playhead, cambiá los valores y capturá otra para animarla; la preview
  interpola y dibuja la rotación con un SVG, y el MP4 aplica la máscara por
  píxel con `geq`.
- **LUT 3D con intensidad**: en **Color y efectos → LUT 3D**, cargá un `.cube`.
  Se copia a `media/luts` y se aplica en el MP4 con `lut3d`. El campo
  **Intensidad LUT (%)** mezcla el resultado con el original; 0 % equivale a no
  aplicar el LUT. La misma mezcla existe en el look global y en las capas de
  ajuste. La preview no simula el LUT; revisá el MP4.
- **Scopes**: en la preview pulsá **Scopes**. El panel muestra onda de
  luminancia, vectorscopio de croma e histograma RGB del clip visual activo,
  con el grade CSS de la preview. No incluye LUT, títulos, máscaras ni recortes,
  y no reemplaza la medición del MP4.
- **Efecto de voz**: grave, aguda, robot, eco, cueva o radio/teléfono. Se aplica
  en el render con filtros locales; la preview reproduce la voz original.
- **Subtítulos**: estilos, edición de tiempos y texto; la transcripción local
  agrega palabras con tiempos y el render las resalta. En el Inspector del
  subtítulo, **Revelar por palabra** muestra el texto a medida que cada palabra
  empieza, con la última resaltada; sin tiempos de palabra se muestra la línea
  completa.
- **Detección de escenas**: divide un video en varios clips en una acción.

- **Vista Efectos**: seleccioná varios clips visuales y aplicá un preset, un
  ajuste rápido de color/textura o una transición de entrada a todos a la vez.
  Los presets conservan fades y LUT; **Auditar** revisa rangos, LUT, filtros
  FFmpeg y transiciones antes del render. Los controles finos siguen en el
  Inspector del clip.

- **Frame real**: en la preview del editor, renderiza el clip activo con FFmpeg
  (color, máscara, relight, lente y LUT) para comparar con la aproximación CSS.
  No incluye otras pistas, subtítulos ni el look global.
- **1:1 nativo**: el botón `1:1` pide el frame a la resolución real del medio.
  Los videos sin rotación ni píxeles no cuadrados se decodifican con `video-rs`
  en proceso; el resto usa FFmpeg, que aplica autorrotación y SAR. El badge dice
  `video-rs nativo` o `FFmpeg nativo` y el HUD muestra las dimensiones reales.
  El frame conserva los efectos y la LUT, pero sigue sin componer otras pistas
  ni subtítulos. Tampoco es reproducción en tiempo real: se pide bajo demanda.

Atajos: `Ctrl+Z`/`Ctrl+Shift+Z`, `Ctrl+D` duplicar, `S` dividir, `Supr` eliminar,
`Espacio` reproducir, flechas ±1 frame (Shift ±10), `F11` pantalla completa.

## 9. Fábrica de variantes

En **Fábrica**:

1. Escribí un brief.
2. Elegí 1–10 variantes, escenas, idioma y formato.
3. Seleccioná imágenes listas del proyecto.
4. Elegí carpeta de salida y si querés renderizar un MP4 por variante.

Cada variante tiene guion propio, voz local, subtítulos, movimiento y transiciones.
Comparten `media/` y se escriben con un sufijo único para no sobrescribir nada.
La fábrica clásica usa las imágenes seleccionadas; el autopiloto también acepta
videos ya listos.

### Autopiloto IA

Dentro de Fábrica, el panel **Autopiloto IA** ejecuta el flujo completo con un
solo botón:

1. Guion con el proveedor configurado.
2. Voz local por escena.
3. Opcional: una imagen o un video **por escena** con el MCP de Google Flow,
   usando el prompt visual del guion.
4. Montaje automático con video o imagen por escena, subtítulos, Ken Burns y
   disolvencias.
5. Proyecto `.editoria.json` portable y MP4 verificado.

La cola queda en `localStorage` y sobrevive al reinicio. Si el render falla, el
proyecto escrito se conserva y aparece **Reanudar render** sin volver a gastar
créditos. La generación con Flow exige marcar la autorización de créditos para
ese trabajo; sin esa marca el autopiloto se detiene antes de llamar al MCP. Los
medios generados se importan con derechos confirmados y se asignan a su escena
por id, no por orden de archivo.

## 10. Exportar con el menor tamaño posible

En el editor, **Exportar video**:

- **Formato del proyecto**: exporta exactamente tu canvas, incluso si es un
  formato poco común.
- **YouTube/Shorts/Feed**: perfiles sociales fijos.
- **Compresión**:
  - **Rápido**: `ultrafast`, CRF 23, AAC 128 kbps. Termina antes; archivo más
    grande.
  - **Equilibrado**: `veryfast`, CRF 22, AAC 128 kbps.
  - **Compacto**: `faster`, CRF 27, AAC 96 kbps. El archivo más chico; tarda un
    poco más.
  - **Máxima calidad**: `medium`, CRF 18, AAC 192 kbps.
- **Códec**: H.264 es lo más compatible. H.265/HEVC genera archivos más chicos,
  pero algunos reproductores o plataformas lo recomprimen o lo rechazan.
- **Encuadre**: `Contener` muestra el canvas completo con barras; `Recortar para
  llenar` escala y recorta centrado para que un 16:9 llene un 9:16 o 1:1. No es
  smart reframe: no detecta caras ni sujeto.
- **Lote**: elegí una carpeta y renderizá todos los perfiles seleccionados en
  secuencia.

El render escribe a un temporal, lo verifica con FFprobe (archivo, tamaño,
duración y resolución) y recién entonces publica el MP4. Si falla, no pisa el
archivo anterior. El tamaño final depende del contenido, el movimiento y el
ruido; no hay una promesa de MB exactos.

## 11. Convertir medios

En **Convertir** elegí un asset listo, formato destino, calidad y ancho máximo.
Destinos: PNG, JPEG, WebP, MP4, WebM, MOV, GIF, MP3 y WAV. La salida se verifica
con FFprobe y nunca sobrescribe.

## 12. Descargar de la web

En **Descargar** pegá el enlace de un video, una foto, un audio o un carrusel
público. La app usa **yt-dlp**, que podés instalar desde la misma vista (se baja
el ejecutable oficial de GitHub y se verifica su SHA-256). Acepta `https://…`,
un dominio sin esquema (`youtube.com/…`, `youtu.be/…`) y texto compartido que
contenga un enlace. El formulario no bloquea el envío por validación nativa:
la URL se normaliza y después se valida en Rust.

**No necesitás un proyecto abierto para descargar.** Todas las descargas quedan
en `Descargas/Videos descargados/<Plataforma>/<Nombre del video>` (YouTube,
TikTok, Instagram, Facebook, X, Vimeo, Twitch, Pinterest, Reddit, Threads,
Snapchat u Otros). El nombre se recorta a 60 caracteres y se sanea para Windows;
así se evita el `OSError 22` de rutas demasiado largas o nombres inválidos. Sin
proyecto, el botón dice **Descargar a la biblioteca** y no importa a Medios; al
terminar podés abrir la carpeta con **Mostrar en carpeta**. Con un proyecto
abierto, el botón dice **Descargar e importar**: se guarda la copia en la
biblioteca y además se importa a Medios.

1. En **Guardar en** revisá la carpeta base y el disco. **Elegir carpeta…** abre
   el selector de Windows y **Usar predeterminada** vuelve a
   `Descargas/Videos descargados`. La elección se recuerda en el equipo y la app
   siempre agrega `<Red>/<Nombre del video>` dentro de esa carpeta.
2. **Analizar** consulta el sitio y muestra título, duración y las resoluciones
   reales disponibles, hasta 8K cuando la fuente las ofrece. En **Calidad**
   podés elegir **Mejor disponible**, **Mínima disponible** o una altura
   concreta. No se inventan resoluciones: si la fuente no tiene 8K, no hay 8K.
3. Elegí la calidad. En carruseles se bajan hasta 12 elementos con la mejor
   calidad de cada uno.
4. Elegí **Original** o una compresión H.265/H.264 (CRF 20, 24 o 27). La
   recompresión es local, tarda, convierte HDR/10-bit a SDR 8-bit y sólo conserva
   el archivo nuevo si queda más chico.
5. Confirmá que tenés derechos y descargá. Siempre queda una copia en
   la carpeta elegida como `<Red>/<Nombre del video>`; con un proyecto abierto
   además se importa a Medios con la licencia pendiente de confirmar.

Si el sitio pide sesión, exportá un `cookies.txt` en formato Netscape y elegilo
en la vista; se usa sólo en memoria y no se guarda en el proyecto. DRM, captchas,
transmisiones en vivo o paywalls pueden fallar y la app no los evade. Descargá
sólo contenido propio o con permiso; las plataformas pueden limitar la descarga
en sus términos.

### Extensión de Chrome y Edge

La carpeta `extensions/editor-ia-downloader` es una extensión MV3. En **Inicio**
pulsá **Instalar extensión**: Editor IA copia la extensión a una carpeta estable
y la abre. Después, en `chrome://extensions` activá **Modo desarrollador**, elegí
**Cargar descomprimida** y seleccioná esa carpeta. Copiá la conexión (puerto +
token) desde Inicio o desde Descargar y pegala una vez en la extensión. El paso
final lo confirma el navegador: no existen instalaciones silenciosas de
extensiones descomprimidas.

Con la extensión abierta en una página podés elegir una foto detectada o usar la
página completa, analizar las resoluciones reales y descargar en MP4, MKV, WebM,
MP3 o M4A con compresión opcional. El archivo se guarda en
`Descargas/Videos descargados/<Plataforma>/<Nombre del video>`.
La extensión no descarga sola: necesita la app abierta y sólo habla con
`127.0.0.1`; no envía nada a internet.

## 13. Servidores MCP

En **MCP**:

1. Agregar servidor.
2. Comando, argumentos (uno por línea), variables `KEY=valor` y carpeta de trabajo
   opcional.
3. Guardar. Nada se ejecuta todavía.
4. **Probar** hace `initialize` + `tools/list` y muestra las herramientas.
5. Elegí una herramienta, completá el JSON y pulsá **Ejecutar herramienta**.

Los nombres de variables quedan en la configuración; los valores, en el
Administrador de credenciales de Windows. El proceso MCP es código de terceros:
hereda tus permisos y no está sandboxeado.

### Google Flow MCP

Si el servidor **Google Flow** está configurado, la vista MCP muestra un panel
para generar fotos o videos con tu propia cuenta. La primera vez hay que iniciar
sesión manualmente en el Chrome dedicado (CDP 9333). Marcá la autorización de
créditos, generá y después confirmá derechos para importar a Medios o montar en
la timeline. El **Autopiloto IA** de Fábrica usa el mismo servidor para generar
un medio por escena. La guía completa está en
[`docs/integrations/GOOGLE-FLOW-MCP.md`](integrations/GOOGLE-FLOW-MCP.md).

## 14. Cumplimiento por red

En **Cumplimiento** elegí YouTube, Shorts, TikTok, Reels, Facebook, X, Twitch o
LinkedIn. La vista audita el proyecto abierto contra ese paquete de reglas y
muestra:

- **Bloqueos y avisos**: derechos sin confirmar, duración, orientación, altura
  mínima, peso, subtítulos, música y divulgación de contenido con IA.
- **Monetización y riesgos de strike**: requisitos y prácticas que suelen
  limitar anuncios o generar sanciones.
- **Fuentes oficiales**: enlaces a las políticas de cada plataforma.

Los paquetes vienen incluidos en la app y se intentan actualizar una vez por día
desde el JSON remoto del repositorio; si no hay red o el documento no valida, se
usan los incluidos. También podés forzar la comprobación con el icono de
actualizar. Esto es una **ayuda de preflight**: las plataformas cambian sus
reglas y deciden cada caso. No garantiza monetización ni ausencia de strikes;
leé siempre la política oficial enlazada.

## 15. Apariencia, perfil y ayuda

- **Ajustes** tiene una barra lateral de secciones (Apariencia, Inteligencia
  artificial, Voz y audio, Herramientas, Datos locales y Alcance). Cada sección
  explica qué controla y el panel queda visible mientras desplazás el contenido.
- **Ajustes → Apariencia**: temas, colores, fuentes, escala, densidad, rail,
  radios, timeline, barra de estado y reducción de animaciones.
- **Perfil (abajo a la izquierda)**: foto, nombre y rol. La foto se recorta a
  256 px y se guarda en este equipo.
- **Iconos**: las barras de herramientas usan iconos con texto accesible y
  tooltip; los formularios y las reglas conservan etiquetas escritas para no
  perder claridad.
- **Aprender**: la guía registra en este equipo las vistas que usás y marca solas
  las secciones correspondientes; no muestra ni envía ese registro. El panda
  Pando te recibe, señala el siguiente paso y cambia sus consejos.
- **Ayuda**: atajos, documentación y “Acerca de”.

## 16. Problemas frecuentes

- **“Falta FFmpeg/FFprobe”**: elegí los ejecutables en Ajustes → Herramientas.
- **“El material no tiene derechos”**: importá de nuevo y confirmá licencia.
- **El render falla al verificar tamaño**: el perfil tiene un piso mínimo; en
  variantes cortas se usa 50 KB. Revisá que el timeline no esté vacío.
- **No cambia los fps**: algún clip tiene velocidad distinta de 1×.
- **Los subtítulos no aparecen**: revisá que “Quemar subtítulos” esté activo y
  que existan cues dentro del rango.
- **Un MCP no responde**: revisá comando/argumentos y que el paquete esté
  instalado; la app corta a los 12/20/45 s.
- **El archivo pesa mucho**: usá Compacto, bajá la resolución o elegí H.265.
- **La preview no coincide exactamente**: es aproximada por diseño; el MP4 es la
  fuente de verdad.

## 17. Reducir ruido con Denoise

- En **Denoise** elegí un **video** o una **imagen**. La app acepta el archivo
  por contenido (FFmpeg decide si lo puede leer), no por extensión.
- Movés **Fuerza** y ves el resultado en el canvas en tiempo real. El preview es
  un filtro bilateral aproximado sobre el frame actual; **Ver original** compara
  sin procesar. **Temporal** reduce parpadeo y **Preservar detalle** baja la
  agresividad.
- Preajustes: **Rápido** (`hqdn3d`), **Equilibrado** (`hqdn3d` + temporal) y
  **Máxima calidad** (`nlmeans`, más lento).
- **Aplicar y guardar** pide una carpeta, muestra el progreso real de FFmpeg y
  entrega el archivo con peso, duración y filtro aplicado. En imágenes podés
  abrir **Comparar antes y después**; en videos, **Mostrar en carpeta**.
- **Voz clara (DSP)** es una tarjeta aparte para audio: elegí un WAV/MP3/M4A o
  el audio de un video, una cadena (**Diálogo completo**, **Voz clara**,
  **Podcast** o **Suave**) y una carpeta. Usa la cadena DSP de FilmCraft
  (denoise espectral, de-hum, de-esser, de-reverb, EQ, compresor, realce y
  limitador) y guarda un WAV PCM 24 bits de hasta 180 s. No es IA ni separa
  voces superpuestas.
- Límites: el preview no es el render final; 4K/8K va a la cola y `nlmeans` puede
  tardar minutos. No se promete denoise neural 4K en tiempo real en esta máquina.
  La primera versión procesa un archivo por vez.

## 18. Crear miniaturas

- En **Miniaturas** elegí una foto de fondo (JPG, PNG, WebP o cualquier formato
  que FFmpeg lea) y un formato: **Horizontal 1280×720**, **Vertical 1080×1920**
  o **Cuadrado 1080×1080**.
- Probá las cuatro plantillas —**Banda inferior**, **Split**, **Minimal** y
  **Gradiente**— y editá **Título**, **Subtítulo**, **Badge**, **Acento** y
  **Oscurecer**. El canvas de la derecha es el mismo que se exporta, con guías de
  zona segura; el texto se envuelve y se corta con elipsis si no entra.
- **Exportar PNG** pide una carpeta la primera vez y entrega un PNG validado y
  re-encodeado en este equipo, con nombre único (`titulo-1280x720.png` y sufijos
  `-2`, `-3` si ya existe). No se sube la foto a ningún servicio.
- **Mejor frame de un video**: elegí un video y la app muestrea 12 puntos,
  puntúa nitidez/contraste/exposición y muestra los tres mejores PNG (con su
  puntaje y segundo). Al hacer clic, el frame reemplaza el fondo. El análisis
  corre localmente; no detecta rostros.
- Límites: no hay recorte manual del fondo, detección de rostro ni variantes A/B
  automáticas.

## 19. Traducir subtítulos con Localización

- En **Localización** elegí un archivo **SRT, VTT, ASS o SSA** en UTF-8. La app
  muestra cuántos subtítulos detectó y avisa si algún bloque no tiene tiempos.
- Marcá uno o varios de los **ocho idiomas** de destino, elegí **SRT** o **VTT**
  y, si hace falta, escribí un **glosario** con marcas o nombres que no se deben
  traducir (separalos con comas).
- La traducción usa el proveedor de **Ajustes → Inteligencia artificial**. Si es
  remoto, autorizá el consumo de cuota; si está en `localhost` (Ollama, LM Studio)
  no hace falta. El texto de los subtítulos es lo único que se envía.
- Presioná **Traducir**. El archivo se divide en lotes para no truncarse; podés
  seguir el progreso. Revisá la pestaña de cada idioma antes de exportar: la app
  conserva los tiempos, pero no corrige nombres ni modismos automáticamente.
- **Exportar** pide una carpeta y escribe `<nombre>.<idioma>.srt|vtt` sin
  sobrescribir. El proveedor **simulado** no traduce: marca el resultado y
  bloquea la exportación para no hacer pasar el original por traducción.
- La tarjeta **Doblaje local** ya está en esta vista: elegí un video, un idioma
  traducido y una voz SAPI; opcionalmente conservá una cama con el audio
  original. La app sintetiza cada cue, ajusta la duración y reemplaza el audio.
  Depende de que Windows tenga una voz instalada para ese idioma (en esta
  máquina hay español `es-MX` e inglés `en-US`). La detección del idioma de
  origen es una sugerencia al modelo, no un detector local.

### Clonación de voz local

El comando `clone_voice` conecta un motor local de clonación por HTTP. No incluye
un modelo neuronal: necesitás tener corriendo **XTTS API Server** o
**GPT-SoVITS** en tu equipo. La app sólo acepta `localhost`, `127.0.0.1` o `::1`;
rechaza cualquier host remoto para que la muestra no salga de la máquina.

- La referencia debe durar entre 3 y 30 segundos y pesar menos de 20 MB.
- El texto admite hasta 2 000 caracteres y 16 idiomas; la respuesta debe ser un
  WAV real, que se mide con FFprobe y se guarda en `media/`.
- Si el motor no está encendido, el error dice que no se pudo conectar; no cae a
  una voz SAPI ni inventa un clon.
- La vista **Localización** ya tiene la tarjeta **Clonación de voz local**:
  elegí motor, URL loopback, audio de referencia, idioma, clave opcional y el
  texto; podés copiar el texto que tradujiste. La QA se hizo con un servicio
  simulado, no con XTTS/GPT-SoVITS reales.
- No hay clonación zero-shot incluida ni entrenamiento de voz. No se envía nada
  a la nube. La calidad depende del motor y de la muestra.

### Sincronización labial local

La tarjeta **Sincronización labial** conecta un motor local que acepte el
contrato `{ video_path, audio_path, output_format }` y devuelva un MP4. Elegí un
video y un audio del proyecto, el motor (Wav2Lip, MuseTalk, SadTalker o uno
propio), el endpoint en `localhost`/`127.0.0.1` y, si hace falta, una clave.

- La app valida que ambos archivos estén en el proyecto, que el audio dure entre
  0,1 y 900 s, que la respuesta sea MP4 de hasta 200 MB y que FFprobe lea
  dimensiones y duración antes de publicarla.
- **Motor real incluido como adaptador**: en este equipo está instalado Wav2Lip
  y el adaptador `scripts/lipsync-engine/server.py`. Arrancalo antes de
  sincronizar con **`npm run lipsync:engine`** o abrí
  `scripts/lipsync-engine/start.cmd`; queda escuchando en
  `http://127.0.0.1:8765/lipsync`, que es el endpoint por defecto de la tarjeta.
  `GET /health` confirma que el motor y el checkpoint están presentes.
- El adaptador acepta hasta **45 s de audio** y reescala a **1280 px** como
  máximo; el video se recorta a la duración del audio y procesa un solo trabajo
  a la vez. La app espera hasta 30 minutos. Hace falta un
  rostro visible en todos los frames y la salida dura lo que el audio.
- **Licencia importante**: Wav2Lip es sólo para uso personal o de investigación,
  **no comercial**. No lo empaquetes en una app paga sin licencia. MuseTalk
  (MIT) es una alternativa, pero no está instalada ni verificada en esta
  máquina. El adaptador verifica el SHA-256 del checkpoint, no descarga
  pesos ni manda medios a internet.
- No extrae el audio del doblaje automáticamente: elegí un audio del proyecto o
  importalo.

## 20. Armar prompts con AI Hub

- **AI Hub** no es un chat: es una biblioteca de **skills** para pedirle a un
  modelo algo concreto sin gastar contexto de más. Elegí una tarjeta (gancho,
  short, retención, reescritura segura, títulos/miniatura, contexto de
  traducción, metadatos, B-roll o voz).
- Escribí el **brief** con qué video querés, para quién y qué material tenés.
  La vista arma un pedido con `SKILL`, `CONTEXTO` y un contrato de `SALIDA`, y
  muestra el presupuesto en caracteres y una estimación de tokens.
- **Copiar prompt** lo deja en el portapapeles para usarlo en el modelo que
  prefieras. **Usar brief en Guion** lo envía a la vista Guion, que lo carga una
  sola vez; las demás vistas sólo se abren para que sigas ahí.
- Límites: la estimación de tokens es aproximada (4 caracteres por token), no
  incluye precios y no conoce el contenido del proyecto. No ejecuta el prompt ni
  elige un modelo por vos.

## 21. Límites honestos

Los keyframes cubren escala, desplazamiento, rotación, opacidad y ganancia, con
curvas de easing. La rampa de velocidad es de **tres tramos**, no una curva
continua. Las máscaras son rectángulo, elipse, diamante, triángulo y rectángulo redondeado, con rotación y keyframes de forma. El freeze
frame se agrega dentro del clip **y** como capa de 2 s. Hay proxies para
la preview, pero no multicam ni timelines anidados. La estabilización es vidstab
local sobre la ventana del clip: exige 1×, sin reverse ni transición de entrada,
y la preview no la muestra. El LUT tiene intensidad, pero no hay LUTs por marca
con protección de piel ni motion tracking. **Relight por rostro** existe como
máscara radial local (detecta el rostro, ajusta fuerza/calidez/radio y se aplica
sólo en el MP4; no es un modelo generativo). Smart reframe usa SeetaFace local,
se puede previsualizar el track de rostro y cae al centro si no encuentra una
cara. Tampoco hay matting por IA. Los scopes muestrean el clip activo con
el grade CSS de la preview; no reflejan LUT, títulos, máscaras, recortes ni el
compuesto final. Las transiciones son disolvencia, fundido a negro/blanco y
deslizamientos laterales/verticales, sin crossfade solapado ni wipes de máscara.
La vista **Efectos** ya está conectada a `list_visual_catalog` y `audit_visuals`;
el renderer limita el solape de una transición a 2 s aunque el esquema admita
más frames. No hay biblioteca de música/SFX/B-roll con licencia ni descarga de stock.
La publicación en redes y la programación no están incluidas: solo se genera el
manifiesto y los metadatos sugeridos. Las miniaturas son composiciones de cuatro
plantillas, no un editor por capas ni un generador automático de variantes. La
localización traduce subtítulos; la tarjeta de doblaje SAPI ya mezcla una pista
de voz y reemplaza el audio, pero depende de las voces instaladas en Windows. La
clonación local es un puente a un motor externo XTTS/GPT-SoVITS: no incluye
modelo y no entrena voces. El lip-sync usa Wav2Lip real por un adaptador local
(no comercial); MuseTalk no está verificado. AI Hub compone
prompts locales; no es un agente que ejecute herramientas ni conoce el proyecto.
Auto Shorts puntúa candidatos con reglas locales y exporta 9:16 con recorte
central o smart reframe facial frontal; no identifica personas, puede fallar en
perfiles, no elige el mejor frame ni garantiza retención. Las reglas de Cumplimiento son un
preflight editable por el repositorio, no una copia certificada de cada política
ni una garantía de monetización o de ausencia de strikes. El registro de
Aprender y la memoria del Director son locales y no se muestran ni se envían.
Flow requiere una sesión manual de Google y créditos; el puente se probó con
dobles, no con una generación real en esta máquina. El instalador no está
firmado. MCP es local, por stdio, y el Director todavía no llama herramientas
MCP.

REA 6.4.0 analizó el PE de CapCut 9.4 y extrajo **184 tipos de keyframe** y **52
flags** de funciones. El inventario completo, con rutas, hashes y límites, está
en
[`docs/reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md`](reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md).
