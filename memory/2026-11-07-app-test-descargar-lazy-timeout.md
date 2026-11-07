# 2026-11-07 — App.test: timeout real para el chunk lazy de Descargar

Pasada del loop (Devin CLI). El ledger estaba cerrado (`loop:preflight` →
`idle`), así que el ítem salió de la evidencia de suite: `App.test.tsx`
fallaba en «abre el descargador, analiza una URL y la importa con el
servicio simulado».

## Diagnóstico

Con proyecto abierto, `nav('Descargar')` no monta la vista standalone:
`App.tsx` → `editorToolForView('download')` → `EditorWorkspace` en modo
`tools` → `DownloadsHubView` → `DownloadView` (lazy). El DOM ya mostraba el
hub («Descargar / YouTube / Cumplimiento») pero el `waitFor` por defecto
de Testing Library (1 s) vencía antes de que el chunk grande de
`DownloadView` terminara de transformarse y montar. No era un bug de
producto: la unificación F2/T1 es la conducta correcta y el flujo
analizar→importar→auto-editar funcionaba.

## Cambio

`apps/desktop/src/App.test.tsx`: las dos esperas de «Motor de descargas» y
«Copiar conexión» pasan a `{ timeout: 5000 }`, el mismo criterio que
`createProject` ya usa para `.timeline-surface` (chunks lazy del editor).

## Verificación (ejecutada)

- `npx vitest run src/App.test.tsx -t "abre el descargador"` → 1/1 (2,3 s).
- `npx vitest run src/App.test.tsx` → **76/76** (42 s).
- `npm run typecheck` → 0 errores.
- No se corrió `npm run verify` completo (cambio de test acotado).

Los `HTMLCanvasElement.getContext` de jsdom en `ThumbnailView` siguen
siendo ruido conocido, no la causa.

## Siguiente paso

Nada pendiente de este ítem. Si vuelven a aparecer timeouts de chunks
lazy en `App.test.tsx`, revisar primero si el módulo nuevo es grande y
merece el mismo criterio de espera explícita.
