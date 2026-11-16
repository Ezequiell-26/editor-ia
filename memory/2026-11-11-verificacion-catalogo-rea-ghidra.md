# 2026-11-11 — REA/Ghidra: "declarar ≠ verificar" → verificación de catálogo en Olyvia

## Pasada sobre AlaukCut (estática, sin ejecutar la app)

- REA CLI 6.4.0 + Ghidra 12.1.4 + JDK 27 (`rea doctor`: Ghidra healthy;
  Hopper/IDA ausentes → `environment_healthy: false` NO es fallo de Ghidra).
  El MCP `rea` está en `~/.workbuddy-ai/mcp.json` pero en esta sesión no
  expuso tools: se usó `D:\Users\ofici\MCPs\rea-global\rea` por CLI.
- `rea search motorcpp.pyd suportad --kind strings --mode literal` →
  ev `41c8d307…`, 21 nombres `*_suportad*` + 2 docstrings nuevos:
  - `acabamento_suportado` (0x1800b74c0): booleano miente por desfasaje de
    versión; el módulo viejo ignora campos nuevos y entrega video válido SIN
    el efecto. Solución del autor: devolver la LISTA de lo que dibuja para
    que el front "pregunte y desista solo".
  - `transicoes_suportadas` (0x1800b8730): "es sólo una promesa"; lista
    nombres sin compilar. El shader roto aparece en el export y falla en
    silencio → compilar todo por adelantado y devolver nombre→error.
- `rea analyze-javascript-application <frontend> --artifact-format directory
  --analysis-timeout-ms 20000` → ev `c128ab33…`. 114 archivos, 109 JS
  parseados, 0 fallos, 643.758 nodos AST; grafo semántico 33.496 nodos /
  24.816 relaciones / 969 funciones / 63 boundaries. **Coverage parcial**:
  REA no inició el análisis semántico de los últimos módulos (timeline.js,
  transicoes_gl.js, telas.js…). Los números son piso, no techo.
- JSONL crudo de 57 MB descartado; cifras y IDs quedan en
  `docs/reference/alaukcut/11-capability-query-rea-ghidra-2026-11-11.md`.

## Mejora implementada (front end)

- `features/visuals/catalog-verification.ts`: cruza
  `FALLBACK_VISUAL_CATALOG` (declaración) con `listVisualCatalog()` (medición),
  estados `verified|unverified|unsupported|drift` + motivo, drift en ambos
  sentidos y chequeo de filtros por efecto.
- `VisualsView`: panel «Capacidades» con «Medir de nuevo», badges, aviso con
  motivo y «Aplicar» bloqueado si la transición no está verificada.
- **Brecha real**: antes, sin backend, el catálogo local declaraba TODAS las
  transiciones `available: true` con `ffmpegAvailable: false`.

## Verificación

`catalog-verification.test.ts` 8/8 · `VisualsView.test.tsx` 10/10 ·
`visuals.test.ts` 6/6 → 24/24 · `npm run typecheck` OK ·
`npm --workspace apps/desktop run build` OK (11,6 s, warnings de chunk
preexistentes). Sin commit, push ni deploy; cambios preexistentes intactos.

## Lecciones reutilizables

- `getByText(/motivo/)` falla si el motivo aparece en dos lugares (aviso +
  panel): usar `getAllByText(...).length > 0`.
- Los botones de transición llevan `aria-label` explícito: agregar badges
  internos no cambia el nombre accesible ni rompe los tests existentes.
- Las pruebas con `createFakeService()` devuelven `FALLBACK_VISUAL_CATALOG`
  con `filters: []` → los efectos quedan `unverified` pero las transiciones
  `verified` (no dependen del inventario de filtros). No exigir
  `ffmpegAvailable: true` para verificar una transición; el backend ya pone
  `available: false` cuando FFmpeg falta.
- Para próximas pasadas REA: subir `--analysis-timeout-ms` y/o analizar por
  módulos si se quiere coverage completo del front de AlaukCut.
