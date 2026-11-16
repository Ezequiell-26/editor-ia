# 2026-11-12 — Vendor Concat engine en Olyvia (Fase A hecha)

## Decisión del usuario

- Repo de referencia: https://github.com/jub0t/Concat clonado en
  `D:\Users\ofici\QODER-WORK\concat-ref` (depth 1, ~84 MB, versión 0.2.10).
- Estrategia elegida: **vendor del código engine** (no proceso externo, no
  clean-room). El usuario aceptó la implicación AGPL-3.0-or-later / licencia
  comercial pendiente de negociar con jub0t@gmail.com.
- Alcance: "todo hasta Fase D" empezando por Fase A para validar el mecanismo.

## Restricciones legales verificadas (agente de licencias)

- `concat`, `concat-android`, `concat-mobile` NO se vendorizan: Slint es
  GPL-3.0-only y su Royalty-free no pasa a forks.
- Modelo RVM (cutout) es GPL-3.0: excluir de builds cerrados.
- FFmpeg debe seguir siendo build LGPL (sin x264/x265/fdk-aac).
- Trademark: no usar nombre/logo "Concat" en UI de Olyvia.
- crates engine vendorables: core, project, render, export, effects, text,
  vision, speech, api, server, mcp, cli, host, log, media (selectivo).

## Fase A — concat-core (HECHA)

- Copiado a `vendor/concat/crates/concat-core` (12 archivos, std-only,
  ~5.3k LOC). Headers SPDX AGPL preservados.
- `vendor/concat/Cargo.toml`: workspace root propio (herencias
  `*.workspace = true`); `members = ["crates/*"]` toma crates por fase.
- `vendor/concat/LICENSE` (AGPL-3.0) + `vendor/concat/NOTICE.md`.
- `Cargo.toml` raíz: `exclude = ["vendor/concat"]` — SIN esto, Cargo aplica
  el workspace.package de Olyvia a los crates vendorados y falla la herencia
  de edition.
- `apps/desktop/src-tauri/Cargo.toml`: `concat-core = { path = "../../../vendor/concat/crates/concat-core" }`.
- `src/vendor_concat.rs`: seam de integración (`pub use concat_core as core`)
  + 3 smoke tests.
- Evidencia: `cargo check --lib` OK (3m06s), `cargo test --lib vendor_concat`
  3/3, suite propia del crate 92 tests + 2 doctests verdes en su workspace.
- `THIRD-PARTY-NOTICES.md`: sección "Agregados 2026-11-12 (crates Concat
  vendorados)".

## Hallazgos del análisis (para las fases siguientes)

- Paridad Concat↔Olyvia: Olyvia ya tiene casi todo el core (multicam,
  EDL/OTIO/FCPXML, scopes, agente IA, OBS). Lo que Concat aporta: whisper.cpp
  in-process (sin Python), import drafts CapCut (`concat-project/capcut.rs`),
  export α/HDR/ProRes, ~100 efectos data-driven (`concat-effects`),
  compositor wgpu (`concat-render`), Chatterbox TTS, plantillas con slots,
  multi-timeline, API JSON-RPC/gRPC/CLI.
- API: ~60 ops `edit.apply` + ~45 tools MCP + eventos push; auth token bearer
  con handshake `auth` (copiable a nuestro mcp_server).
- Modelo proyecto Concat: carpeta + `concat.json` v2, serde tolerante con
  `extra` round-trip + migraciones + undo por Command. Olyvia: archivo
  `.editoria.json` estricto schemaVersion 1. No compatibles 1:1 — mapear.

## Pendiente

- Fase B: vendor concat-project + concat-effects.
- Fase C: concat-speech (whisper.cpp in-process) — ojo deps a
  concat-host/media/log; quizá extraer solo transcribe.
- Fase D: concat-render (wgpu) + concat-export — la pieza pesada.
- `rust-timeouts` agent del PDF seguía corriendo al cierre de Fase A.

## Fase D — render/composición (HECHA 2026-11-12, alcance recortado)

Vendorados en `vendor/concat/crates/`: `concat-text` (títulos→RGBA,
~89 fuentes bundled OFL/Apache en `fonts/` con sus LICENSE-*.txt),
`concat-log`, `concat-render` (plan_frame puro + WgpuCompositor wgpu 30)
y `concat-media` (FFmpeg in-process vía ffmpeg-the-third 6.0 =
ffmpeg-sys-the-third, soporta FFmpeg 5.1–9.0; resvg 0.48 para SVG).

**NO vendorados**: `concat-export` y `concat-vision` — concat-export
depende de concat-vision de forma NO opcional (MaskStore/mask_dir/
stabilize para recortes, ONNX Runtime `ort`), y concat-vision además
arrastra los modelos RVM GPL excluidos por la decisión legal.

**Adaptación vendor**: en concat-render se eliminó el dev-dep
`concat-vision` y el `mod tests` de `src/upscale.rs` que lo usaba
(comparaba GPU vs referencia CPU del modelo); producción intacta.

**Bloqueo real encontrado**: `concat-media` NO puede entrar al árbol de
la app — `ffmpeg-sys-the-third` y `ffmpeg-sys-next` (vía `video-rs`)
declaran ambos `links = "ffmpeg"` y Cargo rechaza la duplicidad
(verificado con `cargo check` de la app). Queda vendorado y verde en su
workspace; integrarlo exige unificar el binding FFmpeg (p.ej. migrar la
decodificación de video-rs a concat-media, o retirar ffmpeg-next).
Path deps de app: concat-text, concat-log, concat-render.

**Toolchain**: en vendor/concat los crates cmake (whisper-rs-sys) y en
raíz requieren `CMAKE_GENERATOR=Ninja` + `CC_/CXX_x86_64_pc_windows_msvc`
+ `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER` apuntando a BuildTools
14.44 (`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\
VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\`); sin eso cmake elige "Visual
Studio 18 2026" y no halla cl. Ojo: un CMakeCache viejo con otro
generador rompe el configure ("does not match the generator") — borrar
`target/*/build/whisper-rs-sys-*/out/build` resuelve.

**Evidencia**: `cargo check --workspace` verde (8 crates);
`cargo test` por crate: core 92, effects 74, log 32, project 248,
render 111 (paridad GPU real), speech-min 15+3 ignored OK;
concat-media 152 ok / **3 failed** (encoders MediaFoundation del build
FFmpeg 9: h264_mf CBR 479 vs 1000 kb/s, hevc "Generic error in external
library" ×2 — entorno, no código); concat-text 80 ok / **1 failed**
(`emoji_sequences_draw_as_one_picture` — necesita fuente emoji a color
del sistema). Raíz: `cargo check --lib -p editor-ia-desktop` verde con
el workaround (agregó ~55 crates: árbol wgpu 30 + rustybuzz/tiny-skia).

**Integración prevista**: concat-render es complementar al pipeline
spawn-based — `plan_frame` describe el frame sin IO y `WgpuCompositor`
dibuja; encaja como preview/composición GPU mientras concat-media (una
vez resuelto `links`) reemplazaría decode/encode in-process.

## Fases C y D — resultado (2026-11-12)

- **Fase C**: `concat-speech-min` — extracción de `concat-speech` (solo
  transcribe.rs + deps mínimas). whisper.cpp in-process vía whisper-rs-sys
  (cmake+bindgen). Plan de integración con pipeline Python documentado en el
  reporte del agente. Modelos ggml on-demand con sha256.
- **Fase D**: vendorados `concat-text` (tipografía, ~89 fuentes OFL/Apache
  embebidas ~16MB), `concat-log`, `concat-render` (plan_frame + WgpuCompositor
  wgpu 30; paridad CPU↔GPU testeada), `concat-media` (ffmpeg-the-third 6.0,
  VERDE en workspace pero NO enlazado en la app).
- NO vendorados: `concat-export` (necesita concat-vision+concat-media),
  `concat-vision` (excluido por modelos GPL; viable sin feature `infer`),
  `concat-host/api/server/mcp/cli` + UI Slint.
- Tests vendor workspace: core 92, project 248, effects 74, speech-min 15,
  text 80 (1 fail por fuente emoji del SO), log 32, render 111, media 152
  (3 fails de entorno MediaFoundation). Integración app: 11 smoke tests.
- Fallos de entorno documentados: emoji_sequences (fuente color emoji),
  h264_mf/hevc MediaFoundation en FFmpeg 9 build.

## Decisión arquitectónica: links="ffmpeg" (evaluación completa)

Conflicto: `ffmpeg-sys-next` (vía video-rs, único uso in-process = preview_frame
decode.rs) vs `ffmpeg-sys-the-third` (concat-media). Ambos `links="ffmpeg"`.

Recomendación del análisis (4 estrategias evaluadas): **worker/proceso
aislado** — crate/bin separado que linkee concat-media/export/vision mientras
la app sigue con ffmpeg-next. Parchear `links` = riesgo ABI alto; migrar todo
in-process = toca el único camino video-rs sin eliminar el 95% de uso CLI.

Hallazgo clave: `concat-export` compila con `concat-vision` SIN feature
`infer` (sin ort/modelos); masks/motion/stabilize degradan a no-op sin cache.

Plan propuesto: Fase 1 worker JSON-RPC → Fase 2 concat-media en worker →
Fase 3 vision-no-infer + export en worker → Fase 4 comando Tauri + packaging.
