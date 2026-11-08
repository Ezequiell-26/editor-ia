# 2026-11-08 — Scopes de audio bajo el playhead (Editor IA)

Pasada del loop de mejora (Devin CLI). Cierra la mitad «scopes del clip
bajo playhead» del pendiente del port Kdenlive
(`docs/IMPROVEMENT-QUEUE.md`, entrada de `audio_scopes`).

## Qué se hizo

El panel `AudioScopesPanel` (Mixer) sólo analizaba el asset completo.
Ahora tiene dos modos: «Material completo» y «Ventana del playhead» (±2,5 s
sobre el clip que contiene el playhead).

- **Rust** (`commands/audio_scopes.rs`): `audio_scope_analyze` y
  `audio_scope_analyze_asset` aceptan `startSeconds`/`durationSeconds`
  opcionales → `decode_pcm` usa `-ss` (antes de `-i`) y `-t` (salida).
  `normalize_scope_range` valida: van juntos, start ≥ 0 finito, duración
  > 0 finita acotada a 90 s.
- **Mapeo** (`state/playhead-audio-scope.ts`, nuevo):
  `audioScopeCandidatesAtPlayhead(project, frame)` → clips video/audio con
  `source.type==='asset'` bajo el playhead, ordenados por `track.order`
  descendente. Frame→segundo: `inFrame + local·speed / fps` (igual que
  `Preview.tsx`); `speedCurve` usa `curveSourceFraction` (mismo mapeo que
  `buildSpeedKnots` del renderer); `reverse` invierte el recorrido local.
  Ventana acotada a `media.durationFrames` del asset (video: fps propio;
  audio: fps del proyecto).
- **UI**: selector de modo + selector de clip cuando hay solapados. Nota
  honesta: mide el material fuente, no la mezcla (mutes/fades/efectos no
  aplican). Playhead se lee con `usePlayheadFrame` sólo para calcular
  candidatos; el análisis es manual.

## Verificación (ejecutada)

- `cargo test -p editor-ia-desktop --lib audio_scopes` → **8/8**
  (3 tests nuevos de `normalize_scope_range`). Compilación completa de la
  crate en esa corrida (691 tests filtrados).
- `npx vitest run src/state/playhead-audio-scope.test.ts
  src/features/mixer/AudioScopesPanel.test.tsx` → **12/12**;
  `src/features/mixer` completo → **37/37**.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0**.
- `rustfmt` sólo sobre `audio_scopes.rs`; `audio.rs` tiene diffs de fmt
  preexistentes de trabajo ajeno sin commitear (no se tocaron).

## Límites / pendiente

- Scope «en preview del monitor» (mezcla Web Audio real) sigue pendiente:
  requeriría un AnalyserNode por pista o volcar el bus master a un buffer.
- La ventana puede extenderse fuera del `inFrame`/`outFrame` del clip a
  propósito (contexto alrededor del playhead); si el asset es más corto,
  ffmpeg simplemente devuelve menos PCM.
- No se commiteó: el árbol mezcla trabajo concurrente de otra sesión en
  `project-service.ts`, `audio.rs`, `vpn.rs`, etc.
