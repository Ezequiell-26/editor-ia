# 07 — Motores, repositorios profesionales e investigación de código abierto

## 1. Política
No instalar ni copiar todos los repositorios encontrados. Olyvia ya tiene un editor y FFmpeg. La estrategia es **auditar, extraer patrones/capacidades, integrar componentes pequeños sólo donde cierren una brecha medida**.

Antes de incorporar un repo:
1. Revisar README, commit/release recientes y issue health.
2. Revisar LICENSE, NOTICE, SPDX, licencias de dependencias transitivas.
3. Revisar código realmente usado, build, plataforma y requisitos.
4. Revisar plugins, codecs, binarios, fonts, assets, model weights y datasets.
5. Hacer POC aislado con benchmark real.
6. Decidir adopt / adapter / learn-only / reject.
7. Registrar decisión en ADR, THIRD-PARTY-NOTICES y audit:licenses.
8. Sólo integrar si compila, se prueba y no introduce una segunda fuente de verdad.

## 2. Núcleo y timeline

### Mantener
- **FFmpeg/FFprobe:** motor actual de decode/encode/render y probing. No reemplazar con el repo de otro editor. Verificar build flags y licencia efectiva de la distribución.
- **Project Schema propio:** la fuente canónica de proyectos, clips, scenes, effects, tracks y jobs permanece en packages/project-schema.
- **effect-kit propio:** mantener un único catálogo de efectos y parámetros.

### OTIO
- OpenTimelineIO: https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- Proyecto para intercambio/editorial interchange, no un motor NLE ni un renderizador.
- Auditar round-trip con timebase, transitions, gaps, nested timelines, markers, effects y metadata. No convertirlo en canonical project format.

### OpenCut
- https://github.com/OpenCut-app/Opencut
- MIT según repo/source consultado; arquitectura TypeScript/React y core Rust/WASM.
- Estudiar UX, timeline, separación engine/UI y contratos de edición agent-friendly.
- Adoptar sólo piezas pequeñas compatibles; no copiar el editor completo ni importar un segundo modelo de timeline.

### wgpu
- https://github.com/gfx-rs/wgpu
- API gráfica multiplataforma Rust, MIT/Apache-2.0.
- Evaluar sólo para futuro preview/compositor GPU si existe un cuello de botella probado. No desplazar el renderer FFmpeg sin benchmark y plan de compatibilidad.
- En la máquina de referencia la iGPU AMD debe ser probada; mantener fallback CPU y evitar requisito de GPU dedicada.

## 3. Repos NLE para investigación de referencia

| Proyecto | Repo | Licencia observada | Uso permitido en la estrategia |
|---|---|---|---|
| Kdenlive | https://github.com/KDE/kdenlive | GPL-3.0 | Estudiar UX y conceptos; no copiar código en core comercial sin revisión legal. |
| Shotcut | https://github.com/mltframework/shotcut | GPL-3.0 | Estudiar timeline, export y workflows; learn-only por defecto. |
| Olive | https://github.com/olive-editor/olive | GPL-3.0 | Referencia de NLE; comprobar estado alpha y licencia exacta antes de cualquier código. |
| OpenShot | https://github.com/OpenShot/openshot-qt | GPL-3.0 | Estudiar flujo simple, edición y manejo de proyecto; learn-only. |
| Drift | https://github.com/CutWire-Studios/Drift | GPL-3.0 según metadata consultada | Investigar funcionalidad y límites; no integrar en producto cerrado sin análisis legal. |
| Filmora/CapCut/DaVinci | Productos propietarios | Propietarias | Sólo estudiar interacción/organización; no reutilizar código, logos, assets o UI protegida. |

La licencia GPL no hace imposible vender una app, pero impone obligaciones de copyleft y distribución incompatibles con la estrategia de núcleo cerrado tal como está planteada, salvo diseño legal apropiado. No eludirla por separar procesos sin asesoramiento legal.

## 4. Motion, gráficos y efectos
- **Lottie Web:** https://github.com/airbnb/lottie-web — MIT; runtime SVG/Canvas/HTML. Revisar versión y bundle actual; ya existe uso en proyecto.
- **Motion Canvas:** https://github.com/motion-canvas/motion-canvas — MIT; valorar generación de animaciones vectoriales/escenas programáticas sincronizadas con voz. Es una herramienta de composición, no una NLE.
- **PixiJS:** https://github.com/pixijs/pixijs — revisar license y versión exacta; útil para efectos Canvas/WebGL en UI/preview, no sustituye export.
- **ComfyUI:** https://github.com/comfyanonymous/ComfyUI — licencia del repo y extensiones deben auditarse; uso local opcional y no requisito en la PC sin GPU dedicada. Preferir adapter HTTP/local y outputs importados por backend.
- **Remotion:** https://www.remotion.dev/docs/license/pricing — modelo de licencia comercial condicionado por uso/equipo/empresa. No asumir MIT/open-source ni incluir en núcleo. Sólo evaluación comercial explícita.

## 5. Audio y speech

| Repo | URL | Código | Observación |
|---|---|---|---|
| whisper.cpp | https://github.com/ggml-org/whisper.cpp | MIT | ASR local C/C++; auditar modelos por separado, RAM/CPU y calidad en español. |
| sherpa-onnx | https://github.com/k2-fsa/sherpa-onnx | Apache-2.0 | ASR, VAD, diarization, TTS y enhancement según modelo; weights tienen licencia aparte. |
| DeepFilterNet | https://github.com/Rikorose/DeepFilterNet | MIT/Apache-2.0 | Denoise/isolation; verificar modelo, build nativo y benchmark en CPU. |
| RNNoise | https://github.com/xiph/rnnoise | BSD-3-Clause según proyecto | Noise suppression; medir artefactos y latencia. |

### Piper: alerta de licencia
La documentación histórica docs/product/PRODUCT-SPEC.md puede presentar Piper como MIT. La línea actual OHF Voice/Piper (https://github.com/OHF-Voice/piper1-gpl) declara GPL-3.0. No reproducir la afirmación MIT sin revisar el repo/fork/tag exacto que se vaya a integrar. No sumar binario, eSpeak, voices y models al bundle sin revisar licencias por separado. Si se requiere un TTS compatible con distribución propietaria, evaluar otro adapter/provider o conseguir asesoramiento legal.

## 6. FFmpeg / GStreamer
- FFmpeg license: https://ffmpeg.org/legal.html
- FFmpeg LICENSE: https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md
- GStreamer licensing FAQ: https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html

FFmpeg puede cambiar de LGPL a obligaciones GPL según componentes y flags configurados. Validar versión, configure flags, DLLs, enlaces, notices, source offer y distribución exacta. Actualizar CVE/patches de la versión embebida.
GStreamer core es LGPL, pero plugins tienen licencias diferentes. Verificar plugin por plugin con documentación, LICENSE y gst-inspect; no asumir que toda la suite comparte la licencia del core.

## 7. Encoders y codecs
Mantener profiles para:
- H.264/AAC como compatibilidad común.
- HEVC/H.265 cuando hardware/licencia lo permita.
- VP9/AV1 para distribución eficiente donde sea soportado.
- ProRes/interchange de alta calidad sólo según flujo y derechos.
- Audio AAC/Opus/PCM según container.
- Hardware encode AMD AMF, Intel QSV, NVIDIA NVENC, D3D12/Vulkan según build, OS y GPU detectada.

No asumir disponibilidad por plataforma. Ejecutar capability test real. Comparar software/hardware visualmente, tamaño, calidad, tiempo y estabilidad. Presets medidos, no cifras inventadas.

## 8. Matriz de decisión por candidato
Para cada repo completar:
- objetivo/capacidad que falta;
- repo, tag, commit y fecha revisada;
- licencia del repo y transitive dependencies;
- modelos/datasets/assets/binaries/plugins;
- mantenimiento, issues y CVEs;
- tamaño/build/platforms;
- benchmark local de Ryzen 5 4600G / 16 GB / iGPU;
- integración propuesta (reuse API, adapter, subprocess, code port, learn-only);
- riesgos, alternativas, decision y ADR.

## 9. No hacer
- No importar un NLE GPL completo para extraer una función sin analizar distribución y copyleft.
- No tener dos timelines editables compitiendo.
- No reemplazar FFmpeg sólo porque otro repo es Rust/C++/GPU accelerated.
- No incluir modelos/weights no auditados.
- No descargar builds de terceros sin checksum/signature y fuente oficial.
- No declarar “optimizado para PC baja” sin benchmark en esta máquina.
## 10. Candidato nuevo de investigación: FilmCraft (no integrar en bloque)

- Repo: https://github.com/storytold/filmcraft
- GitHub declara licencias MIT y Apache-2.0.
- Proyecto joven/alpha, editor NLE escrito en Rust con compositor wgpu, engine de comandos, timeline, automation/MCP y CLI.
- El propio README reconoce gaps de madurez: plataforma Windows/Linux menos probada que macOS, falta de algunos formatos/codecs/AI features y limitaciones de render/codec parity.

Decisión: HIGH-PRIORITY LEARN/POC. Investigar exact timebase, command registry, wgpu compositor, render-preview parity, golden tests, job cancellation y MCP control. No copiar el editor completo, no crear segunda timeline/project schema y no sustituir FFmpeg existente. Hacer build Windows y benchmark en la máquina real, revisar LICENSE/NOTICE/assets/dependencies antes de cualquier port.