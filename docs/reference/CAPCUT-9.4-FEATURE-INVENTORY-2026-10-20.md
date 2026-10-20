# Inventario funcional de CapCut 9.4.0.4015 — 2026-10-20

> Objetivo: medir qué tiene CapCut antes de agregar funciones. Este documento
> describe **capacidades**, no copia código, assets ni la identidad visual de
> CapCut. Las implementaciones de Editor IA son propias y usan FFmpeg/ASS.

## Instalación analizada

- Ruta activa: `D:\Users\ofici\_Migrado_de_C\AppData\Local\CapCut\Apps\9.4.0.4015`
  (el acceso `C:\Users\ofici\AppData\Local\CapCut\Apps` es un junction).
- Versiones instaladas: 8.5.0.3590, 8.6.0.3667, 8.9.1.3802, 9.1.0.3879,
  9.2.0.3931 y **9.4.0.4015**.
- `videoeditor.dll`: 69.977.000 bytes. `VECreator.dll`: 261.796.264 bytes.
  `cccreator.dll`: 157.865.896. `lens.dll`: 88.502.184.
- Recursos: `Resources/` con 68 carpetas, incluidos `Curves`, `MixMode`,
  `Chroma`, `Chroma2`, `lut`, `mattingBlend`, `mattingBlendV2`, `matting_config`,
  `rnnoise`, `tts`, `lvop_intelligent_crop`, `models`, `lynx_config`,
  `aigc_text_template`, `builtin_skills`.

## Método y evidencia

- REA CLI 6.4.0, proveedor Ghidra 12.1.4.
- `rea analyze` sobre `CapCut.exe` 9.4.0.4015: SHA-256
  `eeb04ca72c0cb65a4894025414a7b808c1df0b22b2453bb5ce2486d849aadb97`,
  evidence ID `ev_5e5ae7e6076cde7a7902495fcef9f5e8b5cc1686272ea301463bc5268996f650`.
  Ver [`rea-capcut-940-2026-10-20.json`](capcut/rea-capcut-940-2026-10-20.json).
- `rea inspect-pe-resources` sobre `videoeditor.dll` **no completó**: REA impone
  un límite de 67.108.864 bytes y el DLL mide 69.977.000. Error registrado en
  [`rea-videoeditor-pe-2026-10-20.json`](capcut/rea-videoeditor-pe-2026-10-20.json).
- Para no inventar, el inventario funcional se extrajo con `strings` del
  `videoeditor.dll` (272.866 líneas) y de las carpetas/configs instaladas. Es
  evidencia estática del binario, no una prueba de que cada función esté
  habilitada para esta cuenta/región.
- Lista completa de **184 tipos de keyframe**:
  [`capcut/keyframe-types.txt`](capcut/keyframe-types.txt).
- **52 flags de downgrade/versionado**: [`capcut/feature-flags.txt`](capcut/feature-flags.txt).
- Cadenas funcionales seleccionadas: [`capcut/feature-strings.txt`](capcut/feature-strings.txt).

## Capacidades confirmadas por evidencia

### Timeline y edición

- Keyframes de transformación, opacidad, filtros, efectos, texto, máscaras,
  HSL, LUT, luz, fondo, borde, bloom, corner pin, chroma, audio panning y volumen
  (184 `KFType*`).
- **Curvas de velocidad** (`curve_speed`, `vimo curve_speed effect`).
- **Velocidad con curva** y keyframes; reverse; freeze; motion blur;
  **video tracking** y object lock.
- **Máscaras comunes** con feather, expansión, posición, rotación, tamaño,
  radio de esquina y keyframes (`common_mask`, `KFTypeCommonMask*`).
- **Transiciones solapadas** y de subpista (`overlap_transition`,
  `subtrack_transition`).
- **Composición de segmentos**, subvideos y límites de subvideo.
- **Beauty** facial/corporal con presets automáticos y "global video beauty
  preset"; body reshape; handwrite resources.
- **Deflicker**, **super resolution**, **interpolación**, **digital human**,
  gameplay y **object lock**.
- Importación desde **Premiere Pro / Final Cut Pro** (`pr_fcp_import`).

### Color e imagen

- **9 modos de mezcla** (`MixMode.json`): color filter, dark, bright, overlay,
  glare, soft light, linear deepening, darken color, color dodge, multiply.
- Ajustes: brillo, contraste, saturación, temperatura, tono, highlight, shadow,
  fade, vignetting, sharpen, HSL, black & white, **color match**, **color
  correct**, **smart color adjust**, **smart relight**, **curves**, **LUT** y
  **LUT skin**.
- **Chroma key** con spill, sombra, intensidad y borde suave (`Chroma2`).
- **Matting IA**: `ai_matting`, `ai_matting_gru`, `ai_matting_video_object`,
  `custom_matting`, `interactive`, `saliency_matting`, `quick_eraser`,
  `matting_stroke`.
- **Smart crop** (`lvop_intelligent_crop`) y detección de escenas
  (`SceneEditDetection`).
- Modelos locales: segmentación humana, pelo, manos, cara, depth, face GAN,
  face cluster/verify/fitting, interpolación, deflicker, beauty.

### Texto y subtítulos

- Plantillas de texto, plantillas de caption/lyrics, texto 3D, text shape,
  bloom, text curve, text mask, auto wrap, keyframes de estilo, AI text
  templates, handwrite, stickers/templates.
- Subtítulos automáticos, AI script subtitle, plantillas de letras.

### Audio

- **rnnoise v2.0** (modelo local), reducción de ruido, voice change, TTS local,
  audio metrics, beat matching y `jingying.agent.align_bgm_with_video`.
- Panning, volumen, fade, EQ/compresor (en el esquema de proyecto), ducking y
  loudness.

### IA y flujos asistidos

- `builtin_skills`: highlight, material understanding, script, speaker,
  align BGM with video, LVC.
- Digital human, article video, AIGC text templates, text-to-video, AI matting,
  smart relight, super resolution, smart crop.
- `DeepAgentsService.dll` (4,3 MB), `openvino.dll` (14,3 MB) y modelos locales.

### Exportación

- Perfiles sociales, HDR/10-bit (flags y códecs en el binario), watermark y
  publicación; no se detalla aquí porque depende de la cuenta y la nube.

## Matriz de brechas contra Editor IA

| Capacidad de CapCut | Evidencia | Editor IA hoy | Próximo paso |
|---|---|---|---|
| Keyframes de transformación/volumen | 184 KFType | **Sí**: escala/posición/rotación/opacidad/ganancia, easing y render | Añadir curvas Bézier libres |
| Curvas de velocidad | `curve_speed` | **Parcial**: rampa de 3 tramos contiguos | Curva continua con setpts/remuestreo |
| Reverse / freeze | `reverse`, `freeze` | **Parcial**: reverse y freeze por frame exportado | Congelado dentro del clip original |
| Voice change | `voice_change` | **Sí**: deep, aguda, robot, eco, cueva, radio | Más presets y pitch fino |
| Máscaras | `common_mask`, `matting` | **Sí**: rectángulo/elipse con posición, tamaño, rotación, feather, inversión y keyframes | Matting por IA |
| Modos de mezcla | `MixMode.json` (9) | **Sí**: 9 modos con `blend` y `mix-blend-mode` | Máscaras con modos no neutros |
| Ajustes HSL / color match / relight | `hsl`, `color_match`, `smart_relight` | **Sí**: HSL selectivo y color match; relight pendiente | Smart relight |
| LUTs `.cube` | `lut`, `lut-import` | **Sí**: importar a `media/luts` y `lut3d` | Intensidad/mezcla y LUTs por marca |
| Texto animado / plantillas | text templates, 3D | **Parcial**: negrita/itálica/caja/sombra, 7 plantillas de título, profundidad 3D y animaciones fade/pop/slide | Texto curvo/shape y lyrics |
| Subtítulos automáticos | AI script subtitle | **Sí** (Faster-Whisper local) | Plantillas y animación |
| Importar/exportar subtítulos | SRT/VTT | **Sí**: pegar y descargar SRT desde el Inspector | Importación por archivo nativo |
| Beat sync | `beat matching` | **Sí**: detección local de onsets y corte al ritmo | Más rejillas y confianza por sección |
| Animaciones de clip | `animation` | **Parcial**: fundido y deslizamiento de entrada/salida con duración y presets | Zoom, giro y curvas de animación |
| Smart crop / reframe | `lvop_intelligent_crop` | Parcial: crop centrado | Modelo de sujeto o face detection |
| Matting / background removal | `matting_config` + modelos | **No** | Modelo local (open-source) o API |
| Proxies / multicam / nested | flags y strings | **Parcial**: proxy 854 px generado y usado en preview | Multicam y timelines anidados |
| Beauty / body reshape | beauty models | **No** | Modelo local; fuera de alcance inmediato |
| Digital human / TTS cloud | `tts`, `digital_human` | TTS local SAPI/ElevenLabs | Voces locales y web manual |
| Super resolution / interpolation | `super_resolution`, `interpolation` | **No** | Modelo local/FFmpeg limitado |
| Importación PR/FCP | `pr_fcp_import` | **No** | Importador de XML/EDL |
| Export HDR/10-bit | flags | **No** | Evaluar FFmpeg y hardware |

## Implementado en este pase (lote 1)

- **Easing de keyframes** (`linear`, ease-in, ease-out, ease-in-out, hold) en
  schema, sampler, UI y render; incluye **opacidad animada** con `sendcmd`
  muestreado por frame.
- **Reverse** de clips de video/audio con `reverse`/`areverse`.
- **Voice effects** locales (deep, chipmunk, robot, echo, cave, radio).
- **Animación de títulos/subtítulos** (fade, pop, slide) en ASS.
- **Transiciones extra**: disolvencia, fundido a negro y deslizamiento
  horizontal.
- **Rampa de velocidad** de 3 tramos contiguos que conserva la duración y la
  ventana de origen, con rechazo explícito si hay keyframes o Ken Burns.
- **Máscaras básicas**: rectángulo y elipse con centro, tamaño, feather e
  inversión en schema, preview (`clip-path`) y render por píxel con `geq`.
  Todavía no tienen rotación ni keyframes.
- **Estilos de texto**: negrita, itálica, borde tipo contorno o caja con color de
  fondo, sombra y presets Creador/Caja/Minimal/Grande, además de las animaciones
  fade, pop y slide.
- **Igualar color**: muestrea 8×8 px del frame actual y del primer frame de otra
  imagen/video, normaliza el brillo y aplica ganancias por canal con
  `colorchannelmixer`, con fuerza ajustable.
- **9 modos de mezcla**: multiplicar, trama, superponer, luz suave, oscurecer,
  aclarar, sobreexponer/subexponer color y luz fuerte; preview con
  `mix-blend-mode` y render con `blend` sobre la capa inferior.
- **HSL selectivo**: tono, saturación e intensidad con rangos rojos,
  amarillos, verdes, cianes, azules y magentas, renderizado con
  `huesaturation` y lightness preservada.
- **Proxy de edición**: genera un MP4 H.264/AAC de hasta 854 px, lo guarda en
  `media/proxies` y lo usa sólo en la preview; el render final conserva el
  original.
- **Freeze frame**: extrae el frame exacto del playhead con FFmpeg, lo importa a
  Medios y lo monta como imagen de 2 s en una capa superior.
- **Ruedas de color** de sombras, medios y luces (RGB) con `colorbalance` y
  gamma de `eq`, en la pestaña Color.
- **LUT .cube**: importación a `media/luts`, validación de cabecera y render con
  `lut3d`.
- **184 KFType y 52 flags** inventariados; recurso de CapCut verificado con REA
  y strings.

## Lo que sigue (lote 2, no implementado todavía)

Máscaras con rotación/keyframes, 9 modos de mezcla, HSL/color match, curva de
velocidad continua, freeze frame, proxies, multicam, adjustment layers, beat
sync, smart reframe, matting por IA, beauty, super resolution y publicación.
Cada uno exige schema, preview, render, UI y tests; no se declaran como hechos
hasta medirlos.
