# 01 — Arquitectura de AlaukCut

## Stack

```
┌─────────────────────────────────────────────────────────────┐
│ AlaukCut.exe (launcher)                                     │
│  ├─ PyWebView → WebView2 → frontend/ (HTML+JS vanilla)      │
│  ├─ CPython 3.11.9 embebido → backend/*.pyc                │
│  │    ├─ clase Api: ~257 métodos RPC (window.pywebview.api)│
│  │    ├─ servidor.pyc: HTTP 127.0.0.1 + token + WS          │
│  │    └─ subprocess: ferramentas/ (ffmpeg, whisper, rife…) │
│  └─ motorcpp.cp311-win_amd64.pyd (~900 KB, ~118 exports)   │
│       render GPU, captura, webcam, chroma, codificación    │
└─────────────────────────────────────────────────────────────┘
```

## Las tres vías de comunicación

1. **pywebview RPC** (`window.pywebview.api.<metodo>`): JS llama métodos
   de la clase `Api` en `main.pyc`. ~257 métodos — es la API principal
   (proyectos, grabación, exportación, IA, licencia, updates).
2. **HTTP local** (`servidor.pyc`, `http.server` en 127.0.0.1): rutas
   `/midia`, `/upload`, `/nativo/*`, `/export/quadro`, `/montagem/pedaco`,
   `/prerender/pedaco`, `/reserva_video`, `/assets/`. Token de sesión en
   query string. Pensado para payloads grandes (binarios, texturas).
3. **WebSocket** `/nativo/ws`: canal persistente para el preview nativo
   (el front manda descripciones de capas JSON + píxeles crudos y recibe
   cuadros renderizados).

## Decisiones de diseño relevantes para Olyvia

- **Preview híbrido**: WebGL2 en `motor.js` (6.1k líneas, GLSL) como
  preview principal; el motor nativo C++ reimplementa la MISMA matemática
  en HLSL (`camada.hlsl` documenta la paridad píxel-a-píxel y las trampas
  GLSL→HLSL: `mod`≠`fmod`, `fract`→`frac`, `atan(y,x)`→`atan2`, `mix`→`lerp`,
  matrices row-major). Ver `04-motor-nativo.md` y `07-efectos-transiciones.md`.
- **Texturas cacheadas por hash**: el front sube píxeles crudos una vez;
  el backend guarda texturas por hash de contenido (`nativo_tenho`,
  `nativo_geracao_texturas`) y el render pide por identidad.
- **Encoder con autodiagnóstico**: `motor_nativo.pyc` detecta GPU por
  registro de Windows, prueba NVENC/MediaFoundation/QSV con renders de
  prueba y marca "placa caída" para no reintentar en cada export.
- **FFmpeg recortado**: build propio N-125881 con nvenc, h264_mf, svtav1,
  d3d11va; tres binarios renombrados para salidas específicas
  (gif.exe, mpeg.exe, prores.exe).
- **Modelos IA locales**: whisper.cpp (246 MB) para subtítulos/diarización;
  RIFE-ncnn-vulkan para interpolación; YuNet (rostros) + MediaPipe
  (segmentación de persona) en ONNX.
- **Una sola ventana**: `uma_janela.pyc` fuerza single-instance;
  `webview` con pywebview sobre WebView2.

## Diferencia estructural con Olyvia

| AlaukCut | Olyvia |
|---|---|
| JS vanilla + pywebview RPC | React+TS + Tauri commands |
| Python embebido orquesta todo | Rust orquesta; Python sólo puentes puntuales |
| Motor C++ propio (.pyd) para render | video-rs/filmcraft + FFmpeg filtergraphs |
| Preview WebGL propio + preview nativo por texturas | Preview React/WebGL + render FFmpeg |
| 252 RPC methods monolíticos | Comandos Tauri por dominio |
