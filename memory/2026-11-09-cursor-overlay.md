# 2026-11-09 — Cursor estilizado en grabaciones (gap AlaukCut #1)

## Qué se hizo

Implementación nativa (Rust + Tauri + ffmpeg) del cursor estilizado con
indicador de clicks que AlaukCut ofrece en sus grabaciones de tutorial.
Código 100% propio — no se copió nada de AlaukCut.

## Arquitectura

```
screen_record_start(cursorOverlay={style,color,scale,ripple})
  ├─ valida spec + exige captureTarget=="desktop"
  ├─ gdigrab con -draw_mouse 0 (no duplicar cursor del sistema)
  └─ CursorTracker (hilo): GetCursorPos + GetAsyncKeyState c/15ms
        → Vec<CursorSample{t_ms,x,y,click}>

screen_record_stop
  ├─ cierra ffmpeg (q por stdin) + ffprobe → width/height/duration
  └─ si hubo overlay:
       generate_cursor_ass(samples, spec, vw, vh, virtual_screen(), total_ms)
         → screen-TS-cursor.ass   (se conserva junto al mp4)
       ffmpeg -i rec.mp4 -vf ass=filename='…-cursor.ass'
              -c:v libx264 -crf 18 -c:a copy → tmp → rename
       ScreenRecordResult.cursorBurned / warning
```

Piezas clave en `screen_record/cursor_track.rs`:

- `CursorOverlaySpec` (serde camelCase): style `flecha|punto|cruz`,
  color `blanco|negro|amarillo|verde`, scale `0.5|1|2`, ripple bool.
- `keyframes()`: decimación — nuevo punto si ≥3 px o ≥80 ms.
- `shape_drawing()`: polígono flecha, anillo+punto (winding opuesto =
  hueco en fill nonzero), cruz de dos rectángulos. Todo en coordenadas
  relativas al hotspot.
- `ripple_drawing()` + `\fad`/`\t` en el Dialogue: anillo que crece 130 %
  y se desvanece en 450 ms; tamaño varía por botón (izq 1.0 / der 0.8 /
  central 0.9).
- `to_video_xy()` + `sys::virtual_screen()` (SM_X/Y/CX/CYVIRTUALSCREEN):
  mapeo escritorio virtual → píxeles de vídeo, robusto en multi-monitor.
- `ass_filter_arg()`: escape `\`→`/`, `:`→`\:`, `'`→`\'` — verificado con
  path absoluto `D\:/…` real contra ffmpeg.

## Verificación

- `cargo test cursor` → 9/9 (incluye map multi-monitor, escape, estilos).
- `cargo check` → limpio.
- `npm run typecheck` → limpio.
- `vitest RecordView.test.tsx` → 4/4.
- Smoke ffmpeg real: `ass=filename='D\:/Users/…/cursor.ass'` quema OK.

## Decisiones y límites honestos

- Segundo pase de codificación (no se puede inyectar en gdigrab vivo);
  coste = re-encode x264 veryfast crf 18 del MP4 final.
- Sólo `desktop`: en `window`/`region` el origen frame↔cursor no es
  fiable → validación lo rechaza con error claro.
- No-Windows: tracker no spawnea, samples vacío, no se quema nada.
- Escenas OBS no persisten cursorOverlay todavía (`None` en obs_scenes).
- El .ass queda como sidecar (`*-cursor.ass`) por si el usuario quiere
  retocar los tiempos a mano.

## Siguiente

Gaps AlaukCut pendientes en orden: tracking de objeto/cabeza (ONNX),
auto-reframe, marcos de monitor, interpolación RIFE. Detalle en
`docs/reference/ALAUKCUT-GAP-ANALYSIS-2026-11-09.md`.
