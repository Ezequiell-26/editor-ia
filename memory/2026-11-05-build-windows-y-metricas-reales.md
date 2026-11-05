# 2026-11-05 — build de Windows destrabado y métricas reales

## Build nativo: ahora compila, instala y abre

Receta reproducable en `scripts/win-build/BUILD_TAIRI_FIX.bat`. Cinco causas encadenadas, cada una tapada por la anterior:

1. `/NODEFAULTLIB:msvcrt.lib` en `.cargo/config.toml` (lo había metido yo) → exclecía la CRT → 13 símbolos sin resolver. Eliminado.
2. La toolchain `14.51.36231` instalada está **incompleta** (sin `msvcrt.lib`, `vcruntime.lib`, `legacy_stdio_definitions.lib`) y Rust siempre elige la más nueva. Se fuerza `14.43.34808`, que está íntegra, con `vcvarsall.bat amd64 10.0.26100.0 -vcvars_ver=14.43.34808`.
3. El entorno se perdía en los saltos bash→npm→cmd: hay que hacer `call vcvarsall` **en el mismo** proceso que corre el build.
4. Faltaban FFmpeg de desarrollo y `libclang`. FFmpeg: **9.0 release** (`avcodec-63 / avformat-63 / avutil-61`, los mismos que empaqueta `resources/ffmpeg-dll`). No sirve el snapshot *master*: agrega `AV_PIX_FMT_CUARRAY`, `AV_CODEC_ID_ASTC`, `AV_FRAME_DATA_GAIN_MAP_PARAMS` y `ffmpeg-next 9.0.0` (que trae `video-rs 0.12.0`, ya la última) hace `match` exhaustivo → 5 × `E0004`. `libclang`: instalado con winget (VS solo trae `clang-format`/`clang-tidy`).
5. `STATUS_STACK_OVERFLOW` en el build script: los exe de build script en MSVC nacen con 1 MB de pila y bindgen la rompe con los headers de FFmpeg. `RUSTFLAGS=-C link-arg=/STACK:134217728`.

Artefacto: `target/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe` (158,8 MiB), build de 6 min 28 s, `TauriExitCode=0`. Instala en `C:\Users\ofici\AppData\Local\Olyvia\editor-ia-desktop.exe`.

## Lo que se midió (reemplaza objetivos por números)

- **App en reposo**: 42,2 MB de RAM, **0,00 s de CPU en 6 s**, 0 procesos hijos de media. Sin bucle/rAF de fondo.
- **Presets `libx264`** (30,1 s de 1080p30, CRF 20, contenido de UI): ultrafast 2,21 s / 4,30 MB · **veryfast 3,02 s / 1,59 MB** · faster 3,73 s / 1,64 MB · fast 4,00 s / 1,67 MB · medium 3,98 s / 1,66 MB.
- Con eso el default `veryfast → fast` que se había cambiado resultó **~32 % más lento y más grande** al mismo CRF. **Revertido** a `veryfast`. El repo ya lo exigía: test en `render/ffmpeg.rs:6114` afirma `veryfast` como default; y `audio.rs`, `creator.rs`, `lossless.rs` usan `veryfast` explícito. El frontend **no manda `videoPreset`**, así que ese default define la velocidad real del export.
- **Encoders de hardware** (Ryzen 5 4600G): `h264_amf` OK (3,32 s / 2,00 MB), `h264_mf` OK (2,97 s / 2,43 MB), `nvenc` y `qsv` no disponibles, `libopenh264` lento y grande. No le ganan a `x264 veryfast` en este material, así que no se cambia el encoder default.
- **Tests**: 1569 → 1549 pasan; los 18 fallos son preexistentes (EffectStudio 5, Timeline 5, AudioEffectStack 4, AssetsPanel 3, App 1) e **idénticos con y sin el `React.memo`** (atribuido con `git stash` sobre el subconjunto). `MotionView` y `EmojiPicker.focus` solo fallan en suite completa → flaky de orden, dos corridas del mismo código dieron 19 y 20.

## Cambios de código de hoy

- `React.memo` en `EditorWorkspace`, `Timeline`, `Inspector`, `Preview` (los había revertido para destrabar el build; reaplicados y verificados).
- `vite.config.ts`: `chunkSizeWarningLimit` movido de `output` a `build` — en `output` Rollup lo descartaba con `Unknown output options` y el "umbral 50 kB" nunca estuvo activo. Ahora umbral 300 kB y señala los reales pendientes: `main` 544 kB y `vendor-emojibase` 499 kB.
- `render/ffmpeg.rs`: default de preset revertido a `veryfast` con el comentario y la tabla medida.

## Deuda conocida

- Los selectores nuevos de `project-store.tsx` (`useProjectPlayhead`, `useProjectSelection`, `useProjectTracks`, `useProjectClips`, `useExportStatus`) **no los usa ningún componente todavía**: siguen leyendo `useProjectStore()` completo, así que el corte de contexto no está activo. Sí funciona el cacheo `durationOf()`.
- Tests Rust: el binario de test no arranca en esta máquina (`STATUS_ENTRYPOINT_NOT_FOUND`, 0xc0000139) aunque se le pongan las DLLs delante; la app instalada sí corre con las suyas colocadas juntas. Sin resolver.
- Sin medir: FPS bajo playback real, A/B de carga inicial con/sin memo, export completo de un proyecto real, CPU durante export (para justificar AMF/MF).
- Los docs `PERFORMANCE_*.md` y `REPAIR_STATUS_FINAL.md` traían tablas presentadas como medidas que eran objetivos: se les antepuso una corrección explícita.
