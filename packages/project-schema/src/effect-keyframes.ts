import type { ClipEffectKeyframe } from './timeline.ts';
import { cubicBezierProgress } from './keyframes.ts';

export type SampledEffectValues = Partial<
  Record<
    | 'brightness'
    | 'contrast'
    | 'saturation'
    | 'temperature'
    | 'blur'
    | 'hueRotateDeg'
    | 'lutIntensity'
    | 'glowIntensity'
    | 'grain',
    number
  >
>;

function progressBetween(keyframe: ClipEffectKeyframe, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (keyframe.bezier) {
    return cubicBezierProgress(
      clamped,
      keyframe.bezier.cp1X,
      keyframe.bezier.cp1Y,
      keyframe.bezier.cp2X,
      keyframe.bezier.cp2Y,
    );
  }
  switch (keyframe.easing) {
    case 'ease-in':
      return clamped ** 3;
    case 'ease-out':
      return 1 - (1 - clamped) ** 3;
    case 'ease-in-out':
      return clamped * clamped * (3 - 2 * clamped);
    case 'hold':
      return 0;
    case 'linear':
    default:
      return clamped;
  }
}

/**
 * Muestreo compartido por la preview y el export: antes del primer keyframe se
 * mantiene su valor, después del último se mantiene el último, y entre dos se
 * interpola con la easing del keyframe que inicia el tramo.
 */
export function sampleEffectKeyframes(
  keyframes: readonly ClipEffectKeyframe[] | undefined,
  frame: number,
): SampledEffectValues {
  if (!keyframes || keyframes.length === 0) return {};
  const sampled: SampledEffectValues = {};
  const properties = new Set(keyframes.map((keyframe) => keyframe.property));
  for (const property of properties) {
    const points = keyframes
      .filter((keyframe) => keyframe.property === property)
      .slice()
      .sort((a, b) => a.frame - b.frame);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (frame <= first.frame) {
      sampled[property] = first.value;
      continue;
    }
    if (frame >= last.frame) {
      sampled[property] = last.value;
      continue;
    }
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      if (frame < start.frame || frame >= end.frame) continue;
      const span = Math.max(1, end.frame - start.frame);
      const progress = progressBetween(start, (frame - start.frame) / span);
      sampled[property] = start.value + (end.value - start.value) * progress;
      break;
    }
  }
  return sampled;
}
