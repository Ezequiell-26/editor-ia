# Roadmap de Editor IA

Este documento consolida **toda** la lluvia de ideas de 2026-10-22 (siete rondas
con el usuario) en un plan con dependencias. Es la fuente de verdad del rumbo;
cuando algo se implementa se tacha acá y se detalla en el README.

## La idea madre

Editor IA es el **estudio todo-en-uno** del creador: video, guiones, voz,
imágenes, descargas y compresión en una sola app, local primero. Es una
**aplicación cerrada de pago** dirigida a editores profesionales **y también a
principiantes**: dos modos de uso, licencia offline, cero telemetría, cero
dependencia obligatoria de internet.

**Regla fundacional**: los servicios web amplifican, no sostienen. Ninguna
función exige internet ni cuenta para existir. Sin backend configurado, la
función se desactiva con el motivo — nunca rota.

**Regla de licencias** (innegociable por ser una app cerrada de pago): sólo
MIT / Apache-2.0 / BSD / Unlicense como dependencias enlazadas. FFmpeg corre
siempre como **proceso externo** (x264/x265 son GPL: jamás como biblioteca).
`symphonia` y `mp4parse` quedan fuera (MPL-2.0). Los **pesos** de los modelos de
IA tienen licencias propias: se verifica cada uno antes de incluirlo, no se
asume la del repositorio de código.

## Fase 1 — Comparador antes/después

**Estado: terminada y verificada (2026-10-22).**

El diferenciador más barato y el que la gente entiende en tres segundos: cargar
una imagen original y una procesada, arrastrar una línea y ver el cambio en
tiempo real.

- Componente `BeforeAfterSlider` reutilizable: línea arrastrable con mouse,
  táctil y teclado (flechas ±1 %, con Shift ±10 %, Inicio/Fin), ARIA `slider`.
- Modos: **deslizar** y **diferencia** (`mix-blend-mode: difference`).
- Intercambiar antes/después, zoom sincronizado, error por imagen rota.
- Vista **Comparar** en el grupo herramientas.
- Sirve a la compresión, al color y a los filtros del editor: mismo componente,
  tres lugares.

**Verificado**: 11 tests (7 de lógica pura, 4 del componente con puntero y
teclado), drag real en Chromium moviendo la línea de 40 % a 75 %, métricas del
DOM (clip, línea, ARIA, insignias) comprobadas, suite completa 810 tests y
Rust 168. Captura: `editor-ia-shots/app-comparador-2026-10-22.png`.

Fase 2 del componente (después): comparar frames de video (extraer el frame N
del original y del comprimido con FFmpeg) y modo lado a lado.

## Fase 2 — Motor de salida: compresión y conversión universales

**Estado: terminado y verificado (2026-10-22).**

Hecho:
- **Vista Comprimir** ("Comprimir como pro"): cualquier video del disco, por
  contenido —ffprobe decide, no la extensión—, con preajustes (YouTube 1080p,
  WhatsApp por tamaño objetivo, Archivo ligero) y el **número verificable**
  *"41,9 MB → 4,2 MB · 90 % menos · libx264"* con botón directo al comparador.
- **`compress_any_file`**: compresión por ruta absoluta, sin proyecto abierto.
  El tramo común quedó extraído en `compress_input` (herramientas y hardware
  resueltos por el que llama), así el flujo por asset y el por ruta comparten
  exactamente el mismo código.
- **`probe_any_file`** (`MediaProbe`): el inspector de medios —formato, duración,
  resolución, códecs, peso—. Es también la condición de aceptación del
  convertidor universal.
- **Puentes**: `choose_video_file` (selector nativo) y `queuePendingComparison`
  (la compresión deja el par listo y Comparar lo carga solo).
- **Prueba real** (detrás de `EDITOR_IA_RUN_RENDER_TESTS`): FFmpeg genera un
  clip, el sondeo lo describe (h264, 1280), `compress_input` lo reduce y
  **VMAF mide el original contra el comprimido** (puntaje en rango).
- **Progreso en vivo**: FFmpeg corre con `-progress pipe:1 -nostats`; el
  backend emite `compress-progress` con el porcentaje real (`out_time_us` sobre
  la duración) y la vista lo muestra con barra.
- **VMAF**: `measure_vmaf` detecta si el build trae libvmaf (con caché por
  proceso), re-escala el comprimido a la geometría del original y devuelve el
  puntaje; sin libvmaf devuelve `None` y la UI lo dice en vez de inventar.

- **Modo "Comprimir como pro"** con el número verificable en el centro:
  *"4,1 GB → 380 MB, 91 % menos, VMAF 93"*. Presets para principiantes
  ("para YouTube", "para WhatsApp") y control fino para pros.
- **Benchmark de codificadores**: el mismo video por AV1 / H.265 / H.264 con
  tabla de peso, tiempo y calidad. AV1 via `SVT-AV1` (BSD) como binario externo.
- **Convertidor universal**: la entrada se acepta por **sondeo con `ffprobe`**
  (contenido), no por allowlist de extensión. El allowlist vigente era una
  decisión de seguridad contra flags arbitrarios: se abre la entrada, los flags
  siguen validados.
- **Catálogo de presets** contenedor × códec × calidad, cada uno verificado una
  vez; y **modo experto** con flags FFmpeg permitidas (whitelist tipada, nunca
  arbitrarias).
- **Contador dinámico** en la UI desde el build real de FFmpeg:
  *"acepta 312 contenedores · 214 códecs"*. Verdadero y más fuerte que el
  "1000+" del marketing ajeno.
- **Aceleración por hardware** (NVENC / QSV / AMF vía FFmpeg externo) con
  detección y repliegue a CPU.
- **Medición VMAF** cuando el build lo incluye; si no, se oculta con el motivo.
- **Inspector de medios**: dump completo de `ffprobe` (códecs, streams,
  bitrates, capítulos, metadatos).
- **Generación de proxies** 720p para editar 8K fluido — la pieza que hace real
  la promesa de máxima resolución.
- Miniaturas por frame, contact sheets, extraer o quemar subtítulos.

## Fase 3 — Capa de capacidades con backends

**Hecho en parte (2026-10-22): Denoise Studio.** Preview WebGL2 en tiempo real
(bilateral 3×3 sobre canvas) y render FFmpeg con `hqdn3d`, `atadenoise` o
`nlmeans`, progreso real, audio AAC y publicación atómica. No requiere modelo
neuronal ni internet; el preview es una aproximación y el render es la
referencia.

**Hecho (2026-10-22): Thumbnail Studio.** Composición en canvas 2D con 16:9,
9:16 y 1:1, cuatro plantillas (banda inferior, split, minimal y gradiente),
título/subtítulo/badge/acento/overlay, guías de zona segura y export PNG
validado y re-encodeado en Rust con publicación atómica. Sin variantes A/B ni
detección de rostro todavía.

**Hecho (2026-10-22): Localization Studio.** Importación SRT/VTT/ASS/SSA,
traducción por lotes a los ocho idiomas con proveedor OpenAI-compatible,
glosario, autorización de cuota y export SRT/VTT validado. El proveedor simulado
no traduce y bloquea la exportación. **Doblaje SAPI** conectado en la vista Localización:
elige video/idioma/voz, ajusta duración, mezcla con cama original opcional y
exporta MP4; faltan voces para todos los idiomas. Sin detector local de idioma.
**Clonación local** (`clone_voice`) conectada en Localización: XTTS API Server
o GPT-SoVITS por loopback, referencia/idioma/texto y WAV verificado; no incluye
modelo y depende del motor externo.
**Lip-sync local real (2026-10-23)** (`lip_sync`) conectado en Localización:
video + audio del proyecto, motor Wav2Lip/MuseTalk/SadTalker por loopback, MP4
validado con FFprobe. Se agregó el adaptador
`scripts/lipsync-engine/server.py` (127.0.0.1:8765) y se verificó con Wav2Lip
real en CPU: **512×640, H.264/AAC, 4,65 s, 130 556 bytes**; el puente Rust
recibió el MP4. Límites: 45 s/1280 px, un trabajo por vez, sin GPU. **La
licencia de Wav2Lip prohíbe el uso comercial**; MuseTalk/LatentSync quedaron
clonados pero no instalados ni verificados.
**Gestión visual**: catálogo backend de 16 efectos, 8 presets y 4 transiciones
con filtros medidos, auditoría de rangos/LUT/transiciones y vista **Efectos**
con aplicación por lote, ajustes rápidos y preflight. Faltan wipes/tipos nuevos
en el renderer y keyframes de efecto propios.

**Hecho (2026-10-22): AI Hub de skills.** Nueve recetas locales con contrato de
salida, prompt autocontenido, límite de 4 000 caracteres, estimación de tokens y
handoff del brief a Guion. Todavía no es un chat ni un agente con herramientas.

**Hecho (2026-10-22): Auto Shorts.** Director propone hasta cinco ventanas de
15–60 s con score explicable (gancho, duración, voz, escenas y silencio), un
plan copiable y **export MP4 9:16**, audio, progreso real y verificación FFprobe.
Incluye **smart reframe local con SeetaFace** (modelo BSD-2-Clause de 1,2 MB)
que sigue el rostro frontal más grande; sin detección cae al centro. Falta
seguimiento multi-rostro/perfil robusto y elegir el mejor frame.

**Estado: primer corte terminado y verificado (2026-10-22).**

- **Gestor de modelos** (`commands/models.rs`): catálogo estático con checksum
  SHA-256 fijado, licencia del peso declarada, descarga con progreso
  (`model-download`) y verificación (un hash distinto descarta el archivo),
  borrado, y carpetas en datos de app. Primer modelo: **u2netp** (4,4 MB).
- **Registro de capacidades** (`commands/capabilities.rs`):
  `list_capabilities` devuelve cada capacidad con sus backends y su estado
  **medido** (quitar fondo, transcribir, TTS, VMAF). Sin backend, motivo
  exacto; nada rota.
- **Inferencia local** (`commands/background.rs`): **quitar fondo** con u2netp
  vía ONNX Runtime (`ort` rc.15, carga dinámica del DLL oficial de Microsoft
  1.22, MIT). Preprocesado igual que rembg, máscara por forma de salida,
  PNG con canal alfa. La imagen no sale del equipo.
- **UI**: vista **Fondo** (elegir imagen → recortar → comparar antes/después)
  y tarjeta **Capacidades** en Ajustes → IA (estado por capacidad + gestión de
  modelos con licencia visible).
- **Infra**: `rust-env.mjs` ahora detecta un `CARGO_HOME` de sólo lectura
  (D://DevCache) midiendo la escritura, migra el caché a `target/.cargo-home`
  y exporta el reemplazo — desbloquea agregar dependencias en esta máquina.
- **Verificado**: prueba real de inferencia (fixture u2netp + imagen sintética
  → máscara con variación) detrás de `EDITOR_IA_RUN_RENDER_TESTS`; suite UI 814,
  Rust 175.

- **Upscale ×4** (`commands/upscale.rs`): Real-ESRGAN-x4plus exportado por
  Qualcomm AI Hub (BSD-3-Clause, ONNX con pesos externos en dos archivos).
  El gestor ahora soporta **modelos multi-archivo**. Entrada fija 128×128 ⇒
  procesamiento **por teselas con solape de 10 px** (como el CLI de
  referencia) y límite de 2048 por lado por memoria. Prueba real: tesela
  128→512 con variación preservada.

Próximo corte: separar voz con Demucs (verificar licencia de pesos) y backends
remotos por API key.

La decisión que permite **las dos perfiles** (estudio local + servicios): cada
capacidad tiene backends y la UI muestra la capacidad, no el backend.

- **Registro de capacidades** en Rust: `{ id, backends: { local, remoto } }`.
  Sin backend configurado, la función se desactiva con el motivo.
- **Gestor de modelos**: descarga con checksum, carpeta en datos de app, peso y
  licencia de cada peso visible en Ajustes.
- Motor de inferencia: `ort` (ONNX Runtime, MIT/Apache). Ligero: `candle`.
- Capacidades primero: **quitar fondo** (u2net, ~170 MB), **upscale ×2/×4**
  (Real-ESRGAN, ~65 MB), **separar voz** (Demucs, ~300 MB, verificar licencia
  de los pesos), **transcribir** (Whisper, ya existe por CLI).
- Backends remotos vía **API key del usuario** en Ajustes (opcional, jamás
  obligatorio).

## Fase 4 — Experiencia por público y licencia

- **Modo guiado / modo pro**: revelado progresivo. El modo guiado ordena el
  camino (la ruta de producción ya es el esqueleto); el modo pro muestra todo.
  Decisión abierta: oculta funciones u ordena el camino.
- **Wizard de shorts**: video largo → 3 verticales con subtítulos quemados y
  las mejores tomas.
- **Auto-miniatura**: mejor frame por contraste, texto encima, variantes A/B.
- **Licencia con activación offline** (firma local, ligada al equipo) y **modo
  de prueba** con marca de agua en el export.
- Modelo de cobro abierto: pago único con actualizaciones incluidas vs
  suscripción. La tesis local favorece el pago único.

## Fase 5 — Operador IA

El chat **no conversa, ejecuta**. Consola de operador con tres modos:

- **Agente**: intención → plan → ejecución → resultado estructurado (qué cambió,
  dónde quedó el archivo, cuánto pesa). Cero prosa.
- **Plan**: muestra lo que haría y espera confirmación para todo lo que gaste
  créditos o borre.
- **Consultar**: responde con datos reales del documento.

Depende de la fase 3: la IA consume las mismas herramientas de capacidades.

**Optimización de tokens al máximo absoluto**: contexto mínimo por tarea,
esquemas compactos, diccionario de IDs numéricos, estado como diff, router
local para intenciones simples, caché de planes, respuestas JSON sin prosa.
Proveedores intercambiables: local (Ollama), económico (Gemini Flash),
potente (Claude/GPT). Vista de presupuesto por tarea y **dry-run** de todo plan.

**Centro de trabajos**: unificar render, descargas, Flow, conversión y
compresión en una cola única observable — es lo que la IA necesita para saber
qué corre sin gastar tokens en adivinarlo. Agendado ("renderizá a las 3 AM"),
librería de órdenes reutilizables.

## Fase 6 — Ecosistema y producción propia

- **Importar/exportar XML/EDL** (Premiere/Resolve) — tabla de entrada al
  mercado profesional.
- **Grabación propia**: pantalla (`gdigrab`), cámara, micrófono,
  **teleprompter** con el guion en pantalla, estudio de voz con takes.
- **Banco de música y efectos** con licencia clara (CC, dominio público),
  integrado con Cumplimiento.
- **Búsqueda semántica local** (CLIP en `ort`) y etiquetado automático de la
  biblioteca.
- **Robustez**: recovery de sesión, autosave versionado, undo persistente entre
  sesiones, mover proyecto entre PCs con relink de medios.
- **Gestión de disco**: visor de caché (proxies, waveforms, miniaturas,
  modelos) y limpieza por categoría.
- Gestión de fuentes tipográficas con licencias; exportar GIF/WebP animado;
  descargas por lote; carpeta vigilada; bajar subtítulos; macros; reglas;
  plantillas; variantes A/B; historial de versiones.

## Fase 7 — Distribución (más adelante)

- **La app como servidor MCP**: otros agentes controlan Editor IA.
- Publicación directa (YouTube/TikTok con APIs oficiales y cuenta propia),
  analítica post-publicación opt-in.
- Render distribuido en LAN, segundo monitor, i18n de la UI.
- Plugin SDK de terceros.

## Descartado (con motivo)

| Se descarta | Motivo |
|---|---|
| `symphonia`, `mp4parse` | MPL-2.0, contra la política de licencias |
| x264/x265 como biblioteca | GPL-2.0: enlazado obligaría a abrir el código. FFmpeg externo resuelve |
| Remotion | licencia sin validar para uso comercial automatizado |
| Electron / UI en Rust | React es lo correcto para esta UI; reescribir es perder meses |
| Servicios cloud propios | contra la tesis local: el costo es del usuario, no de un servidor |
| Funciones que exijan internet | la regla fundacional |
| Pesos de IA sin licencia verificada | app cerrada de pago: cada peso se audita |

## Orden y dependencias

```
Fase 1 (comparador)
   └─> Fase 2 (motor de salida: compresión + conversión universal)
          └─> Fase 3 (capacidades + modelos)
                 ├─> Fase 4 (modos + licencia)
                 └─> Fase 5 (operador IA)   [requiere Fase 3]
Fase 6 (ecosistema)    — independiente, se intercala
Fase 7 (distribución)  — última
```

Regla de trabajo: **una fase a la vez, terminada y verificada** (typecheck,
tests, build, ejecutada) antes de abrir la siguiente.
