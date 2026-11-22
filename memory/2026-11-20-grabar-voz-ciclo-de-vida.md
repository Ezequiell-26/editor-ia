# 2026-11-20 · VoiceoverRecorder: ciclo de vida async (AUD-141/145/143)

Cierre de AUD-141, AUD-145 y AUD-143 (P1, supervisión 2026-11-19) en
`apps/desktop/src/features/editor/VoiceoverRecorder.tsx`.

## Qué se arregló

- Doble/triple clic durante `await getUserMedia`: `phaseRef` quedaba
  `idle` y cada clic lanzaba una solicitud concurrente que pisaba
  `streamRef`/`chunksRef` → micrófono activo sin referencia. Ahora la
  fase `requesting` se fija síncrona antes del await (botón disabled,
  guard `!== 'idle'` la bloquea).
- Desmontaje durante el permiso: el cleanup corría antes de que existiera
  `streamRef`, así que un permiso concedido tarde creaba un MediaRecorder
  huérfano. `startTokenRef` se incrementa al iniciar y al desmontar; una
  respuesta tardía suelta los tracks y no toca estado.

## Detalles que importan

- `RecorderPhase` ahora es `'idle' | 'requesting' | 'recording' | 'importing'`.
  Consumidores: `TeleprompterView.handleVoicePhase` para el scroll —
  cualquier fase ≠ `recording` hace `stopScroll`, así que `requesting`
  se comporta bien sin cambios.
- El catch del permiso verifica token vigente antes de `setNotice`:
  evita escribir avisos en una vista ya desmontada.

- `projectIdRef` + `store.getProject()`: `finalizeRecording` verifica la
  identidad del proyecto dos veces (tras conversión y tras
  `importMediaBytes`). Ojo: `store.state` es la foto del render — el
  estado vivo se lee con `getProject()`/`mutate`, que usan `stateRef`.
  Sin eso el check comparaba el proyecto viejo y el clip podía montarse
  en el nuevo.

## Evidencia

- vitest VoiceoverRecorder **6/6** (+3 tests: dedup de clics, desmontaje
  tardío, cambio de proyecto con WAV en vuelo vía mock parcial de
  `blobToWavPcm` + `openProjectAt` del fake service). RED confirmado.
- vitest vecinos **27/27** · `tsc --noEmit` exit 0.
- Registrado como **Pasada 200** en `docs/IMPROVEMENT-QUEUE.md`.

## Siguiente

AUD-142 (límite antes de Base64 decode en `media/import.rs`), AUD-129
(`Command::output` síncrono en `media_tools.rs`), AUD-144 (guard de
identidad en `transcribeProjectClips` — mismo patrón que este fix).

## Actualización — Pasada 201 (mismo día)

- **AUD-144 cerrado** en `state/transcribe-project.ts`: `getProject?()`
  opcional en `TranscribeProjectStore`, `liveProject()` prefiere el store
  vivo, `stillSameProject()` antes de cada clip y antes de cada
  `store.update`; mismatch → clips restantes `failed` con razón "el
  proyecto cambió durante la transcripción".
- **AUD-142 ya estaba hecho**: `decode_import_bytes` filtra por largo
  base64 antes de decodificar (`MAX_IMPORT_BASE64_CHARS`) con tests —
  la supervisión del 19 quedó desactualizada en ese punto.
- Verificación: vitest transcribe-project **5/5** (+1 test de cambio de
  proyecto) · caption-transcription **7/7** · `tsc --noEmit` exit 0.
- Quedan: AUD-129, AUD-140, SEC-GATE-003, AUD-032.

## Actualización — Pasada 202 (mismo día)

- **AUD-129 cerrado** en `commands/domains/media/media_tools.rs`:
  `run_ffmpeg` y `tool_video_codec_args` pasaron a `async` con
  `tokio::task::spawn_blocking`; `extract_subtitles` envuelve sus dos
  `.output()` (ffprobe + ffmpeg→srt). Patrón: clon owned + closure +
  `JoinError`→`ProjectError`.
- Fix de paso: `manual_div_ceil` en `media/import.rs` (WIP previo).
- Verificación: cargo check exit 0 · fmt limpio · clippy -D warnings
  exit 0 · cargo test --lib import 40 ok / 2 ignored.
- Ojo: hubo edición concurrente de `stickman/command.rs` por otro
  frente (mismo AUD-129); se verificó el estado final sano, no se tocó.
- Quedan: AUD-140, SEC-GATE-003, AUD-032.

## Actualización — Pasada 203 (mismo día)

- **AUD-140 (parcial honesto) en `packages/effect-kit/src/webgl.ts`**:
  el storage de las 4 texturas de historial (~132 MiB en 4K por
  renderer) pasó de asignarse en `uploadSource` a `ensureHistoryStorage`
  perezoso, llamado en `render()` sólo si `needsHistory` y ANTES de los
  passes (los slots son uniforms). `uploadSource` ahora sólo resetea
  `historyCount`.
- Verificación: tsc effect-kit exit 0 · vitest 79/79 (6 skipped live).
  Sin test WebGL real (jsdom no provee GL2) — verificación por typecheck
  + revisión de orden ensure→sample→copy.
- Quedan: SEC-GATE-003, AUD-032 (los dos de la supervisión).

## Actualización — Pasada 204 (mismo día)

- **AUD-032 mitigado con residual documentado**: `ip_is_forbidden`
  endurecido (mapped/compatible v6, NAT64 64:ff9b::/32, CGNAT,
  benchmarking, TEST-NETs, multicast — con chequeos manuales porque
  `is_shared`/`is_benchmarking`/`is_documentation` son inestables en
  Rust). `ensure_public_resolution` (DNS fail-closed, sólo contextos
  bloqueantes) + `validate_url_network` + `ssrf_redirect_policy`
  (revalida cada salto 302/307) cableados en probe, download, checksum,
  RSS e imagen directa del bridge.
- Verificación: `cargo test --lib downloader` 63 ok / 1 ignored · fmt
  limpio · clippy `-D warnings` exit 0. 2 tests nuevos sin red.
- Residuales honestos en la cola: yt-dlp resuelve/sigue por su cuenta,
  TOCTOU DNS-rebinding sin pinning de IP, validador laxo del navegador
  embebido (decisión documentada).
- Queda de la supervisión: sólo SEC-GATE-003.

## Actualización — Pasada 205 (mismo día)

- **SEC-GATE-003 medido de verdad**: la nota "fix en vitest 2.1.9" era
  stale — los advisories cubren vitest <3.2.6/<4.1.11, tinypool ≤2.1.0,
  vite ≤6.4.3. Fix real = majors (vitest 5.1.1, vite 8.3.8).
- Bump autorizado `vitest` 2.1.8→2.1.9 (pin root): no cierra criticals
  pero adelanta parches; smoke 6/6 verde. `npm ls` confirma árbol
  consistente.
- `zod-to-json-schema` 3.23.5→3.25.2 probado y **revertido**: exige
  `zod/v3` (zod ≥3.25) y el high era del advisory de zod (<4.6.6), no
  del conversor. Queda en 3.23.5 + override.
- Hallazgo lateral: `schema-artifacts.test.ts` destapó drift WIP
  (`.schema.json` sin `media.channels`); `npm run schema:generate` lo
  regeneró → project-schema **395/395**, effect-kit 79/79, smoke
  desktop 6/6 con vitest 2.1.9.
- Migración majors aprobada como sesión dedicada: zod 3→4.6.6+,
  vitest→5.x, vite→8.x.
- Estado final: npm-dev INFO 2 critical + 2 high + 3 moderate, todos
  sólo-dev y todos esperando esas majors.

## Actualización — Pasada 206 (mismo día)

- **AUD-071 (P1 run09)**: `decode_package` en `commands/package.rs`
  decodificaba base64 antes del tope de 64 MiB →
  `MAX_PACKAGE_BASE64_CHARS` + rechazo temprano (patrón AUD-142).
  Test nuevo; `cargo test --lib package` 5/5 · fmt limpio · clippy
  `-D warnings` exit 0.
- Quedan P1 de run09: AUD-068, AUD-069, AUD-121/122, AUD-123, AUD-130;
  P2: AUD-146, AUD-139 residual.

## Actualización — Pasada 207 (mismo día)

- **AUD-123 (P1 run09)**: `integrity_issues` usaba `duration*num` y
  `window*den` en u64 sin checked → overflow/wrap con documentos
  externos. Ahora `checked_mul` en ambos lados; overflow → issue
  "desborda el rango seguro". Test nuevo con u64::MAX.
- `cargo test --lib projects::` 39/39 · fmt limpio · clippy `-D
  warnings` exit 0.
- Quedan P1 run09: AUD-068, AUD-069, AUD-121/122, AUD-130; P2: AUD-146,
  AUD-139 residual.

## Pasada 208 — AUD-130 merge_videos sin audio (2026-11-20)

- `media/toolbox.rs`: `merge_video_args` ahora recibe `&[MergeInput]`
  (path + has_audio + duration_seconds). Inputs sin audio suman una
  entrada `-f lavfi -t <dur> -i anullsrc=r=48000:cl=stereo`; toda la
  audio pasa por `aformat` 48 kHz estéreo (concat exige mismo
  rate/layout). Pads etiquetados `[vi]`/`[ai]` — los pads sin etiqueta
  se conectan al siguiente filtro y rompían el grafo.
- `commands/domains/media/media_tools.rs::merge_videos`: probe_file
  por input en spawn_blocking; ffprobe ausente o duración no medible
  en un input sin audio → error honesto.
- Tests: toolbox 9/9, fmt y clippy limpios. Sin verificación ffmpeg
  real (no hay test live); mismas dimensiones siguen siendo requisito.

## Pasada 209 — AUD-121/122 export_short stderr (2026-11-20)

- `creator/shorts/export.rs`: stderr ahora se drena en un thread
  paralelo con `take(1 MiB)` antes de `child.wait()` — antes se leía
  post-wait y un FFmpeg locuaz bloqueaba el pipe (deadlock circular).
  El spawn_blocking del handler ya existía (AUD-030). check/fmt/clippy
  verdes; sin test live del proceso.

## Pasada 210 — AUD-068/069 guardado entre proyectos (2026-11-20)

- `project-store-provider.tsx`: saveNow/saveAs sólo limpian
  recuperación y marcan persistido si `stateRef.current.project ===
  captured`; saveNow ya no mezcla path/root/label del guardado viejo
  en el opened visible cuando el proyecto cambió.
- `application/projects.rs::save_project_as`: re-check de sesión
  (require + ensure_session_project) antes de open_and_adopt; si
  cambió, devuelve la vista sin adoptar.
- Test: project-store.test.tsx +1 (17/17), tsc 0, cargo projects 3/3,
  fmt/clippy limpios. Ojo: el provider tiene comentarios con mojibake
  preexistente y CRLF — preservado.

## Pasada 211 — AUD-146 + AUD-139 residual (2026-11-20)

- `state/face-mask.ts`: reserva slot para la última muestra cuando el
  muestreo llena MAX_TRACKED_KEYFRAMES (96 muestras/stride 2 antes la
  perdía). Test: 96 muestras → última keyframe frame 95. 8/8.
- `application/variants.rs`: mirror_assets devuelve (copied, created);
  write_project_variant_file revierte created si save_project falla.
  variants 8/8, fmt/clippy/tsc limpios.
- Con esto run09 queda completo; residuales honestos en la cola.

## Pasada 212 — AUD-129 resto: audio.rs spawn_blocking (2026-11-20)

- `commands/domains/audio/audio.rs`: audio_peaks, audio_peaks_path y
  hardware_encoders pasaron su trabajo FFmpeg/ffprobe a spawn_blocking
  (antes corrían en el runtime async — decode_peaks puede tardar
  minutos). Resto del dominio audio ya estaba cubierto.
- check/test audio 3/3/fmt/clippy verdes.

## Pasada 213 — AUD-129 resto: denoise spawn_blocking (2026-11-20)

- `media/denoise.rs::denoise_media`: probe+encode+publish enteros a
  spawn_blocking. check/fmt/clippy verdes.
- Barrido AUD-129 restante detectado: sharpen_media, color_proxy
  (3 cmds), lottie (2), probe_vmaf (2), vpn — quedan para la
  próxima pasada.

## Pasada 214 — AUD-129 resto: sharpen/color_proxy/lottie (2026-11-20)

- `sharpen/command.rs`, `media/color_proxy.rs` (3 cmds) y `lottie.rs`
  envueltos en spawn_blocking. lottie tests 5/5, fmt/clippy limpios.
- Queda: probe_vmaf (puertos application::media, no wrap trivial) y
  vpn.rs (menor).

## Pasada 215 — AUD-129 cierre: probe_vmaf + vpn (2026-11-20)

- `probe_vmaf.rs`: FixedMediaTools propio (rutas resueltas upfront)
  + SystemMediaRunner en spawn_blocking para probe_any_file y
  measure_vmaf.
- `vpn.rs`: powershell/rasdial/wireguard_open a spawn_blocking
  (busy-wait hasta 90 s ya no congela el runtime).
- vpn 4/4, media_analysis 9/9, fmt/clippy limpios. Barrido AUD-129
  completo.

## Pasada 216 — safe-integer JS en projects/service.rs (2026-11-20)

- issue_if_unsafe_integer + MAX_SAFE_INTEGER (2^53-1) rechazan enteros
  temporales que JS no representa exacto. No filtrar en number():
  None = campo ausente = documento pasa (regresión detectada por tests).
- projects::tests 33/33, fmt/clippy limpios.

## Pasada 217 — verify completo + thumbnails (2026-11-20)

- npm run verify: typecheck 0, serial 3246+1f→arreglado, extension
  33/33, web-tts 10/10, audit PASS.
- effect-thumbnails fallaba: catálogo WIP sin SVGs →
  `npm run thumbnails:effects` generó 172 (38 nuevos), test 3/3.

## Pasada 218 — gate AUD-129 en architecture-rules (2026-11-20)

- Nuevo test: async fn en commands/** sin .output()/.wait() fuera de
  spawn_blocking. sanitizeRust blanquea comentarios/strings/chars
  (los `// 1)` rompían el balanceo de paréntesis).
- 4 bloqueos reales corregidos: ffprobe en screen_record snapshot,
  kill+wait en browser_instances (x2) y flow_browser.
- 14/14 architecture tests, check/fmt/clippy limpios.

## Pasada 219 — gate AUD-129 + thread::sleep (2026-11-20)

- Gate ampliado a thread::sleep en async fn; thread::spawn enmascarado
  (hilo dedicado); spans anidados salteados.
- Fix real: screen_record_start 1.2s sleep → tokio::time::sleep().await.
- .status() descartado (ruido reqwest). 14/14, check/fmt/clippy limpios.

## Pasada 220 — comandos SYNC en main thread (AUD-129 resto) (2026-11-20)

- Tauri corre `#[tauri::command] pub fn` (sin async) en el MAIN
  THREAD: reqwest::blocking u ONNX ahí congelan la UI directo.
- Fix: automation.rs x3 (probe_checksum/rss/proxy → async+
  spawn_blocking; Proxy::all es parseo puro, queda fuera),
  flow_browser_stop (kill+wait → spawn_blocking, lock liberado),
  upscale_image y remove_background (inferencias ONNX → async+
  spawn_blocking).
- stop_all_browser_instances NO es comando (hook de salida) — queda.
- Residual: sync commands con fs variable (scan_watch_folder,
  copy_media_into, write_project_file) — migración no justificada
  sin evidencia de archivos grandes.
- Verificación: check 0, automation 7/7, arch 14/14, fmt/clippy limpios.

## Pasada 221 — fs de tamaño variable fuera del main thread (2026-11-20)

- copy_media_into: copia archivos arbitrarios + sha256 completo
  por archivo en main thread → async+spawn_blocking (peor caso).
- write_project_file y scan_watch_folder: mismo fix.
- Tests a block_on; invoke/registry transparentes.
- Quedan sync sólo fs acotado (subtítulos, EDL/XML, metadatos).
- Verificación: automation 7/7, variants 8/8, arch 14/14,
  fmt/clippy limpios.

## Pasada 222 — gate AUD-129 para comandos sync (2026-11-20)

- Nuevo test: `#[tauri::command] pub fn` sync sin .output()/.wait()/
  thread::sleep/reqwest::blocking (main thread = UI congelada).
- Trampa: regex sin `\s*\(` marcó `.output_dir` como ofensa —
  los 5 hits eran falsos positivos de campos, no procesos.
- Clase AUD-129 cerrada por gate en async Y sync. 15/15 tests.
- Límite: helpers bloqueantes llamados desde comandos no se
  delatan (regla sintáctica por cuerpo).

## Pasada 223 — CPU de imagen en sync commands (2026-11-20)

- analyze_scopes_frame: decode hasta 16384² + DSP por píxel en
  main thread → async+spawn_blocking (peor caso).
- save_thumbnail: data-url 64MB + decode/encode PNG → wrapper
  async + save_thumbnail_impl en spawn_blocking; tests al impl.
- Descartados: export_look_lut (36k evals, ms), lut_probe (64MB
  parse acotado). CPU pura no entra al gate (falsos positivos).

## Pasada 224 — fin del barrido sync (2026-11-20)

- install_plugin/remove_plugin: copia/borrado recursivo de
  directorios arbitrarios → async+spawn_blocking.
- Descartados: sfx_library, mcp_detect_clients, list_plugins,
  whisper_model_status, mcp_audit_tail, getters de status.
- CLASE CERRADA: ningún comando Tauri ejecuta procesos/red/ONNX/
  CPU imagen/fs grande fuera de spawn_blocking. Gates 15/15 +
  barrido manual documentado. plugins 6/6, fmt/clippy limpios.

## Pasada 225 — helpers bloqueantes en async fn (2026-11-20)

- El gate no ve helpers: probe std::fs::* en bodies async →
  download_media (move GBs + ffmpeg metadata + hash + ffprobe
  chapters), cleanup_download, import_media_bytes,
  render_project_variant (copy MP4 + remove_dir_all), lip_sync
  (write video + probes), install_downloader (binario + --version),
  clone_voice (write WAV + probe_file) → todos a spawn_blocking.
- Descartados: create_dir_all, JSONs chicos, metadata, rename.
- Verificación: check 0, downloader 63/63, lip_sync 4/4,
  voice_clone 7/7, variants 8/8, fmt/clippy limpios.

## Pasada 226 — helpers de proceso en async (2026-11-20)

- Probe estructural de helpers con procesos llamados desde async
  no enmascarados: 6 ofensores reales corregidos —
  remove_background_asset (ONNX+ffmpeg), analyze_media
  (measure_media, decodificación completa ×3-4), media_thumbnail
  (ffmpeg 60 s timeout), burn_cursor_overlay ×2 (x264 crf 18
  full video), sapi_voices + synthesize_narration (PowerShell
  SAPI + hash WAV).
- Falsos positivos: helpers ya envueltos (media_tools::run_ffmpeg
  async local, launch_segment, stitch, stream worker thread,
  start_render spawn, node_command builder) y colisiones de
  nombre entre módulos.
- Residual: probes ffprobe de validación ~100 ms en async
  (probe_file/probe_duration_seconds/probe_video/probe_output).
- Verificación: check 0, tests focalizados 36/36, arch 15/15,
  fmt/clippy limpios. Probe eliminado.

## Pasada 227 — probes ffprobe sueltos en async (2026-11-20)

- spawn_blocking en: voice_isolation, whiteboard (×2), diarize,
  synthesize_elevenlabs (+sha256), audio_channels_convert,
  upscale_video.
- Residual: probe_output de screen_record (~100 ms) y
  engine_version/resolve_engine/status_from_config
  (yt-dlp --version ~300-800 ms, call-graph 2 niveles, ~10
  callers — refactor aparte).
- Verificación: check 0, tests 35/35, fmt/clippy limpios.

## Pasada 228 — cache engine_version (2026-11-20)

- yt-dlp --version (~500 ms PyInstaller) memoizado por firma
  len+mtime en engine.rs; PATH sin firma no se cachea. Primera
  llamada por sesión sigue bloqueando un worker ~500 ms
  (residual). downloader 63/63, fmt/clippy limpios.

## Pasada 229 — probe_output screen_record (2026-11-20)

- 3 llamadas ffprobe sueltas → spawn_blocking (stop, switch
  close_current_segment, obs_switch_finish single-segment).
  Las demás ya estaban dentro de closures. AUD-129 sin
  residuales de probes sueltos.
- Verificación: check 0, screen_record 13/13, fmt/clippy limpios.

## Pasada 230 — warmup engine_version en setup (2026-11-20)

- lib.rs setup: thread que corre resolve_engine al arranque →
  cache caliente antes del primer comando downloader. Residual
  de ~500 ms eliminado en la práctica.
- Verificación: check 0, fmt/clippy limpios.

## Pasada 231 — gate reqwest::blocking en async (2026-11-20)

- Agujero del gate cerrado: reqwest::blocking ahora es ofensa en
  async fn fuera de spawn_blocking. Cero ofensas reales.
- arch 15/15.

## Pasada 232 — recv_timeout en async + gate (2026-11-20)

- web_session_open: espera de 30 s del build de ventana →
  spawn_blocking. recv_timeout agregado al gate async+sync.
  Resto de recv/wait ya en contexto bloqueante.
- Verificación: check 0, arch 15/15, fmt/clippy limpios.

## Pasada 233 — checkpoint suite completa (2026-11-20)

- Auditorías de agotamiento (recv/Condvar, unsafe, image decode,
  unwraps, frontend TODOs): todo limpio o cubierto.
- cargo test --lib: 1166/1166, 75 ignored. WIP 200-232 verde.

## Pasada 234 — sonda ffmpeg-probe del effect-kit (2026-11-20)

- ffmpeg-probe.test.ts (WIP del usuario) tenía path relativo al cwd:
  siempre skipped. Fix con import.meta.dirname → corre de verdad.
- effects:codegen y generate-concat verificados en sync (hash igual).
- Suite effect-kit: 82 passed / 3 skipped (audio-live gated por env).

## Pasada 235 — checkpoint vitest completo (2026-11-20)

- test:serial: 357 archivos, 3249 passed / 0 failed / 3 skipped.
- Auditoría logging src-tauri limpia (todo gateado o tests).
- AUD-144 residual del frontend sin ofensas nuevas.
- typecheck raíz exit 0.

## Pasada 236 — auditoría lock-across-await (2026-11-20)

- 11 async fn con lock+await revisadas: todas con scope correcto o
  tokio Mutex. Sin ofensas.

## Pasada 237 — fix seek hacia atrás en webgl.ts (2026-11-20)

- Historial temporal (blur.temporal/denoise.temporal, WIP usuario):
  Math.abs permitía seeks hacia atrás de 1-4 frames con historia
  inválida. Fix: frameIndex < lastFrameIndex también resetea.

## Pasada 238 — vendor/concat check + thumbnails (2026-11-20)

- cargo check workspace vendor/concat: exit 0 con WIP speech-min.
- rust-env debe correrse desde raíz (cwd=vendor rompe toolchain pin).
- 172/172 efectos con thumbnail SVG.

## Pasada 239 — concat-worker check + UI effects (2026-11-20)

- cargo check apps/concat-worker: exit 0.
- EffectBrowser usa effectRegistry → efectos nuevos del catálogo
  aparecen solos en UI.

## Pasada 240 — verify completo + fugas de recursos (2026-11-20)

- verify descompuesto: typecheck+3249 vitest+33 ext+10 web-tts+
  audit PASS.
- createObjectURL/listeners/intervals: sin fugas.

## Pasada 241 — vendor diff es sólo fmt (2026-11-20)

- concat-speech-min WIP = cargo fmt puro, sin cambios funcionales.
- Repo consolidado: todo verde medido. Pendientes = decisiones
  del usuario (SEC-GATE-003, cargo-audit, zoompan).

## Pasada 242 — isIconName guard (2026-11-20)

- ThumbnailBrowser `as any` → `isIconName()` exportado de Icon.tsx.
- Único as any del frontend fuera de tests eliminado.

## Pasada 243 — catches + deps (2026-11-20)

- 48 catch silenciosos: patrón consistente, sin ofensas reales.
- Packages TS sin as any. Cargo.toml: +7 filmcraft-* rev pineado.

## Pasada 244 — zoompan↔preview ya estaba cerrada (2026-11-20)

- Las notas "pendiente" post-198 eran stale: pasada 198 cerró la
  paridad con PNGs byte-idénticos. Registrado para no reabrir.

## Pasada 245 — plan de commit (2026-11-20)

- WIP = trabajo documentado y verificado sin commitear (293M/131??/17D).
- Propuesta de consolidación estilo ae9c1d55 en la cola; excluir
  `nul` y `test-cdp.editoria.json`. Esperando autorización.

## Pasada 247 — gitignore artefactos (2026-11-20)

- /nul y /test-cdp.editoria.json ignorados (quedan en disco).
- untracked 131→129.

## Pasada 249 — vite build verde (2026-11-20)

- npm run build: 608 módulos, exit 0. Warnings benignos.

## Pasada 250 — tauri:build:debug OK (2026-11-21)

- editor-ia-desktop.exe debug linkeado (91.8 MB) con todos los
  crates nuevos. Cadena de verificación completa de punta a punta.

## Pasada 251 — gitignore scripts/_*.mjs (2026-11-21)

- 17 scripts one-off de sesiones ignorados. untracked 129→112.

## Pasada 252 — árbol listo para commit (2026-11-21)

- 422 entradas legítimas, cero espurios. Verificación completa
  incluyendo exe debug. Esperando "commiteá".

## Pasada 253 — filmcraft deps usadas (2026-11-21)

- Los 7 crates nuevos tienen consumidor real. Sin deps huérfanas.

## Pasada 254 — supervision run09 contrastada: todo cerrado (2026-11-21)

- Los 8 hallazgos P1/P2 "abiertos" de run09 ya tienen fix en el WIP
  (AUD-068/069/071/121/122/123/130/139/146). Reporte stale.
- Único residual real: AUD-032 SSRF (yt-dlp URLs secundarias / DNS
  rebinding) — arquitectural, documentado.

## Pasada 255 — AUD-001 asset scope verificado (2026-11-21)

- Scope estático vacío + grants dinámicos por proyecto
  (media/ recursivo + assets declarados). Mecanismo correcto;
  residual: sin revocación entre proyectos de la sesión.

## Pasada 256 — deps Rust verificadas (2026-11-21)

- 39 deps del crate desktop: todas con consumidor (md-5→md5,
  filmcraft-interchange, tauri-build→build.rs). Sin dead deps.

## Pasada 257 — workers auditados (2026-11-21)

- render-worker/concat-worker/motion-mcp: sin bloqueos en async.
  AUD-129 cerrada en todo el sistema.

## Pasada 258 — AUD-032: thumbnails yt-dlp + SponsorBlock endurecidos (2026-11-21)

- download_thumbnail: allowlist *.ytimg.com + redirect policy (URL
  viene del extractor yt-dlp = dato externo).
- SponsorBlock: ssrf_redirect_policy en el cliente.
- Residual: yt-dlp conecta por su cuenta; cierre = proxy CONNECT
  validador (feature aparte).
- check/fmt/test(63)/clippy verdes.

## Pasada 259 — net_guard + SSRF en download_image (2026-11-21)

- Nueva application/net_guard.rs con la política SSRF compartida;
  probe.rs delega (wrappers, mismos mensajes).
- download_image de remote_image: providers remotos ahora exigen
  resolución pública + redirect policy (URL = dato del proveedor).
  Locales (Ollama) sin cambios.
- check/fmt/test(174)/clippy/gates verdes.

## Pasada 260 — models.rs redirect policy (2026-11-21)

- stream_download usa ssrf_redirect_policy (catálogo fijo, hardening).
- check/fmt/test(12)/clippy verdes.

## Pasada 261 — superficie HTTP saliente auditada (2026-11-21)

- Todos los reqwest del crate clasificados: config-usuario (validados),
  URLs fijas, o datos externos (net_guard/allowlist). Sin ofensas.

## Pasada 262 — webview/capabilities auditados (2026-11-21)

- Capabilities sólo cubren main/dual/splash; flow_embed no tiene IPC.
- Residual: CDP localhost con puerto predecible = feature de agentes;
  riesgo limitado a procesos locales (Chrome bloquea rebinding).

## Pasada 263 — command injection auditado (2026-11-21)

- MCP cmd /C ya filtra metacaracteres (check_shell_launch + tests).
- process.rs shells son sólo tests. Resto: args vectoriales, binarios fijos.

## Pasada 264 — 14 transiciones xfade nuevas (2026-11-21)

- smooth×4, vert×2, diag×4, slice×4 en transitions.ts con shaders
  propios + xfade real. 14 nombres verificados live en FFmpeg 9.
- concat-render ya los soporta; OBS TRANSITION_KINDS + MCP enum
  extendidos. 186 thumbnails.
