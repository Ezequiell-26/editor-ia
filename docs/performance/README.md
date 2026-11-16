# Baseline de performance — render E2E (auditoría F9)

Harness mínimo pero real para detectar regresiones de performance del
pipeline de render. Corre como **job nocturno** en
`.github/workflows/perf-nightly.yml` (no es gate de PR — ver §4).

## 1. Qué mide

`scripts/perf-baseline.mjs` ejecuta un test `#[ignore]` de render real con
FFmpeg de verdad más una medición idle del binario de test, y registra
estas métricas por corrida:

| Métrica | Definición | Honestidad del número |
|---|---|---|
| `wallTimeMs` | Tiempo wall del proceso `cargo test` completo: arranque del binario de test + generación de fixtures con ffmpeg/ffprobe + render + verificación FFprobe. | Es E2E del test, no del ffmpeg aislado. Incluye overhead fijo del harness (decenas de ms, despreciable frente a segundos de render). |
| `peakRssBytes` | Pico del **RSS sumado** de los procesos del árbol durante la corrida (`cargo`, `editor_ia_desktop_lib-*`, `ffmpeg`, `ffprobe`), muestreado cada ~400 ms vía PowerShell `Get-Process`. | Cota superior razonable de memoria del render; NO es el working set de una sola fase ni una medición exacta (muestreo discreto puede perder picos <400 ms). En plataformas no-Windows queda `null`. |
| `idleRssBytes` | RSS **promedio** del binario de test de la lib (`editor_ia_desktop_lib-*`, muestreo cada ~150 ms) durante un test trivial sin render (`--idle-test`, default `merge_olyvia_entry_preserves_other_servers_and_settings`). Se reintenta hasta 3 veces si el test termina antes del primer sample. | Proxy honesto del "código cargado" del escritorio. **NO es la app Tauri**: no incluye WebView2, el runtime ni el estado idle real de la UI porque la app no puede abrirse headless en CI. Se compara con el umbral de RSS (default +25 %). |
| `mcp` | Latencia JSON-RPC del servidor MCP embebido (`POST /mcp` en `127.0.0.1:31417`, `Authorization: Bearer <token>`): `initializeMs` y `pingMsAvg` (5 pings). Sólo con `--with-mcp`. | `initialize`/`ping` los responde el backend Rust sin bridge al frontend, pero el listener sólo existe **con la app viva**. Requiere `EDITOR_IA_MCP_TOKEN` (env; nunca se loguea) y `EDITOR_IA_MCP_URL` opcional. Sin app/token queda `{ measured:false, reason }` y **no entra al gate**; sólo se compara cuando AMBAS corridas lo midieron. |

Fixture por defecto: `render_live_5s_pan_astats_and_bezier_opacity_match_preview`
(`apps/desktop/src-tauri/src/render/ffmpeg/tests.rs`): render real de 5 s a
24 fps con paneo por clip (verificado con `astats`) y opacidad Bézier.
NO es `#[ignore]` — está gateado sólo por `EDITOR_IA_RUN_RENDER_TESTS` — y el
script lo corre con `--include-ignored`, que funciona igual para tests
`#[ignore]`. Se puede cambiar con `--test <nombre>` (cualquier `render_live_*`).

**Fixture alternativo**: `render_live_pipeline_produces_a_verified_mp4`
(el fixture "todo en uno" de la auditoría) fallaba por un bug en
`eq_compat.rs` (expresión `lutyuv` mal formada → EINVAL en FFmpeg 9);
**corregido el 2026-11-12** y los 12 tests `render_live` quedaron en verde.
El default sigue siendo el render de 5 s por ser más liviano y menos
ruidoso; usar `--test render_live_pipeline_produces_a_verified_mp4` para
medir el pipeline completo.

`baseline.json` guarda además `commit` (git rev-parse HEAD), flag `dirty`,
`machine`, timestamp y los umbrales usados. Comparar baselines entre commits
distintos del árbol sucio no es concluyente — regenerar con `--update` en el
commit de referencia.

## 2. Cómo correrlo

```powershell
# Regenerar el baseline (una corrida; tarda: render real + compilación si hace falta)
npm run perf:baseline -- --update          # o: node scripts/perf-baseline.mjs --update

# Solo medir e imprimir JSON, sin tocar el baseline
node scripts/perf-baseline.mjs

# Gate manual: falla (exit 1) si hay regresión
node scripts/perf-baseline.mjs --check
node scripts/perf-baseline.mjs --check --time-threshold 0.3 --rss-threshold 0.4

# Promediar N corridas (reduce ruido; cada corrida es un render completo)
node scripts/perf-baseline.mjs --update --runs 3

# Cambiar el test trivial del RSS idle
node scripts/perf-baseline.mjs --update --idle-test <nombre_de_test>

# Latencia MCP (requiere la app abierta y el token en env)
$env:EDITOR_IA_MCP_TOKEN = '<token>'   # el que muestra la app en la vista MCP («Mostrar token»)
node scripts/perf-baseline.mjs --update --with-mcp
```

Requisitos: Windows + PowerShell (muestreo RSS), `ffmpeg`/`ffprobe` en PATH,
toolchain Rust (el script pasa por `scripts/rust-env.mjs`, que resuelve
MSVC/SDK/FFmpeg-dev/libclang y `CARGO_HOME` escribible). El script setea
`EDITOR_IA_RUN_RENDER_TESTS=1` solo; el test queda `#[ignore]` para el resto
de la suite.

## 3. Límites honestos

- **Una máquina, un SO, un fixture.** El baseline es válido sólo para la
  máquina que lo generó (`machine` + `commit` en el JSON). Moverlo a otro
  hardware lo invalida: regenerar.
- **Ruido de pocas corridas sigue siendo alto.** El baseline commiteado se
  generó con `--runs 3` (3 renders, ~3.5 s wall cada uno en esta máquina);
  es mejor que una sola muestra pero no es una media estadística. Para
  decisiones de "¿empeoró esto?" correr `--runs 5` o más.
- **El RSS muestreado incluye todo el árbol** (cargo + test + ffmpeg +
  ffprobe sumados), no la memoria del render aislada.
- **`idleRssBytes` no es la app idle real.** Es el RSS promedio del binario
  de test de la lib durante un test trivial: proxy del "código cargado",
  sin WebView2/runtime/UI. La app Tauri no puede abrirse headless en CI
  (requiere sesión de escritorio), así que el idle true queda como
  instrumentación manual: correr la app, abrir el Administrador de tareas
  y comparar contra esta cota.
- **Latencia MCP no corre en el nightly.** El servidor MCP embebido
  (`127.0.0.1:31417`) sólo existe con la app viva y autenticada por token;
  en runners efímeros no hay app. `--with-mcp` queda para corridas manuales
  con la app abierta. El gate (`--check`) sólo compara latencias MCP
  cuando ambas corridas las midieron.
- **Carga del sistema**: otros procesos (antivirus, build paralelo) inflan
  ambas métricas. Correr con la máquina lo más quieta posible.
- El `cargo test --no-run` previo compila sin medir; el wall time medido es
  sólo la ejecución del test ya compilado.

## 4. Integración CI (implementada)

`.github/workflows/perf-nightly.yml` corre el baseline como **job
nocturno** (`schedule` 06:00 UTC + `workflow_dispatch`), separado del job
de PR por el costo del render E2E.

Estrategia usada (la opción honesta para runners efímeros): el baseline
commiteado se generó en la máquina de desarrollo y **no es comparable**
con GitHub-hosted runners, así que el job no lo usa. En su lugar:

1. `--update --runs 3` → corrida 1 escribe el baseline **dentro del
   workspace efímero del runner** (no se commitea).
2. `--check --runs 3` → corrida 2 se compara contra esa baseline local y
   falla si supera +20 % tiempo / +25 % RSS.

Así el gate detecta regresiones **dentro del mismo hardware del runner**,
que es lo único estadísticamente válido con una sola máquina de CI.

```yaml
# Resumen del workflow real (.github/workflows/perf-nightly.yml):
on:
  schedule: [{ cron: '0 6 * * *' }]
  workflow_dispatch: {}
jobs:
  render-baseline:
    runs-on: windows-2022
    steps:
      # checkout, node 22, cache crates, rustup, ci-ffmpeg-dev.sh,
      # ci-bundle-resources.sh, choco install ffmpeg
      - run: node scripts/perf-baseline.mjs --update --runs 3
      - run: node scripts/perf-baseline.mjs --check --runs 3
```

Nota: el primer run del schedule también sirve como smoke test del
workflow en CI real; si `perf-baseline.mjs` cambia de interfaz, revisar
este job además de `verify.yml`.

El nightly corre sin `--with-mcp` (no hay app en el runner): `idleRssBytes`
se mide y compara automáticamente en cada corrida; `mcp` queda
`{ measured:false }` y no afecta el gate.
