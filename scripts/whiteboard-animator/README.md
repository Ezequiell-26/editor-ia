# Motor whiteboard-animator (integración Olyvia)

Motor externo que convierte una imagen de estilo pizarra (tinta sobre fondo
blanco) en un video MP4 donde el contenido se dibuja trazo a trazo: texto
palabra por palabra, contornos, rellenos con pincel y line-art por strokes.

- Paquete: [`whiteboard-animator`](https://pypi.org/project/whiteboard-animator/) 0.1.1
- Repositorio de referencia: <https://github.com/masihsultani/whiteboard-animator>
- Licencia: **MIT** (© Masih Sultani). El modelo CRAFT ONNX incluido es un
  export de `craft_mlt_25k` de CRAFT-pytorch (MIT, © clovaai).
- Olyvia **no** embebe el motor ni el modelo (~200 MB de dependencias +
  ~83 MB de `craft.onnx`): se instala en un Python del equipo, igual que
  Faster-Whisper y Demucs.

## Instalación

Requiere Python 3.10+ y `ffmpeg`/`ffprobe` en el PATH (Olyvia ya resuelve
sus propias rutas de FFmpeg y las inyecta al proceso).

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell
python -m pip install -r scripts/whiteboard-animator/requirements.txt
```

O directamente:

```bash
python -m pip install whiteboard-animator
```

Dependencias que trae el paquete: `numpy`, `opencv-python-headless`,
`scikit-image`, `scipy`, `Pillow`, `onnxruntime`, `pydantic` + el modelo
CRAFT ONNX (~83 MB) como package-data. El extra `gemini` (planes de
regiones automáticos) **no** es necesario para Olyvia.

## Cómo lo encuentra Olyvia

El comando `whiteboard_generate` sondea, una vez por proceso:

1. `EDITORIA_WHITEBOARD_PYTHON` → ruta explícita a un `python.exe`.
2. `python` y `python3` del PATH.

Un candidato es válido sólo si `python -c "import whiteboard_animator.cli"`
sale con código 0. Si ninguno sirve, `whiteboard_status` devuelve
`available: false` con el motivo y el comando falla con
`ProviderUnavailable` + `INSTALL_HINT`. Tras instalar el motor hay que
reiniciar Olyvia (la sonda es `OnceLock` de proceso).

## Contrato IPC

- `whiteboard_status()` → `{ available, python?, reason? }`
- `whiteboard_generate({ imagePath, audioPath?, durationSeconds?, quality? })`
  → `{ videoPath, durationSeconds, width, height, fps, processingTimeMs }`

`imagePath` es una ruta absoluta a una imagen legible por PIL (PNG/JPEG
recomendados: el engine espera tinta sobre blanco). `audioPath` opcional
(narración: el dibujo se pacea a la voz). `durationSeconds` aplica sólo sin
audio (default 8, máx 60 min). `quality`: `low` | `medium` (default) |
`high`. Salida: `<cache>/whiteboard/<uuid>/whiteboard.mp4`.

Timeout del proceso: 2 h. Narración máxima por escena: 60 min (medida con
ffprobe cuando está disponible).

## Setup en esta máquina (2026-11-12)

El motor vive en `.tmp-wb-venv` (Python 3.11, instalado con `uv pip install -r
scripts/whiteboard-animator/requirements.txt` — ver pins numpy<2/opencv<5).
`EDITORIA_WHITEBOARD_PYTHON` apunta a `.tmp-wb-venv\Scripts\python.exe`
(configurada como variable de entorno de usuario). El Python 3.14 del sistema
NO sirve: no hay numpy 1.26 para cp314 y cv2 exige `numpy.core`.
