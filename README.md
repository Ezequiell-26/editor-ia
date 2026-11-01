# Editor IA / Olyvia

Studio profesional de edición de video **todo-en-uno**, local-first y con IA integrada. Sin suscripciones ni servicios externos por defecto: procesas tus propios videos, generas voz con modelos locales y controlás cada aspecto de la exportación.

**Estado actual:** versión comercial activa (2026-10-28). Licencias Free/Pro habilitadas, trial de 14 días disponible e instalador firmado listo para publicación.

## Características principales

### Edición profesional
- Timeline magnética, cortes automáticos por silencios, edición basada en texto.
- Multicámara con sincronización automática y paneo por tiempo real.
- Curvas de keyframes editables, scopes profesionales y preview con escalado Lanczos.
- Render GPU acelerado para HEVC/H.265 y AV1; exportación por lotes con colas persistentes.
- Biblioteca de **52 iconos Lottie MIT** (react-useanimations), incluidos logos de marcas: 12 offline y el resto descargable con verificación SHA-256 y caché local.
- Importador Lottie `.json` y packs `.lottie` con imágenes embebidas, **themes por slots** (Color/Scalar/Position/Vector/Text) y **state machines** (inputs, transiciones, guards y acciones). El export usa el estado y segmento elegido; las interacciones de puntero/OnComplete se avisan y no se simulan.
- Selector de **fuentes instaladas** (`fontdb`, MIT) en los estilos de subtítulos, con datalist y texto libre para alias tipográficos.
- **Metadatos de audio** (`lofty`, MIT/Apache-2.0): título, artista, álbum y BPM se leen al importar y se muestran en el Inspector.
- Selector de color accesible con **react-colorful** (MIT) en las plantillas Motion: hex validado, presets y cierre por teclado.
- Biblioteca de Medios **virtualizada con `@tanstack/react-virtual`** (MIT): con 300 assets sólo se montan las filas visibles y se encolan sus miniaturas, no las 300. Medido en Tauri: **1/2/2 columnas y ~60 FPS** en viewports de 600/750/900 px; 600 px es emulación porque el mínimo nativo es 760 lógicos.

### IA y automatización
- **Director automático**: planifica cortes, escenas, subtítulos y variantes verticales sin LLMs externos.
- **Fábrica de Variantes**: genera múltiples proyectos desde un brief; comparte medios, exporta renders y aplica presets.
- **Voz local**: TTS multilenguaje con Piper y SAPI; clonación de voz opcional; doblaje y narración.
- **Análisis local**: detección de escenas, rostros y estabilización; reduce ruido y mejora audio con FFmpeg optimizado.

### Descargas y conversión
- Descarga desde YouTube, Instagram, TikTok; cola persistente con límites configurables Free/Pro.
- Convertir cualquier formato a MP4/MKV/WebM/MOV; compresión x265/x264/AV1; HDR tonemap o preservado.
- Upscaling inteligente por resolución objetivo; delogo proporcional y marcas de agua.

### UI y experiencia
- Rail global de 11 superficies + tabs por hub (Descargar/Creador/Laboratorio); workspace Ingesta/Creador/Studio.
- **Diseño** dentro de Creador: 152 sistemas, 11 reglas de craft, 189 prompts (incluidas 45 plantillas de imagen y 40 de video), 154 plantillas, 131 skills y 13 HyperFrames renderizables y 9 previews MP4 de Open Design (Apache-2.0/MIT), offline, con previews seguras, paleta aplicable a miniaturas y Motion, generador **brief → HTML/PNG/MP4/deck PDF** con **revisión Critique Theater** **3 direcciones visuales** y **paleta desde imagen o URL** **edición por instrucción** **handoff** y **brief guiado**, **Imagen IA** real (Pollinations o gateway) y **HyperFrames → MP4 VP9** local con envío a Medios y montaje en la timeline. Ver [docs/OPEN-DESIGN.md](docs/OPEN-DESIGN.md).
- Editor modular con pestañas internas (Timeline, Texto, Multicámara, Mezcla, VFX, Motion, Efectos).
- Modo Pro con gradientes premium, efectos holográficos y tarjetas hero; Free mantiene estilo cobalt minimal.

## Arquitectura técnica

- **Frontend:** React + TypeScript; Tauri 2 para el entorno nativo.
- **Render:** FFmpeg empaquetado (LGPL) y libx265/libx264/libvpx; GPU AMF/NVENC/QSV habilitados.
- **Licencias:** estado Pro/Free almacenado con firma digital Ed25519; cifrado AES-256-GCM ligado al equipo.
- **Pruebas:** suite de escritorio completa (1488 tests frontend, 483 Rust + 56 ignored); cobertura funcional de descargas, render, edición, biblioteca, plantillas, skills, generador de diseño, PNG, MP4 VP9, decks PDF y stage/import real a Medios.

## Requisitos

- **Node >= 22** y npm.
- **Rust stable** con toolchain MSVC; el repo expone `scripts/rust-env.mjs` para fijar `LIB`/`INCLUDE` y FFmpeg de desarrollo.
- **Windows 10/11** (WebView2 incluido en Windows 11; en Windows 10 se instala con el sistema).
- FFmpeg dev se prepara con `node scripts/setup-ffmpeg-dev.mjs`.

## Instalación

### Windows
```powershell
# Descargar el instalador firmado y ejecutar:
.\Olyvia_0.1.0_x64-setup.exe
```
- Instalador NSIS firmado con certificado autofirmado; no anuncia actualizaciones aún.
- Ejecutable de release disponible desde `target/release/editor-ia-desktop.exe` (build reciente).

### Desarrollo
```powershell
cd D:\Users\ofici\QODER-WORK\editor-ia

# Configuración de Rust/FFmpeg
node scripts/setup-ffmpeg-dev.mjs
npm install

# Frontend dev (con HMR)
npm run dev

# App de escritorio completa con Tauri
npm run tauri:dev

# Build del frontend y de la app de escritorio
npm run build
npm run tauri:build
```
- El build de release embebe el frontend y usa `custom-protocol` para evitar errores de CORS.
- Los recursos empaquetados (FFmpeg, yt-dlp, ONNX Runtime) se copian manual o vía CI; no se versionan en Git.

## Mejoras aplicadas (2026-11-01)

### Montaje inteligente
- **Transiciones por corte** (`state/smart-transitions.ts`): el montaje ya no
  repite una disolvencia igual en todos los cortes. Elige tipo, duración y curva
  por corte: disolvencia entre fotos, fundido a negro al cambiar de material,
  desplazamiento alternado en video sin voz y disolvencia cuando hay narración a
  ambos lados (no compite con la voz). Respeta el tope de 2 s / 120 frames y
  nunca supera al plano más corto. Ritmo `calm` / `steady` / `punchy` desde
  Producción → Montaje automático, con resumen del plan en la revisión.
- **Subtítulos por peso de habla** (`state/caption-timing.ts`): reparte frames
  por caracteres visibles más la pausa de la puntuación, impone mínimo/máximo
  por bloque y avisa cuando un subtítulo supera 17 caracteres por segundo. Los
  bloques siguen siendo contiguos y cubren la escena completa.
- **Fábrica de Variantes**: cada variante del lote sale con una energía distinta
  (calmo, estable, impacto) en vez de repetir el mismo montaje.
- Ambas piezas se pueden desactivar con `transitionStyle: 'dissolve'` y
  `captionTiming: 'proportional'` para volver al comportamiento anterior.

### Editor
- **Recorte con ripple** (`rippleTrimClip`): recorta la salida del clip al
  playhead y corre el resto de la pista el mismo delta, sin hueco ni solape.
  Atajo `Ctrl+Shift+→` (`edit.rippleTrimOut`).

### Descargador
- **Presets guardables** (`features/download/presets.ts`): guarda compresión,
  peso objetivo, cine, watermark, subtítulos, SponsorBlock, hashes, plantilla
  de nombre, proxy y límite de bajada; se aplican en un clic y sobreviven al
  reinicio. Máximo 24 presets, sin duplicados por nombre.

### Renderizado inteligente
- **Plan de render sugerido** (`state/render-plan.ts`): el diálogo de
  exportación propone códec, compresión, CRF y GPU según el destino (redes,
  web, archivo maestro, borrador), la duración, la resolución y el hardware
  detectado, con **peso y tiempo estimados** y el motivo de cada decisión.
  Un clic aplica el plan. Avisa por alfa en MP4, dimensiones impares, 4K en
  redes y HEVC por software en timelines largas.

### Fotos
- **Movimiento según el encuadre** (`state/photo-motion.ts`): el montaje ya no
  hace zoom a ciegas. Una foto apaisada en un encuadre vertical se recorre en
  horizontal; una vertical en 16:9 se recorre en vertical; si la relación
  coincide, alterna zoom. Determinista y compatible con la firma anterior.

### Rendimiento
- **Composición opaca sin RGBA** (`render/ffmpeg.rs`): si ningún clip necesita
  alfa, el grafo compone en `yuv420p` en vez de RGBA. Medido con el worker
  headless sobre 10 s de 1080p30 con 4 cortes: **3717 ms → 3411 ms** (mediana
  de 3 corridas alternadas, −8 %). Salida equivalente: **PSNR Y 55,12 dB,
  SSIM 0,99993**. `project_needs_alpha` pide alfa ante la duda (máscara, croma,
  blend, transición, animación, fade, LUT/grano/glow, opacidad < 1, keyframes
  de opacidad, `media.alpha` del asset o fuente WebM). Tests: 3 unitarios
  nuevos y las **23 pruebas live de render** en verde, incluidas las de alfa,
  parallax y máscara de texto.
- **Preview 2D sin basura por frame**: la ruta de efectos sin WebGL creaba dos
  canvas de 1280×720 por frame de video (uno de trabajo y otro para el grade
  del look). Ahora se reutilizan y sólo se redimensionan al cambiar el tamaño
  (`features/editor/scratch-canvas.ts`, 4 tests). El contexto 2D se pide con
  `willReadFrequently` porque esa ruta lee píxeles en cada frame: sin el flag
  cada `getImageData` es una descarga desde GPU.
- **Benchmark real de preview** (`npm run bench:preview`, Chrome + 1080p60):
  `none` 58→60 fps, `lut` 60→60, `denoise-spatial` 54,8→60, `lut+denoise`
  43,9→60, `vignette` 52,3→60, `motionblur` 41,3→48,3. El bench corre cada caso
  una sola vez y tiene ruido de ±10 fps entre corridas; se reporta como
  tendencia, no como garantía. JSON en `docs/EFFECTS-PREVIEW-BENCH.json`.
- **Catálogo de emojis diferido**: el selector ya no arrastra sus datos al
  montar el editor. Medido en build: `EmojiPicker` pasó de **719,71 kB
  (113,13 gzip)** a **6,17 kB (2,43 gzip)**; el catálogo (214,93 kB) y los
  nombres en español (499,49 kB) son chunks aparte que se descargan sólo al
  abrir el selector. El editor deja de cargar ~714 kB de JS al arrancar.

### Pruebas
- Suite raíz **1896/1896 en 245 archivos**; `npm run typecheck` verde.

## Mejoras aplicadas (2026-10-28)

### Fase 4 — Velocidad y rendimiento
- Compresión x265 **faster**: ~28% más rápida que `medium` con tamaño final similar.
- Splash mínimo de **450 ms** (antes 900 ms); precarga reducida a 4 vistas.
- Laboratorio de Medios usando `faster` por software; hardware (AMF/NVENC/QSV) ya estaba activo.
- Working set de **~39 MB**; build optimizada en release.

### Fase 3 — Licencias Free/Pro
- **LicenseState** en Rust: prueba de 14 días, activación por archivo firmado Ed25519, estado cifrado.
- Descargas limitadas a 2 simultáneas en Free; Pro hasta 512, 4K/8K, HEVC, AV1, HDR.
- Exportación bloqueada >1080p o H.265 en Free; Director/Fábrica requieren Pro.
- Modal de activación, aviso de límites y compatibilidad de proyectos Pro→Free.

### Fase 2 — Estabilidad y golden path
- Recovery de sesiones interrumpidas; error boundary visible con “Reintentar” o “Ir a Inicio”.
- Auto-edit, short 9:16 con subtítulos quemados y Fichas de fábrica verificadas.
- Límites de descarga configurados (default 6, max libre por host); queue persistente con 25 slots Free.
- Auditoría de licencias de terceros y advertencias claras.

### Fase 1 — Navegación y hubs
- **9 superficies** (Inicio, Descargar, Creador, Proyectos, Editor, Laboratorio, Producción, Aprender, Ajustes).
- Tabs por hub (Descargar/Creador/Laboratorio) con navegación canónica; modos del editor dentro del mismo flujo.
- IA fuera del rail: asistente global y ajuste de licencias en Settings; deep links normalizados.

## Qué existe hoy

- Render real con FFmpeg y salida con alfa (VP9) para Lottie; preview 1:1 y scopes.
- IA opcional: endpoint OpenAI-compatible (FreeLLMAPI local o BYOK) y asistente con acciones validadas; sin proveedores simulados.
- UI completa de ingesta, edición, motion, descargas y ajustes.
- CI de pruebas y bundle de recursos en GitHub Actions.

## Qué todavía no existe

- Auto-updater firmado con endpoint de actualizaciones.
- Endpoint comercial de licencias (Lemon Squeezy/Gumroad) y recuperación de compras.
- Distribución en Microsoft Store y firma de reputación EV.
- HDR scopes y monitor de color calibrado (pendiente del roadmap).

## Recursos adicionales

- Documentación de fases: [PHASE-2](docs/PHASE-2-GOLDEN-PATH.md), [PHASE-3](docs/PHASE-3-LICENSING.md), [PHASE-4](docs/PHASE-4-COMMERCIAL.md).
- Auditoría legal: [LICENSES.md](docs/LICENSES.md).
- Cola de mejoras: [IMPROVEMENT-QUEUE.md](docs/IMPROVEMENT-QUEUE.md).

## Notas importantes

- La clave privada de licencias vive fuera del repo (`D:\Users\ofici\QODER-WORK\editor-ia-license-keys`). No compartirla.
- Las claves de proveedor AI deben guardarse en el Keyring de Windows o en una ruta externa.
- El instalador no anuncia actualizaciones aún; falta configuración de endpoint/manifiesto/signado.

## Licencia

El código propio de Olyvia se publica bajo licencia **MIT**. Las dependencias, binarios y assets de **terceros** conservan sus licencias y se documentan en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) y [docs/LICENSES.md](docs/LICENSES.md). **Remotion** no se incluye (su licencia no es compatible con la distribución comercial de este producto). No se incorpora **stock** de video, audio o imágenes sin licencia verificada. Los logos de marcas de la biblioteca Motion son marcas de sus titulares; la licencia MIT cubre el asset, no otorga derechos de marca.

## Roadmap próximo

- **Endpoint de licencias:** Lemon Squeezy/Gumroad + trial 14 días verificado.
- **Auto-updater:** manifiesto firmado y pruebas de downgrade/rollback.
- **Compresión GPU:** SVT-AV1 y AMF/NVENC en post-proceso de descarga.
- **Carga diferida:** EmojiPicker/fuentes grandes retrasadas hasta su uso.
