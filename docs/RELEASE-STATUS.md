# Estado de release — 2026-10-23

Documento de evidencia para la primera beta comercial. Se actualiza al cerrar
cada bloque; no reemplaza al [roadmap](ROADMAP.md) ni al README.

## Referencias

- `main`: **`058ffe7`** — CI de recursos corregido y verde.
- Rama de trabajo: **`feat/dubbing-import`** (`f372e59`), publicada en
  `origin`. El PR no se pudo abrir con la herramienta GitHub MCP
  (`create_pull_request` devuelve un error de esquema de salida); URL de
  creación: https://github.com/Ezequiell-26/editor-ia/pull/new/feat/dubbing-import
  El workflow `verify` de la rama se disparó por `workflow_dispatch` y quedó
  verde: https://github.com/Ezequiell-26/editor-ia/actions/runs/40015435883
  (commit `f372e59`; `5ee1ff9` sólo agrega documentación).
- CI verde de `main`: https://github.com/Ezequiell-26/editor-ia/actions/runs/40011992590
- Entorno local: Windows, Ryzen 5 4600G, 14 GB, sin GPU dedicada.

## Clasificación

- **CI de `main`: LISTO** (run 40011992590, 15/15 pasos verdes).
- **Cambio de doblaje: LISTO** (pruebas locales y CI de rama verdes; falta
  abrir el PR, que es una limitación de la herramienta GitHub MCP).
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
- Instalador QA de la rama de doblaje: **184,00 MiB** (192.938.688 bytes),
  SHA-256 `F563A18EB8D02B17F776C673692DAEA523A78507768DC7C09E9399813D41C05B`,
  firma Authenticode válida. Contiene el `.exe`, las siete DLLs, `ffmpeg.exe`/
  `ffprobe.exe` **9.0.2**, `yt-dlp` **2026.10.21**, `onnxruntime.dll` **1.22**,
  la extensión y el aviso `FFMPEG-LICENSE.txt`. Instalado con el instalador
  silencioso: la app arrancó y cargó las siete DLLs desde
  `C:\Users\ofici\AppData\Local\Editor IA`. La firma del `.exe` instalado
  también verifica.

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
   herramienta GitHub MCP; el CI de la rama está corriendo por dispatch.
2. **Firma confiable**: la actual es autofirmada y sólo confía localmente.
   SignPath o Microsoft Store son las vías gratuitas a evaluar; requieren cuenta
   y decisión del titular.
3. **Política LGPL**: `video-rs` enlaza dinámicamente FFmpeg LGPL. El ROADMAP
   dice “sólo MIT/Apache/BSD/Unlicense enlazadas”; esta integración es una
   excepción que necesita revisión legal antes de vender. Se distribuyen las
   DLLs sin modificar y con aviso, pero la política del proyecto debe
   actualizarse o la función debe desactivarse en la edición comercial.
4. **Monetización**: no hay proveedor de pagos, licencias ni cuentas
   configuradas. No se implementó nada ficticio. Decisión externa pendiente.
5. **Auditoría Rust**: instalar `cargo-audit` o ejecutar un escaneo equivalente
   antes de la release.
6. **Dependencias de desarrollo**: actualizar Vite/Vitest para cerrar los
   avisos de auditoría sin rebajar pruebas.

## Clasificación final de esta pasada

- **LISTO**: CI de `main` y de la rama, typecheck, Vitest, Playwright, Rust,
  render real, doblaje SAPI e instalador QA instalado y abierto.
- **PENDIENTE EXTERNO**: abrir el PR (la herramienta GitHub MCP falla al
  crearlo), firma confiable, revisión legal LGPL y fuente/oferta GPL,
  monetización y cuentas.
- **NO VERIFICADO**: `cargo audit`, instalación en una segunda máquina limpia y
  el flujo de pago real.
- **BLOQUEADO**: ninguno técnico para la beta local.

## Próximo paso

Abrir el PR de la rama (o mergearla) y resolver la revisión legal de LGPL y la
firma confiable; después, la decisión de monetización. El producto no se declara
“listo para vender” hasta cerrar esos puntos externos.
