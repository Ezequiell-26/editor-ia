# 2026-11-13 — Oleada 5 (parcial): progreso/cancel render_export + fix capas + extracción Inspector

## Qué se hizo

1. **Progreso + cancelación de `render_export`** (`88e0f5de`):
   - Worker (`apps/concat-worker`): `Request::Cancel` en protocolo,
     `run_with_progress` con hilo de render + `AtomicBool` chequeado por
     frame y entre fases (composite/audio/mux), eventos
     `render_export_progress` JSON-lines, `cancel_ack`, envelope
     `{"ok":false,"error":"render_export cancelled"}`, limpieza del MP4
     parcial y worker vivo después.
   - Desktop infra: stdin compartido `Arc<Mutex<ChildStdin>>`.
   - App: `request_with_events` + `cancel_render`.
   - Tauri: comando `concat_worker_cancel_render`, evento
     `concat-worker-progress` re-emitido.
   - Frontend: contratos, service adapter, fake-service, panel con barra
     de progreso, fase/frames y botón "Cancelar render".
   - Evidencia E2E real: 80 eventos de progreso en vivo (frames 0→160/600),
     `cancel_ack`, error cancelled, ping posterior OK.
   - Tests: worker 37/37, app concat_worker 18/18.

2. **Fix de capas (yo)**: `application/concat_worker.rs` llamaba a
   `crate::infrastructure::concat_worker::cancel_active_render()` →
   violaba `application/** no depende de infrastructure`. Solución:
   - `ports/concat_worker.rs`: nuevo trait `ConcatWorkerCancel`
     (`fn cancel(&self) -> bool`) y método
     `ConcatWorkerSession::cancel_token() -> Option<Arc<dyn ConcatWorkerCancel>>`.
   - Infra: `CancelToken` envuelve el `Arc<Mutex<ChildStdin>>`; se eliminó
     el global `ACTIVE_STDIN`/`cancel_active_render`.
   - App: estático propio `cancel_token()` (mutex APARTE del de sesión —
     cancel corre mientras el render tiene la sesión tomada), se pisa en
     cada spawn y se limpia al descartar sesión/shutdown.
   - Verificación: architecture-rules **13/13**, cargo check limpio,
     concat_worker **18/18** (incluye E2E de cancel real).

3. **Extracción Inspector** (`e28b09c3`): `ClipAudioFxSections.tsx` +
   `inspector/fields.tsx` nuevos; `Inspector.tsx` 8422→8043 líneas (−379).
   tsc limpio, tests verdes.

4. **Confirmado**: `App.teclado.test.tsx` 9/9 — la ambigüedad "Pausar"
   (SourceMonitor + MinimalEditor) quedó resuelta del todo.

## Detección de escenas → marcadores (`264ea2ad`)

La detección YA existía end-to-end (comando `detect_scenes` → FFmpeg
`select='gt(scene,X)',showinfo` → servicio → sección en Inspector con
"Dividir en N clips"). El delta real implementado:

- `src/state/markers.ts`: `markersFromCuts(project, frames)` — redondea,
  deduplica, ordena, salta existentes, respeta `MAX_MARKERS`, etiqueta
  `Corte N`.
- Inspector: botón "Crear N marcador(es)" junto a "Dividir en N clips".
- Tests: 3 en project-actions + 2 vitest de integración (fake-service) +
  5 tests nuevos de `media_analysis` con fakes + 1 live gated
  (`EDITOR_IA_RUN_RENDER_TESTS=1`) que genera video con 3 segmentos y
  verifica cortes exactos en frames [60,150].
- Evidencia: 137 vitest OK, tsc limpio, media::analysis 2/2,
  media_analysis live 6/6.
- Limitaciones: `run_ffmpeg` sin timeout (preexistente, compartido);
  markers son frames de timeline → asset sin colocar no puede generar
  marcadores; scdet no detecta corte entre campos de color planos
  (limitación del detector, no bug).

## Pendientes / límites honestos

- Cancel no interrumpe un `mix_to_file`/mux FFmpeg ya lanzado hasta el
  próximo boundary de fase.
- Worker/app con progreso+cancel deben empaquetarse juntos (protocolo
  nuevo no es retrocompatible con app vieja).
- UI de `speed_curve` sigue sin editor (contrato listo).
- concat-export/vision: fase 3 del ADR pendiente.
- HDR export: fuera de scope declarado.
- Commit/push: esperando autorización explícita.
