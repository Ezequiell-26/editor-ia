# 2026-11-22 — Física de cuerpos rígidos 2D (kind `rigid`) en stickman

## Qué se hizo

Se cerró el gap "física de cuerpos rígidos pendiente" del motor stickman
con un solver propio determinista en
`apps/desktop/src-tauri/src/media/stickman/particles.rs` — sin crate de
física externa, mismo esquema de dt fijo + memoización por hilo que el
resto de partículas.

- Cuerpos: cajas con `hw`/`hh` (4–13 × 2–8 px), masa desde área,
  inercia de caja, semilla hash determinista (posición, tamaño, tilt,
  velocidad, ω iniciales).
- Contactos: SAT caja-caja (4 ejes, impulso con masa reducida + torque
  en el punto de contacto, fricción tangente Coulomb `RIGID_MU`),
  paredes del lienzo con esquina más penetrante como punto de contacto.
- Orden del solver: pares → paredes, 3 iteraciones por paso; el peso de
  la pila no re-inyecta velocidad descendente tras el piso.
- Sleep: |v|<12 px/s y ω<1 con apoyo real (piso o vecino a ≤2 px vía
  `rigid_near` — el slop deja contactos sin solape estricto). Wake por
  impacto relativo >15 px/s. ≥90% dormidos → freeze total de la escena
  y salto del reloj de simulación (early-exit determinista).
- `RIGID_MAX_BODIES = 40`: más cuerpos forman pilas multicapa que el
  solver lite no asienta (rocking perpetuo); es un set-piece, no un
  sistema de escombros.
- Spec: `gravity`, `bounce` (restitución), `spin` (escala ω inicial).
  Render: raster por pixel con desrotación a coords locales.

## Superficies tocadas

`stickman.rs` (kind + validación), `mcp-catalog.ts` (descripción +
count máx 40), `StickmanPanel.tsx` (selector + sliders de física),
`integrations.ts` (contrato), `docs/CAPABILITY-MATRIX.md` (§7.8 y
filas 50-51 actualizadas a HECHO-lite).

## Evidencia

- `cargo test -p editor-ia-desktop --lib stickman` → **20/20**
  (incluye `rigid_bodies_are_deterministic_and_settle` y
  `rigid_collisions_transfer_momentum`).
- `cargo check` OK · `cargo fmt --check` limpio · `npm run typecheck` 0.
- `clippy -D warnings` **no corrió**: os error 32 (build script en uso
  por el exe live) — ambiental, no del cambio.
- Rebuild `tauri:build:debug` 6m40s → app PID 3208 → MCP `app_status`
  OK y `tools/list` muestra `rigid` en el enum de `stickman_render`.

## Lecciones / límites honestos

- Un solver impulse-based lite **no asienta pilas densas**: el rocking
  sobre aristas es un modo estable que sólo el sleep (con criterio de
  apoyo) resuelve. Subir `count` más allá de ~40 vuelve a fallar el
  asentamiento — por eso el tope.
- El criterio "apoyo" necesita tolerancia de gap (2 px): exigir solape
  SAT estricto deja cuerpos en contacto de reposo sin calificar para
  dormir.
- Sin juntas, sin cóncavos, sin CCD: declarado en la matriz como
  "HECHO (lite)", no como engine de física completo.

## Siguiente paso sugerido

Si se quiere más cuerpo: `rigid` con formas no-caja (círculos/segmentos)
o registrar el resultado en un render real E2E vía MCP
(`stickman_render` con kind=rigid → qc_media del mp4).

## Verificación E2E en vivo (post-rebuild)

- `stickman_render` MCP (scope `destructive`) con
  `particles:{kind:"rigid",count:24}` → MP4 real 320x240@12fps, 24
  frames, `verified:true` (ffprobe). Path:
  `%TEMP%/stickman-rigid-e2e.mp4`.
- `qc_media` reporta `blacks` 0→1.92 s: **falso positivo por luma** —
  el fondo es negro y los cuerpos son chicos; medición directa del
  frame t=1 s: `YMAX=248` (hay píxeles brillantes: huesos + cajas
  doradas), `YAVG=35`. Contenido presente; qc_media es sensible a
  escenas oscuras con acentos pequeños. No es defecto del solver.
- El test `each_particle_kind_renders_pixels` ya cubre que `rigid`
  dibuja píxeles (conteo de color > umbral).
