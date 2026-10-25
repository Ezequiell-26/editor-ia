# Gestión de color HDR/10-bit y grafo DAG de VFX — diseño técnico (2026-10-24)

Proyecto: Olyvia (Tauri + React + Rust + FFmpeg). Rama `feat/motion-graphics`, árbol limpio en `ad08a95` (dato del encargo; no se ejecutó `git` para verificarlo, está prohibido en este pase).

Alcance de este documento: **solo investigación y diseño**. No se tocó código, tests ni otros docs. Las propuestas de esquema y módulos se describen aquí; su implementación queda para fases posteriores.

---

## 0. Resumen ejecutivo

1. **El pipeline actual es 8-bit de extremo a extremo**: el grafo termina siempre en `format=yuv420p[vout]` (`apps/desktop/src-tauri/src/render/ffmpeg.rs:3335`) y fuerza `-pix_fmt yuv420p` (`ffmpeg.rs:3380-3382`). Las cadenas por clip trabajan en `rgba` 8-bit (`ffmpeg.rs:2721`).
2. **El FFmpeg embebido ya trae todo lo necesario para un MVP 10-bit**: verificamos contra el binario real (`apps/desktop/src-tauri/resources/ffmpeg/ffmpeg.exe`, versión 9.0.2-essentials gyan.dev) que `libx265` y `libx264` aceptan `yuv420p10le`, que `hevc_amf`/`h264_amf` aceptan `p010le` y que `hevc_amf` expone `-profile main10`. Los filtros de color (`curves`, `colorbalance`, `colorlevels`, `lut3d`) negocian `gbrp10le`, `chromakey` negocia `yuva420p10le`, y `zscale` (zimg) y `tonemap` están disponibles para tonemapping HDR→SDR.
3. **Hay dos restricciones duras verificadas**: el filtro `overlay` degrada cualquier entrada profunda a `yuva420p` (8-bit con alfa), y el binario **no** incluye `libplacebo` ni el filtro `ocio` (OpenColorIO). Por lo tanto: el compositing con alfa seguirá siendo 8-bit en fases intermedias, y ACES real requiere reempaquetar FFmpeg o resolverlo con LUTs `.cube` (ruta verificada en 10-bit).
4. **El VFX actual es una cadena lineal fija de 6 tarjetas por clip** (`apps/desktop/src/features/vfx/VfxView.tsx:340-566`) que refleja un orden de render hardcoded, no un grafo. La propuesta evoluciona eso a un **DAG de nodos con puertos imagen/máscara**, compilado en Rust a `filter_complex` por orden topológico, reutilizando los helpers que ya existen.
5. **Riesgo nº 1 del DAG**: el tamaño de `filter_complex` (límite de línea de comando en Windows ≈ 32 767 caracteres). Se mitiga fusionando cadenas lineales con comas, poniendo tope de nodos por grafo (precedente: `MAX_TRANSFORM_KEYFRAMES`, `packages/project-schema/src/timeline.ts:59`) y pre-renderizando subgrafos como intermediarios.

---

## 1. Estado actual del código (evidencia leída)

### 1.1 Esquema de datos (`packages/project-schema`)

**Nota sobre el encargo**: se pidió estudiar `packages/project-schema/src/effects.ts`; ese archivo **no existe** en el árbol (verificado con `find packages apps -name "effects.ts" -not -path "*/node_modules/*"` → sin resultados). El esquema de efectos vive en `packages/project-schema/src/timeline.ts` y su test (`effects.test.ts`) lo prueba importando `ClipSchema` desde `./timeline.js`.

Lo que existe hoy:

- **`ClipEffectsSchema`** (`timeline.ts:271-408`): color (brightness/contrast/saturation/temperature/shadows/highlights/fade), ruedas primarias lift/gamma/gain/offset (por canal RGB, `timeline.ts:280-316`), HSL selectivo (`timeline.ts:317-329`), colorMatch, vignette, lensCorrection, relight radial, sharpen/blur, glow, motionBlur, grayscale/sepia/hueRotate, presets de curva, **curvas custom por canal master/R/G/B** (`ClipCurvesSchema`, `timeline.ts:204-269`, máx. 16 puntos con anclaje negro/blanco obligatorio) y **`lutFile` + `lutIntensity`** (`timeline.ts:403-404`).
- **Máscaras**: `ClipMaskSchema` con formas rectangle/ellipse/diamond/triangle/rounded/polygon/text, feather, invert, keyframes animables (`timeline.ts:476-526`; tope `MAX_MASK_KEYFRAMES = 32` en `timeline.ts:438`).
- **Chroma**: `ChromaKeySchema` color/similarity/blend (`timeline.ts:417-423`).
- **Blend de capa**: `BlendModeSchema` con 9 modos (`timeline.ts:425-436`), aplicable por clip (`timeline.ts:630`, `656`).
- **Clips y pistas**: tipos de clip video/image/audio/graphic/freeze/adjustment/compound (`timeline.ts:26-34`); el clip de **ajuste** grada el compuesto dentro de su ventana sin poseer medio (`timeline.ts:196-202`, `689-696`); los compound se aplanan sin anidación (`timeline.ts:698-710`). Hard caps documentados como defensa del argv (`timeline.ts:58-62`).
- **Look global del proyecto**: `project.look` es un `ClipEffectsSchema` (`packages/project-schema/src/project.ts:124`), aplicado a todo el compuesto.

### 1.2 UI de VFX (`apps/desktop/src/features/vfx/VfxView.tsx`)

- Vista "VFX y rotoscopía" con un clip seleccionado y una **cadena vertical fija de 6 tarjetas**: 01 Entrada → 02 Chroma → 03 Roto (polígono) → 04 Color (brillo/contraste/saturación) → 05 Detalle (sharpen/blur) → 06 Salida (`VfxView.tsx:340-566`). El texto de la propia UI lo reconoce: "Cadena lineal de nodos para un clip … El orden refleja el render real" (`VfxView.tsx:224-226`).
- El orden de las tarjetas está **hardcodeado en el JSX**, no derivado de datos: no se puede reordenar, duplicar ni conectar libremente; no hay merges ni capas.
- El visor es un `<video>`/`<img>` HTML más un `<svg>` de superposición para el polígono (`VfxView.tsx:274-322`): el preview **no pasa por la cadena de filtros**, solo edita máscara y muestrea el frame por tiempo (`VfxView.tsx:78-90`).
- Incluye seguimiento facial → keyframes de máscara vía `analyzeFaceTrack` (`VfxView.tsx:187-216`).

### 1.3 Scopes (`apps/desktop/src/features/editor/scopes.ts`)

- Muestreo del frame del preview dibujado en un canvas offscreen; histogramas y waveform con **256 niveles** y vectorescopio 64×64 (`scopes.ts:1-60`): es 8-bit por definición del canvas RGBA. La UI del panel ofrece Onda/Vectores/Hist./Parade (`ScopesPanel.tsx:18-21`).

### 1.4 Grafo de render (`apps/desktop/src-tauri/src/render/ffmpeg.rs`, 7 778 líneas)

Cómo se compone `filter_complex` hoy (`build_plan_range`, `ffmpeg.rs:2563-3420`):

1. **Base**: input 0 es un `color=c=<fondo>:s=WxH:r=FPS:d=DUR` de lavfi y el primer segmento fija el formato de trabajo: `[0:v]format=rgba,setpts=PTS-STARTPTS[base0]` (`ffmpeg.rs:2707-2722`). Todo el compositing ocurre en **rgba 8-bit**.
2. **Orden de capas**: los clips visuales se ordenan por `(track.order, startFrame)` (`ffmpeg.rs:2744-2748`) — la "multicapa" actual es la pila de pistas de la timeline, no un grafo.
3. **Cadena por clip**: `visual_filter()` (`ffmpeg.rs:1576-2240`) emite una cadena lineal por clip: `fps`, `reverse`, zoompan (Ken Burns), scale/crop por `fit`, escalado de transform, keyframes de transform, chromakey (`ffmpeg.rs:1746-1748`), máscara (`mask_filter`, `ffmpeg.rs:1165`), y grade (`grade_filters`, `ffmpeg.rs:1393-1556`: `eq` para brightness/contrast/saturation/gamma RGB + `colorbalance` para lift/offset/gain). Encima se inyectan, mutando la cadena: estabilización (`with_stabilization`, `ffmpeg.rs:906`), **LUT con intensidad** (split + `blend=all_mode=normal:all_opacity`, `apply_lut_to_chain`, `ffmpeg.rs:754-781`; `lut3d=file='…'` con escape de `:` en `ffmpeg.rs:742-748`) y **glow** (split 3 + colorlevels + gblur + screen + alphamerge, `apply_glow_to_chain`, `ffmpeg.rs:786-807`).
4. **Composición de capa**: cada clip se compone sobre la base con `overlay=x:y:enable='between(t,…)'` (`ffmpeg.rs:2948-2952`), o, si el clip declara `blendMode`, se inserta un input lavfi negro transparente como "capa" y se usa `blend=all_mode=<modo>` (`ffmpeg.rs:2807-2826`, `2933-2946`; mapa de modos en `blend_mode_name`, `ffmpeg.rs:569-585`).
5. **Look global**: `project_look_filters` + LUT del look aplicados al resultado final (`ffmpeg.rs:3306-3322`), luego burn del ASS de motion (`ffmpeg.rs:3324-3333`), captions ASS (`ffmpeg.rs:3334-3346`).
6. **Cierre 8-bit**: `format=yuv420p[vout]` (`ffmpeg.rs:3335`, `3344`), `-map [vout]`, encoder software `libx264`/`libx265` o hardware, y `-pix_fmt yuv420p` obligatorio (`ffmpeg.rs:3348-3382`). El join final es `filters.join(";")` como un único `-filter_complex` (`ffmpeg.rs:3348-3349`). No se emiten tags de color (`--color_primaries/--color_trc/colorspace/color_range` no aparecen en el archivo; verificado por grep sin resultados).

### 1.5 Export GPU AMF

- Encoders permitidos: `h264_amf | h264_nvenc | h264_qsv` y `hevc_amf | hevc_nvenc | hevc_qsv` (`ffmpeg.rs:46-47`); `validate_hardware_encoder` valida códec y techo de resolución: 4 096 px por lado en H.264 y 8 192 en H.265 (`ffmpeg.rs:49-75`).
- Argumentos AMF: `-rc cqp -qp_i Q -qp_p Q -quality quality` (`hardware_encoder_args`, `ffmpeg.rs:240-272`); NVENC usa `-rc vbr -cq`, QSV `-global_quality`. El perfil llega por `hardwareEncoder` del JSON de render (`ffmpeg.rs:206-209`). Todo 8-bit hoy: el `-pix_fmt yuv420p` global manda.
- Tests Rust que fijan este comportamiento (romperán si cambia la cadena): AMF CQP (`ffmpeg.rs:4807-4811`), AMF por bitrate (`ffmpeg.rs:4828-4831`), parseo de perfil AMF (`ffmpeg.rs:4847-4868`).

---

## 2. Verificación ejecutada contra el FFmpeg embebido

Binario: `apps/desktop/src-tauri/resources/ffmpeg/ffmpeg.exe` — `ffmpeg version 9.0.2-essentials_build-www.gyan.dev`, compilado con `--enable-libzimg --enable-amf --enable-libx264 --enable-libx265 …` y **sin** `--enable-libplacebo` ni soporte OCIO (leído de `-version`). Comandos ejecutados durante este pase (ninguno escribe en el repo; el LUT de prueba se creó y borró en `%TEMP%`):

### 2.1 Encoders (¿aceptan 10-bit?)

Comando: `ffmpeg -hide_banner -h encoder=<enc> | grep "Supported pixel formats"`.

| Encoder | Formatos relevantes | Veredicto |
|---|---|---|
| `libx264` | … `yuv420p10le yuv422p10le yuv444p10le nv20le …` | 10-bit OK (perfil High10; reproducción hardware limitada) |
| `libx265` | … `yuv420p10le yuv422p10le yuv444p10le … yuva420p10le` | 10-bit OK (Main 10) |
| `hevc_amf` | `nv12 yuv420p d3d11 dxva2_vld p010le amf … rgbaf16le` | 10-bit OK vía **p010le** |
| `h264_amf` | mismos que hevc_amf, incluido `p010le` | acepta p010le (calidad 10-bit de entrada; perfil H.264 no cambia a High10) |

Además, `-h encoder=hevc_amf` lista `-profile main10` (valor `2`) y `-quality high_quality` (`15`). Conclusión: **AMF 10-bit Main10 es factible hoy, sin recompilar nada**: `-c:v hevc_amf -profile:v main10` con entrada `p010le`. NVENC/QSV no se inspeccionaron en detalle (pendiente si se quiere 10-bit en NVIDIA/Intel).

### 2.2 Filtros de la cadena actual (¿conservan 10-bit?)

Comando por filtro: `ffmpeg -hide_banner -v verbose -f lavfi -i "testsrc2=duration=0.1:size=64x64:rate=30" -vf "format=yuv420p10le,<filtro>" -pix_fmt yuv420p10le -frames:v 1 -f null -` (y para `overlay`/`blend`, variantes `-filter_complex` con dos entradas). Las líneas `auto_scale_* @ … fmt:X -> fmt:Y` del log revelan las conversiones insertadas:

| Filtro (usado hoy en ffmpeg.rs) | Negociación observada | Consecuencia |
|---|---|---|
| `curves` (1321) | `yuv420p10le → gbrp10le → yuv420p10le` | ✅ conserva 10-bit (procesa en RGB planar 10) |
| `colorbalance` (1458) | `gbrp10le` ida y vuelta | ✅ conserva 10-bit |
| `colorlevels` (glow, 803) | `gbrp10le` ida y vuelta | ✅ conserva 10-bit |
| `chromakey` (1748) | `yuva420p10le` ida y vuelta | ✅ **chroma en 10-bit con alfa** |
| `gblur` (glow, 803) | sin conversión intermedia | ✅ conserva 10-bit |
| `lenscorrection`, `noise` (16-bit interno) | sin degradación a 8 | ✅ |
| `zscale` (disponible) | entrada elevada a `yuv420p10le` | ✅ pilar del pipeline 10-bit |
| **`eq`** (grade_filters, 1441) | `10le → yuv420p (8) → 10le` | ❌ **degrada a 8-bit** |
| **`vignette`** | `10le → yuv420p (8) → 10le` | ❌ degrada a 8-bit |
| **`overlay`** (núcleo del compositing, 2949) | `yuv420p10le → yuva420p (8-bit alfa)` en ambas entradas; también degrada `gbrap16le` y `yuva444p16le` a `yuva420p` | ❌ **el compositing con alfa es 8-bit como máximo en FFmpeg 9 stock** |
| `blend` (2943, LUT intensity 778, glow 804) | acepta `yuv420p10le` sin conversión | ✅ conserva 10-bit |
| `lut3d` (747) | `yuv420p10le → gbrp10le → yuv420p10le` (probado con un `.cube` mínimo) | ✅ LUTs en 10-bit |

Implicaciones de diseño directas:

- Un **MVP 10-bit es posible hoy** manteniendo el merge en `overlay` (8-bit, igual que ahora): la ganancia de calidad está en las cadenas de color por clip y en el encode final 10-bit. Es el mismo compromiso que el "compositing híbrido" que proponemos en §4.2.
- `eq` y `vignette` deben sustituirse por equivalentes 10-bit (`curves`/`colorlevels` para brillo/contraste/saturación; vignette radial vía `gblur`+`blend` o curvas) en las fases 10-bit.
- El compositing 10-bit con alfa **no se puede lograr con `overlay`**; requiere composición manual (p. ej. `blend` matemático con alfa extraído — no verificado en este pase), un build propio de FFmpeg, o un compositor propio en fase Pro (§8).

### 2.3 Tonemapping y espacio de color

- `zscale` (zimg, `--enable-libzimg` presente) y `tonemap` (swscale, sin dependencias) están disponibles: `-h filter=zscale` y `-h filter=tonemap` los listan. La cadena clásica HDR→SDR `zscale=t=linear:npl=…,tonemap=<algoritmo>,zscale=t=bt709:m=bt709:r=tv,format=yuv420p` es viable (fuentes en §9).
- `-h filter=zscale` confirma transferencias `linear`, `smpte2084` (PQ) y `arib-std-b67` (HLG) (8 menciones combinadas) y **cero** menciones de ACES (`grep -i -c aces → 0`): zimg no aporta la log de ACEScct, por lo que un espacio de trabajo ACES real no puede montarse solo con `zscale` (ver §4.4).
- `libplacebo`: `ffmpeg -h filter=libplacebo → Unknown filter`. Su tonemapping superior queda fuera del MVP salvo reempaquetado del binario.
- `colorspace` (conversión entre espacios) también está disponible.

---

## 3. Qué modelan los referentes (investigación web)

### 3.1 DaVinci Resolve — node graph de la página Color

Fuentes: [Frame.io — DaVinci Resolve's Most Useful Nodes](https://blog.frame.io/2023/05/22/davinci-resolve-most-important-nodes-serial-parallel-outside/) (leído completo), [DaVinci Resolve Club — Serial vs Parallel vs Layer](https://davinciresolveclub.com/davinci-resolve-nodes-explained), [Mixing Light — Parallel y Layer Mixer](https://mixinglight.com/color-grading-tutorials/davinci-resolve-parallel-layer-mixer-nodes) (resúmenes de búsqueda).

- Un nodo es "una idea visual que queremos aplicar a la imagen"; el grafo vive junto al viewer y cada clip lleva su propio grafo (plantilla reutilizable vía *Apply Grade*).
- **Serial**: nodos en secuencia; la salida de uno alimenta al siguiente (el orden es el de evaluación).
- **Parallel**: varias ramas parten de la misma imagen inicial y un **Parallel Mixer** promedia sus salidas; sirve para separar primarios (imagen completa) de secundarios (una porción).
- **Layer Mixer**: como Parallel pero con **prioridad de capa** (la de arriba gana) — es el análogo directo de un *merge* multicapa.
- **Outside node**: invierte la alfa/máscara del nodo anterior conectada por una **línea punteada** — es decir, los nodos tienen **dos clases de conexión: imagen y key/máscara**.
- Gestión de color: además del node graph, Resolve tiene su propio sistema (RCM, con *DaVinci Wide Gamut Intermediate* como espacio de trabajo de timeline que normaliza mezclas SDR/HDR) y soporte ACES según Blackmagic ([página oficial Color](https://www.blackmagicdesign.com/products/davinciresolve/color)); comparativa RCM vs ACES en [Frame.io](https://blog.frame.io/2024/02/12/davinci-resolve-color-management-vs-aces-which-should-you-choose) y detalle técnico en [Mononodes](https://mononodes.com/color-management-in-davinci-resolve) (no pudimos leer la página completa de Mononodes: la consulta fue cancelada; se cita por el resumen de búsqueda).

**Lecciones para Olyvia**: (1) separar la cadena de color de las operaciones de composición; (2) modelar conexiones de dos clases (imagen y máscara); (3) un "merge" con prioridad de capa es el nodo que unifica los casos de overlay y blend modes; (4) un espacio de trabajo intermedio y único simplifica mezclar fuentes dispares.

### 3.2 Olive — node system (DAG)

Fuentes: [Olive wiki — Nodes](https://github.com/olive-editor/olive/wiki/Nodes) (leído), [Olive wiki — Design Architecture DAG](https://github.com/olive-editor/olive/wiki/Design-Architecture-DAG) (leído), [sitio oficial](https://olivevideoeditor.org/) (en pausa, "Olive will return").

- Olive 0.2 es **enteramente node-based**: no hay "efectos de clip" sino nodos categorizados — Input (Video Input, Audio Input, Time), Blend (Alpha Over), Distort (Transform), Stylize (Drop Shadow, Stroke), Generator (Solid), Output (Track, Viewer), etc.; los efectos se escriben en GLSL y se combinan (bloom = composición de nodos).
- La wiki de arquitectura describe el DAG con vértices que reciben el TimeCode del playhead: flujo `Playhead In (TC, Image) → Process Out → Processing In → process() → Playhead Out (TC, Image)` por cada vértice, y **cache de imagen en el Playhead Out del vértice superior del canal**. Existen página interna "Research Node Types" y "Reference Shader Syntax".

**Lecciones para Olyvia**: (1) un nodo es una unidad evaluable con entrada/salida tipada y el mismo modelo sirve para timeline y efectos; (2) cachear por nodo (o por subgrafo) es la clave del rendimiento en interacción; (3) en FFmpeg no hay cache incremental — el análogo práctico es pre-render de subgrafos a intermediarios cuando el grafo crece (§8).

---

## 4. Propuesta A — gestión de color 10-bit / HDR / ACES

### 4.1 Objetivo y premisas

- Objetivo MVP: **pipeline 10-bit real** para el grade por clip y el export (H.265 Main10 software y AMF Main10 hardware), sin cambios de infraestructura (mismo binario FFmpeg embebido).
- Objetivo fase siguiente: ingest y mezcla de material HDR (PQ/HLG) con tonemapping determinista a SDR, y tags de color correctos en el MP4/MOV.
- ACES completo: **no es alcanzable con el binario actual** (sin filtro `ocio`, sin transferencias ACES en `zscale` — verificado §2.3). Se proponen dos rutas (§4.4).
- El canvas de preview (scopes) seguirá siendo 8-bit en las primeras fases: `HTMLCanvasElement` entrega RGBA8 (`scopes.ts:1-13`); scopes 10-bit reales requieren decodificar frames con FFmpeg en Rust (fase 4).

### 4.2 Fases

**C0 — Perfil de render 10-bit (fundación, ~2-3 d)**
- Schema de delivery (`packages/project-schema/src/delivery.ts` y el `Profile` de `ffmpeg.rs:130-238`): nuevo campo `bitDepth: 8 | 10` (default 8; proyecto existente sin migración).
- Compilador: si `bitDepth=10` y códec `h265` → cadena final `format=yuv420p10le[vout]` y `-pix_fmt yuv420p10le`; H.264 10-bit se permite solo software con advertencia de compatibilidad de reproducción.
- UI de export: selector "Profundidad de bits" (Español) con nota de compatibilidad.

**C1 — Cadena por clip en 10-bit (~5-8 d)**
- Cambiar el formato de trabajo por clip de `format=rgba` a `format=gbrp10le` para la parte RGB de color (curvas/LUT/colorbalance/colorlevels ya lo negocian, §2.2) y `yuv420p10le` para la parte YUV (chromakey, gblur).
- Sustituciones obligatorias cuando `bitDepth=10`: `eq` → combinación `colorlevels`+`curves` (equivalencia brightness/contrast/saturation a mapear y testear); `vignette` → gradiente radial propio (`geq`/`vignette` alternativas a verificar en 10-bit). El resto de la cadena (LUT, glow, chroma) ya negocia 10-bit.
- El merge sigue en `overlay` (8-bit alfa) — **de documentarse en UI/docs** como "compositing híbrido 10/8" en esta fase; no empeora lo existente.
- Encoders: H.265 → `yuv420p10le`; AMF → `format=p010le` + `-profile:v main10` extendiendo `hardware_encoder_args` (`ffmpeg.rs:240-272`); validar en `validate_hardware_encoder` que 10-bit solo se ofrezca con códec h265+AMF (o software).
- Tests: los snapshots de texto del plan (p. ej. `ffmpeg.rs:4807-4811`) se actualizan; se añade un test de integración live 10-bit (320×180) verificando con ffprobe `pix_fmt=yuv420p10le`.

**C2 — HDR ingest + tonemapping (~8-12 d)**
- Probing de assets: capturar `color_transfer/primaries/space` con ffprobe (el puente ya existe: `probe_output` `ffmpeg.rs:3479`, `has_audio_stream` `ffmpeg.rs:287`) y guardarlos en `asset.media`.
- Normalización a un espacio de trabajo único (premisa de RCM/DWG-Intermediate y de ACES): fuentes HDR (PQ/HLG) se linealizan con `zscale=t=linear:npl=…`, se gradúan, y se tonemapean a la salida del proyecto (`tonemap=hable|bt2390` + `zscale=t=bt709` para SDR). Fuentes SDR pasan tal cual (con `zscale` para igualar primaries BT.2020 si se mezclan).
- Tags de color en el mux (`-color_primaries/-color_trc/-colorspace/-color_range`) según el objetivo del perfil (SDR 709 / HDR10 passthrough). Hoy no se emiten (grep vacío, §1.4).
- Escopes honestos: fase opcional de scopes 10-bit decodificando el frame en Rust (rawvideo 16-LE) y ampliando `scopes.ts` de 256→1024 niveles con compat de UI.

**C3 — ACES (~3-5 d la ruta LUT; ~5-10 d + mantenimiento la ruta OCIO)**
- **Ruta recomendada (LUT)**: paquete `.cube` de transformaciones ACES (IDT rec709→ACEScct, ODT ACES→rec709/sRGB) aplicados con `lut3d`, que ya procesa en `gbrp10le` (§2.2). Limitación honesta: interpolación LUT, no transformadas exactas; suficiente como look de referencia "ACES-like".
- **Ruta Pro (OCIO)**: reempaquetar FFmpeg con OpenColorIO para usar el filtro `ocio` con config ACES 1.3; implica CI de binarios (Windows/macOS/Linux), versionado del recurso embebido y detección de capacidades en runtime (`commands/capabilities.rs`).

### 4.3 Impacto (color) por capa

| Capa | Cambio |
|---|---|
| Schema | `bitDepth` en delivery; `colorTransfer/primaries/space` en `asset.media`; nada en `ClipEffects` (los parámetros de grade no cambian) |
| Render | formatos de trabajo por profundidad; sustitución eq/vignette; `hardware_encoder_args` con main10/p010; tags de color; tonemapping condicional |
| Preview | sin cambio inmediato (canvas 8-bit); opcional: badge "HDR→SDR" y scopes 10-bit |
| UI | selector de profundidad y "espacio de color" en export; indicadores por asset (HDR/SDR) en Medios |
| Docs/AYUDA | nota de compatibilidad H.264 High10 vs HEVC Main10 |

### 4.4 Riesgos (color)

- **`overlay` 8-bit** (verificado §2.2): el MVP 10-bit compone igual que hoy; la banda de diferencia real está en el grade y el encode. Si se exige 10-bit con alfa: compositor propio o build FFmpeg custom (ver fase P2 en §5).
- **H.264 High10** no se reproduce en la mayoría de hardware de TV/móvil: restringir a "archivo maestro", no a entrega.
- **AMF 10-bit** verificado en el binario pero **dependiente de GPU AMD y driver**; el chequeo de capacidades debe ejecutarse en runtime (encuesta `hevc_amf` con un render de 1 frame).
- **NVENC/QSV 10-bit**: no verificado en este pase; marcado como trabajo previo a habilitar el selector en esos encoders.
- **Sustituciones de `eq`**: cambiar el motor de brightness/contrast/saturation cambia resultados píxel a píxel en proyectos viejos si se activa 10-bit; aceptable si es opt-in por perfil de export.
- **Tonemapping sin libplacebo**: `tonemap`+`zscale` es correcto pero inferior a libplacebo en picos/estabilidad; documentar y considerar reempaquetado en fase Pro.

---

## 5. Propuesta B — VFX como grafo DAG de nodos

### 5.1 Modelo de datos del grafo (diseño de esquema, sin implementar aquí)

Nuevo módulo en `packages/project-schema` (propuesta de nombre: `vfx-graph.ts`), strict zod, en el espíritu de `timeline.ts`:

```ts
// Tipos de puertos: imagen (YUV/RGB con o sin alfa), máscara (alfa monocanal) y escalar.
VfxPortKindSchema = z.enum(['image', 'mask', 'value']);

VfxEdgeSchema = z.object({
  id: EntityIdSchema,
  from: z.object({ nodeId: EntityIdSchema, port: z.string() }).strict(),
  to:   z.object({ nodeId: EntityIdSchema, port: z.string() }).strict(),
}).strict();

VfxNodeSchema = z.discriminatedUnion('type', [
  // Cada variante define: id, label opcional, enabled, position (x/y de UI),
  // y params propios con hard caps como los de timeline.ts:58-62.
  { type: 'source', source: z.discriminatedUnion('kind', [ /* clip | asset | fondo */ ]) },
  { type: 'color-wheels', lift/gamma/gain/offset r/g/b … },
  { type: 'curves', master/red/green/blue: CurvePointSchema[] … },   // reutiliza timeline.ts:213-219
  { type: 'lut', file: string, intensity: UnitIntervalSchema },       // reutiliza lutFile/lutIntensity
  { type: 'chroma-key', color/similarity/blend },                     // reutiliza ChromaKeySchema
  { type: 'mask', shape/x/y/width/height/feather/invert/points/… },   // reutiliza ClipMaskSchema
  { type: 'blur' | 'sharpen' | 'glow' | 'motion-blur' | 'vignette' | 'lens' | 'relight', … },
  { type: 'transform', offsetX/Y, scale, rotation, opacity, keyframes? },
  { type: 'merge', mode: 'over' | BlendModeSchema, opacity, maskPort? },   // el "Layer Mixer" de Olyvia
  { type: 'output' },
]);

VfxGraphSchema = z.object({
  id: EntityIdSchema,
  label: string,
  nodes: z.array(VfxNodeSchema).min(1).max(64),
  edges: z.array(VfxEdgeSchema).max(128),
}).strict().superRefine(validarGrafo); // ver reglas abajo
```

**Reglas de validación del grafo** (equivalentes a las invariantes de `timeline.ts`): exactamente un nodo `output`; sin ciclos (el toposort falla → error de esquema, no de render); cada puerto `image` recibe a lo sumo una arista (salvo `merge`, que declara dos entradas: `base` y `layer`, más `mask` opcional); puertos `mask` solo conectan desde nodos máscara; ids únicos; tope de nodos (64) y aristas (128) para acotar el `filter_complex` (mismo criterio que `MAX_TRANSFORM_KEYFRAMES`, `timeline.ts:59`, y `MAX_MASK_KEYFRAMES`, `timeline.ts:438`).

**Puertos y semántica**:

- `image`: flujo principal de píxeles (equivale a las líneas verdes de imagen de Resolve).
- `mask`: alfa monocanal que poda la acción del nodo destino — implementado en FFmpeg como split + `maskedmerge`/`blend` con la máscara (técnica ya usada por glow: split+alphamerge, `ffmpeg.rs:786-807`; y por LUT con intensidad: split+blend, `ffmpeg.rs:754-781`). Equivale a la conexión punteada de key del Outside node de Resolve.
- `value`: parametrización expuesta (p. ej. intensidad conectada), útil más adelante para drivers; en MVP se resuelve a constante.

### 5.2 Orden topológico → `filter_complex` (compilador Rust)

Módulo nuevo `apps/desktop/src-tauri/src/render/vfx_graph.rs` que reutiliza los helpers actuales:

1. **Cargar y validar** el grafo (zod en TS ya validó; en Rust se revalida lo estructural).
2. **Toposort (Kahn)** desde el nodo `output` hacia atrás: se obtiene un orden por dependencias. Los nodos `source` anclan a inputs FFmpeg (índice `-i`), del mismo modo que hoy `build_plan_range` abre inputs por clip (`ffmpeg.rs:2828-2856`).
3. **Emisión de segmentos**: cada nodo produce un segmento de filtro (cadena con comas dentro del nodo). Optimización de tamaño: los caminos con fan-out 1 y fan-in 1 se **fusionan en una sola cadena con comas**; solo los puntos de bifurcación (split para máscara/LUT-intensity/glow, y merges) crean etiquetas nuevas `[gN]`. Hoy esa fusión ya existe a mano dentro de `visual_filter`; el compilador la generaliza.
4. **Merge**: el nodo `merge` emite el par overlay/blend actual (`ffmpeg.rs:2933-2953`), reutilizando `blend_mode_name` y las expresiones de posición (`overlay_x_expression`/`overlay_y_expression`, `ffmpeg.rs:586-631`). En modo `over` con `mask` → overlay con la alfa ya compuesta; en modo blend → el truco del input lavfi negro transparente ya presente en `ffmpeg.rs:2807-2826`.
5. **Gates temporales**: los parámetros `enable='between(t,…)'` (ya usados en overlay/blend, `ffmpeg.rs:2938-2952`, y capas de ajuste) se mantienen como propiedad temporal del nodo.
6. **Salida**: `Vec<String>` con los segmentos etiquetados + el índice de inputs consumido; `build_plan_range` los integra en su `filters.join(";")` (`ffmpeg.rs:3348-3349`) y el resto (look global, motion ASS, captions, format final) no cambia.

**Migración sin ruptura**: la cadena fija actual (Entrada→Chroma→Roto→Color→Detalle→Salida de `VfxView.tsx:340-566`) se materializa como **grafo por defecto generado** para cada clip visual (serial puro, sin bifurcaciones). La compilación del grafo por defecto debe producir exactamente el mismo orden de filtros que `visual_filter` hoy (con tests de igualdad de texto del plan), y después la UI puede permitir reordenar/agregar nodos. Esto da un camino MVP→pro sin big-bang.

### 5.3 Multicapa real

- **Nivel 1 (MVP DAG)**: grafo por clip (como hoy) — los merges internos permiten, p. ej., glow + máscara + LUT en el orden que el usuario quiera, no el orden fijo actual.
- **Nivel 2**: **grafo por composición** con nodos `source` que referencian clips de la timeline: varios clips confluyen en merges con blend modes y máscaras propias (el caso de uso "título + sombra + halo" que hoy exige duplicar clips). El proyecto declara `vfxGraphs` en `project.ts` y el grafo sustituye la pila de pistas **solo para esos shots**; la timeline sigue siendo la estructura principal.
- **Nivel 3 (Pro)**: grafo global con pre-render por subgrafo (intermediarios FFV1/ProRes en disco) para grafos grandes.

### 5.4 Preview

- **Fase 1**: el preview sigue siendo `<video>`+SVG (sin evaluar el grafo) — igual que hoy (`VfxView.tsx:274-322`).
- **Fase 2**: "render de frame" del subgrafo bajo el playhead con un comando FFmpeg de un solo frame (`-frames:v 1`), siguiendo el patrón de congelación que ya existe para preview de transiciones/animaciones (`transitionFrozen`/`animationFrozen`, `ffmpeg.rs:2917-2931`, y `motion.frozen`, `ffmpeg.rs:1644-1655`): barato y fiel al render final.
- **Fase 3 (Pro)**: preview GPU en vivo (WebGL/WebGPU reimplementando los nodos) — fuera del alcance de FFmpeg; decisión propia, no de esta investigación.

### 5.5 UI (nodos)

- MVP: mantener la vista de tarjetas verticales pero **generada desde el grafo** (el orden ya no está hardcodeado; añadir "agregar nodo" con lista de tipos y reordenar).
- Fase 2: editor de nodos con canvas (evaluar librería React Flow vs canvas propio — decisión de implementación; ambas opciones caben en `features/vfx/`), inspector de parámetros reutilizando los `vfx-node-fields` actuales, y plantillas de grafo ("Vignette con máscara", "Glow controlado", "Chroma + roto + look").
- Español en todos los rótulos, siguiendo el tono actual ("Roto", "Clave x/y", "Seguir rostro").

---

## 6. Impacto resumido por capa (color + DAG)

| Capa | C0 perfil 10-bit | C1 cadena 10-bit | C2 HDR/tonemap | C3 ACES | D1 DAG por clip | D2 multicapa |
|---|---|---|---|---|---|---|
| **Schema** | `bitDepth` | — | color metadata en asset | — | `vfx-graph.ts` nuevo + migración default | `vfxGraphs` en project + refs clip↔grafo |
| **Render Rust** | format final + pix_fmt | formatos por clip, sustituciones, AMF main10 | zscale/tonemap + tags | lut3d pack / rebuild OCIO | `vfx_graph.rs` (toposort→segmentos) | merges entre sources de clips |
| **Preview** | — | — | badge HDR | — | sin cambio (F1) | render de frame (F2) |
| **UI** | selector bits | avisos compat. | indicadores HDR | preset ACES | tarjetas dinámicas | editor de nodos |
| **Tests** | snapshot pix_fmt | snapshot + live 10-bit | live HDR sintético | live LUT | igualdad de plan vs cadena actual | live multicapa |

---

## 7. Fases MVP→Pro y coste estimado

Estimaciones en **días de trabajo de un desarrollador** (implementación + tests + doc), ordenadas por dependencia. Son estimaciones de planificación, no promesas; ninguna fase está implementada en este pase.

| Fase | Contenido | Coste | Dependencias |
|---|---|---|---|
| **C0** Perfil 10-bit | `bitDepth` en schema/delivery/UI; format final 10le; tests | 2-3 d | — |
| **C1** Grade 10-bit | gbrp10le por clip; sustituir eq/vignette; AMF `p010le`+`main10`; live test | 5-8 d | C0 |
| **C2** HDR ingest | probing color; zscale+tonemap; tags de mux; scopes 10-bit opcional (+3 d) | 8-12 d | C1 |
| **C3a** ACES por LUT | pack `.cube` IDT/ODT + preset de export | 3-5 d | C1 |
| **C3b** ACES OCIO (Pro) | rebuild FFmpeg multiplataforma + filtro ocio + capacidades runtime | 5-10 d + mantenimiento CI | C1, decisión de infra |
| **D1** DAG MVP | `vfx-graph.ts` + validaciones; `vfx_graph.rs` (toposort, fusión de cadenas, merges); grafo por defecto; tarjetas dinámicas | 10-15 d | — (paralelizable con C1) |
| **D2** Multicapa real | nodos `source` por clip + merges con blend/máscara; render de frame para preview; editor de nodos | 10-15 d | D1 |
| **D3** Pro | grafo global + pre-render de subgrafos (FFV1/ProRes) + caché | 15-20 d | D2 |
| **P2** (opcional, Pro) | compositor propio 10-bit con alfa (Rust/GPU) para eliminar el techo 8-bit de `overlay` | 20-30 d | D3, decisión de arquitectura |
| **Total MVP recomendado** | C0+C1+D1 | **17-26 d** | |
| **Total hasta "pro editor"** | + C2+D2 | **35-53 d** | |

Prioridad sugerida: **D1 primero** (desbloquea el orden real y allana la cadena antes de tocar formatos) o **C0+C1 primero** si el dolor actual es calidad de entrega 10-bit; ambas líneas solo comparten los tests de plan.

---

## 8. Riesgos transversales (DAG + pipeline)

1. **`filter_complex` gigante / límite de argv en Windows.** El plan se pasa como un solo argumento (`-filter_complex filters.join(";")`, `ffmpeg.rs:3348-3349`) a un proceso hijo sin shell; el límite práctico de línea de comando en Windows es ~32 767 caracteres por llamada a `CreateProcess`. Un DAG de 64 nodos con máscaras y keyframes puede acercarse (hoy una sola máscara de texto ya genera un subgrafo drawtext considerable — `mask_filter`, `ffmpeg.rs:1165`). Mitigaciones por orden de coste: (a) fusión de cadenas lineales con comas (diseñada en §5.2); (b) hard caps de nodos/aristas en el schema (§5.1); (c) error temprano legible cuando el plan supere un umbral (contar caracteres antes de spawn); (d) pre-render de subgrafos a intermediarios (fase D3).
2. **Techo 8-bit de `overlay`** (verificado §2.2): mientras se use `overlay`, el compositing con alfa es 8-bit. Alternativas: aceptarlo (documentado), `blend` matemático con alfa extraído (**no verificado** en este pase — prototipo requerido), o compositor propio (P2).
3. **Binario FFmpeg sin libplacebo/ocio** (verificado §2.3): ACES real y el mejor tonemapping requieren reempaquetado (C3b) con CI multiplataforma; la ruta LUT (C3a) evita el bloqueo.
4. **`eq`/`vignette` 8-bit** (verificado §2.2): obligan a sustituciones con nueva numerología; riesgo de diferencias visibles en proyectos existentes → hacer 10-bit opt-in por perfil (C1).
5. **Tests snapshot del plan**: los tests Rust comparan texto exacto de argumentos (p. ej. AMF `ffmpeg.rs:4807-4811`; glow `ffmpeg.rs:3849`); cualquier reorden del compilador del DAG los rompe de forma esperada pero numerosa. La migración D1 exige primero tests de **equivalencia** (mismo plan que `visual_filter` para el grafo por defecto).
6. **Rendimiento 10-bit**: más memoria/banda por frame; `gbrp10le` en cadenas RGB y `yuva420p10le` en chroma suben el coste de CPU en 4K. Mitigar con live test de tiempo de render por fase (patrón existente de renders live 320×180 documentado en `docs/research/VISUALS-LUCIANO-2026-10-24.md`).
7. **Scopes 8-bit del canvas** (`scopes.ts`): el UI puede mostrar histogramas "10-bit" reescalados, pero la precisión real requiere el muestreo en Rust (C2 opcional). No prometer 10-bit en scopes hasta entonces.
8. **Hardware AMF**: main10 verificado en el binario, pero sujeto a GPU/driver AMD; siempre validar en runtime con render de prueba antes de exponer el selector.
9. **No verificado en este pase** (marcar antes de implementar): soporte 10-bit de `h264_nvenc`/`hevc_nvenc`/`*_qsv` en el binario; `maskedmerge` en 10-bit; composición alfa 10-bit vía `alphaextract`+`blend`.

---

## 9. Fuentes

**Código local leído** (rutas y líneas citadas en el texto): `packages/project-schema/src/timeline.ts`, `project.ts`, `effects.test.ts`; `apps/desktop/src/features/vfx/VfxView.tsx`; `apps/desktop/src/features/editor/scopes.ts`, `ScopesPanel.tsx`; `apps/desktop/src-tauri/src/render/ffmpeg.rs`, `mod.rs`; `state.rs`; `docs/research/VISUALS-LUCIANO-2026-10-24.md`.

**Verificaciones ejecutadas en este pase** (comandos y resultados citados en §2): `-version`, `-h encoder={libx264,libx265,hevc_amf,h264_amf}`, `-h filter={zscale,libplacebo,tonemap,ocio,colorspace}`, pruebas de negociación `-v verbose … -f null -` para `eq, curves, colorbalance, chromakey, zscale, gblur, vignette, lenscorrection, colorlevels, noise, lut3d, overlay, blend` (incl. variantes `gbrap16le`/`yuva444p16le` de overlay).

**Web:**

- DaVinci Resolve (nodos): [Frame.io — DaVinci Resolve's Most Useful Nodes: Serial, Parallel, and Outside](https://blog.frame.io/2023/05/22/davinci-resolve-most-important-nodes-serial-parallel-outside/), [DaVinci Resolve Club — Nodes Explained: Serial vs Parallel vs Layer](https://davinciresolveclub.com/davinci-resolve-nodes-explained), [Mixing Light — Parallel y Layer Mixer](https://mixinglight.com/color-grading-tutorials/davinci-resolve-parallel-layer-mixer-nodes), [AAA Presets — Nodes Explained (2026)](https://aaapresets.com/blogs/davinci-resolve-color-grading-gradient-tutorials/unlocking-the-power-of-nodes-in-davinci-resolve-a-deep-dive-into-serial-parallel-layer-and-keyer-for-2025).
- DaVinci Resolve (color management): [Blackmagic Design — DaVinci Resolve Color](https://www.blackmagicdesign.com/products/davinciresolve/color), [Frame.io — RCM vs ACES](https://blog.frame.io/2024/02/12/davinci-resolve-color-management-vs-aces-which-should-you-choose), [Mononodes — Color Management in DaVinci Resolve](https://mononodes.com/color-management-in-davinci-resolve), [Filmbox — ACES/DaVinci Color Management](https://videovillage.com/learn/filmbox/full-guide/aces-davinci-color-management).
- Olive: [Olive wiki — Nodes](https://github.com/olive-editor/olive/wiki/Nodes), [Olive wiki — Design Architecture DAG](https://github.com/olive-editor/olive/wiki/Design-Architecture-DAG), [olivevideoeditor.org](https://olivevideoeditor.org/).
- FFmpeg 10-bit / tonemapping: [FFmpeg Filters Documentation (oficial)](https://ffmpeg.org/ffmpeg-filters.html), [libplacebo filter docs (FFmpeg 8.0)](https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/libplacebo.html), [libplacebo options](https://libplacebo.org/options), [FFmpegLab — Color Spaces, HDR and Tone Mapping](https://ffmpeglab.com/articles/ffmpeg-color-spacing.html), [dev.to — HDR to SDR tone mapping](https://dev.to/masonwritescode/ffmpeg-hdr-to-sdr-tone-mapping-that-doesnt-look-washed-out-2026-24ie), [Reddit r/ffmpeg — libplacebo vs tonemap (linear light)](https://www.reddit.com/r/ffmpeg/comments/115umrz/libplacebo_output_looks_different_to_other).
- AMF 10-bit: [GPUOpen AMF issue #259 — 10-bit HEVC encode](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/issues/259), [VideoHelp — HEVC_AMF 10bit support](https://forum.videohelp.com/threads/399947-HEVC_AMF-10bit-support), [Superuser — pixel format y perfil en encode 10-bit (p010le vs yuv420p10le)](https://superuser.com/questions/1614571/understanding-pixel-format-and-profile-when-encoding-10-bit-video-in-ffmpeg-with).

---

## 10. Decisiones abiertas (para el dueño del proyecto)

1. ¿10-bit opt-in por perfil de export (recomendado) o global del proyecto?
2. ¿Prioridad C (color) vs D (DAG) para el próximo sprint?
3. ¿Editor de nodos con React Flow o canvas propio (decisión de implementación de D2)?
4. ¿Asumir el mantenimiento de un FFmpeg propio (C3b) o quedarse con ACES-por-LUT (C3a)?
5. ¿Exigir compositing 10-bit con alfa (P2, compositor propio) o cerrar la calidad con el enfoque híbrido 10/8-bit?
