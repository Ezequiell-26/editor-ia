#!/usr/bin/env python3
"""Adaptador HTTP loopback para un motor real de lip-sync local.

La app Editor IA no incluye pesos de lip-sync: llama a este adaptador con
`POST /lipsync` y el contrato que ya usa el comando Rust:

    {"video_path": "...", "audio_path": "...", "output_format": "mp4"}

El adaptador ejecuta Wav2Lip sobre una copia temporal del video, con el audio
convertido a WAV 16 kHz mono, y devuelve el MP4 resultante en el cuerpo de la
respuesta. Todo queda en loopback y en la máquina local.

Uso:
    python scripts/lipsync-engine/server.py
    python scripts/lipsync-engine/server.py --port 8765

Variables de entorno:
    WAV2LIP_DIR       carpeta del repo Wav2Lip (por defecto, la instalación
                      usada durante la verificación)
    LIPSYNC_PYTHON    intérprete con las dependencias (por defecto, el venv
                      hermano `LipSyncEngine/venv`)
    LIPSYNC_CHECKPOINT checkpoint `.pth` (state_dict o TorchScript)
    LIPSYNC_MAX_SECONDS límite duro de duración de audio/video (45 s)
    LIPSYNC_MAX_DIM   lado mayor al que se reescala el video (1280 px)

Licencia: Wav2Lip se publica para uso personal, investigación y fines no
comerciales (fue entrenado con LRS2). Este adaptador no cambia esa licencia.
Para un producto comercial hace falta una licencia aparte del modelo o usar un
motor con licencia permisiva (por ejemplo MuseTalk, MIT, con otro coste de
instalación). El adaptador no descarga ni redistribuye pesos.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

MAX_BODY_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 190 * 1024 * 1024
MAX_SECONDS = float(os.environ.get("LIPSYNC_MAX_SECONDS", "45"))
EXPECTED_CHECKPOINT_SHA256 = os.environ.get(
    "LIPSYNC_CHECKPOINT_SHA256",
    "180cfd49d31d47f195d5bfc62830ffe2c40724b7bbbce6faadc73ac6ab1a3b8e",
)
MAX_DIM = int(os.environ.get("LIPSYNC_MAX_DIM", "1280"))

DEFAULT_ENGINE_ROOT = Path(
    os.environ.get(
        "WAV2LIP_DIR",
        r"D:\Users\ofici\IA_CENTRAL\04_APLICACIONES_IA\LipSyncEngine\Wav2Lip",
    )
)
DEFAULT_VENV = Path(
    os.environ.get(
        "LIPSYNC_PYTHON",
        str(DEFAULT_ENGINE_ROOT.parent / "venv" / "Scripts" / "python.exe"),
    )
)
DEFAULT_CHECKPOINT = Path(
    os.environ.get(
        "LIPSYNC_CHECKPOINT",
        str(DEFAULT_ENGINE_ROOT / "checkpoints" / "wav2lip_gan.pth"),
    )
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

JOB_LOCK = threading.Lock()
_CHECKPOINT_HASH: str | None = None
_CHECKPOINT_SIGNATURE: tuple[int, int] | None = None


def checkpoint_sha256() -> str:
    """Hash del checkpoint, cacheado por proceso.

    Cargar un TorchScript es ejecutar código; el adaptador sólo acepta el
    checkpoint cuyo SHA-256 coincide con el fijado (se puede cambiar con
    LIPSYNC_CHECKPOINT_SHA256 si el usuario confía en otro archivo).
    """
    global _CHECKPOINT_HASH, _CHECKPOINT_SIGNATURE
    stat = DEFAULT_CHECKPOINT.stat()
    signature = (stat.st_mtime_ns, stat.st_size)
    if _CHECKPOINT_HASH is None or _CHECKPOINT_SIGNATURE != signature:
        digest = hashlib.sha256()
        with DEFAULT_CHECKPOINT.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        _CHECKPOINT_HASH = digest.hexdigest()
        _CHECKPOINT_SIGNATURE = signature
    return _CHECKPOINT_HASH


def verify_checkpoint() -> None:
    actual = checkpoint_sha256()
    if actual != EXPECTED_CHECKPOINT_SHA256.lower():
        raise RuntimeError(
            "el SHA-256 del checkpoint no coincide; no se carga un modelo "
            f"no verificado (esperado {EXPECTED_CHECKPOINT_SHA256[:12]}…, "
            f"obtenido {actual[:12]}…). Volvé a instalar el checkpoint con el SHA "
            "documentado o definí LIPSYNC_CHECKPOINT_SHA256 si confiás en el archivo"
        )


def find_tool(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise RuntimeError(
            f"{name} no está en PATH; el adaptador necesita FFmpeg y FFprobe"
        )
    return found


def run(command: list[str], timeout: float, cwd: Path | None = None) -> None:
    result = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        tail = "\n".join(result.stdout.strip().splitlines()[-8:])
        raise RuntimeError(
            f"el motor falló (código {result.returncode}): {tail[:1200]}"
        )


def probe_seconds(ffprobe: str, path: Path, stream: str) -> float:
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            stream,
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=60,
        check=False,
    )
    try:
        return float(result.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return 0.0


def probe_dimensions(ffprobe: str, path: Path) -> tuple[int, int]:
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=60,
        check=False,
    )
    try:
        width, height = result.stdout.strip().splitlines()[0].split("x")[:2]
        return int(width), int(height)
    except (ValueError, IndexError):
        return 0, 0


def prepare_video(
    ffmpeg: str, source: Path, target: Path, ffprobe: str, seconds: float
) -> None:
    width, height = probe_dimensions(ffprobe, source)
    if width <= 0 or height <= 0:
        raise ValueError("el video no tiene dimensiones legibles")
    scale = min(1.0, MAX_DIM / max(width, height))
    target_width = max(2, int(round(width * scale / 2.0)) * 2)
    target_height = max(2, int(round(height * scale / 2.0)) * 2)
    run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-t",
            f"{seconds:.3f}",
            "-an",
            "-vf",
            f"scale={target_width}:{target_height}:flags=lanczos",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "25",
            str(target),
        ],
        timeout=300,
    )


def prepare_audio(ffmpeg: str, source: Path, target: Path) -> None:
    run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(target),
        ],
        timeout=300,
    )


def lipsync(job: Path, video: Path, audio: Path) -> Path:
    engine = DEFAULT_ENGINE_ROOT
    python = DEFAULT_VENV
    checkpoint = DEFAULT_CHECKPOINT
    if not engine.is_dir():
        raise RuntimeError(f"no se encontró Wav2Lip en {engine}")
    if not python.is_file():
        raise RuntimeError(f"no se encontró el intérprete del motor en {python}")
    if not checkpoint.is_file():
        raise RuntimeError(f"no se encontró el checkpoint en {checkpoint}")
    verify_checkpoint()
    ffmpeg = find_tool("ffmpeg")
    ffprobe = find_tool("ffprobe")

    video_seconds = probe_seconds(ffprobe, video, "v:0")
    audio_seconds = probe_seconds(ffprobe, audio, "a:0")
    if video_seconds <= 0 or audio_seconds <= 0:
        raise ValueError("el video o el audio no tienen una duración válida")
    if audio_seconds > MAX_SECONDS:
        raise ValueError(
            f"el audio supera el límite local de {MAX_SECONDS:.0f} s; "
            "el CPU no llegaría a tiempo. Acortalo antes de sincronizar"
        )

    prepared_video = job / "source.mp4"
    prepared_audio = job / "voice.wav"
    output = job / "result.mp4"
    # Wav2Lip detecta rostros en todos los frames del video antes de recortar
    # los mels; no tiene sentido procesar más segundos de video que de audio.
    prepare_video(
        ffmpeg, video, prepared_video, ffprobe, min(video_seconds, audio_seconds)
    )
    prepare_audio(ffmpeg, audio, prepared_audio)

    command = [
        str(python),
        str(engine / "inference.py"),
        "--checkpoint_path",
        str(checkpoint),
        "--face",
        str(prepared_video),
        "--audio",
        str(prepared_audio),
        "--outfile",
        str(output),
        "--pads",
        "0",
        "10",
        "0",
        "0",
        "--face_det_batch_size",
        "8",
        "--wav2lip_batch_size",
        "16",
    ]
    started = time.monotonic()
    run(command, timeout=900, cwd=engine)
    if not output.is_file() or output.stat().st_size < 1024:
        raise RuntimeError("el motor no produjo un MP4 utilizable")
    print(
        f"lip-sync ok: {audio_seconds:.2f}s de audio en "
        f"{time.monotonic() - started:.1f}s",
        flush=True,
    )
    return output


class Handler(BaseHTTPRequestHandler):
    server_version = "EditorIA-LipSync/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))
        sys.stdout.flush()

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - API de http.server
        if urlparse(self.path).path != "/health":
            self.send_json(404, {"error": "ruta desconocida"})
            return
        self.send_json(
            200,
            {
                "ok": True,
                "engine": "wav2lip",
                "checkpoint": DEFAULT_CHECKPOINT.name,
                "checkpoint_present": DEFAULT_CHECKPOINT.is_file(),
                "checkpoint_sha256": EXPECTED_CHECKPOINT_SHA256,
                "python_present": DEFAULT_VENV.is_file(),
                "max_seconds": MAX_SECONDS,
                "max_dimension": MAX_DIM,
                "license": "Wav2Lip: uso personal/investigación, no comercial",
            },
        )

    def do_POST(self) -> None:  # noqa: N802 - API de http.server
        if urlparse(self.path).path != "/lipsync":
            self.send_json(404, {"error": "ruta desconocida"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "cuerpo JSON vacío o demasiado grande"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            video = Path(str(payload["video_path"])).resolve()
            audio = Path(str(payload["audio_path"])).resolve()
            output_format = str(payload.get("output_format", "mp4")).lower()
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            self.send_json(
                400,
                {"error": "se esperaba JSON con video_path y audio_path"},
            )
            return
        if output_format not in {"mp4", "video/mp4"}:
            self.send_json(400, {"error": "solo se admite output_format=mp4"})
            return
        if not video.is_file() or not audio.is_file():
            self.send_json(400, {"error": "el video o el audio no existen"})
            return
        if not JOB_LOCK.acquire(blocking=False):
            self.send_json(
                429,
                {"error": "ya hay un lip-sync en curso; esperá a que termine"},
            )
            return
        job = Path(tempfile.mkdtemp(prefix=f"lipsync-{uuid.uuid4().hex[:8]}-"))
        try:
            result = lipsync(job, video, audio)
            size = result.stat().st_size
            if size > MAX_OUTPUT_BYTES:
                raise RuntimeError("el MP4 supera el límite de respuesta de 190 MB")
            data = result.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-LipSync-Engine", "wav2lip")
            self.end_headers()
            self.wfile.write(data)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "el motor tardó demasiado y se canceló"})
        except Exception as error:  # noqa: BLE001 - se informa al cliente
            message = str(error).replace("\n", " ")[:800]
            self.send_json(500, {"error": message})
        finally:
            JOB_LOCK.release()
            shutil.rmtree(job, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Adaptador local de lip-sync")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("LIPSYNC_PORT", "8765"))
    )
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        print("solo se permite loopback", file=sys.stderr)
        return 2
    for label, path in (
        ("Wav2Lip", DEFAULT_ENGINE_ROOT),
        ("python", DEFAULT_VENV),
        ("checkpoint", DEFAULT_CHECKPOINT),
    ):
        if not path.exists():
            print(f"falta {label}: {path}", file=sys.stderr)
            return 2
    try:
        verify_checkpoint()
    except Exception as error:
        print(f"no se inicia el motor: {error}", file=sys.stderr)
        return 2
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"motor de lip-sync Wav2Lip escuchando en http://{args.host}:{args.port}"
        f" (límite {MAX_SECONDS:.0f}s, {MAX_DIM}px)",
        flush=True,
    )
    print(
        "licencia: Wav2Lip es solo para uso personal/investigación, no comercial",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("apagado", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
