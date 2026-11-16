# Regla permanente del usuario (2026-11-09)

- "Sigue" = continuar la cola de mejora SIN preguntar qué tocar.
- Siempre aprender de AlaukCut y CapCut antes de mejorar.
- Cuando el material leído se agote → volver a REA/Ghidra (motorcpp.pyd,
  videoeditor.dll strings/recursos) para seguir extrayendo arquitectura.
- La app nunca se estanca: cada ciclo deja una mejora verificable +
  conocimiento guardado en docs/reference/ y memory/.
- Orden de cola vigente: molduras → GPU-loss → atajos kf → tracking →
  auto-reframe → RIFE.

## Estado al cierre 2026-11-09 (tarde)

Hecho y verificado: safe-area, cursor+clicks (Rust/ASS/ffmpeg), Bézier 13
presets + overshoot, copy/paste keyframes (clipboard module + botones),
perspective drag en preview (`PerspectiveHandles` + `perspective-handles.ts`),
**molduras 19 presets** (`clip.monitorFrame` + `MonitorFrameSvg` preview +
Inspector + copiar/pegar atributos).

Pendiente inmediato: **quemar monitorFrame en MP4**. El plan está en
docs/IMPROVEMENT-QUEUE.md sección "Plan pendiente". Pistas: `geq` SDF como
visual/masks.rs, o PNG overlay dentro del clip chain antes del transform.
Luego: GPU-loss render-worker, atajos kf, tracking, auto-reframe, RIFE.
