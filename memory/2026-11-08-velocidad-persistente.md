# Velocidad de reproducción persistida (2026-11-08)

Pasada del loop de mejora (Devin CLI). Cierra el «no persiste» del
pendiente honesto de la entrada «Velocidad de reproducción 0.25–4×»
(`docs/IMPROVEMENT-QUEUE.md`).

## Qué cambió

- `state/editor-preferences.ts`: nuevo campo `playbackRate` (default 1,
  clamp 0.25–8 vía `EDITOR_PREFERENCE_BOUNDS`). Viaja en el respaldo de
  preferencias (`preferences-backup.ts`) sin cambios extra porque usa
  `normalizeEditorPreferences`.
- `state/project-store.tsx`: el provider ya leía preferencias con
  `useEditorPreferences`; ahora la velocidad de reposo arranca desde
  `loadEditorPreferences().playbackRate` (useState + playbackRef) y un
  `useEffect` adopta cambios en vivo de la preferencia. `endShuttleRamp`
  vuelve a `playbackRatePrefRef.current` (la elegida) en vez de 1× fijo.
- `features/editor/Transport.tsx`: el `<select>` de velocidad llama
  `store.setPlaybackRate` **y** `updateEditorPreferences({ playbackRate })`.

## Decisiones

- La rampa del shuttle L/J sigue siendo transitoria: no escribe la
  preferencia. Al pausar vuelve a la velocidad elegida (antes 1× fijo,
  que pisaba la elección manual).
- No se agregó control en Ajustes → Editor: la preferencia ES la
  velocidad vigente del transporte, no un default de sesión.
- Sigue sin ir al documento del proyecto (`.editoria.json`): es
  preferencia del equipo en `localStorage`, como `loopPlayback`.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest: `editor-preferences` 10/10, `project-store` 14/14 (+2 tests
  nuevos), `Transport` 5/5 (+1), `preferences-backup` 7/7,
  `EditorPreferencesCard` 4/4.
- Regresión: `src/state` + `App.test.tsx` → 79 archivos, 864/864.

## Límites honestos

- `setPlaybackRate` sigue siendo API de sesión; sólo el selector del
  transporte escribe la preferencia.
- Un valor de respaldo fuera de las opciones del `<select>` se clampea al
  rango pero puede no coincidir con una opción (sólo JSON editado a mano).
