# 2026-11-09 — Bases de conocimiento AlaukCut + CapCut en docs/reference/

## Qué se hizo

El usuario pidió leer AlaukCut "cada detalle" y organizar todo lo aprendido
en el repo para que futuras sesiones de IA puedan seguir portando features
a Olyvia. Se creó la carpeta `docs/reference/alaukcut/` con documentación
temática completa, y `docs/reference/capcut/` con la arquitectura real de
CapCut 9.4.

## AlaukCut (`docs/reference/alaukcut/`)

- `README.md` — índice y reglas de uso (patrones sí, código no).
- `01-arquitectura.md` — stack PyWebView+CPython+.pyd, 3 vías de comunicación.
- `02-frontend.md` — los 105 módulos JS agrupados por dominio.
- `03-backend-api.md` — 57 .pyc por dominio + ~257 métodos Api agrupados.
- `04-motor-nativo.md` — 118 exports del .pyd, 6 shaders HLSL, encoder.
- `05-protocolo.md` — rutas HTTP (7 GET + 11 POST) + WS /nativo/ws.
- `06-ui-layout.md` — layout completo: topbar, 11 pestañas, monitor dual
  Source/Program, inspector colapsable, chat IA embebido, columna IA.
- `07-efectos-transiciones.md` — 33 transiciones GLSL + 31 cinemáticas,
  lecciones de paridad GLSL→HLSL, datos de filtros/LUTs/templates.
- `08-grabacion-ia.md` — pipeline de grabación, agente_ponte (5.5k líneas),
  export con prerender-cache, hyperframes, herramientas externas.
- Anexos: `anexo-api-completa.txt` (948 firmas marshal), 
  `anexo-modulos.txt` (digest por módulo).

## CapCut (`docs/reference/capcut/`)

- `README.md` + `01-arquitectura.md` — **CapCut NO es Electron**: es
  Qt6 Quick/QML + CEF + 167 DLLs; motores videoeditor.dll (70 MB),
  VECreator.dll (262 MB), cccreator.dll (158 MB), lens.dll (88 MB).
- `02-recursos-modelos.md` — Resources/ (68 dirs), models/ (~220 MB de
  modelos IA: tracking, skeleton, matting, beauty, interpolation umvfi,
  deflicker, depth, avatar…), DefaultAdjustBundle (39 ajustes de color
  versionados GLES2/3/NPU), builtin_skills del agente, 184 keyframe types,
  52 feature flags.
- Artefactos REA previos: feature-flags.txt, feature-strings.txt,
  keyframe-types.txt, JSONs de evidencia.

## Hallazgos clave nuevos

- AlaukCut: transiciones GLSL tienen contrato `transition(vec2 uv)` con
  `getFromColor/getToColor/progress/ratio/uvExato`; ~20 son MIT de
  transitions.dev (usables con atribución), ~13 propias.
- AlaukCut: `gravar_*` graba con motor nativo (cursor en captura, chroma,
  molduras); Olyvia usa ffmpeg+dpass — ya implementado equivalente.
- CapCut: videoeditor.dll (70 MB) excede límite REA de 64 MiB → análisis
  por strings/recursos, no decompilación. Ghidra sobre él probablemente
  timeout también.
- CapCut tiene 220 MB de modelos IA on-device — mucho más ambicioso que
  AlaukCut en IA (avatar 3D, gender swap, skeleton, matting interactivo).

## Pendiente

- Seguir portando gaps en orden: tracking, auto-reframe, marcos monitor,
  RIFE — ahora con docs de referencia en docs/reference/{alaukcut,capcut}/.
- Si se quiere más profundidad en CapCut: REA/Ghidra directo sobre
  videoeditor.dll con tiempo mayor, o analizar VECreator.dll.
