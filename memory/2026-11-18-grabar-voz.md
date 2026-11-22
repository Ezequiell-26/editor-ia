# 2026-11-18 · «Grabar voz» (voiceover a la timeline)

Paridad CapCut: grabación de voz del micrófono directo a la pista de
narración. Antes sólo existía TTS (SAPI/ElevenLabs).

## Piezas

- `features/editor/voiceover.ts`: helpers puros — `pickVoiceoverMimeType`
  (webm/opus → webm → mp4 → ogg/opus), `voiceoverFileName`
  (`voz-AAAAMMDD-HHMMSS.ext`), `encodeWavPcm16` (PCM16 WAV),
  `blobToWavPcm` (decodeAudioData + OfflineAudioContext a 48 kHz, máx. 2
  canales), `bytesToBase64`, `formatVoiceoverElapsed`,
  `VOICEOVER_MAX_SECONDS = 600`.
- `features/editor/VoiceoverRecorder.tsx`: botón de toolbar
  `aria-label="Grabar voz"` (estado idle/recording/importing, elapsed en el
  label, tope 10 min). Al detener: blob → WAV PCM 48 kHz (fallback: contenedor
  MediaRecorder si decodeAudioData falla) → `service.importMediaBytes` →
  `addAsset` + `markAssetReady('allowed')` + `addClipFromAsset`
  `{ narration: true, atFrame }` en un solo `store.mutate`.
- Backend: comando IPC `import_media_bytes` en
  `commands/domains/media/media/import.rs` — decodifica base64 (tope 256
  MB), sanea el nombre (basename + extensión de audio), escribe un temporal
  y reusa `import_local_files` (copia a `media/`, ffprobe, sha256). Registrado
  en `commands/registry.rs`.
- Superficies: botón real en `.timeline-toolbar` (después de Beats), entrada
  `aria: 'Grabar voz'` en `OVERFLOW_TOOLS` («Más herramientas») y tool
  `voiceover` en `TOOLBAR_CATALOG`/`FilmoraStates` (barra rápida
  personalizable). Ícono nuevo `mic` en `components/Icon.tsx`.
- Contrato: `importMediaBytes({fileName, dataBase64, fpsNum, fpsDen})` en
  `services/contracts/services/projects.ts` + `platform/tauri/{shared,
  projects,unavailable-service}.ts` + `test/fake-service.ts`.

## Decisiones

- **WAV PCM 48 kHz** como formato destino: mismo que la narración TTS
  (SAPI) y el más seguro para ffprobe/FFmpeg. Fallback documentado al
  contenedor webm/mp4 si Web Audio no decodifica.
- Derechos: el asset vuelve `unverified`/`user-imported` del import y la UI
  lo pasa a `ready` con `markAssetReady(..., 'allowed')` — el usuario grabó
  su propia voz (no se usa `confirm_rights` del comando para no etiquetar
  provenance como "generated-by-provider").
- Pista: `narration: true` → pista de narración (se crea si no existe);
  `atFrame` = playhead capturado al EMPEZAR a grabar.

## Verificación

- `tsc --noEmit -p apps/desktop/tsconfig.json`: exit 0.
- vitest: voiceover.test.ts (13), VoiceoverRecorder.test.tsx (3),
  FilmoraStates.test.tsx (13), Timeline.test.tsx (44) — verde.
- `scripts/architecture-rules.test.mjs` + `dependency-rules.test.mjs`:
  20 tests verdes.
- `cargo check -p editor-ia-desktop` y `--tests`: exit 0.
- `cargo fmt --check`: sin diffs en los archivos tocados (el repo tiene drift
  de fmt preexistente en WIP ajeno).
- **Pendiente**: `cargo test -p editor-ia-desktop import_bytes` no pudo
  correr: hay un `cargo run` + `editor-ia-desktop.exe` del usuario activos
  (PID 18156/6516) que bloquean `target/` (os error 32 en el build script de
  tauri-build). Los tests unitarios del sanitize/decode quedaron compilados
  vía `cargo check --tests` pero sin ejecutar. Correrlos cuando el cargo run
  termine.
- **Sin verificar en hardware**: permiso real de mic en WebView2,
  getUserMedia/MediaRecorder efectivos, calidad del WAV resultante.
