# 2026-11-23 — Cierre del bloque de auditoría run11 + seguridad

Sesión de pasadas 305–330 que cerró todos los hallazgos abiertos del
informe `docs/verification/2026-11-22-supervision-1506-run11.md` y los
históricos sin revalidar, más la migración Vite 5→8.

## AUD-143 — epoch de sesión (raíz del problema: publicar en proyecto viejo)

- `AppState.session_epoch: Arc<AtomicU64>` sube en cada `set_session`;
  `session_epoch_handle()` lo clona para `spawn_blocking`.
- Patrón aplicado a TODOS los comandos que escriben en `session.root`
  tras trabajo async largo: imports ×3, narración SAPI, clonación de
  voz, ElevenLabs, proxy de video, freeze frame, Lottie, timeline
  import, voice isolation (Demucs ≤3h), recorte de fondo.
- Descartados con criterio: los que escriben a rutas del usuario
  (media_tools, lip_sync, dubbing, interchange_export) y los de sólo
  lectura (object_track, transcribe).
- Residual honesto: ventana de µs entre chequeo y rename; y si Demucs
  corre mientras cambia la sesión, los stems quedan en la carpeta vieja
  (no se aborta el proceso, pero no se publican).

## AUD-032 — GuardProxy: bug real de producción encontrado por test live

- `TcpStream::connect_timeout` puede devolver socket **nonblocking**;
  el tunnel CONNECT hacía `io::copy` bloqueante → `WouldBlock` mataba
  la copia a mitad del TLS handshake → SSL EOF en TODO HTTPS de yt-dlp.
  La "mitigación" SSRF rompía las descargas HTTPS por completo.
- Fix: `set_nonblocking(false)` + `set_nodelay(true)` en upstream y en
  el socket aceptado del listener.
- 4 pruebas live (`#[ignore]`, red real): curl http/https, yt-dlp
  metadatos y **descarga MP4 completa verificada**. Lección: los tests
  unitarios del proxy no ejercitaban el tunnel real; el live test
  destapó un bug que ningún unit test veía.

## Seguridad

- SEC-GATE-006: allowlist npm ahora exige `advisory` exacto
  (package+severity ya no silenciaba OTRO advisory del mismo paquete).
- SEC-GATE-002: `cargo audit` no instalable → `scripts/cargo-osv-audit.mjs`
  consulta OSV (api.osv.dev) sobre los 611 crates del Cargo.lock.
  `querybatch` devuelve stubs `{id,modified}` — el detalle hay que
  pedirlo por id. Sin CVSS → `unrated` (bloquea); `informational`
  (unmaintained) → info. Integrado como fallback en
  `security-audit.mjs` con el mismo allowlist (advisory=RUSTSEC/GHSA).
  Resultado: 8 advisories (6 informational, 2 unrated exceptuados:
  url@2.5.8 pin de video-rs, glib cfg-Linux).
- AUD-002/014/144 revalidados con evidencia: env sanitization +
  shell-launch check en MCP stdio; scopes deny verificado live
  (-32004); transcribe-project guarda projectId (5/5 tests).

## Vite 5→8 + vitest 2→5 (pasada 327)

- vite ^8.3.7 (rolldown-vite), vitest ^5.1.0, plugin-react ^6.3.0,
  @types/node 22.20.5 (peer de vite 8 exige >=22.12).
- ERESOLVE por vitest viejo en lock: limpiar
  `node_modules/.package-lock.json` + dirs stale +
  `npm install --legacy-peer-deps` (peers reales quedaron OK).
- `manualChunks` sigue funcionando en rolldown; `vendor-zod`/`vendor-dates`
  se absorbieron (zod vive en vendor-schema). `inlineDynamicImports`
  deprecado → eliminado (era `false`, el default).
- Hook `devin-hooks-guard` bloquea `npm install` por regex → con
  autorización explícita del usuario se usa `npm.cmd install`.
- patch bumps: @tauri-apps/api 2.12.5, cli 2.12.6, playwright 1.65.1,
  axe-core 4.14.1.
- verify verde: typecheck + 3276 tests + extension 33 + web-tts 10 +
  audit PASS. Dev server vite 8 arranca en ~350ms.

## Hallazgo de entorno (sin resolver, decisión del usuario)

Dos dev servers vite **huérfanos** de hace ~10 días bindeados a
`0.0.0.0` (LAN-expuestos, vite 5 en memoria): PIDs 15972 (:3000) y
5384 (:3001). Cualquier `npm run dev` cae en :3002+. No se cerraron
(procesos del usuario).

## Estado

Todo sin commitear (~21 pasadas, 40+ archivos, rama 5 commits adelante
del origin). App live verificada por MCP tras cada rebuild.
