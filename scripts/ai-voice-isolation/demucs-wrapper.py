#!/usr/bin/env python3
"""
Wrapper para Demucs - Aislamiento de voz y separación de stems.

Modelo: Demucs v4 (Facebook AI Research, MIT License)
URL: https://github.com/facebookresearch/segment-anything
Ref: https://huggingface.co/facebook/htdemufs

Este script provee una API CLI simple para extraer stem de voces humanas
de grabaciones complejas (música de fondo, ruido ambiental, etc.).

Uso desde Editor IA:
    python demucs-wrapper.py --input <audio.mp3> --output-dir <dir> [options]

Salida generada:
    - vocals.wav (solo voz humana, sin música ni efectos)
    - accompaniment.wav (resto: música + efectos + ruido)
    - stats.json (metadatos del procesamiento)

Requisitos:
    pip install torch torchaudio demucs soundfile numpy scipy
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from demucs.api import Separator
from demucs.apply import apply_model
from demucs.pretrained import get_model


class VoiceIsolationEngine:
    """Motor de aislamiento de voz usando Demucs v4."""

    def __init__(self, model_name: str = "htdemucs", device: str = "auto"):
        """
        Inicializa el motor de aislamiento.

        Args:
            model_name: Nombre del modelo (htdemucs, mdx_extra, etc.)
            device: Device para inferencia ('cpu', 'cuda', 'auto')
        """
        self.model_name = model_name
        self.device = device if device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
        
        print(f"[INFO] Loading model '{model_name}' on {self.device}...", file=sys.stderr)
        
        # Cargar modelo pre-entrenado
        try:
            self.separator = Separator(model=model_name)
            print(f"[OK] Model loaded successfully.", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] Failed to load model: {e}", file=sys.stderr)
            raise

    @torch.no_grad()
    def isolate_vocals(
        self,
        input_path: Path,
        output_dir: Path,
        quality: str = "medium",
        segment_duration: float = 10.0,
    ) -> dict:
        """
        Aísla la voz humana del audio de entrada.

        Args:
            input_path: Ruta al audio de entrada (WAV/MP3/M4A)
            output_dir: Directorio para guardar resultados
            quality: Calidad vs velocidad tradeoff ('low' | 'medium' | 'high' | 'best')
            segment_duration: Duración máxima por segmento (segundos)

        Returns:
            dict con metadatos del procesamiento:
                {
                    "input_path": str,
                    "output_files": {
                        "vocals": str,
                        "accompaniment": str,
                    },
                    "duration_seconds": float,
                    "sample_rate": int,
                    "channels": int,
                    "model_used": str,
                    "processing_time_ms": int,
                }
        """
        import time

        start_time = time.perf_counter()

        # Asegurar directorio de salida
        output_dir.mkdir(parents=True, exist_ok=True)

        # Cargar audio
        print(f"[INFO] Reading audio from {input_path}", file=sys.stderr)
        audio, sample_rate = sf.read(str(input_path))

        # Normalizar a mono si es stereo
        channels = audio.shape[1] if len(audio.shape) > 1 else 1
        if channels > 1:
            audio = audio.mean(axis=1)

        duration_seconds = len(audio) / sample_rate

        # Configurar parámetros según calidad
        batch_size = {"low": 8, "medium": 4, "high": 2, "best": 1}[quality]
        shift = {"low": 0.5, "medium": 0.25, "high": 0.125, "best": 0.0625}[quality]

        print(
            f"[INFO] Processing {duration_seconds:.2f}s audio at {sample_rate}Hz, {channels}ch",
            file=sys.stderr,
        )
        print(f"[INFO] Using batch_size={batch_size}, shift={shift}s for {quality} quality", file=sys.stderr)

        # Inferir con separador
        try:
            separated = self.separator.separate(
                audio.astype(np.float32),
                samplerate=sample_rate,
                device=self.device,
                shift=shift,
                split=True,
                overlap=0.25,
                segment=int(segment_duration * sample_rate),
            )
        except Exception as e:
            print(f"[ERROR] Separation failed: {e}", file=sys.stderr)
            raise

        # Extraer stems
        vocals = separated["vocals"].mean(0) if len(separated["vocicals"].shape) > 1 else separated["vocals"]
        accompaniment = np.zeros_like(audio)

        # Sumar todos los otros stems para acompañamiento
        for stem in ["drums", "bass", "other"]:
            if stem in separated:
                stem_audio = separated[stem].mean(0) if len(separated[stem].shape) > 1 else separated[stem]
                accompaniment += stem_audio

        # Guardar archivos
        vocals_path = output_dir / "vocals.wav"
        accompaniment_path = output_dir / "accompaniment.wav"

        print(f"[INFO] Saving vocals to {vocals_path}", file=sys.stderr)
        sf.write(str(vocals_path), vocals, sample_rate)

        print(f"[INFO] Saving accompaniment to {accompaniment_path}", file=sys.stderr)
        sf.write(str(accompaniment_path), accompaniment, sample_rate)

        processing_time_ms = int((time.perf_counter() - start_time) * 1000)

        return {
            "input_path": str(input_path.absolute()),
            "output_files": {
                "vocals": str(vocals_path.absolute()),
                "accompaniment": str(accompaniment_path.absolute()),
            },
            "duration_seconds": float(duration_seconds),
            "sample_rate": int(sample_rate),
            "channels": int(channels),
            "model_used": self.model_name,
            "quality": quality,
            "processing_time_ms": processing_time_ms,
        }

    @torch.no_grad()
    def separate_stems(self, input_path: Path, output_dir: Path) -> dict:
        """
        Separa audio en stems individuales (vocales, batería, bajo, otro).

        Similar a isolate_vocals pero guarda cada stem por separado.

        Returns:
            dict con metadatos y rutas a cada stem
        """
        import time

        start_time = time.perf_counter()
        output_dir.mkdir(parents=True, exist_ok=True)

        # Cargar audio
        audio, sample_rate = sf.read(str(input_path))
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Inferir
        separated = self.separator.separate(
            audio.astype(np.float32),
            samplerate=sample_rate,
            device=self.device,
            split=True,
            overlap=0.25,
        )

        # Guardar cada stem
        output_files = {}
        for stem in ["vocals", "drums", "bass", "other"]:
            if stem in separated:
                stem_audio = separated[stem].mean(0) if len(separated[stem].shape) > 1 else separated[stem]
                stem_path = output_dir / f"{stem}.wav"
                sf.write(str(stem_path), stem_audio, sample_rate)
                output_files[stem] = str(stem_path.absolute())

        processing_time_ms = int((time.perf_counter() - start_time) * 1000)

        return {
            "input_path": str(input_path.absolute()),
            "output_files": output_files,
            "duration_seconds": float(len(audio) / sample_rate),
            "sample_rate": int(sample_rate),
            "model_used": self.model_name,
            "processing_time_ms": processing_time_ms,
        }


def main():
    parser = argparse.ArgumentParser(description="Voice isolation using Demucs v4")
    parser.add_argument("--input", required=True, help="Input audio file")
    parser.add_argument("--output-dir", required=True, help="Output directory for results")
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
        engine = VoiceIsolationEngine(model_name=args.model, device=args.device)

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
