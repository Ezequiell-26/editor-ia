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

## Addendum verificado al 2026-10-20 (pases 17–18)

Esta lista prevalece sobre las filas de la matriz que quedaron desactualizadas.
Se apoya en la suite completa de tests (512 Vitest; 112 Rust + 2 ignorados),
typecheck, build de Vite y renders FFmpeg en vivo.

**Agregado y verificado**

- **Look global del proyecto** (`look` en la raíz del `.editoria.json`): presets,
  brillo, contraste, saturación, temperatura, tono, curvas, viñeta, nitidez,
  desenfoque, B/N, sepia y **LUT `.cube` global**; preview sobre el compuesto y
  render antes de ASS. Los LUT por clip ya existían.
- **Menú contextual de timeline** accesible con teclado: dividir, duplicar,
  copiar/pegar, ir al inicio, eliminar y ripple delete.
- **Texto 3D** por extrusión de sombras ASS, con color de profundidad y preview.
- **Importación/exportación SRT/VTT** por pegado y descarga; subtítulos
  automáticos y animaciones de subtítulo.
- **Máscaras** rectangulares/elípticas con rotación, feather, inversión y
  keyframes interpolados en preview y render.
- **Transiciones** dissolve/fade/slide, animaciones de entrada/salida, Ken Burns,
  rampas y curvas de velocidad, freeze, estabilización, chroma key y suite de
  audio/loudness.

**Sigue faltando para paridad completa**

- Capas de ajuste y ajustes por tramo sobre la timeline.
- LUT skin; highlight/shadow/fade por separado (el `.cube` está por clip y en el
  look global).
- Smart reframe, matting IA, beauty, super resolution e interpolación.
- Multicam, timelines anidadas y grupos; slip/slide/roll completos.
- Bins con búsqueda/favoritos y selector nativo de archivo SRT.
- Stock/música con licencias y publicación programada a redes.
- Texto con forma, letras/lyrics y keyframes de estilo.

## Matriz de paridad

Leyenda: **Sí** = existe y está probado; **Parcial** = existe una parte;
**No** = no existe todavía.

| Área | Función de referencia | Editor IA |
| --- | --- | --- |
| Proyecto | Formato de proyecto versionado, autosave, recientes, portabilidad | **Sí** |
| Medios | Importación no destructiva, hash, medición, licencias | **Sí** |
| Medios | Bins, búsqueda, filtros, favoritos, metadatos editables | **No** |
| Medios | Proxy / medios optimizados, relink, transcodificación | **No** |
| Timeline | Multipista, trim, split, move, zoom, playhead | **Sí** |
| Timeline | Ripple/roll/slip/slide, snapping magnético, grupos, nesting | **Parcial**: ripple al cambiar velocidad; sin snapping ni grupos |
| Timeline | Velocidad uniforme y ripples | **Sí** (esta pasada) |
| Timeline | Speed ramps por keyframes, freeze frames | **Parcial**: rampa de 3 tramos, curva suave de 6–16 tramos y freeze frame; sin curva por keyframe ni función continua por frame |
| Timeline | Keyframes de transformación/opacidad/volumen | **Sí**: escala, desplazamiento, rotación, opacidad y ganancia con UI y render (2026-10-20) |
| Timeline | Beat sync: cortar el video al pulso de la música | **Sí**: detección local por energía y UI en el Inspector del audio (2026-10-20) |
| Timeline | Transiciones reales (crossfade, dip, slide, etc.) | **Parcial**: fades de entrada/salida y transición automática entre fotos; sin crossfade solapado |
| Timeline | Movimiento automático de fotos (Ken Burns) | **Sí** (esta pasada) |
| Timeline | Auto-montaje con movimiento y transiciones | **Sí** (esta pasada) |
| Timeline | Marcadores, capítulos, colores de clip | **No** |
| Video | Transformación posición/escala/rotación/opacidad | **Sí** |
| Video | Ajustes de color básicos (brillo/contraste/saturación/temperatura/viñeta) | **Sí** (esta pasada) |
| Video | Nitidez, desenfoque, blanco y negro, sepia | **Sí** (esta pasada) |
| Video | Curvas, ruedas primarias/log, HSL, qualifiers, LUTs | **No** |
| Video | Blend modes, máscaras, track matte | **No** |
| Video | Chroma key, matting/background removal | **Parcial**: chroma key por color; sin matting/segmentación IA |
| Video | Motion tracking, estabilización, smart reframe | **Parcial**: estabilización local con `vidstab` en clips a 1× sin reverse ni transición de entrada; sin motion tracking ni smart reframe (2026-10-20) |
| Video | Efectos/transiciones de biblioteca, stickers, títulos | **Parcial**: subtítulos; sin biblioteca de efectos |
| Audio | Ganancia, fades, mezcla, tracks de narración | **Sí** |
| Audio | Ducking automático | **Parcial**: el esquema lo declara; falta flujo de UI/render completo |
| Audio | EQ, compresor, noise reduction, voice isolation, loudness | **Parcial**: EQ 3 bandas, high/low-pass, compresor, `afftdn` y loudnorm; sin voice isolation por modelo |
| Audio | Loudness ITU/YouTube | **Sí** (loudnorm a una pasada, aproximado) |
| Audio | TTS local | **Sí** (SAPI) |
| Audio | TTS de proveedor / web externa | **Parcial**: ElevenLabs por API oficial y web externa manual; sin automatizar sitios de terceros |
| Audio | Clonación de voz | **No** |
| Publicación | Manifiesto de derechos, hashes y procedencia | **Sí** (esta pasada) |
| Entrega | Perfiles 16:9/9:16/1:1 | **Sí** |
| IA | Guion estructurado con proveedor o mock | **Sí** |
| IA | Auto captions / subtítulos desde escenas | **Sí**: desde guion y transcripción local Faster-Whisper con palabras/tiempos |
| IA | Detección de escenas, análisis visual CLIP, smart reframe | **Parcial**: detección de escenas local con FFmpeg; sin CLIP ni smart reframe |
| IA | Generación de imágenes dentro del editor | **No**: vive en la extensión Flow Queue |
| Entrega | Perfiles 16:9/9:16, MP4 H.264/AAC, subtítulos quemados | **Sí** |
| Entrega | Exportación en lote a una carpeta | **Sí** (esta pasada) |
| Entrega | Presets sociales, HDR, hardware encode, publicación | **No** |
| Entrega | Render atómico y verificación FFprobe | **Sí** |
| Extras | Flow Queue: prompts, referencias, descarga y manifiesto | **Sí** (referencias manuales) |
| Extras | Lotes, escenas automáticas, TTS, auto-montaje | **Sí** |

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
