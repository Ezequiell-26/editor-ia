# Editor IA vs. CapCut, Filmora y DaVinci Resolve — auditoría y hoja de ruta

**Fecha:** 2026-10-19  
**Objetivo:** inventariar las funciones de edición de las tres suites y decidir qué
primitivas conviene incorporar a Editor IA, sin copiar código ni assets
propietarios.

> Esta auditoría usa REA sobre artefactos instalados para **observar** superficie
> de producto (recursos, cadenas, configuración y estructura). No decompila ni
> redistribuye código propietario, y no afirma que una función observada en los
> archivos esté disponible en la edición o licencia del usuario.

## Evidencia disponible

| Suite | Estado local | Evidencia | Límite |
| --- | --- | --- | --- |
| **CapCut** | Instalado, **9.4.0.4015** en `D:\Users\ofici\_Migrado_de_C\AppData\Local\CapCut\Apps\9.4.0.4015` | REA `inspect_pe_resources` sobre `CapCut.exe` (`ev_fb93…`), `CapCut.exe` abierto con Ghidra, inventario de `Resources/`, análisis estático de `lynx_core.js` (`ev_f02b…`) | La app es híbrida Qt/CEF; no se recorrió toda la UI ni se ejecutó su código. |
| **Filmora** | **No instalado**: `C:\Program Files\Wondershare` está vacío | Documentación pública de Wondershare Filmora | No hay evidencia binaria local; no se presenta como reverse engineering. |
| **DaVinci Resolve** | Instalado, **21.1.1.10**, `D:\Resolve.exe` (581 MB) | REA `inspect_pe_resources` sobre `BMDDavUI.dll` (`ev_47f9…`), cadenas de UI de `BMDDavUI.dll`/`DaVinciPanels.dll` y `Resolve.exe` | `Resolve.exe` completo no se cargó en un desensamblador; se muestrearon recursos y cadenas. |

### Evidencia concreta de CapCut

`Resources/` contiene, entre otras, carpetas que declaran funciones:

- **Color:** `DefaultAdjustBundle` con `brightness`, `contrast`, `saturation`,
  `temperature`, `highlight`, `shadow`, `tone`, `hsl`, `curves`, `sharpen`,
  `vignetting`, `black_white`, `clear`, `color_match_select_target`.
- **Color avanzado:** `PrimaryWheel`, `LogWheel`, `Curves`, `lut`.
- **Composición:** `MixMode` (materiales de blend), `mattingBlend`,
  `mattingBlendV2`, `Chroma`, `Chroma2`, `rule_adjust_mask`.
- **IA/segmentación:** `matting_config` con `tt_matting_video`,
  `tt_matting_video_gru`, `saliency_matting`, `video_saliency_seg_bce`.
- **Análisis:** `SceneEditDetection` con `compress_shot_detect` y umbral 0.35;
  `lvop_intelligent_crop` (reframe inteligente); `objectRect`.
- **Audio:** `rnnoise` (modelo local de reducción de ruido), `audio_metrics`,
  `tts`.
- **Texto/plantillas:** `aigc_text_template`, `image_h5_text_template_publish`,
  `template_sticker`, `Font`.
- **Otros:** `VideoWaterMark`, `watermark`, `digital_human`, `figure`,
  `builtin_skills`, `image_h5_smart_edit_chat_bot`, `models`.

### Evidencia concreta de DaVinci Resolve

- Cadenas de UI observadas: **Fairlight**, **HSL Qualifier**, **3D Qualifier**,
  **keyframes**, **LUT**, **transition**, `SetTrackingSensitivity`, además de
  shaders de color con shaper LUTs 1D/3D y qualifiers.
- Resolve se organiza por páginas: **Media, Cut, Edit, Fusion, Color, Fairlight,
  Deliver**. La existencia de las páginas y del motor Fairlight está corroborada
  por las cadenas y por la instalación local; el detalle completo de cada página
  se toma de la documentación pública, no de una decompilación total.

### Filmora (documentación pública)

Filmora declara edición multipista, **keyframes y speed ramping**, motion
tracking, green screen, **masking y blend modes**, color grading, limpieza de
audio, herramientas IA, track matte y auto color. Fuentes:

- [Filmora — editor de video](https://filmora.wondershare.com/)
- [Keyframe Magic / speed ramping](https://filmora.wondershare.com/creative-garage/keyframe-magic.html)
- [Novedades de Filmora](https://filmora.wondershare.com/whats-new-in-filmora-video-editor-mac.html)
- [Review de Filmora 16 (2026)](https://magiclight.ai/academy/filmora-review/)

### Evidencia de la segunda tanda (movimiento y transiciones)

- **CapCut**: `search_strings` con regex `ken.?burns|pan.?and.?zoom|photo.?motion|auto.?edit|auto.?cut|beat.?sync|smart.?reframe` sobre `CapCut.exe` (sha256 `eeb04ca7…`) devolvió **cero coincidencias en strings definidos por Ghidra**. Es un resultado acotado: la app está empaquetada y los literales pueden no estar definidos como strings; no prueba que la función no exista.
- **DaVinci**: dos búsquedas de cadenas sobre `BMDDavUI.dll` (sha256 `86a2f627…`) no completaron (`MCP -32603`). Se reutiliza la evidencia de recursos/cadenas de la primera pasada (keyframes, LUT, transiciones) y no se atribuye a Resolve ninguna función de Ken Burns observada en esta corrida.
- **Filmora**: la documentación pública ya citada describe keyframes y speed ramping, que habilitan animaciones de escala/posición; se usa como referencia de producto, no como reverse engineering.
- **FFmpeg 9.0.1**: se ejecutaron las expresiones exactas de `zoompan` (`z`, `x`, `y`) sobre `editor-ia-demo-assets/media/card.png`: zoom-in, zoom-out y pan-right terminaron con exit 0. Un `crop` con `w/h` dependientes de `t` falló al configurar el filtro; por eso el zoom se implementó con `zoompan`, no con `crop` animado.
- El test Rust `photo_motion_reaches_the_filter_chain` verifica que el grafo contiene `zoompan` y las expresiones; el render live de 2 s con movimiento y fades se ejecuta con `EDITOR_IA_RUN_RENDER_TESTS=1`.

### Evidencia de la tercera tanda (audio y publicación)

- **ElevenLabs**: se descargó el contrato OpenAPI oficial
  `https://api.elevenlabs.io/openapi.json` (2.313.394 bytes) el 2026-10-19. El
  contrato declara `POST /v1/text-to-speech/{voice_id}` con encabezado
  `xi-api-key`, cuerpo JSON con `text` obligatorio y `model_id` (default
  `eleven_multilingual_v2`), y `GET /v1/voices` para listar voces. La
  implementación usa esos endpoints fijos, no una URL configurable.
- **Sin clave real no se ejecutó una síntesis de ElevenLabs**: se probaron
  validación, parseo de la lista de voces y manejo de errores; la llamada de red
  queda como no verificada hasta que el usuario guarde su clave.
- **Web externa**: sólo se abre una URL HTTPS con `tauri-plugin-opener`. No hay
  login, captcha, scraping ni descarga automática; el audio se importa a mano.
- **Publicación**: `buildPublicationManifest` y `auditPublication` están cubiertos
  por tests; el comando Rust valida tamaño, claves prohibidas y que el manifiesto
  no sobrescriba el proyecto ni un medio.
- **E2E real del manifiesto**: la app release escribió
  `editor-ia-demo-assets/publicacion.json` (**10.135 bytes**) para “Demo
  completa”: 10 assets, 6 generados por IA, 8 subtítulos, 2 grupos duplicados y
  puntaje **80/100**. La tarjeta de publicación y el panel de audio se capturaron
  en `editor-ia-shots/app-publication-2026-10-19.png` y
  `app-settings-audio-2026-10-19.png`.
- **E2E real del lote**: una carpeta elegida, dos perfiles renderizados en
  secuencia y verificados con FFprobe: 1920×1080 (928.611 bytes) y 1080×1920
  (937.279 bytes), ambos 34,03 s. Captura en
  `editor-ia-shots/app-batch-export-2026-10-19.png`.
- **Render live con audio/chroma**: el test ignorado por defecto incluye
  high/low-pass, EQ de 3 bandas, compresor, `afftdn`, `loudnorm` -14 LUFS y
  `chromakey`; FFmpeg 9.0.1 completó y FFprobe verificó 320×180 y 2 s.

## Addendum verificado al 2026-10-20 (pases 17–19)

Esta lista prevalece sobre las filas de la matriz que quedaron desactualizadas.
Se apoya en la suite completa de tests (564 Vitest; 125 Rust + 3 ignorados),
typecheck, build de Vite, un render FFmpeg en vivo, descargas reales con yt-dlp y
una extensión MV3 cargada en Chrome for Testing 153.

**Agregado y verificado**

- **Look global del proyecto** (`look` en la raíz del `.editoria.json`): presets,
  brillo, contraste, saturación, temperatura, tono, curvas, viñeta, nitidez,
  desenfoque, B/N, sepia y **LUT `.cube` global**; preview sobre el compuesto y
  render antes de ASS. Los LUT por clip ya existían.
- **Menú contextual de timeline** accesible con teclado: dividir, duplicar,
  copiar/pegar, ir al inicio, eliminar y ripple delete.
- **Descargador social** con yt-dlp instalable desde la app y checksum SHA-256:
  videos, audio, fotos y carruseles de hasta 12 elementos, calidades reales hasta
  8K, elección de resolución y recompresión FFmpeg H.265/H.264 con CRF 20/24/27,
  conservando el resultado sólo si es más chico. Importa a Medios y exige
  confirmar derechos. Acepta un `cookies.txt` opcional para sesiones ya
  iniciadas; no evita DRM, captchas ni paywalls.
- **Capas de ajuste por tramo** (`kind: adjustment`): pista propia, botón en la
  timeline, pestaña Ajuste y render sobre el compuesto con
  `enable='between(t,start,end)'`. Detalle, evidencia REA y límites en el
  addendum de capas de ajuste al final de este documento.
- **Extensión de navegador y puente local**: MV3 en
  `extensions/editor-ia-downloader`; puente HTTP sólo en 127.0.0.1 con token,
  probe, jobs, video MP4/MKV/WebM, audio MP3/M4A, imágenes directas y guardado en
  `Descargas/Videos descargados/<Plataforma>/<Nombre del video>`. Verificada cargada en Chrome 153 con descargas de video e
  imagen desde la UI. La app debe estar abierta.
- **Proyectos y shell minimalistas**: sin encabezado explicativo, URL rápida de
  descarga, rail de 48 px y vistas pesadas con carga diferida (JS inicial 455,75
  kB, antes 806,72 kB). Las demás herramientas usan la barra compacta
  `ViewToolbar` (estado, conteo y acciones) en lugar de título/eyebrow/párrafo;
  se siguieron patrones de shadcn/ui y Radix UI (MIT), sin copiar código.
- **Diseño plano**: una capa final (`flat.css`) quita gradientes, glows, blur,
  sombras y animaciones ornamentales; unifica etiquetas en caja baja, tarjetas,
  timeline y clips planos, métricas como filas y foco visible por outline. Los
  colores de estado y el contenido multimedia del proyecto se mantienen.
- **Timeline arrastrable**: el carril del ruler tenía ancho cero y no respondía;
  ahora tiene ancho explícito, el cabezal es un handle arrastrable con rol
  `slider` (flechas/Inicio/Fin), y 4 tests verifican ancho, arrastre continuo,
  handle y teclado.
- **Texto 3D** por extrusión de sombras ASS, con color de profundidad y preview.
- **Importación/exportación SRT/VTT** por pegado y descarga; subtítulos
  automáticos y animaciones de subtítulo.
- **Máscaras** rectangulares/elípticas con rotación, feather, inversión y
  keyframes interpolados en preview y render.
- **Transiciones** dissolve/fade/slide, animaciones de entrada/salida, Ken Burns,
  rampas y curvas de velocidad, freeze, estabilización, chroma key y suite de
  audio/loudness.

**Sigue faltando para paridad completa**

- LUT skin (el `.cube` está por clip y en el look global).
- Smart reframe, matting IA, beauty, super resolution e interpolación.
- Multicam, timelines anidadas y grupos; slip/slide/roll completos.
- Stock/música con licencias y publicación programada a redes.
- Texto con forma; letras/lyrics tiene revelado por palabra y los títulos tienen
  movimiento de dos keyframes (2026-10-20).

## Matriz de paridad

Leyenda: **Sí** = existe y está probado; **Parcial** = existe una parte;
**No** = no existe todavía.

| Área | Función de referencia | Editor IA |
| --- | --- | --- |
| Proyecto | Formato de proyecto versionado, autosave, recientes, portabilidad | **Sí** |
| Proyecto | Resolución y fps | **Parcial**: lienzo hasta **32 768 px** por lado y fps racional libre; H.264 se rechaza por encima de 16 384 px y H.265 aceptó 32 768×64 en una prueba de una línea. No se midió un frame 32K² completo |
| Shell | Ajustes organizados por secciones y navegación interna | **Sí**: seis secciones con panel lateral, estado activo y salto al contenido (2026-10-20) |
| Shell | Inicio con estado de instalación y extensión guiada | **Sí**: setup yt-dlp/FFmpeg/FFprobe/SAPI, extensión preparada y descarga rápida (2026-10-20) |
| Medios | Importación no destructiva, hash, medición, licencias | **Sí** |
| Medios | Bins, búsqueda, filtros, favoritos, metadatos editables | **Sí**: bins de texto, favoritos, hasta 8 etiquetas, búsqueda por nombre/ruta/bin/tag y filtros combinables (2026-10-20); sin bins anidados ni smart bins |
| Medios | Proxy / medios optimizados, relink, transcodificación | **Parcial**: proxy de preview por clip; sin relink ni transcodificación masiva |
| Medios | Descarga por URL sin proyecto y normalización de enlaces | **Sí**: yt-dlp, destino base elegible en cualquier disco (persistido, siempre con `<Red>/<Nombre del video>`), dominios sin esquema y texto compartido (2026-10-21) |
| Shell | Rail compacto de iconos | **Sí**: 40 px, botones de 34 px (30/38 por densidad), iconos de 17 px y modo etiquetas configurable (2026-10-21) |
| Medios | Calidad Mejor/Mínima/altura y biblioteca por plataforma/video | **Sí**: selector explícito y `Plataforma/Nombre del video` para YouTube/TikTok/Instagram/etc. (2026-10-20) |
| Timeline | Multipista, trim, split, move, zoom, playhead | **Sí** |
| Timeline | Paneo con mouse, zoom bajo cursor y rueda horizontal | **Sí**: herramienta mano (H), botón central, Ctrl+rueda y Shift+rueda (2026-10-20) |
| Timeline | Ripple/roll/slip/slide, snapping magnético, grupos, nesting | **Parcial**: ripple, slip/slide/roll, cierre de huecos por pista, **subir/bajar capas**, **búsqueda de clips por nombre**, **copiar/pegar atributos entre clips y en lote por color** y snapping a bordes de todas las pistas, marcadores y playhead con guía y toggle (2026-10-21); sin grupos ni nesting |
| Timeline | Velocidad uniforme y ripples | **Sí** (esta pasada) |
| Timeline | Speed ramps por keyframes, freeze frames | **Parcial**: rampa de 3 tramos, curva suave de 6–24 tramos y freeze **en la pista** (divide, inserta 2 s y corre clips/subtítulos/marcadores) o **como capa**; render live verificado 320×180/2,000 s (2026-10-20); sin curva por keyframe ni función continua por frame |
| Timeline | Keyframes de transformación/opacidad/volumen | **Sí**: escala, desplazamiento, rotación, opacidad y ganancia con UI y render (2026-10-20) |
| Timeline | Beat sync: cortar el video al pulso de la música | **Sí**: detección local por energía y UI en el Inspector del audio (2026-10-20) |
| Timeline | Transiciones reales (crossfade, dip, slide, etc.) | **Parcial**: fades de entrada/salida, **disolvencia en lote**, fundido a negro/blanco y deslizamientos laterales/verticales (2026-10-23); sin crossfade solapado |
| Timeline | Movimiento automático de fotos (Ken Burns) | **Sí** (esta pasada) |
| Timeline | Auto-montaje con movimiento y transiciones | **Sí** (esta pasada) |
| Timeline | Marcadores, capítulos, colores de clip | **Parcial**: marcadores por frame con color y **rango con fin editable**, **marcadores desde escenas**, **corte de clips en cada marcador**, **filtro por color en la timeline**, capítulos exportables, validación del mínimo de YouTube, manifiesto y **8 colores de clip** (2026-10-21) |
| Video | Transformación posición/escala/rotación/opacidad | **Sí** |
| Video | Ajustes de color básicos (brillo/contraste/saturación/temperatura/sombras/altas luces/fade/viñeta) | **Sí** (2026-10-20) |
| Video | Nitidez, desenfoque, blanco y negro, sepia | **Sí** (esta pasada) |
| Video | Reducción de ruido de imagen/video | **Sí**: preview WebGL2 bilateral 3×3 en tiempo real + render FFmpeg `hqdn3d`/`atadenoise`/`nlmeans` con progreso, presets y nombres únicos (2026-10-22) |
| Video | Curvas, ruedas primarias/log, HSL, qualifiers, LUTs | **Parcial**: curvas, ruedas RGB de sombras/medios/luces, HSL selectivo y LUT `.cube` por clip/look con intensidad; sin ruedas log ni qualifiers (2026-10-20) |
| Video | Preview fiel del compuesto | **Parcial**: botón **Frame real** que renderiza el clip visual activo con FFmpeg y todos sus efectos (color, máscara, relight, lente, LUT, glow, motion blur), verificado 320×180 (2026-10-24); no incluye otras pistas, subtítulos, títulos ni look global |
| Video | Scopes: onda, vectorscopio, histograma | **Parcial**: preview del clip visual activo con grade CSS; no incluye LUT, títulos, máscaras ni el compuesto final (2026-10-20) |
| Video | Blend modes, máscaras, track matte | **Parcial**: 9 blend modes y máscaras rectángulo, elipse, **diamante, triángulo y rectángulo redondeado** con feather, rotación y keyframes (2026-10-23); sin track matte |
| Video | Smart relight / luz por sujeto | **Parcial**: relight radial local centrado por detección de rostro (SeetaFace), con fuerza/calidez/radio/centro y `geq` en el render (2026-10-23). No es IA, no separa sujeto/fondo y no se ve en la preview |
| Video | Corrección de lente (ResolveFX) | **Sí, básico**: `lenscorrection` por clip con K1/K2 y centro; sólo en el MP4, la preview no simula la distorsión (2026-10-23) |
| Video | Chroma key, matting/background removal | **Parcial**: chroma key por color y **fondo automático con u2netp** para imagen, frame congelado y tramo de video (VP9 alfa + audio, 1080p) desde 2026-10-24; sin máscara editable del recorte |
| Video | Motion tracking, estabilización, smart reframe | **Parcial**: estabilización local con `vidstab` en clips a 1× sin reverse ni transición de entrada y **seguimiento de rostro** que crea keyframes de posición/escala con SeetaFace (2026-10-24); sin tracking de objetos ni smart reframe automático |
| Video | Efectos/transiciones de biblioteca, stickers, títulos | **Parcial**: subtítulos, **glow/halo**, **motion blur** y **9 recetas de efectos creativos** (Suave, Onírico, Noir, VHS, Documental, Alta/Baja clave, Neón, **Glow viral**) que combinan filtros existentes (2026-10-24); sin biblioteca descargable ni stickers |
| Video | Texto libre con tipografía, color y animación | **Sí, básico**: plantilla Motion **Texto libre** con X/Y, ancho, tamaño, color, grosor, alineación y animación (2026-10-24); sin máscara de texto, degradado por capas, ojo de pez ni compound clips |
| Video | Gestión y auditoría de efectos/transiciones | **Sí**: catálogo de 18 efectos, 9 presets y 7 transiciones con filtros FFmpeg medidos; vista **Efectos** con selección múltiple, aplicación por lote, ajustes rápidos y auditoría (2026-10-24). Sin wipes de máscara |
| Audio | Ganancia, fades, mezcla, tracks de narración | **Sí**: mute por clip, separar audio a una pista propia y **presets Voz clara/Música en lote** para clips de audio (2026-10-21) |
| Audio | Ducking automático | **Sí, con límites**: UI en Inspector y Mezclador, `sidechaincompress` sobre la pista de música con el sidechain rellenado con `apad` (2026-10-24). Render medido 320×180: **7,5 dB** de reducción dentro de la locución, plano sin ducking y la cama sigue después de la voz. La reducción real depende del nivel de la fuente; `amountDb` se mapea a un ratio 8 para −12 dB |
| Audio | EQ, compresor, noise reduction, voice isolation, loudness | **Parcial**: EQ 3 bandas, high/low-pass, compresor, `afftdn`, loudnorm y **cadena de diálogo DSP de FilmCraft** (denoise, de-hum, de-esser, de-reverb, EQ, compresor, realce y limitador, 2026-10-23); no separa voces superpuestas ni usa un modelo de IA |
| Audio | Loudness ITU/YouTube | **Sí** (loudnorm a una pasada, aproximado) |
| Audio | TTS local | **Sí** (SAPI) |
| Audio | TTS de proveedor / web externa | **Parcial**: ElevenLabs por API oficial y web externa manual; sin automatizar sitios de terceros |
| Audio | Clonación de voz | **Parcial**: UI y backend `clone_voice` para motores locales XTTS API Server/GPT-SoVITS por HTTP loopback, con muestra 3–30 s, texto acotado y WAV verificado (2026-10-22). No incluye modelo, no entrena voces y no se probó contra un motor real |
| Audio | Sincronización labial / lip-sync | **Sí, con límites**: UI y backend `lip_sync` para motores locales por HTTP loopback + adaptador Wav2Lip real `scripts/lipsync-engine/server.py` en 127.0.0.1:8765 (2026-10-23). Verificado en CPU con salida **512×640 H.264/AAC de 130 556 bytes** y prueba del puente Rust; límite 45 s/1280 px, un trabajo por vez, sin GPU. **Wav2Lip no es comercial**; MuseTalk/LatentSync no verificados |
| Publicación | Manifiesto de derechos, hashes y procedencia | **Sí** (esta pasada) |
| Publicación | Miniatura compuesta con plantillas y export PNG | **Sí**: canvas 2D en 16:9/9:16/1:1, cuatro plantillas, texto/badge/acento/overlay, zona segura, **mejor frame de video por nitidez/contraste/exposición** y guardado PNG verificado (2026-10-23); sin variantes A/B automáticas ni detección de rostro |
| Publicación | Traducción y localización de subtítulos | **Sí, con límites**: importa SRT/VTT/ASS/SSA, traduce a 8 idiomas con proveedor OpenAI-compatible por lotes, glosario y autorización de cuota, exporta SRT/VTT validado y **dobla desde la vista Localización** con SAPI, cues alineadas, atempo/atrim y cama original opcional (2026-10-22), y lip-sync real local (2026-10-23). Faltan voces para todos los idiomas |
| Entrega | Perfiles 16:9/9:16/1:1 | **Sí** |
| IA | Guion estructurado con proveedor o mock | **Sí** |
| IA | Skills locales y presupuesto de tokens | **Sí**: 9 recetas con contrato de salida, prompt autocontenido, límite de 4 000 caracteres, estimación de tokens y handoff del brief a Guion (2026-10-22); sin chat ni agente con herramientas |
| IA | Auto Shorts: candidatos con gancho | **Sí, con límites**: hasta 5 ventanas de 15–60 s, plan copiable y export MP4 1080×1920 con audio, progreso y verificación FFprobe. Smart reframe local con SeetaFace sigue el rostro frontal más grande con expresión FFmpeg suavizada; sin detección cae al centro (2026-10-22). No identifica personas ni garantiza perfiles |
| IA | Auto captions / subtítulos desde escenas | **Sí**: desde guion y transcripción local Faster-Whisper con palabras/tiempos |
| IA | Importar subtítulos desde archivo nativo | **Sí**: diálogo `.srt`/`.vtt`, límite 4 MB, UTF-8 y revisión antes de reemplazar (2026-10-20) |
| IA | Detección de escenas, análisis visual CLIP, smart reframe | **Parcial**: detección de escenas local con FFmpeg; sin CLIP ni smart reframe |
| IA | Generación de imágenes dentro del editor | **No**: vive en la extensión Flow Queue |
| Entrega | Perfiles 16:9/9:16, MP4 H.264/AAC, subtítulos quemados | **Sí** |
| Entrega | Exportación en lote a una carpeta | **Sí** (esta pasada) |
| Entrega | Presets sociales, HDR, hardware encode, publicación | **No** |
| Entrega | Render atómico y verificación FFprobe | **Sí** |
| Extras | Flow Queue: prompts, referencias, descarga y manifiesto | **Sí** (referencias manuales) |
| Extras | Lotes, escenas automáticas, TTS, auto-montaje | **Sí** |
| Extras | Rendimiento de waveforms | **Sí**: caché persistente por SHA-256/buckets, 48 entradas y hit sin decode (2026-10-20) |

## Lo que se implementó en esta pasada

1. **Velocidad de clip** (video/audio):
   - Control en Inspector con presets 0.5x, 1x, 1.5x, 2x y campo numérico.
   - Ajusta la duración y la ventana de origen para conservar la identidad
     `duración × velocidad = frames de origen`.
   - Hace **ripple** de los clips siguientes de la misma pista.
   - El render ya aplica `setpts`/`atempo`; ahora la UI lo expone.
2. **Color y efectos visuales** (video/imagen):
   - Brillo, contraste, saturación, temperatura, viñeta, nitidez, desenfoque,
     blanco y negro y sepia.
   - Fades de video de entrada/salida en frames.
   - Render FFmpeg con `eq`, `colorbalance`, `hue`, `colorchannelmixer`,
     `gblur`, `unsharp`, `vignette` y `fade`.
   - Vista previa aproximada con filtros CSS.
3. **Guion IA hasta 30 escenas** (antes 12), para alinear con flujos de 30
   imágenes como el del video de referencia.
4. **Advertencia de videos no montados** en el montaje automático.
5. **Movimiento Ken Burns y transiciones automáticas** (segunda tanda):
   - `motion` por clip de video/imagen con `zoom-in`, `zoom-out`, `pan-left`,
     `pan-right`, `pan-up`, `pan-down` e intensidad 2–50 %.
   - Render con `zoompan` (z/x/y por frame) y tamaño de salida que conserva la
     relación de aspecto del material.
   - Controles en el Inspector (tipo, intensidad, presets Ken Burns/paneo).
   - Producción y “Auto-montar lote…” alternan presets y agregan fades de 0–30
     frames entre fotos; ambos quedan apagables.
6. **Audio externo y publicación** (tercera tanda):
   - Panel **Audio y voz** en Ajustes: Windows SAPI, ElevenLabs por API oficial
     (clave separada en el almacén de Windows, confirmación de créditos, voces y
     modelos) y web externa manual con URL HTTPS.
   - La voz elegida se usa en Producción; si el proveedor es web externa, los
     audios se importan manualmente.
   - **Auditoría de publicación** con puntaje, licencias, duplicados por hash,
     subtítulos, perfiles y variantes; **manifiesto JSON** local con hashes,
     derechos y procedencia.
   - Perfil **1:1 (1080×1080)** además de 16:9 y 9:16.
7. **Exportación en lote** (cuarta tanda):
   - Un solo diálogo de carpeta y render secuencial de los perfiles marcados.
   - Nombres deterministas `<proyecto>-<perfil>.mp4`; el lote se detiene si el
     archivo existe o si un render falla.
   - Cada elemento conserva el pipeline atómico: temporal, FFprobe, publicación.
8. **Suite de audio y chroma key** (quinta tanda):
   - Por clip: high/low-pass, EQ de 3 bandas, compresor, reducción de ruido
     `afftdn` y presets “Voz clara”/“Música”.
   - Por proyecto: ganancia master, limitador y `loudnorm` a una pasada con
     presets -14/-23 LUFS.
   - Chroma key por color (`#rrggbb`, similitud, mezcla) con alfa para la capa
     inferior; sin segmentación IA.
9. **Detección de escenas y corte automático** (sexta tanda):
   - FFmpeg `select='gt(scene,…)',showinfo` sobre el video local.
   - El Inspector muestra los cortes y divide el clip en partes con
     `splitClipAtFrames`.
   - Sin subida de material, sin API y sin costo.
10. **Transcripción local a subtítulos** (séptima tanda):
   - Faster-Whisper `small` en CPU/int8, sin red.
   - Palabras, tiempos, idioma y probabilidad.
   - El Inspector inserta los segmentos como cues en la posición del clip y
     reemplaza los que se solapan.
   - Requiere Python con `faster-whisper`; se resuelve por
     `EDITORIA_WHISPER_PYTHON`, venv conocido o PATH.

### Verificación de esta pasada

- `npm run verify` → **384 tests Vitest en 32 archivos**, typecheck estricto limpio
  y **31 tests** de Flow Queue.
- `node scripts/rust-env.mjs -- cargo test --workspace` → **69 passed, 0 failed,
  1 ignored**; `cargo fmt --all -- --check` limpio.
- Test Rust `visual_effects_reach_the_filter_chain` comprueba que los nueve
  efectos y los dos fades aparecen en el grafo FFmpeg; `photo_motion_reaches_the_filter_chain`
  verifica `zoompan` y sus expresiones. El render live de 2 s con zoom-in y fades
  pasó por FFmpeg/FFprobe.
- Los tests de acciones cubren velocidad 2x con ripple, 0.5x sin ripple, rechazo
  en imágenes y clamp a 4x; los tests de esquema cubren rangos y claves
  desconocidas de efectos y de movimiento.
- La vista previa usa filtros CSS y el render filtros FFmpeg; **no** se grabó un
  video con todos los efectos aplicados, así que la correspondencia visual exacta
  entre preview y render sigue siendo aproximada (declarada en la UI).

> **Nota posterior (2026-10-19, decimocuarta pasada):** esta sección conserva
> la medición de la pasada de paridad. El estado actual es **401 tests Vitest en
> 37 archivos + 31 Flow Queue + 10 Web TTS**; Rust **82 passed + 1 ignored**. La
> pasada de UI agregó waveforms reales, guías de composición, búsqueda/filtro en
> rail y biblioteca, y toolbar responsive; después llegaron el **Director
> automático** (análisis local, cortes, audio, subtítulos, calidad y memoria
> calibrada), el **convertidor** de medios allowlisted, la **fábrica** de N
> variantes con render opcional, los subtítulos animados por palabra y el
> ducking por sidechain.
- Release con frontend embebido: se abrió `editor-ia-desktop.exe`, cargó
  `http://tauri.localhost/` sin Vite, abrió “Demo completa” y el Inspector de un
  clip de imagen mostró los controles de Movimiento, Brillo, Contraste,
  Saturación, Temperatura, Viñeta, Nitidez, Desenfoque, fades, Blanco y negro y
  Sepia.
- **Auto-montaje real**: “Generar video automático” sobre la demo creó 6 clips
  de imagen con presets alternados (`zoom-in`, `zoom-out`, `pan-left`,
  `pan-right`, `zoom-in`, `zoom-out`), intensidad 0,12 y fades de 8 frames. El
  JSON guardado en `demo-full.editoria.json` contiene `motion` y `effects` en los
  6 clips; el Inspector mostró “Zoom out”, 12 % y 8/8.

## Hoja de ruta recomendada

Ordenada por impacto en edición real, no por cantidad de botones:

1. **Keyframes de transformación/opacidad/volumen + speed ramps.** Es la
   primitiva que desbloquea animaciones, zooms, fades y ritmo. Requiere schema,
   render por expresiones/segmentos y UI de keyframes.
2. **Transiciones reales + máscaras + blend modes + chroma key.** Crossfade,
   dip to black, slide; máscaras lineales/circulares; `blend` y `chromakey`.
3. **Color avanzado:** curvas, ruedas, HSL/qualifier, LUTs `.cube`, scopes.
   CapCut y Resolve lo tienen como centro de su propuesta.
4. **Audio suite:** EQ, compresor, noise reduction (`afftdn`/modelo local),
   voice isolation y loudness ITU/YouTube.
5. **Texto, títulos, stickers y track matte.**
6. **Proxy, multicam, detección de escenas, smart reframe, HDR y presets
   sociales.**

No se debe prometer “todo CapCut/Filmora/DaVinci” en una sola versión: son
suites de años. Esta matriz deja el orden y el criterio para seguir sin inventar
paridad.

## Reproducir la evidencia

- CapCut: `inspect_pe_resources` sobre
  `D:\Users\ofici\_Migrado_de_C\AppData\Local\CapCut\Apps\9.4.0.4015\CapCut.exe`;
  inventario de `Resources/` y lectura de `DefaultAdjustBundle/*/config.json`,
  `Chroma/config.json`, `matting_config/config.json`,
  `SceneEditDetection/config.json`, `lvop_intelligent_crop/manifest.json`.
- DaVinci: `inspect_pe_resources` sobre `D:\BMDDavUI.dll`; cadenas de UI de
  `BMDDavUI.dll`, `DaVinciPanels.dll` y `Resolve.exe`.
- Filmora: las páginas públicas citadas; no hay binario local.

## Addendum 2026-10-20 — REA re-audit and color/encuadre batch

**Evidencia REA nueva**

- `inspect_pe_resources` sobre `CapCut.exe` (sha256 `eeb04ca7…`, PE32+ 90.536 B)
  devolvió sólo los recursos de iconos/versión; la funcionalidad vive en los
  bundles. Inventario del artefacto instalado:
  `Resources/Curves/config.json` y `algorithmConfig.json` (curvas como feature
  AmazingFeature), `Resources/DefaultAdjustBundle/*` (brillo/contraste/clear/
  color_match/combine_adjust, entre otros), `Resources/Chroma` y `Chroma2`,
  `Resources/lvop_intelligent_crop/{manifest.json,algo/reframe_plugin*.json}`,
  `Resources/aigc_text_template`, `Resources/audiosami` (modelos de denoise y
  time-align) y `Resources/models` (189 MB).
- `inspect_pe_resources` sobre `D:\BMDDavUI.dll` (sha256 `86a2f627…`, 2.857.400
  B) inventarió el árbol PE; el análisis de cadenas/procedimientos se apoyó en la
  auditoría previa de `BMDDavUI.dll`, `DaVinciPanels.dll` y `Resolve.exe`.
- **Limitación**: el servidor REA abrió los artefactos y devolvió el inventario PE,
  pero las búsquedas de cadenas posteriores fallaron con `-32603`; no se
  presentan como evidencia nuevas cadenas no recolectadas. Filmora sigue sin
  binario local.

**Implementado en esta pasada**

- **Curvas de color por clip** con presets (contraste suave/medio/fuerte,
  vintage, cross-process, oscurecer, aclarar) implementadas con `curves=preset=…`
  de FFmpeg, más **rotación de tono** (`hue=h=…`) y los looks Cine/Vintage
  actualizados. UI en el Inspector, preview aproximada y render real.
- **Encuadre de exportación `contain`/`cover`** por perfil. `cover` escala con
  `force_original_aspect_ratio=increase` y recorta centrado al tamaño del perfil;
  evita barras al exportar 16:9 a 9:16/1:1. **No es smart reframe**: no detecta
  caras ni sujeto (CapCut tiene `lvop_intelligent_crop`; no se copió su
  algoritmo).
- Tests: esquema de efectos/curvas, encuadre por defecto y rechazo de valores
  inválidos; acción `applyProfileFit`; filtro Rust `curves`/`hue` y test de
  `cover`; test de UI del diálogo de exportación.

**Lo que sigue faltando de la hoja de ruta**

Keyframes, speed ramps, transiciones solapadas, máscaras/blend modes, LUTs
`.cube`, qualifiers/scopes, texto/títulos, smart reframe por IA, proxies,
multicam, HDR y presets sociales. Este addendum no cambia la conclusión: no hay
paridad total.

## Addendum 2026-10-20 (pase 19)

**Implementado y verificado**

- **Montaje automático con video generado**: el pool incluye imágenes y videos
  listos. Un video que cubre la narración se recorta a la duración de la escena;
  uno más corto se estira hasta 2× (`setClipSpeed`) y, si no alcanza, se usa una
  imagen de respaldo con aviso. `mediaByScene` fija un medio por id de escena para
  los artefactos de Flow. Tests: 17 de auto-edit.
- **Keyframes**: UI en el Inspector para escala, desplazamiento, rotación,
  opacidad y ganancia; preview interpolada; render FFmpeg con expresiones por
  frame (`scale` con `eval=frame`, `overlay` con `x/y` en tiempo global, `rotate`
  con `angle`, `volume` con `eval=frame`) y `sendcmd` por frame para la opacidad
  (hasta 300 pasos por clip).
- **Disolvencia de entrada** por clip de video/imagen: schema, UI y render con
  solapamiento temporal sin cambiar la duración de la timeline; el primer clip
  no la muestra. Verificada en un render real de 2,5 s.
- **Títulos**: pista `Títulos` separada, estilo de 92 px centrado y cue editable.
- **Autopiloto IA**: brief → guion → voz local → Flow opcional por escena →
  importación con derechos → montaje → `.editoria.json` → MP4, con cola
  persistente, autorización de créditos por trabajo y reanudación sólo del
  render. Tests: 7 del motor + 2 del panel.
- **Metadatos de publicación**: título, descripción, hashtags, capítulos y
  encaje por plataforma dentro del manifiesto local.

**Sigue faltando**

Curva de velocidad por keyframe (la curva suave es de tramos), wipes/dip-to-color, LUTs `.cube`, máscaras/blend
modes, qualifiers/scopes, multicam, HDR, smart reframe por IA, matting/remoción
de fondo, biblioteca de música/SFX/B-roll con licencia, publicación o
programación en redes, proxies y relink. La generación real con Flow no se
verificó: el Chrome dedicado no tenía sesión de Google ni créditos. Evidencia REA
de este pase en [`REA-APP-ANALYSIS-2026-10-20.md`](REA-APP-ANALYSIS-2026-10-20.md).

## Addendum 2026-10-20 — opacidad animada de punta a punta

**Evidencia REA de esta pasada**

- **CapCut 9.4.0.4015**: el artefacto instalado trae
  `Resources/DefaultAdjustBundle/fade` (ajuste de fundido) y `opacity` en shaders
  del mismo bundle (`FC/AF_DL/effects/LumiLayer`, `AmazingFeature_vignetting`).
  Se leyó el inventario y los shaders; la app no se ejecutó.
- **DaVinci Resolve 21.1.1.10**: se abrió `D:\BMDDavUI.dll` con REA
  (`sha256 86a2f6277e1c80937d5260fe105f71c18e77e4737d4f7cb647775a05b8194fc1`).
  `search_strings` volvió a fallar con `-32603`, así que no se agregan cadenas
  nuevas y se reutiliza la evidencia previa de keyframes.
- **Filmora**: no instalado; solo documentación pública ya citada.

**Implementado**

- Keyframes de **opacidad** con UI (campo “KF opacidad”), captura del valor
  vigente al fijar una clave y render real. FFmpeg no acepta expresiones en
  `colorchannelmixer=aa` (medido: `Undefined constant or missing '(' in 'T'`), así
  que el render emite `colorchannelmixer@kfN=aa=<inicial>` + `sendcmd` con una
  muestra por frame (máximo 300 pasos), desplazada por el solape de la
  disolvencia.
- “Fijar en playhead” captura la escala uniforme y la opacidad vigentes; antes
  forzaba escala 1 y podía reiniciar una toma ya escalada.

**Verificación medida**

- `npm test`: **466 tests en 45 archivos**, verde.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **97 passed, 0 failed,
  1 ignored** (el live), medido al cierre de la pasada; otro pase concurrente
  seguía sumando tests. `cargo fmt --all -- --check` limpio para los archivos de
  esta pasada; el chequeo global quedó señalando un bloque `slide-left` ajeno en
  `ffmpeg.rs` que no se reformateó.
- Render live (`EDITOR_IA_RUN_RENDER_TESTS=1`): 320×180, 2,5 s, **78.115 bytes**,
  FFprobe OK; luminancia YAVG **48,43** (t=0,6 s, opacidad ≈20 %) → **84,09**
  (t=2,1 s, ≈90 %). A 2,3 s baja a 30 por el fade-out del propio clip, no por la
  opacidad.

**No verificado**

- La captura de opacidad desde la UI no se probó a mano en la app release: solo
  tests de acciones, de render y el render live.
- La opacidad se hornea por frame en CPU; no hay aceleración por GPU.


## Addendum 2026-10-20 — beat sync local

**Evidencia REA**

- CapCut 9.4.0.4015 trae en sus traducciones instaladas (`Resources/po/en.po` y
  `es-LA.po`) las cadenas **`add_beat`** (“Add beat”), **`auto_beat`**
  (“Auto beat”), **`beat_sync_videos`** y **`match_video_to_music_beat`**
  (“Match up your video to the beat of the music”). Es superficie de producto
  observada en el artefacto; no se infirió su algoritmo ni se copió código.
- DaVinci y Filmora no aportaron evidencia nueva en esta pasada; rige lo ya
  auditado en este documento.

**Implementado**

- Detección local de pulso en [`state/beat-sync.ts`](../../apps/desktop/src/state/beat-sync.ts):
  energía por ventanas de 20 ms con hop de 10 ms, flujo positivo, umbral
  adaptativo (±0,75 s), picos con intervalo mínimo de 120 ms, BPM por mediana y
  confianza por regularidad. Sin red, sin modelo y sin subir audio.
- Acción **`splitTrackAtFrames`**: divide todos los clips de una pista en los
  frames indicados y respeta pistas bloqueadas.
- Panel **Ritmo** en el Inspector del clip de audio: analizar, BPM/pulsos/confianza,
  paso de 1/2/4/8 pulsos y “Cortar video al ritmo” sobre la pista de video
  superior. Guardas: audio a 1×, pista desbloqueada y pulsos dentro del rango.

**Verificación medida**

- `npm test`: **478 tests**, verde. `node scripts/rust-env.mjs -- cargo test
  --workspace`: **98 passed, 0 failed, 1 ignored**; `cargo fmt --all -- --check`
  limpio.
- Detector sobre un WAV real generado con FFmpeg (click de 1 kHz a 120 BPM,
  48 kHz, 4 s): **120 BPM, 7 pulsos, confianza 1,00**.
- Tests sintéticos: 120 y 90 BPM, silencio, señal corta, mapeo con ventana de
  origen y posición en la timeline, stride, velocidad 2× y hueco mínimo.

**No verificado**

- El panel no se probó a mano en la app release: sólo tests y la corrida del
  detector sobre el WAV real.
- No detecta compases ni downbeats (no marca el “1” del compás); no hay
  marcadores de ritmo en la timeline, sólo cortes.

## Addendum 2026-10-20 — curva de velocidad suave

**Evidencia REA**

- CapCut 9.4.0.4015 ya tiene su inventario auditado en
  [`CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md`](CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md);
  no se agregó evidencia nueva en esta pasada ni se infirió su algoritmo.
- DaVinci y Filmora: rige lo ya auditado; Filmora sigue sin binario local.

**Implementado**

- Acción `applySpeedCurve` en `state/project-actions.ts`: reparte un clip de
  video/audio en N tramos contiguos (3–24; la UI ofrece 6/8/12/16) con perfil
  smoothstep, extremos exactos Desde/Hasta y los tramos intermedios desplazados
  para que la ventana de origen siga sumando. Conserva duración total y ventana,
  reasigna ids en las escenas y limpia fades de frontera; ahora comparte el
  ensamblado con la rampa de tres tramos.
- Panel **Curva de velocidad** en el Inspector con selector de tramos; reutiliza
  Desde/Hasta y muestra las velocidades aplicadas en el aviso.
- Sin cambios de formato (`speed` por clip ya existía); el JSON Schema se
  regeneró porque estaba desincronizado por el lote concurrente.

**Verificación medida**

- `npm run typecheck` limpio; `npm test`: **487 tests en 46 archivos**, verde.
- `cargo test --workspace`: **102 passed, 0 failed, 1 ignored**; `cargo fmt
  --all -- --check` limpio.
- Tests nuevos: 6 tramos sobre un clip de 300 frames conservan duración 300 y
  ventana 300, con tramos contiguos en timeline y origen, primer tramo 1,00x y
  último 0,25x; rechaza extremos iguales, menos de 3 tramos y clips con
  keyframes.

**No verificado**

- Sin render live: la curva reutiliza el `speed` por clip que el render ya
  aplica y no se tocó el grafo FFmpeg.
- No hay curva por keyframe ni función continua por frame: es una aproximación
  de N tramos discretos.

## Addendum 2026-10-20 — estabilización local con vidstab

**Evidencia REA (artefactos instalados, lectura)**

- `D:\Resolve.exe`: coincidencias de cadenas `stabilization`,
  `StabilizationDialog`, `Stabilize` (búsqueda acotada con `grep -a`, primeras
  coincidencias). `D:\DaVinciPanels.dll`: `STABILIZER`, `Stabilizer`,
  `STABILIZE`. Resolve declara la función en su UI; **no** se infiere su
  algoritmo ni se copió código.
- `CapCut.exe` 9.4.0.4015 no devolvió coincidencias para
  `stabiliz|anti-shake|deshake`; su UI vive en bundles, así que el resultado
  **no** prueba ausencia.
- Filmora sigue sin binario local; no se usa como evidencia binaria.
- FFmpeg 9.0.1: `vidstabdetect`/`vidstabtransform` ejecutados de verdad. En una
  prueba con un clip sintético de 200×112 a 30 fps (1,5 s, movimiento
  oscilante), `vidstabdetect` escribió un `.trf` de **8.688 bytes**. La primera
  corrida con el path absoluto sin comillas falló con
  `No option name near '...'`: el `:` del disco dentro de `-vf` necesita la
  forma citada `'C\:/...'` (la misma que ya usaba `lut3d`). Por eso el análisis
  corre con `current_dir` en `media/stabilizers` y escribe un nombre de archivo
  desnudo; el render usa la ruta citada.

**Implementado**

- Esquema `ClipStabilizationSchema` (`smoothing` 1–60, `transformFile`,
  `inFrame`, `outFrame`, ventana no vacía) en clips de video; exportado en
  `packages/project-schema`.
- Acción `setClipStabilization` (aplicar/quitar, suavizado redondeado y
  acotado); tests de esquema y acción.
- Comando Rust `analyze_stabilization`: valida sesión, asset de video listo,
  ventana y fps del proyecto, crea `media/stabilizers`, ejecuta
  `vidstabdetect=shakiness=5:accuracy=15` sobre la **misma** ventana `-ss/-t`
  que usará el render, limpia el `.trf` si FFmpeg falla y devuelve la ruta
  relativa. Registrado en Tauri y expuesto en `project-service`.
- Render: `vidstabtransform=input='...':smoothing=N:crop=black` se inserta
  inmediatamente después de `[i:v]`, antes de color, transformaciones y LUT.
  El render **se niega** (INVALID_PROJECT) si la ventana guardada no coincide
  con el recorte actual, si hay velocidad ≠ 1×, reverse o transición de
  entrada; si falta el `.trf`, devuelve NOT_FOUND con “volvé a analizarla”.
- UI: sección **Estabilización** en el Inspector de video (suavizado, analizar
  y aplicar, quitar, aviso de ventana obsoleta y de bloqueos).
- Guardar como copia los `.trf` referenciados junto con assets, LUTs y proxies
  (`project_stabilization_paths`), con test propio que además rechaza rutas que
  escapan de la raíz.
- Preview: no simula la estabilización; se declara en la UI.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio.
- `npm test`: **503 tests en 48 archivos**, verde al cierre (incluye 5 tests de
  una pasada concurrente de subtítulos). `npm run verify` completo
  (typecheck + Vitest + 31 Flow Queue + 10 Web TTS), verde.
- `node scripts/rust-env.mjs -- cargo test --workspace`: **107 passed, 0
  failed, 2 ignored**; `cargo fmt --all -- --check` limpio.
- Render live ignorado ejecutado con `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test
  render_live_stabilization -- --ignored --nocapture`: **21.205 bytes,
  200×112, 1,500 s**, FFprobe verificado, con `vidstabdetect` real y
  `vidstabtransform` en el grafo.
- Tests nuevos: 5 de esquema, 3 de acción, 5 de render/validación/Save As en Rust y 1
  render live ignorado.

**No verificado**

- La sección de UI no se recorrió a mano en la app release ni en dev; la
  evidencia es typecheck + tests de acción/servicio + render Rust.
- No hay motion tracking ni smart reframe; no se estabiliza automáticamente en
  auto-montaje, fábrica ni autopiloto.
- La estabilización no se aplica a clips recortados después del análisis, con
  velocidad, reverse o transición: hay que reanalizar o quitarla.
- No se probaron rutas de proyecto con apóstrofos u otros caracteres especiales
  en el archivo `.trf`; el nombre generado es un UUID.

## Addendum 2026-10-20 — capas de ajuste por tramo

**Evidencia REA (artefactos instalados, lectura)**

- `inspect_pe_resources` de REA completó sobre `D:\BMDDavUI.dll` (sha256
  `86a2f627…`, 2.857.400 B, evidence `ev_bb516352…`) y sobre `CapCut.exe`
  9.4.0.4015 (sha256 `eeb04ca7…`, 90.536 B, evidence `ev_81987a71…`): el
  primero expone un árbol PE de recursos, el segundo sólo iconos/versión.
- Sobre `D:\Resolve.exe`, una búsqueda acotada de cadenas (`grep -a`) encontró
  **`Adjustment Clip`**, **`AdjustmentClip`** y **`AdjustmentLayerIcon`**. Es
  superficie de producto observada; no se infirió su implementación ni se copió
  código. No se usó un desensamblador sobre el binario completo.
- CapCut 9.4.0.4015 no devolvió `adjustment_layer`, `adjust_layer` ni
  `AdjustmentLayer` en `videoeditor.dll` ni en `Resources/lynx_core.js`. Es una
  ausencia acotada y **no prueba** que la función no exista: su UI vive en
  bundles. No se usa como evidencia de ausencia.
- Filmora sigue sin binario local; rige sólo la documentación pública ya citada.

**Implementado**

- Tipo de pista y de clip **`adjustment`** en el formato v1, con
  `source: { type: "adjustment" }` y `effects` (el mismo esquema del color por
  clip). Los proyectos existentes siguen siendo válidos: el cambio es aditivo y
  el JSON Schema se regeneró.
- Acción `addAdjustmentLayer`: crea la pista `Ajustes` si no existe, coloca una
  capa de 3 s en el playhead (o en el primer hueco libre de esa pista) y admite
  duración explícita. La capa se mueve, recorta, divide, copia y duplica con las
  acciones genéricas ya probadas.
- UI: botón **Capa de ajuste** en la barra de la timeline, tipo de pista en el
  selector y pestaña **Ajuste** en el Inspector, con el mismo editor de color,
  curvas, HSL y LUT del clip. La preview aplica los filtros CSS de la capa
  activa, en orden de pista y antes del look global.
- Render: el grade de la capa se emite contra el compuesto final, después de
  las capas visuales y antes del look global, con
  `enable='between(t,start,end)'` en cada filtro (`eq`, `colorbalance`, `hue`,
  `curves`, `colorchannelmixer`, `gblur`, `unsharp`, `vignette`, `lut3d`). Una
  pista oculta no se aplica. Las capas sin efectos no generan cadena.
- Validación espejo en Rust: `source.type = "adjustment"` se acepta en la
  integridad del proyecto; cualquier otro tipo de fuente sigue rechazándose.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **521 tests en 49 archivos**;
  **31 Flow Queue + 10 Web TTS**; `node scripts/rust-env.mjs -- cargo test
  --workspace`: **122 passed, 0 failed, 3 ignored**; `npm run build`: 801,33 kB
  JS / 121,93 kB CSS; `cargo fmt --all -- --check` limpio.
- Render live (`EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_pipeline`):
  el proyecto del test incluye una capa de ajuste (contraste 1,08, curva
  contrast-soft y LUT identidad) sobre 75 frames y un clip con keyframes,
  máscara, chroma, reverse y audio; FFmpeg completó y FFprobe verificó
  **55.638 bytes, 320×180, 2,500 s**. La luminancia pasó de **70,00** (t=0,6 s)
  a **90,27** (t=2,1 s), atribuible a la opacidad animada, no a la capa.
  Una corrida intermedia con `vignette: 0.15` también renderizó (FFmpeg aceptó
  el filtro con `enable`), pero se quitó del fixture porque redujo el delta de
  luminancia por debajo del umbral que verifica la opacidad.
- Tests nuevos: 3 de esquema (clip de ajuste válido, medio rechazado, solape en
  la pista), 3 de acción (creación, reutilización de pista, división con
  efectos) y 2 de render (ventana `enable` y pista oculta).
- El test de integridad Rust no tiene un test propio nuevo; el caso válido lo
  cubre el build plan y los tests de esquema.

**Límites y no verificado**

- La capa se aplica al **compuesto final**, no sólo a las pistas inferiores como
  el `Adjustment Clip` de Resolve. Es una diferencia semántica declarada: para
  aislar el efecto hay que usar el color por clip o el look global.
- La preview CSS aproxima brillo/contraste/saturación/HSL/blur/B-N/sepia; no
  simula curvas, viñeta, nitidez ni LUT. El MP4 es la referencia.
- La UI no se recorrió a mano en la app release; la evidencia es typecheck,
  tests de acción/render y el render live.
- No hay control de intensidad/mezcla de la capa ni keyframes de sus efectos;
  varias capas se aplican en secuencia según el orden de pista.

## Addendum 2026-10-20 — organización de medios

**Evidencia REA (artefactos instalados, lectura)**

- `inspect_pe_resources` completó sobre `D:\BMDDavUI.dll` (sha256
  `86a2f627…`, 2.857.400 B, evidence `ev_bb516352…`) y `CapCut.exe` 9.4.0.4015
  (sha256 `eeb04ca7…`, 90.536 B, evidence `ev_81987a71…`).
- `D:\Resolve.exe` contiene las cadenas `Media Pool`, `Smart Bin`, `Favorite` y
  `Bin` (búsqueda acotada con `grep -a`). Es superficie de producto observada; no
  se infirió su implementación.
- CapCut 9.4.0.4015: `Resources/po/en.po` y `es-LA.po` contienen `favorites`
  (“Add to Favorites”), `pc_favorite_media_will_appear_here`,
  `pc_library_assetLibrary_navBar_tab_favorites` y `favorites_pc_amount`. Es
  superficie de i18n observada; no prueba el comportamiento de la UI actual.
- Filmora sigue sin binario local; rige sólo la documentación pública.

**Implementado**

- `AssetSchema` acepta `favorite`, `tags` (máximo 8, 24 caracteres cada una,
  únicas sin distinguir mayúsculas) y `bin` (40 caracteres). Son campos
  opcionales: el formato v1 sigue siendo compatible y el JSON Schema se
  regeneró.
- Acciones `updateAssetMetadata` y `toggleAssetFavorite`: recortan, deduplican y
  validan; limpiar el bin o las etiquetas las elimina del documento. No tocan
  rutas, hashes, derechos ni medición.
- Helper `filterAssets`/`assetBins`: búsqueda por nombre, nombre amigable, ruta,
  bin y etiquetas; filtros combinables por tipo, bin y favoritos.
- UI: en **Medios**, estrella por tarjeta, editor inline de bin/etiquetas, filtro
  por bin y botón **Solo favoritos**. En el rail del editor, estrella, bin,
  etiquetas y filtro de favoritos. En el Inspector del asset, sección
  **Organización** con favorito, bin y etiquetas.
- La búsqueda del rail y de la biblioteca comparte el mismo helper, así que ambas
  superficies no pueden divergir en qué consideran una coincidencia.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **533 tests en 50 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **122 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio; `npm run build`:
  **806,72 kB JS / 123,20 kB CSS**.
- Tests nuevos: 4 de esquema, 3 de acciones, 4 del helper de filtros y 1 de UI
  (filtro por favoritos, búsqueda por etiqueta y alternancia de estrella).
- No se tocó el grafo FFmpeg ni el render: no hubo render live en esta pasada.

**Límites y no verificado**

- Los bins son **etiquetas de texto**, no carpetas anidadas ni un árbol de media
  pool; no hay arrastrar-y-soltar a un bin, selección múltiple ni acciones en
  lote.
- No hay smart bins por regla ni filtros guardados; el filtrado es en memoria
  sobre el proyecto abierto.
- La búsqueda es por subcadena, no difusa ni por metadatos de cámara.
- La UI no se recorrió a mano en la app release; la evidencia es typecheck,
  tests de esquema/acciones/helper y el test de UI con jsdom.

## Addendum 2026-10-20 — marcadores y capítulos

**Evidencia REA (artefactos instalados, lectura)**

- `D:\Resolve.exe` contiene `Marker`, `MarkerAdd`, `MarkerAnnotationColorType`
  y `MarkerAnnotationOverlay` (búsqueda acotada con `grep -a`).
- CapCut 9.4.0.4015: `Resources/po/en.po` contiene `Add marker`,
  `Delete marker`, `Delete all markers in clip`, `Marker %1`, `First marker`,
  `Add chapter` y `Delete chapter`. Es superficie de i18n observada; no prueba
  el comportamiento de la UI actual.
- Filmora sigue sin binario local; rige sólo la documentación pública.

**Implementado**

- `MarkerSchema` en la raíz del proyecto: `{id, frame, label, color?}`, una sola
  línea, máximo 120 caracteres y 200 marcadores; un solo marcador por frame. La
  colección tiene default `[]`, así que los proyectos v1 anteriores cargan sin
  migración. El JSON Schema se regeneró y `markers` se agregó a las claves raíz
  conocidas.
- Acciones `addMarker`, `updateMarker`, `deleteMarker` y `clearMarkers`, más
  `markerAtFrame` y `chaptersFromMarkers`/`formatMarkerChapters`.
- UI: botón **Marcador** y atajo **M** en la timeline; pines por color en la
  regla que saltan al frame; Inspector del proyecto con lista editable (frame,
  nombre y color), borrado individual o total, copia y descarga `.txt` de
  capítulos.
- Manifiesto de publicación: si el proyecto tiene marcadores, los capítulos se
  derivan de ellos (tiempos redondeados y deduplicados, `0:00 Inicio` si hace
  falta); sin marcadores sigue usando las escenas.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **550 tests en 52 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **125 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: build code-split; entrada **455,54 kB JS**, `EditorWorkspace`
  **155,53 kB**, `AssetsPanel` **16,20 kB**, chunk `markers` **2,22 kB**; CSS
  **125,80 kB**. El code splitting es de una pasada concurrente, no de esta.
- Tests nuevos: 7 de esquema, 7 de acciones/capítulos, 1 del manifiesto y 1 de
  UI que agrega y quita un marcador con **M**.
- No se tocó el grafo FFmpeg: no hubo render live.

**Límites y no verificado**

- Los marcadores son puntos del proyecto, no rangos ni marcadores por clip; no
  hay arrastre de pines en la regla (el frame se edita en el Inspector).
- No hay validación de las reglas de YouTube (mínimo 3 capítulos, 10 s entre
  capítulos); el export sólo formatea y asegura el `0:00`.
- No hay capítulos automáticos desde escenas ni desde beats; los marcadores son
  manuales.
- La UI no se recorrió a mano en la app release; la evidencia es el test de UI
  con jsdom, typecheck y los tests de acciones.

## Addendum 2026-10-20 — recorte fino slip/slide/roll

**Evidencia REA (artefactos instalados, lectura)**

- `D:\Resolve.exe` contiene `Slip`, `Slide`, `Roll`, `TrimMode` y `Ripple`
  (búsqueda acotada con `grep -a`). Es superficie de producto observada; no se
  infirió su implementación.
- CapCut 9.4.0.4015: la búsqueda acotada de `slip`, `slide` y `roll` en
  `Resources/po/en.po` no devolvió cadenas funcionales de trim (sólo texto de
  marketing y B-roll). No se usa como evidencia de ausencia ni de presencia.
- Filmora sigue sin binario local; rige sólo la documentación pública.

**Implementado**

- `slipClip`: mueve `source.inFrame`/`outFrame` en el mismo delta, sin tocar
  `startFrame`, `durationFrames`, los vecinos ni la identidad de timing.
- `slideClip`: mueve el clip seleccionado y ajusta los dos vecinos contiguos;
  el borde exterior izquierdo y derecho de la pista se conservan.
- `rollClip(edge: "in"|"out")`: mueve el corte con el clip anterior o el
  siguiente, conservando los bordes exteriores.
- Guardas comunes: pista desbloqueada, velocidad exactamente 1×, sin
  estabilización. Slide y Roll además exigen vecinos de video/audio contiguos y
  rechazan keyframes de transformación, ganancia o máscara.
- UI: pestaña **Recorte** para clips de video/audio, con desplazamiento en
  frames y botones **Slip**, **Slide**, **Roll entrada** y **Roll salida**;
  muestra la ventana de origen y la velocidad actual. Los botones se deshabilitan
  fuera de 1×.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **564 tests en 54 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **125 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **459,51 kB JS**, `EditorWorkspace` **157,27 kB**;
  CSS **135,77 kB**.
- Tests nuevos: 10 de acciones: slip dentro/fuera de ventana y 1×; slide a
  izquierda/derecha, hueco y keyframes; roll de entrada/salida y límite de
  ventana. Todos los resultados se validan con `parseProject`.
- No se tocó FFmpeg: no hubo render live.

**Límites y no verificado**

- El ajuste se hace con botones y un campo de frames, no con modos de
  arrastre ni atajos de teclado.
- Slide y Roll sólo operan dentro de una pista y con vecinos de video/audio;
  no mueven grupos ni cruzan pistas.
- Velocidad distinta de 1× y keyframes deben resolverse antes; la app lo
  rechaza en vez de aproximar.
- La pestaña **Recorte** no se recorrió a mano en la app release: la evidencia
  es typecheck y los 10 tests de acción.

## Addendum 2026-10-20 — snapping magnético ampliado

**Evidencia REA (artefactos instalados, lectura)**

- `D:\Resolve.exe` contiene `Snapping`, `SnapTo`, `Magnetic` y `Magnet`
  (búsqueda acotada con `grep -a`). Es superficie de producto observada; no se
  infirió su implementación.
- CapCut 9.4.0.4015: `Resources/po/en.po` contiene `Auto snapping`,
  `Turn off auto snapping`, `Main track magnet` y `Main track magnet turned on`.
  Es superficie de i18n observada; no prueba el comportamiento de la UI actual.
- Filmora sigue sin binario local; rige sólo la documentación pública.

**Implementado**

- Helper `collectSnapTargets`: origen, playhead, todos los marcadores y ambos
  bordes de cada clip excepto el que se arrastra, **de todas las pistas**.
- `snapFrame` y `snapSpan` eligen el destino más cercano dentro del umbral;
  `snapSpan` prueba inicio y fin y mueve el span por el extremo que esté más
  cerca. `snapThreshold` convierte ~10 px de pantalla a frames, acotado a 1–12
  según el zoom.
- Timeline: snapping en mover, recortar inicio/fin y mover subtítulos. Guía
  vertical con el nombre del destino; botón **Imán** con `aria-pressed` y
  **Alt** para desactivarlo durante un arrastre. No cambia el esquema ni el
  render.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **582 tests en 57 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **125 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **466,42 kB JS**, `EditorWorkspace` **159,51 kB**;
  CSS **141,11 kB**.
- Tests nuevos: 8 del helper (todas las pistas, exclusión del clip, snap por
  inicio/fin, sin objetivo, umbral por zoom) y 1 de UI que apaga y prende el
  imán.
- No se tocó FFmpeg: no hubo render live.

**Límites y no verificado**

- Los destinos no incluyen bordes de subtítulos ni una grilla de beats; para
  alinear con música hay que poner un marcador.
- No hay ripple magnético de pista principal ni cierre automático de huecos:
  el snapping sólo alinea durante el arrastre.
- El estado del imán no se persiste entre recargas.
- El toggle de UI está probado, pero el arrastre real no tiene un E2E DOM: la
  geometría de snap está cubierta por los tests del helper.

## Addendum 2026-10-20 — iconos, aprendizaje y cumplimiento

**Implementado**

- Acciones de barra con icono y texto accesible; tooltip nativo en `AppShell`.
  Formularios y reglas conservan etiquetas escritas.
- La tarjeta y el reset de “Memoria del Director” se retiraron; la persistencia y
  calibración local siguen activas sin UI.
- `learning-progress`: almacenamiento v2 con migración v1, visitas por vista,
  secciones completadas automáticamente, evento de actualización y guía
  personalizada en Aprender. Nada se muestra ni se envía.
- `PandaGuide`: SVG original con regla y animaciones; bienvenida con consejos
  rotativos y guía contextual en Aprender. Respeta movimiento reducido.
- `platform-rules`: ocho paquetes (YouTube, Shorts, TikTok, Reels, Facebook, X,
  Twitch, LinkedIn) con fuentes, monetización, riesgos, orientación, altura,
  duración, peso, IA, música y subtítulos; `auditProjectForPlatform` produce
  bloqueos, avisos e información. `ComplianceView` audita el proyecto abierto,
  cachea el remoto y se refresca una vez al día. Rust `fetch_platform_rules`
  baja un JSON fijo con límite de 512 KB, esquema validado y timeout de 15 s.
- `scripts/export-platform-rules.mjs` (`npm run rules:export`) genera
  `data/platform-rules.json`; la actualización remota sólo llega a otros equipos
  cuando ese archivo se publica en `main`.

**Verificación medida (2026-10-20)**

- `npm run verify`: verde (typecheck estricto, Vitest, 31 Flow Queue, 10 Web
  TTS); **573 tests Vitest en 56 archivos**. Rust **125 passed, 0 failed, 3
  ignored**.
- `npm run build`: entrada **466,25 kB JS** (gzip 135,24), `EditorWorkspace`
  **157,60 kB**, `ComplianceView` **16,46 kB**; CSS **140,61 kB** (gzip 24,77).
- Tests nuevos: 4 de progreso de aprendizaje, 4 de reglas/auditoría, 4 de
  timeline (ancho, arrastre continuo, clip y cabezal) y 1 de UI de Cumplimiento.

**Límites y no verificado**

- “Todas las redes” no está cubierto: son ocho plataformas. Las reglas son un
  preflight editable, no una copia certificada ni una garantía de monetización o
  ausencia de strikes; las plataformas deciden cada caso.
- La vista Cumplimiento y el modal de bienvenida con Pando no se recorrieron a
  mano en la app release en esta pasada. La evidencia es el test de UI, typecheck
  y la suite.

## Addendum 2026-10-20 — tono fino: sombras, altas luces y fade

**Evidencia REA (artefactos instalados, lectura)**

- CapCut 9.4.0.4015 trae en `Resources/DefaultAdjustBundle` las carpetas
  separadas **`highlight`**, **`shadow`** y **`fade`**, cada una con su
  `config.json`/materiales (`fade/amazingfeature/texture/fade_max.texture`,
  `highlight/config.json`, etc.). Se leyó el inventario; no se copió código ni
  assets.
- `D:\Resolve.exe` contiene `Highlight`, `Highlights`, `Shadow`, `Shadows` y
  `Fade` (búsqueda acotada con `grep -a`).
- Filmora sigue sin binario local; rige sólo la documentación pública.

**Implementado**

- `ClipEffectsSchema` acepta `shadows` y `highlights` en `[-1,1]` y `fade` en
  `[0,1]`, opcionales y compatibles con proyectos v1; el JSON Schema se
  regeneró. Se aplican al color por clip, al look global y a las capas de ajuste.
- FFmpeg genera una **curva maestra** fija de cinco puntos, con los valores
  acotados: el fade levanta negros y baja blancos, las sombras mueven el punto
  0.25 y las altas luces el 0.75. Se aplica antes de la curva creativa o preset;
  no se concatena texto del usuario.
- UI: campos **Sombras**, **Altas luces** y **Fade tonal** en la pestaña Color
  del clip y en el panel del look global. La preview CSS aproxima el efecto.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **596 tests en 59 archivos** (incluye
  tests concurrentes de Scopes/Cumplimiento); **31 Flow Queue + 10 Web TTS**;
  `cargo test --workspace`: **130 passed, 0 failed, 3 ignored**; `cargo fmt
  --all -- --check` limpio.
- `npm run build`: entrada **466,87 kB JS**, `EditorWorkspace` **169,38 kB**;
  CSS **146,58 kB**.
- Render live con la curva de tono en el clip complejo: **55.676 bytes,
  320×180, 2,500 s**, FFprobe OK; YAVG 70,00 → 90,31.
- Tests nuevos: 2 de esquema y 1 unitario de la curva; se extendieron los tests
  de grafo del clip y del look, y el render live.

**Límites y no verificado**

- Es una **curva maestra**, no máscaras de luminancia independientes ni
  qualifiers: sombras y altas luces se afectan de forma continua.
- Si hay una curva personalizada, ambas curvas se aplican en secuencia; no se
  fusionan en una sola.
- La preview CSS es aproximada y no reproduce la curva exacta; el MP4 es la
  referencia.
- La UI no se recorrió a mano en la app release; la evidencia es typecheck,
  tests de esquema y el render live.

## Addendum 2026-10-20 — intensidad de LUT, scopes y capítulos

**Implementado**

- `lutIntensity` 0–1 en `ClipEffectsSchema` y en el JSON Schema generado.
  `apply_lut_to_chain` mantiene un único `lut3d` al 100 % y, con valores
  parciales, divide el stream y mezcla original/graduado con
  `blend=all_mode=normal:all_opacity=1-intensity`. La máscara y la opacidad del
  clip quedan fuera de la mezcla. Se aplica por clip, en capas de ajuste con
  `enable='between(t,…)'` y en el look global. La UI agrega **Intensidad LUT
  (%)** al cargar el `.cube`; la preview no simula el LUT.
- `scopes.ts`: cálculo puro de histogramas RGB/luma, waveform de 96×64 y
  vectorscopio de 64×64 a partir de RGBA, con submuestreo hasta 40 000 muestras.
  `ScopesPanel.tsx` muestrea el `.preview-media` superior cada ~180 ms, aplica
  el grade CSS propio y el del `.preview-look`, y dibuja en canvas. Tabs
  accesibles, cierre y estados de señal. Los `<video>`/`<img>` de la preview
  llevan `crossOrigin="anonymous"`; el protocolo de assets de Tauri responde
  `Access-Control-Allow-Origin` del origen de la ventana, requisito para leer
  píxeles sin contaminar el canvas.
- `validateChapters`: mínimo de YouTube (tres capítulos, primero en 0:00, 10 s
  entre inicios); el Inspector muestra los problemas junto a la vista previa de
  capítulos. No valida moderación ni monetización.

**Evidencia y verificación (2026-10-20)**

- REA abrió `CapCut.exe` 9.4.0.4015 (SHA-256 `eeb04ca7…`, evidence
  `ev_7f946dc4ea…`); la búsqueda de literales de scopes/intensidad no devolvió
  strings definidos. Es una ausencia acotada al inventario de Ghidra, no una
  prueba de que la función no exista. La referencia de producto es el inventario
  CapCut y la documentación pública.
- `npm run verify` verde; **593 tests Vitest en 59 archivos**; 31 Flow Queue + 10
  Web TTS. Rust **130 passed, 0 failed, 3 ignored**; `cargo fmt --check` limpio.
- `npm run build`: entrada **466,58 kB JS**, `EditorWorkspace` **167,35 kB**,
  CSS **142,76 kB**.
- Humo real de FFmpeg con un LUT identidad 2×2: el grafo de mezcla parcial y el
  grafo con `enable` devolvieron **BLEND OK** y **GATED OK**. Los tests Rust
  cubren separadores del grafo, opacidad 1−intensidad, caso 0 %, caso 100 % y
  compuerta temporal.

**Límites y no verificado**

- Los scopes muestrean el clip visual activo con el grade CSS de la preview; no
  incluyen LUT, títulos, máscaras, recortes ni el compuesto final. No son una
  medición del MP4.
- No hay protección de piel ni LUTs por marca con presets; siguen faltando smart
  relight, smart reframe, motion tracking, matting IA, multicam y timelines
  anidadas.
- La vista Scopes y el campo de intensidad no se recorrieron a mano en la app
  release. La evidencia es el test de UI, los tests puros, typecheck y el build.

## Addendum 2026-10-20 — navegación de timeline y Ajustes

**Implementado**

- Timeline: herramienta **Mover** (H), paneo con botón central, `Shift+rueda`
  para desplazamiento horizontal y `Ctrl+rueda` para zoom anclado al cursor. El
  paneo usa captura de puntero, no mueve el playhead y tolera que el puntero
  salga del contenedor.
- Shell: `overflow: clip` reemplaza el `overflow: hidden` que todavía permitía
  que el foco y `scrollIntoView` desplazaran el shell y ocultaran la barra
  superior.
- Ajustes: shell de dos paneles con navegación por seis secciones, encabezados
  explicativos, estado activo sincronizado con el scroll y adaptación a grilla en
  pantallas angostas. El salto de sección calcula el `scrollTop` del panel de
  contenido en lugar de usar `scrollIntoView`.
- Se quitaron las etiquetas duplicadas “Interfaz” y “Audio y voz” de las tarjetas
  de Apariencia y narración; los encabezados de sección llevan esa jerarquía.

**Verificación (2026-10-20)**

- `npm run typecheck` limpio; **596 tests en 59 archivos**; build de producción
  verde.
- `npm run build`: entrada **467,01 kB JS**, `EditorWorkspace` **169,64 kB**,
  `SettingsHome` **23,97 kB**, CSS **146,63 kB**.
- Navegador real a **1360×577**: Ajustes se recorrió en Apariencia, IA, Voz,
  Herramientas y Datos locales; el panel activo y la barra superior se mantienen
  al saltar de sección. La timeline se inspeccionó con un harness temporal de un
  clip de 3000 frames; el harness se eliminó después.
- Tests nuevos: 3 de timeline (mano, botón central y ruedas); la prueba de
  Ajustes se extendió para verificar la navegación y `aria-current`.

**Límites y no verificado**

- El paneo táctil, el trackpad en macOS y la app nativa a distintos tamaños no
  se probaron en esta pasada. La evidencia es el navegador externo, jsdom y
  typecheck.
- Ajustes no incorpora búsqueda de preferencias ni edición de atajos; mantiene
  los formularios y acciones existentes.

## Addendum 2026-10-20 — descarga de YouTube sin proyecto

**Causa raíz reproducida**

- El flujo rápido de Proyectos permitía pegar una URL sin un proyecto abierto,
  pero `DownloadView` deshabilitaba la descarga por `!project` y sólo sabía
  importar a Medios. El usuario quedaba en un callejón sin salida.
- Los campos `type="url"` bloqueaban con la validación nativa un dominio sin
  `https://` o texto compartido, sin mostrar un error propio.
- El motor y el comando no eran la causa: yt-dlp **2026.08.19** analizó y
  descargó un video público de YouTube (Big Buck Bunny, CC BY) con FFmpeg, y el
  test vivo de la app bajó 360p y comprimió correctamente.

**Implementado**

- `normalizeDownloadUrl` (frontend) acepta URL completa, dominio sin esquema,
  `//host/...` y share text; los formularios pasan a `type="text"` con
  `inputMode="url"` y validación propia. Rust vuelve a validar el esquema/host.
- `saveToDownloads` en `DownloadRequest`: el comando mueve los archivos a
  `Descargas/Videos descargados/<Plataforma>/<Nombre del video>`, resuelve colisiones con sufijo
  numérico, actualiza el outcome y limpia el temporal. La UI muestra la ruta y
  un botón **Mostrar en carpeta**; con proyecto además importa a Medios.
- `quality` en `DownloadRequest`: `best`, `worst` o `height`. El selector
  muestra **Mejor disponible**, **Mínima disponible** y cada altura real.
  `video_format_selector` usa `bestvideo+bestaudio` o
  `worstvideo+worstaudio`, y mantiene el tope de altura para las opciones
  concretas.
- **OSError 22**: reproducido con un nombre temporal de 300 caracteres. El
  template bajó de `%(title).120s` a `%(title).60s` y se agregó
  `--windows-filenames`; la carpeta final usa el stem corto y saneado.
- Tests: 4 de normalización y 2 de flujo sin proyecto, incluido
  `youtube.com/watch?...` sin esquema; test Rust del movimiento y colisiones.

**Verificación medida (2026-10-20)**

- **617 tests Vitest en 62 archivos**; Rust **140 passed, 0 failed, 3 ignored**;
  typecheck y build verdes. Entrada **469,34 kB JS**, CSS **146,63 kB**.
- Prueba end-to-end con el puente nuevo: descarga Mínima de YouTube en
  `Videos descargados/YouTube/<nombre corto>/`; archivo de **6.004.268 bytes**.
- Pruebas directas: `youtu.be`, `m.youtube.com` y URL con `&list=` analizaron
  correctamente; `--simulate` confirmó Mejor=2160p y Mínima=144p; descarga real
  del video CC de 144p: **15 MB**, merge/remux OK.
- Test vivo de la app: 360p + compresión compacta, archivo verificado.

**Límites**

- DRM, vivos, privados, age-restricted y sitios con captcha pueden requerir
  cookies o fallar; el motor no evade esas protecciones. La disponibilidad la
  decide el sitio. La instalación NSIS no se rehizo en esta pasada.

## Addendum 2026-10-20 — selector nativo de subtítulos SRT/VTT

**Contexto y evidencia**

- El faltante estaba documentado en esta matriz: la importación sólo existía por
  pegado o descarga. No es una función observada en CapCut/Resolve, así que no
  se atribuye a una auditoría REA; Filmora sigue sin binario local.
- Se descartó antes un modo de reducción de ruido no local con `anlmdn`: el
  filtro existe en FFmpeg 9.0.1, pero el binario instalado termina con **exit
  127** en una prueba directa con un WAV simple. Se revirtió por completo y no
  forma parte de este cambio.

**Implementado**

- Comando Rust `choose_subtitle_file`: diálogo nativo limitado a `.srt`/`.vtt`,
  lectura de hasta 4 MB, rechazo de archivos vacíos o que no sean UTF-8 y
  devolución de `{name, text}`. El texto no se copia al proyecto: la UI lo
  parsea con el mismo `parseSubtitles` existente.
- Servicio `chooseSubtitleFile()` y botón **Elegir archivo…** en el panel de
  subtítulos del Inspector. El archivo se carga en el textarea para revisarlo y
  después se confirma **Importar y reemplazar**; se conservan títulos y se
  convierten segundos a frames.
- Sin cambios de esquema ni de render.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **603 tests en 60 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **135 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **467,86 kB JS**, `EditorWorkspace` **170,07 kB**;
  CSS **146,63 kB**.
- Tests nuevos: 4 Rust del lector (SRT UTF-8, VTT con mayúsculas, extensión/
  archivo vacío y bytes no UTF-8) y 1 de UI que llama al selector y deja el
  texto cargado. El render live se re-ejecutó tras revertir `anlmdn`:
  **55.676 bytes, 320×180, 2,500 s**, FFprobe OK.
- El diálogo nativo en sí no se automatiza en tests; se prueba el lector y la
  UI con el servicio simulado.

**Límites**

- No se abre el diálogo en la app release durante esta pasada; la evidencia es
  el test de UI con servicio simulado, los 4 tests Rust y el typecheck.
- Sólo UTF-8; un SRT en ANSI/Windows-1252 se rechaza con un mensaje claro.
- No hay arrastrar-y-soltar ni watcher de carpeta; es un selector puntual.

## Addendum 2026-10-20 — caché persistente de waveforms

**Contexto**

- Brecha de rendimiento para contenido masivo: cada apertura de proyecto volvía
  a decodificar el mismo audio para dibujar las olas. No requiere evidencia REA;
  es una mejora interna de la timeline.

**Implementado**

- `waveform-cache.ts`: clave **content-addressed** por `integrity.sha256` (o URL
  si el asset aún no tiene hash) y cantidad de buckets; almacenamiento
  `localStorage` versión 1; validación de longitud y valores `[0,1]`; poda a 48
  entradas por `updatedAt`; reintento tras error de cuota.
- `useWaveform` consulta memoria y luego `localStorage` antes de mirar
  `OfflineAudioContext`; un hit no hace `fetch` ni decode. Los errores de decode
  siguen cacheados sólo en memoria.
- Sin cambios de esquema: el proyecto no guarda píxeles de waveform.
- Medición: una entrada de 180 buckets pesa **721 bytes**; 48 entradas ocupan
  **~33,8 KB**.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **608 tests en 61 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **137 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **467,86 kB JS**, `EditorWorkspace` **171,45 kB**;
  CSS **146,63 kB**.
- Tests nuevos: 5 (roundtrip, hash vs. URL, entradas corruptas, poda y cuota;
  más el hit del hook que verifica que `fetch` no se llama). No se tocó FFmpeg:
  no hubo render live.

**Límites**

- La caché vive en el `localStorage` del WebView, no en el `.editoria.json`; no
  viaja con el proyecto ni entre máquinas. Se poda por cantidad, no por bytes.
- Sólo se cachean assets de hasta 10 minutos y se usa el primer canal, como la
  waveform existente.
- No hay botón para vaciar la caché; se puede limpiar desde el navegador/WebView.

## Addendum 2026-10-20 — revelado por palabra (lyrics)

**Evidencia**

- CapCut ya tenía en el inventario previo carpetas de text templates/captions y
  `aigc_text_template`; no se agregó evidencia nueva en esta pasada. Filmora
  sigue sin binario local. La brecha estaba documentada en esta matriz.

**Implementado**

- `wordReveal` opcional en `CaptionCue` (aditivo, v1); `updateCaptionCue` lo
  activa/limpia. JSON Schema regenerado.
- UI: casilla **Revelar por palabra** en el Inspector del subtítulo, con aviso
  de que requiere tiempos de palabra.
- Preview: `cueWordsAt` devuelve sólo las palabras ya iniciadas; la última se
  resalta y antes de la primera no se dibuja el cue.
- Rust/ASS: con `wordReveal` y más de una palabra se emiten eventos
  `Dialogue` incrementales, sin la línea completa previa; los eventos conservan
  la animación elegida. La profundidad 3D se omite en modo revelado.
- Tests: esquema, acción, helper de preview y eventos ASS; el render live
  existente se extendió con un cue de cuatro palabras.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **611 tests en 61 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **140 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **467,97 kB JS**, `EditorWorkspace` **172,14 kB**;
  CSS **146,63 kB**.
- Render live: **60.505 bytes, 320×180, 2,500 s**, FFprobe OK; YAVG 65,45 → 90,29.
- Tests nuevos: 4 (1 esquema, 1 acción, 1 helper, 1 ASS).

**Límites**

- Sin palabras con tiempos se muestra la línea completa; no inventa timings.
- En modo revelado no se emiten las capas de profundidad 3D del estilo.
- Es revelado por palabra, no keyframes de estilo ni texto curvo.
- La UI no se recorrió a mano en la app release; el ASS se verificó con test y
  render live.

## Addendum 2026-10-20 — movimiento de títulos en dos keyframes

**Evidencia**

- CapCut ya tenía en el inventario previo text templates/captions y animaciones
  de texto; no se agregó evidencia nueva. Filmora sigue sin binario local.

**Implementado**

- `CaptionMotionSchema` en `CaptionCue`: exactamente dos claves (frame 0 y dentro
  del cue), con `x`/`y ∈ [−1,1]`, `scale ∈ [0.2,4]`, `rotationDeg ∈ [−180,180]`
  y `opacity ∈ [0,1]`; al menos una propiedad animada. Presets `fade`, `zoom`,
  `slide-left`, `slide-right` y `zoom-out`. JSON Schema regenerado.
- Acción `updateCaptionCue` acepta/limpia `motion`; el Inspector ofrece un
  selector de movimiento y avisa que no aplica a subtítulos con palabras.
- Preview: `captionMotionAt` interpola las dos claves y aplica transform/opacity
  al span del título.
- ASS: `caption_motion_tags` emite `\move` sólo si hay x/y, más
  `\fscx/\fscy`, `\frz`, `\alpha` y `\t`; si hay movimiento, reemplaza a la
  animación fade/pop/slide para no duplicar `\move`. Las capas 3D reciben los
  mismos tags.
- Tests: esquema, acción, sampler/presets, ASS y render live con un título
  `slide-left`.

**Verificación medida (2026-10-20)**

- `npm run typecheck` limpio; `npm test`: **617 tests en 62 archivos**;
  **31 Flow Queue + 10 Web TTS**; `cargo test --workspace`: **141 passed, 0
  failed, 3 ignored**; `cargo fmt --all -- --check` limpio.
- `npm run build`: entrada **469,34 kB JS**, `EditorWorkspace` **174,40 kB**;
  CSS **146,63 kB**.
- Render live: **65.379 bytes, 320×180, 2,500 s**, FFprobe OK; YAVG 65,45 → 90,09.
- Tests nuevos: 7 (1 esquema, 1 acción, 4 sampler/presets, 1 ASS).

## Addendum 2026-10-20 — Inicio y preparación del estudio

**Implementado**

- Nueva vista `home` como entrada inicial y primera del rail. El panel muestra
  yt-dlp, FFmpeg, FFprobe y SAPI, con acciones de instalación/cambio y contador
  `n/4`.
- `extension_status` y `prepare_extension`: localizan la extensión en recursos,
  repo o carpeta preparada, validan `manifest.json` y copian el árbol a
  `config/extension/editor-ia-downloader`. La UI abre la carpeta y muestra los
  pasos; el navegador exige confirmar “Cargar descomprimida”.
- `bundle.resources` incluye `extensions/editor-ia-downloader` en
  `extension/editor-ia-downloader` para instalaciones empaquetadas.
- Home incluye proyectos recientes y descarga rápida; no exige proyecto para
  pegar una URL.
- Se corrigió un test concurrente de freeze: narrowing explícito de `left` y
  `freeze` antes de leer `effects`/`blendMode`.

**Verificación (2026-10-20)**

- **625 tests Vitest en 62 archivos**; Rust **142 passed, 0 failed, 3 ignored**;
  typecheck, build y verify verdes. Entrada **472,11 kB JS**,
  `EditorWorkspace` **175,13 kB**, CSS **152,37 kB**.
- La app debug se recompiló y abrió. Se verificó visualmente Inicio a
  **1376×788**: `4/4 herramientas listas`, extensión “Disponible”, recientes y
  descarga rápida.

**Límites**

- No se rehizo el instalador NSIS. La instalación de la extensión sigue siendo
  guiada porque Chrome/Edge no permiten instalar descomprimidas sin confirmación
  del usuario.
- La preparación de la extensión se probó por test de copia y recursos; no se
  completó el paso manual de cargarla en un navegador durante esta pasada.

**Límites**

- Son **dos keyframes** (inicio/fin), no una pista de keyframes arbitraria ni
  keyframes de color/tipografía; el texto curvo sigue pendiente.
- El movimiento se ignora en subtítulos con más de una palabra para no pisar el
  resaltado/revelado por palabra.
- La preview usa una traslación relativa al span; el MP4 es la referencia.
- La UI no se recorrió a mano en la app release; el ASS se verificó con test y
  render live.

## Addendum 2026-10-21 — Destino de descargas y rail compacto

- **Descargar**: tarjeta **Guardar en** con disco, ruta completa, selector nativo
  de carpeta y **Usar predeterminada**. La elección se guarda en
  `localStorage` (`editor-ia.download-dir.v1`); Rust valida una carpeta absoluta
  existente y mantiene la estructura `<destino>/<Red>/<Nombre del video>` sin
  aplanar la biblioteca.
- **Rail**: 40 px de ancho, botones de 34 px (30 en compacto, 38 en amplio),
  iconos de 17 px, avatar de 24 px y separadores más cortos. El modo con
  etiquetas conserva su ancho configurable; los tooltips y `aria-label` siguen.
- **Loop**: la automatización local **Editor IA · mejora continua cada 30 min**
  elige una brecha medible, implementa, corre typecheck/Vitest/Rust/Playwright y
  documenta. No commitea, no pushea y no genera instaladores; se pausa tras tres
  fallos consecutivos.
- **Medición**: **627 tests Vitest en 62 archivos**; Rust **143 passed, 0 failed,
  4 ignored**; typecheck, build y verify verdes; entrada **472,47 kB JS**, CSS
  **153,10 kB**. Rail y Descargar verificados en la ventana nativa a 1376×788 y
  en Chromium; el diálogo nativo de carpeta se cubrió con validación Rust y el
  flujo simulado, no con un clic automatizado del selector del sistema.
