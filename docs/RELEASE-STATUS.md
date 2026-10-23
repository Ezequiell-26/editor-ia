# Estado de release — 2026-10-23

Documento de evidencia para la primera beta comercial. Se actualiza al cerrar
cada bloque; no reemplaza al [roadmap](ROADMAP.md) ni al README.

## Referencias

- `main`: **`058ffe7`** — CI de recursos corregido y verde.
- Rama de trabajo: **`feat/dubbing-import`** (`8841a5f`), publicada en
  `origin`. El PR no se pudo abrir con la herramienta GitHub MCP
  (`create_pull_request` devuelve un error de esquema de salida); URL de
  creación: https://github.com/Ezequiell-26/editor-ia/pull/new/feat/dubbing-import
- CI verde de `main`: https://github.com/Ezequiell-26/editor-ia/actions/runs/40011992590
- Entorno local: Windows, Ryzen 5 4600G, 14 GB, sin GPU dedicada.

## Clasificación

- **CI de `main`: LISTO** (run 40011992590, 15/15 pasos verdes).
- **Cambio de doblaje: NO VERIFICADO EN CI** (rama publicada, pruebas locales
  verdes; falta abrir/mergear el PR y correr su CI).
- **Distribución comercial: PENDIENTE EXTERNO** (firma confiable y decisión
  legal de LGPL; monetización y cuentas no configuradas).
- **Funciones fuera del alcance de esta beta**: importación EDL/OTIO/FCPXML,
  stock con licencia, publicación social, separación de voz, 10-bit/HDR,
  decodificación por hardware y colaboración en red.

## Qué está verificado

### Build y tests

- `npm run typecheck`: limpio.
- Vitest: **874/874** en **99 archivos**.
- Playwright e2e: **11/11**.
- Rust: **232 passed, 0 failed, 13 ignored**.
- Render live: **3/3** (pipeline 65.379 bytes, freeze 12.703 bytes,
  estabilización 21.205 bytes; MP4 verificados con FFprobe).
- Doblaje SAPI real: `Microsoft Zira Desktop`, video de 5 s, 2 cues, cama 0.15,
  **1/1**.
- `cargo fmt --all -- --check`: limpio.
- CI de `main`: typecheck, frontend, formato, build Tauri con recursos, tests
  del crate y render real, **todos verdes**.

### Recursos y paquete

- Causa raíz del CI corregida: `tauri-build` exige los recursos ignorados
  `resources/ffmpeg/*`, `resources/tools/*` y
  `resources/onnxruntime/onnxruntime.dll`. `scripts/ci-bundle-resources.sh`
  descarga FFmpeg estático, yt-dlp y ONNX Runtime antes de compilar.
- Recursos locales actualizados y probados: FFmpeg **9.0.2** con libx264 y
  libx265, yt-dlp **2026.10.21**, ONNX Runtime **1.22**.
- Instalador `main` anterior: **180,66 MiB**, firmado, instalado; la app cargó
  las siete DLLs LGPL desde su carpeta. Este artefacto precede al cambio de
  doblaje.
- Instalador de la rama de doblaje: **en construcción**; al terminar se agregan
  tamaño, hash y prueba de instalación.

### Seguridad y licencias

- `npm audit --omit=dev`: **0** vulnerabilidades de producción.
- `npm audit` completo: `vite` high y `vitest`/`tinypool` critical, **solo
  dependencias de desarrollo**; no se empaquetan en la app. `cargo audit` no
  está instalado; la auditoría de crates queda sin verificar.
- Búsqueda de patrones de claves en archivos versionados: sin coincidencias.
- Capacidades Tauri acotadas a ventana, diálogos y opener; sin FS/shell
  genéricos. CSP con `default-src 'self'` y `script-src 'self'`.
- Claves del proveedor en Windows Credential Manager, fuera del proyecto y los
  logs (`SECURITY.md`).
- Avisos de terceros actualizados: FFmpeg estático GPL como proceso externo,
  DLLs LGPL shared, video-rs/ffmpeg-next, ONNX Runtime, yt-dlp y FilmCraft.
  Wav2Lip queda **fuera** de la distribución comercial por su licencia no
  comercial.

## Bloqueos y pendientes

1. **PR de la rama de doblaje**: abrir con la URL anterior o corregir la
   herramienta GitHub MCP; su CI aún no se ejecutó.
2. **Instalador de la rama**: verificar instalación limpia, inicio, recursos,
   hash y firma; no se declara hasta medirlo.
3. **Firma confiable**: la actual es autofirmada y sólo confía localmente.
   SignPath o Microsoft Store son las vías gratuitas a evaluar; requieren cuenta
   y decisión del titular.
4. **Política LGPL**: `video-rs` enlaza dinámicamente FFmpeg LGPL. El ROADMAP
   dice “sólo MIT/Apache/BSD/Unlicense enlazadas”; esta integración es una
   excepción que necesita revisión legal antes de vender. Se distribuyen las
   DLLs sin modificar y con aviso, pero la política del proyecto debe
   actualizarse o la función debe desactivarse en la edición comercial.
5. **Monetización**: no hay proveedor de pagos, licencias ni cuentas
   configuradas. No se implementó nada ficticio. Decisión externa pendiente.
6. **Auditoría Rust**: instalar `cargo-audit` o ejecutar un escaneo equivalente
   antes de la release.
7. **Dependencias de desarrollo**: actualizar Vite/Vitest para cerrar los
   avisos de auditoría sin rebajar pruebas.

## Próximo paso

Con el CI de `main` verde: terminar el instalador de la rama, instalarlo y
verificar el arranque y los recursos; abrir el PR; después resolver la decisión
legal de LGPL y la firma confiable antes de hablar de venta.
