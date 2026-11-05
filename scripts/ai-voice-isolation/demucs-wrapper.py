#!/usr/bin/env python3
"""
Wrapper para Demucs - Aislamiento de voz y separación de stems.

Modelo: Demucs v4 (Facebook AI Research, MIT License)

Este script provee una API CLI simple para extraer stems de un archivo de
audio o video. La entrada se decodifica a PCM float32 estéreo a 44.1 kHz con
FFmpeg (cualquier contenedor: mp4, m4a, mp3, wav...) antes de la inferencia.

Uso desde Editor IA:
    python demucs-wrapper.py --input <media.mp4> --output-dir <dir> [options]

Salida generada (modo isolate):
    - vocals.wav (solo voz humana, sin música ni efectos)
    - accompaniment.wav (resto: música + efectos + ruido)

Requisitos:
    pip install torch torchaudio demucs soundfile numpy scipy
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from demucs.api import Separator

TARGET_SAMPLE_RATE = 44100


def _decode_with_ffmpeg(input_path: Path, ffmpeg: str) -> "np.ndarray":
    """Decodifica cualquier contenedor a float32 estéreo 44.1 kHz.

    Devuelve un array (samples, channels). FFmpeg escribe s16 por defecto;
    pedimos f32le para evitar una conversión extra.
    """
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ac",
        "2",
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-",
    ]
    result = subprocess.run(command, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg no pudo decodificar el audio: {result.stderr.decode('utf-8', 'replace')[:500]}"
        )
    audio = np.frombuffer(result.stdout, dtype=np.float32)
    if audio.size == 0:
        raise RuntimeError("ffmpeg devolvió audio vacío")
    return audio.reshape(-1, 2)


def _decode_with_soundfile(input_path: Path) -> "tuple[np.ndarray, int]":
    audio, sample_rate = sf.read(str(input_path), dtype="float32", always_2d=True)
    return audio, sample_rate


def _resample_stereo(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Remuestrea (samples, channels) a TARGET_SAMPLE_RATE con polyphase FIR."""
    if sample_rate == TARGET_SAMPLE_RATE:
        return audio
    from math import gcd

    from scipy.signal import resample_poly

    divisor = gcd(int(sample_rate), TARGET_SAMPLE_RATE)
    up = TARGET_SAMPLE_RATE // divisor
    down = int(sample_rate) // divisor
    return np.stack(
        [resample_poly(audio[:, channel], up, down) for channel in range(audio.shape[1])],
        axis=1,
    ).astype(np.float32)


class VoiceIsolationEngine:
    """Motor de aislamiento de voz usando Demucs v4."""

    # `shifts` es el ensamble de inferencia de Demucs: más shifts = mejor
    # calidad y más tiempo. Mapea los niveles de calidad del editor.
    QUALITY_SHIFTS = {"low": 1, "medium": 2, "high": 4, "best": 8}

    def __init__(
        self,
        model_name: str = "htdemucs",
        device: str = "auto",
        quality: str = "medium",
        ffmpeg: str = "ffmpeg",
    ):
        self.model_name = model_name
        self.ffmpeg = ffmpeg
        resolved = device if device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
        shifts = self.QUALITY_SHIFTS.get(quality, 2)

        print(
            f"[INFO] Loading model '{model_name}' on {resolved} (shifts={shifts})...",
            file=sys.stderr,
        )
        try:
            self.separator = Separator(model=model_name, device=resolved, shifts=shifts)
            print("[OK] Model loaded successfully.", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] Failed to load model: {e}", file=sys.stderr)
            raise

    def _load_audio(self, input_path: Path) -> "tuple[np.ndarray, int]":
        """Devuelve (samples, channels) float32 estéreo a 44.1 kHz."""
        try:
            audio, sample_rate = _decode_with_ffmpeg(input_path, self.ffmpeg)
            return audio, TARGET_SAMPLE_RATE
        except Exception as ffmpeg_error:
            try:
                audio, sample_rate = _decode_with_soundfile(input_path)
            except Exception:
                raise RuntimeError(
                    f"no se pudo decodificar el audio ni con ffmpeg ni con soundfile: {ffmpeg_error}"
                )
        audio = _resample_stereo(audio, sample_rate)
        return audio, TARGET_SAMPLE_RATE

    def _separate(self, input_path: Path) -> "tuple[dict[str, np.ndarray], float]":
        """Corre la separación y devuelve stems float32 (samples, channels)."""
        import time

        start = time.perf_counter()
        audio, sample_rate = self._load_audio(input_path)
        duration_seconds = len(audio) / sample_rate

        # Demucs espera (channels, samples); separamos en mono para ahorrar
        # memoria y duplicamos a estéreo al guardar.
        mono = audio.mean(axis=1).astype(np.float32)
        waveform = torch.from_numpy(mono).unsqueeze(0)

        print(
            f"[INFO] Separating {duration_seconds:.2f}s of audio on device...",
            file=sys.stderr,
        )
        sources = self.separator.separate(waveform)
        elapsed = time.perf_counter() - start

        stems: dict[str, np.ndarray] = {}
        for name, tensor in sources.items():
            array = tensor.detach().float().cpu().numpy()
            if array.ndim == 1:
                array = array.reshape(1, -1)
            # (channels, samples) -> (samples,) mono
            stems[name] = array.mean(axis=0).astype(np.float32)
        return stems, duration_seconds

    def isolate_vocals(
        self,
        input_path: Path,
        output_dir: Path,
        quality: str = "medium",
    ) -> dict:
        """Aísla la voz humana y guarda vocals.wav + accompaniment.wav."""
        import time

        start_time = time.perf_counter()
        output_dir.mkdir(parents=True, exist_ok=True)

        stems, duration_seconds = self._separate(input_path)

        vocals = stems.get("vocals")
        if vocals is None:
            raise RuntimeError(
                f"el modelo '{self.model_name}' no produjo stem 'vocals' (stems: {sorted(stems)})"
            )
        accompaniment = np.zeros_like(vocals)
        for name, stem_audio in stems.items():
            if name != "vocals":
                accompaniment += stem_audio

        vocals_stereo = np.stack([vocals, vocals], axis=1)
        accompaniment_stereo = np.stack([accompaniment, accompaniment], axis=1)

        vocals_path = output_dir / "vocals.wav"
        accompaniment_path = output_dir / "accompaniment.wav"

        print(f"[INFO] Saving vocals to {vocals_path}", file=sys.stderr)
        sf.write(str(vocals_path), vocals_stereo, TARGET_SAMPLE_RATE)
        print(f"[INFO] Saving accompaniment to {accompaniment_path}", file=sys.stderr)
        sf.write(str(accompaniment_path), accompaniment_stereo, TARGET_SAMPLE_RATE)

        return {
            "input_path": str(input_path.absolute()),
            "output_files": {
                "vocals": str(vocals_path.absolute()),
                "accompaniment": str(accompaniment_path.absolute()),
            },
            "duration_seconds": float(duration_seconds),
            "sample_rate": TARGET_SAMPLE_RATE,
            "channels": 2,
            "model_used": self.model_name,
            "quality": quality,
            "processing_time_ms": int((time.perf_counter() - start_time) * 1000),
        }

    def separate_stems(self, input_path: Path, output_dir: Path) -> dict:
        """Separa el audio en stems individuales (vocals, drums, bass, other)."""
        import time

        start_time = time.perf_counter()
        output_dir.mkdir(parents=True, exist_ok=True)

        stems, duration_seconds = self._separate(input_path)

        output_files = {}
        for name, stem_audio in stems.items():
            safe_name = "".join(c for c in name if c.isalnum() or c in "-_") or "stem"
            stem_path = output_dir / f"{safe_name}.wav"
            stereo = np.stack([stem_audio, stem_audio], axis=1)
            sf.write(str(stem_path), stereo, TARGET_SAMPLE_RATE)
            output_files[name] = str(stem_path.absolute())

        return {
            "input_path": str(input_path.absolute()),
            "output_files": output_files,
            "duration_seconds": float(duration_seconds),
            "sample_rate": TARGET_SAMPLE_RATE,
            "model_used": self.model_name,
            "processing_time_ms": int((time.perf_counter() - start_time) * 1000),
        }


def main():
    parser = argparse.ArgumentParser(description="Voice isolation using Demucs v4")
    parser.add_argument("--input", required=True, help="Input audio/video file")
    parser.add_argument("--output-dir", required=True, help="Output directory for results")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="Path to ffmpeg executable")
    parser.add_argument(
        "--mode",
        choices=["isolate", "separate"],
        default="isolate",
        help="Mode: 'isolate' extracts only vocals, 'separate' outputs all stems",
    )
    parser.add_argument(
        "--model",
        default="htdemucs",
        help="Model name (default: htdemucs)",
    )
    parser.add_argument(
        "--quality",
        choices=["low", "medium", "high", "best"],
        default="medium",
        help="Processing quality vs speed tradeoff",
    )
    parser.add_argument(
        "--device",
        choices=["cpu", "cuda", "auto"],
        default="auto",
        help="Device for inference",
    )
    parser.add_argument(
        "--stdout-json",
        action="store_true",
        help="Print JSON result to stdout",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)

    if not input_path.exists():
        print(json.dumps({"error": f"Input file not found: {input_path}"}))
        sys.exit(1)

    try:
        engine = VoiceIsolationEngine(
            model_name=args.model,
            device=args.device,
            quality=args.quality,
            ffmpeg=args.ffmpeg,
        )

        if args.mode == "isolate":
            result = engine.isolate_vocals(
                input_path=input_path,
                output_dir=output_dir,
                quality=args.quality,
            )
        else:
            result = engine.separate_stems(
                input_path=input_path,
                output_dir=output_dir,
            )

        if args.stdout_json:
            print(json.dumps(result))
        else:
            print(json.dumps(result, indent=2))

    except Exception as e:
        error_result = {"error": str(e)}
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
