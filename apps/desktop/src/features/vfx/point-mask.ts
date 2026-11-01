import type { ClipMask } from '@editor-ia/project-schema';
import type { ObjectTrackResult, PointTrackResult } from '../../services/project-service';

const MAX_POINT_KEYFRAMES = 48;
const MIN_CONFIDENCE = 0.35;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validSamples(
  points: readonly { time: number; x: number; y: number; confidence: number }[],
): { time: number; x: number; y: number; confidence: number }[] {
  return points.filter(
    (sample) =>
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.x) &&
      Number.isFinite(sample.y) &&
      sample.time >= -0.001 &&
      sample.confidence >= MIN_CONFIDENCE,
  );
}

function translationKeyframes(
  samples: readonly { time: number; x: number; y: number }[],
  first: { x: number; y: number },
  fps: number,
): { frame: number; x: number; y: number }[] {
  const stride = Math.max(1, Math.ceil(samples.length / MAX_POINT_KEYFRAMES));
  const sampled = samples.filter((_, index) => index % stride === 0);
  if (sampled[sampled.length - 1] !== samples[samples.length - 1]) {
    sampled.push(samples[samples.length - 1]!);
  }
  const seen = new Set<number>();
  const keyframes = [];
  for (const sample of sampled.slice(0, MAX_POINT_KEYFRAMES)) {
    const frame = Math.max(0, Math.round(sample.time * fps));
    if (seen.has(frame)) continue;
    seen.add(frame);
    keyframes.push({
      frame,
      x: Number(Math.max(-1, Math.min(1, sample.x - first.x)).toFixed(6)),
      y: Number(Math.max(-1, Math.min(1, sample.y - first.y)).toFixed(6)),
    });
  }
  return keyframes;
}

/**
 * Convierte el seguimiento de un punto en una máscara poligonal rígida:
 * polígono alrededor del punto inicial y claves x/y con el desplazamiento.
 * Las muestras de baja confianza no generan keyframes.
 */
export function maskFromPointTrack(
  result: PointTrackResult,
  fps: number,
  radius = 0.15,
): ClipMask | null {
  const samples = validSamples(result.points);
  if (samples.length === 0 || !(fps > 0)) return null;
  const first = samples[0]!;
  const centerX = clampUnit(first.x);
  const centerY = clampUnit(first.y);
  const safeRadius = Math.max(0.02, Math.min(0.45, radius));
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = ((-90 + index * 45) * Math.PI) / 180;
    return {
      x: Number(clampUnit(centerX + Math.cos(angle) * safeRadius).toFixed(6)),
      y: Number(clampUnit(centerY + Math.sin(angle) * safeRadius).toFixed(6)),
    };
  });
  const keyframes = translationKeyframes(samples, first, fps);
  if (keyframes.length === 0) return null;
  return {
    shape: 'polygon',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    feather: 0,
    invert: false,
    points,
    keyframes,
  };
}

/**
 * Convierte el seguimiento de una caja (objeto) en una máscara rectangular
 * con el tamaño de la región y claves de traslación.
 */
export function maskFromObjectTrack(
  result: ObjectTrackResult,
  fps: number,
  width: number = result.regionWidth,
  height: number = result.regionHeight,
): ClipMask | null {
  const samples = validSamples(result.points);
  if (samples.length === 0 || !(fps > 0)) return null;
  const first = samples[0]!;
  const halfWidth = Math.max(0.005, Math.min(0.5, width / 2));
  const halfHeight = Math.max(0.005, Math.min(0.5, height / 2));
  const points = [
    { x: clampUnit(first.x - halfWidth), y: clampUnit(first.y - halfHeight) },
    { x: clampUnit(first.x + halfWidth), y: clampUnit(first.y - halfHeight) },
    { x: clampUnit(first.x + halfWidth), y: clampUnit(first.y + halfHeight) },
    { x: clampUnit(first.x - halfWidth), y: clampUnit(first.y + halfHeight) },
  ].map((point) => ({
    x: Number(point.x.toFixed(6)),
    y: Number(point.y.toFixed(6)),
  }));
  const keyframes = translationKeyframes(samples, first, fps);
  if (keyframes.length === 0) return null;
  return {
    shape: 'polygon',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    feather: 0,
    invert: false,
    points,
    keyframes,
  };
}
