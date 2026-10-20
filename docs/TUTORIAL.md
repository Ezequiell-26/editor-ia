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

## 2. Crear un proyecto con cualquier formato y fps

1. Abrí **Proyectos**.
2. Escribí un nombre.
3. Elegí **Formato**:
   - 16:9 (1920×1080), 9:16 (1080×1920), 1:1 (1080×1080), 4:5, 4:3, 21:9.
   - **Personalizado…** para cualquier ancho/alto entre 16 y 16 384 px.
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
4. Usá la búsqueda y el filtro por tipo. Los medios montados muestran un punto
   “en timeline”.

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

## 8. Edición manual

En **Editor**, el layout sigue el flujo de un editor profesional: **medios a la
izquierda, Inspector al centro, preview a la derecha y timeline abajo**. El
Inspector del clip se organiza en pestañas **Video, Audio, Velocidad, Color,
Estilo y Todo** (solo aparecen las que aplican al tipo de clip). La pestaña
**Todo** muestra el inspector completo de una vez.

- **Timeline**: varias pistas, arrastrar, recortar, dividir, mover entre pistas,
  zoom, playhead y ripple. Con **clic derecho en un clip** abrís acciones rápidas:
  dividir, duplicar, copiar/pegar, ir al inicio, eliminar o eliminar cerrando el
  hueco; el menú se maneja con flechas, Home, End y Escape.
- **Velocidad**: 0,1×–4× uniforme por clip.
- **Color y efectos**: brillo, contraste, saturación, temperatura, rotación de
  tono, curvas por preset, **ruedas RGB de sombras/medios/luces**, **HSL selectivo
  por rangos de color**, viñeta, nitidez, desenfoque, blanco y negro, sepia y
  fades. Los **Looks rápidos** (Cálido, Frío, Cine, Vintage, B/N) aplican un
  punto de partida.
- **Look del proyecto**: elegí un preset o ajustá el grade global en Proyecto →
  Look del proyecto. Se aplica al compuesto final antes de subtítulos y títulos,
  no toca los clips y se guarda con el proyecto; «Quitar look» lo limpia.
- **Movimiento**: zoom in/out y paneos Ken Burns con intensidad.
- **Audio por clip**: high/low-pass, EQ de tres bandas, compresor, de-esser,
  puerta de ruido, `afftdn`, ganancia, fades y presets Voz clara/Música.
- **Audio del proyecto**: ganancia master, limitador, loudness -14/-23 LUFS y
  ducking de música por sidechain.
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
  12 o 16 tramos y pulsá **Curva suave**. El clip se reparte en tramos contiguos
  con perfil suave, conservando duración y ventana; los tramos intermedios
  absorben la diferencia y la app muestra las velocidades aplicadas.
- **Copiar, pegar y ripple**: con un clip seleccionado usá **Copiar** y **Pegar**
  (o Ctrl+C / Ctrl+V); el pegado cae en el primer hueco libre de la pista.
  **Ripple** o Shift+Supr borra el clip y cierra el hueco en esa pista.
- **Reverse**: activá **Reproducir al revés** para invertir video y audio en el
  render (`reverse`/`areverse`). La preview reproduce hacia adelante.
- **Disolvencia de entrada**: en un clip de video o imagen, elegí
  **Transición de entrada** → disolvencia, fundido a negro o deslizamiento
  horizontal, y los frames. Se superpone al clip anterior sin cambiar la duración
  de la timeline; el primer clip no la muestra.
- **Animación de entrada y salida**: en un clip visual, abrí **Animación**.
  Elegí una animación de entrada y otra de salida (fundido, deslizar a la
  izquierda/derecha/arriba/abajo), su duración en frames y un preset. Se
  reproducen dentro del clip: no cambian la duración ni mueven a los vecinos, y
  se suman a la transición, a Ken Burns y a los keyframes. El render las quema en
  el MP4 y la preview las muestra al mover el playhead. Zoom y giro aún no están
  disponibles como animación de clip.
- **Títulos**: escribí el texto en **Subtítulos → Agregar título**. Se crea una
  pista `Títulos` con estilo propio de 92 px centrado, separada de los subtítulos.
  Cada cue acepta animación de aparición: fade, pop o subir.
- **SRT/VTT**: en **Subtítulos**, usá **Exportar SRT** para copiar o descargar
  la pista principal, o **Importar SRT/VTT** para pegar un archivo. La
  importación reemplaza solo la pista principal, conserva los títulos y convierte
  los tiempos al fps del proyecto.
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
  PNG, se importa a Medios y se monta como capa de 2 s sobre el video. Ajustá su
  duración o posición como cualquier clip.
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
- **LUT 3D**: en **Color y efectos → LUT 3D**, cargá un `.cube`. Se copia a
  `media/luts` y se aplica en el MP4 con `lut3d`; la preview no lo simula.
- **Efecto de voz**: grave, aguda, robot, eco, cueva o radio/teléfono. Se aplica
  en el render con filtros locales; la preview reproduce la voz original.
- **Subtítulos**: estilos, edición de tiempos y texto; la transcripción local
  agrega palabras con tiempos y el render las resalta.
- **Detección de escenas**: divide un video en varios clips en una acción.

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

## 12. Servidores MCP

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

## 13. Apariencia, perfil y ayuda

- **Ajustes → Apariencia**: temas, colores, fuentes, escala, densidad, rail,
  radios, timeline, barra de estado y reducción de animaciones.
- **Perfil (abajo a la izquierda)**: foto, nombre y rol. La foto se recorta a
  256 px y se guarda en este equipo.
- **Aprender**: guía completa con progreso.
- **Ayuda**: atajos, documentación y “Acerca de”.

## 14. Problemas frecuentes

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

## 15. Límites honestos

Los keyframes cubren escala, desplazamiento, rotación, opacidad y ganancia, con
curvas de easing. La rampa de velocidad es de **tres tramos**, no una curva
continua. Las máscaras son rectángulo/elipse con rotación y keyframes de forma. El freeze
frame se agrega como capa de 2 s, no dentro del clip original. Hay proxies para
la preview, pero no multicam ni timelines anidados. La estabilización es vidstab
local sobre la ventana del clip: exige 1×, sin reverse ni transición de entrada,
y la preview no la muestra. No hay LUTs por marca con
intensidad, smart relight, motion tracking, smart reframe ni matting por IA. Las
transiciones son disolvencia, fundido a negro y deslizamiento, sin catálogo de
wipes. No hay biblioteca de música/SFX/B-roll con licencia ni descarga de stock.
La publicación en redes y la programación no están incluidas: solo se genera el
manifiesto y los metadatos sugeridos. Flow requiere una sesión manual de Google
y créditos; el puente se probó con dobles, no con una generación real en esta
máquina. El instalador no está firmado. MCP es local, por stdio, y el Director
todavía no llama herramientas MCP.

REA 6.4.0 analizó el PE de CapCut 9.4 y extrajo **184 tipos de keyframe** y **52
flags** de funciones. El inventario completo, con rutas, hashes y límites, está
en
[`docs/reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md`](reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md).
