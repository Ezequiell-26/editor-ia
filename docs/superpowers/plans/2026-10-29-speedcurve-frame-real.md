# SpeedCurve + Frame real compuesto — Plan de implementación

**Estado:** implementado y verificado el 2026-10-29 (ver `CHANGELOG.md` y
`docs/IMPROVEMENT-QUEUE.md`); los checkboxes se conservan como registro del
plan original.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** consumir `speedCurve` de punta a punta (preview y export, sin renderizar 1× en silencio) y que “Frame real” componga también clips gráficos con su plan de motion.

**Architecture:** un muestreador canónico de remap por frame (TS y Rust con el mismo fixture), un `setpts` por frame derivado de la inversa numérica de la integral de velocidad, y la ventana de preview que conserva los gráficos activos y recibe los `motionPlans` del frontend. El render existente no se reemplaza: se le agrega el caso `speedCurve` y se reutiliza `build_motion_ass`.

**Tech Stack:** TypeScript, Zod, React, Vitest, Rust, serde_json, FFmpeg (filtros `setpts`, `fps`, `minterpolate`), Tauri 2.

**Spec:** `docs/research/TIME-REMAP-FRAME-2026-10-26.md` (con las correcciones de este plan: la inversa lineal por tramo no es exacta).

## Global Constraints

- No GPL/AGPL/PolyForm/Remotion. No nuevas dependencias: FFmpeg ya está bundleado; los candidatos MIT (`cube-lut.js`, `glsl-lut`, three.js) no resuelven el remap y no se agregan.
- No commit, push, build Tauri ni instalación sin autorización.
- No tocar proyectos, medios ni resultados del usuario.
- Mantener el modelo canónico: `durationFrames`, `source.inFrame/outFrame` y `speed` existentes no cambian de significado.
- `speedCurve` se normaliza a la ventana real (`outFrame - inFrame`), así un documento viejo con curva decorativa sigue abriendo y no queda 1×.
- Un clip con `speedCurve` + `reverse`, `stabilization`, `motion`, keyframes de transform/máscara o `transitionIn` se rechaza con error claro.
- `audio` no lleva `speedCurve` (lo impone el esquema).

---

### Task 1: Muestreador TS + fixture compartido

**Files:**
- Create: `apps/desktop/src/state/time-remap.ts`
- Create: `apps/desktop/src/state/time-remap.test.ts`
- Create: `packages/project-schema/fixtures/time-remap.fixture.json`

**Interfaces:**
- Produce: `buildTimeRemap(curve, durationFrames, sourceFrames)` → `{ sourceFrameAt(local), sourceSecondsAt(local, inFrame, fps), setpts? }`.
- Consume: puntos `{ t, speed, easing?, bezier? }` del esquema.

- [ ] Test golden: D=100, S=88, puntos `(0,0.5)(0.5,0.5)(1,2)` → `sourceFrameAt(60)=32`, monótono, `sourceFrameAt(0)=0`, `sourceFrameAt(99)<88`.
- [ ] Implementar integrales cerradas por easing: linear `1/2`, ease-in `1/4`, ease-out `3/4`, ease-in-out `1/2`, hold `0`; Bézier con polilínea de 64 tramos.
- [ ] Normalizar `scale = sourceFrames / (D * integralTotal)` y muestrear al centro `σ((k+0.5)/D)`.
- [ ] Curva constante 1× debe dar exactamente los mismos frames que el camino actual.
- [ ] Verificar: `npx vitest run apps/desktop/src/state/time-remap.test.ts`.

### Task 2: Esquema compatible

**Files:**
- Modify: `packages/project-schema/src/timeline.ts` (invariante de duración)
- Test: `packages/project-schema/src/timeline.test.ts`

- [ ] Test: un clip con `speedCurve` y `durationFrames != sourceFrames` parsea (curva normalizada).
- [ ] Test: sin `speedCurve`, la igualdad exacta sigue rechazando.
- [ ] Saltar la igualdad sólo si `kind === 'video' && speedCurve !== undefined`; `speed` + `speedCurve` sigue prohibido.
- [ ] `npm run schema:generate` y verificar que el JSON Schema no cambia de forma.

### Task 3: Preview e Inspector consumen el remap

**Files:**
- Modify: `apps/desktop/src/features/editor/Preview.tsx` (VideoLayer y AudioLayer)
- Modify: `apps/desktop/src/features/editor/Inspector.tsx` (muestreo de color)
- Test: `apps/desktop/src/features/editor/time-remap-preview.test.ts` (nuevo, unidad pura)

- [ ] `sourceSeconds` de video: si hay `speedCurve`, usar `sourceFrameAt(local)`; audio sigue lineal.
- [ ] Memoizar la tabla por `(speedCurve, durationFrames, inFrame, outFrame)` para no reconstruirla en cada render.
- [ ] Inspector usa el mismo helper.
- [ ] Test: clip 1× conserva los segundos actuales; clip con curva avanza según la tabla.
- [ ] `npm run typecheck && npx vitest run apps/desktop/src/features/editor`.

### Task 4: Remap Rust + paridad con el fixture

**Files:**
- Create: `apps/desktop/src-tauri/src/render/time_remap.rs`
- Modify: `apps/desktop/src-tauri/src/render/mod.rs`
- Modify: `apps/desktop/src-tauri/src/render/ffmpeg.rs` (visibilidad de easing/Bézier)

**Interfaces:**
- Produce: `TimeRemap::from_clip(&Value) -> Result<Option<TimeRemap>, ProjectError>`, `source_frame(local: u32) -> u32`, `source_seconds(local, fps, in_frame) -> f64`, `setpts_expression() -> String`, `is_identity() -> bool`.
- Consume: fixture compartido con Task 1.

- [ ] Test de paridad: leer `packages/project-schema/fixtures/time-remap.fixture.json` con `include_str!` y comparar todos los `sourceFrameAt`.
- [ ] Implementar inversa numérica `g(m) = σ⁻¹(m + 0.5)` por bisección (60 iteraciones) y `setpts` con `if(lt(N,m+1), g(m), …)`, en frames (sin `/TB`).
- [ ] Curva constante → `is_identity()`/constante para no cambiar el camino actual.
- [ ] `cargo test --lib time_remap`.

### Task 5: Export respeta la curva

**Files:**
- Modify: `apps/desktop/src-tauri/src/render/ffmpeg.rs` (bloque de velocidad, `-t` de entrada, orden de `tmix`)
- Test: mismo archivo, módulo de tests.

- [ ] En `visual_filter`, si hay curva: `setpts` por frame, luego `fps={profile}:round=near` (o `minterpolate` si `opticalFlow`), y `tmix` después del remuestreo.
- [ ] `-t` de entrada = `(outFrame - inFrame)/fps`, no `clip_seconds × speed`.
- [ ] Guardas: `reverse`, `stabilization`, `motion`, keyframes de transform/máscara y `transitionIn` → error claro.
- [ ] Tests de string: curva constante emite el `setpts` actual; curva 0.5→2 emite `if(lt(N,...))`; la guarda rechaza combinaciones.
- [ ] `cargo test --lib ffmpeg`.

### Task 6: Preview frame (clip aislado y compuesto) usa el remap

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/preview_frame.rs`
- Test: mismo archivo.

- [ ] `source_time` usa `TimeRemap::source_seconds` si hay curva.
- [ ] El camino rápido de la ventana calcula el frame con `source_frame` y borra `speedCurve` antes de renderizar.
- [ ] Test: un clip con curva pide el frame de origen correcto; un clip 1× no cambia.

### Task 7: Frame real con gráficos

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/preview_frame.rs`
- Modify: `apps/desktop/src/services/project-service.ts`
- Modify: `apps/desktop/src/features/editor/Preview.tsx`
- Test: `preview_frame.rs` y `Preview` (si hay test de UI).

- [ ] `PreviewFrameRequest` acepta `motionPlans`.
- [ ] `window_project` conserva el clip gráfico activo en su `startFrame` original; los inactivos se descartan. El ASS se genera desde el proyecto ventana y se pasa a `build_plan`.
- [ ] Quitar la guarda `has_visible_graphic_clips` y el fallback por gráfico.
- [ ] `renderRealFrame` envía `buildProjectMotionPlans(project)` cuando hay gráficos.
- [ ] Invalidar `realFrame` cuando cambie el proyecto (no sólo `project.id`/playhead).
- [ ] Test unitario: ventana con gráfico activo conserva el clip y el plan de motion; `build_plan` contiene `ass=motion.ass` antes de `ass=captions.ass`.

### Task 8: Verificación y documentación

- [ ] `npm run typecheck`, `npm test`, `npm run test:extension`, `npm run test:web-tts`, `npm run build`, `npm run audit:licenses`.
- [ ] `node scripts/rust-test.mjs` y `node scripts/rust-env.mjs -- cargo check --workspace --all-targets`.
- [ ] Actualizar `docs/IMPROVEMENT-QUEUE.md`, `CHANGELOG.md` y `README.md` con lo verificado y lo que sigue pendiente (LUT interactivo, HDR, track matte, separación de fuentes).
- [ ] Reportar el flake conocido de `App.test` si reaparece; no ocultarlo.
