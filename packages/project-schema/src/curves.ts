import type { ClipCurves, CurveChannel, CurvePoint } from './timeline.ts';

/** Straight line used when a channel starts being edited. */
export const CURVE_IDENTITY: readonly CurvePoint[] = Object.freeze([
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]);

export function hasCustomCurves(curves: ClipCurves | undefined): boolean {
  if (!curves) return false;
  return (
    (curves.master?.length ?? 0) >= 2 ||
    (curves.red?.length ?? 0) >= 2 ||
    (curves.green?.length ?? 0) >= 2 ||
    (curves.blue?.length ?? 0) >= 2
  );
}

export function curvePointsFor(
  curves: ClipCurves | undefined,
  channel: CurveChannel,
): CurvePoint[] {
  const points = curves?.[channel];
  return points && points.length >= 2 ? points.map((point) => ({ ...point })) : [...CURVE_IDENTITY];
}

function ordered(points: readonly CurvePoint[]): CurvePoint[] {
  return [...points].sort((a, b) => a.x - b.x);
}

/**
 * Piecewise-linear sample of a curve. The renderer uses FFmpeg's natural cubic
 * spline; this sampler only drives the approximate preview and its table.
 */
export function sampleCurvePoints(points: readonly CurvePoint[], x: number): number {
  if (points.length === 0) return x;
  const sorted = ordered(points);
  const clampedX = Math.max(0, Math.min(1, x));
  const first = sorted[0]!;
  if (clampedX <= first.x) return first.y;
  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index]!;
    if (clampedX > right.x) continue;
    const left = sorted[index - 1]!;
    const span = right.x - left.x;
    if (span <= 0) return right.y;
    const progress = (clampedX - left.x) / span;
    return Math.max(0, Math.min(1, left.y + (right.y - left.y) * progress));
  }
  return sorted[sorted.length - 1]!.y;
}

/**
 * Values for an SVG `feComponentTransfer type="table"`. Sixteen samples keep the
 * preview close to the editor while staying cheap per video frame.
 */
export function curveTableValues(
  points: readonly CurvePoint[],
  samples = 16,
): string {
  const count = Math.max(2, Math.min(64, Math.round(samples)));
  return Array.from({ length: count }, (_, index) =>
    sampleCurvePoints(points, index / (count - 1)).toFixed(4),
  ).join(' ');
}
