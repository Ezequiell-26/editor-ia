# 2026-11-07 — App.test.tsx: timeouts reales para chunks lazy de hubs y modos

## Contexto

Pasada del loop de mejora (Devin CLI). El ledger estaba cerrado
(preflight `idle`), así que se buscó una brecha demostrable: la suite
`App.test.tsx` fallaba con **5 tests** en una corrida completa
(76 tests, 5 failed) mientras cada uno pasaba aislado.

## Diagnóstico

Mismo patrón que `56a1ff8` («espera real para el chunk lazy de
Descargar»): vistas lazy (`YouTubeAnalyzerView`, `MediaLabView`,
`CreatorHubView`, `MixerView`, `DenoiseView`) tardan más de 1 s — el
timeout default de `findBy*`/`waitFor` de Testing Library — cuando el
archivo corre entero bajo carga. Evidencia: `.view-loading` persistente
en el DOM volcado por Testing Library y los 5 tests en verde con
`-t` aislado.

Tests estabilizados (timeouts a 5000 ms, mismo criterio que
`createProject`/`.timeline-surface`):

- `agrupa YouTube dentro de Descargar…` — `findByText('Analizador de
  YouTube')`.
- `abre los modos de edición sin perder la timeline` — waitFor de
  «Mezcla de audio» (MixerView lazy dentro del modo `mixer`).
- `redirige un deep link de utilidad al Laboratorio` — `findByRole tab
  'Convertir'` (MediaLabView lazy).
- `redirige un deep link de creador al hub` — `findByRole tab
  'Fábrica'` (CreatorHubView lazy).
- `abre Denoise Studio…` — waitFor de «Reducir ruido en tiempo real»
  (DenoiseView lazy dentro del tab del hub).
- Extra preventivo: `redirige un deep link de modo del editor` — waitFor
  del heading del editor (EditorWorkspace es el chunk más grande).

## Verificación

- `npx vitest run src/App.test.tsx` completo: **76/76** (antes 5 failed).
- `npx tsc --noEmit -p apps/desktop/tsconfig.json`: 1 error **ajeno** en
  `src/features/settings/VpnCard.test.tsx(42,21)` — archivo del trabajo
  VPN no confirmado del usuario; no se tocó. `App.test.tsx` compila.
- Warnings jsdom `HTMLCanvasElement.getContext` (ThumbnailView): ruido
  conocido.

## Archivos

- `apps/desktop/src/App.test.tsx` (6 esperas con `{ timeout: 5000 }`).
- `docs/IMPROVEMENT-QUEUE.md` (entrada `[done]`).
- `.editoria-loop/LEDGER.json` (pasada registrada).
