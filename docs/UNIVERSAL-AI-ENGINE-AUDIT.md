# Auditoría — Universal AI Video Engine (Fase 0)

Fecha: 2026-10-30. Objetivo: convertir Editor IA/Olyvia en una plataforma
audiovisual controlable por cualquier modelo compatible con herramientas, MCP o
function calling, con motores propios y sin un modelo generativo de video.
Este documento **no declara cumplida la misión**: mapea lo que existe, lo que
falta y el orden de implementación.

## 1. Método y evidencia

- Revisión del árbol `apps/desktop`, `packages/project-schema`, `apps/render-worker`,
  `apps/motion-mcp`, `scripts` y `docs` con búsqueda de símbolos y lectura de los
  módulos centrales (schema, project-actions, render, assistant, mcp, bridge).
- Pruebas del estado actual (2026-10-31, misma copia de trabajo):
  **1.773/1.773 frontend en 232 archivos**, **48/48 E2E de LUT/preview + E2E de
  3D y rig**, typecheck y build verdes. Rust: **538 passed / 71 ignored**.
- No se modificó código para esta fase.

## 2. Mapa de capacidades (A–E)

A = existe y funciona; B = existe incompleto; C = no existe y debe integrarse;
D = reutilizable de un repo externo; E = no viable/incompatible.

| Fase | Estado | Evidencia | Qué falta |
|---|---|---|---|
| 0 Auditoría | **A** | este documento + suites verdes | — |
| 1 Núcleo y modelo | **B** | `packages/project-schema/src/project.ts` (Project), `timeline.ts` (Track/Clip/Transform/Animation/Keyframe/Effect/Transition), `production.ts` (Scene), `assets.ts`, `captions.ts`; persistencia, autosave, undo/redo (`project-store.tsx`) | **MotionPath**, **Camera** y **RenderJob** como entidades del documento (`Sequence` ya existe y agrupa escenas) |
| 2 Interfaz IA universal | **B (tool loop + MCP de archivo y en vivo)** | `commands/assistant_agent.rs` (tools + `tool_calls` OpenAI, round-trip HTTP medido), `features/assistant/assistant-tools.ts` (**39 herramientas** con JSON Schema y permisos, incl. `motion_path`, `edit_transaction`, `chapter_plan` y cola de escenas), `assistant-agent.ts` (bucle máx. 4 rondas, resultados `role: tool`), `apps/project-mcp` (**servidor MCP stdio** con **13 herramientas** de archivo y **modo `--live`** con las 39 de la app abierta por el puente autenticado, workspace obligatorio para rutas), `commands/live_mcp.rs` (cola/timeout 30 s y 120 s para horneado/render), `AssistantDock.tsx` y `useLiveMcpBridge`; **permiso de exportación separado** en vivo (32 herramientas sin export, 39 con export; el CLI fija el workspace); **cola de escenas persistente**; **SSE + auditoría JSONL** (`/v1/mcp/events`, `/v1/mcp/audit`) con **Last-Event-ID** y progreso de render; **idempotencyKey** en el puente; **`edit_transaction`** atómico (≤20 ediciones, un mutate y un undo) | — |
| 3 Animación 2D | **B (rig stickman parcial)** | lottie-web + `.lottie` + state machines, capas = pistas, máscaras, keyframes; **rig 2D propio**: esqueleto, **6 clips** (incl. `reach` con **IK de dos huesos**), 3 paletas, horneado VP9, panel y `rig_add target`; E2E real | sprites/PixiJS, rigs importados (Lottie/Rive), skinning/retargeting y IK de cadena completa |
| 4 2.5D y parallax | **B (presets manuales)** | `state/parallax.ts` con 9 presets de dos capas (Ken Burns, parallax suave, push/pull, drift, separación, depth zoom, pan/tilt), movimiento relativo por intensidad y render FFmpeg verificado (12 px fondo vs 102 px recorte); herramientas `parallax_add` en asistente y MCP | mapas de profundidad, segmentación foreground/background automática, cámara virtual 3D y panel dedicado |
| 5 3D | **B (baked)** | Three.js 0.180 on-demand, 4 presets con luces/cámara/objeto, horneado VP9 en el WebView y entrada a Medios; E2E real (15.229/21.905 px, dif 3.757.634, MP4 50.643 B); **importación glTF/GLB** por `three_add.modelPath` con encaje automático y render verificado (asset 1.359.831 B → MP4 1.791.037 B); **animación glTF con selector de clip** (Pulso/Giro → VP9 1.296.076 B) **rótulo 3D sprite** (“Hola Olyvia” → VP9 910.936 B) y **texto extruido** con MgOpen Helvetiker (“Olyvia 3D”, depth 0,22 → VP9 941.516 B, caras y bisel visibles) | 3D vivo en el timeline, alpha 3D y retargeting |
| 6 Motion design | **B** | 11 plantillas (`templates.ts`), partículas, plan ASS (`render/motion.rs`), HyperFrames, iconos Lottie | tipografía cinética avanzada, diagramas/infografías, animación de subtítulos, integración Theatre/Motion Canvas evaluada |
| 7 Motion engine | **B** | presets de movimiento, keyframes con bezier (`keyframes.ts`), baking de expresiones FFmpeg, beat cuts | cámara como entidad, motion paths, movimiento dependiente de audio (propiedades), colisiones |
| 8 Efectos y transiciones | **A (con límites)** | 21 efectos/12 transiciones, shader LUT/grade/HSL/vignette/chroma/denoise, partículas, 5 overlays CC0, miniaturas, búsqueda/favoritos; E2E 48/48 | look global por agente (verificado saturación 112,7→9,7), paridad exacta `atadenoise`, keyframes de transición |
| 9 CV y tracking | **B (punto + caja + rostro)** | SeetaFace (rostro), **tracker NCC propio** de punto y de región (`render/point_track.rs`) con extracción FFmpeg, comandos, UI VFX (**Seguir punto/objeto**) y herramientas del agente; tests live FFmpeg de cuadrado y objeto texturado | objetos semánticos, pose, optical flow propio, segmentación y escala/rotación |
| 10 Timeline | **A** | `project-actions.ts` (80 exportaciones: move/trim/split/slip/slide/ripple/multicam/escenas), undo/redo, revisiones y procedencia | API de parche transaccional con idempotencia para agentes (existe `edit_transaction`; falta idempotencia por operación) |
| 11 Audio/subtítulos | **A (con límites)** | mixer/EQ/pan/ducking/LUFS, SRT/VTT/ASS, palabras por subtítulo | aislamiento de voz, compresión por clip |
| 12 Render | **A (con límites)** | `commands/render.rs`, `render/ffmpeg.rs` (13k líneas), H.264 openh264, H.265 kvazaar, VP9/WebM, AV1, progreso/cancelación; **render por escenas** (`render_scene`) con concat sin recodificar, **reanudación por segmento/revisión** y **cola de escenas persistente** en la UI (restaura tras reiniciar, espera el job y reutiliza segmentos) y **checkpoint intra-escena** de 10 s con reanudación y concat (45 s → 5 chunks; sólo se regenera el faltante; final 45,021 s/27.908.638 B) | worker headless entregado (`olyvia-render-worker`, 10 s/6.200.464 B verificado); cola backend pendiente; audio corto se rellena con silencio |
| 13 Smart engine router | **B+ (persistente y cableado parcial)** | `features/engine/router.ts` con **10 motores**; **`Scene.engine`** persiste (`scene_resolve pin`, `scene_create engine`, `project_inspect`, selector en Producción); **auto-edit aplica `ken-burns` y avisa del resto** (`engineApplied`) | que los flujos comerciales ejecuten engines no automáticos (parallax/3D/rig) sin horneado previo |
| 14 Videos largos | **A- (segmentos, cola, checkpoints, planificador y mezcla)** | escenas con rangos, render independiente, reanudación por segmento y por chunk, cola persistente con **concat automático** (final 13,021 s/5.476.425 B decodificado) **`chapter_plan`** (guion → capítulos/escenas con clips en una mutación) y **`narrate_scenes`** (SAPI por escena) y **`audio_mix`** (ganancia/paneo/EQ por pista + master; paneo verificado +13,99 dB, -26 LUFS) | audio fuera de escena (música/ambiente); la mezcla por escena ya existe con `clip_audio` |
| 15 Optimización | **B+** | perfiles, proxies, preview adaptativa, GPU policy, benchmarks reales (`EFFECTS-PERFORMANCE.md`) y **medición WebView2 en vivo**: `perf_stats` midió **33 fps reales / 0 caídos / 11,7 MB JS** reproduciendo el proyecto | streaming por bloques y presupuesto de memoria por motor |
| 16 Interfaz | **B** | 34 vistas, editor, motion (paneles Parallax 2.5D, Escena 3D y Personaje 2D), design, mixer, VFX, MCP, AI Hub y **constructor de escenas en Guion** (motor + clips por escena, guardado con undo; verificado en la UI real) | Character Studio, Animation Studio, Camera Controls, Render Queue como vista |
| 17 Licencias | **B** | FFmpeg LGPL auditado, avisos, scripts de auditoría | obligación de fuente de eSpeak GPL-3.0 abierta; SBOM formal |
| 18 Prueba integral | **A- (17 ítems con una sustitución declarada)** | `scripts/verify-integral.mjs` ejecutado **sólo con MCP**: 8 clips, 7 assets, 4 escenas, imagen+cámara+parallax, rig caminando, 3D, `motion_path`, glTF animado, efecto, transición, título animado, voz SAPI, música y 2 subtítulos; render **1920×1080/30 fps/15,233 s/5.663.541 B** h264+aac en 10,3 s, audio -20,1 dB, frames distintos y revisados; **MP4 decodificado completo** (video+audio, 457/457 frames) | el ítem “Motion Canvas” se cubrió con el motor de motion graphics propio; la reproducción interactiva en la UI no está automatizada en esta prueba |

## 3. Brechas principales (impacto descendente)

1. **Cola y checkpoints viven en la UI**: sobreviven al reinicio y sólo regeneran lo faltante, pero necesitan la app abierta; falta worker backend.
2. **Router cableado parcialmente**: la decisión se persiste y auto-edit ejecuta `ken-burns`; los motores que requieren horneado (parallax/3D/rig/motion graphics) sólo se avisan.
3. **Entidades ausentes**: `Sequence`, `Camera`, `MotionPath`, `RenderJob`; `edit_transaction` ya aporta transacciones de documento.
4. **3D horneado**: faltan 3D vivo, alpha 3D y retargeting (glTF con animación, rótulo sprite y texto extruido ya están).
5. **Tracking de punto, caja y rostro sí; faltan objetos semánticos, pose y optical flow.**
6. **Rigging de personajes parcial**: stickman procedural con 6 clips e IK de dos huesos; sin rigs importados, skinning ni retargeting.
7. **Producción larga**: `chapter_plan` ya crea capítulos/escenas con clips; falta audio por capítulo y audio fuera de escena.
8. **Prueba visual**: look multipista y reproducción interactiva en la UI aún no automatizados; Motion Canvas sigue sustituido por el motor propio.
9. **Deuda legal**: eSpeak GPL-3.0.

## 4. Plan por bloques

| Bloque | Alcance | Criterio de aceptación |
|---|---|---|
| **A. Herramientas IA** | **completa en su primera versión**: 30 herramientas + bucle tool→result + adaptadores OpenAI-compatible y Anthropic (ver `AI-TOOL-INTERFACE.md`) | pruebas: **17 unitarios de registro** (incluye proyecto/material, set integral, segmentos y cola), 5 del bucle, 9 Rust y 2 de UI; falta SSE/auditoría persistente |
| **B. Servidor MCP** | **primera versión completa**: stdio con 12 herramientas de archivo **y modo `--live`** con las 16 de la app abierta (ver `MCP-PROJECT-SERVER.md` y `LIVE-MCP.md`) | `npm run mcp:verify` (archivo) + `npm run mcp:verify:live` (stdio→HTTP falso) + 12 tests de sesión + 4 del cliente + 5 Rust del puente; falta SSE y control real desde un proveedor externo en un test automatizado |
| **C. Schema** | `Sequence`, `Camera`, `MotionPath`, `RenderJob` + migración | validación, fixtures y round-trip |
| **D. Router** | **completa + persistencia + auto-edit**: registro de 10 motores, `Scene.engine`, `pin`, selector UI y aplicación de `ken-burns` con aviso del resto (ver `ENGINE-ROUTER.md`) | 10 tests + auto-edit + schema + MCP real; falta ejecutar motores horneados desde el montaje |
| **E. 2.5D** | **primera versión completa**: 9 presets de dos capas con recorte manual, preview lineal y render verificado | 7 unitarios + 3 de preview + render real (12 px vs 102 px) + MCP; falta profundidad automática y UI dedicada |
| **F. 3D** | **primera versión completa**: escenas Three.js on-demand horneadas a MP4 VP9 y enviadas a Medios (ver `THREE-3D.md`) | 3 unitarios + E2E WebGL/WebCodecs + UI; falta modelo importado, 3D vivo y alpha |
| **G. Rig 2D** | **completa + IK**: esqueleto procedural, 6 clips (incl. `reach` IK), 3 paletas y horneado VP9 (ver `RIG-2D.md`) | 15 unitarios + 5 del codificador + E2E + UI + `rig_add target` + horneado IK real; falta rigs importados, skinning y retargeting |
| **H. Tracking** | **primera versión completa**: punto/caja NCC, máscaras con claves y acceso por agente; rostro SeetaFace previo (ver `POINT-TRACKING.md`) | 6 unitarios del tracker + 5 de la sesión + 2 live FFmpeg + 5 de máscaras + 2 de UI + 1 de herramienta; falta pose/objetos semánticos, escala/rotación y optical flow |
| **I. Render** | **primera versión de reanudación**: render por escena, segmento nombrado por revisión, reutilización y concat `-c copy` (ver `LIVE-MCP.md`) | 3 segmentos 4+3+3 s → final 3.681.306 B/10,021 s; falta checkpoint intra-escena y cola backend |
| **J. Integral** | **A-**: proyecto de 15 ítems creado/editado/renderizado por herramientas (7 clips, 3 escenas, 3.771.311 B, 9,93 s) | sustituir el motion propio por Motion Canvas si se exige literal, reproducir el MP4 completo y repetir con el look multipista |

## 5. Decisiones de reutilización y licencias

- Se reutilizan: lottie-web (MIT), FFmpeg LGPL (dinámico), HyperFrames/Open
  Design (Apache-2.0), Lottie packs MIT, MCP TypeScript SDK (MIT; revisar aviso
  de transición), Three.js (MIT) y PixiJS (MIT) **sólo si se demuestra ventaja**
  frente al renderer actual.
- No se integra GSAP sin revisión legal escrita. Rive queda bloqueado hasta
  conseguir `.riv` redistribuibles. Motion Canvas/Theatre se evalúan, no se
  incorporan como segundo timeline.
- eSpeak NG (GPL-3.0) sigue siendo un blocker legal de venta, no técnico.

## 6. Estado

Misión **no cumplida**, con avances verificados en varias fases. La capa de
control por agentes tiene el bucle de herramientas del asistente (**39
herramientas**, adaptadores OpenAI-compatible y Anthropic, render
iniciar/consultar/cancelar, rig 2D con IK, 3D, cámara, efectos, transiciones,
subtítulos, escenas, `scene_update`, `chapter_plan`, `narrate_scenes`, `clip_audio`, `audio_mix`, `project_look`, `edit_transaction`, trayectorias, tracking
de punto/objeto, apertura de proyecto e importación), un servidor MCP de
proyecto por stdio (13 herramientas de archivo) y el **puente MCP en vivo**
contra la app abierta (39 herramientas; 32 sin exportación), con **cola de
escenas persistente, checkpoints intra-escena, SSE/auditoría/idempotencia,
permisos de exportación y workspace fijo**.
El 2.5D manual (9 presets), el 3D horneado (Three.js + glTF + VP9 + Medios), el
rig stickman (6 clips + IK) y el tracking de punto/caja (NCC + live FFmpeg)
tienen render verificado.

La **prueba integral de 17 ítems** se ejecutó sólo con MCP y produjo un MP4 de
15,233 s verificado (8 clips, 7 assets, 4 escenas, voz, música, subtítulos y 4
frames distintos), con **decodificación completa 457/457**; el ítem Motion
Canvas se cubrió con el motor de motion graphics propio. El **checkpoint
intra-escena** se midió aparte: 45 s → 5 chunks, borrar `c02` + final y
reencolar regenera sólo `c02` (final 45,021 s/27.908.638 B), y el
**planificador capítulo→escena** se verificó con render de su primera escena.

Queda: cola backend persistente (el worker headless ya renderiza), Motion
Canvas si se exige literal, cablear el router en Director/UI, rigs
importados/skinning/retargeting, tracking semántico/pose, 3D vivo/alpha y
look multipista. El worker de render headless está verificado. El siguiente paso es el
**cola backend persistente** o el **look multipista**.
