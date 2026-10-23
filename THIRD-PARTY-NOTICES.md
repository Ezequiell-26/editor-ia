# Avisos de terceros — Editor IA

Editor IA se distribuye bajo licencia MIT **sólo para su código propio**. Este
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

## Dependencias Rust directas

| Componente | Licencia | Uso |
| --- | --- | --- |
| `tauri` | Apache-2.0 OR MIT | Shell de escritorio |
| `tauri-plugin-dialog` | Apache-2.0 OR MIT | Diálogos nativos |
| `tauri-plugin-opener` | Apache-2.0 OR MIT | Abrir rutas y enlaces |
| `serde` / `serde_json` | MIT OR Apache-2.0 | Serialización |
| `sha2` | MIT OR Apache-2.0 | SHA-256 de medios y artefactos |
| `base64` | MIT OR Apache-2.0 | Transporte del ZIP por IPC |
| `reqwest` | MIT OR Apache-2.0 | Llamadas HTTP a proveedores |
| `keyring` | MIT OR Apache-2.0 | Administrador de credenciales de Windows |
| `uuid` | Apache-2.0 OR MIT | Identificadores |

## Herramientas externas (no se distribuyen dentro del binario)

| Herramienta | Licencia | Uso |
| --- | --- | --- |
| FFmpeg / FFprobe | LGPL-2.1-or-later o GPL según la compilación elegida | Render, medición y conversión; se invocan como proceso separado |
| yt-dlp | Unlicense | Descarga de contenido público |
| Faster-Whisper | MIT | Transcripción local |
| Windows SAPI | Componente del sistema operativo | Voz local por PowerShell |

Editor IA no enlaza FFmpeg: lo ejecuta como proceso externo y el usuario elige
qué compilación instalar. Si redistribuís una compilación GPL de FFmpeg junto con
la app, las obligaciones de esa licencia recaen sobre esa distribución.

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

- **Adaptador `scripts/lipsync-engine/server.py`**: código propio de Editor IA
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
- **FFmpeg 9.0 shared LGPL** (LGPL-2.1-or-later): DLLs `avcodec-63`,
  `avdevice-63`, `avfilter-12`, `avformat-63`, `avutil-61`, `swscale-10` y
  `swresample-7` del build `win64-lgpl-shared-9.0` de BtbN. Se distribuyen sin
  modificar junto al ejecutable; el aviso de licencia queda como
  `FFMPEG-LICENSE.txt`. Código fuente: https://github.com/FFmpeg/FFmpeg
  (tag `n9.0`). El `ffmpeg.exe`/`ffprobe.exe` estático que usa el render sigue
  siendo un proceso separado y conserva su propia licencia GPL.
- **ndarray** 0.17.2 (MIT OR Apache-2.0), dependencia opcional de video-rs.
