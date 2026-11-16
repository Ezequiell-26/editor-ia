# 11 — Contrato de capacidades: declarar ≠ verificar (REA + Ghidra, 2026-11-11)

> Análisis estático. No se ejecutó AlaukCut, no se observó runtime ni red.
> Se documentan contratos y patrones; no se copia código propietario.

## Herramientas y estado

- REA CLI 6.4.0 (`D:\Users\ofici\MCPs\rea-global\rea`). `rea doctor`:
  Ghidra 12.1.4 + JDK 27 `healthy`. Hopper/IDA ausentes (no necesarios);
  por eso `environment_healthy: false`, no por un fallo de Ghidra.
- El MCP `rea` figura en `~/.workbuddy-ai/mcp.json`, pero en esta sesión no
  expuso herramientas activas: la pasada se hizo por CLI.
- Binario: `C:\Users\ofici\AppData\Local\Programs\AlaukCut\backend\motorcpp.cp311-win_amd64.pyd`,
  SHA-256 `47488a8b9ada5c92ffcbaad0f78c071d57f165371c38128f429987e229b2f46a`.
- Frontend analizado: `...\AlaukCut\frontend` (114 archivos relevantes, 109 JS).

## Ghidra (vía `rea search`)

Comando: `rea search <pyd> suportad --kind strings --mode literal --format json`.
Evidence ID `ev_41c8d307f830ed6976f7aea72f0fae704650a17ef3d49058f45a994d3bf58b5b`,
provider Ghidra 12.1.4, `confidence: observed`, `authority: shipped-artifact`.

**21 exports de capability-query** (el front pregunta, no duplica listas):
`efeitos_suportados`, `formas_suportadas`, `captura_suportada`,
`webcam_suportada`, `fundo_suportado`, `chroma_suportado`,
`acabamento_suportado`, `manter_suportado`, `hsl_suportado`,
`canto_suportado`, `mascara_suportada`, `cor_suportada`,
`desenho_suportado`, `pessoa_suportada`, `sem_fundo_suportado`,
`empilhado_suportado`, `lut3_suportada`, `desfoque_suportado`,
`isolar_suportado`, `regiao_suportada`, `transicoes_suportadas`.

### Dos docstrings nuevos: el hallazgo de esta pasada

1. `0x1800b74c0`, junto a `acabamento_suportado` (`0x1800b74a8`):

   > "QUAIS efeitos o passe de acabamento desenha (02/10/2026, item 84).
   > Inverter, glitch e lapis chegaram depois dos cinco primeiros: um modulo
   > compilado antes deles responde `acabamento_suportado`, nao acha os campos
   > novos e usa o padrao (desligado) -- video valido e sem o efeito. Com a
   > lista, o frontend pergunta e desiste sozinho."

   Un booleano de soporte **miente por desfasaje de versión**: el módulo
   compilado antes de los efectos nuevos dice que los soporta, no encuentra
   los campos, usa el default apagado y entrega un video válido **sin** el
   efecto, en silencio. La corrección del autor fue devolver la LISTA de lo
   que el módulo realmente dibuja, para que el frontend pregunte y desista
   solo.

2. `0x1800b8730`, junto a `transicoes_suportadas` (`0x1800b8710`):

   > "Compila TODOS os shaders de transicao agora e devolve nome -> erro
   > (vazio = compilou). `transicoes_suportadas` e' so' uma promessa: ela
   > lista nomes sem compilar nada, e um shader quebrado so' apareceria no
   > meio de um export -- que desiste em silencio e vira 'ficou lento'."

   Listar nombres es **sólo una promesa**. La verificación tiene que ser por
   adelantado (compilar todo y devolver nombre→error), porque un shader roto
   aparece recién en el export, que aborta en silencio y se percibe como
   "quedó lento".

### Lección portable

**Declaración ≠ verificación.** Toda opción que la UI ofrece debe estar
respaldada por una medición del backend; lo demás se muestra con estado y
motivo explícito, y la UI se niega a escribirlo en el proyecto. Además hay
que detectar el desfasaje en ambos sentidos: la UI declara lo que el backend
no tiene, y el backend conoce lo que la UI no declara.

## REA JavaScript application analyzer

Comando: `rea analyze-javascript-application <frontend> --artifact-format
directory --analysis-timeout-ms 20000 --format json`.
Evidence ID `ev_c128ab335d6280492991f00c79d133f05e94a94db9b53c6be122cc80b7fa4cb1`,
provider `rea-javascript-application` v1, root SHA-256
`b540a589709b4fc430249a8d626755fa802ddc0849da07c4bdfdecc57ad5874f`,
inventory graph `47366e0cff0f5a6b0a5fe9f8ac22f55197d4fc4b7b4668c7282af63b30223d3e`.

- 114 archivos relevantes, 109 JS parseados, **0 fallos de parseo**,
  643.758 nodos AST visitados, 4.329.428 bytes leídos, 249 hallazgos.
- Grafo de inventario: 361 nodos / 482 aristas.
- Grafo semántico: **33.496 nodos**, 24.816 relaciones, 969 fingerprints
  (funciones), 711 contextos de evidencia, 109 módulos raíz, 63 boundaries.
- Distribución de nodos: 23.051 expresiones, 3.852 call-sites, 2.191
  property-slots, 1.436 bindings, 969 funciones, 926 parámetros, 710
  return-sites, 109 módulos, 97 tareas, 67 literales, 63 boundaries,
  11 timers, 10 promesas, 2 request / 2 response.
- **Coverage: parcial.** REA reservó su capacidad de resultado para
  observaciones estáticas y no inició el análisis semántico de los últimos
  módulos (`seletor_cor.js`, `sessao_nativa.js`, `sons.js`, `suporte.js`,
  `telas.js`, `templates_dados.js`, `timeline.js`, `transicoes_cine.js`,
  `transicoes_gl.js`, `vendor/lottie_canvas.min.js`, entre otros). Los
  conteos son un piso, no un techo: no afirmar cobertura completa. El
  JSONL crudo (57 MB) se descartó tras extraer estas cifras.

## Aplicado a Olyvia (mismo ciclo)

`apps/desktop/src/features/visuals/catalog-verification.ts` + `VisualsView.tsx`
+ `visuals-view.css`: cruza `FALLBACK_VISUAL_CATALOG` (declaración de la UI)
con `listVisualCatalog()` (medición del backend), clasifica cada entrada en
`verified | unverified | unsupported | drift` con motivo, muestra un panel de
verificación con «Medir de nuevo» y bloquea «Aplicar» cuando la transición
no está verificada.

**Brecha cerrada**: antes, si el backend no respondía, la vista caía al
catálogo local, que declara **todas** las transiciones como `available: true`
con `ffmpegAvailable: false`. Se podía escribir una transición en el proyecto
sin ninguna confirmación de que FFmpeg fuera a renderizarla.

## Límites honestos

- Análisis estático: no se ejecutó AlaukCut ni se observó runtime/red.
- Ghidra sólo reporta strings definidas; una búsqueda vacía no prueba
  ausencia de texto en el artefacto.
- La verificación de Olyvia es de frontend sobre datos ya medidos: **no**
  compila shaders ni prueba que cada transición renderice un frame. Mitiga
  el fallo silencioso y el desfasaje de catálogo, pero no equivale al
  self-test de compilación que describe el docstring de AlaukCut.
