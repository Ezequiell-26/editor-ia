# 2026-11-08 — Click-to-seek en la lista de keyframes de efectos

Pasada del loop (Devin CLI). Cierra el «no hay click-to-seek» del
«Pendiente honesto» de la entrada lista de keyframes por parámetro
(2026-11-08).

## Qué se hizo

- `EffectStackPanel` (`features/vfx/EffectStackPanel.tsx`): prop nueva
  opcional `onSeekFrame?: (localFrame) => void`. En la `.keyframe-list`
  del popover «Curva», la etiqueta `frame N · valor · easing` pasa a ser
  un `<button>` («Ir al frame N de <parámetro>») sólo cuando hay callback;
  sin él queda el `<span class="fine-print">` de siempre (el panel sigue
  puro). `ParamAnimation` gana `onSeek` y `activeFrame`; la fila cuyo
  frame coincide con el playhead lleva la clase `active`.
- `StackRow`/`EffectStackPanel` reenvían la prop; `AudioEffectStack` y
  `EffectStudio` la exponen igual que `keyframeFrame`.
- Cableado real: `Inspector.tsx` (audioStack) y `VfxView.tsx`
  (EffectStudio) pasan `onSeekFrame={(f) => store.setPlayhead(
  clip.startFrame + f)}` — idéntico al seek de la lista de keyframes de
  máscara del Inspector (`Inspector.tsx:3534`).

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/editor/AudioEffectStack.test.tsx
  src/features/vfx` → 38/38 (AudioEffectStack 10/10 con el test nuevo:
  click → callback con frame local + fila `active` en el frame del
  playhead).

## Pendiente honesto

Las filas muestran frame local del clip (el panel no recibe fps → sin
timecode); el seek salta al frame pero no reproduce hasta ahí.
