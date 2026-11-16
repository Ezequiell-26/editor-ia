# 2026-11-11 — Monitor dual (`previa_dupla`) + fin de los MIT de transicoes_gl

## Implementado en esta sesión

### Transición `barrido-diagonal` (directionalwipe MIT)
Wipe alfa por proyección `(X+Y)/(W+H)` en `wipe_alpha_expr`
(`render/ffmpeg/visual/helpers.rs`). Con esto **todos los MIT de
`transicoes_gl.js` evaluables están portados**. No portables:
`crosswarp` (2 capas), `estilhacar` (voronoi 3×3 — sin fuente local del
shader, la semántica exacta no está documentada; `colmeia` ya cubre el
caso voronoi hexagonal), `GlitchMemories`/`StripDatamoshGlitch`/
`BookFlip`/`morph`/`burn0`/`FilmBurn` (shader/asset propio).

### Monitor dual (`previa_dupla`)
- Rust: `commands/domains/system/dual_monitor.rs` —
  `dual_monitor_open/close/is_open`, `WebviewWindowBuilder` label
  `dual-monitor`, url `index.html?dual=1`.
- `capabilities/dual.json`: ventana nueva necesita su propio archivo de
  capabilities con `core:default` (los comandos de app NO pasan por ACL,
  pero las APIs core sí).
- Protocolo `BroadcastChannel('olyvia-dual-monitor')` — mismo origen en
  Tauri y en `window.open` del navegador.
- `state/dual-link.ts` (`useDualMonitorLink` en App dentro del provider)
  publica snapshot/project/transport; `DualMonitorView.tsx` monta
  `ProjectProvider` con `opened:null` → **sin autosave** (el documento
  es de la principal).
- Detección: `?dual=1` o label `dual-monitor` (fallback si Tauri no
  conserva el query — VERIFICAR en la app real).
- Botón «fullscreen» junto al toggle de preview desacoplada.

## Lecciones

- `scripts/rust-env.mjs` está en la RAÍZ del repo, no en
  `apps/desktop/scripts/` (ese dir sólo tiene flow-generate +
  generate-thumbnails). Desde `src-tauri`: `node ../../../scripts/rust-env.mjs -- cargo ...`.
- `cargo check/test` en este workspace tarda ~2-7 min; compilar una vez
  y reutilizar el shell background.
- `visuals.test.ts` tiene lista ORDENADA estricta de transiciones —
  los ids nuevos deben insertarse en la posición exacta del catálogo,
  no al final.
- Varios «GAP» de `10-lecturas-profesas.md` estaban desactualizados
  (luts_camera, dicas, export_diario, prontidao, mascara_desenho,
  previa_dupla). Verificar código antes de implementar — ya se hizo
  una pasada de corrección.

## Gaps grandes que quedan (todos subsistemas, no quick wins)

- `agendador`/`prerender_ui`: scheduler de prerender por tramos con
  cache por firma — el preview usa video elements por clip, no un
  compuesto único; integrar segmentos cacheados es cirugía profunda.
- Multicam (`camera_inteligente`), rotoscoping (`palco_sem_fundo`),
  RIFE (backend externo), maozinha completo, pista «efeito»
  (`regiao_efeito` — overlay por región de frame), `transicoes_cine`
  (31 transiciones por textura — assets propietarios, mechanism
  además requiere input overlay extra en el plan de render),
  sprite sheets de stickers, camera bars, auto-reframe con
  anticipación ±3 s.
