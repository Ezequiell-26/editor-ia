# concat-worker

Worker standalone de Concat: proceso hijo que la app de escritorio invoca
para las operaciones que necesitan `concat-media` (FFmpeg in-process).

## Por qué existe como proceso separado

`concat-media` usa `ffmpeg-the-third 6` → `ffmpeg-sys-the-third`, que declara
`links = "ffmpeg"` y **colisiona** con `ffmpeg-sys-next` (video-rs) si ambos
se linkean en el mismo binario. Por eso `concat-media` no está en las deps
de `apps/desktop/src-tauri`: vive acá, en su propio crate con su propio
`[workspace]`, y la app le habla por pipes.

Consecuencias:

- Workspace propio (`[workspace]` vacío en `Cargo.toml`): resolución de deps
  y `Cargo.lock`/`target/` independientes. No comparte build graph con la
  app ni con `vendor/concat`.
- Binario `concat-worker.exe` autocontenido en lo que al código respecta;
  **en runtime necesita las DLLs de FFmpeg** (las mismas que resuelve
  `scripts/rust-env.mjs`: `D:\DevCache\ffmpeg-n9.0-lgpl\...\bin` o las
  `resources/ffmpeg-dll` de la app si la versión de FFmpeg coincide).
- `#![windows_subsystem = "windows"]`: no abre consola propia. La app debe
  spawnearlo con pipes (stdin/stdout) y `CREATE_NO_WINDOW`; al no ser
  subsystem console, si alguien lo ejecuta a mano sin pipes stdin llega en
  EOF y el proceso sale limpio.

## Protocolo: JSON-lines por stdin/stdout

Una request por línea, una respuesta por línea. Nada más se escribe en
stdout.

### Requests

```json
{"op":"ping"}
{"op":"shutdown"}
{"op":"probe","path":"D:/media/clip.mp4"}
{"op":"decode_frame","path":"D:/media/clip.mp4","time":"1.5","out":"D:/tmp/f.png"}
{"op":"render_export","output":"D:/out.mp4","width":1920,"height":1080,
 "frame_rate":"30000/1001","codec":"h264","crf":18,
 "clips":[{"path":"D:/a.mp4","in":"0.5","duration":"4","audio":true},
          {"path":"D:/b.mp4","start":"4","x":100,"y":100,"width":640,
           "height":360,"fit":"cover"}]}
```

`render_export` exporta una composición simple (concat + PiP básico, sin
concat-project ni GPU — ver `src/render_export.rs` para el alcance exacto):

- Canvas `width`x`height` (si se omiten, el tamaño del primer clip), a
  `frame_rate` constante (`"num/den"`, decimal o número; default el fps del
  primer clip o 30).
- Cada clip: `path` (requerido), `in` (entrada en la fuente, segundos),
  `start` (dónde aparece en el timeline; default: fin del clip anterior),
  `duration` (default: lo que queda del medio, dividido por `speed`),
  `x`/`y`/`width`/`height` (rect de destino en px; default todo el
  canvas), `fit` (`contain`/`cover`/`fill`, default `contain`), `audio`
  (default `false`), `speed` (default `1`; número o `"num/den"`, rango
  0.0625..=16) y `transition` (ver abajo).
- `transition` (por clip, se funde con el clip anterior en `clips`):
  `{"type": "dissolve", "duration": "0.5"}` o `{"type": "wipeleft",
  "frames": 15}` — `duration` en segundos o `frames` de salida, uno solo.
  Durante la ventana el frame es la mezcla CPU de la escena sin el clip
  entrante (con el saliente extendido, su fuente sigue corriendo) y la
  escena completa, con las mismas formas xfade que dibuja Concat sin GPU
  (`src/transitions.rs`, port del fallback de concat-render): dissolve,
  fadeblack/white, wipes duros y suaves en 8 direcciones, radial, iris,
  bars, slides/cover/reveal, zoomin, pixelize, rectcrop. Reglas: el clip
  entrante no puede ser el primero, la transición no puede durar más que
  el clip y las ventanas no pueden superponerse; el clip anterior tiene
  que llegar al `start` del entrante (sin gap).
- Tiempos como strings: `"1.5"`, `"3/2"`, `"2"`. `frame_rate` también acepta
  número JSON.
- `codec`: `h264` (default), `hevc`, `av1`, `prores-4444`, `vp9-alpha`;
  `preset` y `crf` ajustan calidad; `hardware:false` fuerza software.
- Audio por clip con `"audio":true`: mezcla 48 kHz estéreo AAC y mux
  stream-copy. Sin clips con audio la salida es video-only.
- Los clips se pintan en orden: los últimos cubren a los anteriores. No hay
  alpha blending — cada clip pinta su rect opaco.
- Devuelve `output`, `frames`, `duration(_seconds)`, `frame_rate`, `codec`,
  `audio`, `audio_clips`, `audio_clips_skipped`, `transitions`.

`decode_frame` acepta además:

- `time`: `"1.5"` (segundos), `"30000/1001"` (racional exacto) o `"2"`.
  Devuelve el **primer frame en o después** del instante (seek al keyframe
  anterior + decodificación exacta).
- `width` + `height` (juntas o ninguna): escala de salida.
- `format`: `"png"` (default) o `"jpeg"`. Si se omite se infiere de la
  extensión de `out` (`.png`, `.jpg`/`.jpeg`; otra cosa → PNG).
- `quality`: 1..=100 para JPEG (default 92). Ignorada en PNG.

### Respuestas

```json
{"ok":true}
{"ok":true,"pong":true}
{"ok":true,"path":"...","duration":"23/10","duration_seconds":2.3,
 "video":{"codec":"h264","width":1920,"height":1080,"frame_rate":"30/1",
          "frame_rate_fps":30.0,"cadence":"30/1","cadence_fps":30.0,
          "color_range":"limited","signal":"sdr","keyframes":["0/1"]},
 "audio":{"codec":"aac","sample_rate":48000,"channels":2,...},
 "audio_streams":[...]}
{"ok":true,"path":"f.png","width":1920,"height":1080,
 "position":"30/1","position_seconds":1.0}
{"ok":false,"error":"open failed for ...: No such file or directory"}
```

- `ok:false` nunca crashea el proceso: la op falló, el loop sigue.
- `{"op":"shutdown"}` responde `{"ok":true}` y el proceso sale limpio.
- EOF en stdin (padre cerró el pipe) también termina el proceso.

### Ops implementadas

| op | estado |
|---|---|
| `ping` | ✅ healthcheck |
| `shutdown` | ✅ cierre limpio |
| `probe` | ✅ metadata completa vía `concat_media::probe` |
| `decode_frame` | ✅ frame RGBA8 → PNG/JPEG vía `concat_media::Decoder` |
| `render_export` | ✅ export: clips+rect+fit, speed por clip, transiciones xfade CPU, H.264/HEVC/AV1/ProRes/VP9, audio opcional |

### Alcance de `render_export` (lo que NO hace)

- No usa `concat-project` (documento), `concat-render` (plan/GPU) ni
  `concat-export` — este último ni siquiera está vendorado (depende de
  concat-vision/ONNX). El compositing es CPU: bilineal RGBA en el worker.
- `speed` es retime constante por clip (video remuestreado + `atempo` en
  el audio); no hay speed curves.
- Transiciones: sólo video, sólo entre un clip y el anterior en `clips`,
  y son de completo (la mezcla es del canvas entero, no del rect del
  clip). El audio no hace crossfade: durante la ventana suena la mezcla
  normal de ambos clips.
- Sin efectos, texto ni keyframes de transform.
- Sin alpha blending entre clips fuera de las transiciones (orden de
  pintado, opaco).
- Audio: sólo mezcla lineal por clip con `audio:true`; sin buses, fades ni
  volume curves expuestas (los defaults de `AudioClip` aplican).
- Frames de 16 bits (HDR) se rechazan con error claro.

### Pendiente (fases siguientes)

- `render_export` completo sobre el pipeline Concat: timelines
  (`concat-project`), composición GPU (`concat-render`/wgpu), `plan_frame`
  y el orquestador de `concat-export` si se vendoriza sin concat-vision.
- `concat-vision`/`concat-export` (evaluado 2026-11, fases 1-2): los
  crates NO están en `vendor/concat/crates/` — no hay fuente que
  vendorizar en este repo. `concat-export` orquesta doc→timeline→archivo
  y depende de `concat-vision` (máscaras/cutout ONNX); vendorizarlo
  exigiría primero traer ambas fuentes externas (licencia AGPL, headers
  a preservar) y resolver ONNX Runtime en el workspace del worker. Plan
  si se conseguyen las fuentes: (1) copiar `concat-vision` sin la parte
  de inferencia ONNX o con un feature flag, (2) `concat-export` como
  path-dep, (3) exponer una op `export_project` que reciba el documento
  concat-project ya serializado. Mientras tanto `render_export` cubre el
  caso "clips + transiciones + speed" sin GPU.
- Speed curves por clip (concat-project `speed.rs` define puntos
  `(at, speed)` con tangentes; el audio de concat-media ya acepta
  `tempo` por pasos — haría falta mapear curva→pasos o integrar la curva
  para el video).
- Transiciones de audio (crossfade simétrico durante la ventana) y
  transiciones con geometría propia (el clip entrante entrando desde un
  lado en vez de fundirse en el sitio).
- Alpha blending por clip (hoy sólo dentro de `transition`).
- Audio: más controles (volumen, fades, buses) cuando la app los pida.
- `decode_frame` de frames deep (16-bit, HDR) — hoy devuelve error claro.

## Build y test

Siempre vía `scripts/rust-env.mjs` (MSVC + FFmpeg dev + CARGO_HOME):

```sh
cd apps/concat-worker
node ../../scripts/rust-env.mjs -- cargo check
node ../../scripts/rust-env.mjs -- cargo test
node ../../scripts/rust-env.mjs -- cargo build
```

`cargo test` corre 27 tests: parseo/envelope del protocolo (puros), las
formas de transición (`src/transitions.rs`, port del fallback CPU de
concat-render — mismo SPDX AGPL y atribución) y smoke tests reales de
`probe`/`decode_frame`/`render_export` sobre
`vendor/concat/crates/concat-media/fixtures/vfr-still-screen.mp4` (los de
export escriben MP4 H.264 reales — incluido uno con dissolve+speed y otro
con wipeleft — y los reproban).

## Smoke manual

```sh
# con el PATH de FFmpeg que arma rust-env:
printf '%s\n' '{"op":"ping"}' '{"op":"shutdown"}' | concat-worker.exe
# → {"ok":true}\n{"ok":true}
```

## Deps nuevas y por qué

- `concat-core`, `concat-media` (path a `vendor/concat`): el trabajo real.
  `render_export` también usa `concat_media::audio` (mezcla + mux) y
  `concat_core::animate::Track` para el `volume_curve` de `AudioClip`.
- `serde`/`serde_json`: protocolo.
- `png 0.18`: concat-media sólo expone `encode::jpeg`; el PNG sale con la
  misma versión de `png` que ya usa `concat-text` (puro Rust, sin C).

No se agregaron `concat-project`, `concat-render` ni `concat-export`:
`render_export` compone en CPU sobre `concat-media` y no los necesita;
`concat-render` arrastraría wgpu entero al binario y `concat-export` no
está vendorado (depende de concat-vision/ONNX Runtime).
