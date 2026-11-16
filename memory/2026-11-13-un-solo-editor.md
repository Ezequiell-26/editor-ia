# UN SOLO EDITOR — routing unificado, arranque directo, monitor persistente

Fecha: 2026-11-13. Rama: `architecture/refactor-foundation`. Sin commit.
Decisión formal: `docs/architecture/adr/0006-un-solo-editor.md`.

## Regla de producto (del usuario)

"Todo el editor y app se usa en el mismo editor": ninguna herramienta abre
otra pestaña/ventana/pantalla; los cambios se ven en vivo en el video.
Alcance elegido: **todo dentro del editor** + **editor vacío con
herramientas** (sin proyecto también se usa el editor).

## Cambios

- `app/Shell.tsx`: `navigate` resuelve herramienta→modo/panel siempre;
  se eliminó el gate `hasProject` que decidía standalone vs embebido.
- `app/WorkspaceView.tsx`: reescrito — toda `ViewId` monta
  `EditorWorkspace` (modo de flujo, modo de editor, panel `tools`, o
  `SettingsHome` como excepción deliberada). Ya no hay switch standalone.
- `features/editor/EditorWorkspace.tsx`:
  - Rama `!project`: mismo shell con `EditorModeTabs`; `timeline` →
    `EditorEmptyState`, `PROJECT_OPTIONAL_MODES` → contenido real con su
    empty-state, resto → `EditorNeedsProject`.
  - Modos no-timeline: `.editor-mode-split` = panel de herramienta +
    `.editor-mode-monitor` (Preview + Transport, ~340 px, plegable con el
    botón «Monitor» de la barra de contexto). Estado `modeMonitorHidden`.
- `App.tsx`: `showStart` ya no arranca en `true` — la app abre directo en
  el editor; `enterEditorWindowMode()` cubre el boot. `StartScreen` sigue
  accesible desde «Inicio» del topbar (updater, onboarding, recovery,
  recientes, crear proyecto).
- `styles/editor-tools.css`: `.editor-mode-split` / `.editor-mode-monitor`
  (+ breakpoint 1120 px → 280 px).

## Tests

- `App.test.tsx` 80/80, `a11y-shell` 6/6, `ProjectHome` 5/5,
  `LottiePanel`+`MotionView`+teclado ajustados a contenido lazy dentro del
  editor (`findBy`/`waitFor`). Typecheck verde.
- Tests actualizados que afirmaban el contrato viejo (pantallas
  standalone): ahora verifican modo/panel dentro del editor y retorno
  persistente. Sin proyecto no hay `.timeline-panel` (no hay documento).

## Pendientes honestos

- Efectos "solo export" aún no se reflejan en el preview en vivo.
- `SettingsWindow`, preview desacoplado y monitor dual siguen siendo
  ventanas opcionales explícitas (no navegación normal).
- `apps/render-worker`, `apps/motion-mcp`, `extensions/*` siguen siendo
  piezas externas/manuales (deuda ya documentada en el tracker).

## Verificación E2E (misma sesión, post-cambios)

- `npm run typecheck`: exit 0.
- `npm run test:serial`: 336 archivos, 2984 tests verdes (3 skipped
  preexistentes).
- `npx playwright test` (e2e completo): 36 passed, 1 skipped, 0 failed.
- `npm run build --workspace=apps/desktop`: exit 0 (18.6 s; warnings de
  chunk size/lottie preexistentes).

### Arreglos E2E que hicieron falta tras la unificación

- `e2e/helpers.ts` `enterApp()`: espera `.editor-workspace` antes de
  volver — elimina la carrera donde Ctrl+K llegaba antes de que Shell
  instalara el listener de teclado.
- `app/Shell` rail: `.editor-workspace` tenía `z-index: 90`
  (filmora-polish.css) y tapaba el popover «Más» del rail (z 20); se subió
  el stacking del rail.
- `e2e/theme.spec.ts`: el probe del botón primario acepta
  `.theme-preview-primary` (span, no button — fix axe nested-interactive
  del WIP); umbral de repintado de panel ajustado a 4 superficies
  (`--color-panel` afecta menos elementos con vars `--fm-*`).
- `e2e/css-audit.spec.ts`: snapshots regenerados (13) por el cambio
  intencional de layout; se agregó espera de `document.fonts.ready` +
  estado settled del proveedor en AI Hub — el diff fantasma de 576 px
  era wrap de texto por webfont tardía, no un bug visual.

## Preview en vivo: efectos que antes eran "solo export" (misma sesión)

Para cumplir "todos los cambios se ven en vivo", se portaron tres campos de
`ClipEffects` que el monitor ignoraba:

- **`fadeInFrames`/`fadeOutFrames`** (`Preview.tsx`): nuevo helper puro
  `clipFadeOpacity` — rampa lineal de alfa idéntica al `fade=t=in/out:
  alpha=1` de `render/ffmpeg/visual/filter.rs`, multiplicada en la opacidad
  de `transformStyle`. Tests: `PreviewFade.test.ts` (6).
- **`hueRotateDeg`** (`effectsToCss`): `hue-rotate()` CSS; el export usa el
  mismo campo en `curves.rs`/`filter.rs`.
- **`sharpen` plano** (`color-engine.ts` + `Preview.tsx`):
  `clipSharpenSpec` emite `feConvolveMatrix` con la misma aproximación
  `amount*0.35` que el sharpen del grade; va después de las curvas como el
  `unsharp` del export. Tests: `color-engine.test.ts` (+2).
- **`glow`** (`color-engine.ts` + `GradeFilterDefs.tsx` + `Preview.tsx`):
  `clipGlowSpec` encadena `feComponentTransfer` (crush por umbral, como
  `colorlevels rimin`) → `feGaussianBlur` (sigma=radius) → `feComponentTransfer`
  (atenuación por intensidad) → `feBlend mode="screen"`, replicando
  `apply_glow_to_chain` del export. `SvgPrimitive`/`GradeFilterDefs` ahora
  soportan `feBlend`. Tests: `color-engine.test.ts` (+2).
- **`curves` + `curvePreset`** (`color-engine.ts` + `Preview.tsx`):
  `clipCurvesSpec` compila puntos propios o preset a `feComponentTransfer`
  por canal (48 samples, piecewise-linear — aproximación ya documentada en
  `project-schema/curves.ts`; FFmpeg usa spline natural). Los presets se
  copiaron de `libavfilter/vf_curves.c` (n7.1) y la composición
  `master(canal(x))` replica `graph[i][j] = graph[master][graph[i][j]]`.
  Las defs las colecciona `gradeSpecs` con la misma proyección
  `applyGradeProjection` que usa `effectsToCss` (colorGrade sigue siendo
  autoridad sobre los campos planos). Tests: `color-engine.test.ts` (+5).

### Siguen export-only (honesto)

- **`vignette`** (`color-engine.ts` + `GradeFilterDefs.tsx` + `Preview.tsx`):
  `clipVignetteSpec` → `feImage` con gradiente radial data-URI +
  `feBlend multiply`. `SvgPrimitive`/`GradeFilterDefs` soportan `feImage`.
  **Datos duros**: en Chromium `feImage` same-document NO pinta (usar
  data-URI) y `box-shadow: inset` NO cubre `<img>`/`<video>` (verificado con
  screenshot+decode). Tests: `color-engine.test.ts` (+4).
- **`relight`** (`color-engine.ts` + `Preview.tsx`): `clipRelightSpec` →
  `feImage` con gradiente radial por canal + `feBlend screen`/`multiply`
  (ganancias +/-, dos pasadas encadenadas si mixtas). Aproximación del `geq`
  aditivo del export. Tests: `color-engine.test.ts` (+5).
- **`chromaKey`** (`color-engine.ts` + `GradeFilterDefs.tsx` + `Preview.tsx`):
  `clipChromaKeySpec` → tablas `|x−k|` + `feFuncA` threshold + `feComposite
  in`. Soporte nuevo: `feFuncA` y `feComposite` en `SvgPrimitive`/defs.
  **Verificado en Chromium** (screenshot+decode: verde eliminado, rojo
  conservado). `spill` no simulado. Tests: `color-engine.test.ts` (+4).
- **`denoise`** (`Preview.tsx`): `clipDenoiseBlurPx` → `blur(min(1,d)*1.4px)`
  en `effectsToCss`. Aproximación espacial del `hqdn3d` del export (temporal
  no reproducible en CSS). Tests: `PreviewFade.test.ts` (+3).
- **`audioStack`**: ya estaba cubierto — `clipAudioFxSpec` mapea la cadena
  a nodos Web Audio en el orden del render (`Preview.tsx` ~958).
- **`stack` (WebGL)** (`Preview.tsx` + `vfx/EffectCanvas.tsx`):
  `clipPreviewStack` devuelve `effects.stack` (audición incluida); con
  WebGL disponible `VideoLayer`/`ImageLayer` renderizan `EffectCanvas`
  sobre un wrapper `.preview-media` con el mismo transform/efectos/máscara
  y el medio a `opacity: 0` (sigue decodificando/sonando). `EffectCanvas`
  exporta `WEBGL_AVAILABLE` y acepta `style`. **Orden invertido vs export**:
  el export hace `stack(grade(crudo))`; la preview `grade(stack(crudo))`
  porque el canvas no puede leer los filtros CSS del frame. Tests:
  `PreviewFade.test.ts` (+3). **Verificado en Chrome real**: bundle esbuild
  de effect-kit + Playwright — fuente rojo/azul → `retro.grayscale` da
  gris (54,54,54 / 18,18,18); stack vacío pasa el frame intacto.
- **Suite serial completa post-cambios**: `npm run test:serial` →
  **337 archivos, 3018 tests verdes, 0 fallos** (3 skipped preexistentes).
- **AUD-039 (auditoría 2026-11-11)**: `useWaveform` asumía 30 fps para
  assets sin `media.frameRate` → duración errada en proyectos ≠30 fps.
  Fix: `waveformDurationSeconds` usa `media.frameRate` → `projectFps`
  (nuevo parámetro del hook, callers de Timeline pasan `fpsOf(project)`)
  → 30. Tests: `useWaveform.test.ts` (+5).
- **AUD-076 (auditoría 2026-11-11)**: `SubtitlePipelineCard` mandaba
  `burn=true` (default) sin `outputPath` → el backend rechazaba toda
  llamada antes de transcribir. Fix: `defaultBurnOutput()` deriva
  `<nombre>.subtitulado.mp4` junto al video y la UI la muestra; sin
  burn no se envía outputPath. No hay IPC genérico de save-file — los
  `blocking_save_file` de Rust son internos de package/publish/render.
  Tests: `SubtitlePipelineCard.test.tsx` (+4, 6/6) · typecheck exit 0.
- **AUD-076 timecodes (auditoría 2026-11-11; la auditoría tiene DOS
  AUD-076: éste y el de subtítulos)**: `parse_timecode` en
  `media/timeline_import/otio.rs` hacía `hours*60*60*nominal` sin
  checked → overflow u64 con horas enormes (panic debug / wrap release).
  Fix: `checked_*` en toda la cadena → `None` → warning+skip (EDL) u
  `unwrap_or(0.0)` (FCPXML). Tests: `timeline_import.tests.rs` (+3);
  `cargo test --lib timeline_import` 31 ok/2 ignored · rules 20/20.
- **AUD-077+078 subtítulos (bloque 1 de la auditoría)**:
  `commands/domains/creator/subtitles_pipeline.rs` — FFmpeg ya no se
  exige con `burn=false` (AUD-078) y los temporales del burn son únicos
  por ejecución vía `unique_run_tag()` pid+nanos (AUD-077): tmp.mp4 y
  un `.burn.ass` privado por corrida. `.ass` canónico sigue
  último-escritor-gana; lock por destino = mejora futura. Verificación:
  `cargo check` 0 errores · `cargo test --lib subtitles` 26/26.
- **AUD-079 subtítulos: ya estaba resuelto** — la auditoría describía
  `Command::output()` síncrono, pero AUD-030/008 ya migraron todo a
  `spawn_blocking` (run_native con watchdog, Python con timeout, burn
  FFmpeg 2 h, probe_size). Sólo quedan `std::fs::write` de archivos
  chicos. Documentado como resuelto-por-evidencia.
- **AUD-077 lip-sync (bloque 2, P1)**: `request_lipsync` leía
  `response.bytes().await` completo antes del tope de 200 MB y
  `text().await` sin tope en errores. Fix: `read_body_capped()` con
  Content-Length preliminar + chunks con corte estricto + error-body
  capeado a 64 KiB + sin `to_vec()`. Tests: servidor HTTP crudo en
  loopback, `cargo test --lib lip_sync` 7/7.
- **AUD-080 Creator (P1)**: el FFmpeg empaquetado NO tiene libx264
  (verificado con `-encoders`: sí libopenh264/h264_mf/h264_amf/nvenc/qsv).
  Aspect/chapters/broll/hook/cta/subtitles-burn y shorts/export forzaban
  `-c:v libx264` → `Unknown encoder`. Fix: `h264_encoder_args()` en
  `commands/domains/system/system.rs` detecta el encoder real y arma los
  args (libx264 → preset/crf; openh264/h264_mf → `-b:v 8M`).
  Verificación: encode real con el binario empaquetado OK · tests
  creator 8/8, shorts 4/4.
- **AUD-081 Creator (P2)**: `output_mp4` + `-y` global + nombres
  deterministas del frontend → re-exportar truncaba la salida previa.
  Fix: `unique_output_path()` sufija `-2`/`-3` si existe (como shorts);
  cubre hook/cta/broll/subtitles vía `output_mp4` y aspect/chapters en
  sus joins inline. `CreatorOutput.path` refleja la ruta real.
  Tests: creator 9/9.
- **AUD-082+083 rutas**: el WIP ya había alineado `service.rs` para
  aceptar `.`; `media/mod.rs::is_forbidden_relative` aún lo rechazaba
  (proyecto válido → medios fallaban) y medía 512 en bytes UTF-8 vs
  chars en service. Ahora acepta `.` y cuenta `chars().count()`.
  Tests: `cargo test --lib media::` 166/166. Residual: zod UTF-16 vs
  chars difiere sólo con emoji (dirección segura).
- **Siguen export-only de verdad**: `lensCorrection` (warp por malla),
  `motionBlur` (mezcla de frames `tmix`), `lutFile`/`lutIntensity` y
  `cameraProfile` (LUT `.cube` 3D real — `camera_lut_path` en
  `visual/camera_log.rs`), `audioStack` (es cadena de audio, no visual),
  `spectrum` (render `showfreqs` no reproducible en preview).
- **AUD-067/119+084 encoders (P1)**: upscale de vídeo fijaba libx264 y
  conversión devolvía libx264/libx265 para Software y fallback Auto —
  ausentes del bundle LGPL (que sí trae libopenh264, libkvazaar,
  h264_mf, hevc_mf). Fix: `detect_hardware` (render/ffmpeg/probe.rs)
  ahora sondea también software (SW_H264/SW_HEVC con `first_working` =
  listing + init real) y los expone en `HardwareEncoders.h264_software`/
  `hevc_software` con `#[serde(skip_serializing)]` (IPC intacto);
  `h264_encoder`/`hevc_encoder` los usan y los no-x264 caen bien en la
  rama de bitrate de `push_rate_control`. Upscale usa
  `commands::sharpen::resolve_encoder` + `video_codec_args` (mismo
  mecanismo que denoise; libx264 pasa de preset medium a slow).
  Verificación: `cargo test --lib conversion` 25/25 (+test nuevo
  Software→libopenh264), `--lib ffmpeg` 181/181, probes reales del
  bundle: libopenh264 y libkvazaar codifican exit 0. Restan literales
  libx264 por revisar: toolbox.rs, intelligence.rs, best_frame.rs,
  dubbing.rs, transforms.rs, project_executor.rs, render_executor.rs.
- **Barrido libx264 — toolbox + proxies**: `media/toolbox.rs` (merge/
  trim/watermark) fijaba libx264; ahora recibe `codec_args` del caller y
  `media_tools.rs` resuelve encoder+args con `sharpen::resolve_encoder`/
  `video_codec_args` (ffprobe ya estaba resuelto; fallback dims 1080p30).
  `proxy_video_args` caía a libx264 sin GPU → proxies rotos en el
  bundle; ahora recibe el encoder resuelto (hw→h264_software vía
  `detect_hardware_cached`) y cubre libx264 explícito + fallback
  `-b:v 4M` para openh264/mf/vaapi. Callers: `infrastructure/proxies.rs`,
  `media/color_proxy.rs`. Tests: toolbox 8/8, prox 13/13, audio 3/3.
  Descartados (fixtures de test): intelligence, best_frame, dubbing,
  project_executor, render_executor. **Pendiente**: downloader
  `compress_video` (libx264/libx265 + preset/crf por familia, con
  hdr/av1/tamaño-objetivo) — ciclo propio.
- **compress_video del downloader (cierre familia libx264)**: era el
  último `libx264`/`libx265` de producción. `plan.codec` (h264/h265/av1)
  ahora se traduce a encoder real: av1→libaom-av1, h264→
  `sharpen::resolve_encoder` (init real + caché), h265→
  `detect_hardware_cached().hevc`→`.hevc_software`. Args por familia vía
  `video_codec_args_preset` (nuevo en sharpen/probe.rs: preset
  parametrizable + rama libx265). `probe_dims` (ffprobe, fallback
  1080p30) alimenta el bitrate de los no-CRF; tamaño-objetivo usa
  -b:v/-maxrate/-bufsize para todos; `-preset` sólo x26x; HDR conserva
  medium y la guarda h265|av1 sigue primero. Reorden SW_H264/SW_HEVC:
  MF antes que CPU frágiles (criterio screen_record). Hallazgos
  medidos: libkvazaar exige dims múltiplo de 8; hevc_mf roto en este
  Windows (probe lo filtra). Verificación: check exit 0, downloader
  60/61, live target_size ok (ffmpeg sistema/libx264), ffmpeg 181/181,
  encodes reales bundle: openh264+h264_mf@320x180 ok, kvazaar@320x192 ok.
- **AUD-080+081 diarización**: `normalize_diarize_config` aceptaba
  http remoto (clave+audio en claro) → ahora usa
  `ai::providers::validate_provider_base_url` (https remoto, http sólo
  loopback, sin userinfo) y `SpeakersSection` valida con
  `providerUrlProblem`. `diarize_audio` leía el archivo entero sin
  límites → tope 2 GiB (metadata), duración >4 h vía ffprobe cuando es
  medible, subida streaming `tokio::fs::File`→`reqwest::Body` (features
  `stream`/`fs` nuevas; Cargo.lock sumó wasm-streams+tokio-util) y
  respuestas JSON capeadas a 64 MiB con `read_body_capped`. Tests:
  diarize 10/10, typecheck 0, rules 20/20. Residual: duración sólo si
  ffprobe mide; probe_file síncrono en handler async (deuda conocida).
- **AUD-082 voice_clone + helper compartido**: `request_clone` leía
  `bytes()` completo antes de validar 20 MB, `text()` sin tope en
  errores y devolvía `to_vec()`. El patrón existía duplicado en
  lip_sync/diarize/audio_providers → nuevo
  `infrastructure::http::read_body_capped` re-exportado por
  `commands/mod.rs` (excepción documentada); los 4 sitios migrados.
  voice_clone: éxito capeado a 20 MB, error a 64 KiB, Vec sin copia.
  Test nuevo: Content-Length >20 MB rechazado sin leer cuerpo.
  Verificación: check 0, voice_clone 7/7, lip_sync 4/4, audio_providers
  2/2, http 3/3, rules 20/20.
- **AUD-086 doblaje**: `stderr` de FFmpeg en `synthesize_dub_file` se
  drenaba después de `wait()` → deadlock si la pipe se llenaba. Ahora un
  thread lector lo drena desde el spawn con cola acotada de 64 KiB (el
  informe usa la última línea). AUD-085 ya estaba resuelto (spawn_blocking
  por AUD-030). Tests: dubbing 7/7, check 0.
- **AUD-083+084 temporales huérfanos**: guard RAII `TempFile`
  (`commands::dialogue`, `pub(crate)`, drop borra / keep publica) cubre
  `.voz-*.f32/.wav` en dialogue (write_all, encode, probe) y el WAV SAPI
  de narration, que ahora sintetiza en `.narracion-<uuid>.wav` oculto,
  valida probe+sha256 y publica con rename — ningún fallo deja medios
  sin asset ni temporales en la salida. Test del guard + check 0,
  dialogue 4/4, narration 5/5, rules 20/20.
- **AUD-087 diarize por asset_id**: `diarize_audio` aceptaba ruta
  absoluta arbitraria (política fs_* solamente) y la subía al proveedor.
  Ahora recibe `asset_id`, `require_session` + `resolve_audio_asset`
  (proyecto abierto, kind video/audio, path relativo dentro del root).
  Contrato TS `diarizeAudio(assetId, language)`; SpeakersSection y
  mcp-tools pasan el id y dejan de armar `root\media\...`. Verificación:
  check 0, diarize 7/7, typecheck 0, rules 20/20.
- **AUD-088+089 modelos**: `stream_download` ahora toma `max_bytes` y
  aborta al superarlo; descarga directa tope=`file.bytes`, ZIP tope =
  `archive_byte_cap` (2× bytes esperados de sus entradas + 1 MiB);
  extracción aborta apenas `written > file.bytes` y TODO error borra el
  `.partial`/`.zip.partial`. `download_model` reserva por `model_id` con
  Mutex async estático + re-verifica al entrar. Tests: models 12/12
  (+2 nuevos: cap HTTP y ZIP oversized con limpieza). Residual:
  `delete_model` no comparte el lock.
- **AUD-090 skills serializadas**: `PluginsCard.runCommand` ya no usa
  `setTimeout(600ms)` — cada paso espera el `onResult(reply, ok)` del
  anterior y cancela el resto si falla (timeout 10 min por paso).
  `AssistantDock` serializa el puente `olyvia:run-command` con una
  promise-chain (`commandQueueRef`) y reporta ok al emisor. Test nuevo:
  orden + cancelación en skill de 3 pasos. typecheck 0, PluginsCard 6/6,
  AssistantDock 37/37.
- **AUD-091 plugins.json**: escritura atómica tmp+sync+rename con backup
  `plugins.json.bak`; lectura fail-safe — JSON corrupto intenta backup y
  si no hay, `corrupted=true` y `scan` deshabilita TODOS los plugins en
  vez de reactivarlos. `read_state_in`/`write_state_in` testeables por
  dir inyectado. Tests: plugins 6/6 (+2). Residual: settings.json y otros
  configs repiten el patrón no atómico.
- **AUD-092+093 extensión**: `copy_dir` de extension.rs ahora rechaza
  symlinks/archivos especiales en cada nivel (`file_type`, no sigue
  enlaces) y `extension_source` ya no acepta `current_dir` como origen.
  `prepare_extension` es transaccional: staging hermano
  `editor-ia-downloader.staging` + manifest obligatorio +
  `publish_extension` con backup `.previous` restaurable si el swap
  falla. Tests: extension 12/12 (+2: rechazo de symlink real y swap con
  restauración).
- **AUD-094+095 grabación**: `RECORDING` ahora es `Mutex<RecordState>`
  (Idle/Starting/Active/Stopping) — `start` reserva `Starting` antes de
  lanzar ffmpeg dentro de un `async move` (todo `?`/`return Err` interno
  libera a `Idle`), `stop` hace `Active→Stopping` y lo mantiene hasta que
  el proceso cierra (`RecordingStopGuard` cubre todas las salidas).
  `status` reporta grabando en Starting/Stopping. Nombres únicos
  `screen-<stamp>-N.mp4` (antes `-y` pisaba colisiones del mismo segundo).
  Cursor burn transaccional: backup rename + restore si falla el swap.
  OJO: `return` dentro de `async {}` sale del bloque (verificado con
  rustc — no de la función externa). Tests: screen_record 11/11 (+2).
- **AUD-096+097 escenas OBS**: la stream key ya no se persiste —
  `stream_url` es `skip_serializing` (sólo entrada IPC), endpoint va a
  `streamEndpoint` en obs-scenes.json y la clave al Credential Manager
  (`editor-ia.obs-scenes`/`obs-scene:<id>`). `split_stream_url` separa
  por último segmento ≥8 chars; `prepare_scene_for_save` preserva la
  clave en ediciones que no la tocan, `streamEndpoint:''` la limpia, y
  llavero caído = guardado abortado (nunca plaintext). Migración
  perezosa de escenas viejas en cada comando. `SCENES_LOCK` +
  `write_scenes` atómico (tmp+rename). Frontend: contrato
  `streamEndpoint`, form precarga endpoint, campo vacío = limpieza.
  Residual: split asume clave en último segmento; stream directo (no
  escena) no persiste pero AUD-098 (stderr) sigue pendiente.
  Tests: obs_scenes 10/10 (+2), typecheck 0, RecordView 8/8.
- **AUD-098+099 stream key y try_wait**: la cola stderr de ffmpeg se
  redacta en cada chunk del drain (URL completa + clave suelta ≥8 chars,
  cubre secretos partidos entre lecturas) y `status_inner` redacted una
  segunda vez antes de devolver el error por IPC. `try_wait Err` ya no
  equivale a muerto: kill + confirmación acotada; si no se confirma, el
  estado se conserva y se reporta error honesto (stop igual: kill+2s
  antes de devolver Err). Tests: screen_record 13/13 (+2).
- **AUD-100 token puente**: `downloader-bridge.token` en texto plano +
  error ignorado → ahora Credential Manager
  (`editor-ia.downloader-bridge`/`token`). Migración: archivo legado
  válido se adopta al llavero y se borra (extensión emparejada sigue
  andando); fallo de llavero = puente no arranca (info lo reporta). La
  persistencia salió de application a commands (`stored_bridge_token`).
  Tests: downloader_bridge 7/7 (+1).
- **AUD-101 Flow Queue modelo aproximado**: `applyModel` caía a
  `options[0]` por match "contiene" y devolvía `verified:true` — podía
  generar con la variante equivocada (Veo 3 → Veo 3 Fast). Ahora
  `adapter.modelNamesMatch` exige igualdad normalizada (case+espacios)
  para TODO click; sólo aproximados → `{verified:false, via:'ambiguous'}`
  sin clicar (selección manual). `findModelCandidates` queda como
  descubrimiento. `applySettings` ya se auto-verificaba por regex.
  Tests: flow-queue 33/33 (+2).
- **AUD-135 SHA-256 ficticio (P1, supervision-1509)**: `folder-queue.ts`
  declaraba `integrity.sha256='0'.repeat(64)` con asset `ready`. Ahora
  `copy_media_files` (Rust) hashea el archivo ya copiado con
  `media::sha256_file` y devuelve `CopiedMedia.sha256`+`bytes` del
  destino; el contrato TS lo exige y `folder-queue` frena el archivo si
  el digest no es hex-64. Tests: variants 5/5, folder-queue 6/6 (+2),
  typecheck 0, rules 20/20.
- **QUEUE-140+AUD-136 cola por carpeta**: derechos comerciales ya no se
  infieren — `rightsConfirmed` obligatorio (fail-fast antes de copiar;
  panel con checkbox destildado que habilita el botón). `deliveryStem`
  agrega la extensión al nombre de entrega (`toma-mp4`/`toma-mov`) —
  chau colisión `escena.mov`/`escena.mp4`. Tests: folder-queue 8/8 (+3).
- **AUD-138+139 variantes/cola**: `mirror_assets` ya no reutiliza por
  tamaño — hashea ambos lados (fail-closed si no puede verificar) y
  revierte las copias que creó si una posterior falla. `folder-queue`
  registra `createdPaths` (media copiada + .editoria.json) y los borra
  vía `deletePath` en cualquier fallo post-copy. Tests: variants 7/7
  (+2), folder-queue 9/9 (+1), typecheck 0, rules 20/20.
- **AUD-127 thumbnails**: `save_thumbnail` decodificaba Base64 entero y
  validaba dims después. Ahora tope de payload (~89,5M chars) antes de
  decode + `into_dimensions` lee el header sin rasterizar + `decode()`
  con `image::Limits` (16.384px / 2GiB alloc). Test con PNG 1×1 cuyo
  IHDR se patcheó a 20.000×20.000 → rechazado por header. 6/6.
- **SEC-GATE-001/002**: `security-audit.mjs` ahora reporta PASS/FAIL/
  SKIPPED/ERROR por escáner — un escáner que no corre es ERROR→FALLA,
  no "OK". Bloquea critical Y high; excepciones sólo vía
  `scripts/security-audit-allowlist.json` (package+severity+advisory+
  reason+owner+expires; vencida/incompleta no cuenta). Primera
  excepción: zod high GHSA-mrhx-c7xc-m3w5 hasta 2026-12-31. Residuales:
  SEC-GATE-003 (omit=dev), 004 (sin commitear).
- **SEC-GATE-005**: Vite `server.host` ahora `EDITOR_IA_DEV_HOST ??
  '127.0.0.1'` y `dev` sin `--host` — loopback por defecto, LAN opt-in
  por env. Verificado con vite real en :3999 → sólo 127.0.0.1.
  Residual: el dev server vivo en :3000 conserva 0.0.0.0 hasta reiniciar.
- **AUD-136 residual**: `write_project_document` ahora fail-closed
  (AlreadyExists si el `.editoria.json` existe) y la cola asigna stems
  únicos por corrida (`uniqueStem` → `-2`). Antes dos archivos con mismo
  stem saneado compartían JSON y el rollback borraba el ajeno; una
  re-corrida pisaba el JSON previo antes de fallar en el render.
  Re-corridas sobre la misma salida ahora fallan honesto: usar otra
  carpeta. Rust variants 8/8, folder-queue 11/11, typecheck 0, rules 20/20.
- **UI-003**: MinimalEditor leía `clip.start`/`clip.duration` (inexistentes)
  → todos los bloques de timeline en left:0. Ahora usa
  `startFrame`/`durationFrames` canónicos. Test con clips en frames 0 y
  300 verifica left/width. MinimalEditor 5/5, typecheck 0.
  Residuales UI-001/002 (dos árboles, controles no operativos) abiertos.
- **UI-001 parcial**: `usePlayback()` en MinimalEditor abría un segundo
  rAF sobre el mismo store (EditorWorkspace ya corre el motor debajo).
  Eliminada la llamada duplicada — MinimalEditor sólo se monta junto al
  workspace. Tests 10/10, tsc 0. El doble montaje DOM sigue siendo deuda
  deliberada (~80 tests + modos de herramientas).
- **UI-002 parcial**: monitor de MinimalEditor ahora compone el frame
  real del playhead vía `renderPreviewFrame(composite:true)` (debounce
  300ms, sin renders durante playback). PNGs de `public/alaukcut/`
  sólo en harness. Residual: no anima en reproducción (evita segundo
  motor); sliders del inspector siguen decorativos. Tests 11/11, tsc 0.
- **SEC-GATE-003**: security-audit ahora corre `npm audit` completo como
  pase INFO — paquetes sólo-dev (tinypool/vitest/vite critical+high)
  visibles sin bloquear runtime. Hallazgo real: vitest 2.1.8 tiene
  critical RCE con fix en 2.1.9 — `npm install` bloqueado por hook,
  pendiente OK del usuario. vite 5.x highs requieren major (vite@8).
- **UI-002 parcial 2**: los sliders/wheels del inspector de MinimalEditor
  (tabs video + color-*) son spans de la réplica con valores fijos —
  parecían operativos. Se agregó aviso visible "Prévia visual — estes
  controles ainda não alteram o clipe." en esas tabs (alternativa
  honesta del audit mientras se conecta a propiedades reales del clip).
  Test nuevo InspectorPanel.test.tsx. Residual: conexión real pendiente.
- **UI-002 parcial 3**: TimelinePanel pintaba en producción 3 ClipStrip
  demo (thumbs alaukcut) + waveform falsa "audio para testes.mp3" debajo
  de los clips reales cuando scene='media' (auto tras importar assets).
  Nuevo prop `demoContent` opt-in; MinimalEditor pasa IS_HARNESS. Resto
  del demo (AvatarMeter, PlaybackBar, SceneNav, stage studio) ya estaba
  acotado. Tests TimelinePanel 2/2, suite minimal 19/19, tsc 0.
  Residual: clips reales sin thumb/waveform propios (useWaveform existe).
- **UI-002 parcial 4**: los .me-clip de MinimalEditor ahora dibujan la
  forma de onda real — ClipWave usa useWaveform (audio_peaks FFmpeg +
  caché) + peaksForWindow sobre inFrame/outFrame del source. clipBlocks
  transporta kind/assetId/inFrame/outFrame; TimelinePanel recibe
  service/root/assets/fps. Sin datos → bloque liso. Tests 20/20, tsc 0.
  Residual: thumbs por clip; hasta 24 useWaveform (gate nativo=2).
- **UI-002 parcial 5**: ClipWave → ClipMedia — cada clip con asset
  muestra thumbnail real (useThumbnail, gate 4 + caché) además de la
  onda. Video/audio: thumb+onda; imagen: sólo thumb. 20/20, tsc 0.
  Residual UI-002: conectar controles del inspector a propiedades
  reales (refactor grande).
- **UI-002 parcial 6**: runLabel ahora avisa «label» todavía no tiene una
  acción cuando resolveAction da null (antes: click mudo). Auditoría:
  todos los controles visibles ya están cableados (TOOL/MENU_ACTIONS +
  test que lo impone). Test ActionProbe nuevo. 15/15, tsc 0.
- **P3**: borrados `nul`/`src/nul` (basura de `2>nul` en bash) y
  metadatos de index.html pasados a español. Auditoría de catches
  vacíos y a11y restante: todo en WIP ajeno o intencional — no tocado.
- **Verificación de sesión**: vitest src/features/editor+src/state
  1424/1425 — único fallo render-cost (38,9 ms/tick bajo paralela vs
  umbral 25; aislado 11,8 ms/tick y verify usa test:serial → flake
  documentado, no regresión). security-audit PASS, rules 20/20.
- **UI-002 parcial 7**: VideoInspector muestra el transform REAL del clip
  seleccionado (scaleX→Escala, offsetX/Y→Posição, rotationDeg→Girar,
  opacity→Opacidade studio). clipTransform prop en InspectorPanel;
  MinimalEditor lo resuelve de selectedClipId. Lectura real, no edición.
  22/22, tsc 0. Residual: escritura vía updateClip = pasada siguiente.
- **UI-002 parcial 8**: los campos de Transformar del inspector mínimo
  YA ESCRIBEN. NumberField/SliderRow ganan modo editable opt-in
  (onCommit → <input type=number> real, commit al blur/Enter); sin
  onCommit quedan los spans de la réplica. MinimalEditor.commitTransform
  mergea el patch sobre clip.transform ?? {} y llama store.update +
  updateClip (mismo camino que TransformSection: historial,
  parseProject, pista bloqueada → catch→notice). transform es opcional
  en schema → MinimalEditor normaliza a defaults con clip seleccionado
  (clip recién creado también editable). Unidades = inspector real:
  Escala %→scaleX/100 clamp 0.01-100, Posição px int, Girar ±360,
  Opacidade %→0-1 sólo studio. Bug real: Number('')===0 commiteaba 0
  al blurar campo vacío → ahora vacío/no-numérico no escribe. Aviso
  afinado: «Transformar edita el clip — los demás controles…». Tests:
  InspectorPanel +1 (commit + rechazo NaN), MinimalEditor +1 e2e
  (click clip → Mídia → Girar 45 → transform.rotationDeg===45 en store).
  OJO fixture: addClipFromAsset NO registra el asset en project.assets
  → parseProject rechaza toda edición; el test lo agrega a mano.
  24/24, tsc 0. Residual: slider/flechas decorativos, Escala uniforme,
  keyframes, tabs Cor/Audio/Animação sin escribir; UI-001 completo,
  audio del monitor, vite 8 pendientes.
- **UI-002 parcial 8 (addendum)**: «Escala uniforme» ahora es real —
  Toggle gana variante role=switch cuando recibe onToggle (misma visual,
  .me-toggle-btn sin cromo). Activo → Escala escribe scaleX+scaleY;
  apagado → sólo scaleX. scaleY queda alcanzable sólo por uniforme o el
  inspector completo. InspectorPanel 4/4, tsc 0.
- **UI-002 parcial 8 (addendum 2, a11y)**: inputs editables del
  inspector mínimo con aria-label propio (Escala/Posição X/Y/Girar/
  Opacidade) vía prop ariaLabel en NumberField/SliderRow — antes todos
  decían "Valor numérico". Tests migrados a getByRole('spinbutton',
  {name}). 14/14, tsc 0.
- **AUD-091 residual**: save_settings (state.rs) ahora escribe
  settings.json atómico — tmp+write_all+sync_all+rename, cleanup del
  tmp en error. Sin .bak porque la carga ya cae a Settings::default()
  sanitizados. state.rs tenía WIP ajeno aditivo en regiones disjuntas
  — cambio quirúrgico. cargo check 0, fmt limpio, rules 20/20.
  Residual: otras rutas de persistencia de config sin auditar.
- **AUD-091 residual (addendum)**: proxies.json (flow_profiles.rs)
  ahora atómico — un archivo truncado se leía como mapa vacío y las
  cuentas salían a Flow sin proxy (mezcla de IPs). Todas las escrituras
  de ajustes ya pasan por save_settings atómico. flow_profiles 2/2,
  cargo check 0, fmt limpio.
- **AUD-091 residual (addendum 2)**: render-queue.json
  (infrastructure/render_queue.rs) ahora atómico — un corte truncaba
  la cola y read_entries devolvía vacío (renders pendientes
  desaparecían). production_store ya era atómico. Test nuevo con el
  constructor #[cfg(test)] at(path): round-trip + sin .tmp residual.
  render_queue 8/8, fmt limpio.
- **AUD-091 residual (addendum 3)**: downloader_bridge/jobs.rs
  download_image — corte de conexión a mitad dejaba imagen truncada
  en Descargas; ahora read/write errors borran el parcial. Resto de
  la auditoría: engine.rs yt-dlp, local_catalog, memory.rs,
  production_store ya atómicos. cargo check 0, fmt limpio.
