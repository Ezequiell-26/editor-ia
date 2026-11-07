# Matriz de capacidades — Olyvia vs. misión "editor profesional"

**Fecha:** 2026-11-06 · **Alcance:** estado real medido en el árbol de trabajo
(`apps/desktop`, `packages/*`), no promesas de README. Cada fila cita la
evidencia verificable (archivo/módulo/test) o declara el hueco honestamente.

Estados: ✅ implementado y verificado · 🟡 implementado incompleto · ❌ no
implementado · ⛔ bloqueado por licencia/dependencia/entorno.

---

## 1. Núcleo de edición (timeline, proyecto, render)

| Funcionalidad | Referencia estudiada | Estado | Evidencia / hueco |
|---|---|---|---|
| Timeline multipista con clips, trim, split, move, slip | OpenCut, OpenTake, avio | ✅ | `packages/project-schema` (52+99 tests), `state/project-actions.ts`, `features/editor/Timeline.tsx` |
| Edición por frames / timecode | NLEs clásicos | ✅ | `packages/project-schema/src/time.ts` (11 tests) |
| Undo/redo e historial | Estándar NLE | ✅ | store con `revision`, tests de project-actions |
| Snap, ripple, multi-selección | Premiere/Resolve | ✅ | `snap-guides.test.ts`, atajos `Shift+R`, `Alt+Shift+←/→` |
| Marcadores | Estándar NLE | ✅ | `markers.ts`, tools MCP `marker_add/list/delete` |
| Clips anidados / multicam | Resolve | ✅ | `multicam/multicam.ts`, `multicam_build` MCP, auto-cut por actividad |
| Proxies | Resolve/PR | ✅ | `commands/proxies.rs`, `proxy-ui.test.ts` |
| EDL / OTIO / FCPXML / DaVinci interchange | Estándar de industria | ✅ | `commands/edl.rs`, `otio.rs`, `fcpxml.rs` + tests |
| Esquema de proyecto versionado | — | ✅ | `packages/project-schema` con JSON Schema + fixtures |
| Render FFmpeg real (x264/NVENC/QSV/AMF, CRF, presets medidos) | — | ✅ | `commands/render.rs`, benchmark ~4.5-4.9× realtime, `verify` |
| Exportación por lotes / presets redes | CapCut | ✅ | `batch-factory`, `export-presets.test.ts`, perfiles render |
| Worker de render separado | — | ✅ | `apps/render-worker` con protocolo propio (21 tests) |
| Collage/recuperación de proyectos | — | ✅ | `commands/recovery.rs`, auto-save en store |

## 2. Imagen, composición y efectos

| Funcionalidad | Referencia | Estado | Evidencia / hueco |
|---|---|---|---|
| Catálogo de efectos con parámetros | gl-transitions, PixiJS filters | 🟡 | `packages/effect-kit` (17 tests) + `features/vfx`; cobertura amplia pero no todos los filtros GL |
| Chroma key / green screen | Estándar | ✅ | `vfx/ChromaPreview.test.ts`, `project-schema/audio-chroma` |
| Color grading: wheels, curvas, HSL, LUT 3D, scopes | Resolve | ✅ | `color_lut.rs`, `filmcraft_scopes.rs`, inspector con subpestañas |
| Máscaras / face mask | — | 🟡 | `vfx/face-mask.test.ts`, `face.rs` |
| Picture in picture / transform / perspectiva | — | ✅ | `project-schema/perspective.test.ts`, PiP en screen_record |
| Keyframes | AE | ✅ | `keyframe_add` MCP, `project-schema/motion` |
| Motion graphics / Lottie | lottie-web (MIT) | ✅ | `commands/lottie.rs`, `features/motion/LottiePanel` |
| Stickman / personajes 2D riggeados | motion-canvas, manim | ❌ | No hay motor de rigging/partículas propio; se puede componer con Lottie/Flow, pero no hay sistema de huesos |
| Motor de partículas/física 2D | pixijs | ❌ | Sin implementación; candidato a capa SVG/canvas futura |

## 3. Audio

| Funcionalidad | Referencia | Estado | Evidencia |
|---|---|---|---|
| Mezcla multipista, gain, pan, fades, ducking | Tone.js | ✅ | `features/mixer` (MixerView, TrackAutomationPanel, LiveMeters), `audio_mix` MCP |
| Loudness LUFS / true peak | — | ✅ | `commands/loudness.rs`, LoudnessMonitor |
| Waveforms y picos | howler.js | ✅ | `hooks/useWaveform`, `envelopeFromPeaks` |
| Denoise / Voice Isolation | pyannote, RNNoise | ✅ | `denoise.rs` (RNNoise), `voice_isolation.rs` (Demucs real, wrapper Python embebido) |
| Diarización / separación hablantes | pyannote-audio | ✅ | `diarize.rs`, tool `diarize` |
| TTS local (SAPI) + piper + clonación | — | ✅ | `narration.rs`, `piper.rs`, `voice_clone.rs` |
| Doblaje / localización | — | ✅ | `dubbing.rs`, `localization.rs` |
| EQ/compresor/limitador por clip | Tone.js | ✅ | Catálogo `effect-kit/catalog/audio.ts` (~12 FX: autopan, chorus, echo, flanger, phaser, slapback, tremolo, widen, bitcrush, crystal, 8bit, tape…) compilado a `-af` en `render/ffmpeg.rs`; UI `AudioEffectStack` + `EffectBrowser kind="audio"` |

## 4. Transcripción y subtítulos

| Funcionalidad | Referencia | Estado | Evidencia |
|---|---|---|---|
| faster-whisper con detección honesta | faster-whisper, whisper.cpp | ✅ | `transcribe.rs`: sólo `EDITORIA_WHISPER_PYTHON` o python verificado con `import faster_whisper`; estado honesto en Ajustes |
| Subtítulos SRT/ASS/VTT, estilos, animación, highlight | pysubs2 | ✅ | `subtitles.rs`, `captions`, `caption_style_update` MCP |
| Subtítulos automáticos desde audio | — | ✅ | flujo transcribe→captions |
| Traducción/subtítulos multilingües | — | 🟡 | `localization.rs` existe; cobertura de idiomas por verificar |

## 5. IA y automatización

| Funcionalidad | Referencia | Estado | Evidencia |
|---|---|---|---|
| Catálogo MCP ~108 tools con anotaciones readOnly/destructive | MCP spec | ✅ | `mcp-catalog.ts`, presupuesto 48 KiB medido (46.4 KB), `mcp-validation` |
| Agente con streaming SSE + cancelación | — | ✅ | `assistant.rs`, AssistantDock, budget de tokens configurable |
| Proveedores OpenAI-compatible + test de conexión | — | ✅ | `providers.rs` `test_provider`, botón "Probar conexión" |
| Navegador embebido multi-web (WebView2 + CDP por sesión) | browser-use, Playwright | ✅ | `flow_embed.rs` slots, verificado en vivo CDP 19223, login Google real |
| Generación Flow imagen (CDP sin dependencias) | — | ✅ | `flow_generate.rs` + `scripts/flow-generate.mjs`, probado en vivo |
| Preset Playwright MCP (`@playwright/mcp`, Apache-2.0) | Playwright | ✅ | `McpView.tsx` preset con `--cdp-endpoint` |
| Autoconexión de clientes IA (Claude Desktop, Antigravity) | MCP spec | ✅ | `mcp_detect_clients`/`mcp_server_autoconnect` en `mcp_server.rs`: detecta instalación, arranca el server MCP y mezcla `mcpServers.olyvia` sin tocar otros servidores. UI en `McpView` + servicio + fake. 3 tests nuevos del merge |
| Instancias Chromium aisladas con proxy + stealth CDP | Playwright/puppeteer | ✅ | `browser_instances.rs`: perfil por `profile_id`, `--proxy-server`, flags anti-automatización y overrides JS vía `Page.addScriptToEvaluateOnNewDocument`. Tool MCP `browser_instances` |
| Pipeline guion→video (`factory_run` async) | — | ✅ | `batch-factory.ts`, `mcp-orchestrator-jobs`, test e2e con Flow |
| Grabación tipo OBS (pantalla/ventana/región/webcam/audio/RTMP) | OBS | ✅ | `screen_record.rs`, dispositivos dshow, stats ffprobe, `streamUrl` RTMP |
| Archivos: ls/read/write/mkdir/move/delete protegidos | — | ✅ | `files.rs` con protección de rutas de sistema y perfil |
| Editor visual de nodos | xyflow, rete | ✅ | `features/nodes/` con `@xyflow/react` 12.12.1 (MIT): grafo tipado, ejecución real sobre clips del proyecto (efectos→`stack`, audio→`audioStack`), render vía primer perfil de exportación. 6 tests `graph-model.test.ts` |
| Análisis de contenido visual local | — | ✅ | `image_sense.rs` (luz/color/rostros/nitidez), MCP `media_analyze` |

## 6. Rendimiento y robustez

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Presets de encoder medidos, NVENC/QSV/AMF | ✅ | benchmark real, `gpu-policy.test.ts` |
| Proxies automáticos + playback con contextos | ✅ | `proxies.rs`, `usePreviewAudio` |
| Descargas yt-dlp paralelas con checksum oficial | ✅ | `downloader.rs`, artefacto GitHub verificado |
| Consumo bajo en reposo (~140 MB medido) | ✅ | profiling en `memory/2026-11-06-profiling-carga-real.md` |
| Cancelación de tareas / recuperación | ✅ | `recovery.rs`, jobs con `factory_job_cancel` |

## 7. Gaps honestos priorizados (siguientes fases)

1. ~~**Editor de nodos visual**~~ **HECHO**: `@xyflow/react` integrado con ejecución real sobre la timeline (ver fila de la matriz). Persistencia de grafos en proyecto queda como mejora.
2. **Motor stickman/rigging 2D**: **HECHO (v1)** — `commands/stickman.rs`: rig FK con 14 huesos, 5 acciones procedurales (idle/walk/run/wave/jump) + keyframes con interpolación, raster propio + ffmpeg. 5 tests. Partículas y física quedan pendientes.
3. ~~EQ/compresor por clip~~ — resuelto: el catálogo de audio del effect-kit ya se compila a filtros `-af` por clip y llega al render.
4. **Escenas OBS**: **HECHO** — `commands/obs_scenes.rs`: presets persistentes (capture target, webcam, mic, RTMP, encoder) en `obs-scenes.json`, `obs_scene_start` delega en el motor real. Tool MCP `obs_scenes`. Transiciones entre escenas y preview en vivo quedan pendientes.
5. **Scopes en preview nativo**: existen scopes de color (`filmcraft_scopes`); verificar paridad waveform/vectorscope en la UI de color.
6. ~~**Subtítulos traducidos automáticos**~~ **HECHO (v1)** — `subtitles_pipeline.rs`: video → faster-whisper → traducción por proveedor (mock honesto `simulated:true`) → `.ass` con PlayRes real → burn-in FFmpeg con verificación. Tool MCP + servicio + 3 tests.
7. **Transiciones OBS en vivo** y **preview de escena**: pendiente (filtergraph multi-inputo con timeline).
8. **Editor visual del rig stickman** y **física 2D**: pendiente (hoy código/keyframes/MCP + partículas).
9. **Grafos de nodos dentro del `.olyp`**: hoy persisten como `graphs/*.json` del proyecto con auto-carga del último.

## 8. Dependencias externas clave (licencias verificadas en uso)

| Pieza | Licencia | Uso |
|---|---|---|
| FFmpeg/FFprobe n9.0 LGPL | LGPL-2.1+ | decode/encode/grabación (bundle dev, dinámico) |
| yt-dlp | Unlicense | descarga, sólo binario oficial + checksum |
| faster-whisper (CTranslate2) | MIT | transcripción, Python del usuario |
| Demucs | MIT | voice isolation, Python del usuario |
| ONNX Runtime | MIT | background removal/upscale |
| @playwright/mcp | Apache-2.0 | preset de automatización browser |
| WebView2 | Microsoft (runtime del SO) | navegador embebido |
| Lottie | MIT (renderer propio) | motion graphics |

> Regla aplicada: nada GPL/AGPL en el camino crítico; whisper.cpp queda como
> alternativa MIT si se quisiera binario nativo sin Python.

## Actualización (sesión nodos/stickman/OBS)

- **Editor de nodos**: implementado con `@xyflow/react` (MIT, notificado en THIRD-PARTY-NOTICES).
- **Stickman 2D**: motor propio en Rust (`stickman_render`), tool MCP `stickman_render`, 5 acciones + keyframes, verificado con ffprobe.
- **Escenas OBS**: `obs_scenes` (list/save/delete/start) persistidas + tool MCP.
- **Traducción de subtítulos**: ya existía en Rust+servicio; ahora expuesta al agente vía tool MCP `subtitles_translate`.
- **SSE/Ollama**: parser y cancelación cubiertos por tests (20/20 assistant); inferencia real bloqueada porque la instalación local de Ollama no tiene `llama-server` (problema del entorno, no de la app).
- **MCP autoconnect**: `mcp_detect_clients` + `mcp_server_autoconnect` escriben `mcpServers.olyvia` en la config de Claude Desktop / Antigravity con merge no destructivo (`merge_olyvia_entry`, 3 tests nuevos).
- **Chromium aislado**: `browser_instances.rs` con proxy por instancia, perfil único y stealth JS vía CDP (4 tests).
- **Cumplimiento eSpeak NG GPL-3.0**: `LICENSE.txt` + `SOURCE.txt` versionados en git (`resources/piper/espeak-ng/`, excepción al ignore de binarios).
