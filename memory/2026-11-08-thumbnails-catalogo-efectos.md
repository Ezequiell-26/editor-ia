# 2026-11-08 — Thumbnails del catálogo de efectos y visuales

Pasada del protocolo del loop (Devin CLI). Ítem: la parte «miniaturas de
medios/efectos/transiciones reales» del `[next]` del cotejo 36/36.

## Brecha medida

- `EffectBrowser` pide `/thumbnails/effects/<manifest.id>.svg` para los
  ~100 manifiestos de `ALL_EFFECTS` (48 video + 22 `transition.*` + 30
  audio). Sólo existían 15 SVG del catálogo viejo de presets → ~85
  tarjetas con `<img>` roto.
- `VisualsView` pide `/thumbnails/presets/<id>.svg` y
  `/thumbnails/transitions/<id>.svg` con ids del catálogo visual real
  (`commands/visuals.rs`): los 8 presets y 4 de 7 transiciones no tenían
  archivo.

## Cambio

- `packages/effect-kit/scripts/generate-thumbnails.ts` (nuevo,
  `npm run thumbnails:effects`): SVG determinista por manifiesto
  (tinte por categoría + hash FNV del id; ondas para audio, motivo por
  categoría para video, dos mitades para transiciones). 100 SVG.
- `apps/desktop/scripts/generate-thumbnails.js`: PRESETS/TRANSITIONS
  actualizados a los ids reales; regenerados.
- `ThumbnailBrowser`: `onError` → placeholder con icono.
- `effect-thumbnails.test.ts`: cobertura catálogo↔archivos (3 tests).

## Verificación

- vitest `effect-thumbnails` 3/3 · vfx+visuals+components 98/99
  (`EffectTemplates` «importa JSON corrupto» flaky de FileReader en jsdom:
  4/4 aislado, ajeno).
- `tsc --noEmit` desktop 0 · effect-kit 4 errores preexistentes del WIP
  del usuario en `engine.test.ts` (Bézier keyframes).

## Notas

- Los SVG son representativos por categoría, NO renders del shader; un
  thumbnail real por GPU queda como mejora futura.
- `import.meta.url` en vitest no es fiable (vite lo reescribe a
  `http://localhost:3000/@fs/…` en algunos grafos): para tests que leen
  archivos usar `process.cwd()` + ascenso, no `import.meta.url`.
- Los 15 SVG viejos de `thumbnails/effects/` quedaron sin referencias;
  no se borraron.
