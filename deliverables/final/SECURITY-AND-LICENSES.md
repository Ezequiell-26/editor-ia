# SECURITY-AND-LICENSES — Olyvia 0.2.0

## Seguridad

- **Credenciales**: claves de proveedores en Windows Credential Manager
  (keyring v3). Nunca en settings, proyectos, prompts ni logs.
- **Validación de entradas**: planes, run IDs, URLs de providers y payloads
  acotados (tamaño máximo de descarga, magic bytes, https obligatorio).
- **Errores tipados**: `ProjectErrorCode`; sin stack traces ni rutas internas
  filtradas al cliente.
- **Cancelación real**: `production_cancel` detiene el driver y mata el
  proceso FFmpeg activo del render (verificado en `run_driver`).
- **Recursos**: límites de drivers concurrentes (2), avance serializado por
  corrida, reconciliación de corridas huérfanas al arranque.

## Licencias de terceros incluidas en el bundle

- **FFmpeg/ffprobe**: build LGPL — DLLs dinámicas incluidas, aviso de licencia
  en `resources/notices/`.
- **yt-dlp**: ejecutable externo con su licencia.
- **Piper**: MIT — síntesis de voz local.
- **ONNX Runtime**: MIT.
- **filmcraft** (color/scopes/audio-dsp): crates del workspace.
- Fuentes Twemoji/Noto Color Emoji: SIL OFL.

Auditoría automatizada disponible: `npm run audit:licenses`
(`scripts/audit-bundle-licenses.mjs`).

## Firma

Binario y DLLs firmados con certificado local del usuario
(thumbprint `58204858…C3954`). No es un certificado de distribuidor público:
Windows SmartScreen puede advertir en equipos de terceros.
