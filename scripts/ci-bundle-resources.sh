#!/usr/bin/env bash
# Rellena los recursos grandes que el repo no versiona (FFmpeg estático,
# yt-dlp y ONNX Runtime) para que `tauri-build` pueda copiarlos y el instalador
# de CI quede completo. Los binarios ya presentes se respetan.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ffmpeg_dir="$root/apps/desktop/src-tauri/resources/ffmpeg"
ffmpeg_dll_dir="$root/apps/desktop/src-tauri/resources/ffmpeg-dll"
tools_dir="$root/apps/desktop/src-tauri/resources/tools"
ort_dir="$root/apps/desktop/src-tauri/resources/onnxruntime"
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

# Compilación LGPL shared de BtbN: sin --enable-gpl/nonfree, con libopenh264 y
# libkvazaar, y sin libx264/libx265/libxvid. El paquete trae ffmpeg.exe y
# ffprobe.exe enlazados contra las DLLs de av*/sw*, que también se copian.
FFMPEG_LGPL_ASSET="ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip"

ensure_ffmpeg() {
  if [ -f "$ffmpeg_dir/ffmpeg.exe" ] && [ -f "$ffmpeg_dir/ffprobe.exe" ]; then
    return
  fi
  local dir="$work/ffmpeg-lgpl"
  mkdir -p "$dir"
  echo "Descargando FFmpeg LGPL shared (BtbN)"
  curl -fsSL -o "$work/ffmpeg-lgpl.zip" \
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$FFMPEG_LGPL_ASSET"
  extract "$work/ffmpeg-lgpl.zip" "$dir"
  local bin
  bin="$(find "$dir" -type d -path '*/bin' | head -1)"
  if [ -z "$bin" ] || [ ! -f "$bin/ffmpeg.exe" ] || [ ! -f "$bin/ffprobe.exe" ]; then
    echo "El paquete de FFmpeg no trae ffmpeg.exe/ffprobe.exe" >&2
    exit 2
  fi
  local license
  license="$(find "$dir" -type f -name 'LICENSE.txt' | head -1)"
  if [ -z "$license" ] || ! grep -qi "LESSER GENERAL PUBLIC LICENSE" "$license"; then
    echo "El paquete de FFmpeg no trae una licencia LGPL reconocible" >&2
    exit 2
  fi
  # La integridad del build se valida ejecutándolo: en runners Windows
  # (Git Bash) esto es posible; en otros hosts queda la auditoría de LICENSE.
  if "$bin/ffmpeg.exe" -hide_banner -buildconf >"$work/ffmpeg-buildconf.txt" 2>/dev/null; then
    if grep -Eq -- '--enable-(gpl|nonfree)' "$work/ffmpeg-buildconf.txt"; then
      echo "El FFmpeg descargado incluye GPL/nonfree" >&2
      exit 2
    fi
    "$bin/ffmpeg.exe" -hide_banner -encoders >"$work/ffmpeg-encoders.txt" 2>/dev/null || true
    for required in libopenh264 libkvazaar; do
      if ! grep -q "$required" "$work/ffmpeg-encoders.txt"; then
        echo "El FFmpeg descargado no incluye $required" >&2
        exit 2
      fi
    done
    if grep -Eq 'libx264|libx265|libxvid' "$work/ffmpeg-encoders.txt"; then
      echo "El FFmpeg descargado incluye encoders GPL" >&2
      exit 2
    fi
  fi
  cp "$bin/ffmpeg.exe" "$ffmpeg_dir/ffmpeg.exe"
  cp "$bin/ffprobe.exe" "$ffmpeg_dir/ffprobe.exe"
  local dll
  mkdir -p "$ffmpeg_dll_dir"
  for dll in "$bin"/*.dll; do
    [ -e "$dll" ] || continue
    cp "$dll" "$ffmpeg_dir/"
    cp "$dll" "$ffmpeg_dll_dir/"
  done
  cp "$license" "$ffmpeg_dir/LICENSE.txt"
  cp "$license" "$ffmpeg_dll_dir/LICENSE.txt"
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

ensure_ffmpeg
ensure_ytdlp
ensure_onnxruntime

ls -lh "$ffmpeg_dir/ffmpeg.exe" "$ffmpeg_dir/ffprobe.exe" "$ffmpeg_dir/LICENSE.txt" \
  "$tools_dir/yt-dlp.exe" "$ort_dir/onnxruntime.dll"
ls -1 "$ffmpeg_dir"/*.dll | wc -l | xargs echo "DLLs LGPL de FFmpeg empaquetadas:"
