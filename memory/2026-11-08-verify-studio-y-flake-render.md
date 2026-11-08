# 2026-11-08 — verify-studio.mjs y flake de render ffmpeg

## Qué se agregó

`scripts/verify-studio.mjs`: corre los 17 tests `#[ignore]` de `studio::`
(providers live + E2E de las 8 etapas) en dos pasos — providers/analyze
en un proceso y cada E2E en su propio proceso, con un reintento único
por E2E que reporta "flaky" si pasa al segundo intento.

## Hallazgos medidos

- **Ventana de búsqueda remota**: `max_count*10` daba sólo 10 candidatos
  con `max_count=1` y archive.org tenía <2 con licencia+derivado en esa
  ventana → `requires_provider` espurio. Ahora `clamp(25,50)`.
- **Búsqueda del catálogo no mira `label`**: los assets generados no eran
  encontrables por texto. `register_generated_asset_typed` ahora guarda
  `tags: [provider, kind, query]`.
- **Flake de render**: "el render terminó sin publicar el archivo de
  salida" ocurre de forma intermitente (~1 de cada 4 corridas del E2E de
  contenido) en tests que pasan consistentemente individuales. No es un
  bug determinista del pipeline: cada E2E pasó solo tras fallar en
  suite. Causa probable: presión de recursos ffmpeg en Windows tras
  renders/descargas encadenados. Queda como deuda: capturar stderr del
  render en el stage para diagnosticar la causa raíz.

## Comandos

- `node scripts/verify-studio.mjs` — verificación integral (~5 min).
