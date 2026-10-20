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
| Timeline | Speed ramps por keyframes, freeze frames | **No** |
| Timeline | Keyframes de transformación/opacidad/volumen | **No** |
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
| Video | Motion tracking, estabilización, smart reframe | **No** |
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
