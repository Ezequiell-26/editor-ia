# Vendor: Concat engine crates

Código vendorado desde <https://github.com/jub0t/Concat> (autor: Jareer
Abdullah, @jub0t), snapshot del 2026-11-12, versión de workspace 0.2.10.

- Licencia: **AGPL-3.0-or-later** — el texto completo está en `LICENSE`.
  Olyvia incorpora este código bajo esa licencia; la oferta de código
  fuente correspondiente es este mismo repositorio.
- Se vendoriza **por crate y por fases** (ver `docs/architecture/PDF-100-TRACKER.md`
  y la bitácora del plan Concat). No se copian los crates de UI Slint
  (`concat`, `concat-android`, `concat-mobile`): su cadena de licencia
  (Slint GPL-3.0-only / Royalty-free no transferible) los hace
  impropios para este producto.
- Los crates conservan sus headers SPDX y copyright originales; está
  prohibido quitar o "relicenciar" esas cabeceras.
- Crates vendorados:
  - 2026-11-12 — `concat-core` (Fase A): tiempo racional, arenas, modelo de
    timeline; std-only.
  - 2026-11-12 — `concat-project` (Fase B): documento de proyecto, comandos,
    undo/redo, lector tolerante; feature opcional `schema` (schemars) sin
    habilitar por Olyvia.
  - 2026-11-12 — `concat-effects` (Fase B): catálogo de efectos desde
    manifests TOML con ~200 paquetes built-in embebidos en
    `crates/concat-effects/packages/` (mismos headers AGPL, sin licencias
    de terceros propias). Usa `naga` (MIT OR Apache-2.0) para validar WGSL.
  - 2026-11-12 — `concat-speech-min` (Fase C): **extracción parcial** de
    `concat-speech`, sólo `src/transcribe.rs` (transcripción whisper.cpp
    in-process). El crate completo NO se vendoriza: depende de
    `concat-host`, `concat-media`, `concat-log`, `ort` (ONNX Runtime),
    `tokenizers`, `realfft` y `concat-vision`, ninguno vendorizable.
    Adaptaciones con headers SPDX propios: `AppDirs` → `&Path` al
    directorio de modelos, `SingleFlight`/`models::fetch` copiados a
    `src/lib.rs`/`src/download.rs` (sin preferencias de fuente ni proxy
    explícito), `AudioDecoder` → `src/wav.rs` (WAV→16 kHz mono f32) más
    `Transcriber::transcribe_samples` para PCM ya decodificado por el
    pipeline FFmpeg de Olyvia. Chatterbox TTS, aislamiento de voz
    (DeepFilterNet) y TTS por voz del sistema quedaron afuera.
    `assets/ggml-silero-v6.2.0.bin` (868 KB, VAD de whisper.cpp, licencia
    MIT — ggml-org/whisper-vad) se embebe con `include_bytes!`.
    Dependencias nuevas: `whisper-rs` 0.16 (compila whisper.cpp con
    cmake+bindgen en build time; whisper.cpp es MIT), `ureq` 2 (MIT),
    `sha2` 0.10 (MIT OR Apache-2.0), `log`. Los modelos `ggml-*.bin` NO
    se commitean: se descargan bajo demanda (mirror de Concat +
    Hugging Face pineado a commit, verificación SHA-256) o se instalan
    con `speech::supply` desde una descarga manual.
  - 2026-11-12 — Fase D, pipeline de render/composición (4 crates):
    - `concat-text`: títulos como píxeles. Rasteriza `TitleStyle` a un
      canvas RGBA con shaping HarfBuzz (rustybuzz), fuentes del sistema
      (fontdb) y ~89 familias bundled embebidas con `include_bytes!`
      (~16 MB en `crates/concat-text/fonts/` — cada `.ttf`/`.otf` con su
      `LICENSE-*.txt` propio: SIL OFL 1.1 y Apache-2.0; Pixelify Sans y
      Google Sans Code son fuentes variables). Dependencias nuevas:
      fontdb 0.23, rustybuzz 0.20, ttf-parser 0.25, memmap2, unicode-bidi/
      linebreak/script/ccc/vo, tiny-skia 0.12, png 0.18.
    - `concat-log`: log por run de Concat (un archivo por corrida,
      consola, `log` facade, colours en Windows vía windows-sys 0.61).
      Sólo `log` + `windows-sys`.
    - `concat-render`: `plan_frame` (timeline + instante → `FramePlan`,
      puro, sin IO) y `WgpuCompositor` (compositor GPU sobre wgpu 30,
      con fallback al adaptador software; `pollster`, `half`). Los tests
      de paridad CPU↔GPU corren contra una GPU real. **Adaptación
      vendor**: el dev-dependency `concat-vision` y el módulo de tests
      de `src/upscale.rs` que lo usaba fueron eliminados (concat-vision
      requiere ONNX Runtime y no se vendoriza); el código de producción
      de `Upscaler` queda intacto. *(Actualización 2026-11-13: concat-vision
      SÍ se vendoriza desde esa fecha, sin la feature `infer`; ver abajo.)*
    - `concat-media`: decode/encode/probe/pool/prefetch de medios con
      FFmpeg **in-process** vía `ffmpeg-the-third` 6.0 (`ffmpeg-sys-
      the-third`, bindgen+pkg-config; soporta FFmpeg 5.1–9.0 — se
      verificó contra el FFmpeg 9.0 shared de `D:\DevCache`), más
      `resvg` 0.48 para SVG→PNG. Es el único crate que linkea libav*;
      a diferencia del pipeline spawn-based de Olyvia, no necesita el
      binario `ffmpeg` en PATH. En Windows requiere `FFMPEG_DIR` +
      `LIBCLANG_PATH` en build (los provee `scripts/rust-env.mjs`).
      Dependencias nuevas: ffmpeg-the-third/-sys 6.0, resvg/usvg 0.48,
      tiny-skia-path, skrifa/harfrust/read-fonts/font-types, svgtypes,
      imagesize, data-url, simplecss, roxmltree, libc.
      **Vendorado pero NO enlazado en la app**: `ffmpeg-sys-the-third` y
      `ffmpeg-sys-next` (vía `video-rs`) declaran ambos `links = "ffmpeg"`
      y Cargo no permite dos crates con el mismo `links` en un binario
      (verificado: `cargo check` de la app falla en resolución). Para
      integrarlo hay que unificar el binding FFmpeg — p.ej. migrar la
      decodificación de `video-rs` a concat-media o reemplazar
      ffmpeg-next — decisión de arquitectura fuera de esta fase.
  - 2026-11-13 — `concat-vision` (**sin feature `infer`**): máscaras,
    pinceles, apply, stores y `stabilize` (tracking de esquinas
    Lucas-Kanade + RANSAC, aritmética pura — la opción que usa
    `apps/concat-worker` para `analyze_motion`). Copia byte a byte del
    snapshot de concat-ref; el crate conserva su feature `infer`
    (`dep:ort`) pero NADIE la habilita: `ort` quedó declarado en
    `[workspace.dependencies]` sólo para que el manifiesto resuelva —
    entra al Cargo.lock y jamás se compila. Los módulos `brush`,
    `runtime` y `segment` están tras `#[cfg(feature = "infer")]` y no se
    compilan. `models/selfie-segmentation.onnx` (462 KB, MediaPipe Selfie
    Segmentation 256×256, **Apache-2.0** — ver `models/NOTICE.md` y
    `THIRD-PARTY-NOTICES.md` de upstream) se copió por fidelidad pero
    sólo lo referencia `segment.rs`, código inerte sin `infer`.
    `enhance` compila pero `Enhancer` sólo se construye con `infer`.
    Dependencias sin `infer`: `concat-core`, `concat-project`, `png`
    0.17 — todas ya vendoradas o en cache.
  - **NO vendorados**: `concat-export` (orquestador
    documento→timeline→archivo) porque depende de `concat-vision` de
    forma no opcional (`MaskStore`, `mask_dir`, `stabilize::motion_dir`
    para recortes y estabilización — ONNX Runtime vía `ort`, modelos
    con pesos que no se distribuyen; el RVM-mobilenetv3 de
    `models.rs` es **GPL-3.0** y sigue excluido); `concat-host`,
    `concat-api`, `concat-server`, `concat-mcp`, `concat-cli`
    (host/red/servicios) y los crates UI (`concat`, `concat-android`,
    `concat-mobile`).
    Consecuencia: el compositor y el decode quedan disponibles, pero la
    orquestación "documento→archivo" sigue siendo del pipeline propio
    de Olyvia; `concat-export` puede evaluarse después si se decide
    vendorizar `ort` o recortar la parte de máscaras.
- No se usa el nombre ni los assets de marca "Concat" en la UI de Olyvia.
