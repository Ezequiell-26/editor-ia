# 2026-11-08 — Ítem 12: documentación honesta del README

## Cambio

`README.md` ganó una fila «Motion graphics» en la tabla de funcionalidades
que declara Lottie con sus límites reales:

- formatos aceptados: `.json` y `.lottie` (ZIP descomprimido con `fflate`);
- salida: raster por canvas → WebM VP9 con alfa real;
- límites: sin expresiones de After Effects, sin edición de la animación.

## Evaluación de los otros dos pedidos del ítem

- **«3D marcado como pendiente»**: al revisar resultó que `slide-3d` ya
  está implementado y verificado (commit `ac27a5a` del port de
  reconciliación); no había una función 3D ficticia que corregir en el
  README. Lo que sí sigue pendiente y declarado es la física 2D de
  cuerpos rígidos del stickman (CAPABILITY-MATRIX §7).
- **«hashes/counts actuales»**: los SHA-256 del release viven en
  `docs/RELEASE.md` §6.1 y corresponden a la build 0.2.0; se regeneran
  con cada release, no son datos de una pasada de documentación.

## Verificación

Sólo documentación: `diff` README main↔worktree era idéntico antes del
cambio; se agregó una fila. Sin tests aplicables.
