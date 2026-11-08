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
  suite. Causa probable: `verify_output`/publish corre justo tras salir
  ffmpeg y en Windows el archivo puede estar aún bloqueado/flusheándose.
- **Mitigación aplicada** (commit posterior): `verify_output`+publish se
  reintenta una vez tras 400 ms — el temporal puede seguir liberándose
  en Windows justo tras salir ffmpeg. Si el flake persiste, el
  `render-<job>.log` dirá la causa real.
- **Subtítulos por IA**: existe pipeline Whisper real
  (`commands/audio/transcribe.rs`, faster-whisper vía Python) pero el
  motor NO está instalado en esta máquina. Instalarlo es decisión del
  usuario (ctranslate2 + descarga de modelos).
- **Provider de patrones** (commit posterior): `local-ffmpeg-pattern`
  genera PNGs lavfi (gradients/mandelbrot/cellauto/testsrc2) para
  requisitos `image` con prefijo `pattern:`/`gradient:`/`texture:`.
  Son fuentes sintéticas de fondo/placeholder, NO arte semántico —
  honesto en capabilities ("sólo patrones").
- **Música desde la UI**: `BuildPlanOptions.music` emite
  `req-musica` (kind `music`, query `music:ambient`) + `plan.music`
  habilitado; el panel tiene selector "Música de fondo".
- **Symlink `project-schema` reincidente**: npm volvió a copiar una
  versión vieja del package en `node_modules/@editor-ia/project-schema`
  (sin `createEmptyProductionPlan`) → los 7 tests del builder fallaban
  con "is not a function". Se reemplazó por junction a
  `packages/project-schema` del worktree (la copia vieja quedó en
  `project-schema.stale-bak`). Si vitest vuelve a fallar así, revisar
  ese enlace primero — npm install lo pisa.

## Comandos

- `node scripts/verify-studio.mjs` — verificación integral (~5 min).
