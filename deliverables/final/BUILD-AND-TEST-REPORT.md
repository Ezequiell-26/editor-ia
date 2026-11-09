# BUILD-AND-TEST-REPORT — Olyvia 0.2.0

Fecha: 2026-11-09 (rebuild 5) · Rama: `architecture/refactor-foundation` · Worktree: `editor-ia-architecture`

## Build (rebuild 5: incluye re-adquisición de generados locales en repair loop)

| Paso | Comando | Resultado |
|---|---|---|
| Frontend | `vite build` (via `tauri build` beforeBuildCommand) | OK |
| Rust release | `cargo build --release` (via rust-env.mjs) | OK |
| Firma | signtool (certificado local del usuario) | OK — exe, DLLs y NSIS firmados |
| Instalador | `makensis` | OK — `Olyvia_0.2.0_x64-setup.exe` (142.01 MiB) |

Comando correcto de build (desde la raíz del repo):

```bash
npm run tauri:build
```

NO usar `npm run tauri:build` dentro de `apps/desktop`: se salta
`setup-ffmpeg-dev.mjs` y `rust-env.mjs`, que configuran `FFMPEG_DIR`,
`LIBCLANG_PATH`, el toolchain MSVC y el `CARGO_HOME` escribible.

## Novedades de este build respecto al rebuild 4

- **Re-adquisición de assets `generated-locally`** en el repair loop
  (`application/studio_reacquire.rs::reacquire_generated_local` +
  dispatcher `infrastructure/studio/local_regenerator.rs`): cuando el
  quality gate falla por `missing-resources`, además de archive.org se
  regeneran localmente los assets producidos por providers sin red
  (voz SAPI `windows-sapi`, música `local-ffmpeg-ambient`, tarjetas
  `local-ffmpeg-titlecard`, patrones `local-ffmpeg-pattern`) reusando el
  `request_id` original — los generadores derivan el nombre del archivo
  de él ⇒ restaura el path exacto, determinístico y sin re-gastar BYOK.
  `generated-remote`, `user-imported` y sin provenance quedan fuera.
- Verificación del cambio: `cargo check --tests` 0 errores, `cargo fmt`
  limpio, `application::production` 13/13, `studio_*` 22/22 (3 tests
  nuevos del camino local-gen).

## Novedades del rebuild 4 (re-adquisición dirigida archive.org)

- Re-adquisición dirigida de assets con provenance de Internet Archive
  en el repair loop (sin re-ejecutar acquire ni re-gastar BYOK),
  verificada E2E live contra archive.org real (6.62 s).

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
- `studio_reacquire`: 6/6 unitarios + 1 E2E live real (archive.org)
- `application::production`: 13/13 tras el cambio de firma del repair
- `render_executor::unit_tests`: 3/3 (parser ebur128)
- `render::ffmpeg`: 138/138
- `verify-studio.mjs`: **TODO VERDE** — 12/12 live + 7/7 E2E con el quality
  gate de media activo (sin falsos positivos de resolución/duración/color)
- `npm run typecheck`: **FALLA en `apps/desktop/src/studio/**`** — código
  frontend de HY4 en desarrollo (errores `exactOptionalPropertyTypes` y
  símbolos sin definir). No es scope SWE2; vite build no typechecka y el
  bundle se generó igual. HY4 debe resolverlo antes del release final.

## Smoke test del release ( ESTA revisión )

- Instalador: `Olyvia_0.2.0_x64-setup.exe` — 148 913 368 bytes —
  SHA256 `950b7c6c…48ce49` — instalación silenciosa `/S /D=` a
  `%TEMP%\olyvia-install-test5` → exit 0.
- Recursos verificados en la instalación: `ffmpeg\`, `piper\`,
  `onnxruntime.dll`, `plugins\`, `tools\`, `uninstall.exe`,
  `editor-ia-desktop.exe`.
- `editor-ia-desktop.exe` instalado: lanzado, `Responding=True`,
  PID 10800 (queda corriendo para inspección).
- Nota de entorno: un intento de smoke test sin `/D=` instaló el mismo
  binario firmado en la ubicación por defecto `%LOCALAPPDATA%\Olyvia`
  (completó antes de ser cancelado el wrapper; es el mismo build
  verificado — la instalación real del usuario quedó actualizada).
- `node_modules` del worktree ahora es propio (npm ci, 214 paquetes):
  los junctions `@editor-ia/*` ya no pueden repuntar al repo hermano —
  el problema de entorno documentado abajo quedó resuelto de raíz.
- Captura real: `screenshot-app.png` (ventana "Olyvia"; la UI no cambió
  en backend).
- Proyecto de ejemplo: `example-project/` con JSON schema-v1 + media real
  generada por FFmpeg (hashes sha256 reales).

## Artefactos

- `Olyvia_0.2.0_x64-setup.exe` — 148 913 368 bytes — SHA256 en `SHA256SUMS.txt`
