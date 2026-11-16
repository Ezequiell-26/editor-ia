# 01 — Arquitectura de CapCut 9.4

## Stack real (verificado en instalación)

```
CapCut.exe (Qt6 app)
 ├─ Qt6 Quick/QML — UI nativa (167 DLLs Qt en raíz)
 ├─ CEF (CefCreator.dll + cef/) — webviews para panels/h5
 ├─ VECreator.dll (262 MB) — pipeline de creación/render
 ├─ cccreator.dll (158 MB) — creator cloud/media?
 ├─ videoeditor.dll (70 MB) — motor de edición (timeline, clips, FX)
 ├─ lens.dll (88 MB) — sistema de lentes/efectos
 ├─ EffectPlatform.dll + audioeffect.dll — plataforma de efectos
 ├─ DeepAgentsService.dll — agente IA
 ├─ PlatinumWebView.dll, FusionUI.dll — UI webview/fusion
 └─ ffmpeg.exe propio + codecs (ByteVC1_dec.dll)
```

## DLLs nativas >500 KB (inventario completo, 71 archivos — evidencia 2026-11-09)

CapCut **no inventa el decode/encode**: shippea FFmpeg completo + libs
especializadas. Esto cambia la lectura de "motor propio": el pipeline es
FFmpeg/custom engines sobre un stack de terceros enorme.

### Media / codecs

| DLL | Qué es |
|---|---|
| `avcodec-61`, `avformat-61`, `avfilter-10`, `avutil-59`, `swscale-8` | **FFmpeg 7.x completo** (decodifica, muxea, filtra, escala) |
| `ByteVC1_dec.dll` | Decoder propietario ByteDance VC-1 |
| `dav1d.dll` | AV1 software decode (BSD) |
| `ttheif_dec.dll`, `jxl.dll`, `libraw.dll` | HEIF, JPEG XL, RAW foto |
| `SvtAv1Enc.dll` | Encoder SVT-AV1 (Intel, BSD) |
| `libmp3lame-0.dll` | MP3 audio encode (LAME) |
| `nvjpeg64_12.dll` | JPEG encode NVIDIA |

### CV / IA on-device

| DLL | Qué es |
|---|---|
| `openvino.dll` + `openvino_intel_npu_plugin.dll` | **Intel OpenVINO con plugin NPU** — inferencia en NPU Intel |
| `Tracking.dll` | Tracking de objetos (el de keyframes/auto-reframe) |
| `lens.dll` (88 MB) | Sistema de lentes/efectos AR |
| `metasecml.dll` | ML de seguridad ByteDance |
| `fastcv.dll` | FastCV (visión optimizada) |
| `audioeffect.dll` (14 MB) | DSP de audio/efectos de voz |
| `speechsdk.dll` | Speech SDK (ASR/TTS) |

### ByteDance infra

| DLL | Qué es |
|---|---|
| `lynx.dll` (24 MB) | **Lynx** — framework UI cross-platform de ByteDance (alternativa a QML para paneles) |
| `sscronet.dll` + `boringssl.dll` | Cronet/QUIC + TLS (stack de red propio) |
| `tt_c2pa_sdk.dll` | **C2PA** — content credentials/provenance |
| `metasecml`, `ever_cloud_sdk`, `pc_push`, `uploader`, `lyra_cli_client`, `clipflow_sdk`, `bd_mojo` | SDKs cloud/push/upload internos |
| `jazz.dll`, `nuro.dll`, `parfait.dll`, `bytebench*.dll`, `res_pool.dll` | Motores internos (jazz/nuro/parfait sin identificar; bytebench = benchmarks) |

### UI / plataforma

| DLL | Qué es |
|---|---|
| `CefCreator.dll`, `PlatinumWebView.dll`, `FusionUI.dll`, `EffectPlatform.dll` | CEF/webviews + plataforma de efectos |
| `PocoFoundation.dll`, `lcms2.dll`, `brotlienc.dll`, `libiconv.dll` | Poco C++ libs, color management (lcms2), brotli, iconv |
| `opengl32sw.dll`, `d3dcompiler_47.dll` | OpenGL software + compiler HLSL/D3D |
| `Qt6*.dll` (10 módulos) | Qt6 Quick/QML/Widgets base |

### Lectura para Olyvia

- CapCut delega **todo el codec** en FFmpeg + libs estándar del
  ecosistema (dav1d, SVT-AV1, LAME, libheif implícito en ttheif). El
  "motor" propio (`videoeditor`/`VECreator`/`lens`) está **encima**:
  timeline, composición GPU, effects, AI.
- Doble UI: Qt6 QML **y** Lynx + CEF webviews para paneles — las features
  nuevas (AI, templates) entran como webviews H5, no como QML nativo.
- `gpu_driver_bug_list.json` + `bench` en Resources = mantienen
  workarounds por GPU y benchmarks internos (mismo patrón que
  `placa_escolhida.txt` de AlaukCut).
- C2PA: los exports pueden llevar **content credentials** — feature de
  provenance que Olyvia podría adoptar (estándar abierto, no copiar).

## Helpers/procesos

- `VEHelper.exe`, `VEDetector.exe`, `VEConfig.dll` — helper del editor.
- `ttdaemon.exe` — daemon TikTok-related (analytics/servicios).
- `parfait_crash_handler.exe`, `VECrashHandler.exe`, `minidump_stackwalk.exe`
  — crash reporting.
- `hpatchz.exe` — auto-update (HDiffPatch).
- `taskcontainer.exe`, `push_detect.exe` — utilidades.

## Resources/ — mapa de features (68 carpetas)

| Recurso | Feature |
|---|---|
| `Chroma`, `Chroma2`, `matting_config`, `mattingBlend`, `mattingBlendV2` | Chromakey + matting (separación fondo) multi-versión |
| `Curves`, `PrimaryWheel`, `LogWheel`, `MixMode` | Color grading: curvas, wheels primarios/log, blend modes |
| `DefaultAdjustBundle/` | 39 bundles de ajuste (ver abajo) |
| `lut`, `lut-basemap.png`, `lut-filter.webp`, `lut-import.webp` | LUTs + UI de import |
| `rnnoise` | Supresión de ruido (RNNoise — BSD) |
| `lvop_intelligent_crop` | Auto-reframe/crop inteligente (con `index.html` propio = webview) |
| `SceneEditDetection` | Detección de escena/cortes |
| `objectRect` | Tracking/detección de objetos (rectángulos) |
| `audio_metrics` | Análisis de audio (BPM, loudness?) |
| `audiosami` | Separación de audio (demucs-like?) |
| `tts` | Text-to-speech |
| `digital_human` | Humano digital / avatar |
| `figure` | Figuras/ajustes corporales? |
| `skinunified`, `facebeautifymodel`… (en models/) | Belleza facial |
| `aigc_text_template`, `image_h5_*` | Plantillas AIGC texto/imagen/sticker/text-effect vía webview H5 |
| `builtin_skills/` | Skills del agente (ver abajo) |
| `importer` | Importadores de proyecto (CapCut↔otros?) |
| `video_template_ratio.json` | Ratios de templates |
| `watermark`, `VideoWaterMark` | Watermarks |
| `guide`, `areaLocked` | Guías/áreas bloqueadas |
| `article_video`, `template_sticker` | Artículos→video, stickers de template |
| `Qinyan`, `agicbach`, `lumi_js_resources*` | Motores JS propios (lumi = su webview framework?) |
| `deeplink_local_*_res.mp4` | Recursos de deeplinks locales |
| `gpu_driver_bug_list.json` | Workarounds por GPU/driver |
| `bench` | Benchmarks internos |
| `oobe` | Onboarding |
| `po` | Traducciones |

## DefaultAdjustBundle (39 ajustes de color)

Nombres: `black_white`, `brightness`, `brightness_v1`, `brightness_v2`,
`clear`, `color_match_select_target`, `combine_adjust`, `contrast`
(+v1,v2,v3), `fade`, `highlight`(+v1), `hsl`(+v1), `light_sensation`,
`merge_all_adjust_color`, `particle`(+v1,v2), `saturation`(+v1),
`shadow`(+v1), `shadow_highlight_v2_gles2`, `shadow_highlight_v2_gles3`,
`shadow_highlight_v3_gles3`, `shadow_v1`, `sharpen`(+v1),
`temperature`, `temperature_tone_v2`, `temperature_tone_v3`, `tone`(+v1),
`vignetting`(+v1), `FC`, `yunfu_npu`.

Cada bundle tiene `Feature.js` + `js/*.js` (bach.js, quhui.js,
MainSystem.js…) — **ajustes de color implementados en JS/GPU con
versionado por iteración y variantes GLES2/GLES3/NPU** (yunfu = su NPU
propia). Versionado `_v1/_v2/_v3` = iteraciones del mismo ajuste.

## builtin_skills (agente IA)

`jianying.agent.highlight`, `jianying.agent.material_understanding`,
`jianying.agent.script`, `jianying.agent.speaker`,
`jingying.agent.align_bgm_with_video`, `jingying.agent.lvc`.
→ El agente de CapCut tiene skills especializadas: resaltar momentos,
entender material, guiones, hablantes, alinear música con video, LVC.

## Diferencia estructural con Olyvia

| CapCut | Olyvia |
|---|---|
| Qt6 QML + CEF + DLLs nativos gigantes | Tauri + React + Rust |
| videoeditor.dll caja negra de 70 MB | video-rs + filmcraft + FFmpeg |
| Effects en JS bundles + GPU shaders | effect-kit + FFmpeg filters |
| Modelos IA 220 MB on-device | ONNX Runtime en crates propios |
| Agente con skills modulares | MCP + comandos IA existentes |
