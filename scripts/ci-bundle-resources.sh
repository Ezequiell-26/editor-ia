#!/usr/bin/env bash
# Rellena los recursos grandes que el repo no versiona (FFmpeg estático,
# yt-dlp, ONNX Runtime y Piper TTS) para que `tauri-build` pueda copiarlos y el
# instalador de CI quede completo. Los binarios ya presentes se respetan.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ffmpeg_dir="$root/apps/desktop/src-tauri/resources/ffmpeg"
tools_dir="$root/apps/desktop/src-tauri/resources/tools"
ort_dir="$root/apps/desktop/src-tauri/resources/onnxruntime"
piper_dir="$root/apps/desktop/src-tauri/resources/piper"
work="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/editor-ia-bundle"

mkdir -p "$ffmpeg_dir" "$tools_dir" "$ort_dir" "$work"

extract() {
  local archive="$1" destination="$2"
  if command -v 7z >/dev/null 2>&1; then
    7z x "$archive" -o"$destination" -y >/dev/null
  else
    unzip -q "$archive" -d "$destination"
  fi
}

ensure_ffmpeg() {
  if [ -f "$ffmpeg_dir/ffmpeg.exe" ] && [ -f "$ffmpeg_dir/ffprobe.exe" ]; then
    return
  fi
  local dir="$work/ffmpeg-static"
  mkdir -p "$dir"
  echo "Descargando FFmpeg estático"
  curl -fsSL -o "$work/ffmpeg-static.zip" \
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
  extract "$work/ffmpeg-static.zip" "$dir"
  local ffmpeg ffprobe
  ffmpeg="$(find "$dir" -type f -path '*/bin/ffmpeg.exe' | head -1)"
  ffprobe="$(find "$dir" -type f -path '*/bin/ffprobe.exe' | head -1)"
  if [ -z "$ffmpeg" ] || [ -z "$ffprobe" ]; then
    echo "El paquete de FFmpeg no trae ffmpeg.exe/ffprobe.exe" >&2
    exit 2
  fi
  cp "$ffmpeg" "$ffmpeg_dir/ffmpeg.exe"
  cp "$ffprobe" "$ffmpeg_dir/ffprobe.exe"
}

ensure_ytdlp() {
  if [ -f "$tools_dir/yt-dlp.exe" ]; then
    return
  fi
  echo "Descargando yt-dlp"
  curl -fsSL -o "$tools_dir/yt-dlp.exe" \
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
}

ensure_onnxruntime() {
  if [ -f "$ort_dir/onnxruntime.dll" ]; then
    return
  fi
  local dir="$work/onnxruntime"
  mkdir -p "$dir"
  echo "Descargando ONNX Runtime 1.22"
  curl -fsSL -o "$work/onnxruntime.zip" \
    "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-win-x64-1.22.0.zip"
  extract "$work/onnxruntime.zip" "$dir"
  local dll
  dll="$(find "$dir" -type f -name onnxruntime.dll | head -1)"
  if [ -z "$dll" ]; then
    echo "El paquete de ONNX Runtime no trae onnxruntime.dll" >&2
    exit 2
  fi
  cp "$dll" "$ort_dir/onnxruntime.dll"
}

ensure_piper() {
  local archive="$work/piper_windows_amd64.zip"
  local unpack="$work/piper-runtime"
  local piper_exe="$piper_dir/piper.exe"
  local model="$piper_dir/es_voice.onnx"
  local config="$piper_dir/es_voice.onnx.json"

  mkdir -p "$piper_dir"

  if [ ! -f "$piper_exe" ] || [ ! -d "$piper_dir/espeak-ng-data" ]; then
    mkdir -p "$unpack"
    echo "Descargando Piper TTS Windows 2023.11.14-2"
    curl -fsSL --retry 3 -o "$archive" \
      "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
    printf '%s  %s\n' \
      "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea" \
      "$archive" | sha256sum --check -
    extract "$archive" "$unpack"

    local exe engine_root
    exe="$(find "$unpack" -type f -name piper.exe | head -1)"
    if [ -z "$exe" ]; then
      echo "El paquete oficial de Piper no contiene piper.exe" >&2
      exit 2
    fi
    engine_root="$(dirname "$exe")"
    cp -a "$engine_root"/. "$piper_dir"/
  fi

  if [ ! -f "$model" ]; then
    echo "Descargando voz es_ES-davefx-medium"
    curl -fsSL --retry 3 -o "$model" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx"
  fi
  printf '%s  %s\n' \
    "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917" \
    "$model" | sha256sum --check -

  if [ ! -f "$config" ]; then
    curl -fsSL --retry 3 -o "$config" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json"
  fi
  printf '%s  %s\n' \
    "0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842" \
    "$config" | sha256sum --check -

  if [ ! -f "$piper_dir/MODEL_CARD" ]; then
    curl -fsSL --retry 3 -o "$piper_dir/MODEL_CARD" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/MODEL_CARD"
  fi
  cat > "$piper_dir/THIRD-PARTY-NOTICES.txt" <<'EOF'
Piper TTS (https://github.com/rhasspy/piper) — MIT License.
Windows binary release 2023.11.14-2, bundled unmodified with its runtime DLLs
and espeak-ng data.

Spanish voice: es_ES-davefx-medium (Piper voices repository,
https://huggingface.co/rhasspy/piper-voices). See MODEL_CARD for the voice
and training-data attribution. The model is used locally for offline narration.

No audio leaves the device. Voice output is generated with ONNX Runtime.
EOF

  for asset in \
    piper.exe \
    espeak-ng.dll \
    libtashkeel_model.ort \
    onnxruntime.dll \
    onnxruntime_providers_shared.dll \
    piper_phonemize.dll \
    es_voice.onnx \
    es_voice.onnx.json; do
    test -f "$piper_dir/$asset" || {
      echo "Falta el recurso Piper requerido: $asset" >&2
      exit 2
    }
  done
  test -d "$piper_dir/espeak-ng-data"
}

ensure_ffmpeg
ensure_ytdlp
ensure_onnxruntime
ensure_piper

ls -lh "$ffmpeg_dir/ffmpeg.exe" "$ffmpeg_dir/ffprobe.exe" \
  "$tools_dir/yt-dlp.exe" "$ort_dir/onnxruntime.dll" \
  "$piper_dir/piper.exe" "$piper_dir/es_voice.onnx" "$piper_dir/es_voice.onnx.json"
