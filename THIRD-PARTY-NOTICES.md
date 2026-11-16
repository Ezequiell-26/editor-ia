# Avisos de terceros — Olyvia

Olyvia se distribuye bajo licencia MIT **sólo para su código propio**. Este
archivo enumera las dependencias directas y las herramientas externas que el
producto usa, con la licencia verificada en su ecosistema (npm registry o
crates.io) el 2026-10-21.

Las dependencias transitivas están fijadas en `package-lock.json` y `Cargo.lock`;
sus licencias acompañan a cada paquete en `node_modules/` y en el registro de
Cargo. Antes de redistribuir un instalador, revisá también esos árboles.

## Dependencias JavaScript directas

| Componente | Versión | Licencia | Uso |
| --- | --- | --- | --- |
| React / React DOM | 19.x | MIT | Interfaz |
| `@tauri-apps/api` | 2.12.x | Apache-2.0 OR MIT | Puente IPC con el proceso nativo |
| `zod` | 3.x | MIT | Esquema del proyecto |
| `minisearch` | 7.2.0 | MIT | Índice de búsqueda global (**nuevo en esta ronda**) |
| `fflate` | 0.8.3 | MIT | ZIP del paquete de entrega (**nuevo en esta ronda**) |
| `subsrt` | 1.1.1 | MIT | Importación de subtítulos ASS/SSA (**nuevo en esta ronda**) |
| `@xyflow/react` | 12.12.1 | MIT | Editor visual de nodos (canvas, conexiones y pan/zoom) |
| `@dnd-kit/core` | 6.x | MIT | Drag & drop de clips en la timeline |
| `bezier-js` | 6.x | MIT | Interpolación de keyframes |
| `emojibase-data` | 18.x | MIT | Datos de emojis para el picker |
| `lottie-web` | 5.x | MIT | Render de animaciones Lottie |

## Dependencias Rust directas

| Componente | Licencia | Uso |
| --- | --- | --- |
| `tauri` | Apache-2.0 OR MIT | Shell de escritorio |
| `tauri-plugin-dialog` | Apache-2.0 OR MIT | Diálogos nativos |
| `tauri-plugin-opener` | Apache-2.0 OR MIT | Abrir rutas y enlaces |
| `tauri-plugin-notification` | Apache-2.0 OR MIT | Notificaciones nativas del sistema |
| `tauri-build` (build-dependency) | Apache-2.0 OR MIT | Compilación de assets del shell |
| `tokio` | MIT | Runtime async (tareas de exportación y creador) |
| `serde` / `serde_json` | MIT OR Apache-2.0 | Serialización |
| `sha2` | MIT OR Apache-2.0 | SHA-256 de medios y artefactos |
| `ring` | Apache-2.0 AND ISC | Criptografía (rustls/ring del stack TLS) |
| `md-5` | MIT OR Apache-2.0 | Hashes MD5 de compatibilidad |
| `base64` | MIT OR Apache-2.0 | Transporte del ZIP por IPC |
| `reqwest` | MIT OR Apache-2.0 | Llamadas HTTP a proveedores |
| `keyring` | MIT OR Apache-2.0 | Administrador de credenciales de Windows |
| `uuid` | Apache-2.0 OR MIT | Identificadores |
| `tokio-tungstenite` + `futures-util` | MIT/Apache-2.0 | WebSocket CDP para instancias aisladas de navegador (**nuevo**) |
| `qrcodegen` | MIT | Matriz QR offline para el CTA de entrega |
| `thiserror` | MIT OR Apache-2.0 | Errores tipados de los módulos de creador |
| `rustface` | BSD-2-Clause | Detección facial local (smart reframe) |
| `roxmltree` | MIT OR Apache-2.0 | Validación del FCPXML exportado |
| `windows` 0.62 | MIT OR Apache-2.0 | DirectWrite para el selector de fuentes |
| `zip` | MIT | Lectura de paquetes ZIP de modelos con pesos externos |
| `filmcraft-audio-dsp` / `filmcraft-color` / `filmcraft-scopes` | MIT OR Apache-2.0 | DSP, color y scopes (git fijado, ver sección FilmCraft) |

## Herramientas externas (no se distribuyen dentro del binario)

| Herramienta | Licencia | Uso |
| --- | --- | --- |
| FFmpeg / FFprobe (binarios estáticos `ffmpeg.exe`/`ffprobe.exe`) | GPL-3.0 (build `release-essentials` de gyan.dev; texto en `resources/ffmpeg/FFMPEG-GPL-LICENSE.txt` y `FFMPEG-GPL-README.txt`) | Render, medición y conversión; se invocan como proceso separado |
| yt-dlp | Unlicense | Descarga de contenido público |
| Faster-Whisper | MIT | Transcripción local |
| whiteboard-animator | MIT (© Masih Sultani; modelo CRAFT ONNX de CRAFT-pytorch, MIT © clovaai) | Animación whiteboard local (imagen → video de dibujo a mano) |
| Windows SAPI | Componente del sistema operativo | Voz local por PowerShell |
| FFmpeg/libass (DLLs compartidas `avcodec-63`, `avformat-63`, etc.) | LGPL-3.0 (build `win64-lgpl-shared` de BtbN; texto en `resources/ffmpeg-dll/LICENSE.txt` y `resources/ffmpeg/LICENSE.txt`) | Decode en proceso del monitor 1:1 vía video-rs; subtítulos quemados. Ya cubierto por la entrada de FFmpeg |

El instalador distribuye DOS builds de FFmpeg, ambos con su licencia junto al
binario: el estático GPL-3.0 de gyan.dev (`ffmpeg/ffmpeg.exe`,
`ffmpeg/ffprobe.exe`, avisos `FFMPEG-GPL-*`) y las DLLs LGPL-3.0 de BtbN
(`avcodec-63.dll`, etc., aviso `FFMPEG-LICENSE.txt` /
`resources/ffmpeg-dll/LICENSE.txt`). Al redistribuir el instalador, las
obligaciones de ambas licencias (GPL-3.0 y LGPL-3.0) recaen sobre esa
distribución: texto de licencia incluido, código fuente disponible en
https://github.com/FFmpeg/FFmpeg (tags `n9.0` y la release correspondiente al
build estático).

## Texto de la licencia MIT

Las dependencias marcadas como MIT se distribuyen con el siguiente permiso. El
copyright de cada una pertenece a sus autores, indicados en el `LICENSE` del
paquete correspondiente.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Para Apache-2.0, el texto completo está en
<https://www.apache.org/licenses/LICENSE-2.0>.

## Cómo verificar esta lista

```bash
npm view minisearch license
npm view fflate license
npm view subsrt license
curl -s https://crates.io/api/v1/crates/tauri | grep -o '"license":"[^"]*"'
npm ls --omit=dev
cargo tree --depth 1
```

## Agregados 2026-10-22 (Fase 3)

- **ort** 2.0.0-rc.15 (MIT / Apache-2.0): enlaces Rust a ONNX Runtime. Se usa
  con `load-dynamic`: el runtime no se enlaza, se carga `onnxruntime.dll`
  (ONNX Runtime 1.22, **MIT**, © Microsoft) distribuido junto a la app.
- **image** 0.25 (MIT / Apache-2.0): decodificación y codificación de imágenes
  para las capacidades de IA.
- **Modelo u2netp** (pesos): U²-Net es Apache-2.0; la conversión ONNX proviene
  de rembg (MIT). Checksum SHA-256 fijado y verificado en cada descarga.
- Nota: `ort` 2.0.0 está en versión candidata (rc.15); es la serie que usa el
  ecosistema en producción y la API se fijó contra el código vendido.
- **Modelo Real-ESRGAN-x4plus** (pesos + export ONNX): Qualcomm AI Hub,
  BSD-3-Clause, sobre la arquitectura de xinntao/Real-ESRGAN (BSD-3-Clause).
  Dos archivos con checksum fijado (onnx + pesos externos).

## Agregados 2026-10-23 (motor de lip-sync)

- **Adaptador `scripts/lipsync-engine/server.py`**: código propio de Olyvia
  bajo MIT. No incluye modelos ni descarga pesos.
- **Wav2Lip** (código y checkpoint `wav2lip_gan.pth`): uso **personal,
  investigación y no comercial**; el README oficial prohíbe expresamente el uso
  comercial porque el modelo se entrenó con LRS2. No se distribuye con Editor
  IA. Instalado fuera del repo en
  `D:\Users\ofici\IA_CENTRAL\04_APLICACIONES_IA\LipSyncEngine\Wav2Lip`;
  checkpoint de 145 829 145 bytes, SHA-256
  `180cfd49d31d47f195d5bfc62830ffe2c40724b7bbbce6faadc73ac6ab1a3b8e`.
  Para uso comercial hace falta una licencia de los autores o un motor con
  licencia compatible.
- **MuseTalk**: código MIT según su `LICENSE`; los modelos de terceros que usa
  conservan sus propias licencias. Clonado como alternativa, **no instalado ni
  verificado**.
- **LatentSync**: Apache-2.0 según su `LICENSE`; requiere CUDA/VRAM y no está
  instalado ni verificado en esta máquina.
- **FilmCraft `filmcraft-audio-dsp`**: MIT OR Apache-2.0, © ArtCraft Team y
  colaboradores. Se compila como dependencia git fijada al commit
  `abf44fda9015f4b7a96dc338f6042499bf8e9d9f`; se usan la cadena de audio DSP y el motor de scopes (waveform,
  vectorscopio e histograma) y la escritura/validación de LUTs `.cube` (denoise, de-hum, de-esser, de-reverb, EQ, compresor, realce de voz y
  limitador). No se copia el resto del editor FilmCraft.
- **Dependencias Python del motor** (externas, no se empaquetan): PyTorch
  2.14.1+cpu (Apache-2.0/BSD/MIT según sus componentes), torchvision 0.29.1
  (BSD), NumPy 1.26.4 (BSD-3-Clause), OpenCV 4.11 (Apache-2.0), librosa 0.11
  (ISC), face-alignment 1.5 (BSD-3-Clause), SciPy (BSD-3-Clause), SoundFile
  (BSD-3-Clause).

## Agregados 2026-10-23 (monitor 1:1 con video-rs)

- **video-rs** 0.12 (MIT OR Apache-2.0, © Oddity.ai): decodifica el frame del
  clip en proceso, a su resolución nativa, para el modo 1:1 del monitor. Se usa
  con la feature `ndarray` para obtener RGB24 y el timestamp del frame.
- **ffmpeg-next** 9.0.0 y **ffmpeg-sys-next** 9.0.1 (WTFPL): capa Rust sobre
  libavcodec/libavformat/libavutil/libswscale/libswresample.
- **Piper TTS 2023.11.14-2** (MIT): `resources/piper/piper.exe` + ONNX Runtime
  (MIT) + voz `es_ES-davefx-medium` (dataset CC0 según model card). Notas en
  `resources/piper/THIRD-PARTY-NOTICES.txt`.
- **eSpeak NG** (GPL-3.0): `resources/piper/espeak-ng.dll` +
  `espeak-ng-data/`. Corre dentro de `piper.exe` como proceso separado
  (obra agregada; la app no enlaza su código). Cumplimiento: licencia
  completa en `resources/piper/espeak-ng/LICENSE.txt` y oferta de fuente
  escrita en `resources/piper/espeak-ng/SOURCE.txt`, ambos en el bundle.

- **FFmpeg 9.0 shared LGPL** (LGPL-3.0): DLLs `avcodec-63`,
  `avdevice-63`, `avfilter-12`, `avformat-63`, `avutil-61`, `swscale-10` y
  `swresample-7` del build `win64-lgpl-shared-9.0` de BtbN. Se distribuyen sin
  modificar junto al ejecutable; el aviso de licencia queda como
  `FFMPEG-LICENSE.txt`. Código fuente: https://github.com/FFmpeg/FFmpeg
  (tag `n9.0`). El `ffmpeg.exe`/`ffprobe.exe` estático que usa el render es el
  build GPL-3.0 de gyan.dev (`ffmpeg-release-essentials`): se distribuye con el
  texto GPL-3.0 y el README del paquete en `ffmpeg/FFMPEG-GPL-LICENSE.txt` y
  `ffmpeg/FFMPEG-GPL-README.txt` (los copia `scripts/ci-bundle-resources.sh`).
- **ndarray** 0.17.2 (MIT OR Apache-2.0), dependencia opcional de video-rs.

## Agregados 2026-11-12 (auditoría de licencias del bundle)

- Las filas añadidas a las tablas de dependencias directas se verificaron en
  `node_modules/*/package.json` (JS) y en el `Cargo.toml` de cada crate en el
  registro local de Cargo (Rust): `ring` es Apache-2.0 AND ISC, `rustface` es
  BSD-2-Clause y `roxmltree` es MIT OR Apache-2.0 (el comentario del
  `Cargo.toml` decía sólo MIT).
- `resources/ffmpeg/` ahora incluye `FFMPEG-GPL-LICENSE.txt` y
  `FFMPEG-GPL-README.txt` (GPL-3.0 del paquete estático de gyan.dev), exigidos
  por `scripts/audit-bundle-licenses.mjs` (`npm run audit:licenses`).

## Agregados 2026-11-12 (crates Concat vendorados)

- **concat-core** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah / Concat):
  vendorado en `vendor/concat/crates/concat-core` como dependencia por path.
  Tiempo racional exacto, arenas y modelo de timeline, std-only. Texto de la
  licencia AGPL-3.0 en `vendor/concat/LICENSE`; notas de vendor y alcance en
  `vendor/concat/NOTICE.md`. Olyvia se distribuye bajo AGPL-3.0-or-later en lo
  que incorpore de estos crates (oferta de fuente: este repositorio).

## Agregados 2026-11-12 (Fase B del plan Concat)

- **concat-project** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah / Concat):
  vendorado en `vendor/concat/crates/concat-project`. Documento de proyecto,
  comandos serializables, undo/redo y lector tolerante; feature opcional
  `schema` (JSON Schema vía schemars) disponible pero no habilitada por Olyvia.
- **concat-effects** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah / Concat):
  vendorado en `vendor/concat/crates/concat-effects`. Catálogo de efectos
  cargado desde manifests TOML; incluye ~200 paquetes built-in bajo
  `crates/concat-effects/packages/` (cada uno `effect.toml`,
  `fixtures.toml` y opcionalmente `effect.wgsl`), todos originales de Concat
  bajo la misma licencia AGPL-3.0-or-later (sin licencias de terceros
  embebidas en los paquetes). Depende de `naga` (MIT OR Apache-2.0) para
  validar shaders WGSL.
  Mismas notas de licencia que concat-core: AGPL-3.0 en
  `vendor/concat/LICENSE`, alcance en `vendor/concat/NOTICE.md`.

## Agregados 2026-11-12 (Fase C del plan Concat: transcripción)

- **concat-speech-min** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah /
  Concat + © Olyvia por las adaptaciones): vendorado en
  `vendor/concat/crates/concat-speech-min`. Extracción de
  `concat-speech/src/transcribe.rs`: transcripción on-device con
  whisper.cpp en proceso (whisper-rs 0.16 → whisper-rs-sys 0.15, que
  compila whisper.cpp — licencia MIT, © ggerganov y colaboradores — con
  cmake+bindgen en build time). Se vendorizó sólo el módulo de
  transcripción; TTS/Chatterbox (ONNX Runtime), aislamiento de voz y
  TTS del sistema quedaron afuera por sus dependencias no vendorizables
  (`ort`, `concat-host`, `concat-media`, `concat-vision`, `tokenizers`,
  `realfft`). El VAD embebido `assets/ggml-silero-v6.2.0.bin` proviene de
  ggml-org/whisper-vad (licencia MIT). Dependencias nuevas del crate:
  `whisper-rs`/`whisper-rs-sys` (MIT), `ureq` 2.x (MIT), `sha2` 0.10
  (MIT OR Apache-2.0), `log` 0.4 (MIT OR Apache-2.0). Los modelos de
  whisper (`ggml-*.bin`, conversión MIT de ggerganov/whisper.cpp en
  Hugging Face) NO se distribuyen con la app: se descargan bajo demanda
  desde el mirror público de Concat (`jub0t/Concat` release
  `models-v1`) o Hugging Face con verificación SHA-256, o se instalan
  manualmente vía `concat_speech_min::supply`. Detalle completo en
  `vendor/concat/NOTICE.md`.

## Agregados 2026-11-12 (Fase D del plan Concat: render/composición)

- **concat-text** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah / Concat):
  vendorado en `vendor/concat/crates/concat-text`. Títulos como píxeles
  RGBA (shaping rustybuzz, raster tiny-skia). Embebe ~89 familias
  tipográficas en `crates/concat-text/fonts/` con sus licencias propias
  en `fonts/LICENSE-*.txt`: SIL Open Font License 1.1 (Hanken Grotesk,
  Noto Sans CJK/árabe/devanagari/hebreo/tailandés/bengalí, Kosugi Maru,
  Zen Tokyo Zoo, entre otras) y Apache License 2.0 (Inter, Montserrat,
  Space Grotesk, Archivo Black, Bebas Neue, Anton, DM Serif Display,
  Abril Fatface, Bangers, Permanent Marker, Pacifico, Lobster, Caveat
  Brush, Rubik Scribble, entre otras; Pixelify Sans y Google Sans Code
  con reserva de nombre de Google). Dependencias nuevas: fontdb 0.23,
  rustybuzz 0.20, ttf-parser 0.25, memmap2 0.9, unicode-bidi 0.3,
  unicode-linebreak 0.1, unicode-script 0.5, unicode-ccc, unicode-vo,
  tiny-skia 0.12 (MIT), png 0.18 (MIT OR Apache-2.0).
- **concat-log** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah / Concat):
  vendorado en `vendor/concat/crates/concat-log`. Log por run (archivo +
  consola). Dependencias: `log` 0.4 y `windows-sys` 0.61 (MIT OR
  Apache-2.0).
- **concat-render** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah /
  Concat): vendorado en `vendor/concat/crates/concat-render`.
  `plan_frame` (plan de frame puro) y `WgpuCompositor` sobre **wgpu
  30.0.1** (MIT OR Apache-2.0; arrastra naga 30, wgpu-hal/core/types,
  glow, khronos-api, gpu-allocator — todos MIT OR Apache-2.0) más
  `pollster` 0.4 (MIT OR Apache-2.0) y `half` 2 (MIT OR Apache-2.0).
  Adaptación documentada en `vendor/concat/NOTICE.md`: se eliminaron el
  dev-dependency `concat-vision` y los tests de `upscale.rs` que lo
  usaban (concat-vision no se vendoriza por ONNX Runtime).
- **concat-media** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah /
  Concat): vendorado en `vendor/concat/crates/concat-media`. Decode,
  encode, probe, pool y prefetch de medios con FFmpeg **in-process**
  vía **ffmpeg-the-third 6.0.0+ffmpeg-9.0** y ffmpeg-sys-the-third
  (MIT; soporta FFmpeg 5.1–9.0, linkeado contra el FFmpeg 9.0 LGPL
  shared de desarrollo — las DLLs LGPL ya se distribuyen con la app en
  `resources/ffmpeg-dll`). Además `resvg`/`usvg` 0.48 (MIT) para
  SVG→PNG con tiny-skia-path y la cadena skrifa/harfrust/read-fonts/
  font-types (Apache-2.0/MIT). En build requiere `FFMPEG_DIR`,
  `PKG_CONFIG_PATH` y `LIBCLANG_PATH`, provistos por
  `scripts/rust-env.mjs`. Vendorado y verificado en `vendor/concat`, pero
  **no enlazado en la app**: `ffmpeg-sys-the-third` y `ffmpeg-sys-next`
  (vía `video-rs`) comparten `links = "ffmpeg"` y no pueden coexistir en
  un binario; la integración queda pendiente de unificar el binding.
  **NO se vendoriza `concat-export`**: depende
  de `concat-vision` (modelos de recorte/estabilización vía ONNX
  Runtime `ort`) de forma no opcional; la orquestación documento→
  archivo sigue a cargo del pipeline propio de Olyvia.
  Mismas notas de licencia AGPL-3.0 que el resto de `vendor/concat/`.

## Agregados 2026-11-13 (concat-vision sin infer, para concat-worker)

- **concat-vision** 0.2.10 (AGPL-3.0-or-later, © Jareer Abdullah /
  Concat): vendorado en `vendor/concat/crates/concat-vision` **sin la
  feature `infer`** — compila sólo con `concat-core`, `concat-project`
  y `png` 0.17 (MIT OR Apache-2.0); `ort` (ONNX Runtime) queda como
  dependencia opcional declarada pero jamás habilitada ni compilada.
  Lo consume `apps/concat-worker` para `analyze_motion`
  (`stabilize::track`/`store`/`path`: tracking de cámara por flujo
  óptico Lucas-Kanade + RANSAC, aritmética pura, sin modelos).
  `models/selfie-segmentation.onnx` (MediaPipe Selfie Segmentation
  256×256, Apache License 2.0, © Google / ONNX Community — ver
  `vendor/concat/crates/concat-vision/models/NOTICE.md`) se copió por
  fidelidad al crate pero sólo lo referencia código tras `infer`, que
  está apagado. Los pesos descargables de `models.rs` (RVM-mobilenetv3
  **GPL-3.0**, ISNet, SlimSAM, Real-ESRGAN, Spleeter) NO se
  distribuyen ni se descargan: `infer` sigue deshabilitado.
  Mismas notas de licencia AGPL-3.0 que el resto de `vendor/concat/`.
