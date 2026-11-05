@echo off
REM Build Editor IA (Windows) — entorno verificado:
REM  * toolchain MSVC 14.43.34808 (la 14.51 instalada esta incompleta: sin msvcrt.lib)
REM  * FFmpeg 9.0 RELEASE shared: sonames avcodec-63 / avformat-63 / avutil-61,
REM    identicos a resources/ffmpeg-dll del repo. (El snapshot "master" trae enums
REM    post-9.0 que ffmpeg-next 9.0.0 no cubre -> E0004 non-exhaustive patterns.)
REM  * libclang (LLVM) para bindgen + pila grande: los build scripts en MSVC
REM    nacen con 1MB y bindgen hace STATUS_STACK_OVERFLOW con los headers de FFmpeg.
call "D:\visualstudiocomunity\VC\Auxiliary\Build\vcvarsall.bat" amd64 10.0.26100.0 -vcvars_ver=14.43.34808
if errorlevel 1 exit /b 1

set "FFMPEG_DIR=C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0"
set "PKG_CONFIG_PATH=C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0\lib\pkgconfig"
set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
set "RUSTFLAGS=-C link-arg=/STACK:134217728"

cd /d "D:\Users\ofici\QODER-WORK\editor-ia\apps\desktop"
call npm run tauri build
echo TauriExitCode=%ERRORLEVEL%
