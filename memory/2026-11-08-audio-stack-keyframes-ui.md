# 2026-11-08 — UI de keyframes en el audioStack (Editor IA)

Pasada del loop de mejora (Devin CLI). Cierra el «Resta: UI para
keyframes/curva en el audioStack» de `docs/KDENLIVE-REFERENCE.md` §2.

## Qué se hizo

La cadena de efectos de audio del clip (`effects.audioStack`) ya soportaba
keyframes por parámetro en datos y en export (render segmentado
`atrim`/`concat`), pero la UI no los exponía: `AudioEffectStack` no pasaba
`keyframeFrame` a `EffectStackPanel`, que es quien muestra el ◆ y el
auto-key del slider.

- `AudioEffectStack.tsx`: prop opcional `keyframeFrame?: number`, reenviada
  a `EffectStackPanel`. Copy actualizado: las claves animan sólo en export
  (la preview de audio reproduce el original).
- `Inspector.tsx`: pasa `keyframeFrame={localFrame}` — el frame local del
  clip bajo el playhead que ya se calculaba para máscaras, transform y
  gain keyframes (misma convención que `EffectStudio` de video).
- Tests: `AudioEffectStack.test.tsx` 4 → 6. Nuevo harness `KeyedHarness`
  con `frame` y callback `onStack` para inspeccionar el `EffectStack`
  emitido.

## Verificación (ejecutada)

- `npx vitest run src/features/editor/AudioEffectStack.test.tsx` → **6/6**
  (66 s de corrida; tests nuevos: ausencia de ◆ sin frame; con frame 30 el
  ◆ crea pista `[0,30]`, el slider escribe la clave del frame y × limpia).
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **4 errores
  preexistentes ajenos**: `EditorAssets.tsx:960,987` e
  `Inspector.tsx:2172,2218`, todos por el campo `color` de transiciones
  `dip-color` (trabajo no confirmado de otra sesión, `exactOptionalPropertyTypes`).
  Ningún error en los archivos tocados.

## Límites / pendiente

- Las claves se crean con interpolación lineal; el editor de curva Bézier
  no existe en ninguna superficie (sigue disponible por datos/MCP/proyecto).
- La preview de audio no aplica la cadena (sigue siendo export-only,
  declarado en la UI).
- **No se commiteó**: el árbol mezcla trabajo concurrente de otra sesión
  (transiciones con `color`, `audio_scopes`, `vpn`, effect-kit…).

## Archivos

`apps/desktop/src/features/editor/AudioEffectStack.tsx` (+test),
`apps/desktop/src/features/editor/Inspector.tsx` (1 prop),
`docs/KDENLIVE-REFERENCE.md`, `docs/IMPROVEMENT-QUEUE.md`.
