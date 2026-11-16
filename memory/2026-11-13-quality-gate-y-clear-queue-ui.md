# Oleada 13 — callers UI para qualityGateReview y renderQueueClearFinished

Cierra los 2 métodos de servicio que la auditoría marcó sin caller UI
(los 4 layers —contrato, adapter tauri, unavailable, fake— ya existían).

## Dónde se conectaron

- **`qualityGateReview()`** → `ExportDialog.tsx`, bloque "Quality Gate del
  proyecto" junto a "Calidad de entrega". Botón "Revisar calidad" que primero
  `store.saveNow()` (el gate evalúa el documento **persistido**) y luego llama
  al servicio; renderiza veredicto + findings con severidad/check/path.
  Sólo visible si `service.available`.
- **`renderQueueClearFinished()`** → `ExportDialog.tsx`, junto a "Limpiar
  terminadas" (que sigue siendo scoped al proyecto). Nuevo botón "Limpiar
  finalizadas del equipo": vacía terminadas de TODOS los proyectos vía
  backend; `null` (runtime sin soporte) → fallback `clearSettled(queue)`
  global en memoria. Confirmación `window.confirm` desde 5 items
  (`QUEUE_CLEAR_CONFIRM_AT`).

## Decisiones

- El gate es informativo: NO bloquea el export (el bloqueo local sigue siendo
  `evaluateProjectQuality` + `hasQualityError`).
- `fake-service.ts` ya devolvía reportes realistas y cola filtrada; no hubo
  que ajustarlo. Tests seedean la cola con `service.renderQueueSave` antes de
  montar (la hidratación `renderQueueLoad` corre en efecto al abrir).

## Verificación

- `node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json` → limpio.
- `npx vitest run apps/desktop/src/features/editor/ExportDialog.test.tsx` → 12/12.
