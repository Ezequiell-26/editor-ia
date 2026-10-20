"""Local Faster-Whisper bridge for Editor IA.

Reads an audio/video file, transcribes it on CPU with int8, and prints one JSON
document to stdout. Diagnostics go to stderr. The input is never modified.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model", default="small")
    parser.add_argument("--beam-size", type=int, default=5)
    args = parser.parse_args()

    source = args.input.expanduser().resolve()
    if not source.is_file() or source.stat().st_size == 0:
        print("ERROR: input file is missing or empty", file=sys.stderr)
        return 2

    hf_home = os.environ.get("EDITORIA_HF_HOME")
    if hf_home:
        os.environ.setdefault("HF_HOME", hf_home)
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("ERROR: faster-whisper is not installed in this Python", file=sys.stderr)
        return 3

    language = None if args.language.lower() == "auto" else args.language.lower()
    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        iterator, info = model.transcribe(
            str(source),
            language=language,
            word_timestamps=True,
            vad_filter=True,
            beam_size=max(1, args.beam_size),
        )
        segments = []
        for segment in iterator:
            text = (segment.text or "").strip()
            if not text:
                continue
            words = []
            for word in segment.words or []:
                words.append(
                    {
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                        "word": (word.word or "").strip(),
                        "probability": round(float(word.probability or 0), 4),
                    }
                )
            segments.append(
                {
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": text,
                    "words": words,
                }
            )
    except Exception as exc:  # noqa: BLE001 - report the provider error
        print(f"ERROR: transcription failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 4

    json.dump(
        {
            "language": getattr(info, "language", None) or (language or "auto"),
            "languageProbability": round(float(getattr(info, "language_probability", 0) or 0), 4),
            "durationSeconds": round(float(getattr(info, "duration", 0) or 0), 3),
            "model": args.model,
            "segments": segments,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
