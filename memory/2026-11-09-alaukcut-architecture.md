# AlaukCut — mapa de arquitectura (2026-11-09)

Análisis estático de `C:\Users\ofici\AppData\Local\Programs\AlaukCut`. Solo lectura; no se ejecutó la app.

## Stack
- **Shell**: PyWebView (WebView2/Edge) + CPython 3.11.9 embebido (`python/`). Entry: `python/AlaukCut.exe` → `backend/main.pyc` → `Api` (js_api) + servidor HTTP local.
- **Frontend**: vanilla JS sin framework ni bundler — 105 archivos `frontend/js/*.js` (~68k líneas), HTML estático (`index.html` home, `editor.html` 190 KB), CSS propio. WebGL2 para preview (`js/motor.js`, 6.1k líneas, porta GLSL→HLSL).
- **Backend**: 57 módulos `.pyc` (Python 3.11, sin fuentes .py). `Api` expone **252 métodos RPC** a `window.pywebview.api`. `servidor.pyc` = HTTP en 127.0.0.1 con token (`/midia`, `/upload`, `/nativo/*`, `/export/quadro`, `/montaje/pedaco`, `/prerender/pedaco`).
- **Motor nativo**: `backend/motorcpp.cp311-win_amd64.pyd` (~900 KB, x86-64, 1.888 funciones según Ghidra). Importable desde el python embebido: ~100 exports (`codificar_lote`, `previa_*`, `webcam_*`, `captura_*`, `som_pc_*`, `audio_entradas` WASAPI, `transicoes_suportadas`, etc.). `motor_nativo.pyc` lo envuelve: texturas, shaders HLSL (`backend/shaders/*.hlsl`, 2.841 líneas), gestión de placa/codificador con fallback a software (WARP/MediaFoundation), ffmpeg por subprocess.
- **Herramientas bundled** (`ferramentas/`): ffmpeg custom (nvenc, mf, svtav1, d3d11va), ffmpeg_gif/mpeg/prores (binarios renombrados), whisper.cpp (modelo 246 MB), RIFE-ncnn-vulkan (interpolación), YuNet ONNX (rostros), MediaPipe ONNX (segmentación persona).

## Flujo de datos clave
1. RPC: JS → `pywebview.api.*` → `Api` en main.pyc (proyectos, grabación, export, IA, licencia, agente).
2. Preview nativo: JS sube texturas crudas por HTTP `POST /nativo/textura` y pide cuadros por `POST /nativo/previa` o WS `/nativo/ws`; el motor C++ compone con HLSL y devuelve píxeles. Cache de texturas por hash con generación.
3. Export: ffmpeg.exe subprocess con flags filtrados (demuxers/muxers/encoders recortados); presets ProRes/GIF/MPEG.

## Rasgos de diseño
- Comentarios en pt-BR documentan decisiones y "pedido do Alan" — proyecto de un dev, iterativo.
- Shader camada.hlsl es port verificado pixel-a-pixel del GLSL de motor.js (F2 comparator).
- Licencia propia (`licenca.pyc`), updater (`atualizacao.pyc`), agente IA opcional (`agente*.pyc`, Claude/Codex connectors), diagnóstico/telemetría de soporte.
- Features: timeline multi-track, keyframes, tracking (YuNet+RIFE), person segmentation, chroma key, fondo removal, subtítulos whisper, hyperframes (HTML→video), grabación pantalla/webcam, PC audio loopback.

## Evidencia
- pycmap.py/pycdetail.py/pycmotor.py/pycmain.py en `.tmp-ref/alauk/` (marshal+dis sobre .pyc, sin ejecutar la app).
- Ghidra previo (hoy): motorcpp.pyd = PE x86-64, 8 segmentos, 1.888 proc, 1.710 strings — ev_ba06cc5cb2f4a4b310dc975f16a3e2cea8ded48c6144ed62188111cb764126a4.
