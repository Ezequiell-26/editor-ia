#!/usr/bin/env bash
# Prepara en un runner Windows el FFmpeg de desarrollo (LGPL shared) y libclang
# que necesita `video-rs`/`ffmpeg-sys-next`. Deja EDITOR_IA_FFMPEG_DEV y
# LIBCLANG_PATH en GITHUB_ENV y copia las DLLs al bundle con el setup normal.
set -euo pipefail

root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/editor-ia-ffmpeg-dev"
archive="$root/ffmpeg-dev.zip"
url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip"

mkdir -p "$root"
if [ ! -f "$root/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0/include/libavcodec/avcodec.h" ]; then
  echo "Descargando FFmpeg dev: $url"
  curl -fsSL -o "$archive" "$url"
  if command -v 7z >/dev/null 2>&1; then
    7z x "$archive" -o"$root" -y >/dev/null
  else
    unzip -q "$archive" -d "$root"
  fi
fi
dev_dir="$root/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0"
if [ ! -f "$dev_dir/include/libavcodec/avcodec.h" ]; then
  echo "La descarga no contiene include/libavcodec/avcodec.h" >&2
  exit 2
fi
windows_dev_dir="$(cygpath -w "$dev_dir")"
export EDITOR_IA_FFMPEG_DEV="$windows_dev_dir"

python -m pip install --quiet libclang
libclang="$(python -c "import clang, os; print(os.path.join(os.path.dirname(clang.__file__), 'native'))")"
if [ ! -f "$libclang/libclang.dll" ]; then
  echo "libclang.dll no quedó en $libclang" >&2
  exit 2
fi
windows_libclang="$(cygpath -w "$libclang")"
export LIBCLANG_PATH="$windows_libclang"

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "EDITOR_IA_FFMPEG_DEV=$windows_dev_dir"
    echo "LIBCLANG_PATH=$windows_libclang"
  } >> "$GITHUB_ENV"
fi

node scripts/setup-ffmpeg-dev.mjs --runtime
