# Smart Engine Router (Fase 13)

Fecha: 2026-10-31. Primer contrato del router que decide **con qué motor
existente** se resuelve una escena o un clip. No inventa capacidades: un motor
`planned` devuelve `blocked` con la razón.

## Registro de motores

| Motor | Fase | Estado | Resuelve |
|---|---|---:|---|
| `ken-burns` | 4 | available | imágenes o video con zoom/paneo (`ClipMotion`). |
| `parallax` | 4 | partial | presets de dos capas con recorte manual; sin mapa de profundidad. |
| `motion-graphics` | 6 | available | clips gráficos y plantillas ASS. |
| `lottie` | 3 | partial | biblioteca y previews; no es un clip de timeline completo. |
| `rig` | 3 | partial | stickman procedural de 5 ciclos horneado a MP4; sin rigs importados ni IK. |
| `three` | 5 | partial | escena Three.js horneada a MP4 VP9; sin glTF ni 3D en vivo. |
| `face-tracking` | 9 | partial | SeetaFace + máscaras VFX en video. |
| `object-tracking` | 9 | partial | punto/caja NCC sobre frames; sin objetos semánticos ni pose. |
| `effects` | 8 | available | 21 efectos con paridad de export. |
| `transition` | 8 | available | 12 transiciones. |

`engineCatalog()` expone esta tabla a los agentes (`engine_catalog`).

## Reglas de resolución

Sin pedido explícito (`request` ausente):

1. Escena sin clips visuales → `needs-input`.
2. Si hay un clip gráfico → `motion-graphics`.
3. Si hay una imagen → `ken-burns` (con o sin movimiento ya asignado).
4. Si es video → `effects`.
5. Las transiciones presentes se agregan como motores de apoyo.

Con pedido explícito:

- Motor `planned`/`blocked` → `blocked`, `engine: null` y razón con la nota.
- Motor disponible pero incompatible con el tipo de clip → `blocked` (“no
  soporta los tipos presentes”).
- Motor `partial` → `partial` con la aclaración.
- Motor disponible y compatible → `ready`.

El resultado incluye `target`, `status`, `engine`, `supporting`, `rationale`,
`blocked` y los clips con id/tipo/etiqueta.

## Dónde se usa

- Herramientas del asistente: `engine_catalog` y `scene_resolve` (sólo lectura).
- Servidor MCP del proyecto: las mismas dos herramientas por stdio
  (`engine_catalog`, `scene_resolve`).
- Biblioteca pura: `apps/desktop/src/features/engine/router.ts`
  (`resolveScene`, `resolveClip`, `engineCatalog`).

## Verificación

- **9 tests unitarios** del router: catálogo, imagen→Ken Burns, video→efectos,
  gráfico→motion, parallax/3D/rig/tracking parciales, motor inexistente, tipo
  incompatible, tracking facial parcial, escena con clips, escena vacía e ids
  inexistentes.
- **1 test** de las herramientas del asistente para catálogo y objetivo.
- `npm run mcp:verify` incluye `engine_catalog` (≥9 motores) y `scene_resolve`
  sobre el gráfico creado (elige `motion-graphics`).

## Límites

- No está cableado todavía en Director/auto-edit/UI: es una API y dos
  herramientas. El siguiente paso es que la planificación de escenas consulte
  al router antes de crear clips.
- `three`, `object-tracking`, `rig` y `parallax` son parciales y se reportan
  como tales; no hay ningún motor `planned` en el catálogo actual, pero la regla
  sigue vigente para futuros motores.
- No hay campo `engine` persistido por escena en el schema; el pedido se hace
  por argumento. Persistirlo requiere la entidad `Camera`/`SceneResolution` del
  bloque C.
