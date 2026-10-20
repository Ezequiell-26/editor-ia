import type {
  ClipTransformKeyframe,
  ClipGainKeyframe,
  ClipMaskKeyframe,
  KeyframeEasing,
} from './timeline.ts';

/**
 * Keyframe sampling, shared by the Inspector, the preview and the tests. The
 * Rust renderer reimplements the same rule (clamp before the first sample,
 * easing between samples, hold the last value after it) so a project does not
 * change look between the preview and the exported file.
 *
 * Keyframe frames are offsets from the clip start, in project frames. The
 * `easing` of a keyframe controls the segment that starts at it; the last
 * keyframe's easing is unused.
 */

type TransformKey = 'offsetX' | 'offsetY' | 'scale' | 'rotationDeg' | 'opacity';

const TRANSFORM_KEYS: readonly TransformKey[] = [
  'offsetX',
  'offsetY',
  'scale',
  'rotationDeg',
  'opacity',
];

export type SampledTransform = Partial<Record<TransformKey, number>>;

type Point = { frame: number; value: number; easing: KeyframeEasing };

function easingProgress(progress: number, easing: KeyframeEasing): number {
  switch (easing) {
    case 'ease-in':
      return progress ** 3;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'ease-in-out':
      return progress * progress * (3 - 2 * progress);
    case 'hold':
      return 0;
    case 'linear':
    default:
      return progress;
  }
}

function pointsFor<K extends string>(
  keyframes: readonly Record<string, unknown>[],
  key: K,
): Point[] {
  const points: Point[] = [];
  for (const keyframe of keyframes) {
    const value = keyframe[key];
    const frame = keyframe.frame;
    if (typeof value === 'number' && Number.isFinite(value) && typeof frame === 'number') {
      const easing =
        keyframe.easing === 'ease-in' ||
        keyframe.easing === 'ease-out' ||
        keyframe.easing === 'ease-in-out' ||
        keyframe.easing === 'hold'
          ? keyframe.easing
          : 'linear';
      points.push({ frame, value, easing });
    }
  }
  return points.sort((a, b) => a.frame - b.frame);
}

function samplePoints(points: readonly Point[], frame: number): number | undefined {
  if (points.length === 0) return undefined;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (frame <= current.frame) {
      const span = current.frame - previous.frame;
      if (span <= 0) return current.value;
      const progress = (frame - previous.frame) / span;
      return (
        previous.value +
        (current.value - previous.value) * easingProgress(progress, previous.easing)
      );
    }
  }
  return last.value;
}

/** Samples each animated property that appears in at least one keyframe. */
export function sampleTransformKeyframes(
  keyframes: readonly ClipTransformKeyframe[],
  frame: number,
): SampledTransform {
  const sampled: SampledTransform = {};
  for (const key of TRANSFORM_KEYS) {
    const value = samplePoints(pointsFor(keyframes, key), frame);
    if (value !== undefined) sampled[key] = value;
  }
  return sampled;
}

export function sampleGainKeyframes(
  keyframes: readonly ClipGainKeyframe[],
  frame: number,
): number | undefined {
  return samplePoints(pointsFor(keyframes, 'gainDb'), frame);
}

type MaskKey = 'x' | 'y' | 'width' | 'height' | 'rotationDeg' | 'feather';
export type SampledMask = Partial<Record<MaskKey, number>>;

const MASK_KEYS: readonly MaskKey[] = [
  'x',
  'y',
  'width',
  'height',
  'rotationDeg',
  'feather',
];

/** Samples each animated mask property that appears in at least one keyframe. */
export function sampleMaskKeyframes(
  keyframes: readonly ClipMaskKeyframe[],
  frame: number,
): SampledMask {
  const sampled: SampledMask = {};
  for (const key of MASK_KEYS) {
    const value = samplePoints(pointsFor(keyframes, key), frame);
    if (value !== undefined) sampled[key] = value;
  }
  return sampled;
}

export function hasTransformKeyframes(
  keyframes: readonly ClipTransformKeyframe[] | undefined,
): keyframes is readonly ClipTransformKeyframe[] {
  return keyframes !== undefined && keyframes.length > 0;
}

export function hasGainKeyframes(
  keyframes: readonly ClipGainKeyframe[] | undefined,
): keyframes is readonly ClipGainKeyframe[] {
  return keyframes !== undefined && keyframes.length > 0;
}

/** True when a keyframe animates position or uniform scale. */
export function hasGeometryKeyframes(
  keyframes: readonly ClipTransformKeyframe[] | undefined,
): boolean {
  return (
    keyframes?.some(
      (keyframe) =>
        keyframe.scale !== undefined ||
        keyframe.offsetX !== undefined ||
        keyframe.offsetY !== undefined,
    ) ?? false
  );
}

/** Clamped offset of the playhead inside a clip, in frames from its start. */
export function keyframeFrameAt(
  playheadFrame: number,
  startFrame: number,
  durationFrames: number,
): number {
  const last = Math.max(0, durationFrames - 1);
  return Math.max(0, Math.min(last, Math.round(playheadFrame - startFrame)));
}
