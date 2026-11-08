# 2026-11-07 — Receta FFmpeg para `light.leak` (último efecto «sólo preview»)

Pasada del loop de mejora (Devin CLI). Con esta receta **los 48 efectos de
video del catálogo exportan**: `docs/DRIFT-PARITY.md` §5 quedó sin casos
«Sólo preview».

## Qué se hizo

- `packages/effect-kit/src/catalog/video.ts`: `light.leak` ganó
  `ffmpeg.graph` — `split=2`, overlay `format=gbrp,geq` por píxel +
  `blend=all_mode=screen` (misma estructura que `light.flare`). La
  envolvente del shader se portó literal: `edge = smoothstep(0.35,1.1,
  length(p))`, `mask = smoothstep(0.35,0.85, blob*0.6 + edge*0.8)` con el
  smoothstep cúbico escrito a mano, salida `clip(tint·mask·amount·255)`.
- **Decisión clave**: `ek_fbm` (4 octavas × 4 `ek_hash21`) NO entra en la
  gramática de `geq` — inlineado superaría el límite de ~32 KB de línea de
  comandos de Windows. Se aproximó con **5 senos incommensurables**
  (freq/phase crecientes, amps 0.30→0.08) renormalizados a [0,1]. La cola
  ya lo anticipaba («aproximar con senos»). `fidelity: 'approximate'`.
- `npm run effects:codegen` → 78 recetas en `effect_recipes.rs`.
- `catalog.test.ts`: +1 test del grafo; el stack test `grade+vignette+leak`
  pasó de `preview-only` a `approximate` con `previewOnly: []`.
- `ffmpeg.rs`: +1 test Rust `effect_stack_expands_leak_graph_with_filled_params`.
- `EffectStudio.test.tsx`: aserción stale corregida — esperaba «Sólo
  preview» tras agregar `light.flare`, pero flare exporta desde el
  2026-11-08; ahora espera «Export aproximado» (lo que el producto muestra).

## Verificación con FFmpeg real (n9.0 empaquetado)

`testsrc2` 320×180, 50 frames, rawvideo rgb24 comparado frame a frame
(scripts en `.tmp-leak/`, ignorado por git):

- Frame 25, diff media por canal vs base: esquina sup-izq **80**, sup-der
  **59**, calidez R−B **+70/+166**, centro **+0,8**.
- Frame 10 vs 40 en la esquina: **11,2** — las manchas se mueven con
  `T·speed`.

## Verificación repo

- vitest effect-kit **48 passed / 3 skipped** (live).
- vitest vfx desktop **25 passed / 1 failed** — el único fallo es el
  conocido y ajeno de `EffectTemplates.test.tsx` (importación JSON,
  flaky de jsdom/navigation; ese archivo pasó 4/4 en la corrida aislada
  junto a EffectStudio). EffectStudio quedó 6/6.
- `cargo check -p editor-ia-desktop` limpio (6m17s, perfil dev).
- Rust `cargo test --lib effect_stack` **11/11** con test nuevo
  `effect_stack_expands_leak_graph_with_filled_params` en `ffmpeg.rs`
  (esta vez sin el `os error 32` de pasadas anteriores).
- `tsc --noEmit` desktop: 1 error **preexistente** del WIP del usuario
  (`PreviewTransformBox.tsx:248`); effect-kit: los 4 errores
  **preexistentes** de `engine.test.ts`.

## Lecciones

- El límite real para portar shaders a `geq` no es la gramática sino la
  longitud de la expresión inlineada: cualquier hash/ruido por píxel con
  reutilización de subexpresiones explota el tamaño. Regla práctica:
  funciones con memorización interna (`fbm`, `hash`) → aproximar con
  combinación de senos; funciones punto-a-punto (`smoothstep`, `sqrt`,
  `sin`) → port literal.
- `geq` acepta `floor`/`ceil`/`mod`/`clip`/`min`/`max`/`sin`/`sqrt` y las
  vars `X,Y,W,H,T` (T = segundos del frame = `u_time`).
- Tests de UI que pinan etiquetas de fidelidad quedan stale cuando un
  efecto gana receta: buscar `Sólo preview` en tests al cerrar cada
  receta.
