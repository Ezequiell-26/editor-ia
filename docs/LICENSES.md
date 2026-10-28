# Auditoría de licencias y dependencias del bundle

Actualizado: 2026-10-28. Evidencia medida sobre el árbol de trabajo, no una
declaración legal. Antes de vender la build comercial, un responsable legal
debe revisar los puntos marcados como **acción**.

## Inventario del instalador base

| Componente | Evidencia | Licencia | Acción |
|---|---|---|---|
| FFmpeg 9.0 shared (DLL + ffmpeg/ffprobe) | `resources/ffmpeg-dll/LICENSE.txt` (LGPL-3.0) | LGPL-3.0 | Conservar aviso y oferta de fuente; enlace dinámico |
| yt-dlp | binario en `resources/tools/yt-dlp.exe` | The Unlicense | Incluir el texto de Unlicense en avisos |
| ONNX Runtime | `resources/onnxruntime/onnxruntime.dll` | MIT | Incluir aviso MIT |
| Piper TTS | `resources/piper/THIRD-PARTY-NOTICES.txt` | MIT | Conservar aviso y licencia de la voz |
| Voz es_ES-davefx-medium | model card de piper-voices | CC0 según model card | Conservar atribución |
| eSpeak NG | `resources/piper/espeak-ng.dll` | **GPL-3.0** | **Acción:** cumplir GPLv3 (aviso + oferta de fuente) o reemplazar el runtime antes de vender |
| Wav2Lip | sólo `scripts/lipsync-engine`; no está en recursos | **No comercial** | **Acción:** no incluir en build comercial; el motor queda externo |
| Real-ESRGAN, u2netp, Seeta | se descargan en datos del usuario | revisar por modelo | **Acción:** auditar antes de redistribuir |
| WebView2 | componente del sistema | términos Microsoft | No redistribuir |

## Controles ejecutables

`npm run audit:licenses` recorre `tauri.conf.json` y `resources/`, y falla si
encuentra Wav2Lip, checkpoints o archivos `.pth` en el paquete base. También
exige que exista `THIRD-PARTY-NOTICES.txt`.

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
