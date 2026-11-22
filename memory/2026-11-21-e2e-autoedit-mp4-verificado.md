# E2E real: media cruda → auto-edit IA → MP4 verificado (2026-11-21)

## Qué se hizo

Prueba de fuego del pipeline autónomo contra la app corriendo (PID 5268)
via su servidor MCP embebido en `http://127.0.0.1:31417/mcp` (477 tools).

Flujo ejecutado con tools reales de la app:

1. `project_new` → proyecto "AutoEdit E2E voz" en `%TEMP%/autoedit-e2e/app-project`.
2. `tts_synthesize` voz `basic-female` → `narration.wav` (TTS local).
3. `asset_import` ×4 (A/B/C/speech.mp4 generados con FFmpeg controlado:
   escenas, silencios, negros, freezes, energía de audio variable).
4. `transcribe_asset` Whisper `small` nativo → 3 segmentos ES
   (calidad sobre voz sintética limitada — honesto, no producción).
5. `auto_edit_build` con `MediaAnalysis` de FFmpeg real → variantes.
6. `project_variant_write` → `e2e-custom.editoria.json`:
   17 clips / 45.53 s / 16 transiciones / 6 zooms / 1 caption — schema-válido.
7. `render_start` + `render_active` → `out-app-custom.mp4` 3 262 639 B.

## Bloqueos encontrados y resueltos

- **`export_profiles` → []**: `createEmptyProject` deja `renderProfiles: []`;
  sólo la UI los puebla (`syncNativeProfile`/`ensureDelivery` en
  `delivery-actions.ts`). Fix del test: inyectar profile con la shape de
  `makeDeliveryProfile`. **Brecha de producto**: flujo autónomo sin UI no
  tiene camino para crear profiles — candidato a tool MCP o a que
  `project_new`/`auto_edit_prepare` llamen `ensureDelivery`.
- **`ASSET_NOT_READY`**: gate de integridad exige sha256+bytes reales del
  archivo; los fixtures tenían valores falsos. Parche con hash real.
- **Scope MCP**: tools destructivas requieren header
  `x-olyvia-scopes: read,write,destructive` (jerarquía read<write<destructive).

## Resultado verificado del MP4

- `verify_export`: mp4/h264/yuv420p 640×360@30, AAC 48 kHz estéreo, bt709,
  **0 warnings**, duración exacta 45.533 s.
- ebur128: **-12.8 LUFS** integrados, true peak **-1.9 dBFS** — improveAudio
  del pipeline aplicado (gain/comp/EQ medidos sobre fuentes).
- Captions: pedidos con `includeCaptions:true`, sin stream muxado → quemados;
  verificación visual pendiente.

## Aprendizajes reutilizables

- Cliente MCP mínimo: POST JSON-RPC a `/mcp`, header Authorization Bearer
  (token en `%APPDATA%/com.editoria.desktop/automation.json`) + header
  `x-olyvia-scopes`. Script de referencia: `%TEMP%/autoedit-e2e/mcp-call.mjs`.
- `transcribe_asset` y `tts_synthesize` funcionan local sin providers.
- `render_start` devuelve jobId inmediato; pollear `render_active` hasta
  `jobId:null`.

## Archivos tocados

- `docs/IMPROVEMENT-QUEUE.md` — pasada 267 con el detalle completo.
- `memory/2026-11-21-e2e-autoedit-mp4-verificado.md` — esta nota.
- Artefactos de test en `%TEMP%/autoedit-e2e/` (proyecto, variantes, MP4,
  narración, frames) — temporales, no del repo.

## Siguiente paso honesto

- QC post-render dedicado sobre el MP4 (verify_export cubre contenedor/
  códec/duración; falta chequeo de cuadros negros/congelados en salida).
- Cerrar la brecha `renderProfiles` para flujos autónomos.
- Probar con material de habla real para medir calidad de speechCuts.

## Addendum — fix renderProfiles (pasada 268)

Cerrada la brecha detectada: `project_new` con `directory` en `mcp-tools.ts`
ahora aplica `ensureDelivery()` tras fijar el canvas. Test de regresión en
`mcp-tools.test.ts` (70/70), tsc y vite build verdes. El binario en ejecución
sigue con el código viejo hasta el próximo build.

## Addendum 2 — auto-edit por MCP (pasada 269)

Motor de variantes reubicado de features/ a state/ (autoedit-engine/apply/
export/director) y expuesto como tools MCP: autoedit_measure (mide + arma
variantes, sesión por proyecto), autoedit_variants (rebuild con otra receta),
autoedit_apply (monta la timeline). Pipeline autónomo completo por MCP.
Verificado: tsc, 71/71 mcp-tools, 44/44 autoedit, 30/30 cargo mcp, vite build.

## Addendum 3 — qc_media (pasada 270)

Nuevo comando `qc_media_file` + service `qcMediaFile` + tool MCP `qc_media`:
QC de contenido (escenas/silencios/negros/freezes/loudness) sobre archivos
sueltos sin proyecto. Reusa measure_media del dominio intelligence.
Verificado: cargo check/fmt, tsc, 83/83 tests MCP.

## Addendum 4 — autoedit_export (pasada 271)

Tool MCP `autoedit_export` (destructive): batch render de variantes medidas a
MP4 sin tocar el proyecto. Cierra el pipeline autónomo:
measure → apply | export → render/verify/qc.

## Addendum 5 — validación en vivo (pasada 275)

Build debug nuevo + app relanzada. qc_media, autoedit_measure/variants/
apply/export todos funcionando en vivo contra medios reales. Hallazgos:
freezes detectados en export anterior (~13 s en 45 s) y true peak +0.3 dBFS
en el export con improveAudio — dos candidatos de calidad documentados.

## Addendum 6 — loudness fix verificado en vivo (pasada 276)

applyAutoEditVariant con improveAudio ahora setea audio.loudnessTarget
(-14/TP-1) + master.limiter → loudnorm+alimiter en export. Verificado:
-7.6→-13.7 LUFS, TP +0.6→-0.3 dBFS. OJO: dist va embebido en el exe —
cambios TS requieren tauri:build:debug, no sólo vite build.

## Addendum 7 — freezes diagnosticados (pasada 277)

Los freezes reportados por qc_media en el export custom son segmentos
estáticos reales heredados de las fuentes fixture (barras de color), no
defecto del render. Verificado con frames pixel-idénticos + freezedetect
sobre fuentes.

## Addendum 8 — transcripción real verificada (pasada 279)

Whisper local transcribió speech.mp4 → captions en variantes → export con
cues → qc_media limpio (-13.8 LUFS/TP-1.6). Pipeline 100% E2E en vivo.
Precisión del modelo sobre el fixture TTS es limitada — calidad, no pipeline.

## Addendum 9 — build final verificado (pasada 281)

Exe con TODOS los fixes del frente corriendo. variant_file_name verificado:
historia.editoria.json. Pipeline autónomo completo live.

## Addendum 10 — build con hardening MCP (pasada 287)

Exe actualiza con cuts/subset/rechazos/status/warnings. autoedit_status
verificado en vivo. Superficie MCP autoedit completa y endurecida.

## Addendum 11 — multicam_build + vitest 2.1.9 (pasada 288)

multicam_build ahora devuelve ignoredAssetIds y el error nombra ids
inexistentes. vitest 2.1.9 ya instalado por el usuario; security-audit
npm PASS. Pendiente: migración vite 5→8 (sólo-dev).

## Addendum 12 — AUD-032 cerrado con GuardProxy (pasada 289)

yt-dlp ya no conecta directo: GuardProxy local (127.0.0.1:0) valida cada
CONNECT/URI con net_guard y fija la IP (sin TOCTOU). Cableado en download,
probe, source_metadata y youtube_analytics. Proxy de usuario sigue ganando.
Tests: 8 nuevos, 71/72 downloader. Pendiente: rebuild exe.

## Addendum 13 — rebuild con GuardProxy live (pasada 290)

Exe 8m16s, app PID 10588, MCP verificado (autoedit_status OK). GuardProxy
compilado y cableado en los 4 call sites de yt-dlp; validación real
pendiente de la primera descarga del usuario.

## Addendum 14 — commit fdf4c226 + source monitor pin (pasada 292)

WIP completo commiteado (438 archivos). Source monitor v1: pinMediaSpy
fija el asset en el monitor (clic/Escape), bloquea hover ajeno y scrub
cruzado. Sin transporte propio todavía. TS-only → próximo rebuild.
