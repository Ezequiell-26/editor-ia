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
| EDL / OTIO / FCPXML / DaVinci interchange | Estándar de industria | ✅ | `commands/edl.rs` (incl. drop-frame 29.97/59.94 `FCM: DROP FRAME`), `otio.rs`, `fcpxml.rs` + tests; multicam sincroniza por timecode DF |
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
| Keyframes | AE | ✅ | `keyframe_add` MCP, `project-schema/motion`, keyframes por parámetro de efecto (◆ en EffectStudio) con export segmentado en FFmpeg |
| Motion graphics / Lottie | lottie-web (MIT) | ✅ | `commands/lottie.rs`, `features/motion/LottiePanel` |
| Stickman / personajes 2D riggeados | motion-canvas, manim | ✅ | `commands/stickman.rs`: rig FK 14 huesos, 5 acciones + keyframes, raster+ffmpeg; UI `features/motion/StickmanPanel` + **editor visual del rig** (`StickmanRigEditor`: preview SVG con la misma geometría FK, sliders por hueso y keyframes por frame, acción `custom`). Física de cuerpos rígidos pendiente (ver §7) |
| Motor de partículas/física 2D | pixijs | ✅ | Partículas en `stickman.rs` (confetti/snow/sparks/bounce con gravedad+restitución+paredes, dt fijo determinista); UI en StickmanPanel |

## 3. Audio

| Funcionalidad | Referencia | Estado | Evidencia |
|---|---|---|---|
| Mezcla multipista, gain, pan, fades, ducking | Tone.js | ✅ | `features/mixer` (MixerView, TrackAutomationPanel, LiveMeters), `audio_mix` MCP |
| Loudness LUFS / true peak | — | ✅ | `commands/loudness.rs`, LoudnessMonitor |
| Waveforms y picos | howler.js | ✅ | `hooks/useWaveform`, `envelopeFromPeaks` |
| Scopes de audio (oscilograma/espectro/espectrograma) | Kdenlive audioscopes | ✅ | `commands/audio_scopes.rs` (FFT filmcraft-audio-dsp), `AudioScopesPanel` en Mixer (clip completo o ventana del playhead) y `PreviewAudioScopes`: oscilograma+espectro **en vivo del bus master** Web Audio en el monitor |
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
| Grabación tipo OBS (pantalla/ventana/región/webcam/audio/RTMP) | OBS | ✅ | `screen_record.rs`, dispositivos dshow, stats ffprobe, `streamUrl` RTMP. **UI real**: pestaña «Grabar» del hub Laboratorio (`features/record/RecordView.tsx`) con formulario de captura, dispositivos, encoder, start/stop con cronómetro y escenas |
| Preview de escena OBS (frame PNG sin grabar) | OBS | ✅ | `screen_record_snapshot` + `obs_scene_preview`: reutiliza los helpers de args de captura de `screen_record` (desktop/ventana/región + webcam PiP) → ffmpeg 1 frame → PNG. Botón «Vista previa» en `RecordView` muestra el frame real. Comandos Tauri + `obs_scenes` action=`preview` en MCP + servicio/fake. Verificado con ffmpeg real (PNG 1360×768 + ffprobe). Tests Rust de args |
| Archivos: ls/read/write/mkdir/move/delete protegidos | — | ✅ | `files.rs` con protección de rutas de sistema y perfil |
| VPN del sistema (listar/estado/conectar/desconectar) | RAS de Windows | ✅ | `commands/vpn.rs`: `Get-VpnConnection` (PowerShell) + `rasdial` con credenciales guardadas por Windows — la app nunca maneja contraseñas; `vpn_connect/disconnect` validan el nombre contra la lista real (anti-inyección). WireGuard se detecta (`vpn_wireguard`) y se abre en su app oficial. UI: `VpnCard` en Ajustes → Herramientas. **Límite honesto**: crear conexiones VPN se hace en Configuración de Windows (requiere admin); la app no implementa cliente VPN propio ni túnel |
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
2. **Motor stickman/rigging 2D**: **HECHO (v1+UI+física+editor visual)** — `commands/stickman.rs`: rig FK con 14 huesos, 5 acciones procedurales + keyframes, partículas (confetti/snow/sparks/**bounce** con gravedad+restitución+paredes, integración determinista a dt fijo con early-exit al asentarse), raster + ffmpeg. **UI real**: `StickmanPanel` en Motion + `StickmanRigEditor` (preview SVG con la geometría FK portada a TS en `stickman-rig.ts`, 11 sliders por hueso en grados, keyframes por frame con interpolación lineal — acción `custom`). Física de cuerpos rígidos queda pendiente.
3. ~~EQ/compresor por clip~~ — resuelto: el catálogo de audio del effect-kit ya se compila a filtros `-af` por clip y llega al render.
4. **Escenas OBS**: **HECHO** — `commands/obs_scenes.rs`: presets persistentes (capture target, webcam, mic, RTMP, encoder) en `obs-scenes.json`, `obs_scene_start` delega en el motor real, `obs_scene_preview` captura un frame PNG real de la escena (ver fila de la matriz). Tool MCP `obs_scenes`. Transiciones entre escenas quedan pendientes.
5. ~~**Scopes en preview nativo**~~ **HECHO** — la pestaña Scopes de la página de Color ahora tiene paridad con el monitor: renderiza el frame del clip gradeado con el mismo `visual_filter` del export (`render_preview_frame`, debounced 400 ms mientras la pestaña está activa) y habilita el análisis nativo FilmCraft (waveform, vectorscope, histograma RGB/Y) sobre ese archivo, además del muestreo canvas en vivo que ya existía. Sin frame disponible (servicio caído) el panel sigue midiendo el canvas.
6. ~~**Subtítulos traducidos automáticos**~~ **HECHO (v1)** — `subtitles_pipeline.rs`: video → faster-whisper → traducción por proveedor (mock honesto `simulated:true`) → `.ass` con PlayRes real → burn-in FFmpeg con verificación. Tool MCP + servicio + 3 tests.
7. **Transiciones OBS en vivo**: pendiente (filtergraph multi-inputo con timeline). ~~Preview de escena~~ **HECHO**: `obs_scene_preview`/`screen_record_snapshot`.
8. ~~**Editor visual del rig stickman**~~ **HECHO (2026-11-11)**: `StickmanRigEditor` en la acción `custom` — preview SVG con FK idéntica a Rust (`stickman-rig.ts`), sliders por los 11 huesos editables (grados + `pelvis_dy` en px), captura/carga/borrado de keyframes por frame y scrub de la pose interpolada. La tool MCP `stickman_render` ahora pasa los campos de pose (antes los descartaba). **Física 2D** de cuerpos rígidos: pendiente.
9. ~~**Grafos de nodos dentro del `.olyp`**~~ **HECHO** — `features/nodes/graph-store.ts`: los grafos se guardan en `x-nodeGraphs` del documento del proyecto (namespace `x-`, compatible con el validador Zod, el de Rust y versiones anteriores); «Guardar» hace upsert por nombre + `saveNow`, la vista restaura el último del documento y conserva el fallback legado `graphs/*.json`. Selector de grafos guardados + nombre editable. 7 tests (`graph-store.test.ts`, incluido el contrato `parseProject`).

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
