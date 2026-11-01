# Auditoría de licencias y dependencias del bundle

Actualizado: 2026-10-30. Evidencia medida sobre el árbol de trabajo, no una
declaración legal. Antes de vender la build comercial, un responsable legal
debe revisar los puntos marcados como **acción**.

## Inventario del instalador base

| Componente | Evidencia | Licencia | Acción |
|---|---|---|---|
| FFmpeg 9.0 shared (DLL + ffmpeg/ffprobe) | `resources/ffmpeg/LICENSE.txt` y `resources/ffmpeg-dll/LICENSE.txt` (LGPL-3.0) | LGPL-3.0 | Conservar aviso y oferta de fuente; enlace dinámico |
| libopenh264 (encoder H.264 de software) | integrado en `avcodec-63.dll`; `-encoders` lista libopenh264 | BSD-2-Clause | Conservar aviso y fuente upstream |
| libkvazaar (encoder H.265 de software) | integrado en `avcodec-63.dll`; `-encoders` lista libkvazaar | LGPL-2.1 | Conservar aviso y oferta de fuente |
| yt-dlp | binario en `resources/tools/yt-dlp.exe` | The Unlicense | Incluir el texto de Unlicense en avisos |
| ONNX Runtime | `resources/onnxruntime/onnxruntime.dll` | MIT | Incluir aviso MIT |
| Piper TTS | `resources/piper/THIRD-PARTY-NOTICES.txt` | MIT | Conservar aviso y licencia de la voz |
| Voz es_ES-davefx-medium | model card de piper-voices | CC0 según model card | Conservar atribución |
| eSpeak NG | `resources/piper/espeak-ng.dll` | **GPL-3.0** | **Acción:** cumplir GPLv3 (aviso + oferta de fuente) o reemplazar el runtime antes de vender |
| Wav2Lip | sólo `scripts/lipsync-engine`; no está en recursos | **No comercial** | **Acción:** no incluir en build comercial; el motor queda externo |
| Real-ESRGAN, u2netp, Seeta | se descargan en datos del usuario | revisar por modelo | **Acción:** auditar antes de redistribuir |
| WebView2 | componente del sistema | términos Microsoft | No redistribuir |
| Overlays propios (5 videos + posters) | `resources/overlays/catalog.json`; `scripts/generate-overlays.mjs` | **CC0-1.0** (contenido propio) | Conservar catálogo y atribución |

## Controles ejecutables

`npm run audit:licenses` recorre `tauri.conf.json` y `resources/`, y falla si
encuentra Wav2Lip, checkpoints o archivos `.pth` en el paquete base. También
exige que exista `THIRD-PARTY-NOTICES.txt`.

`npm run audit:ffmpeg` ejecuta el FFmpeg empaquetado y falla si `-buildconf`
incluye `--enable-gpl`/`--enable-nonfree`, si `-encoders` lista libx264,
libx265 o libxvid, si falta libopenh264/libkvazaar o si `LICENSE.txt` no es
LGPL. Si todavía no hay binarios (clone limpio), informa y no bloquea;
`npm run ffmpeg:sync` los copia desde una build LGPL shared local y
`scripts/ci-bundle-resources.sh` descarga la de BtbN en CI. El filtro GPL
`eq` ya no se usa: brillo, contraste, saturación y gamma se resuelven con
`colorbalance`, `colorlevels`, `hue` y `curves`.

La UI incluye Three.js 0.180.0 y mp4-muxer 5.2.1 (MIT) para escenas 3D
on-demand y el horneado VP9; el render del timeline no los usa. El texto 3D
extruido usa la fuente MgOpen Helvetiker incluida en `three/examples/fonts`;
su licencia permite redistribuirla dentro de un paquete mayor conservando el
aviso completo en
[`apps/desktop/src/features/three/fonts/LICENSE-mgopen.txt`](../apps/desktop/src/features/three/fonts/LICENSE-mgopen.txt).

Los ports JS de fórmulas de filtros de FFmpeg (`colorbalance`, `colorlevels`,
`hue`, `curves`, `vignette`, `huesaturation` en `hsl-matrix.ts`) son
reimplementaciones propias de fórmulas publicadas en el código fuente de
FFmpeg (LGPL-2.1-or-later); cada archivo conserva la atribución y no se
distribuye código de FFmpeg fuera de las DLL.

El archivo [THIRD-PARTY-NOTICES.txt](../apps/desktop/src-tauri/resources/THIRD-PARTY-NOTICES.txt)
se incluye en el instalador mediante `bundle.resources`.

## Estado

- Wav2Lip/checkpoints: **fuera** del bundle base (verificado).
- FFmpeg LGPL: aviso presente y DLLs enlazadas dinámicamente.
- eSpeak NG GPL-3.0: aviso agregado; **la obligación de fuente sigue abierta**
  para la venta. Es un blocker legal de Fase 4, no técnico de Beta.
- Modelos descargados aparte: no están en el instalador; revisar antes de
  empaquetarlos.

## Verificación

```
npm run audit:licenses
# BUNDLE LICENCIAS: OK
# Wav2Lip/checkpoints: fuera del bundle base
```
