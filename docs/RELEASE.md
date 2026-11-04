# Release de Olyvia (build reproducible, firma y verificación)

Estado: **2026-11-03** · Ola de release (`task-13`).
Alcance: build reproducible desde CI, versionado, firma Authenticode real,
SmartScreen y verificación de artefactos.
Lo que **no** se puede hacer desde este repo: comprar u obtener un certificado de
firma de código real (requiere una CA y credenciales externas). Este documento y
el workflow dejan todo listo para firmar; el límite está declarado en §8 y en
[`FOLLOW-UPS.md`](FOLLOW-UPS.md) §5.

- Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
- Config de la app: [`tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json)
- Contrato de color/versionado de la app: [`COLOR-CUSTOMIZATION.md`](COLOR-CUSTOMIZATION.md)

---

## 1. Qué produce un release

| Artefacto | Ruta | Formato |
|---|---|---|
| Ejecutable de la app | `target/release/editor-ia-desktop.exe` | Windows x64 (Tauri, WebView2) |
| Instalador | `target/release/bundle/nsis/Olyvia_<version>_x64-setup.exe` | NSIS, instalación `currentUser` |
| Sumas de verificación | `target/release/SHA256SUMS.txt` | SHA-256 por artefacto |

`target/` es la raíz de Cargo del repo; el workflow sube exactamente esos paths
y falla si el instalador no existe o pesa menos de 1 MB. Si un build local usa
`CARGO_TARGET_DIR` (por ejemplo `apps/desktop/src-tauri/target-polish`), los
artefactos quedan bajo esa carpeta: ajustá las rutas al verificar (§6).

La app es **local-first**: el release no publica en ninguna red ni sube datos;
sólo distribuye el binario y sus recursos empaquetados (FFmpeg, yt-dlp, ONNX,
Piper y la extensión de descarga).

## 2. Requisitos del entorno de build

- Windows 10/11 x64 (el workflow usa `windows-2022`).
- Node 22 (`engines.node` del `package.json`; el workflow fija `'22'`).
- Rust estable fijado por [`rust-toolchain.toml`](../rust-toolchain.toml);
  `rustup show` aplica el toolchain del repo.
- Visual Studio 2022 con toolset C++ (MSVC, Windows SDK).
- Dependencias: `npm ci` (lockfile, sin actualizar versiones).
- FFmpeg de desarrollo compartido + `libclang` para `video-rs`
  (`bash scripts/ci-ffmpeg-dev.sh`, o `EDITOR_IA_FFMPEG_DEV` / `LIBCLANG_PATH`
  en una máquina propia).
- Recursos empaquetados (`bash scripts/ci-bundle-resources.sh`: FFmpeg, yt-dlp,
  ONNX, Piper).
- NSIS lo descarga/usa Tauri; no hace falta instalarlo a mano.

## 3. Build local paso a paso

```powershell
# Desde la raíz del repo
npm ci
bash scripts/ci-ffmpeg-dev.sh
bash scripts/ci-bundle-resources.sh

# Puertas de verificación (mismas que CI)
npm run verify                      # typecheck + tests seriales + extensión + web-tts
npm run build                       # build Vite del frontend (lo repite Tauri)

# Build del instalador (usa el toolchain que descubre scripts/rust-env.mjs)
npm run tauri:build
```

Salida esperada:

```text
target/release/editor-ia-desktop.exe
target/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe
```

Notas:

- `npm run tauri:build` ejecuta antes `scripts/setup-ffmpeg-dev.mjs` y envuelve
  el comando con `scripts/rust-env.mjs` (descubre MSVC real; no se hardcodea
  ninguna ruta de Visual Studio).
- Para iterar sin empaquetar: `npm run tauri:build:debug`
  (`tauri build --debug --no-bundle`).
- El build local usa el certificado self-signed configurado en
  `tauri.conf.json` (§4.1). En CI la firma real entra por `--config` sin tocar
  el archivo ni la identidad de la app.

## 4. Firma de código

### 4.1 Estado actual del repo (firma local self-signed, NO es firma real)

`apps/desktop/src-tauri/tauri.conf.json` → `bundle.windows`:

```json
{
  "certificateThumbprint": "58204858E163CE7DA173DB8AB09CD9B8359C3954",
  "digestAlgorithm": "sha256",
  "tsp": false
}
```

Ese thumbprint corresponde a un certificado **self-signed** `CN=Editor IA
(Self-Signed), O=Editor IA`, instalado sólo en la máquina de desarrollo. Sirve
para probar el flujo de firma y para integridad local, pero:

- **No es de confianza** en otras PCs: Windows lo trata como emisor desconocido.
- **No evita SmartScreen**: el aviso «Windows protegió su PC» puede aparecer
  igual (la reputación es por firmante/certificado, no por tener firma).
- No debe presentarse como «app firmada» en el sitio o el README.

La app instalada desde el NSIS de esta máquina sí verifica como `Valid` porque
el certificado self-signed está en su store local; eso **no** se traslada a un
Windows limpio.

### 4.2 Firma real: qué hay que obtener (fuera del repo)

Un **certificado de firma de código Authenticode** emitido por una CA pública
(no se puede generar ni comprar desde el repositorio; requiere identidad legal,
pago y credenciales). Opciones válidas:

| Tipo | Emisión | Uso en CI | Nota |
|---|---|---|---|
| OV (Organization Validation) | Sectigo, DigiCert, SSL.com, GlobalSign… | PFX exportable → secrets | Reputación SmartScreen se construye con descargas |
| EV (Extended Validation) | misma CAs, validación más estricta | PFX o token/HSM/cloud | Reputación inmediata; el token físico no exporta PFX → usar cloud signing |
| Cloud/HSM (Azure Trusted Signing, SSL.com eSigner…) | proveedor cloud | `signCommand` propio | Requiere adaptar el workflow; documentado como follow-up |

Requisitos mínimos:

- Certificado **code signing** (no TLS) válido para Windows Authenticode.
- Clave privada utilizable en CI: PFX exportable **o** servicio de firma.
- **Timestamp** de una autoridad pública (obligatorio para que la firma siga
  válida cuando expire el certificado). Por defecto el workflow usa
  `http://timestamp.digicert.com`; se puede cambiar con la variable de repo
  `WINDOWS_TIMESTAMP_URL`.
- Algoritmo de digest **SHA-256**.

### 4.3 Configuración en GitHub Actions (secrets y variables)

Secrets (Settings → Secrets and variables → Actions → **Secrets**):

| Secret | Contenido | Obligatorio |
|---|---|---|
| `WINDOWS_CERTIFICATE_BASE64` | PFX exportable codificado en base64 de una sola línea | Sí para release |
| `WINDOWS_CERTIFICATE_PASSWORD` | Contraseña del PFX | Sí para release |
| `TAURI_SIGNING_PRIVATE_KEY` | Clave de firma de artefactos de updater (minisign/base64) | No (sólo si se adopta updater) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Contraseña de esa clave | No |

Variables (pestaña **Variables**, no son secretas):

| Variable | Default | Uso |
|---|---|---|
| `WINDOWS_TIMESTAMP_URL` | `http://timestamp.digicert.com` | Servidor de sello de tiempo. En CAs con RFC3161 usar su URL TSP |
| `WINDOWS_TIMESTAMP_TSP` | `false` | `true` si la CA exige RFC 3161 (protocolo TSP) |

Preparación del PFX para el secret (en una máquina de confianza, **no** en CI):

```powershell
# Base64 de una sola línea (sin saltos de línea)
[Convert]::ToBase64String([IO.File]::ReadAllBytes('.\certificado.pfx'))
```

**Nunca** se commitea el PFX, la contraseña ni la clave de updater. El workflow
no imprime su contenido: escribe el PFX en `RUNNER_TEMP`, importa el
certificado a `Cert:\CurrentUser\My`, borra el archivo y usa el thumbprint.

### 4.4 Cómo firma el workflow

1. Detecta si existe `WINDOWS_CERTIFICATE_BASE64`.
2. Si no existe y el disparo es un **tag** (`v*`) y `allow_unsigned` no es
   `true`, **falla** con un mensaje que indica cómo configurar los secrets
   (no publica un release sin firma).
3. Si existe, importa el PFX, obtiene el thumbprint y genera una configuración
   temporal de Tauri que se pasa por `--config` (archivo
   `apps/desktop/tauri.release-signing.json`, creado en el runner y borrado por
   un paso `if: always()`; no modifica `tauri.conf.json` ni la identidad/ventana
   de la app):

   ```json
   {"bundle":{"windows":{"certificateThumbprint":"<thumbprint>","digestAlgorithm":"sha256","timestampUrl":"<url>","tsp":false}}}
   ```

4. Tauri usa `signtool` estándar sobre el `.exe` y el instalador NSIS.
5. Verifica `Get-AuthenticodeSignature` de ambos artefactos: si alguno no queda
   `Valid`, el job falla.
6. Publica hashes en `SHA256SUMS.txt` y sube todo como artefacto del workflow.

Para **EV por token/cloud** (sin PFX exportable): adaptar el build con
`bundle.windows.signCommand` apuntando al cliente del proveedor (por ejemplo
Azure Trusted Signing o eSigner) con el placeholder `%1` para el binario. Es un
follow-up (§8); el workflow actual cubre PFX exportable.

### 4.5 Disparar un release

Requisito previo: la versión de la app en `apps/desktop/src-tauri/tauri.conf.json`
(la misma que muestran `package.json` de raíz y de `apps/desktop`) debe
coincidir con el tag.

```powershell
# Release pública firmada (tag vX.Y.Z)
git tag v0.2.0
git push origin v0.2.0        # GitHub Actions corre release.yml

# Prueba manual SIN publicar (sólo para validar el runner; no es un release)
gh workflow run release.yml -f allow_unsigned=true
```

En un tag, además del build, el workflow crea/actualiza el GitHub Release con
`gh release create … --generate-notes` y adjunta:
`editor-ia-desktop.exe`, el instalador NSIS y `SHA256SUMS.txt`.

## 5. Versionado

- Fuente de verdad de la versión visible: `apps/desktop/src-tauri/tauri.conf.json`
  (`version`) — es la que muestra la app y el nombre del instalador.
- `package.json` (raíz) y `apps/desktop/package.json` deben llevar la misma
  versión. Hoy las tres están en **0.2.0**.
- Regla de tag: `vMAJOR.MINOR.PATCH` exactamente igual a `tauri.conf.json`.
  El workflow lo verifica y falla si no coinciden.
- Cambios incompatibles de proyecto (`project-schema`) y de formato de archivo
  de tema (`olyvia-theme` v1) tienen su propio versionado; no se atan al de la
  app salvo que se documente una migración.

## 6. Verificación de artefactos y firma

### 6.1 Hashes de la release actual (2026-11-03, 0.2.0)

| Artefacto | Ruta | Tamaño | SHA-256 | Firma |
|---|---|---|---|---|
| Ejecutable **firmado** (instalado / empaquetado en el NSIS) | `%LOCALAPPDATA%\Olyvia\editor-ia-desktop.exe` (la copia empaquetada vive en el `target-polish` del build de release) | 38.971.360 B | `4127E8C3EFD7EA39FE01C551890DFE0CC883AB9BE1583B90CE20859332C3883E` | `Valid` · `CN=Editor IA (Self-Signed), O=Editor IA` |
| Instalador NSIS **firmado** | `apps/desktop/src-tauri/target-polish/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe` | 166.227.272 B | `29AB73E6A7EE8BA17B5CE81956D1AC8273F8E3C7589958005550DBFFCBC5CBB2` | `Valid` · mismo self-signed |
| Ejecutable **sin firmar** del mismo build | `apps/desktop/src-tauri/target-polish/release/editor-ia-desktop.exe` | 38.969.856 B | `445D242E2EC5127100EE76CB4644407FD3F5855B3D88FC1AB9C8F4427915286D` | `NotSigned` |

El `.exe` sin firmar y el firmado difieren en **1.504 B** (firma Authenticode):
Tauri firma la copia que empaqueta en el NSIS. No son builds distintos.

Para reproducir el hash del instalador:

```powershell
Get-FileHash -Algorithm SHA256 'apps/desktop/src-tauri/target-polish/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe'
```

### 6.2 Verificar una firma en Windows

```powershell
# Estado de Authenticode (Valid = firma verificada y certificado en fecha)
Get-AuthenticodeSignature '.\Olyvia_0.2.0_x64-setup.exe' |
  Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate

# Cadena y sello de tiempo con el SDK de Windows (opcional)
signtool verify /pa /v '.\Olyvia_0.2.0_x64-setup.exe'
```

Qué buscar en una firma **real**:

- `Status = Valid` y `SignerCertificate.Subject` con la organización del
  certificado (no `Self-Signed`).
- `TimeStamperCertificate` presente (sin sello, la firma caduca con el cert).
- Cadena hasta una CA raíz de confianza de Microsoft.

### 6.3 Verificar el instalador y la app instalada

```powershell
# Instalación silenciosa (currentUser). Código de salida 0.
Start-Process -Wait -FilePath '.\Olyvia_0.2.0_x64-setup.exe' -ArgumentList '/S'
$exe = Join-Path $env:LOCALAPPDATA 'Olyvia\editor-ia-desktop.exe'
Get-Item $exe | Select-Object Length, VersionInfo
Get-FileHash -Algorithm SHA256 $exe
Get-AuthenticodeSignature $exe | Select-Object Status, SignerCertificate
```

Criterios: el archivo existe, la versión mostrada por la app coincide con el
tag, el hash coincide con `SHA256SUMS.txt` del release y la firma es `Valid`.

### 6.4 SmartScreen y máquina limpia

SmartScreen mezcla firma + reputación del firmante + historial de descargas del
archivo. Por eso:

- Con el certificado **self-signed** actual, SmartScreen **no** mejora.
- Con OV, la advertencia puede seguir apareciendo hasta acumular reputación.
- Con EV, la reputación es inmediata (no hay «Unknown publisher»).

La verificación definitiva se hace en una VM Windows 11 **limpia** (sin el
certificado instalado, sin historial de descargas):

1. Descargar el instalador y comprobar `SHA256SUMS.txt`.
2. Ejecutar: ¿aparece «Windows protegió su PC» / «Unknown publisher»?
3. Instalar con `/S`, abrir la app y verificar versión + funcionalidad mínima
   (launcher, abrir un proyecto demo, exportar un clip corto).
4. Registrar captura de SmartScreen y salida de `Get-AuthenticodeSignature` en
   la evidencia del release.

## 7. Workflow de CI: comportamiento y límites

- No se ejecuta desde el repo local: se valida el YAML y se corre en GitHub
  Actions. La validación offline de esta ola dejó **43/43 checks** y **20
  pasos** (script `.tmp-redesign/shell/validate-release.mjs`).
- `workflow_dispatch` sin secrets y con `allow_unsigned=true` sirve **sólo** para
  comprobar el runner; no publica release.
- Un tag `v*` sin secrets falla en el paso «Exige firma real antes de construir
  un release», con instrucciones de configuración.
- Los artefactos del workflow se retienen 30 días; el GitHub Release adjunta
  los binarios de forma permanente.
- No hay secretos, claves ni rutas absolutas de máquinas personales en el
  workflow. Las únicas rutas son relativas al workspace del runner
  (`target/release/...`) y `${{ runner.temp }}` para el PFX temporal.

## 8. Lo que falta para «firma real» (bloqueo externo declarado)

No es posible comprar/obtener el certificado desde este repo ni desde el
agente. Pendiente:

1. **Comprar el certificado OV/EV** (CA pública) y definir el método de firma en
   CI (PFX exportable o cloud/HSM con `signCommand`).
2. Configurar los secrets en GitHub (`WINDOWS_CERTIFICATE_BASE64`,
   `WINDOWS_CERTIFICATE_PASSWORD`) y la URL de timestamp.
3. Ejecutar un tag firmado real y verificar en Windows limpio (SmartScreen,
   instalación, versión, hashes).
4. Adjuntar la evidencia (capturas + salidas) a
   [`FOLLOW-UPS.md`](FOLLOW-UPS.md) §5 y actualizar este documento con el hash
   del artefacto firmado real.

Criterio de aceptación completo en [`FOLLOW-UPS.md`](FOLLOW-UPS.md) §5.
