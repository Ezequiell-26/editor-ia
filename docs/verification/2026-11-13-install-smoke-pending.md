# Install smoke pendiente — estado del pipeline de empaquetado

Fecha: 2026-11-13. Estado: **el instalador nunca se instaló ni se abrió en una
máquina limpia**. Este documento registra qué garantiza hoy el pipeline y el
procedimiento exacto del smoke real que falta.

## 1. Qué cubre el pipeline hoy (verificado estáticamente)

Cadena: `scripts/package-windows.ps1` (local) y
`.github/workflows/windows-package.yml` / `release.yml` (CI).

Antes de `tauri build` ambos caminos ahora corren
`node scripts/check-bundle-resources.mjs`, que compara cada fuente declarada
en `bundle.resources`, `bundle.icon` y las imágenes NSIS de
`apps/desktop/src-tauri/tauri.conf.json` contra el filesystem. Falla en
segundos, no a los ~20 min del bundler.

Contenido esperado del bundle (contrato con el código):

| Recurso en el instalador | Origen | Consumidor |
|---|---|---|
| `editor-ia-desktop.exe` + frontend | build Tauri | la app |
| `avcodec-63.dll`, `avformat-63.dll`, `avutil-61.dll`, `avfilter-12.dll`, `avdevice-63.dll`, `swscale-10.dll`, `swresample-7.dll`, `FFMPEG-LICENSE.txt` (raíz del resource dir = junto al exe en Windows) | `resources/ffmpeg-dll/*` vía `setup-ffmpeg-dev.mjs` | `video-rs`/`ffmpeg-sfx` y `infrastructure::concat_worker::ffmpeg_dll_dirs()` |
| `ffmpeg/` (ffmpeg.exe, ffprobe.exe, licencias GPL) | `resources/ffmpeg/*` vía `ci-bundle-resources.sh` | transcodes/probes |
| `concat-worker/concat-worker.exe` | `apps/concat-worker/target/release/` (compilado antes de `tauri build`) | `resolve_worker_path()` busca `<exe_dir>/concat-worker/concat-worker.exe` |
| `tools/yt-dlp.exe`, `onnxruntime/onnxruntime.dll`, `piper/`, `sfx/`, `plugins/`, `extension/editor-ia-downloader/`, `watermark.png`, `THIRD-PARTY-NOTICES.txt` | `ci-bundle-resources.sh` + generados + git | features de la app |
| Modelos whisper | **NO se empaquetan** (descarga on-demand) | — |

### Gaps corregidos en esta pasada

1. `resources/sfx/` no estaba versionado ni generado en CI → el bundler podía
   fallar o dejar la app sin efectos. Ahora `ci-bundle-resources.sh` corre
   `node scripts/generate-sfx.mjs` (síntesis determinista, sin licencias de
   terceros) y `package-windows.ps1` también lo genera.
2. `package-windows.ps1` corría `tauri build` sin `--no-sign` aunque
   `tauri.conf.json` declara `certificateThumbprint`: en una máquina sin ese
   certificado el build podía intentar firmar y fallar. Ahora usa `--no-sign`,
   igual que el camino unsigned de CI.
3. No había verificación estática de recursos: un path mal escrito en
   `tauri.conf.json` o un binario sin compilar sólo se descubría en el bundler.
   Nuevo `scripts/check-bundle-resources.mjs` (usado por el script local y por
   ambos workflows).
4. `package-windows.ps1` no provisionaba recursos en una máquina fresca.
   Nuevo switch `-Provision` que corre `setup-ffmpeg-dev.mjs` +
   `ci-bundle-resources.sh`; sin él, el preflight falla con el comando exacto
   que falta.

### Riesgos residuales conocidos

- `ci-ffmpeg-dev.sh`/`setup-ffmpeg-dev.mjs` dependen de un FFmpeg dev shared
  (BtbN en CI, `D:\DevCache` o `EDITOR_IA_FFMPEG_DEV` en local). Sin él no hay
  `ffmpeg-dll/` ni compilación de `video-rs`: es un bloqueo de entorno, no del
  pipeline.
- La firma Authenticode real sigue pendiente de certificado OV/EV
  (`docs/RELEASE.md` §8). Los NSIS de CI/tag son self-signed o sin firma.
- `resources/test/clonacion.wav` está versionado pero **no** se declara en
  `bundle.resources`: no viaja en el instalador (intencional, es fixture).

## 2. Procedimiento del install smoke (pendiente, una vez por build candidato)

Requisito: instalador `Olyvia_<version>_x64-setup.exe` > 1 MB producido por
`windows-package.yml` (artefacto `editor-ia-windows-x64-unsigned`) o por
`release.yml` firmado.

```powershell
# 1. Descargar/verificar artefacto y SHA256SUMS si viene de release.yml.
# 2. Instalar (currentUser, sin elevación). /S = silencioso.
Start-Process -Wait -FilePath '.\Olyvia_0.2.0_x64-setup.exe' -ArgumentList '/S'

# 3. Verificar que el bundle instaló TODO lo declarado:
$dir = Join-Path $env:LOCALAPPDATA 'Olyvia'
$exe = Join-Path $dir 'editor-ia-desktop.exe'
$worker = Join-Path $dir 'concat-worker\concat-worker.exe'
Get-Item $exe, $worker | Select-Object FullName, Length
Get-ChildItem $dir -Filter 'av*.dll' | Select-Object Name   # 5 DLLs en raíz
Test-Path (Join-Path $dir 'ffmpeg\ffmpeg.exe')
Test-Path (Join-Path $dir 'tools\yt-dlp.exe')
Test-Path (Join-Path $dir 'piper\piper.exe')
Test-Path (Join-Path $dir 'onnxruntime\onnxruntime.dll')
Get-ChildItem (Join-Path $dir 'sfx') -Filter '*.wav' | Measure-Object
Get-ChildItem (Join-Path $dir 'plugins') -Directory | Select-Object Name
Get-ChildItem (Join-Path $dir 'extension\editor-ia-downloader') -Filter 'manifest.json'
# NO deben existir modelos whisper en el instalador (on-demand).
Get-ChildItem $dir -Recurse -Filter '*.onnx' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'piper' }   # sólo la voz de Piper es esperada

# 4. Abrir la app y hacer el golden path mínimo:
#    a. Arranca sin crash (webview + splash).
#    b. Crear/abrir un proyecto básico con un clip de prueba.
#    c. Exportar un clip corto (ejercita ffmpeg.exe + concat-worker).
#    d. En DevTools/consola: `concat_worker_status` debe reportar el worker
#       disponible (no "no está compilado ni empaquetado").
#    e. Cerrar la app: el shutdown hook responde {"op":"shutdown"} al worker
#       sin dejar procesos huérfanos (verificar en el Administrador de tareas).

# 5. Desinstalar y verificar limpieza:
#    Get-ChildItem "$env:LOCALAPPDATA\..\Local\Olyvia" debe desaparecer;
#    el desinstalador NSIS queda en el menú Inicio/Configuración.
```

Criterio de aceptación: instalador > 1 MB, todos los paths del paso 3
presentes, golden path completo sin crash, worker responde y se apaga limpio,
desinstalación sin residuos.

## 3. Rollback

- Los cambios de esta pasada son todos en scripts/config: revertir el commit
  restaura el comportamiento anterior. No tocan código de `apps/` ni `src`.
- Si un build con estos cambios falla, el preflight
  (`node scripts/check-bundle-resources.mjs`) dice exactamente qué fuente
  falta; `package-windows.ps1` sin `-Provision` no descarga nada.
- El instalador previo (si existiera artefacto) no se ve afectado: cada build
  produce un NSIS nuevo e independiente.
