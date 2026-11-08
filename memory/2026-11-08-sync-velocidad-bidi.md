# 2026-11-08 — Reconciliación 8: velocidad persistente, mate stale, bidi RTL

## Qué se portó desde main (`dcc2621..b4052c6`, 3 commits)

- `5e9cf9d` velocidad de reproducción persistida como preferencia:
  `editor-preferences` gana `playbackRate`; `ProjectProvider` arranca con
  `loadEditorPreferences().playbackRate`, un efecto adopta cambios en vivo
  y `endShuttleRamp` vuelve a la velocidad elegida (no a 1× fijo).
  `Transport` escribe la preferencia desde el selector.
- `29871d4` aviso «mate asignado ya no válido» en el selector por lote
  de `VisualsView` cuando el `mateClipId` guardado no está entre los
  candidatos.
- `b4052c6` isolate bidi FSI/PDI en cues RTL al exportar SRT/VTT
  (`serializeSrtSeconds`/`serializeVttSeconds` ganan `direction`);
  `DownloadView` elimina su `buildSrt` duplicado y usa el serializador
  compartido; `LocalizationView` pasa la dirección del idioma.

## Particularidad del port

`project-store.tsx` de main está spliteado en el worktree
(`project-store-{context,types,provider,selectors}`): el delta se aplicó
a mano en `project-store-provider.tsx` (import de `loadEditorPreferences`,
`useState`/`playbackRef` inicializados desde la preferencia,
`playbackRatePrefRef`, efecto de adopción y `endShuttleRamp` con la
preferencia). Los otros 11 archivos se copiaron verbatim desde
`git show HEAD:` (verificados idénticos a la base `dcc2621` salvo EOL).
`LEDGER.json` de main no se copió (registra pasadas del loop de main).

## Verificación

- `npm run typecheck` (apps/desktop): 0 errores.
- vitest de las áreas tocadas: **50/50** — project-store 14 (+2 de la
  preferencia persistida), editor-preferences 10 (+1), subtitles 15
  (+2 bidi), Transport 5 (+1 persistencia), VisualsView 6 (+2 mate
  stale).
