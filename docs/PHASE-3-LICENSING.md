# Fase 3 — Licencias Free/Pro

Actualizado: 2026-10-28. Feature freeze respetado: se agregó la capa de
licencias, no funciones nuevas.

## Matriz aplicada

| Capacidad | Free | Pro |
|---|---|---|
| Descargas simultáneas | 2 | hasta 512 |
| Cola | 25 | sin límite desde la UI |
| Resolución de descarga | hasta 1080p | 4K/8K |
| Códec de descarga | MP4/H.264 | HEVC, AV1, HDR 10-bit |
| Formatos | MP4/MP3/M4A | MKV/WebM y todos los anteriores |
| Upscale 4K | no | sí |
| SponsorBlock automático | no | sí |
| Programación, carpetas vigiladas, RSS | no | sí |
| Director IA / Fábrica | bloqueados con pantalla Pro | sí |
| Editor y exportación 1080p | completo, sin marca de agua | completo |
| Exportación >1080p o H.265 | bloqueada en Rust | permitida |
| Proyectos creados en Pro | se abren y editan en Free | — |

## Arquitectura

- **Firma:** el archivo de licencia es JSON con `payload` y `signature`
  Ed25519. La app embebe la clave pública; la privada vive fuera del repo en
  `D:\Users\ofici\QODER-WORK\editor-ia-license-keys` y no se versiona.
- **Estado local:** `license.bin` se guarda cifrado con AES-256-GCM. La clave
  se deriva de un secreto de aplicación + identificador de máquina. Copiar el
  archivo a otra PC no activa Pro; el archivo firmado original se puede volver
  a activar.
- **Alcance:** el cifrado local es una barrera de copia, no DRM. La validación
  fuerte es la firma. En la Fase 4 el servidor entregará las licencias y podrá
  limitar activaciones.
- **Comandos Rust:** `license_status`, `choose_license_file`,
  `activate_license`, `deactivate_license`. El estado global vive en
  `AppState.license`.
- **UI:** Ajustes → Licencia muestra plan, email, ID, vencimiento, activación
  por archivo y desactivación. Las herramientas Pro muestran una pantalla de
  bloqueo, no un error genérico.

## Enforcement

- **Descarga (Rust):** `check_download` rechaza >1080p, H.265/AV1, HDR
  preservado, upscale 4K, SponsorBlock automático y MKV/WebM en Free. Si Free
  pide “mejor” sin altura, el backend fija 1080p y H.264. `check_parallel`
  rechaza la tercera descarga simultánea Free.
- **Render (Rust):** `check_render` bloquea perfiles >1920×1080 o H.265 en
  Free, tanto en export normal como en variantes.
- **Fábrica (Rust):** `write_project_variant` y `render_project_variant`
  exigen Pro.
- **UI:** límites de paralelismo y cola, opciones 4K/HEVC/AV1/HDR/upscale y
  MKV/WebM deshabilitadas, programación/SponsorBlock/carpetas/RSS bloqueados,
  Director y Fábrica con ProLock, aviso de perfiles en ExportDialog.
- **Compatibilidad:** abrir un proyecto no consulta la licencia ni modifica el
  schema; un proyecto con perfiles Pro se abre y edita en Free, y sólo el
  export de esos perfiles pide Pro.

## Licencia de desarrollo

```
OLYVIA_LICENSE_PRIVATE_KEY="…/olyvia-license-private.pk8.b64" \
  node scripts/license-sign-dev.mjs --email dev@olyvia.local --id dev-local \
  --out "…/olyvia-dev-license.json"
```

El archivo generado se verifica con la clave pública de producción y puede
cargarse desde Ajustes → Licencia. La clave privada no debe publicarse ni
commitearse.

## Verificación

- Rust: **449 passed + 47 ignored**, incluidos 6 tests de licencia.
- Frontend: **961/961 en 140 archivos**; typecheck verde.
- Tests nuevos: firma/tamper, cifrado por máquina, gating Free de descarga y
  render, activación/desactivación, bloqueo de Director/Fábrica y apertura de
  proyecto Free.
- Licencia de desarrollo firmada y verificada con Node/Ed25519.
- Sin build, instalación, commit ni push.

## Pendiente para Fase 4

1. Endpoint de verificación/activación (Lemon Squeezy/Gumroad) y trial 14 días.
2. Emisión real de licencias con la clave privada del servidor.
3. Decidir política de reactivación en otra máquina y límite de activaciones.
4. Pulir copy de Free/Pro y precio en la UI de compra.
