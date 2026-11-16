# 2026-11-13 — Oleada 4: render_export visible + speed curves + crossfade + perf CI

## Qué se hizo

1. **UI render_export** (`465ebee5`): `ConcatWorkerExportPanel.tsx` nuevo
   en ExportDialog — formulario manual honesto (clips path/in/duration/
   fit/audio/speed/transition, canvas, fps, codec h264→vp9-alpha), estado
   real del worker, validación local, envelope con "Abrir carpeta".
   Limitación declarada: request síncrona 10min, sin progreso/cancelación.
   19/19 tests, tsc limpio.

2. **Speed curves + audio crossfade** (`95f66db9`): protocolo del worker
   acepta `speed_curve` (puntos at/speed/slope — misma semántica que
   concat_project::SpeedPoint; slope en todos → Hermite, si no → líneas)
   y `transition.audio_crossfade` (default ON). Reusa
   `concat_core::SpeedCurve`. Audio de curva = aproximación escalonada
   ~8 pasos/seg vía tempo/atempo. Crossfade verificado con volumedetect:
   dips −34.5→−41.8 dB en la ventana y vuelve; opt-out funciona.
   34/34 worker + 14/14 app.

3. **ADR concat-export/vision** (`32707d6f` → yo persistí):
   `docs/decisions/2026-11-13-concat-export-vision.md`. Van en el worker,
   no en la app (links="ffmpeg"); vision sin infer primero; mapeo
   pragmático de ExportClip; ort ya está en la app para u2netp.

4. **perf-nightly.yml** (yo): job nocturno 06:00 UTC + dispatch; mide 2
   veces en el mismo runner (--update luego --check) porque el baseline
   commiteado no es comparable entre máquinas. README §4 actualizado.

5. **Contrato TS** (yo): `speed_curve`, `audio_crossfade`,
   `audio_crossfades`/`speed_curves` en result — paridad con protocolo.

## Verificación cruzada final

- tsc desktop: limpio
- vitest panel/card/export: 19/19
- cargo test concat-worker: 34/34
- cargo test -p editor-ia-desktop concat_worker: 14/14
- architecture-rules: 13/13 · ci-workflows: 12/12

## Pendientes

- Panel no expone speed_curve en UI (contrato listo; editor de curva
  queda para próxima iteración).
- concat-export/vision: fase 3 del plan (vendorizar crates del upstream
  concat-ref en D:\Users\ofici\QODER-WORK\concat-ref).
- Worker sin progreso ni cancelación de render_export.
- MinimalEditor mezcla PT/ES (deuda i18n anotada).
