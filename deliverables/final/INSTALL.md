# INSTALL — Olyvia 0.2.0 (Windows x64)

## Instalación

1. Ejecutar `Olyvia_0.2.0_x64-setup.exe` (NSIS, firmado).
2. Seguir el asistente: destino, accesos directos, asociación opcional.
3. El instalador incluye: FFmpeg/ffprobe, DLLs LGPL de FFmpeg, yt-dlp,
   Piper (voz local), ONNX Runtime, tipografías y avisos de licencia.

## Requisitos

- Windows 10/11 x64.
- ~2 GB libres para instalación (el bundle pesa ~142 MB comprimido).
- GPU integrada suficiente; el render usa CPU/FFmpeg.

## Verificación post-instalación

- Abrir Olyvia desde el menú inicio o acceso directo.
- La app incluye un proyecto de ejemplo en el selector inicial.
- MCP: el servidor MCP interno queda disponible desde Ajustes → MCP.

## Desinstalación

- "Agregar o quitar programas" → Olyvia → Desinstalar.
- Los proyectos del usuario viven en su carpeta de documentos y NO se borran.
