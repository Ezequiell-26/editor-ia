# 2026-11-08 — Transición `luma-wipe` con clip mate

Cierra el «siguiente gap Kdenlive» declarado al terminar slide-3d
(`docs/KDENLIVE-REFERENCE.md`). Port del luma wipe de Kdenlive: la
luminancia de un clip mate se convierte en alfa del clip entrante durante
el solape (lead) de la transición.

## Piezas

- **Schema** (`packages/project-schema/src/timeline.ts`): `luma-wipe` en
  el enum de `ClipTransitionSchema` + `mateClipId` (EntityId) obligatorio
  vía `superRefine`. JSON schema regenerado.
- **Export** (`apps/desktop/src-tauri/src/render/ffmpeg.rs`):
  - `luma_mate()`: resuelve el mate por `transitionIn.mateClipId` (render)
    o `transitionFrozen.mateClipId` (preview de un frame). Valida:
    clip existe, no es el mismo, kind video/image/freeze, enabled, sin
    speed curve ni reverse, ventana activa cubre el solape (tolerancia
    1 frame), asset ready + licencia conocida + path dentro del root +
    `ensure_asset_unchanged`. Devuelve `LumaMate` con seek/source en
    segundos de fuente (respeta `source.inFrame` y speed del mate).
  - `luma_wipe_graph()`: `split` del clip en lead/rest, `fps`+`format=gray`
    del mate, `scale2ref` (la máscara se escala al clip; segundo output
    es la referencia intacta), `alphamerge`, `trim=end_frame=lead`,
    `concat=n=2`, `setpts` con offset. El overlay usa `v{index}out`.
  - `luma_frozen_graph()`: versión de un frame para preview (máscara de
    un frame, `trim=end_frame=1`).
- **Preview** (`commands/preview_frame.rs`): `freezable_transition`
  acepta `luma-wipe`; en el lead escribe `transitionFrozen
  {mode:"luma",mateClipId}` y el mate queda en la ventana como clip
  normal.
- **UI** (`Inspector.tsx`): selector «Clip mate (máscara)» con candidatos
  filtrados por cobertura del solape (misma tolerancia de un frame que
  el renderer); auto-asigna el primero al elegir el tipo. `Timeline.tsx`
  tiene label; `visuals.rs` audita `luma-wipe` sin mate como error;
  `applyTransitionToCuts` la salta (la masiva no puede elegir mate).

## Verificación (esta pasada)

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `packages/project-schema`: vitest completo **373/373**
  (schema-artifacts confirma JSON en sync).
- `apps/desktop` vitest dirigidos **144/144** (project-actions 108,
  Timeline 20, Timeline.pro 7, EditorAssets 9).
- `cargo test -p editor-ia-desktop --lib`: `luma` 2/2,
  `window_freezes_fades_and_transition_leads` ok, `commands::visuals` 6/6,
  filtro `transition` 8/8.
- **Render real** (`EDITOR_IA_RUN_RENDER_TESTS=1`, ffmpeg 9.0.1): test
  ignorado nuevo `render_luma_wipe_uses_the_mate_luminance` — base roja +
  entrante azul + mate mitad negra/blanca en pista oculta. A mitad del
  lead YAVG izq=81.00 / der=41.00 (máscara funcionando); post-lead
  41.00/41.00 parejo. Helper nuevo `region_luma` (crop + signalstats).

## Notas

- El mate puede vivir en una pista `hidden`: `luma_mate` busca en todos
  los clips del documento, no sólo en `visual_clips`, así que una pista
  oculta sirve de fuente de máscara sin compositarse.
- El mate NO puede ser el mismo clip ni tener speed curve/reverse
  (limitación declarada del resolver de source-time).
- Pendiente honesto: el preview monitor congela un frame del mate (como
  el resto de transiciones); no hay UI que sugiera poner el mate en
  pista oculta.
