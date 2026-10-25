import type {
  ClipTransformKeyframe,
  ClipGainKeyframe,
  ClipMaskKeyframe,
  KeyframeEasing,
  CubicBezier,
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

type Point = { frame: number; value: number; easing: KeyframeEasing; bezier?: CubicBezier };

/**
 * Curve presets only as starting handle positions for the curve editor; the
 * sampler never derives a bezier from a preset, so `hold` stays a step and the
 * preset formulas in `easingProgress` keep their exact legacy values.
 */
export function getBezierFromEasing(easing: string | undefined): CubicBezier {
  switch (easing) {
    case 'ease-in':
      return { cp1X: 0.42, cp1Y: 0, cp2X: 1, cp2Y: 1 };
    case 'ease-out':
      return { cp1X: 0, cp1Y: 0, cp2X: 0.58, cp2Y: 1 };
    case 'ease-in-out':
      return { cp1X: 0.42, cp1Y: 0, cp2X: 0.58, cp2Y: 1 };
    case 'linear':
    default:
      return { cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1 };
  }
}

type BezierCoefficients = { ax: number; bx: number; cx: number; ay: number; by: number; cy: number };

function bezierCoefficients(cp1X: number, cp1Y: number, cp2X: number, cp2Y: number): BezierCoefficients {
  const cx = 3 * cp1X;
  const bx = 3 * (cp2X - cp1X) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * cp1Y;
  const by = 3 * (cp2Y - cp1Y) - cy;
  const ay = 1 - cy - by;
  return { ax, bx, cx, ay, by, cy };
}

/**
 * Eased progress of a CSS-style cubic-bezier curve for a segment progress
 * `t`: solves the parameter u with x(u) = t (Newton, bisection fallback) and
 * returns y(u). With the (0,0,1,1) control points this is the identity.
 */
export function cubicBezierProgress(t: number, cp1X: number, cp1Y: number, cp2X: number, cp2Y: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;
  const { ax, bx, cx, ay, by, cy } = bezierCoefficients(cp1X, cp1Y, cp2X, cp2Y);
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const derivativeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  let u = clamped;
  for (let i = 0; i < 8; i += 1) {
    const x = sampleX(u) - clamped;
    if (Math.abs(x) < 1e-6) return sampleY(u);
    const d = derivativeX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  let low = 0;
  let high = 1;
  u = clamped;
  for (let i = 0; i < 24; i += 1) {
    const x = sampleX(u);
    if (Math.abs(x - clamped) < 1e-6) break;
    if (x < clamped) low = u;
    else high = u;
    u = (low + high) / 2;
  }
  return sampleY(u);
}

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

function bezierOf(raw: unknown): CubicBezier | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const coords = [candidate.cp1X, candidate.cp1Y, candidate.cp2X, candidate.cp2Y];
  if (coords.some((c) => typeof c !== 'number' || !Number.isFinite(c))) return undefined;
  const [cp1X, cp1Y, cp2X, cp2Y] = coords as [number, number, number, number];
  return { cp1X, cp1Y, cp2X, cp2Y };
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
      const point: Point = { frame, value, easing };
      const bezier = bezierOf(keyframe.bezier);
      if (bezier) point.bezier = bezier;
      points.push(point);
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
      // Como `easing`, el bezier del keyframe donde empieza el segmento es el
      // que lo gobierna; el de un keyframe intermedio no contamina al siguiente.
      const eased = previous.bezier
        ? cubicBezierProgress(progress, previous.bezier.cp1X, previous.bezier.cp1Y, previous.bezier.cp2X, previous.bezier.cp2Y)
        : easingProgress(progress, previous.easing);
      return previous.value + (current.value - previous.value) * eased;
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
