# 12 — Catálogo completo de funciones y mapa de construcción

**Objetivo:** evitar que HY4 o SWE 2 implementen sólo una pantalla o una demo. Este catálogo reúne las superficies identificadas en el árbol actual y define qué debe conservarse, conectarse, completarse y verificarse.

**Regla de estado:** los nombres de carpetas prueban que existe una superficie de código, no que la función completa esté terminada. Consultar las auditorías, abrir el código y ejecutar cada flujo antes de marcar un ítem como REAL.

## 1. Inventario de dominios frontend encontrados

Se observaron estas áreas bajo apps/desktop/src/features:

| Área existente | Responsabilidad que debe conservarse | Workspace destino |
|---|---|---|
| ai | Funciones de IA y configuración de modelos | Crear / Ajustes |
| ai-hub | Hub de prompts/capacidades | Asistente / Crear |
| assets | Biblioteca y administración de medios | Medios / Editor |
| assistant | Chat y ejecución de acciones | Asistente contextual |
| autoedit | Análisis local y variantes de autoedición | Crear / Editor |
| brain | Análisis determinista y reglas de edición | Motor inteligente / Editor |
| color | Corrección de color y grading | Editor / Color |
| compare | Comparación de fuentes/variantes | Editor / Medios |
| compliance | Derechos, validaciones y cumplimiento | Medios / Entrega |
| compress | Compresión multimedia | Laboratorio / Exportar |
| convert | Conversión/transcodificación | Laboratorio / Medios |
| creator | Herramientas creativas | Crear |
| denoise | Reducción de ruido | Laboratorio / Audio/Video |
| director | Análisis y dirección de contenido | Crear / Autoedición |
| download | Descargador y adquisición de medios | Medios |
| editor | Editor NLE, timeline, preview e inspector | Editor |
| emoji | Emojis, stickers y assets | Editor / Motion |
| factory | Producción/variantes por lotes | Crear / Exportaciones |
| home | Inicio y actividad | Inicio |
| lab | Hub de utilidades | Laboratorio |
| learn | Tutoriales, ayuda y aprendizaje | Ayuda |
| localization | Traducción y localización | Crear / Texto |
| mcp | Gestión de cliente/servidor MCP | Ajustes / Asistente |
| mixer | Mezcla y procesamiento de audio | Editor / Audio |
| motion | Animación y gráficos en movimiento | Editor / Motion |
| multicam | Multicámara y sincronización | Editor |
| nodes | Composición visual por nodos | Editor / Composición |
| production | Runs y flujo autónomo | Crear / Centro de trabajos |
| projects | Crear, abrir, guardar y recuperar proyectos | Inicio / Proyectos |
| record | Captura/grabación | Medios / Laboratorio |
| script | Guion y narrativa | Crear |
| settings | Preferencias y proveedores | Ajustes |
| sharpen | Claridad/enfoque y filtros | Laboratorio / Video |
| start | Launcher/onboarding | Inicio |
| text-edit | Transcripción y texto asociado al vídeo | Editor / Texto |
| thumbnails | Miniaturas y portadas | Crear / Medios |
| updater | Actualizaciones | Ajustes / Sistema |
| vfx | Efectos visuales | Editor / VFX |
| visuals | Catálogo de recursos visuales | Medios / Editor |
| youtube | Integración/herramientas YouTube | Crear / Publicación asistida |

No crear un nuevo duplicado para cada feature. Mapear vistas actuales a workspaces primarios y paneles contextuales; mantener enlaces profundos y compatibilidad de rutas mientras se migra.

## 2. Catálogo del editor profesional

### 2.1 Proyecto, secuencias y organización
- Crear, duplicar, abrir, cerrar, renombrar, archivar y recuperar proyectos.
- Plantillas de proyecto, autosave, historial, snapshots y backups.
- Secuencias múltiples por proyecto, presets de resolución/fps/aspect ratio.
- Bin/carpeta inteligente, colecciones, etiquetas, favoritos y búsqueda.
- Relink de media faltante, media offline y sustitución controlada.
- Media managed/linked, proyecto portable y empaquetado de entrega.
- Versionado y migraciones sin perder proyectos viejos.

### 2.2 Ingesta y gestión de medios
- Drag-and-drop, selección múltiple, importación de carpeta y watch folders opt-in.
- Vídeo, audio, imagen, SVG, GIF, secuencias de imagen, subtítulos, Lottie y formatos admitidos.
- Probe: container, codecs, streams, dimensiones, pixel aspect, rotation, fps/timebase, color primaries/transfer/matrix, audio sample rate, canales, duración y frame count.
- Hash de contenido, thumbnails, filmstrip, waveform, metadata y proxies.
- Organización por tipo, duración, fecha, fuente, licencia y uso en timeline.
- Búsqueda semántica/local mediante transcript, tags y metadata cuando la capacidad esté disponible.
- Estados: imported, probing, generating preview, proxying, ready, missing, corrupt, failed, rights review.

### 2.3 Source monitor y playback
- Source monitor y program monitor.
- In/out points, insert/overwrite, replace, append, source patching.
- Play/pause, frame step, scrub, shuttle, loop, playback speed.
- Timecode, ruler, snapping, markers y safe areas.
- Audio-clock master para sincronización.
- Calidad de preview seleccionable, proxy/full-resolution y caché visible.
- Error recovery y decode fallback.

### 2.4 Timeline multipista
- Tracks de vídeo, audio, imágenes, títulos, captions, gráficos, composición y cámara.
- Crear, renombrar, duplicar, mover, bloquear, ocultar, mutear, solo y agrupar pistas.
- Split/razor, trim, ripple trim, roll, slip, slide, lift, extract, close gap.
- Move, duplicate, copy/paste, paste insert, linked selection y unlink.
- Snapping, snapping thresholds, magnet/snap guides, multi-selection, marquee y group.
- Nested sequences/compositions, multicam clips, compound clips.
- Markers: color, nombre, duración, nota, export CSV.
- Track targeting/patching, sync lock y linked A/V.
- Rate stretch, speed ramp, reverse, freeze frame y retime.
- Ripple edit, overwrite, insert, lift/extract.
- Keyframe lanes, animation graph y handles.
- Zoom to fit, zoom to selection, horizontal/vertical scroll y auto-scroll.
- Virtualización y optimización para secuencias largas.
- Undo/redo agrupado por acción del usuario o batch de IA.

### 2.5 Transformación y composición
- Position X/Y, scale X/Y/uniform, rotation, anchor/pivot, crop, opacity.
- Fit/fill/stretch, perspective/corner pin, keystone y picture-in-picture.
- Parent/group, nested compositions y transform inheritance.
- Blend modes, alpha compositing, masks y clipping.
- Chroma key, luma key, garbage matte, holdout y mask feather.
- Green screen, background removal, rotoscoping si existe modelo/engine.
- Stabilization y tracking con capability check.
- Layer order, safe zones y alignment guides.

### 2.6 Efectos y transiciones
- Catálogo con categorías, favoritos, búsqueda, presets y parámetros.
- Video FX: blur, sharpen, denoise, glow, grain, vignette, distortion, stylize, keying, pixelate, color, light, lens, chromatic aberration, echo/time, warp y compositing.
- Audio FX: EQ, compressor, limiter, noise gate, denoise, reverb, delay, chorus, flanger, phaser, tremolo, stereo width, tape/bitcrush.
- Transiciones: dissolve, fade to/from black/white, wipe, push, slide, zoom, iris, page peel, cube y transiciones custom.
- Efectos clip, track, adjustment layer y composition.
- Parámetros keyframeables, easing, interpolation, reset y before/after.
- Paridad preview/export y render determinista como criterio.
- No exponer efectos que no llegan al renderer real.

### 2.7 Color profesional
- Input/output color management y metadata.
- Primary controls: lift/gamma/gain, offset, exposure, contrast, pivot, saturation, vibrance, temperature/tint.
- Color wheels, curves, HSL qualifier, hue-vs-hue/sat/luma.
- LUT 1D/3D, import .cube, preview, enable/disable, intensity.
- Scopes: waveform, RGB parade, vectorscope, histogram, luma/chroma.
- Masks, windows, tracking y power windows cuando existan.
- Comparison split/wipe/reference still.
- SDR/HDR: metadata, bit depth y transfer function explícitos.
- No vender HDR10/HLG como real si decode, color pipeline, monitor preview y export no lo soportan en toda la ruta.

### 2.8 Audio profesional
- Timeline multipista y mixer de buses.
- Gain, pan, mute/solo, track volume, fades y crossfades.
- Keyframe automation, envelopes, ducking, sidechain cuando soporte.
- Waveform, stereo waveform, spectrum, spectrogram y loudness meters.
- Normalize loudness, LUFS-I, LRA, true peak, peak/RMS.
- EQ, compression, limiter, gate, de-esser si disponible, reverb, delay, noise reduction.
- Voice isolation, stem separation cuando haya modelo/servicio real.
- Sync por waveform/timecode, multicam audio and channel mapping.
- Recording voice-over y captura system/mic.
- Audio device selection y monitor level distinto del master output.
- Sample rate/channel conversion, clipping detection y silence detection.

### 2.9 Texto, subtítulos y traducción
- Text/title clips, lower thirds, credits, captions, callouts y chapters.
- Font family/weight/size/line spacing/outline/shadow/background/position.
- Import/export SRT, VTT, ASS/SSA y formatos soportados.
- Speech-to-text, time alignment, segment editing, diarization.
- Caption styles/presets, word highlight, karaoke, speaker labels.
- Translate subtitles, dubbing, voice track alignment.
- Burn-in y sidecar.
- Validar legibilidad, safe area y duración del texto.

### 2.10 Motion graphics, 2D, 3D y VFX
- Keyframes con bezier/ease, hold, linear y graph editor.
- Text/shape/vector/lottie/animated SVG assets.
- Rig/puppet 2D, stickman, bones, inverse/forward kinematics donde sea implementable.
- Particles, physics 2D, paths y motion presets.
- Masks, roto, tracking point/planar/face/subject según engine.
- Camera moves: pan, zoom, dolly, parallax, shake controlado.
- 3D workspace opcional: GLB/GLTF import, scene, models, camera, light, spatial transforms; no bloquear el producto base si el engine no está listo.
- Precomp/nested compositions, reusable templates, variables and expressions si se soportan.
- Compositor nodal typed, cycle validation y execution graph.

### 2.11 Multicam / sync
- Crear multicam desde angle assets.
- Sincronizar por timecode, audio waveform y manual offsets.
- Angle viewer, switch angle en playback, flatten/unflatten.
- Preserve sync en ripple/trim.
- Sync maps y warnings cuando falten streams.

### 2.12 Exportación
- MP4/MOV/WebM y formatos realmente soportados.
- H.264, H.265, AV1, VP9/VP8, ProRes/DNxHR cuando build/runtime y licencias lo permitan.
- AAC, PCM, WAV, Opus según container.
- Profiles, bitrate/CRF, preset, keyframe interval, pixel format, color tags.
- Hardware encoding AMD AMF / NVIDIA NVENC / Intel QSV si detectado; software fallback.
- Export range, sequence, selected clips, batch, variants, stills, GIF.
- Background export, queue, cancel, retry, priority y disk space preflight.
- Render report, ffprobe, decode verification, checksum y delivery packaging.

## 3. Catálogo de creatividad y producción IA

### 3.1 Brief/intent
- Tipo de pieza, objetivo, audiencia, plataforma, duración, idioma, tono, estilo, CTA, marca, assets, presupuesto y restrictions.
- Free text + structured fields; sólo preguntar lo esencial.
- Presets por tipo de vídeo y user preferences.
- Brief versioned and diffable.

### 3.2 Investigación y guion
- Research connectors y fuente por afirmación.
- Resumen, outline, hook, escenas, narration script, shot list, CTA, chapters y disclaimers.
- Separar información verificada, inferencia y creatividad.
- Guion por escena/voz, pronunciación, pronunciación de nombres, pausa, énfasis y timing.
- Regenerar un beat/escena sin romper otras aprobadas.

### 3.3 Storyboard y generación de assets
- Scene cards con objetivo, duración, composición, tipo de plano, luz, cámara y continuidad.
- Image prompts individuales por escena (no collage por defecto).
- Reference images/character bible/style bible y consistency hints.
- Image generation/edit/inpainting/outpainting/transparent background si provider lo permite.
- Video generation from text/image/reference, extend/retake/edit sólo si modelo soporta.
- Asset versions, provider/model, seed, prompt, parameters y provenance.
- Manual approval antes de costos altos si la policy lo exige.

### 3.4 Voz, música y sound design
- TTS remoto/local, voces disponibles reales, idiomas/acento/estilo.
- ASR, transcript y alignment para audio subido.
- Voice consistency/continuity; cloning sólo con consentimiento.
- Music generation o catalog search; duration, mood, tempo, loop, license.
- Sound effects generation/library, timeline placement y sync.
- Ducking, fades, normalize y mix master.
- Usuario puede mantener audio original y desactivar regeneración.

### 3.5 Auto-edit / director
- Shot/scene detection, silence removal, filler-word editing, scene selection.
- Analyze pacing, content, speaker, faces, subject, framing and motion.
- Highlight/short detection, hook, CTA and platform formatting.
- Beat sync, cut suggestions, B-roll insertion.
- Crear variantes comparables sin overwriting source.
- Cada heurística determinista se etiqueta como análisis local; cada output LLM como sugerencia/model result.

### 3.6 Factory / batch / social
- Batch generation, template variants, titles, thumbnails, descriptions, captions, chapters, locale variants.
- Export aspect ratio sets.
- YouTube metadata/analytics only with authorized user connection.
- Publishing is a separate explicit permission; not automatic by default.
- Factory must reject simulated results.

## 4. Catálogo de utilidades / laboratorio
- Download media using permitted source adapters/official APIs; enforce legal terms and user consent.
- Convert/transcode audio/video/image with file probes and safe limits.
- Compress to target size/quality; report trade-offs and preserve source.
- Denoise audio/video; sharpen/upscale/background removal when engine/model exists.
- Compare original/processed assets visually and by measurements.
- Screen/window/region/webcam/mic recording; preview capture, device selection and permissions.
- Image thumbnails, titlecards, visual assets, emojis/stickers and generators.
- File system utilities restricted to allowed project/user paths.
- YouTube-specific analysis, clip extraction and metadata where authorized.

## 5. AI agent and MCP capabilities
- Provider registry and model capability discovery.
- Tool discovery/catalog with dynamic schemas and risk annotations.
- Function/tool calling and output schema validation.
- Conversation context tied to project/selection/timecode.
- Read project, inspect media, propose plan, apply operations, render, verify, cancel and resume.
- Agent operation history, approval gate and undo.
- MCP client: stdio/HTTP transports as compatible with SDK/spec version.
- MCP server: read/write tools, status, tool schemas, permissions, health and audit.
- Persistent jobs and worker; UI is a client, not scheduler.
- Tools for production plan/run/status/cancel/resume/deliverables plus existing editing functions.
- Never grant arbitrary shell, unrestricted filesystem, hidden browser credentials or unrestricted publication.

## 6. Sistema, ajustes y confiabilidad
- Provider settings/keyring, connection test and model list.
- MCP servers, tools, permissions, health and reconnect.
- Model downloads, SHA-256, size, license and storage management.
- GPU/encoder/CPU capabilities, performance profiles and cache.
- Language, theme, shortcuts, autosave, project storage, proxy and export defaults.
- Updates, installer, repair/diagnostics, logs with secrets redacted.
- Backup/recovery, crash recovery, database/schema migration and compatibility.
- Licence/rights reporting, about screen, third-party notices and update policy.

## 7. Regla de mapeo
Cada fila del inventario debe tener capabilityId, existing path, backend operation, UI surface, provider/engine dependency, permission, status, owner, tests and delivery evidence. Los ítems ya reales se conservan; no se reimplementan. Los parcialmente reales se completan. Los ausentes se priorizan por utilidad, riesgo y dependencia. Los no viables por licencia/cuenta/hardware se ofrecen como adapter opcional o se documentan honestamente.

La app se considera funcional cuando los flujos de producción y edición se cierran de punta a punta; no por el número de carpetas o botones.