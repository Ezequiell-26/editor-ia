# 2026-11-13 — concat-effects: catálogo de audio integrado a effect-kit

## Qué se hizo

Los ~132 paquetes de `vendor/concat/crates/concat-effects/packages/` son
mayoría shaders WGSL (85 efectos/filtros + 22 transiciones, sin backend
FFmpeg) y 25 de `kind = "audio"` con cadena FFmpeg + plantillas `{expr}`.
Sólo el audio es ejecutable hoy en Olyvia.

Integración REAL de punta a punta para los 25 de audio:

- `packages/effect-kit/scripts/generate-concat.ts` (nuevo): parsea los
  `effect.toml`/`fixtures.toml` del vendor (parser TOML mínimo propio, sin
  deps) y emite:
  - `src/catalog/concat-audio.ts` — 25 `EffectManifest` (`kind: 'audio'`,
    ids `concat.*`, `audio.concatTemplate: true`, `fidelity: 'exact'`).
    Los `let` del manifiesto se inlinean dentro de los slots `{...}` de la
    cadena en tiempo de codegen.
  - `src/catalog/concat-packages.ts` — inventario de los 132 paquetes
    (referencia; los WGSL no son aplicables todavía).
  - `CONCAT_AUDIO_FIXTURES` — cadenas esperadas de `fixtures.toml`.
- `src/concat-expr.ts` (nuevo): port fiel de `expr.rs`+`template.rs` de
  concat-effects (mismo lenguaje: números, `round/fixed/clamp/if/pow/...`,
  Int vs Float para el formato de salida).
- `ffmpeg.ts::compileAudioInstance`: rama `recipe.concatTemplate` que
  evalúa con `renderConcatTemplate` (env = params normalizados + `index:0`).
- `types.ts`: `AudioRecipe.concatTemplate?: boolean`.
- `catalog/index.ts`: `ALL_EFFECTS` incluye `CONCAT_AUDIO_EFFECTS`.
- `generate-recipes.ts`: emite `Recipe.concat_audio: bool`; para recetas
  concat `audio_chain` queda vacía (no se traduce `{expr}`).
  `effect_recipes.rs` regenerado (103 recetas, 55 de audio).
- `render/ffmpeg/visual/effects.rs`: `concat_audio_fragment()` delega en
  `concat_effects::catalogue::Catalogue::builtin().ffmpeg_fragment()` —
  el crate vendorado es la fuente de verdad del DSP en export. Cableado en
  `apply_audio_effect_stack`, `build_audio_stack_graphs` (audioStack
  animado por keyframes) y `instance_keyframe_tracks`.

## Verificación (esta sesión)

- `concat-audio.test.ts`: 75/75 fixtures del vendor reproducen la cadena
  FFmpeg exacta (default/min/max por paquete) + tests unitarios del port.
- vitest effect-kit: 68 passed. typecheck effect-kit + desktop: exit 0.
- `npm run thumbnails:effects`: 25 SVG nuevos (`concat.*.svg`).
- `cargo check -p editor-ia-desktop`: OK. `cargo test ... audio`: 62
  passed, incluido `concat_audio_effects_reach_the_audio_chain` nuevo.

## Pendiente / límites honestos

- Preview Web Audio: los `concat.*` NO están en `PREVIEW_AUDIO_FX`
  (clip-audio-fx.ts) → en preview suenan secos; el export sí los aplica.
  Equivalentes Web Audio se pueden mapear después (aecho→DelayNode, etc.).
- 107 paquetes WGSL (filtros/efectos/transiciones) NO integrados: no hay
  backend FFmpeg ni conversor WGSL→GLSL. Inventario en
  `catalog/concat-packages.ts`. Portar WGSL→GLSL a mano por paquete es el
  único camino real; las transiciones tienen `xfade`/`fallback` declarado
  que serviría de export si se escribiera el shader de preview.
- Regenerar: `node --experimental-strip-types
  packages/effect-kit/scripts/generate-concat.ts` tras tocar el vendor;
  luego `npm run effects:codegen` y `npm run thumbnails:effects`.
