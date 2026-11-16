# 07 — Efectos, transiciones, filtros, LUTs

## Transiciones (`transicoes_gl.js`, 33 GLSL + `transicoes_cine.js`, 31 cine)

**`TRANSICOES_GL`**: 33 transiciones como strings GLSL embebidos.

- ~20 vienen de **transitions.dev** (Zeh Fernando, MIT): DreamyZoom,
  SimpleZoom, directionalwarp, directionalwipe, LinearBlur, crosswarp,
  GlitchDisplace, GlitchMemories, StripDatamoshGlitch, BookFlip, luma,
  morph, burn0, FilmBurn…
- ~13 **propias de AlaukCut** (comentarios fechados "AlaukCut dd/mm/aaaa"):
  `deslizar`, `cobrir`, `circulo`, `relogio`, `clarao`, `zoomradial`,
  `caleidoscopio`, `reflexo`, `persiana`, `tinta`, `liquido`, `vento`,
  `bolhas`, `colmeia`, `chuva`, `pixelar`, `triangulos`, `estilhacar`,
  `interferencia`.

### Contrato del shader de transición

Cada string es un `vec4 transition(vec2 uv)` con helpers del runtime:
- `getFromColor(uv)` / `getToColor(uv)`: muestrea clip A y B.
- `progress` (0→1), `ratio`, `uvExato()` (uv sin cuantizar — las
  transiciones "lishas" lo usan para evitar escalones entre GPUs).
- El mismo GLSL se traduce a HLSL en `transicao.hlsl` para el motor
  nativo (mismas trampas documentadas en `camada.hlsl`).

### Lección de ingeniería (sus comentarios)

- Efectos que deben ser **continuos** evitan `floor`/`step`/`fract` sobre
  el uv final (cuantización → escalones visibles distintos por GPU/driver).
- Hashes para ruido se redondean a 1/4096 antes del `step` (lección de
  `StripDatamoshGlitch`).
- `mod`/`atan`/`mix`/`fract` tienen equivalencias HLSL distintas — por eso
  el header de `transicao.hlsl` es casi tan importante como el código.

**`TRANSICOES_CINE`**: 31 "cinemáticas" (`cine_a01`…`cine_b13`) =
transiciones por **secuencia de imágenes** (grid 4×4) en `img/cine/` —
un tipo de transición asset-driven distinto del shader.

## Shaders HLSL del motor nativo (`backend/shaders/`)

| Shader | Rol |
|---|---|
| `camada.hlsl` (970) | Compositor de capas — paridad píxel-exacta con `motor.js` |
| `transicao.hlsl` (1321) | Las mismas transiciones en HLSL + helpers (`uvExato`, `ModGLSL`) |
| `acabamento.hlsl` (262) | Acabado/post (vignette, grano, letterbox) |
| `desfoque.hlsl` (74) | Blur |
| `isolar.hlsl` (63) | Aislamiento de fuente (voz?) |
| `regiao.hlsl` (151) | Efecto por región del frame |

## Datos de efectos (módulos `_dados.js`)

| Módulo | Tamaño | Contenido |
|---|---|---|
| `filtros_dados.js` | 42 KB | Catálogo `FILTROS_LUT`, `FILTROS_SAT`, `FILTROS_SAT_ANTES` — filtros con parámetros |
| `filtros_criativos_dados.js` | 54 KB | Filtros creativos |
| `luts.js` | N_FABRICA=33 | Parser `.cube` (N_MAX=65, archivo=129), LUTs de fábrica, errores con código |
| `luts_camera.js` | — | Transformación color de cámara: `PRIMARIAS`, `PARA_709`, `CURVA`, `VISUAL` |
| `animacoes_dados.js` | `ANIM_POR_ID` | Catálogo de animaciones de capa |
| `templates_dados.js` | `LAYOUT` | Templates de proyecto (682 líneas de datos) |
| `area_segura.js` | `REDES` | Presets de área segura por red (ya portado a Olyvia) |
| `cursor_estilos.js` | `CORES`, `FORMAS` | Estilos/colores de cursor (ya portado) |
| `inspetor.js` | `NOMES_TRANSICAO`, `IC_ALINHAR`, `LEG_*` | Nombres/constantes del inspector |

## Lo que Olyvia ya tiene vs esto

- Transiciones: Olyvia tiene set propio; el patrón **shader-por-transición
  con contrato `getFromColor/getToColor/progress/ratio/uvExato`** es
  replicable — sus ~13 propias son originales pero las ~20 MIT de
  transitions.dev son licencia MIT (usables con atribución).
- LUTs `.cube`: Olyvia ya soporta LUTs; el parser con límites
  (N_MAX=65/129) y errores codificados es buena referencia.
- `luts_camera` (camera→709 log→rec709): verificar si Olyvia tiene
  interpretación de LUTs de cámara — gap potencial.
- Áreas seguras y cursor: ya portados (2026-11-09).
