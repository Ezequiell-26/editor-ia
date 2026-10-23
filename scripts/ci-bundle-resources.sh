#!/usr/bin/env bash
# Rellena los recursos grandes que el repo no versiona (FFmpeg estático,
# yt-dlp y ONNX Runtime) para que `tauri-build` pueda copiarlos y el instalador
# de CI quede completo. Los binarios ya presentes se respetan.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ffmpeg_dir="$root/apps/desktop/src-tauri/resources/ffmpeg"
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

ensure_ffmpeg
ensure_ytdlp
ensure_onnxruntime

ls -lh "$ffmpeg_dir/ffmpeg.exe" "$ffmpeg_dir/ffprobe.exe" \
  "$tools_dir/yt-dlp.exe" "$ort_dir/onnxruntime.dll"
