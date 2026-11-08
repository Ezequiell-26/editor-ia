# 2026-11-07 — Exportación en lote de variantes del editor automático

Pasada del loop de mejora (Devin CLI). Ítem: «exportar las tres variantes a
MP4 separados en un solo lote» del lote «editor automático sin LLM"
(2026-10-27, `docs/IMPROVEMENT-QUEUE.md`).

## Qué se hizo

- `apps/desktop/src/features/autoedit/auto-edit-export.ts` (nuevo):
  `exportAutoEditVariants(service, input)` itera las variantes, aplica
  `applyAutoEditVariant` con `replace:true` sobre una copia del proyecto,
  escribe con `writeProjectVariant` (espeja medios desde la raíz de sesión)
  y renderiza con `renderProjectVariant` (verificación FFprobe incluida).
  Respeta cortes elegidos (`subsetVariant`), orden IA y títulos; perfil por
  `chooseExportProfile`. Fallo por variante no frena la cola.
- `AutoEditView.tsx`: tarjeta «Exportar variantes» — carpeta de salida
  (default `<raíz>\variantes-auto`), botón con conteo, progreso por
  variante y lista de MP4 resultantes.
- Tests: `auto-edit-export.test.ts` 5 casos nuevos; suite autoedit 36/36;
  `tsc --noEmit` desktop 0 errores.

## Notas

- `subsetVariant(v, [])` devuelve la variante completa (misma semántica que
  `includedIndices` en la vista): índices vacíos = todos los cortes.
- `createEmptyProject` no trae `renderProfiles`; en tests hay que pasar por
  `ensureDelivery` (los proyectos reales nacen con perfiles del backend).
- No se hizo render real: el camino write/render ya está cubierto por
  folder-queue; queda como verificación manual en la app.

## Siguiente

Del mismo lote quedan: preview antes de aplicar la variante y umbrales de
escena configurables. Otros pendientes reales: preview Web Audio de la
cadena de audio, importador de paquetes de efectos, transiciones OBS,
física 2D del stickman, diarización local.
