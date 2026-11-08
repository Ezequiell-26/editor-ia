# 2026-11-08 — Sonda de hardware AV1/VP9 en export WebM (Editor IA)

Pasada del loop de mejora (Devin CLI). Cierra la parte «sonda de hardware
para AV1/VP9 y exponerlo en la UI de WebM» del `[pending]` de velocidad
(`docs/IMPROVEMENT-QUEUE.md`).

## Qué se hizo

El pipeline Rust ya aceptaba `hardwareEncoder` para AV1/VP9
(`validate_hardware_encoder` + `hardware_encoder_args` emiten los flags por
familia `_amf`/`_nvenc`/`_qsv`), pero la sonda `detect_hardware` sólo medía
H.264/H.265 y `ExportDialog.availableHardware` devolvía `null` para WebM.

- `commands/audio.rs`: `HardwareEncoders` suma `av1`/`vp9`; `detect_hardware`
  los sondea con `first_working` (init real de encoder, cacheado por
  binario) sobre `HW_AV1 = [av1_nvenc, av1_qsv, av1_amf]` y
  `HW_VP9 = [vp9_qsv, vp9_amf]`.
- `render/ffmpeg.rs`: `HARDWARE_VP9` admite `vp9_amf`;
  `commands/export_tools.rs` lo refleja en la matriz de capabilities.
- Frontend: tipo `HardwareEncoders` + fake-service + `availableHardware`
  mapean los 4 códecs (desconocido → `null`). El checkbox «Acelerar con GPU»
  y `gpuRecommendation` aplican a perfiles WebM; el encoder viaja por
  `hardwareEncoder` en `startRender`/`startRenderTo`.

## Verificación (ejecutada)

- `cargo test -p editor-ia-desktop --lib commands::audio` → **11/11**
  (test nuevo `detecta_encoders_av1_y_vp9_en_la_lista`). La crate completa
  compiló con todos los cambios en esa corrida.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0**.
- `npx vitest run src/features/editor/ExportDialog.test.tsx` → **7/7**
  (test nuevo: AV1/WebM + `av1_nvenc` → checkbox → `startRenderTo` recibe
  `'av1_nvenc'`).

## Límites y pendientes

- `vp9_amf`/`av1_*` sólo se ofrecen si el init real funciona en la sonda.
- Tope de resolución hardware: 4096 px de lado (8192 sólo H.265), igual que
  la validación del backend.
- **No se commiteó**: el árbol tiene trabajo concurrente de otra sesión
  (VPN ya registrada en la cola, `audio_scopes.rs` nuevo con error de
  sintaxis que bloquea el target lib-test, stickman, screen_record…). Un
  commit ahora capturaría trabajo ajeno a medio hacer.
- Tests filtrados de `convert`/`export_tools`/`ffmpeg` quedaron sin correr
  por ese bloqueo; la compilación ya estaba verificada.

## Archivos

`src-tauri/src/commands/{audio,system,convert,export_tools}.rs`,
`src-tauri/src/render/ffmpeg.rs` (1 línea), `services/project-service.ts`,
`test/fake-service.ts`, `features/editor/ExportDialog.tsx` (+test),
`docs/IMPROVEMENT-QUEUE.md`.
