# 2026-11-08 — Ítem 20: denoise de audio declarado como export-only

## Decisión

La cola ofrecía «filtro aproximado en Web Audio **o** marcar la
diferencia en la UI». Se eligió marcar: `afftdn` es sustracción
espectral sobre FFT y la Web Audio API no tiene equivalente; una
aproximación (p. ej. un gate o un compresor) sonaría distinta del
export y sería UI deshonesta.

## Hallazgo de alcance

Al verificar el código resultó que **todo** el DSP de `clip.audio`
es export-only, no sólo denoise: `audio.rs` aplica `afftdn` (denoise),
`agate` (gateDb), EQ, high/low-pass, compresor, deesser y voiceEffect;
la preview Web Audio (`usePreviewAudio` + `Preview.tsx`) sólo reproduce
ganancia (`clipGainAtFrame`), paneo, mute y los efectos del
`audioStack` (`PREVIEW_AUDIO_FX`). Las secciones vecinas del Inspector
ya lo declaraban («Filtros y compresor se aplican en el render con
FFmpeg», «la preview reproduce la voz original»); la sección
«Reducción de ruido» era la única que no lo decía explícito.

## Cambio

`Inspector.tsx`, fine-print de la sección «Reducción de ruido»:
«la preview no las simula y se escuchan recién en el MP4» (denoise +
puerta de ruido, ambas export-only).

## Verificación

- `tsc --noEmit`: 0 errores.
- `App.test.tsx`: **77/77**, con aserción nueva de que la sección
  contiene «preview no las simula».

## Límite honesto

Aviso textual solamente; no hay badge por control ni aviso al
reproducir. Un indicador «sólo export» queda como mejora posible.
