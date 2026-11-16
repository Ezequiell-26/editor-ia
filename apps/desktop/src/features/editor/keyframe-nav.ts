import type { Clip } from '@editor-ia/project-schema';

/**
 * Navegación por keyframes del clip seleccionado.
 *
 * Patrón tomado de CapCut (y de los editores de referencia): junto al botón de
 * marcador hay dos flechas que saltan al keyframe anterior / siguiente sin
 * abrir el inspector ni buscar el diamante a ojo. En Olyvia los keyframes
 * viven repartidos en cinco fuentes distintas del documento —transform,
 * ganancia de audio, máscara y los dos stacks de efectos—, así que la lista se
 * unifica acá una sola vez y la UI no duplica el recorrido.
 *
 * Los `frame` del esquema son **offsets desde el inicio del clip**; esta API
 * devuelve siempre **frames absolutos de timeline**, que es lo que usa el
 * playhead. Se descartan claves fuera del tramo del clip para que una flecha
 * nunca lleve el cabezal a un lugar donde el clip ya no existe.
 */

type LocalKeyframe = { readonly frame: number };

/** Vista mínima de una instancia de efecto: sólo lo que aporta keyframes. */
type EffectWithKeyframes = {
  readonly keyframes?: Record<string, readonly LocalKeyframe[]> | undefined;
};

/** `stack` (video) y `audioStack` (audio) comparten la forma de instancia. */
type EffectStacks = {
  readonly stack?: readonly EffectWithKeyframes[] | undefined;
  readonly audioStack?: readonly EffectWithKeyframes[] | undefined;
};

function pushFrames(target: number[], frames: readonly LocalKeyframe[] | undefined): void {
  if (!frames) return;
  for (const keyframe of frames) target.push(keyframe.frame);
}

function pushEffectKeyframes(
  target: number[],
  effects: readonly EffectWithKeyframes[] | undefined,
): void {
  if (!effects) return;
  for (const effect of effects) {
    for (const frames of Object.values(effect.keyframes ?? {})) pushFrames(target, frames);
  }
}

/** Frames absolutos, ordenados y sin repetir, de todos los keyframes del clip. */
export function clipKeyframeFrames(clip: Clip): number[] {
  const local: number[] = [];
  pushFrames(local, clip.transform?.keyframes);
  pushFrames(local, clip.audio?.gainKeyframes);
  if ('mask' in clip) pushFrames(local, clip.mask?.keyframes);

  // Los keyframes de efectos viven POR INSTANCIA (`stack` de video y
  // `audioStack` de audio); `ClipEffects` no tiene un mapa propio.
  if ('effects' in clip && clip.effects) {
    const effects = clip.effects as unknown as EffectStacks;
    pushEffectKeyframes(local, effects.stack);
    pushEffectKeyframes(local, effects.audioStack);
  }

  const start = clip.startFrame;
  const end = start + clip.durationFrames;
  const absolute = local
    .map((frame) => start + frame)
    .filter((frame) => frame >= start && frame <= end);

  return [...new Set(absolute)].sort((a, b) => a - b);
}

/** Último keyframe estrictamente anterior a `frame` (null si no hay). */
export function previousKeyframe(
  frames: readonly number[],
  frame: number,
): number | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const candidate = frames[index]!;
    if (candidate < frame) return candidate;
  }
  return null;
}

/** Primer keyframe estrictamente posterior a `frame` (null si no hay). */
export function nextKeyframe(frames: readonly number[], frame: number): number | null {
  for (const candidate of frames) {
    if (candidate > frame) return candidate;
  }
  return null;
}

/** Posición 1-based del keyframe en la lista; 0 si el frame no es una clave. */
export function keyframePosition(frames: readonly number[], frame: number): number {
  const index = frames.indexOf(frame);
  return index < 0 ? 0 : index + 1;
}
