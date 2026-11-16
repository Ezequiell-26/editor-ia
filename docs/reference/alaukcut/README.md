# AlaukCut — Base de conocimiento para port a Olyvia

> **Propósito**: documentación estructurada de cómo está hecha AlaukCut
> (editor de video comercial, PyWebView + Python embebido + motor C++),
> extraída por análisis estático el 2026-11-09. Sirve para implementar
> features equivalentes en Olyvia con código propio (Rust/Tauri/TS).
>
> **Regla legal**: este material describe arquitectura, APIs y patrones.
> NO copiar código, shaders, assets ni textos de AlaukCut — reimplementar.

## Índice

| Doc | Contenido |
|---|---|
| `01-arquitectura.md` | Stack completo, procesos, puentes front↔back↔nativo |
| `02-frontend.md` | Los 105 módulos JS agrupados por dominio con propósito |
| `03-backend-api.md` | Módulos .pyc + los ~257 métodos RPC `Api` agrupados |
| `04-motor-nativo.md` | `motorcpp.pyd`: 118 exports, shaders HLSL, encoder |
| `05-protocolo.md` | HTTP server rutas + WebSocket `/nativo/ws` |
| `06-ui-layout.md` | Pantallas, paneles, posiciones del editor |
| `07-efectos-transiciones.md` | Transiciones GLSL/HLSL, filtros, LUTs, templates |
| `08-grabacion-ia.md` | Pipeline de grabación, agente IA, hyperframes |
| `09-motor-nativo-ghidra.md` | Análisis REA/Ghidra del `.pyd`: pipeline MF/D3D11, stats, resiliencia GPU |
| `10-lecturas-profesas.md` | Lectura profunda de módulos JS: algoritmos y gaps |
| `11-capability-query-rea-ghidra-2026-11-11.md` | REA/Ghidra: contrato `*_suportad*`, "declarar ≠ verificar", inventario semántico del front |
| `anexos-rea/` | Mapa string↔función (340 funcs), firmas pybind11, pseudocódigo `producir_pedaco` |
| `anexo-api-completa.txt` | Firma completa de cada método (marshal dump) |
| `anexo-modulos.txt` | Digest por módulo JS (tamaño + exports) |

## Cómo usar esto para mejorar Olyvia

1. Leer `01` + `06` para entender la forma del producto.
2. `02`/`03`/`anexo-*` para ver QUÉ hace cada pieza (nombre + firma).
3. `04`/`05`/`07` para el CÓMO técnico (patrones replicables en Rust).
4. Cruzar contra `../ALAUKCUT-GAP-ANALYSIS-2026-11-09.md` para el estado
   de paridad feature-by-feature y el orden de trabajo.

## Datos duros

- Instalación analizada: `C:\Users\ofici\AppData\Local\Programs\AlaukCut`
- Frontend: 105 JS vanilla, ~68k líneas, sin framework ni bundler.
- Backend: 57 `.pyc` (CPython 3.11.9 embebido), sin `.py` fuente.
- Nativo: `motorcpp.cp311-win_amd64.pyd` ~900 KB, ~100 funciones.
- Shaders: 6 HLSL, 2.841 líneas.
- Herramientas: ffmpeg custom + variantes gif/mpeg/prores, whisper.cpp,
  RIFE-ncnn-vulkan, YuNet ONNX, MediaPipe/ONNX person-seg.
