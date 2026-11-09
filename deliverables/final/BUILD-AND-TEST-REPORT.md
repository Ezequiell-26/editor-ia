# BUILD-AND-TEST-REPORT — Olyvia 0.2.0

Fecha: 2026-11-09 (rebuild 4) · Rama: `architecture/refactor-foundation` · Worktree: `editor-ia-architecture`

## Build (rebuild 4: incluye re-adquisición dirigida en repair loop)

| Paso | Comando | Resultado |
|---|---|---|
| Frontend | `vite build` (via `tauri build` beforeBuildCommand) | OK — 510 módulos, 16.51 s |
| Rust release | `cargo build --release` (via rust-env.mjs) | OK — 12 min 21 s |
| Firma | signtool (certificado local del usuario) | OK — exe, DLLs y NSIS firmados |
| Instalador | `makensis` | OK — `Olyvia_0.2.0_x64-setup.exe` (142.06 MiB) |

Comando correcto de build (desde la raíz del repo):

```bash
npm run tauri:build
```

NO usar `npm run tauri:build` dentro de `apps/desktop`: se salta
`setup-ffmpeg-dev.mjs` y `rust-env.mjs`, que configuran `FFMPEG_DIR`,
`LIBCLANG_PATH`, el toolchain MSVC y el `CARGO_HOME` escribible.

## Novedades de este build respecto al rebuild 3

- **Re-adquisición dirigida en el repair loop**
  (`application/studio_reacquire.rs`): cuando el quality gate falla por
  `missing-resources`, el repair restaura en disco los assets con
  provenance de Internet Archive vía `ResourceAcquisition::acquire` —
  sin re-ejecutar la etapa acquire (no re-gasta providers remotos BYOK)
  y sin mutar el documento. Assets user-imported/generated-remote quedan
  `skipped` y el gate falla honestamente. Verificado E2E live contra
  archive.org real (descarga → borrado → restauración, 6.62 s).

## Novedades del rebuild 3 (quality gate de media + tags BT.709)

- **Quality Gate verifica el MP4 renderizado**: `media_findings` en la
  etapa `review` sondea el archivo real con ffprobe/ffmpeg y emite
  hallazgos tipados — `resolution` (dimensiones vs proyecto, error),
  `render-verify` (duración vs timeline, >2 s error / >0.5 s warning),
  `loudness` (LUFS integrado vs `quality.loudnessTargetLufs`, >3 LU error /
  >1 LU warning) y `color` (pix_fmt de entrega + tags de color).
- **Renders MP4/MOV etiquetados BT.709**: `-color_primaries/-color_trc/
  -colorspace bt709` + bitstream filter `h264_metadata`/`hevc_metadata`
  (los encoders LGPL del bundle no escriben el VUI completo; verificado
  con ffmpeg real: los 3 tags quedan en bt709).
- `MediaMeasure` expone `pixFmt`, `colorSpace`, `colorTransfer`,
  `colorPrimaries`.
- Tool MCP `quality_gate_review` (read-only, backend, catálogo 37 tools):
  agentes MCP pueden pedir el Quality Gate del proyecto abierto sin UI.
- Reparación: los hallazgos de media no son mecánicamente reparables —
  la corrida queda `failed` con el hallazgo explícito (comportamiento
  correcto del repair loop acotado).

## Problemas de entorno resueltos en esta sesión

1. **Junctions `node_modules/@editor-ia/*`** — **RESUELTO DE RAÍZ**:
   el `node_modules` del worktree compartido por junction con el repo
   hermano fue reemplazado por `npm ci` (214 paquetes, mismo lockfile,
   cero deps nuevas). Cada worktree resuelve ahora sus propios packages;
   los links `@editor-ia/*` no pueden repuntar más. (Histórico: los
   junctions NTFS se recreaban con `New-Item -ItemType Junction` — nunca
   `ln -s` de MSYS.)
2. **`CARGO_HOME` sin permisos**: `D:\DevCache\Rust\cargo` devuelve
   "Acceso denegado" al escribir el registry. `rust-env.mjs` ya resuelve esto
   usando `D:\Users\ofici\cargo-home`. Todo comando cargo debe pasar por
   `node scripts/rust-env.mjs --` con `CARGO_HOME=D:\Users\ofici\cargo-home`.
3. **`ffmpeg-sys-next` sin FFMPEG_DIR**: resuelto por `rust-env.mjs`
   (`D:\DevCache\ffmpeg-n9.0-lgpl\...` + libclang).

## Pruebas ejecutadas

- `cargo check --tests`: 0 errores · `cargo fmt --check`: limpio
- `studio_planner`: 12/12 · `remote_image`: 6/6 · `remote_voice`: 5/5
- `project_executor`: 8/8 · `studio::`: 81/81 · `production`: 13/13
- `studio_reacquire`: 3/3 unitarios + 1 E2E live real (archive.org)
- `render_executor::unit_tests`: 3/3 (parser ebur128)
- `render::ffmpeg`: 138/138
- `verify-studio.mjs`: **TODO VERDE** — 12/12 live + 7/7 E2E con el quality
  gate de media activo (sin falsos positivos de resolución/duración/color)
- `npm run typecheck`: **FALLA en `apps/desktop/src/studio/**`** — código
  frontend de HY4 en desarrollo (errores `exactOptionalPropertyTypes` y
  símbolos sin definir). No es scope SWE2; vite build no typechecka y el
  bundle se generó igual. HY4 debe resolverlo antes del release final.

## Smoke test del release ( ESTA revisión )

- Instalador: `Olyvia_0.2.0_x64-setup.exe` — 148 959 936 bytes —
  SHA256 `25c6d274…b0216b` — instalación silenciosa `/S /D=` a
  `%TEMP%\olyvia-install-test4` → exit 0.
- Recursos verificados en la instalación: `ffmpeg\`, `ffmpeg-dll\`,
  `piper\`, `onnxruntime.dll`, `tools\yt-dlp.exe`, `plugins\`,
  `uninstall.exe`, `editor-ia-desktop.exe`.
- `editor-ia-desktop.exe` instalado: lanzado, `Responding=True`,
  ventana "Olyvia", PID 27972 (queda corriendo para inspección).
- `node_modules` del worktree ahora es propio (npm ci, 214 paquetes):
  los junctions `@editor-ia/*` ya no pueden repuntar al repo hermano —
  el problema de entorno documentado abajo quedó resuelto de raíz.
- Captura real: `screenshot-app.png` (ventana "Olyvia"; la UI no cambió
  en backend).
- Proyecto de ejemplo: `example-project/` con JSON schema-v1 + media real
  generada por FFmpeg (hashes sha256 reales).

## Artefactos

- `Olyvia_0.2.0_x64-setup.exe` — 148 959 936 bytes — SHA256 en `SHA256SUMS.txt`
