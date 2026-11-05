@echo off
call "D:\visualstudiocomunity\VC\Auxiliary\Build\vcvarsall.bat" amd64 10.0.26100.0 -vcvars_ver=14.43.34808 >nul 2>&1
set "FFMPEG_DIR=C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0"
set "PATH=C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0\bin;%PATH%"
set "PKG_CONFIG_PATH=C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0\lib\pkgconfig"
set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
set "RUSTFLAGS=-C link-arg=/STACK:134217728"
cd /d "D:\Users\ofici\QODER-WORK\editor-ia\apps\desktop\src-tauri"
cargo test --release --lib render::ffmpeg 1> C:\Temp\rust-ffmpeg-tests.log 2>&1
echo TEST_EXIT=%ERRORLEVEL%
