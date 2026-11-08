# 2026-11-08 — UI para ocultar la pista del mate de luma-wipe

Pasada del protocolo del loop (Devin CLI). Ledger cerrado
(`loop:preflight` → `idle`); el ítem salió del «Pendiente» declarado en la
entrada luma-wipe de `docs/IMPROVEMENT-QUEUE.md`.

## Qué se hizo

El mate de la transición `luma-wipe` puede vivir en una pista oculta: el
render (`render/ffmpeg.rs::luma_mate`) lo resuelve por id sin mirar
`track.hidden`, y el pipeline salta los clips de pistas ocultas como imagen
(`hidden_tracks`). Funcionaba, pero no había UI que llevara al usuario a ese
estado — había que descubrir la pestaña Pista por cuenta propia.

- `features/editor/luma-mate.ts`: nuevo helper puro `lumaMateById(clips,
  tracks, mateClipId)` → `LumaMateCandidate | undefined`. No valida
  cobertura ni tipo (a diferencia de `lumaMateCandidates`): sirve aunque el
  mate esté stale, porque ocultar su pista sigue siendo correcto.
- `features/editor/Inspector.tsx`: en el bloque `luma-wipe`, con mate
  asignado, checkbox «Ocultar la pista «{label}»» → `updateTrack(hidden)`.
  Copy honesto en tres casos: pista ya oculta (sólo aporta máscara), pista
  con sólo el mate (no se pierde nada más) y pista con más clips (avisa que
  se ocultan todos y sugiere mover el mate a pista propia).
- **Bloqueo deliberado**: si el mate está en la misma pista que el clip con
  la transición, ocultarla también ocultaría el clip en preview y export —
  se muestra `notice-warning` en vez del toggle.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/editor/luma-mate.test.ts` → 7/7 (+2 tests de
  `lumaMateById`).
- Sin cambios en Rust ni en el contrato del render.

## Pendiente honesto

- El mate sigue sin preview animado en el monitor (frame congelado, igual
  que el resto de transiciones con lead).
- No hay UI para mover el mate a una pista propia; hay que hacerlo a mano.
- El mate en pista oculta no se distingue visualmente en la timeline más
  allá de la etiqueta «pista oculta» del selector.
